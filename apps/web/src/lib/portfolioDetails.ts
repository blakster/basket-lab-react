import type { BacktestResult, Basket, NavPoint, TimePoint } from "../types";
import type {
  EquitySplit,
  InsightHolding,
  OverlapName,
} from "./api/insights";
import { cagr } from "./backtest/performance";

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

export function scaleNavToAmount(
  navs: NavPoint[] | undefined,
  amount: number,
): TimePoint[] {
  if (!navs || navs.length < 2 || !(amount > 0)) return [];
  const first = navs[0]!;
  if (!(first.nav > 0)) return [];
  return navs.map((p) => ({
    x: p.date,
    y: (p.nav / first.nav) * amount,
    drawdown: 0,
  }));
}

export function beesCagrFromNavs(navs: NavPoint[] | undefined): number | null {
  if (!navs || navs.length < 2) return null;
  const first = navs[0]!;
  const last = navs[navs.length - 1]!;
  if (!(first.nav > 0) || !(last.nav > 0) || last.date <= first.date) return null;
  const years =
    (new Date(`${last.date}T00:00:00`).getTime() -
      new Date(`${first.date}T00:00:00`).getTime()) /
    (365 * 86400000);
  if (years <= 0) return null;
  const value = cagr(first.nav, last.nav, years);
  return Number.isFinite(value) ? value : null;
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
