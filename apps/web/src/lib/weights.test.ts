import { describe, expect, it } from "vitest";
import { applyWeightChange } from "./weights";
import type { FundLine } from "../types";

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
