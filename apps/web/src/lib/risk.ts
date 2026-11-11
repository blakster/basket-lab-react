import type { NavPoint, TimePoint } from "../types";

export type CashflowSpec = {
  mode: "lumpsum" | "sip";
  amount: number;
  startIso: string;
};

export type DatedReturn = { date: string; r: number };

export type RollingWindow = { min: number; median: number; max: number };

export type AlphaBeta = { alpha: number; beta: number };

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function yearsBetween(a: string, b: string): number {
  return (parseDay(b).getTime() - parseDay(a).getTime()) / (365.25 * 86_400_000);
}

function isFinitePositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/** Daily time-weighted returns. SIP cash is stripped: `y_t / (y_{t-1} + sip_t) - 1`. */
export function dailyTwrs(
  series: TimePoint[],
  cashflow?: CashflowSpec,
): DatedReturn[] {
  if (series.length < 2) return [];

  const sip = cashflow?.mode === "sip";
  const amount = cashflow?.amount ?? 0;
  let nextSip = sip && cashflow ? parseDay(cashflow.startIso) : null;
  let sipCount = 0;
  const out: DatedReturn[] = [];

  for (let i = 0; i < series.length; i++) {
    const curr = series[i]!;
    let add = 0;
    if (nextSip && cashflow) {
      const day = parseDay(curr.x);
      if (day >= nextSip) {
        add = amount;
        sipCount += 1;
        nextSip = parseDay(cashflow.startIso);
        nextSip.setMonth(nextSip.getMonth() + sipCount);
      }
    }
    if (i === 0) continue;
    const prev = series[i - 1]!;
    const base = prev.y + add;
    if (
      !Number.isFinite(prev.y) ||
      !Number.isFinite(curr.y) ||
      !Number.isFinite(base) ||
      base === 0
    ) {
      continue;
    }
    const r = curr.y / base - 1;
    if (!Number.isFinite(r)) continue;
    out.push({ date: curr.x, r });
  }
  return out;
}

export function navToTwrs(navs: NavPoint[]): DatedReturn[] {
  return dailyTwrs(navs.map((p) => ({ x: p.date, y: p.nav, drawdown: 0 })));
}

function sampleStdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  let sq = 0;
  for (const v of values) {
    const d = v - mean;
    sq += d * d;
  }
  const stdev = Math.sqrt(sq / (values.length - 1));
  if (stdev === 0 || !Number.isFinite(stdev)) return null;
  return stdev;
}

/** Annualized sample volatility in percent. `null` if stdev is 0. */
export function volatilityFromTwrs(twrs: number[]): number | null {
  const stdev = sampleStdev(twrs);
  if (stdev == null) return null;
  const vol = stdev * Math.sqrt(252) * 100;
  return Number.isFinite(vol) ? vol : null;
}

/** Annualized Sharpe from daily TWRs. `rfAnnual` is a decimal (0.065 = 6.5%). */
export function sharpeFromTwrs(twrs: number[], rfAnnual = 0): number | null {
  if (twrs.length < 2) return null;
  const rfDaily = rfAnnual / 252;
  const excess = twrs.map((r) => r - rfDaily);
  const mean = excess.reduce((a, v) => a + v, 0) / excess.length;
  const stdev = sampleStdev(excess);
  if (stdev == null) return null;
  const sharpe = (Math.sqrt(252) * mean) / stdev;
  return Number.isFinite(sharpe) ? sharpe : null;
}

/** Annualized Sortino. Downside = `r < 0` (or `r < rfDaily`). No downsides → `null`. */
export function sortinoFromTwrs(twrs: number[], rfAnnual = 0): number | null {
  if (twrs.length < 2) return null;
  const rfDaily = rfAnnual / 252;
  const excess = twrs.map((r) => r - rfDaily);
  const mean = excess.reduce((a, v) => a + v, 0) / excess.length;
  let downSq = 0;
  let downs = 0;
  for (const r of twrs) {
    const d = Math.min(r - rfDaily, 0);
    if (d < 0) {
      downSq += d * d;
      downs += 1;
    }
  }
  if (downs === 0) return null;
  const downDev = Math.sqrt(downSq / twrs.length);
  if (downDev === 0 || !Number.isFinite(downDev)) return null;
  const sortino = (Math.sqrt(252) * mean) / downDev;
  return Number.isFinite(sortino) ? sortino : null;
}

