import { describe, expect, it } from "vitest";
import { cagr } from "./backtest/performance";
import type { BacktestResult, Basket } from "../types";
import {
  assetMeters,
  benchmarkForResult,
  concentrationFromHoldings,
  equityMeters,
  growthFromResult,
  overlapForBasket,
  redFlags,
  topSectorMeters,
} from "./portfolioDetails";

const basket = (id: string, name: string): Basket => ({
  id,
  name,
  color: "#000",
  active: true,
  funds: [],
});

describe("growthFromResult", () => {
  it("returns null without a run or NAV", () => {
    expect(growthFromResult(undefined, "lumpsum")).toBeNull();
    expect(
      growthFromResult(
        {
          basketId: "1",
          series: [],
          stats: { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 },
          error: "no-nav",
        },
        "lumpsum",
      ),
    ).toBeNull();
  });

  it("splits invested vs current for lumpsum CAGR", () => {
    const result: BacktestResult = {
      basketId: "1",
      series: [],
      stats: { initial: 100_000, final: 118_000, abs: 18, cagr: 12.4, mdd: -8 },
    };
    expect(growthFromResult(result, "lumpsum")).toEqual({
      invested: 100_000,
      current: 118_000,
      gain: 18_000,
      absPct: 18,
      rate: 12.4,
      rateLabel: "CAGR",
    });
  });

  it("labels SIP as XIRR", () => {
    const result: BacktestResult = {
      basketId: "1",
      series: [],
      stats: { initial: 36_000, final: 40_000, abs: 11.11, cagr: 9.2, mdd: -3 },
    };
    expect(growthFromResult(result, "sip")?.rateLabel).toBe("XIRR");
  });
});

describe("benchmarkForResult", () => {
  const bees = [
    { date: "2023-01-01", nav: 100 },
    { date: "2023-07-01", nav: 100 },
    { date: "2024-01-01", nav: 150 },
  ];
  const run = {
    mode: "lumpsum" as const,
    amount: 1000,
    startIso: "2023-01-01",
    endIso: "2024-01-01",
  };
  const lateLumpsum: BacktestResult = {
    basketId: "1",
    series: [
      { x: "2023-07-01", y: 1000, drawdown: 0 },
      { x: "2024-01-01", y: 1100, drawdown: 0 },
    ],
    cashflow: {
      mode: "lumpsum",
      amount: 1000,
      startIso: "2023-07-01",
      requestedStartIso: "2023-01-01",
    },
    stats: { initial: 1000, final: 1100, abs: 10, cagr: 20, mdd: 0 },
  };

  it("starts BeES on the basket's effective start, not the window start", () => {
    const bench = benchmarkForResult(lateLumpsum, bees, run);
    expect(bench).not.toBeNull();
    expect(bench!.cashflow?.startIso).toBe("2023-07-01");
    expect(bench!.series[0]).toMatchObject({ x: "2023-07-01", y: 1000 });
    expect(bench!.series.at(-1)?.y).toBeCloseTo(1500, 6);
    const years =
      (new Date("2024-01-01T00:00:00").getTime() -
        new Date("2023-07-01T00:00:00").getTime()) /
      (365 * 86400000);
    expect(bench!.stats.cagr).toBeCloseTo(cagr(1000, 1500, years), 5);
    // Window-start CAGR would have been 50%.
    expect(bench!.stats.cagr).not.toBeCloseTo(50, 1);
  });

  it("runs BeES on the same SIP schedule (XIRR, not lumpsum CAGR)", () => {
    const monthly = Array.from({ length: 13 }, (_, i) => {
      const d = new Date("2023-01-01T00:00:00");
      d.setMonth(d.getMonth() + i);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      return { date: `${d.getFullYear()}-${m}-01`, nav: 100 + i * 5 };
    });
    const sip: BacktestResult = {
      basketId: "1",
      series: [
        { x: "2023-01-01", y: 1000, drawdown: 0 },
        { x: "2024-01-01", y: 14000, drawdown: 0 },
      ],
      cashflow: { mode: "sip", amount: 1000, startIso: "2023-01-01" },
      stats: { initial: 13000, final: 14000, abs: 7.7, cagr: 14, mdd: 0 },
    };
    const bench = benchmarkForResult(sip, monthly, { ...run, mode: "sip" });
    expect(bench).not.toBeNull();
    expect(bench!.cashflow?.mode).toBe("sip");
    expect(bench!.stats.initial).toBe(13 * 1000);
    const lumpsumCagr = benchmarkForResult(
      { ...sip, cashflow: { ...sip.cashflow!, mode: "lumpsum" } },
      monthly,
      run,
    )!.stats.cagr;
    expect(lumpsumCagr).toBeCloseTo(60, 1);
    expect(Math.abs(bench!.stats.cagr - lumpsumCagr)).toBeGreaterThan(5);
  });

  it("returns null when BeES starts well after the basket", () => {
    expect(
      benchmarkForResult(
        lateLumpsum,
        [
          { date: "2023-09-01", nav: 100 },
          { date: "2024-01-01", nav: 120 },
        ],
        run,
      ),
    ).toBeNull();
  });

  it("returns null without a run or two BeES points", () => {
    expect(benchmarkForResult(undefined, bees, run)).toBeNull();
    expect(
      benchmarkForResult(lateLumpsum, [{ date: "2023-07-01", nav: 100 }], run),
    ).toBeNull();
    expect(
      benchmarkForResult({ ...lateLumpsum, error: "no-nav" }, bees, run),
    ).toBeNull();
  });
});

