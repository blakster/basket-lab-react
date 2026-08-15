import { describe, expect, it } from "vitest";
import { backtestBasket, cagr } from "./performance";
import { calculateXirr } from "./xirr";
import { NAV_A, NAV_B, NAV_SIP } from "../../test/navFixture";
import type { Basket, LabSettings } from "../../types";

const settings: LabSettings = {
  mode: "lumpsum",
  amount: 1000,
  period: "Custom",
  customStart: "2023-01-01",
  customEnd: "2024-01-01",
};

const basket: Basket = {
  id: "1",
  name: "Mix",
  color: "#000",
  active: true,
  funds: [
    { schemeCode: "A", schemeName: "A", isin: null, weight: 50, locked: false },
    { schemeCode: "B", schemeName: "B", isin: null, weight: 50, locked: false },
  ],
};

describe("cagr", () => {
  it("doubles in one year = 100%", () => {
    expect(cagr(100, 200, 1)).toBeCloseTo(100, 5);
  });
});

describe("backtestBasket lumpsum", () => {
  it("50/50 A+B: 1000 -> 1150, abs 15%", () => {
    const r = backtestBasket(basket, { A: NAV_A, B: NAV_B }, settings);
    expect(r.error).toBeUndefined();
    expect(r.stats.initial).toBe(1000);
    expect(r.stats.final).toBeCloseTo(1150, 6);
    expect(r.stats.abs).toBeCloseTo(15, 6);
    expect(r.stats.cagr).toBeCloseTo(cagr(1000, 1150, 1), 5);
    expect(r.series.at(-1)?.y).toBeCloseTo(1150, 6);
  });

  it("marks no-nav when a fund series is missing", () => {
    const r = backtestBasket(basket, { A: NAV_A }, settings);
    expect(r.error).toBe("no-nav");
  });

  it("marks no-nav when the in-range timeline is empty", () => {
    const r = backtestBasket(basket, { A: NAV_A, B: NAV_B }, {
      ...settings,
      customStart: "2025-01-01",
      customEnd: "2025-12-31",
    });
    expect(r.error).toBe("no-nav");
    expect(r.series).toEqual([]);
    expect(r.stats.final).toBe(0);
    expect(r.stats.abs).toBe(0);
  });
});

describe("backtestBasket SIP", () => {
  const sipBasket: Basket = {
    id: "sip",
    name: "SIP",
    color: "#000",
    active: true,
    funds: [
      { schemeCode: "S", schemeName: "S", isin: null, weight: 100, locked: false },
    ],
  };

  const sipSettings: LabSettings = {
    mode: "sip",
    amount: 1000,
    period: "Custom",
    customStart: "2023-01-01",
    customEnd: "2023-04-01",
  };

  it("produces finite XIRR and a real max drawdown on the NAV_SIP fixture", () => {
    const r = backtestBasket(sipBasket, { S: NAV_SIP }, sipSettings);
    expect(r.error).toBeUndefined();
    expect(Number.isFinite(r.stats.cagr)).toBe(true);
    expect(r.stats.mdd).toBeLessThanOrEqual(0);
    expect(r.stats.mdd).toBeCloseTo(-18.75, 6);
    expect(r.stats.initial).toBe(4000);
    expect(r.stats.final).toBeCloseTo(2600, 6);
  });

  it("marks no-nav when a weighted fund cannot be priced on a SIP day", () => {
    const r = backtestBasket(
      basket,
      {
        A: NAV_A,
        B: [{ date: "2023-06-01", nav: 20 }],
      },
      { ...settings, mode: "sip" },
    );
    expect(r.error).toBe("no-nav");
    expect(r.series).toEqual([]);
    expect(r.stats.abs).toBe(0);
  });
});

describe("calculateXirr", () => {
  it("one year -1000 then +1100 is ~10%", () => {
    const rate = calculateXirr([
      { date: new Date("2023-01-01"), amount: -1000 },
      { date: new Date("2024-01-01"), amount: 1100 },
    ]);
    expect(rate).toBeCloseTo(10, 1);
  });
});
