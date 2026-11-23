import { calculateXirr } from "../backtest/xirr";
import type { NavPoint } from "../../types";
import type { PortfolioTransaction } from "../api/portfolio";

export type Position = {
  instrumentId: string;
  units: number;
  invested: number;
  proceeds: number;
  income: number;
  firstDate: string | null;
  lastDate: string | null;
};

export type PortfolioTotals = {
  invested: number;
  currentValue: number;
  proceeds: number;
  income: number;
  gain: number;
  gainPct: number | null;
  xirr: number | null;
};

const UNIT_IN = new Set(["buy", "sip", "switch-in", "dividend"]);
const UNIT_OUT = new Set(["sell", "switch-out"]);
const CASH_IN = new Set(["buy", "sip", "switch-in"]);
const CASH_OUT = new Set(["sell", "switch-out"]);

// casparser keeps the statement's sign (redemptions are negative); units held
// always move by the absolute amount, direction comes from the kind.
function unitDelta(tx: PortfolioTransaction): number {
  if (UNIT_OUT.has(tx.kind)) return -Math.abs(tx.units);
  if (UNIT_IN.has(tx.kind)) return Math.abs(tx.units);
  return 0;
}

// casparser maps dividend payouts and reinvestments to the same kind; a payout
// carries no units, a reinvestment buys units with the dividend amount.
export function isDividendPayout(tx: PortfolioTransaction): boolean {
  return tx.kind === "dividend" && tx.units === 0;
}

export function buildPositions(
  transactions: PortfolioTransaction[],
): Map<string, Position> {
  const positions = new Map<string, Position>();
  for (const tx of transactions) {
    let p = positions.get(tx.instrumentId);
    if (!p) {
      p = {
        instrumentId: tx.instrumentId,
        units: 0,
        invested: 0,
        proceeds: 0,
        income: 0,
        firstDate: tx.date,
        lastDate: tx.date,
      };
      positions.set(tx.instrumentId, p);
    }
    p.units += unitDelta(tx);
    if (CASH_IN.has(tx.kind)) p.invested += tx.amount;
    else if (CASH_OUT.has(tx.kind)) p.proceeds += tx.amount;
    else if (isDividendPayout(tx)) p.income += tx.amount;
    if (p.firstDate === null || tx.date < p.firstDate) p.firstDate = tx.date;
    if (p.lastDate === null || tx.date > p.lastDate) p.lastDate = tx.date;
  }
  return positions;
}

export function unitsByInstrument(
  transactions: PortfolioTransaction[],
): Map<string, { dates: string[]; deltas: number[]; total: number }> {
  const grouped = new Map<string, PortfolioTransaction[]>();
  for (const tx of transactions) {
    const list = grouped.get(tx.instrumentId);
    if (list) list.push(tx);
    else grouped.set(tx.instrumentId, [tx]);
  }
  const out = new Map<string, { dates: string[]; deltas: number[]; total: number }>();
  for (const [id, txs] of grouped) {
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const dates: string[] = [];
    const deltas: number[] = [];
    let units = 0;
    for (const tx of sorted) {
      units += unitDelta(tx);
      dates.push(tx.date);
      deltas.push(units);
    }
    out.set(id, { dates, deltas, total: units });
  }
  return out;
}

