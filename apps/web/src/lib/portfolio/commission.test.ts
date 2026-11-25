import { describe, expect, it } from "vitest";
import type { CommissionCheckRow } from "../api/portfolio";
import {
  compoundedSavings,
  summarizeCommission,
  valuesForCommission,
} from "./commission";

const readyRow: CommissionCheckRow = {
  instrumentId: "amfi:2002",
  schemeCode: "2002",
  schemeName: "Example Flexi Fund - Regular Plan - Growth",
  directSchemeCode: "2001",
  directSchemeName: "Example Flexi Fund - Direct Plan - Growth",
  status: "ready",
  regularExpenseRatio: 1.25,
  directExpenseRatio: 0.64,
  expenseGapPct: 0.61,
  regularExpenseRatioAsOf: "2026-10-31",
  directExpenseRatioAsOf: "2026-10-31",
};

describe("compoundedSavings", () => {
  it("compounds the expense-ratio gap over the horizon", () => {
    expect(compoundedSavings(10_000, 0.61, 1)).toBeCloseTo(61);
    expect(compoundedSavings(10_000, 0.61, 5)).toBeCloseTo(308.74376741);
    expect(compoundedSavings(10_000, 0.61, 10)).toBeCloseTo(627.01980622);
  });
});

describe("summarizeCommission", () => {
  it("joins ready rows to current values and sums only calculable savings", () => {
    const missing: CommissionCheckRow = {
      instrumentId: "amfi:999999",
      schemeCode: "999999",
      schemeName: "Example Flexi Fund - Regular Plan - Growth",
      directSchemeCode: "999998",
      directSchemeName: "Example Flexi Fund - Direct Plan - Growth",
      status: "missing-expense-ratio",
    };
    const summary = summarizeCommission(
      [readyRow, missing],
      new Map([
        ["amfi:2002", 10_000],
        ["amfi:999999", 20_000],
      ]),
    );

    expect(summary.lines[0].yearlySavings).toBeCloseTo(61);
    expect(summary.lines[1].yearlySavings).toBeNull();
    expect(summary.totalYearly).toBeCloseTo(61);
    expect(summary.totalFiveYear).toBeCloseTo(308.74376741);
    expect(summary.missingCount).toBe(1);
  });

  it("does not price a successor comparison from the predecessor's stale NAV", () => {
    const values = valuesForCommission(
      [readyRow],
      new Map([["amfi:2002", 10_000]]),
      new Map([["amfi:2002", "1999"]]),
      new Set(["1999"]),
    );
    const summary = summarizeCommission([readyRow], values);

    expect(summary.lines[0].yearlySavings).toBeNull();
    expect(summary.totalYearly).toBeNull();
    expect(summary.missingCount).toBe(1);
  });

  it("keeps unavailable valuations empty instead of inventing zero savings", () => {
    const summary = summarizeCommission([readyRow], new Map([["amfi:2002", 0]]));

    expect(summary.lines[0].yearlySavings).toBeNull();
    expect(summary.totalYearly).toBeNull();
    expect(summary.missingCount).toBe(1);
  });
});
