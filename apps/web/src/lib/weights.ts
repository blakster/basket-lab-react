import type { FundLine } from "../types";

/** One percent-point cent. round2 quantum. Distinct from WEIGHT_TOLERANCE. */
export const WEIGHT_CENT = 0.01;

/** Basket-valid window around 100%. Distinct from WEIGHT_CENT. */
export const WEIGHT_TOLERANCE = 0.1;

export function hasWeightOverflow(overflow: number): boolean {
  return Math.abs(overflow) > WEIGHT_CENT;
}

export function isWeightBalanced(sum: number): boolean {
  return Math.abs(sum - 100) < WEIGHT_TOLERANCE;
}

export type WeightDraft =
  | { status: "empty" }
  | { status: "partial"; text: string }
  | { status: "value"; text: string; value: number }
  | { status: "invalid" };

/** Read a weight field without turning "" or "00" into a committed 0. */
export function readWeightDraft(raw: string): WeightDraft {
  if (raw === "") return { status: "empty" };
  if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(raw)) return { status: "invalid" };
  if (raw === "." || raw.endsWith(".") || /^0\d/.test(raw)) {
    return { status: "partial", text: raw };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return { status: "invalid" };
  return { status: "value", text: raw, value };
}

export function weightFromDraft(raw: string): number {
  const draft = readWeightDraft(raw);
  if (draft.status === "value") return draft.value;
  if (draft.status === "partial") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

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

  if (hasWeightOverflow(overflow) && unlockedOthers.length > 0) {
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