describe("concentrationFromHoldings", () => {
  it("returns null when empty", () => {
    expect(concentrationFromHoldings([])).toBeNull();
    expect(concentrationFromHoldings(undefined)).toBeNull();
  });

  it("sums the largest 5 and 10 weights", () => {
    const holdings = Array.from({ length: 12 }, (_, i) => ({
      isin: `INE${i}`,
      name: `N${i}`,
      weight: 12 - i,
    }));
    const c = concentrationFromHoldings(holdings)!;
    expect(c.count).toBe(12);
    expect(c.top5).toBe(12 + 11 + 10 + 9 + 8);
    expect(c.top10).toBe(c.top5 + 7 + 6 + 5 + 4 + 3);
  });
});

describe("mix meters", () => {
  it("drops zero buckets and does not invent 0%", () => {
    expect(
      equityMeters({ large: 20, mid: 0, small: 0, unclassified: 0 }),
    ).toEqual([{ key: "large", label: "Large", weight: 20 }]);
    expect(
      equityMeters({ large: 0, mid: 0, small: 0, unclassified: 0 }),
    ).toBeNull();
    expect(assetMeters({})).toBeNull();
  });

  it("keeps the heaviest sectors first", () => {
    expect(
      topSectorMeters({ Energy: 10, Financials: 40, IT: 15 }, 2),
    ).toEqual([
      { key: "Financials", label: "Financials", weight: 40 },
      { key: "IT", label: "IT", weight: 15 },
    ]);
  });
});

describe("overlapForBasket", () => {
  it("keeps pairs that include the focused basket", () => {
    const rows = overlapForBasket(
      "1",
      { "1|2": 12.5, "2|3": 80 },
      {
        "1|2": [
          {
            isin: "INE1",
            name: "Rel",
            weightA: 10,
            weightB: 8,
            minWeight: 8,
          },
        ],
      },
      [basket("1", "Core"), basket("2", "Sat"), basket("3", "Other")],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      otherId: "2",
      otherName: "Sat",
      pct: 12.5,
    });
    expect(rows[0]!.names[0]!.name).toBe("Rel");
  });

  it("returns [] without overlap or a focused id", () => {
    expect(overlapForBasket(null, { "1|2": 10 }, null, [])).toEqual([]);
    expect(overlapForBasket("1", null, null, [])).toEqual([]);
  });
});

describe("redFlags", () => {
  it("flags high overlap, sector concentration, and small-cap", () => {
    const flags = redFlags({
      overlap: [
        { key: "1|2", otherId: "2", otherName: "Sat", pct: 42, names: [] },
      ],
      sectors: [{ key: "Financials", label: "Financials", weight: 48 }],
      equity: [
        { key: "large", label: "Large", weight: 50 },
        { key: "small", label: "Small", weight: 35 },
      ],
    });
    expect(flags.map((f) => f.kind)).toEqual([
      "overlap",
      "sector",
      "small-cap",
    ]);
  });

  it("stays quiet below the thresholds", () => {
    expect(
      redFlags({
        overlap: [
          { key: "1|2", otherId: "2", otherName: "Sat", pct: 12.5, names: [] },
        ],
        sectors: [{ key: "Energy", label: "Energy", weight: 20 }],
        equity: [{ key: "small", label: "Small", weight: 10 }],
      }),
    ).toEqual([]);
  });
});
