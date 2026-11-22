import { describe, expect, it } from "vitest";
import { navDatesInRange } from "./series";
import type { NavPoint } from "../types";

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
const funds = [
  { schemeCode: "S", weight: 50 },
  { schemeCode: "D", weight: 50 },
];

describe("navDatesInRange", () => {
  it("unions every weighted fund, including when the sparse series is first (SWF #24)", () => {
    const union = [
      "2023-01-02",
      "2023-03-01",
      "2023-04-01",
      "2023-06-01",
      "2024-01-01",
    ];
    expect(
      navDatesInRange(funds, { S: SPARSE, D: DENSE }, "2023-01-01", "2024-01-01"),
    ).toEqual(union);
    expect(
      navDatesInRange(funds, { D: DENSE, S: SPARSE }, "2023-01-01", "2024-01-01"),
    ).toEqual(union);
  });
});