/** CAGR% / |MDD%|. `null` when drawdown is 0. */
export function calmar(cagrPct: number, mddPct: number): number | null {
  const absDd = Math.abs(mddPct);
  if (absDd === 0 || !Number.isFinite(absDd) || !Number.isFinite(cagrPct)) {
    return null;
  }
  const value = cagrPct / absDd;
  return Number.isFinite(value) ? value : null;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Rolling window CAGRs as percents, from a TWR wealth index.
 * `windowDays` is the number of daily returns in each window.
 */
export function rollingCagr(
  series: TimePoint[],
  twrs: DatedReturn[],
  windowDays: number,
): RollingWindow | null {
  if (windowDays < 1 || series.length < windowDays + 1 || twrs.length < windowDays) {
    return null;
  }

  const byDate = new Map(twrs.map((t) => [t.date, t.r]));
  const wealth: { date: string; w: number }[] = [];
  let w = 1;
  wealth.push({ date: series[0]!.x, w });
  for (let i = 1; i < series.length; i++) {
    const r = byDate.get(series[i]!.x);
    if (r == null || !Number.isFinite(r)) continue;
    w *= 1 + r;
    if (!Number.isFinite(w) || w <= 0) return null;
    wealth.push({ date: series[i]!.x, w });
  }
  if (wealth.length < windowDays + 1) return null;

  const cagrs: number[] = [];
  for (let i = 0; i + windowDays < wealth.length; i++) {
    const start = wealth[i]!;
    const end = wealth[i + windowDays]!;
    const years = yearsBetween(start.date, end.date);
    if (years <= 0 || !isFinitePositive(start.w)) continue;
    const cagr = (Math.pow(end.w / start.w, 1 / years) - 1) * 100;
    if (Number.isFinite(cagr)) cagrs.push(cagr);
  }
  if (!cagrs.length) return null;
  const sorted = [...cagrs].sort((a, b) => a - b);
  return {
    min: sorted[0]!,
    median: median(sorted),
    max: sorted[sorted.length - 1]!,
  };
}

function align(
  a: DatedReturn[],
  b: DatedReturn[],
): { xa: number[]; xb: number[] } | null {
  const bMap = new Map(b.map((p) => [p.date, p.r]));
  const xa: number[] = [];
  const xb: number[] = [];
  for (const p of a) {
    const br = bMap.get(p.date);
    if (br == null) continue;
    xa.push(p.r);
    xb.push(br);
  }
  if (xa.length < 2) return null;
  return { xa, xb };
}

function covariance(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += (xs[i]! - mx) * (ys[i]! - my);
  }
  return sum / (xs.length - 1);
}

/** Jensen alpha (annualized %, rf = 0) and beta vs a benchmark TWR series. */
export function alphaBeta(
  basket: DatedReturn[],
  bench: DatedReturn[],
): AlphaBeta | null {
  const aligned = align(basket, bench);
  if (!aligned) return null;
  const { xa, xb } = aligned;
  const varB = sampleStdev(xb);
  if (varB == null) return null;
  const cov = covariance(xa, xb);
  if (cov == null) return null;
  const varBench = varB * varB;
  if (varBench === 0) return null;
  const beta = cov / varBench;
  const meanA = xa.reduce((s, v) => s + v, 0) / xa.length;
  const meanB = xb.reduce((s, v) => s + v, 0) / xb.length;
  const alpha = (meanA - beta * meanB) * 252 * 100;
  if (!Number.isFinite(alpha) || !Number.isFinite(beta)) return null;
  return { alpha, beta };
}

export function correlation(
  a: DatedReturn[],
  b: DatedReturn[],
): number | null {
  const aligned = align(a, b);
  if (!aligned) return null;
  const { xa, xb } = aligned;
  const sa = sampleStdev(xa);
  const sb = sampleStdev(xb);
  if (sa == null || sb == null) return null;
  const cov = covariance(xa, xb);
  if (cov == null) return null;
  const corr = cov / (sa * sb);
  return Number.isFinite(corr) ? corr : null;
}
