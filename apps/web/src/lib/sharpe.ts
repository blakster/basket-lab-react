import type { TimePoint } from "../types";
import {
  dailyTwrs,
  sharpeFromTwrs,
  type CashflowSpec,
} from "./risk";

export type { CashflowSpec };

/**
 * Annualized Sharpe from a portfolio value series.
 * Daily TWR, sample stdev, `sqrt(252) * mean / stdev`.
 * `null` if fewer than 3 points or stdev is 0 (never emit 0 as fake Sharpe).
 */
export function sharpeFromSeries(
  series: TimePoint[],
  rfAnnual = 0,
  cashflow?: CashflowSpec,
): number | null {
  if (series.length < 3) return null;
  return sharpeFromTwrs(
    dailyTwrs(series, cashflow).map((d) => d.r),
    rfAnnual,
  );
}
