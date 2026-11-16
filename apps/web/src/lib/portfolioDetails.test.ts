import { describe, expect, it } from "vitest";
import type { BacktestResult, Basket } from "../types";
import {
  assetMeters,
  beesCagrFromNavs,
  concentrationFromHoldings,
  equityMeters,
  growthFromResult,
  overlapForBasket,
  redFlags,
  scaleNavToAmount,
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

describe("beesCagrFromNavs", () => {
  it("returns null without two priced points", () => {
    expect(beesCagrFromNavs(undefined)).toBeNull();
    expect(beesCagrFromNavs([{ date: "2023-01-01", nav: 100 }])).toBeNull();
    expect(
      beesCagrFromNavs([
        { date: "2023-01-01", nav: 0 },
        { date: "2024-01-01", nav: 110 },
      ]),
    ).toBeNull();
  });

  it("is 100% when NAV doubles in one year", () => {
    expect(
      beesCagrFromNavs([
        { date: "2023-01-01", nav: 100 },
        { date: "2024-01-01", nav: 200 },
      ]),
    ).toBeCloseTo(100, 5);
  });
});

describe("scaleNavToAmount", () => {
  it("maps the first NAV to the invested amount", () => {
    const series = scaleNavToAmount(
      [
        { date: "2023-01-01", nav: 100 },
        { date: "2024-01-01", nav: 120 },
      ],
      50_000,
    );
    expect(series[0]).toMatchObject({ x: "2023-01-01", y: 50_000 });
    expect(series[1]).toMatchObject({ x: "2024-01-01", y: 60_000 });
  });

  it("returns [] without two priced points", () => {
    expect(scaleNavToAmount([{ date: "2023-01-01", nav: 100 }], 1000)).toEqual(
      [],
    );
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
