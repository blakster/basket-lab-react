import type { TimePoint } from "../types";

/**
 * Annualized Sharpe from a portfolio value series.
 * Daily returns, sample stdev, `sqrt(252) * mean / stdev`.
 * `null` if fewer than 3 points or stdev is 0 (never emit 0 as fake Sharpe).
 */
export function sharpeFromSeries(
  series: TimePoint[],
  rfAnnual = 0,
): number | null {
  if (series.length < 3) return null;

  const returns: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!.y;
    const curr = series[i]!.y;
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) {
      continue;
    }
    returns.push(curr / prev - 1);
  }
  if (returns.length < 2) return null;

  const rfDaily = rfAnnual / 252;
  let sum = 0;
  for (const r of returns) sum += r - rfDaily;
  const mean = sum / returns.length;

  let sq = 0;
  for (const r of returns) {
    const d = r - rfDaily - mean;
    sq += d * d;
  }
  const stdev = Math.sqrt(sq / (returns.length - 1));
  if (stdev === 0 || !Number.isFinite(stdev)) return null;

  const sharpe = (Math.sqrt(252) * mean) / stdev;
  return Number.isFinite(sharpe) ? sharpe : null;
}