function cashflowsFor(
  transactions: PortfolioTransaction[],
  instrumentId?: string,
): { date: string; amount: number }[] {
  const byDate = new Map<string, number>();
  for (const tx of transactions) {
    if (instrumentId && tx.instrumentId !== instrumentId) continue;
    let amount = 0;
    if (CASH_IN.has(tx.kind)) amount = -tx.amount;
    else if (CASH_OUT.has(tx.kind)) amount = tx.amount;
    else if (isDividendPayout(tx)) amount = tx.amount;
    if (amount === 0) continue;
    byDate.set(tx.date, (byDate.get(tx.date) ?? 0) + amount);
  }
  return [...byDate.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function xirrPercent(
  transactions: PortfolioTransaction[],
  currentValue: number,
  asOf: string,
  instrumentId?: string,
): number | null {
  const flows = cashflowsFor(transactions, instrumentId);
  if (currentValue > 0) flows.push({ date: asOf, amount: currentValue });
  if (flows.length < 2) return null;
  // XIRR annualizes over time; same-day flows have no defined rate.
  if (new Set(flows.map((f) => f.date)).size < 2) return null;
  return calculateXirr(flows.map((f) => ({ date: new Date(f.date), amount: f.amount })));
}

export function portfolioTotals(
  transactions: PortfolioTransaction[],
  positions: Map<string, Position>,
  values: Map<string, number>,
  asOf: string,
): PortfolioTotals {
  // Switches move value between funds, not new money: they stay out of
  // invested and proceeds so the totals reflect external cash only.
  let invested = 0;
  let proceeds = 0;
  let income = 0;
  let currentValue = 0;
  for (const tx of transactions) {
    if (tx.kind === "buy" || tx.kind === "sip") invested += tx.amount;
    else if (tx.kind === "sell") proceeds += tx.amount;
    else if (isDividendPayout(tx)) income += tx.amount;
  }
  for (const p of positions.values()) currentValue += values.get(p.instrumentId) ?? 0;
  const gain = currentValue + proceeds + income - invested;
  return {
    invested,
    currentValue,
    proceeds,
    income,
    gain,
    gainPct: invested > 0 ? (gain / invested) * 100 : null,
    xirr: xirrPercent(transactions, currentValue, asOf),
  };
}

// Latest NAV on or before `date` from a sorted series.
function navAt(points: NavPoint[], date: string): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? points[ans].nav : null;
}

export function growthSeries(
  transactions: PortfolioTransaction[],
  navByCode: Map<string, NavPoint[]>,
  codeByInstrument: Map<string, string>,
  snapshotValue: Map<string, { date: string; value: number }>,
  firstTxDateByInstrument: Map<string, string>,
  maxPoints = 120,
): { date: string; value: number }[] {
  const units = unitsByInstrument(transactions);
  const dates = new Set<string>();
  for (const points of navByCode.values())
    for (const p of points) dates.add(p.date);
  let sortedDates = [...dates].sort();
  if (sortedDates.length === 0) {
    // No NAV history anywhere: sample the statement's own dates so
    // snapshot-valued funds still get a flat growth line.
    for (const t of transactions) dates.add(t.date);
    for (const s of snapshotValue.values()) dates.add(s.date);
    sortedDates = [...dates].sort();
    if (sortedDates.length === 0) return [];
  }
  const stride = Math.max(1, Math.ceil(sortedDates.length / maxPoints));
  const samples = sortedDates.filter((_, i) => i % stride === 0);
  if (samples[samples.length - 1] !== sortedDates[sortedDates.length - 1])
    samples.push(sortedDates[sortedDates.length - 1]);

  // Per instrument: NAV-backed (schemeCode with series) or snapshot fallback.
  const series: {
    dates: string[];
    deltas: number[];
    points: NavPoint[] | null;
    fallback: { date: string; value: number } | null;
    firstTx: string | null;
  }[] = [];
  for (const [id, u] of units) {
    const code = codeByInstrument.get(id);
    const points = code ? navByCode.get(code) ?? null : null;
    series.push({
      dates: u.dates,
      deltas: u.deltas,
      points: points && points.length > 0 ? points : null,
      fallback: snapshotValue.get(id) ?? null,
      firstTx: firstTxDateByInstrument.get(id) ?? null,
    });
  }

  const out: { date: string; value: number }[] = [];
  for (const date of samples) {
    let value = 0;
    for (const s of series) {
      // Units held at `date`: last cumulative delta on or before it.
      let unitsHeld = 0;
      let lo = 0;
      let hi = s.dates.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (s.dates[mid] <= date) {
          idx = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (idx >= 0) unitsHeld = s.deltas[idx];
      if (unitsHeld <= 0) continue;
      if (s.points) {
        const nav = navAt(s.points, date);
        if (nav !== null) value += unitsHeld * nav;
      } else if (s.fallback && s.firstTx && date >= s.firstTx) {
        // No NAV series: hold the statement's latest valuation flat.
        value += s.fallback.value;
      }
    }
    out.push({ date, value });
  }
  return out;
}
