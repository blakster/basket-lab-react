import type { BacktestResult, LabSettings } from "../types";

/** True when `results` were computed for a different mode, amount, or start. */
export function runIsStale(
  results: BacktestResult[],
  settings: LabSettings,
  start: string,
): boolean {
  return results.some((r) => {
    const cf = r.cashflow;
    if (!cf) return false;
    const runStart = cf.requestedStartIso ?? cf.startIso;
    return (
      cf.mode !== settings.mode ||
      cf.amount !== settings.amount ||
      runStart !== start
    );
  });
}
