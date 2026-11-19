import { describe, expect, it } from "vitest";
import { backtestBasket, backtestPlan, cagr, skipYearWindow } from "./performance";
import { calculateXirr } from "./xirr";
import { NAV_A, NAV_B, NAV_SIP } from "../../test/navFixture";
import type { Basket, LabSettings, NavPoint } from "../../types";

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

  it("starts from first NAV when a fund launches after the requested start", () => {
    const late: Basket = {
      ...basket,
      funds: [
        { schemeCode: "N", schemeName: "New", isin: null, weight: 100, locked: false },
      ],
    };
    const r = backtestBasket(
      late,
      {
        N: [
          { date: "2023-07-01", nav: 10 },
          { date: "2024-01-01", nav: 12 },
        ],
      },
      settings,
    );
    expect(r.error).toBeUndefined();
    expect(r.stats.initial).toBe(1000);
    expect(r.stats.final).toBeCloseTo(1200, 6);
    expect(r.stats.abs).toBeCloseTo(20, 6);
    const years =
      (new Date("2024-01-01T00:00:00").getTime() -
        new Date("2023-07-01T00:00:00").getTime()) /
      (365 * 86400000);
    expect(r.stats.cagr).toBeCloseTo(cagr(1000, 1200, years), 5);
    expect(r.cashflow?.startIso).toBe("2023-07-01");
    expect(r.series[0]?.x).toBe("2023-07-01");
    expect(r.series[0]?.y).toBeCloseTo(1000, 6);
  });

  it("clips a mixed basket to the newest fund's first NAV", () => {
    const r = backtestBasket(
      basket,
      {
        A: NAV_A,
        B: [
          { date: "2023-07-01", nav: 20 },
          { date: "2024-01-01", nav: 22 },
        ],
      },
      settings,
    );
    expect(r.error).toBeUndefined();
    expect(r.cashflow?.startIso).toBe("2023-07-01");
    expect(r.stats.initial).toBe(1000);
    expect(r.stats.final).toBeGreaterThan(0);
    expect(r.series[0]?.x).toBe("2023-07-01");
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

  it("starts SIP on the first day every weighted fund can be priced", () => {
    const r = backtestBasket(
      basket,
      {
        A: NAV_A,
        B: [
          { date: "2023-06-01", nav: 20 },
          { date: "2024-01-01", nav: 22 },
        ],
      },
      { ...settings, mode: "sip" },
    );
    expect(r.error).toBeUndefined();
    expect(r.cashflow?.startIso).toBe("2023-06-01");
    expect(r.stats.initial).toBeGreaterThan(0);
    expect(r.stats.final).toBeGreaterThan(0);
  });

  it("marks no-nav when a weighted fund has no series at all", () => {
    const r = backtestBasket(sipBasket, {}, sipSettings);
    expect(r.error).toBe("no-nav");
    expect(r.series).toEqual([]);
    expect(r.stats.abs).toBe(0);
  });
});

describe("step-up and skip-year SIP", () => {
  const fund: Basket = {
    id: "s",
    name: "S",
    color: "#000",
    active: true,
    funds: [
      { schemeCode: "S", schemeName: "S", isin: null, weight: 100, locked: false },
    ],
  };
  const nav: NavPoint[] = Array.from({ length: 25 }, (_, i) => {
    const d = new Date("2023-01-01T00:00:00");
    d.setMonth(d.getMonth() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return { date: `${y}-${m}-${day}`, nav: 10 };
  });
  const windowSettings: LabSettings = {
    mode: "sip",
    amount: 1000,
    period: "Custom",
    customStart: nav[0]!.date,
    customEnd: nav[24]!.date,
  };

  it("steps the installment 10% after 12 SIPs", () => {
    const r = backtestPlan(fund, { S: nav }, windowSettings, {
      kind: "sip",
      stepUp: 0.1,
    });
    expect(r.error).toBeUndefined();
    expect(r.stats.initial).toBeCloseTo(12 * 1000 + 12 * 1100 + 1210, 6);
  });

  it("skips SIPs in year two", () => {
    const skip = skipYearWindow(nav[0]!.date, nav[24]!.date);
    expect(skip).not.toBeNull();
    const r = backtestPlan(fund, { S: nav }, windowSettings, {
      kind: "sip",
      stepUp: 0,
      skipStartIso: skip!.skipStartIso,
      skipEndIso: skip!.skipEndIso,
    });
    expect(r.error).toBeUndefined();
    expect(r.stats.initial).toBeLessThan(25 * 1000);
    expect(r.stats.initial).toBeGreaterThan(12 * 1000);
  });

  it("skips the clipped last day when year two runs past the end", () => {
    const end = nav[17]!.date; // 2024-06-01, inside year two
    const skip = skipYearWindow(nav[0]!.date, end);
    expect(skip).toEqual({
      skipStartIso: "2024-01-01",
      skipEndIso: end,
      skipEndInclusive: true,
    });
    const r = backtestPlan(
      fund,
      { S: nav },
      { ...windowSettings, customEnd: end },
      { kind: "sip", stepUp: 0, ...skip! },
    );
    expect(r.error).toBeUndefined();
    // Year one only; no SIP on 2024-01-01 … 2024-06-01 (inclusive).
    expect(r.stats.initial).toBe(12 * 1000);
  });

  it("keeps the second anniversary exclusive when year two fits", () => {
    const skip = skipYearWindow(nav[0]!.date, nav[24]!.date);
    expect(skip).toEqual({
      skipStartIso: "2024-01-01",
      skipEndIso: "2025-01-01",
      skipEndInclusive: false,
    });
    const r = backtestPlan(fund, { S: nav }, windowSettings, {
      kind: "sip",
      stepUp: 0,
      ...skip!,
    });
    // 12 in year one + the 2025-01-01 SIP.
    expect(r.stats.initial).toBe(13 * 1000);
  });

  it("skips year three when requested", () => {
    expect(skipYearWindow("2023-01-01", "2027-01-01", 3)).toEqual({
      skipStartIso: "2025-01-01",
      skipEndIso: "2026-01-01",
      skipEndInclusive: false,
    });
    expect(skipYearWindow("2023-01-01", "2024-12-01", 3)).toBeNull();
  });

  it("has no skip window inside one year", () => {
    expect(skipYearWindow("2023-01-01", "2023-12-01")).toBeNull();
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
