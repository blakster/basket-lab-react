import type { BacktestResult, Basket, NavPoint } from "../types";

export function firstIso(points: NavPoint[]): string {
  return points.reduce((a, p) => (p.date < a ? p.date : a), points[0].date);
}

/** Sorted in-range dates from every weighted fund. Not the first Object.values entry. */
export function navDatesInRange(
  funds: { schemeCode: string; weight: number }[],
  navs: Record<string, NavPoint[]>,
  startIso: string,
  endIso: string,
): string[] {
  const days = new Set<string>();
  for (const fund of funds) {
    if (fund.weight <= 0) continue;
    for (const point of navs[fund.schemeCode] ?? []) {
      if (point.date >= startIso && point.date <= endIso) days.add(point.date);
    }
  }
  return [...days].sort();
}

export function lastIso(points: NavPoint[]): string {
  return points.reduce((a, p) => (p.date > a ? p.date : a), points[0].date);
}

export function seriesKey(id: string): string {
  return `b_${id.replace(/[^a-zA-Z0-9]/g, "")}`;
}

/** Sorted union of series dates across results; no-nav results add none. */
export function unionDates(results: BacktestResult[]): string[] {
  const dates = new Set<string>();
  for (const r of results) {
    if (r.error === "no-nav") continue;
    for (const p of r.series) dates.add(p.x);
  }
  return [...dates].sort();
}

/** Add `months` to `base` without overflowing month-end dates (Jan 31 + 1m -> Feb 28/29). */
export function addMonthsClamped(base: Date, months: number): Date {
  const totalMonths = base.getFullYear() * 12 + base.getMonth() + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const maxDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(base.getDate(), maxDay));
}

/** Per-basket map: only that basket's codes, empty series omitted. */
export function navsForBasket(
  basket: Basket,
  navs: Record<string, NavPoint[]>,
): Record<string, NavPoint[]> {
  const subset: Record<string, NavPoint[]> = {};
  for (const f of basket.funds) {
    if (f.weight <= 0) continue;
    const series = navs[f.schemeCode];
    if (series?.length) subset[f.schemeCode] = series;
  }
  return subset;
}
