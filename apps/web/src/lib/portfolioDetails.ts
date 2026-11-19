import type { BacktestResult, Basket, NavPoint } from "../types";
import type {
  EquitySplit,
  InsightHolding,
  OverlapName,
} from "./api/insights";
import { backtestPlan } from "./backtest/performance";
import { shiftIso } from "./series";

export type GrowthSplit = {
  invested: number;
  current: number;
  gain: number;
  absPct: number;
  rate: number;
  rateLabel: "CAGR" | "XIRR";
};

export function growthFromResult(
  result: BacktestResult | undefined,
  mode: "lumpsum" | "sip",
): GrowthSplit | null {
  if (!result || result.error === "no-nav") return null;
  const invested = result.stats.initial;
  const current = result.stats.final;
  if (!Number.isFinite(invested) || !Number.isFinite(current) || invested <= 0) {
    return null;
  }
  return {
    invested,
    current,
    gain: current - invested,
    absPct: result.stats.abs,
    rate: result.stats.cagr,
    rateLabel: mode === "sip" ? "XIRR" : "CAGR",
  };
}

const BENCH_CODE = "__bench";

const BENCH_BASKET: Basket = {
  id: "__bench",
  name: "Benchmark",
  color: "#000000",
  active: true,
  funds: [
    {
      schemeCode: BENCH_CODE,
      schemeName: "Benchmark",
      isin: null,
      weight: 100,
      locked: false,
    },
  ],
};

/** Benchmark NAV may start a few days late (weekend / holiday start). */
const BENCH_START_SLACK_DAYS = 7;

export type BenchmarkRun = {
  mode: "lumpsum" | "sip";
  amount: number;
  /** Used when `result` carries no cashflow (start falls back to the window). */
  startIso: string;
  endIso: string;
};

/**
 * Runs the benchmark (e.g. Nifty BeES) on the same cashflow as `result`:
 * same mode, amount, effective start date, and end. SIP results get a
 * benchmark XIRR on the same monthly schedule; lumpsum results get a CAGR
 * from the basket's first priced day. Returns null when the benchmark has
 * no NAV for that window.
 */
export function benchmarkForResult(
  result: BacktestResult | undefined,
  navs: NavPoint[] | undefined,
  run: BenchmarkRun,
): BacktestResult | null {
  if (!result || result.error === "no-nav" || !navs || navs.length < 2) {
    return null;
  }
  const cf = result.cashflow;
  const mode = cf?.mode ?? run.mode;
  const amount = cf?.amount ?? run.amount;
  const startIso = cf?.startIso ?? run.startIso;
  if (!(amount > 0) || startIso >= run.endIso) return null;
  const bench = backtestPlan(
    BENCH_BASKET,
    { [BENCH_CODE]: navs },
    {
      mode,
      amount,
      period: "Custom",
      customStart: startIso,
      customEnd: run.endIso,
    },
    mode === "lumpsum" ? { kind: "lumpsum" } : { kind: "sip", stepUp: 0 },
  );
  if (bench.error === "no-nav" || bench.series.length < 2) return null;
  const benchStart = bench.cashflow?.startIso ?? startIso;
  if (benchStart > shiftIso(startIso, BENCH_START_SLACK_DAYS)) return null;
  if (!Number.isFinite(bench.stats.cagr)) return null;
  return bench;
}

export type Concentration = {
  count: number;
  top5: number;
  top10: number;
};

export function concentrationFromHoldings(
  holdings: InsightHolding[] | undefined,
): Concentration | null {
  if (!holdings?.length) return null;
  const sorted = [...holdings].sort((a, b) => b.weight - a.weight);
  const sumN = (n: number) =>
    sorted.slice(0, n).reduce((s, h) => s + h.weight, 0);
  return {
    count: sorted.length,
    top5: sumN(5),
    top10: sumN(10),
  };
}

export type MixMeter = { key: string; label: string; weight: number };

function metersFromMap(
  map: Record<string, number> | null | undefined,
  order?: readonly string[],
): MixMeter[] | null {
  if (!map) return null;
  const keys = order
    ? order.filter((k) => (map[k] ?? 0) > 0)
    : Object.keys(map).filter((k) => (map[k] ?? 0) > 0);
  if (!keys.length) return null;
  const labeled = keys.map((key) => ({
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    weight: map[key] ?? 0,
  }));
  if (!order) {
    labeled.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  }
  return labeled;
}

export function equityMeters(
  split: EquitySplit | undefined,
): MixMeter[] | null {
  if (!split) return null;
  return metersFromMap(split, ["large", "mid", "small", "unclassified"]);
}

export function assetMeters(
  asset: Record<string, number> | undefined,
): MixMeter[] | null {
  return metersFromMap(asset);
}

export function topSectorMeters(
  sector: Record<string, number> | undefined,
  limit = 5,
): MixMeter[] | null {
  const all = metersFromMap(sector);
  if (!all) return null;
  return all.slice(0, limit);
}

export type OverlapRow = {
  key: string;
  otherId: string;
  otherName: string;
  pct: number;
  names: OverlapName[];
};

export function overlapForBasket(
  focusedId: string | null,
  overlap: Record<string, number> | null | undefined,
  holdings: Record<string, OverlapName[]> | null | undefined,
  baskets: Basket[],
): OverlapRow[] {
  if (!focusedId || !overlap) return [];
  const nameOf = (id: string) => baskets.find((b) => b.id === id)?.name ?? id;
  const rows: OverlapRow[] = [];
  for (const [key, pct] of Object.entries(overlap)) {
    if (!Number.isFinite(pct)) continue;
    const [a, b] = key.split("|");
    if (!a || !b) continue;
    if (a !== focusedId && b !== focusedId) continue;
    const otherId = a === focusedId ? b : a;
    rows.push({
      key,
      otherId,
      otherName: nameOf(otherId),
      pct,
      names: holdings?.[key] ?? [],
    });
  }
  rows.sort((x, y) => y.pct - x.pct || x.otherName.localeCompare(y.otherName));
  return rows;
}

export type RedFlag = {
  kind: "overlap" | "sector" | "small-cap";
  text: string;
};

export const OVERLAP_FLAG = 40;
export const SECTOR_FLAG = 40;
export const SMALL_FLAG = 30;

export function redFlags(input: {
  overlap: OverlapRow[];
  sectors: MixMeter[] | null;
  equity: MixMeter[] | null;
}): RedFlag[] {
  const flags: RedFlag[] = [];
  for (const row of input.overlap) {
    if (row.pct >= OVERLAP_FLAG) {
      flags.push({
        kind: "overlap",
        text: `${row.pct.toFixed(1)}% overlap with ${row.otherName}`,
      });
    }
  }
  const topSector = input.sectors?.[0];
  if (topSector && topSector.weight >= SECTOR_FLAG) {
    flags.push({
      kind: "sector",
      text: `${topSector.label} is ${topSector.weight.toFixed(1)}% of this basket`,
    });
  }
  const small = input.equity?.find((m) => m.key === "small");
  if (small && small.weight >= SMALL_FLAG) {
    flags.push({
      kind: "small-cap",
      text: `Small-cap is ${small.weight.toFixed(1)}% of this basket`,
    });
  }
  return flags;
}
