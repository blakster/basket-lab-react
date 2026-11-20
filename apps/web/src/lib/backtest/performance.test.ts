import { describe, expect, it } from "vitest";
import { backtestBasket, backtestPlan, cagr, skipYearWindow } from "./performance";
import { calculateXirr } from "./xirr";
import { NAV_A, NAV_B, NAV_SIP } from "../../test/navFixture";
import type {
  BacktestResult,
  Basket,
  LabSettings,
  NavPoint,
  TimePoint,
} from "../../types";

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

describe("parity with the pre-indexing implementation", () => {
  // Reference: the same semantics re-implemented with the naive
  // `parseDay(p.date) <= day` linear scan that `navOnOrBefore` used before
  // the binary search, so every output number is pinned to the old code.
  const refNav = (history: NavPoint[], iso: string): number | null => {
    const day = new Date(`${iso}T00:00:00`);
    let hit: NavPoint | null = null;
    for (const p of history) {
      if (new Date(`${p.date}T00:00:00`) <= day) hit = p;
      else break;
    }
    return hit ? hit.nav : null;
  };

  function referenceBacktest(
    b: Basket,
    navs: Record<string, NavPoint[]>,
    s: LabSettings,
  ): BacktestResult {
    let startIso = s.customStart!;
    const endIso = s.customEnd!;
    for (const f of b.funds) {
      if (f.weight <= 0) continue;
      const series = navs[f.schemeCode];
      if (!series?.length)
        return {
          basketId: b.id,
          series: [],
          stats: { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 },
          error: "no-nav",
        };
      const first = series.reduce(
        (a, p) => (p.date < a ? p.date : a),
        series[0].date,
      );
      if (first > startIso) startIso = first;
    }
    if (startIso > endIso)
      return {
        basketId: b.id,
        series: [],
        stats: { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 },
        error: "no-nav",
      };
    const startDate = new Date(`${startIso}T00:00:00`);
    const endDate = new Date(`${endIso}T00:00:00`);
    const timeline = Object.values(navs)[0]
      .map((p) => p.date)
      .filter((d) => d >= startIso && d <= endIso);
    if (timeline[0] !== startIso) timeline.unshift(startIso);

    const series: TimePoint[] = [];
    let peak = 0;
    let mdd = 0;

    if (s.mode === "lumpsum") {
      const holdings: Record<string, number> = {};
      for (const f of b.funds) {
        if (f.weight <= 0) continue;
        const px = refNav(navs[f.schemeCode], startIso);
        holdings[f.schemeCode] = (s.amount * f.weight) / 100 / px!;
      }
      for (const iso of timeline) {
        let value = 0;
        for (const f of b.funds) {
          if (f.weight <= 0) continue;
          value += holdings[f.schemeCode]! * refNav(navs[f.schemeCode], iso)!;
        }
        if (value > peak) peak = value;
        const dd = peak > 0 ? ((value - peak) / peak) * 100 : 0;
        if (dd < mdd) mdd = dd;
        series.push({ x: iso, y: value, drawdown: dd });
      }
      const final = series.at(-1)!.y;
      const years = (endDate.getTime() - startDate.getTime()) / (365 * 86400000);
      return {
        basketId: b.id,
        series,
        cashflow: {
          mode: "lumpsum",
          amount: s.amount,
          startIso,
          requestedStartIso: s.customStart!,
        },
        stats: {
          initial: s.amount,
          final,
          abs: ((final - s.amount) / s.amount) * 100,
          cagr: cagr(s.amount, final, years),
          mdd,
        },
      };
    }

    const holdings: Record<string, { units: number }> = {};
    for (const f of b.funds) {
      if (f.weight <= 0) continue;
      holdings[f.schemeCode] = { units: 0 };
    }
    let totalInvested = 0;
    let nextSip = new Date(startDate);
    let sipCount = 0;
    const cashflows: { date: Date; amount: number }[] = [];
    for (const iso of timeline) {
      const day = new Date(`${iso}T00:00:00`);
      if (day >= nextSip) {
        for (const f of b.funds) {
          if (f.weight <= 0) continue;
          const px = refNav(navs[f.schemeCode], iso);
          holdings[f.schemeCode]!.units += (s.amount * f.weight) / 100 / px!;
        }
        cashflows.push({ date: new Date(day), amount: -s.amount });
        totalInvested += s.amount;
        sipCount += 1;
        nextSip = new Date(startDate);
        nextSip.setMonth(nextSip.getMonth() + sipCount);
      }
      let value = 0;
      for (const f of b.funds) {
        if (f.weight <= 0) continue;
        value += holdings[f.schemeCode]!.units * refNav(navs[f.schemeCode], iso)!;
      }
      if (totalInvested === 0) continue;
      if (value > peak) peak = value;
      const dd = peak > 0 ? ((value - peak) / peak) * 100 : 0;
      if (dd < mdd) mdd = dd;
      series.push({ x: iso, y: value, drawdown: dd });
    }
    const final = series.at(-1)!.y;
    cashflows.push({
      date: new Date(`${series.at(-1)!.x}T00:00:00`),
      amount: final,
    });
    return {
      basketId: b.id,
      series,
      cashflow: {
        mode: "sip",
        amount: s.amount,
        startIso,
        requestedStartIso: s.customStart!,
        stepUp: 0,
      },
      stats: {
        initial: totalInvested,
        final,
        abs: ((final - totalInvested) / totalInvested) * 100,
        cagr: calculateXirr(cashflows),
        mdd,
      },
    };
  }

  const daily = (seed: number, days: number): NavPoint[] => {
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
    const d = new Date("2021-06-01T00:00:00");
    for (let i = 0; i < days; i++) {
      nav *= 1 + (rand() - 0.48) * 0.01;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      pts.push({ date: `${y}-${m}-${day}`, nav });
      d.setDate(d.getDate() + 1);
    }
    return pts;
  };

  const multi: Basket = {
    id: "parity",
    name: "parity",
    color: "#000",
    active: true,
    funds: [
      { schemeCode: "A", schemeName: "A", isin: null, weight: 60, locked: false },
      { schemeCode: "B", schemeName: "B", isin: null, weight: 40, locked: false },
    ],
  };
  const navs = { A: daily(1, 400), B: daily(2, 400) };
  const window: LabSettings = {
    mode: "lumpsum",
    amount: 100000,
    period: "Custom",
    customStart: navs.A[0]!.date,
    customEnd: navs.A.at(-1)!.date,
  };

  it("lumpsum output is identical to the linear-scan implementation", () => {
    expect(backtestBasket(multi, navs, window)).toEqual(
      referenceBacktest(multi, navs, window),
    );
  });

  it("sip output is identical to the linear-scan implementation", () => {
    const sip = { ...window, mode: "sip" as const, amount: 10000 };
    expect(backtestBasket(multi, navs, sip)).toEqual(
      referenceBacktest(multi, navs, sip),
    );
  });

  it("matches when the window starts before a fund's first NAV", () => {
    const lateNavs = {
      A: navs.A,
      B: navs.B.slice(150), // fund B launches mid-window
    };
    expect(backtestBasket(multi, lateNavs, window)).toEqual(
      referenceBacktest(multi, lateNavs, window),
    );
  });
});

