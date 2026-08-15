import { describe, expect, it } from "vitest";
import { sharpeFromSeries } from "./sharpe";
import type { TimePoint } from "../types";

function series(values: number[]): TimePoint[] {
  return values.map((y, i) => ({
    x: `2024-01-${String(i + 1).padStart(2, "0")}`,
    y,
    drawdown: 0,
  }));
}

describe("sharpeFromSeries", () => {
  it("returns null when there are fewer than 3 points", () => {
    expect(sharpeFromSeries([])).toBeNull();
    expect(sharpeFromSeries(series([100]))).toBeNull();
    expect(sharpeFromSeries(series([100, 110]))).toBeNull();
  });

  it("returns null for a constant series (sample stdev is 0)", () => {
    expect(sharpeFromSeries(series([100, 100, 100, 100]))).toBeNull();
  });

  it("returns a finite positive number for a rising series", () => {
    const value = sharpeFromSeries(series([100, 101, 103, 106]));
    expect(value).not.toBeNull();
    expect(Number.isFinite(value)).toBe(true);
    expect(value!).toBeGreaterThan(0);
  });
});
