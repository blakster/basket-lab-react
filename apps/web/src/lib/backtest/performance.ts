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
  // Caller must resolve named periods via resolveRange and set customStart/customEnd.
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

  if (settings.mode === "lumpsum") {
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
        mode: settings.mode,
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
      const adds: Record<string, number> = {};
      let priced = true;
      for (const f of basket.funds) {
        if (f.weight <= 0) continue;
        const px = navOnOrBefore(navs[f.schemeCode], day);
        if (px == null || px === 0) {
          priced = false;
          break;
        }
        adds[f.schemeCode] = (settings.amount * f.weight) / 100 / px;
      }
      // Missing a weighted fund's price: do not book the full cashflow.
      if (!priced) return noNav(basket.id);
      for (const [code, units] of Object.entries(adds)) {
        holdings[code]!.units += units;
      }
      cashflows.push({ date: new Date(day), amount: -settings.amount });
      totalInvested += settings.amount;
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
      mode: settings.mode,
      amount: settings.amount,
      startIso,
      requestedStartIso,
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
