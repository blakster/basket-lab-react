import { describe, expect, it } from "vitest";

import type { NavPoint } from "../../types";
import type { PortfolioTransaction } from "../api/portfolio";
import {
  buildPositions,
  growthSeries,
  isDividendPayout,
  portfolioTotals,
  unitsByInstrument,
  xirrPercent,
} from "./returns";

function tx(partial: Partial<PortfolioTransaction>): PortfolioTransaction {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    accountId: "cams:1",
    instrumentId: "amfi:1",
    date: "2024-01-01",
    kind: "buy",
    units: 1,
    amount: 100,
    ...partial,
  };
}

describe("buildPositions", () => {
  it("tracks units, invested, proceeds and dividend income", () => {
    const positions = buildPositions([
      tx({ kind: "sip", units: 10, amount: 1000, date: "2024-01-01" }),
      tx({ kind: "buy", units: 5, amount: 500, date: "2024-02-01" }),
      tx({ kind: "dividend", units: 0, amount: 120, date: "2024-03-01" }),
      tx({ kind: "dividend", units: 1.2, amount: 120, date: "2024-03-02" }),
      tx({ kind: "sell", units: -4, amount: 440, date: "2024-04-01" }),
      tx({ kind: "switch-in", units: 2, amount: 220, date: "2024-05-01" }),
      tx({ kind: "switch-out", units: 1, amount: 110, date: "2024-06-01" }),
    ]);
    const p = positions.get("amfi:1")!;
    expect(p.units).toBeCloseTo(10 + 5 + 1.2 + 2 - 4 - 1, 10);
    expect(p.invested).toBeCloseTo(1000 + 500 + 220, 10);
    expect(p.proceeds).toBeCloseTo(440 + 110, 10);
    expect(p.income).toBeCloseTo(120, 10);
    expect(p.firstDate).toBe("2024-01-01");
    expect(p.lastDate).toBe("2024-06-01");
  });

  it("separates positions per instrument", () => {
    const positions = buildPositions([
      tx({ instrumentId: "amfi:1", amount: 100 }),
      tx({ instrumentId: "amfi:2", amount: 200 }),
    ]);
    expect(positions.size).toBe(2);
    expect(positions.get("amfi:2")!.invested).toBe(200);
  });
});

describe("isDividendPayout", () => {
  it("payout has no units, reinvestment has units", () => {
    expect(isDividendPayout(tx({ kind: "dividend", units: 0 }))).toBe(true);
    expect(isDividendPayout(tx({ kind: "dividend", units: 1.5 }))).toBe(false);
    expect(isDividendPayout(tx({ kind: "buy", units: 0 }))).toBe(false);
  });
});

describe("xirrPercent", () => {
  it("returns null with fewer than two dated flows", () => {
    const txns = [tx({ kind: "buy", amount: 1000, date: "2024-01-01" })];
    expect(xirrPercent(txns, 0, "2024-02-01")).toBeNull();
    expect(xirrPercent(txns, 1100, "2024-02-01")).not.toBeNull();
  });

  it("returns null when every flow falls on one date", () => {
    const txns = [tx({ kind: "buy", units: 10, amount: 1000, date: "2024-01-01" })];
    expect(xirrPercent(txns, 1100, "2024-01-01")).toBeNull();
  });

  it("computes a 10% annualized return over one year", () => {
    const txns = [tx({ kind: "buy", units: 10, amount: 1000, date: "2023-01-01" })];
    const rate = xirrPercent(txns, 1100, "2024-01-01");
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(9.9);
    expect(rate!).toBeLessThan(10.1);
  });

  it("nets same-day flows and counts dividend payouts as income", () => {
    const txns = [
      tx({ kind: "buy", units: 10, amount: 1000, date: "2023-01-01" }),
      tx({ kind: "dividend", units: 0, amount: 100, date: "2023-06-01" }),
    ];
    const rate = xirrPercent(txns, 1210, "2024-01-01");
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(32);
    expect(rate!).toBeLessThan(34);
  });
});

