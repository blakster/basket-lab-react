import { describe, expect, it } from "vitest";
import { resolveRange } from "./resolveSettings";

describe("resolveRange", () => {
  it('maps 1Y from 2024-01-15 to { start: "2023-01-15", end: "2024-01-15" }', () => {
    expect(resolveRange("1Y", null, null, new Date("2024-01-15"))).toEqual({
      start: "2023-01-15",
      end: "2024-01-15",
    });
  });

  it("maps 3M from 2024-01-15 to start 2023-10-15", () => {
    expect(resolveRange("3M", null, null, new Date("2024-01-15")).start).toBe(
      "2023-10-15",
    );
  });

  it("returns Custom ISO bounds unchanged", () => {
    expect(
      resolveRange("Custom", "2020-01-01", "2021-01-01", new Date("2024-01-15")),
    ).toEqual({
      start: "2020-01-01",
      end: "2021-01-01",
    });
  });
});
