import { describe, expect, it } from "vitest";
import { yearlyRanking } from "./ranking";
import type { BacktestResult } from "../types";

const emptyStats = { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 };

describe("yearlyRanking", () => {
  it("orders baskets by 2023 calendar return descending", () => {
    const results: BacktestResult[] = [
      {
        basketId: "A",
        series: [
          { x: "2023-01-01", y: 100, drawdown: 0 },
          { x: "2023-12-31", y: 110, drawdown: 0 },
        ],
        stats: { ...emptyStats },
      },
      {
        basketId: "B",
        series: [
          { x: "2023-01-01", y: 100, drawdown: 0 },
          { x: "2023-12-31", y: 105, drawdown: 0 },
        ],
        stats: { ...emptyStats },
      },
    ];

    const ranking = yearlyRanking(results);

    expect(ranking).toHaveLength(1);
    expect(ranking[0].year).toBe(2023);
    expect(ranking[0].kind).toBe("full");
    expect(ranking[0].order).toHaveLength(2);
    expect(ranking[0].order[0].basketId).toBe("A");
    expect(ranking[0].order[0].ret).toBeCloseTo(10, 6);
    expect(ranking[0].order[1].basketId).toBe("B");
    expect(ranking[0].order[1].ret).toBeCloseTo(5, 6);
  });

  it("does not treat SIP deposits as yearly return", () => {
    const results: BacktestResult[] = [
      {
        basketId: "sip",
        series: [
          { x: "2024-01-01", y: 10_000, drawdown: 0 },
          { x: "2024-01-02", y: 10_100, drawdown: 0 },
          { x: "2024-02-01", y: 20_100, drawdown: 0 },
        ],
        stats: { ...emptyStats },
      },
    ];

    const ranking = yearlyRanking(results, {
      mode: "sip",
      amount: 10_000,
      startIso: "2024-01-01",
    });

    expect(ranking).toHaveLength(1);
    expect(ranking[0].year).toBe(2024);
    expect(ranking[0].kind).toBe("ytd");
    // 1% market move, then a same-size SIP with 0% move. last/first is +101%.
    expect(ranking[0].order[0]!.ret).toBeCloseTo(1, 6);
  });

  it("keeps the series cashflow when the live mode has already switched", () => {
    const sip = {
      mode: "sip" as const,
      amount: 10_000,
      startIso: "2024-01-01",
    };
    const results: BacktestResult[] = [
      {
        basketId: "sip",
        series: [
          { x: "2024-01-01", y: 10_000, drawdown: 0 },
          { x: "2024-01-02", y: 10_100, drawdown: 0 },
          { x: "2024-02-01", y: 20_100, drawdown: 0 },
        ],
        stats: { ...emptyStats },
        cashflow: sip,
      },
    ];

    const ranking = yearlyRanking(results, {
      mode: "lumpsum",
      amount: 10_000,
      startIso: "2024-01-01",
    });

    expect(ranking[0]!.order[0]!.ret).toBeCloseTo(1, 6);
  });
});
