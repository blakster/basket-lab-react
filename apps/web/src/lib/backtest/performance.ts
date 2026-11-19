import type {
  BacktestResult,
  Basket,
  LabSettings,
  NavPoint,
  TimePoint,
} from "../../types";
import { calculateXirr } from "./xirr";

export { resolveRange } from "../resolveSettings";

export function cagr(initial: number, final: number, years: number): number {
  if (initial <= 0 || years <= 0) return 0;
  return (Math.pow(final / initial, 1 / years) - 1) * 100;
}

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function navOnOrBefore(history: NavPoint[], day: Date): number | null {
  let hit: NavPoint | null = null;
  for (const p of history) {
    if (parseDay(p.date) <= day) hit = p;
    else break;
  }
  return hit ? hit.nav : null;
}

function firstIso(points: NavPoint[]): string {
  return points.reduce((a, p) => (p.date < a ? p.date : a), points[0].date);
}

const emptyStats = { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 };

function noNav(basketId: string): BacktestResult {
  return {
    basketId,
    series: [],
    stats: { ...emptyStats },
    error: "no-nav",
  };
}

export function backtestBasket(
  basket: Basket,
  navs: Record<string, NavPoint[]>,
  settings: LabSettings,
): BacktestResult {
  return backtestPlan(
    basket,
    navs,
    settings,
    settings.mode === "lumpsum"
      ? { kind: "lumpsum" }
      : { kind: "sip", stepUp: 0 },
  );
}

export type CashflowPlan =
  | { kind: "lumpsum" }
  | {
      kind: "sip";
      stepUp: number;
      skipStartIso?: string;
      skipEndIso?: string;
      /** Skip SIPs on `skipEndIso` too (window was clipped to the run's end). */
      skipEndInclusive?: boolean;
    };

export type SkipWindow = {
  skipStartIso: string;
  skipEndIso: string;
  skipEndInclusive: boolean;
};

/**
 * Year `year` of a SIP that starts on `startIso`. The next anniversary is
 * exclusive; when that falls after `endIso` the window is clipped to the
 * (inclusive) last day of the run so no SIP lands inside the skip year.
 */
