import { describe, expect, it } from "vitest";
import type { NavPoint, TimePoint } from "../types";
import {
  alphaBeta,
  calmar,
  correlation,
  dailyTwrs,
  navToTwrs,
  rollingCagr,
  sortinoFromTwrs,
  volatilityFromTwrs,
  type CashflowSpec,
} from "./risk";

function pt(x: string, y: number): TimePoint {
  return { x, y, drawdown: 0 };
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tradingDates(startIso: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${startIso}T00:00:00`);
  while (out.length < n) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) out.push(iso(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function growingSeries(startIso: string, n: number, startY: number, daily: number): TimePoint[] {
  return tradingDates(startIso, n).map((x, i) => pt(x, startY * (1 + daily) ** i));
}

describe("dailyTwrs", () => {
  it("returns empty when there are fewer than 2 points", () => {
    expect(dailyTwrs([])).toEqual([]);
    expect(dailyTwrs([pt("2024-01-01", 100)])).toEqual([]);
  });

  it("uses value-to-value returns for lumpsum", () => {
    const twrs = dailyTwrs([
      pt("2024-01-01", 100),
      pt("2024-01-02", 101),
      pt("2024-01-03", 99.99),
    ]);
    expect(twrs).toHaveLength(2);
    expect(twrs[0]!.r).toBeCloseTo(0.01, 10);
    expect(twrs[1]!.r).toBeCloseTo(99.99 / 101 - 1, 10);
    expect(twrs[0]!.date).toBe("2024-01-02");
  });

  it("strips SIP cash additions from daily TWR", () => {
    const cashflow: CashflowSpec = {
      mode: "sip",
      amount: 10_000,
      startIso: "2024-01-01",
    };
    const twrs = dailyTwrs(
      [
        pt("2024-01-01", 10_000),
        pt("2024-01-02", 10_100),
        pt("2024-02-01", 20_100),
      ],
      cashflow,
    );
    expect(twrs[0]!.r).toBeCloseTo(0.01, 10);
    expect(twrs[1]!.r).toBeCloseTo(0, 10);
  });

  it("skips a step when a previous value is 0", () => {
    expect(dailyTwrs([pt("2024-01-01", 0), pt("2024-01-02", 100)])).toEqual([]);
  });
});

describe("volatilityFromTwrs", () => {
  it("returns null without at least 2 returns", () => {
    expect(volatilityFromTwrs([])).toBeNull();
    expect(volatilityFromTwrs([0.01])).toBeNull();
  });

  it("returns null when sample stdev is 0", () => {
    expect(volatilityFromTwrs([0.01, 0.01, 0.01])).toBeNull();
  });

  it("annualizes sample stdev as a percent", () => {
    const rs = [0.01, -0.01, 0.02];
    const mean = rs.reduce((a, r) => a + r, 0) / rs.length;
    const sq = rs.reduce((a, r) => a + (r - mean) ** 2, 0) / (rs.length - 1);
    const expected = Math.sqrt(sq) * Math.sqrt(252) * 100;
    expect(volatilityFromTwrs(rs)).toBeCloseTo(expected, 10);
  });
});

describe("sortinoFromTwrs", () => {
  it("returns null when there are no negative returns", () => {
    expect(sortinoFromTwrs([0.01, 0.02, 0.03])).toBeNull();
  });

  it("uses downside deviation only", () => {
    const rs = [0.01, -0.02, 0.03];
    const mean = rs.reduce((a, r) => a + r, 0) / rs.length;
    const down = rs.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / rs.length;
    const expected = (Math.sqrt(252) * mean) / Math.sqrt(down);
    expect(sortinoFromTwrs(rs)).toBeCloseTo(expected, 10);
  });
});

describe("calmar", () => {
  it("returns null when max drawdown is 0", () => {
    expect(calmar(12, 0)).toBeNull();
  });

  it("is CAGR over absolute max drawdown", () => {
    expect(calmar(15, -20)).toBeCloseTo(0.75, 10);
    expect(calmar(15, 20)).toBeCloseTo(0.75, 10);
  });
});

describe("rollingCagr", () => {
  it("returns null when the series is shorter than the window", () => {
    const series = growingSeries("2024-01-01", 10, 100, 0.001);
    const twrs = dailyTwrs(series);
    expect(rollingCagr(series, twrs, 252)).toBeNull();
  });

  it("reports min, median, and max of window CAGRs", () => {
    const series = growingSeries("2020-01-01", 260, 100, 0.001);
    const twrs = dailyTwrs(series);
    const roll = rollingCagr(series, twrs, 252);
    expect(roll).not.toBeNull();
    expect(roll!.min).toBeLessThanOrEqual(roll!.median);
    expect(roll!.median).toBeLessThanOrEqual(roll!.max);
    expect(roll!.min).toBeGreaterThan(0);
  });
});

describe("alphaBeta", () => {
  it("returns null without overlapping dates or when bench variance is 0", () => {
    expect(
      alphaBeta(
        [{ date: "2024-01-02", r: 0.01 }],
        [{ date: "2024-01-03", r: 0.01 }],
      ),
    ).toBeNull();
    expect(
      alphaBeta(
        [
          { date: "2024-01-02", r: 0.02 },
          { date: "2024-01-03", r: 0.04 },
        ],
        [
          { date: "2024-01-02", r: 0.01 },
          { date: "2024-01-03", r: 0.01 },
        ],
      ),
    ).toBeNull();
  });

  it("recovers beta 2 and ~0 alpha when the basket is 2x the bench", () => {
    const bench = [
      { date: "2024-01-02", r: 0.01 },
      { date: "2024-01-03", r: -0.02 },
      { date: "2024-01-04", r: 0.015 },
    ];
    const basket = bench.map((p) => ({ date: p.date, r: p.r * 2 }));
    const ab = alphaBeta(basket, bench);
    expect(ab).not.toBeNull();
    expect(ab!.beta).toBeCloseTo(2, 8);
    expect(ab!.alpha).toBeCloseTo(0, 8);
  });
});

describe("correlation", () => {
  it("is 1 for identical aligned series", () => {
    const a = [
      { date: "2024-01-02", r: 0.01 },
      { date: "2024-01-03", r: -0.02 },
      { date: "2024-01-04", r: 0.03 },
    ];
    expect(correlation(a, a)).toBeCloseTo(1, 10);
  });

  it("returns null without 2 overlapping dates", () => {
    expect(
      correlation(
        [{ date: "2024-01-02", r: 0.01 }],
        [{ date: "2024-01-02", r: 0.02 }],
      ),
    ).toBeNull();
  });
});

describe("navToTwrs", () => {
  it("converts a NAV series to dated returns", () => {
    const navs: NavPoint[] = [
      { date: "2024-01-01", nav: 100 },
      { date: "2024-01-02", nav: 102 },
    ];
    const twrs = navToTwrs(navs);
    expect(twrs).toHaveLength(1);
    expect(twrs[0]!.date).toBe("2024-01-02");
    expect(twrs[0]!.r).toBeCloseTo(0.02, 10);
  });
});
