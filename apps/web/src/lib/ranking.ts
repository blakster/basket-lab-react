import type { BacktestResult } from "../types";
import { dailyTwrs, type CashflowSpec } from "./risk";

export type YearlyRankEntry = { basketId: string; ret: number };
export type YearKind = "full" | "partial" | "ytd";
export type YearlyRank = { year: number; kind: YearKind; order: YearlyRankEntry[] };

function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

function compoundPct(returns: number[]): number {
  let wealth = 1;
  for (const r of returns) wealth *= 1 + r;
  return (wealth - 1) * 100;
}

// NAV series carry trading days only, so "covered" tolerates weekend/holiday
// drift: a run covering a year starts within January's first days and ends
// within December's last days. Month-day comparison keeps mid-month starts
// and ends from passing as full.
const FULL_START_MM_DD = "01-05";
const FULL_END_MM_DD = "12-27";

function yearKind(year: number, firstIso: string, lastIso: string): YearKind {
  const startsHere =
    yearOf(firstIso) === year && firstIso.slice(5, 10) > FULL_START_MM_DD;
  const endsHere =
    yearOf(lastIso) === year && lastIso.slice(5, 10) < FULL_END_MM_DD;
  if (endsHere) return "ytd";
  if (startsHere) return "partial";
  return "full";
}

/** Calendar-year time-weighted return. SIP cash is stripped via `dailyTwrs`. */
export function yearlyRanking(
  results: BacktestResult[],
  cashflow?: CashflowSpec,
): YearlyRank[] {
  const years = new Set<number>();
  let firstIso = "";
  let lastIso = "";
  for (const r of results) {
    for (const p of r.series) {
      years.add(yearOf(p.x));
      if (!firstIso || p.x < firstIso) firstIso = p.x;
      if (!lastIso || p.x > lastIso) lastIso = p.x;
    }
  }

  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const order: YearlyRankEntry[] = [];
      for (const r of results) {
        if (r.error === "no-nav" || r.series.length === 0) continue;
        const inYear = dailyTwrs(r.series, r.cashflow ?? cashflow).filter(
          (t) => yearOf(t.date) === year,
        );
        if (inYear.length === 0) continue;
        order.push({
          basketId: r.basketId,
          ret: compoundPct(inYear.map((t) => t.r)),
        });
      }
      order.sort((a, b) => b.ret - a.ret);
      return { year, kind: yearKind(year, firstIso, lastIso), order };
    })
    .filter((row) => row.order.length > 0);
}
