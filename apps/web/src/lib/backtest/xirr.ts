type Cashflow = { date: Date; amount: number };

/**
 * Newton–Raphson XIRR as a percent.
 * Years use 365.25-day basis; rate clamped to (-0.99, 10).
 */
export function calculateXirr(txns: Cashflow[]): number {
  if (txns.length < 2) return 0;

  const t0 = txns[0].date.getTime();
  const years = txns.map((t) => (t.date.getTime() - t0) / (365.25 * 86400000));

  const npv = (r: number) =>
    txns.reduce((sum, t, i) => sum + t.amount / Math.pow(1 + r, years[i]), 0);

  const dnpv = (r: number) =>
    txns.reduce(
      (sum, t, i) =>
        sum - (years[i] * t.amount) / Math.pow(1 + r, years[i] + 1),
      0,
    );

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const df = dnpv(rate);
    if (Math.abs(df) < 1e-12) break;
    const next = rate - f / df;
    const clamped = Math.min(10, Math.max(-0.99, next));
    if (Math.abs(clamped - rate) < 1e-9) {
      rate = clamped;
      break;
    }
    rate = clamped;
  }

  return rate * 100;
}
