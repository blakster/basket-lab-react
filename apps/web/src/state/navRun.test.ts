import { describe, expect, it } from "vitest";
import type { BacktestResult, NavPoint } from "../types";
import {
  BOOT_NAV_RUN,
  beginNavRun,
  commitNavRun,
  finishFailed,
  finishIdle,
  finishReady,
  navMap,
  navResults,
  navStatus,
  type NavDisplay,
} from "./navRun";

const series: NavPoint[] = [
  { date: "2023-01-01", nav: 10 },
  { date: "2024-01-01", nav: 12 },
];

const liveResult: BacktestResult = {
  basketId: "1",
  series: [],
  stats: { initial: 1000, final: 1200, abs: 20, cagr: 20, mdd: 0 },
};

describe("NavRun constructors", () => {
  it("boot is LIVE with an empty table, matching first paint", () => {
    expect(navStatus(BOOT_NAV_RUN).kind).toBe("ready");
    expect(navResults(BOOT_NAV_RUN)).toEqual([]);
  });

  it("a guard that empties the table cannot stay LIVE (SWF #28)", () => {
    const live = finishReady(1, [liveResult], { "118741": series });
    const cleared = finishIdle(2);
    expect(navResults(live)).toHaveLength(1);
    expect(navResults(cleared)).toEqual([]);
    expect(navMap(cleared)).toEqual({});
    expect(navStatus(cleared).kind).toBe("idle");
    expect(navStatus(cleared).kind).not.toBe("ready");
  });

  it("a throw cannot keep prior numbers under LIVE (SWF #40)", () => {
    const live = finishReady(1, [liveResult], { "118741": series });
    const failed = finishFailed(2);
    expect(navResults(live)[0]?.stats.final).toBe(1200);
    expect(navResults(failed)).toEqual([]);
    expect(navMap(failed)).toEqual({});
    expect(navStatus(failed).kind).toBe("no-nav");
    expect(failed.analyzing).toBe(false);
  });

  it("one empty basket does not force BLACKOUT when a sibling scored", () => {
    const mixed: BacktestResult[] = [
      { ...liveResult, basketId: "1" },
      {
        basketId: "2",
        series: [],
        stats: { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 },
        error: "no-nav",
      },
    ];
    const run = commitNavRun(3, mixed, { "118741": series }, new Set());
    expect(navStatus(run).kind).toBe("ready");
    expect(navResults(run)).toHaveLength(2);
  });

  it("every active basket failed is BLACKOUT and still keeps the rows", () => {
    const none: BacktestResult[] = [
      {
        basketId: "1",
        series: [],
        stats: { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 },
        error: "no-nav",
      },
    ];
    const run = commitNavRun(4, none, {}, new Set());
    expect(navStatus(run).kind).toBe("no-nav");
    expect(navResults(run)).toEqual(none);
  });

  it("begin keeps the previous display until the new run commits", () => {
    const live = finishReady(1, [liveResult], { "118741": series });
    const next = beginNavRun(live, 2);
    expect(next.analyzing).toBe(true);
    expect(navResults(next)).toEqual([liveResult]);
    expect(navStatus(next).kind).toBe("ready");
  });
});

const idle: NavDisplay = { kind: "idle" };
void idle;

const idleWithResults: NavDisplay = {
  kind: "idle",
  // @ts-expect-error idle has no results. Pairing empty table with LIVE was #28.
  results: [liveResult],
};
void idleWithResults;
