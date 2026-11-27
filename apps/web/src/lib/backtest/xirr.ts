type Cashflow = { date: Date; amount: number };

const MIN_RATE = -0.9999;
const MAX_RATE = 100;

/**
 * Newton-Raphson XIRR with rate-step + residual verification and bracketed
 * bisection fallback. Returns null when cashflows do not bracket a valid rate.
 */
export function calculateXirrSafe(txns: Cashflow[]): number | null {
  if (txns.length < 2) return null;

  const hasPos = txns.some((t) => t.amount > 0);
  const hasNeg = txns.some((t) => t.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const t0 = txns[0]!.date.getTime();
  const years = txns.map((t) => (t.date.getTime() - t0) / (365.25 * 86400000));
  if (years.every((y) => y === 0)) return null;

  const scale = Math.max(
    txns.reduce((max, t) => Math.max(max, Math.abs(t.amount)), 0),
    1e-12,
  );
  const residualTol = 1e-6 * scale;

  const npv = (r: number) =>
    txns.reduce((sum, t, i) => sum + t.amount / Math.pow(1 + r, years[i]!), 0);

  const dnpv = (r: number) =>
    txns.reduce(
      (sum, t, i) =>
        sum - (years[i]! * t.amount) / Math.pow(1 + r, years[i]! + 1),
      0,
    );

  // Fast path: Newton-Raphson requiring rate convergence (not just coarse NPV).
  let rate = 0.1;
  let converged = false;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const df = dnpv(rate);
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-15) {
      break;
    }
    const next = rate - f / df;
    const clamped = Math.min(MAX_RATE, Math.max(MIN_RATE, next));
    const step = Math.abs(clamped - rate);
    rate = clamped;
    if (step < 1e-9) {
      converged = true;
      break;
    }
  }
  const finalNpv = npv(rate);
  if (converged && Number.isFinite(finalNpv) && Math.abs(finalNpv) <= residualTol) {
    return rate * 100;
  }

  // Fallback: bracketed bisection across the full [MIN_RATE, MAX_RATE] range,
  // narrowing until rate precision is tighter than display precision.
  const grid = [
    MIN_RATE,
    -0.999,
    -0.95,
    -0.75,
    -0.5,
    -0.25,
    0,
    0.1,
    0.25,
    0.5,
    1,
    2,
    5,
    10,
    50,
    MAX_RATE,
  ];
  for (let i = 0; i < grid.length - 1; i++) {
    let lo = grid[i]!;
    let hi = grid[i + 1]!;
    let fLo = npv(lo);
    let fHi = npv(hi);
    if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) continue;
    if (fLo === 0) return lo * 100;
    if (fHi === 0) return hi * 100;
    if (fLo * fHi > 0) continue;
    for (let step = 0; step < 80; step++) {
      const mid = (lo + hi) / 2;
      const fMid = npv(mid);
      if (!Number.isFinite(fMid)) break;
      if (fMid === 0 || hi - lo < 1e-7) return mid * 100;
      if (fLo * fMid <= 0) {
        hi = mid;
        fHi = fMid;
      } else {
        lo = mid;
        fLo = fMid;
      }
    }
    return ((lo + hi) / 2) * 100;
  }

  return null;
}

/**
 * Newton-Raphson XIRR as a percent (0 when cashflows cannot be annualized).
 */
export function calculateXirr(txns: Cashflow[]): number {
  return calculateXirrSafe(txns) ?? 0;
}
