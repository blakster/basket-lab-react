import type { BacktestResult, NavPoint } from "../types";
import type { LabStatus } from "./labTypes";

export type NavMap = Record<string, NavPoint[]>;

export type NavDisplay =
  | { kind: "idle" }
  | { kind: "bad-range" }
  | { kind: "no-nav"; results: BacktestResult[]; navByCode: NavMap }
  | { kind: "ready"; results: BacktestResult[]; navByCode: NavMap }
  | { kind: "cached-nav"; results: BacktestResult[]; navByCode: NavMap; detail?: string };

export type NavRun = {
  id: number;
  analyzing: boolean;
  display: NavDisplay;
};

export const BOOT_NAV_RUN: NavRun = {
  id: 0,
  analyzing: false,
  display: { kind: "ready", results: [], navByCode: {} },
};

export function navResults(run: NavRun): BacktestResult[] {
  const display = run.display;
  if (display.kind === "idle" || display.kind === "bad-range") return [];
  return display.results;
}

export function navMap(run: NavRun): NavMap {
  const display = run.display;
  if (display.kind === "idle" || display.kind === "bad-range") return {};
  return display.navByCode;
}

export function navStatus(run: NavRun): LabStatus {
  if (run.display.kind === "cached-nav") {
    return { kind: "cached-nav", detail: run.display.detail };
  }
  return { kind: run.display.kind };
}

export function beginNavRun(prev: NavRun, id: number): NavRun {
  return { id, analyzing: true, display: prev.display };
}

export function finishIdle(id: number): NavRun {
  return { id, analyzing: false, display: { kind: "idle" } };
}

export function finishBadRange(id: number): NavRun {
  return { id, analyzing: false, display: { kind: "bad-range" } };
}

export function finishReady(
  id: number,
  results: BacktestResult[],
  navByCode: NavMap,
): NavRun {
  return {
    id,
    analyzing: false,
    display: { kind: "ready", results, navByCode },
  };
}

export function finishCached(
  id: number,
  results: BacktestResult[],
  navByCode: NavMap,
  detail?: string,
): NavRun {
  return {
    id,
    analyzing: false,
    display: { kind: "cached-nav", results, navByCode, detail },
  };
}

export function finishNoNav(
  id: number,
  results: BacktestResult[],
  navByCode: NavMap,
): NavRun {
  return {
    id,
    analyzing: false,
    display: { kind: "no-nav", results, navByCode },
  };
}

export function finishFailed(id: number): NavRun {
  return {
    id,
    analyzing: false,
    display: { kind: "no-nav", results: [], navByCode: {} },
  };
}

export function commitNavRun(
  id: number,
  results: BacktestResult[],
  navByCode: NavMap,
  staleCacheCodes: Set<string>,
): NavRun {
  const allNoNav =
    results.length > 0 && results.every((row) => row.error === "no-nav");
  if (allNoNav) return finishNoNav(id, results, navByCode);
  if (staleCacheCodes.size) {
    let detail = "";
    for (const code of staleCacheCodes) {
      const points = navByCode[code];
      if (!points?.length) continue;
      const last = points.reduce(
        (best, point) => (point.date > best ? point.date : best),
        points[0].date,
      );
      if (last > detail) detail = last;
    }
    return finishCached(id, results, navByCode, detail || undefined);
  }
  return finishReady(id, results, navByCode);
}
