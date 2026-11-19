/**
 * Benchmark for the NAV lookup hot paths. Run with `npx vitest bench`.
 * `backtestBasket` measures the shipped implementation; the chart benches
 * replay LabCharts' row build verbatim — `rowsFind` is the previous
 * `series.find(...)` loop, `rowsMap` the indexed `byDate` map.
 */
import { bench, describe } from "vitest";
import { backtestBasket } from "./performance";
import type { Basket, LabSettings, NavPoint, TimePoint } from "../../types";

function navSeries(seed: number, days: number): NavPoint[] {
  let nav = 10 + seed * 7;
  let x = seed * 2654435761;
  const rand = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  const pts: NavPoint[] = [];
  const d = new Date("2015-01-05T00:00:00");
  for (let i = 0; i < days; i++) {
    nav *= 1 + (rand() - 0.48) * 0.01;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    pts.push({ date: `${y}-${m}-${day}`, nav: Number(nav.toFixed(4)) });
    d.setDate(d.getDate() + 1);
  }
  return pts;
}

function basketOf(nFunds: number): Basket {
  return {
    id: "bench",
    name: "bench",
    color: "#000",
    active: true,
    funds: Array.from({ length: nFunds }, (_, i) => ({
      schemeCode: `F${i}`,
      schemeName: `F${i}`,
      isin: null,
      weight: 100 / nFunds,
      locked: false,
    })),
  };
}

const DAYS = { "1Y": 365, "5Y": 1825, "10Y": 3650 } as const;

for (const [label, days] of Object.entries(DAYS)) {
  for (const nFunds of [1, 5]) {
    const navs: Record<string, NavPoint[]> = {};
    for (let i = 0; i < nFunds; i++) navs[`F${i}`] = navSeries(i + 1, days);
    const basket = basketOf(nFunds);
    const base: LabSettings = {
      mode: "lumpsum",
      amount: 100000,
      period: "Custom",
      customStart: navs.F0![0]!.date,
      customEnd: navs.F0!.at(-1)!.date,
    };
    const sip: LabSettings = { ...base, mode: "sip", amount: 10000 };
    bench(`lumpsum ${label} ${nFunds} funds`, () => {
      backtestBasket(basket, navs, base);
    });
    bench(`sip ${label} ${nFunds} funds`, () => {
      backtestBasket(basket, navs, sip);
    });
  }
}

// Chart row build: the series each chart receives after a 10Y backtest.
const results = [1, 2, 3].map((seed) => {
  const navs = { F0: navSeries(seed, 3650) };
  return backtestBasket(
    {
      id: `b${seed}`,
      name: `b${seed}`,
      color: "#000",
      active: true,
      funds: [
        {
          schemeCode: "F0",
          schemeName: "F0",
          isin: null,
          weight: 100,
          locked: false,
        },
      ],
    },
    navs,
    {
      mode: "lumpsum",
      amount: 100000,
      period: "Custom",
      customStart: navs.F0[0]!.date,
      customEnd: navs.F0.at(-1)!.date,
    },
  );
});
const dates = [...new Set(results.flatMap((r) => r.series.map((p) => p.x)))]
  .sort()
  .filter((_, i) => i % 30 === 0); // downsampled union, as LabCharts builds it

function rowsFind(
  keys: { key: string; series: TimePoint[] }[],
): Record<string, string | number | null>[] {
  return dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    for (const { key, series } of keys) {
      const point = series.find((p) => p.x === date);
      row[key] = point ? Math.round(point.y) : null;
    }
    return row;
  });
}

const keysFind = results.map((r) => ({ key: r.basketId, series: r.series }));
const keysMap = results.map((r) => ({
  key: r.basketId,
  byDate: new Map(r.series.map((p) => [p.x, p] as const)),
}));

function rowsMap(
  keys: { key: string; byDate: Map<string, TimePoint> }[],
): Record<string, string | number | null>[] {
  return dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    for (const { key, byDate } of keys) {
      const point = byDate.get(date);
      row[key] = point ? Math.round(point.y) : null;
    }
    return row;
  });
}

describe("chart rows (3 baskets x 10Y daily series)", () => {
  bench("series.find per date per basket (before)", () => {
    rowsFind(keysFind);
  });
  bench("byDate map per date per basket (after)", () => {
    rowsMap(keysMap);
  });
});
