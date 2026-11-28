import { calculateXirrSafe } from "../backtest/xirr";
import type { NavPoint } from "../../types";
import type { PortfolioSnapshot, PortfolioTransaction } from "../api/portfolio";

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
  invested: number | null;
  currentValue: number;
  proceeds: number;
  income: number;
  gain: number | null;
  gainPct: number | null;
  xirr: number | null;
};

// CAS statements round units to 3 decimals, so a closing balance can differ
// from the summed transactions by a few hundredths; anything beyond this is a
// real opening balance (or an inconsistency) the statement does not describe.
export const OPENING_TOLERANCE = 0.05;
// Float sums of fractional units (0.3 − 0.1 − 0.2) land within 1e-16 of zero;
// only a clearly negative balance means unknown purchases.
const UNIT_EPSILON = 1e-6;

export type HoldingCoverage = { heldUnits: number; covered: boolean };

// A registrar CAS files a folio as `<rta>:<folio>`; a depository CAS files
// the same mutual fund folio as `<issuer>:folio:<folio>`. Both name one
// real-world position, so holdings math groups them and counts units once.
export function folioGroupKey(accountId: string): string {
  const registrar = /^(?:cams|kfintech):(.+)$/.exec(accountId);
  if (registrar) return `folio:${registrar[1].trim()}`;
  const depository = /^(?:cdsl|nsdl):folio:(.+)$/.exec(accountId);
  if (depository) return `folio:${depository[1].trim()}`;
  return accountId;
}

// A statement snapshot is authoritative only up to its own date: current
// units are its closing units plus any later transactions (hand-entered or
// from a newer statement). Coverage compares only the statement period, so a
// manual trade after the statement never reads as a missing opening balance.
export function holdingsFromStatements(
  transactions: PortfolioTransaction[],
  snapshots: PortfolioSnapshot[],
): Map<string, HoldingCoverage> {
  const snapsByInstrument = new Map<string, Map<string, { date: string; units: number }>>();
  for (const snap of snapshots) {
    let accounts = snapsByInstrument.get(snap.instrumentId);
    if (!accounts) {
      accounts = new Map();
      snapsByInstrument.set(snap.instrumentId, accounts);
    }
    const prev = accounts.get(snap.accountId);
    if (!prev || snap.date > prev.date) {
      accounts.set(snap.accountId, { date: snap.date, units: snap.units });
    }
  }
  const movesByInstrument = new Map<string, Map<string, { date: string; delta: number }[]>>();
  for (const tx of transactions) {
    let accounts = movesByInstrument.get(tx.instrumentId);
    if (!accounts) {
      accounts = new Map();
      movesByInstrument.set(tx.instrumentId, accounts);
    }
    const list = accounts.get(tx.accountId);
    const move = { date: tx.date, delta: unitDelta(tx) };
    if (list) list.push(move);
    else accounts.set(tx.accountId, [move]);
  }
  for (const accounts of movesByInstrument.values()) {
    for (const list of accounts.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  }

  const out = new Map<string, HoldingCoverage>();
  const instruments = new Set([...snapsByInstrument.keys(), ...movesByInstrument.keys()]);
  for (const id of instruments) {
    const snaps = snapsByInstrument.get(id) ?? new Map<string, { date: string; units: number }>();
    const moves = movesByInstrument.get(id) ?? new Map<string, { date: string; delta: number }[]>();
    const accounts = new Set([...snaps.keys(), ...moves.keys()]);
    // Registrar and depository statements can report the same folio; merge
    // those accounts so the position counts once, with the freshest snapshot
    // and every trade either source recorded.
    const groups = new Map<string, string[]>();
    for (const accountId of accounts) {
      const key = folioGroupKey(accountId);
      const group = groups.get(key);
      if (group) group.push(accountId);
      else groups.set(key, [accountId]);
    }
    let heldUnits = 0;
    let covered = true;
    for (const group of groups.values()) {
      let snap: { date: string; units: number } | undefined;
      let snapHasMoves = false;
      for (const accountId of group) {
        const candidate = snaps.get(accountId);
        if (!candidate) continue;
        const hasMoves = (moves.get(accountId) ?? []).length > 0;
        if (
          !snap ||
          candidate.date > snap.date ||
          (candidate.date === snap.date && hasMoves && !snapHasMoves)
        ) {
          snap = candidate;
          snapHasMoves = hasMoves;
        }
      }
      const list = group
        .flatMap((accountId) => moves.get(accountId) ?? [])
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!snap) {
        heldUnits += list.reduce((sum, m) => sum + m.delta, 0);
        continue;
      }
      let inPeriod = 0;
      let after = 0;
      for (const m of list) {
        if (m.date <= snap.date) inPeriod += m.delta;
        else after += m.delta;
      }
      if (Math.abs(snap.units - inPeriod) > OPENING_TOLERANCE) covered = false;
      heldUnits += snap.units + after;
    }
    // Selling more units than statements and entries account for means
    // missing purchases, so proceeds are not profit. Judged per instrument:
    // a hand-entered redemption sits in the manual account while its purchases
    // sit in the statement account. Unit floats carry rounding noise.
    if (heldUnits < -UNIT_EPSILON) covered = false;
    out.set(id, { heldUnits, covered });
  }
  return out;
}

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
  return calculateXirrSafe(flows.map((f) => ({ date: new Date(f.date), amount: f.amount })));
}

export function portfolioTotals(
  transactions: PortfolioTransaction[],
  positions: Map<string, Position>,
  values: Map<string, number>,
  asOf: string,
  complete = true,
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
  // Without the opening balance, invested and gain are unknowable: the
  // statement only covers part of the holding period.
  const gain = complete ? currentValue + proceeds + income - invested : null;
  return {
    invested: complete ? invested : null,
    currentValue,
    proceeds,
    income,
    gain,
    gainPct: complete && gain !== null && invested > 0 ? (gain / invested) * 100 : null,
    xirr: complete ? xirrPercent(transactions, currentValue, asOf) : null,
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
