import { describe, expect, it } from "vitest";
import {
  applyWeightChange,
  hasWeightOverflow,
  isWeightBalanced,
  readWeightDraft,
  WEIGHT_CENT,
  WEIGHT_TOLERANCE,
} from "./weights";
import type { FundLine } from "../types";

describe("readWeightDraft", () => {
  it("treats a cleared field as empty, not zero", () => {
    expect(readWeightDraft("")).toEqual({ status: "empty" });
  });

  it("keeps leftover zeros from 100 as text instead of snapping to 0", () => {
    expect(readWeightDraft("00")).toEqual({ status: "partial", text: "00" });
  });

  it("keeps a trailing decimal while typing 10.5", () => {
    expect(readWeightDraft("10.")).toEqual({ status: "partial", text: "10." });
  });

  it("parses a finished number", () => {
    expect(readWeightDraft("40")).toEqual({
      status: "value",
      text: "40",
      value: 40,
    });
  });
});

const funds: FundLine[] = [
  { schemeCode: "A", schemeName: "A", isin: null, weight: 50, locked: false },
  { schemeCode: "B", schemeName: "B", isin: null, weight: 50, locked: false },
  { schemeCode: "C", schemeName: "C", isin: null, weight: 0, locked: true },
];

describe("applyWeightChange", () => {
  it("raising A to 70 pulls B to 30", () => {
    const next = applyWeightChange(funds, "A", 70);
    expect(next.find((f) => f.schemeCode === "A")!.weight).toBeCloseTo(70, 2);
    expect(next.find((f) => f.schemeCode === "B")!.weight).toBeCloseTo(30, 2);
    expect(next.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(100, 1);
  });

  it("does not change a locked fund", () => {
    const locked: FundLine[] = [
      { schemeCode: "A", schemeName: "A", isin: null, weight: 40, locked: true },
      { schemeCode: "B", schemeName: "B", isin: null, weight: 60, locked: false },
    ];
    const next = applyWeightChange(locked, "B", 70);
    expect(next.find((f) => f.schemeCode === "A")!.weight).toBe(40);
    expect(next.find((f) => f.schemeCode === "B")!.weight).toBeCloseTo(60, 2);
  });

  it("redistributes overflow between WEIGHT_CENT and WEIGHT_TOLERANCE", () => {
    const start: FundLine[] = [
      { schemeCode: "A", schemeName: "A", isin: null, weight: 50, locked: false },
      { schemeCode: "B", schemeName: "B", isin: null, weight: 50, locked: false },
    ];
    const next = applyWeightChange(start, "A", 50.05);
    expect(next.find((f) => f.schemeCode === "A")!.weight).toBeCloseTo(50.05, 2);
    expect(next.find((f) => f.schemeCode === "B")!.weight).toBeCloseTo(49.95, 2);
    expect(next.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(100, 2);
  });
});

describe("weight constants", () => {
  it("keeps cent smaller than basket-valid window", () => {
    expect(WEIGHT_CENT).toBe(0.01);
    expect(WEIGHT_TOLERANCE).toBe(0.1);
    expect(WEIGHT_CENT).toBeLessThan(WEIGHT_TOLERANCE);
  });

  it("treats 5 cents as overflow and as a still-balanced basket", () => {
    expect(hasWeightOverflow(0.05)).toBe(true);
    expect(hasWeightOverflow(0.005)).toBe(false);
    expect(isWeightBalanced(99.95)).toBe(true);
    expect(isWeightBalanced(99.85)).toBe(false);
  });
});