describe("portfolioTotals", () => {
  it("gain equals value plus proceeds plus income minus invested", () => {
    const transactions = [
      tx({ instrumentId: "amfi:1", kind: "buy", units: 10, amount: 1000 }),
      tx({ instrumentId: "amfi:2", kind: "sip", units: 5, amount: 500 }),
      tx({ instrumentId: "amfi:1", kind: "dividend", units: 0, amount: 50 }),
    ];
    const positions = buildPositions(transactions);
    const values = new Map([
      ["amfi:1", 1200],
      ["amfi:2", 550],
    ]);
    const totals = portfolioTotals(transactions, positions, values, "2024-06-01");
    expect(totals.invested).toBe(1500);
    expect(totals.currentValue).toBe(1750);
    expect(totals.income).toBe(50);
    expect(totals.gain).toBeCloseTo(300, 10);
    expect(totals.gainPct).toBeCloseTo(20, 10);
    expect(totals.xirr).not.toBeNull();
  });

  it("excludes fund switches from invested and proceeds", () => {
    const transactions = [
      tx({ kind: "buy", units: 10, amount: 1000, date: "2023-01-01" }),
      tx({ kind: "switch-out", units: -10, amount: 1100, date: "2024-01-01" }),
      tx({ kind: "switch-in", units: 10, amount: 1100, date: "2024-01-01" }),
    ];
    const positions = buildPositions(transactions);
    const totals = portfolioTotals(transactions, positions, new Map([["amfi:1", 1200]]), "2025-01-01");
    expect(totals.invested).toBe(1000);
    expect(totals.proceeds).toBe(0);
    expect(totals.gain).toBeCloseTo(200, 10);
  });

  it("gainPct is null when nothing was invested", () => {
    const transactions = [
      tx({ kind: "dividend", units: 0, amount: 50 }),
    ];
    const positions = buildPositions(transactions);
    const totals = portfolioTotals(transactions, positions, new Map(), "2024-06-01");
    expect(totals.gainPct).toBeNull();
  });
});

describe("unitsByInstrument", () => {
  it("cumulative signed units in date order", () => {
    const units = unitsByInstrument([
      tx({ kind: "buy", units: 10, date: "2024-02-01" }),
      tx({ kind: "sell", units: 4, date: "2024-01-01" }),
      tx({ kind: "sip", units: 5, date: "2024-01-15" }),
    ]);
    const u = units.get("amfi:1")!;
    expect(u.dates).toEqual(["2024-01-01", "2024-01-15", "2024-02-01"]);
    expect(u.deltas).toEqual([-4, 1, 11]);
    expect(u.total).toBe(11);
  });
});

describe("growthSeries", () => {
  const nav: NavPoint[] = [
    { date: "2024-01-01", nav: 100 },
    { date: "2024-02-01", nav: 110 },
    { date: "2024-03-01", nav: 120 },
  ];

  it("values units held at each sample date from NAV", () => {
    const transactions = [
      tx({ kind: "buy", units: 10, amount: 1000, date: "2024-01-01" }),
      tx({ kind: "sip", units: 10, amount: 1100, date: "2024-02-15" }),
    ];
    const series = growthSeries(
      transactions,
      new Map([["106796", nav]]),
      new Map([["amfi:1", "106796"]]),
      new Map(),
      new Map([["amfi:1", "2024-01-01"]]),
    );
    const byDate = new Map(series.map((p) => [p.date, p.value]));
    expect(byDate.get("2024-01-01")).toBeCloseTo(1000, 6);
    expect(byDate.get("2024-02-01")).toBeCloseTo(1100, 6);
    // After the SIP, 20 units at the March NAV.
    expect(byDate.get("2024-03-01")).toBeCloseTo(2400, 6);
  });

  it("falls back to the flat statement value without a NAV series", () => {
    const transactions = [
      tx({ instrumentId: "other:1", kind: "buy", units: 3, amount: 300, date: "2024-01-10" }),
    ];
    const series = growthSeries(
      transactions,
      new Map([["106796", nav]]),
      new Map(),
      new Map([["other:1", { date: "2024-03-31", value: 350 }]]),
      new Map([["other:1", "2024-01-10"]]),
    );
    const byDate = new Map(series.map((p) => [p.date, p.value]));
    expect(byDate.get("2024-01-01")).toBe(0);
    expect(byDate.get("2024-03-01")).toBeCloseTo(350, 6);
  });

  it("returns an empty series with no NAV dates", () => {
    expect(growthSeries([], new Map(), new Map(), new Map(), new Map())).toEqual([]);
  });

  it("samples statement dates when no NAV series exists at all", () => {
    const transactions = [
      tx({ instrumentId: "other:1", kind: "buy", units: 3, amount: 300, date: "2024-01-10" }),
    ];
    const series = growthSeries(
      transactions,
      new Map(),
      new Map(),
      new Map([["other:1", { date: "2024-03-31", value: 350 }]]),
      new Map([["other:1", "2024-01-10"]]),
    );
    expect(series.length).toBeGreaterThan(0);
    expect(series[series.length - 1]).toEqual({ date: "2024-03-31", value: 350 });
  });
});
