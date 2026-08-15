import type { BacktestResult } from "../types";

export type YearlyRankEntry = { basketId: string; ret: number };
export type YearlyRank = { year: number; order: YearlyRankEntry[] };

function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** Calendar-year return from first to last series point in that year. */
export function yearlyRanking(results: BacktestResult[]): YearlyRank[] {
  const years = new Set<number>();
  for (const r of results) {
    for (const p of r.series) years.add(yearOf(p.x));
  }

  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const order: YearlyRankEntry[] = [];
      for (const r of results) {
        if (r.error === "no-nav" || r.series.length === 0) continue;
        const inYear = r.series.filter((p) => yearOf(p.x) === year);
        if (inYear.length === 0) continue;
        const firstY = inYear[0].y;
        const lastY = inYear[inYear.length - 1].y;
        if (firstY === 0) continue;
        order.push({ basketId: r.basketId, ret: (lastY / firstY - 1) * 100 });
      }
      order.sort((a, b) => b.ret - a.ret);
      return { year, order };
    });
}
