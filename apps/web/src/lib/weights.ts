import type { FundLine } from "../types";

/** Round to 2 decimal places. */
function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

/**
 * Apply a weight change to one fund; unlocked others absorb overflow so the
 * sum stays near 100. Locked weights never change. Weights are ≥ 0.
 *
 * Port of basket-lab `handleWeightChange`: clamp `next` to
 * `[0, 100 - otherLocked]`, set the target, then proportionally scale unlocked
 * others when the total overflows 100.
 */
export function applyWeightChange(
  funds: FundLine[],
  id: string,
  next: number,
): FundLine[] {
  const result = funds.map((f) => ({ ...f }));
  const target = result.find((f) => f.schemeCode === id);
  if (!target) return result;

  const otherLocked = result
    .filter((f) => f.schemeCode !== id && f.locked)
    .reduce((sum, f) => sum + f.weight, 0);
  const maxAllowed = 100 - otherLocked;
  let value = Number.isFinite(next) ? next : 0;
  value = Math.max(0, Math.min(maxAllowed, value));
  value = round2(value);

  target.weight = value;

  const currentTotal = result.reduce((sum, f) => sum + f.weight, 0);
  const overflow = currentTotal - 100;
  const unlockedOthers = result.filter(
    (f) => f.schemeCode !== id && !f.locked,
  );

  if (Math.abs(overflow) > 0.01 && unlockedOthers.length > 0) {
    const totalUnlockedWeight = unlockedOthers.reduce(
      (sum, f) => sum + f.weight,
      0,
    );
    if (totalUnlockedWeight > 0) {
      for (const f of unlockedOthers) {
        const proportion = f.weight / totalUnlockedWeight;
        f.weight = round2(Math.max(0, f.weight - overflow * proportion));
      }
    } else if (overflow < 0) {
      const share = Math.abs(overflow) / unlockedOthers.length;
      for (const f of unlockedOthers) {
        f.weight = round2(f.weight + share);
      }
    }
  }

  return result;
}