export function skipYearWindow(
  startIso: string,
  endIso: string,
  year = 2,
): SkipWindow | null {
  const start = parseDay(startIso);
  const end = parseDay(endIso);
  const skipStart = new Date(start);
  skipStart.setFullYear(skipStart.getFullYear() + year - 1);
  const skipEnd = new Date(skipStart);
  skipEnd.setFullYear(skipEnd.getFullYear() + 1);
  if (skipStart >= end) return null;
  if (skipEnd <= end) {
    return {
      skipStartIso: isoDay(skipStart),
      skipEndIso: isoDay(skipEnd),
      skipEndInclusive: false,
    };
  }
  return {
    skipStartIso: isoDay(skipStart),
    skipEndIso: endIso,
    skipEndInclusive: true,
  };
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function backtestPlan(
  basket: Basket,
  navs: Record<string, NavPoint[]>,
  settings: LabSettings,
  plan: CashflowPlan,
): BacktestResult {
  const requestedStartIso = settings.customStart!;
  const endIso = settings.customEnd!;
  const endDate = parseDay(endIso);

  let startIso = requestedStartIso;
  for (const f of basket.funds) {
    if (f.weight <= 0) continue;
    const series = navs[f.schemeCode];
    if (!series?.length) return noNav(basket.id);
    const first = firstIso(series);
    if (first > startIso) startIso = first;
  }
  if (startIso > endIso) return noNav(basket.id);

  const startDate = parseDay(startIso);
  const inRange = Object.values(navs).some((series) =>
    series.some((p) => p.date >= startIso && p.date <= endIso),
  );
  if (!inRange) return noNav(basket.id);

  const timeline = Object.values(navs)[0]
    .map((p) => p.date)
    .filter((d) => d >= startIso && d <= endIso);
  if (timeline[0] !== startIso) timeline.unshift(startIso);

  return runBacktest(
    basket,
    navs,
    settings,
    startIso,
    requestedStartIso,
    endDate,
    startDate,
    timeline,
    plan,
  );
}

function sipInstallment(amount: number, sipIndex: number, stepUp: number): number {
  if (!(stepUp > 0)) return amount;
  const years = Math.floor(sipIndex / 12);
  return amount * Math.pow(1 + stepUp, years);
}

function runBacktest(
  basket: Basket,
  navs: Record<string, NavPoint[]>,
  settings: LabSettings,
  startIso: string,
  requestedStartIso: string,
  endDate: Date,
  startDate: Date,
  timeline: string[],
  plan: CashflowPlan,
): BacktestResult {
  if (plan.kind === "lumpsum") {
    const holdings: Record<string, number> = {};
    for (const f of basket.funds) {
      if (f.weight <= 0) continue;
      const px = navOnOrBefore(navs[f.schemeCode], startDate);
      if (px == null || px === 0) {
        return noNav(basket.id);
      }
      holdings[f.schemeCode] = (settings.amount * f.weight) / 100 / px;
    }
    const series: TimePoint[] = [];
    let peak = 0;
    let mdd = 0;
    for (const iso of timeline) {
      const day = parseDay(iso);
      let value = 0;
      for (const f of basket.funds) {
        if (f.weight <= 0) continue;
        const px = navOnOrBefore(navs[f.schemeCode], day);
        if (px == null) {
          value = NaN;
          break;
        }
        value += holdings[f.schemeCode] * px;
      }
      if (!Number.isFinite(value)) continue;
      if (value > peak) peak = value;
      const dd = peak > 0 ? ((value - peak) / peak) * 100 : 0;
      if (dd < mdd) mdd = dd;
      series.push({ x: iso, y: value, drawdown: dd });
    }
    if (series.length === 0) return noNav(basket.id);
    const final = series.at(-1)?.y ?? 0;
    // Day-count / 365 so a non-leap calendar year is exactly 1.0 (matches CAGR fixtures).
    const years =
      (endDate.getTime() - startDate.getTime()) / (365 * 86400000);
    return {
      basketId: basket.id,
      series,
      cashflow: {
        mode: "lumpsum",
        amount: settings.amount,
        startIso,
        requestedStartIso,
      },
      stats: {
        initial: settings.amount,
        final,
        abs: ((final - settings.amount) / settings.amount) * 100,
        cagr: cagr(settings.amount, final, years),
        mdd,
      },
    };
  }

  // SIP: invest settings.amount on first date and every month anniversary
  const holdings: Record<string, { units: number; weight: number }> = {};
  for (const f of basket.funds) {
    if (f.weight <= 0) continue;
    holdings[f.schemeCode] = { units: 0, weight: f.weight };
  }
  const series: TimePoint[] = [];
  let totalInvested = 0;
  let peak = 0;
  let mdd = 0;
  let nextSip = new Date(startDate);
  let sipCount = 0;
  const cashflows: { date: Date; amount: number }[] = [];

  for (const iso of timeline) {
    const day = parseDay(iso);
    if (day >= nextSip) {
      const skipStart =
        plan.skipStartIso != null ? parseDay(plan.skipStartIso) : null;
      const skipEnd = plan.skipEndIso != null ? parseDay(plan.skipEndIso) : null;
      const inSkip =
        skipStart != null &&
        skipEnd != null &&
        day >= skipStart &&
        (plan.skipEndInclusive ? day <= skipEnd : day < skipEnd);
      if (!inSkip) {
        const installment = sipInstallment(
          settings.amount,
          sipCount,
          plan.stepUp,
        );
        const adds: Record<string, number> = {};
        let priced = true;
        for (const f of basket.funds) {
          if (f.weight <= 0) continue;
          const px = navOnOrBefore(navs[f.schemeCode], day);
          if (px == null || px === 0) {
            priced = false;
            break;
          }
          adds[f.schemeCode] = (installment * f.weight) / 100 / px;
        }
        if (!priced) return noNav(basket.id);
        for (const [code, units] of Object.entries(adds)) {
          holdings[code]!.units += units;
        }
        cashflows.push({ date: new Date(day), amount: -installment });
        totalInvested += installment;
      }
      sipCount += 1;
      nextSip = new Date(startDate);
      nextSip.setMonth(nextSip.getMonth() + sipCount);
    }
    let value = 0;
    for (const f of basket.funds) {
      if (f.weight <= 0) continue;
      const px = navOnOrBefore(navs[f.schemeCode], day);
      if (px == null) {
        value = NaN;
        break;
      }
      value += holdings[f.schemeCode].units * px;
    }
    if (!Number.isFinite(value) || totalInvested === 0) continue;
    if (value > peak) peak = value;
    const dd = peak > 0 ? ((value - peak) / peak) * 100 : 0;
    if (dd < mdd) mdd = dd;
    series.push({ x: iso, y: value, drawdown: dd });
  }
  if (series.length === 0) return noNav(basket.id);
  const final = series.at(-1)?.y ?? 0;
  if (series.length) {
    cashflows.push({ date: parseDay(series.at(-1)!.x), amount: final });
  }
  return {
    basketId: basket.id,
    series,
    cashflow: {
      mode: "sip",
      amount: settings.amount,
      startIso,
      requestedStartIso,
      stepUp: plan.stepUp,
      skipStartIso: plan.skipStartIso,
      skipEndIso: plan.skipEndIso,
      skipEndInclusive: plan.skipEndInclusive,
    },
    stats: {
      initial: totalInvested,
      final,
      abs:
        totalInvested > 0
          ? ((final - totalInvested) / totalInvested) * 100
          : 0,
      cagr: calculateXirr(cashflows),
      mdd,
    },
  };
}
