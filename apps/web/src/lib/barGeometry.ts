/** Shrink a bar's signed length toward the baseline without flipping its sign. */
export function insetSigned(size: number, inset: number): number {
  if (size >= 0) return Math.max(0, size - inset);
  return Math.min(0, size + inset);
}
