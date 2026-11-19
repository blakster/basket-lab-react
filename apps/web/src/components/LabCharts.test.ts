import { describe, expect, it } from "vitest";
import { chartRows } from "./LabCharts";
import type { TimePoint } from "../types";

const series = (id: number, days: string[]): TimePoint[] =>
  days.map((d, i) => ({ x: d, y: id * 1000 + i * 10.4, drawdown: -i * 1.234 }));

function index(points: TimePoint[]): Map<string, TimePoint> {
  const m = new Map<string, TimePoint>();
  for (const p of points) {
    if (!m.has(p.x)) m.set(p.x, p);
  }
  return m;
}

describe("chartRows", () => {
  const dates = ["2023-01-01", "2023-01-02", "2023-01-03"];
  const keys = [
    { key: "b_a", byDate: index(series(1, dates)) },
    // b_b has no point on 2023-01-02
    { key: "b_b", byDate: index(series(2, ["2023-01-01", "2023-01-03"])) },
  ];

  it("builds one row per union date, null where a basket lacks the date", () => {
    expect(chartRows(dates, keys, (p) => Math.round(p.y))).toEqual([
      { date: "2023-01-01", b_a: 1000, b_b: 2000 },
      { date: "2023-01-02", b_a: 1010, b_b: null },
      { date: "2023-01-03", b_a: 1021, b_b: 2010 },
    ]);
  });

  it("applies the value transform per chart (rounded y / 2dp drawdown)", () => {
    const growth = chartRows(dates, keys, (p) => Math.round(p.y));
    const drawdown = chartRows(dates, keys, (p) =>
      Number(p.drawdown.toFixed(2)),
    );
    expect(growth[0]!.b_a).toBe(1000);
    expect(drawdown.map((r) => r.b_a)).toEqual([0, -1.23, -2.47]);
  });

  it("keeps the first point when a date repeats, like series.find did", () => {
    const dup: TimePoint[] = [
      { x: "2023-01-01", y: 111, drawdown: 0 },
      { x: "2023-01-01", y: 999, drawdown: -5 },
    ];
    const rows = chartRows(
      ["2023-01-01"],
      [{ key: "b_a", byDate: index(dup) }],
      (p) => Math.round(p.y),
    );
    expect(rows[0]!.b_a).toBe(111);
  });
});