describe("fund-order independence", () => {
  // S trades three times; D trades on two extra dates (a +100% spike then a
  // -50% crash). The basket must see every date either fund trades on, so
  // granularity, drawdowns and SIP timing can't depend on which fund's
  // series happens to be `navs`' first entry.
  const SPARSE: NavPoint[] = [
    { date: "2023-01-02", nav: 10 },
    { date: "2023-06-01", nav: 10 },
    { date: "2024-01-01", nav: 10 },
  ];
  const DENSE: NavPoint[] = [
    { date: "2023-01-02", nav: 10 },
    { date: "2023-03-01", nav: 20 },
    { date: "2023-04-01", nav: 10 },
    { date: "2024-01-01", nav: 10 },
  ];
  const mixed: Basket = {
    ...basket,
    funds: [
      { schemeCode: "S", schemeName: "S", isin: null, weight: 50, locked: false },
      { schemeCode: "D", schemeName: "D", isin: null, weight: 50, locked: false },
    ],
  };

  it("lumpsum output is identical in either navs order", () => {
    const sd = backtestBasket(mixed, { S: SPARSE, D: DENSE }, settings);
    const ds = backtestBasket(mixed, { D: DENSE, S: SPARSE }, settings);
    expect(sd).toEqual(ds);
    // Union timeline: the D-only dates 2023-03-01 and 2023-04-01 appear.
    expect(sd.series.map((p) => p.x)).toEqual([
      "2023-01-02",
      "2023-03-01",
      "2023-04-01",
      "2023-06-01",
      "2024-01-01",
    ]);
    // 1500 peak on 2023-03-01 -> 1000 on 2023-04-01.
    expect(sd.stats.mdd).toBeCloseTo(-100 / 3, 6);
  });

  it("sip output is identical in either navs order", () => {
    const sip = { ...settings, mode: "sip" as const };
    const sd = backtestBasket(mixed, { S: SPARSE, D: DENSE }, sip);
    const ds = backtestBasket(mixed, { D: DENSE, S: SPARSE }, sip);
    expect(sd).toEqual(ds);
    // SIPs land on the first union date at/after each monthly anniversary:
    // 01-02, 03-01, 04-01, 06-01, 01-01.
    expect(sd.stats.initial).toBe(5 * sip.amount);
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
