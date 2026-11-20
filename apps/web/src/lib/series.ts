import type { BacktestResult, Basket, NavPoint } from "../types";

/** Earliest date in a NAV series. */
export function firstIso(points: NavPoint[]): string {
  return points.reduce((a, p) => (p.date < a ? p.date : a), points[0].date);
}

/** Latest date in a NAV series. */
export function lastIso(points: NavPoint[]): string {
  return points.reduce((a, p) => (p.date > a ? p.date : a), points[0].date);
}

/** Shift an ISO date-only string by whole calendar days. Uses local time so a
day skipped by a zone (e.g. Apia's 2011-12-30 dateline jump) lands on the next
real day, matching the benchmark cutoff's original semantics. */
export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Stable chart series key for a basket id. */
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
