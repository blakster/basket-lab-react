import { describe, expect, it } from "vitest";
import { applyWeightChange, readWeightDraft } from "./weights";
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
});
