import { describe, expect, it } from "vitest";
import type { BacktestResult, NavPoint } from "../../types";
import { dailyTwrs } from "../risk";
import {
  computeMetrics,
  METRICS,
  metricClass,
  metricLabel,
  metricText,
} from "./metrics";
import { backtestPlan } from "./performance";
import { NAV_A, NAV_SIP } from "../../test/navFixture";

const settings = {
  mode: "lumpsum" as const,
  amount: 10000,
  period: "Custom" as const,
  customStart: "2023-01-01",
  customEnd: "2024-01-01",
};

const basket = {
  id: "b1",
  name: "One fund",
  color: "#111111",
  active: true,
  funds: [
    {
      schemeCode: "A",
      schemeName: "Fund A",
      isin: null,
      weight: 100,
      locked: false,
    },
  ],
};

function result(mode: "lumpsum" | "sip"): BacktestResult {
  return backtestPlan(
    basket,
    { A: mode === "sip" ? NAV_SIP : NAV_A },
    { ...settings, mode },
    mode === "sip" ? { kind: "sip", stepUp: 0 } : { kind: "lumpsum" },
  );
}

describe("metric registry", () => {
  it("labels the annualised rate CAGR for lumpsum and XIRR for SIP", () => {
    expect(metricLabel("rate", result("lumpsum"))).toBe("CAGR");
    expect(metricLabel("rate", result("sip"))).toBe("XIRR");
    expect(metricLabel("rate")).toBe("Rate");
  });

  it("computes every registered metric from a BacktestResult", () => {
    const lump = result("lumpsum");
    const m = computeMetrics(lump);
    expect(m.rate).toBe(lump.stats.cagr);
    expect(m.mdd).toBe(lump.stats.mdd);
    expect(m.vol).not.toBeNull();
    expect(m.sharpe).not.toBeNull();
    // NAV_A only rises, so there are no downside returns.
    expect(m.sortino).toBeNull();
  });

  it("strips SIP contributions before Sharpe/Sortino", () => {
    const sip = result("sip");
    const m = computeMetrics(sip);
    expect(m.rate).toBe(sip.stats.cagr);
    expect(m.mdd).toBeLessThan(0);
    expect(m.sharpe).not.toBeNull();
    expect(m.sortino).not.toBeNull();
  });

  it("strips step-up and skipped installments, so every SIP plan yields the same TWRs", () => {
    // 25 monthly NAVs with ups and downs: year two (12+ months in) is where
    // step-up applies and the skip window lands.
    const nav: NavPoint[] = Array.from({ length: 25 }, (_, i) => {
      const d = new Date("2023-01-01T00:00:00");
      d.setMonth(d.getMonth() + i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { date, nav: 10 + (i % 7) - (i > 12 ? 2 : 0) };
    });
    const sipSettings = { ...settings, mode: "sip" as const };
    const plans = [
      { kind: "sip" as const, stepUp: 0 },
      { kind: "sip" as const, stepUp: 0.1 },
      {
        kind: "sip" as const,
        stepUp: 0,
        skipStartIso: "2024-01-01",
        skipEndIso: "2025-01-01",
        skipEndInclusive: false,
      },
    ];
    const twrSets = plans.map((plan) => {
      const r = backtestPlan(basket, { A: nav }, sipSettings, plan);
      expect(r.error).toBeUndefined();
      return dailyTwrs(r.series, r.cashflow);
    });
    expect(twrSets[0].length).toBeGreaterThan(0);
    for (const twrs of twrSets) {
      expect(twrs).toEqual(twrSets[0]);
    }
  });

  it("reuses precomputed TWRs when provided", () => {
    const lump = result("lumpsum");
    const direct = computeMetrics(lump);
    const reused = computeMetrics(lump, { twrs: [] });
    expect(reused.vol).toBeNull();
    expect(reused.sharpe).toBeNull();
    expect(direct.vol).not.toBeNull();
  });

  it("formats and tones values consistently", () => {
    expect(metricText("rate", 12.345)).toBe("12.35%");
    expect(metricText("sharpe", 1.234)).toBe("1.23");
    expect(metricText("mdd", null)).toBe("—");
    expect(metricClass("rate", 5)).toBe("num-gain");
    expect(metricClass("rate", -5)).toBe("num-loss");
    expect(metricClass("mdd", -8)).toBe("num-loss");
    expect(metricClass("sharpe", null)).toBe("num-empty");
    expect(METRICS.mdd.format(-6.5)).toBe("-6.50%");
  });
});
