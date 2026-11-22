import { useCallback, useRef, useState } from "react";
import { fetchNav } from "../lib/api/nav";
import { backtestBasket } from "../lib/backtest/performance";
import {
  isNavCacheFresh,
  readNavCacheEntry,
  writeNavCache,
  type NavCacheEntry,
} from "../lib/navCache";
import { resolveRange } from "../lib/resolveSettings";
import { firstIso, lastIso, navsForBasket } from "../lib/series";
import { WEIGHT_TOLERANCE } from "../lib/weights";
import type { Basket, LabSettings, NavPoint } from "../types";
import { weightSum } from "./basketStore";
import {
  BOOT_NAV_RUN,
  beginNavRun,
  commitNavRun,
  finishBadRange,
  finishFailed,
  finishIdle,
  navMap,
  navResults,
  navStatus,
  type NavRun,
} from "./navRun";

const RANGE_SLACK_DAYS = 4;
const FETCH_LOOKBACK_DAYS = 7;

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function coversEnd(points: NavPoint[], to: string): boolean {
  if (points.some((p) => p.date >= to)) return true;
  const last = lastIso(points);
  if (last > to) return false;
  const gap =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) /
    86_400_000;
  return gap <= RANGE_SLACK_DAYS;
}

function cacheCoversRange(
  points: NavPoint[],
  since: string,
  to: string,
): boolean {
  if (!points.length) return false;
  const hasOnOrBeforeSince = points.some((p) => p.date <= since);
  if (!hasOnOrBeforeSince) return false;
  return coversEnd(points, to);
}

/** Stale-cache reuse: series overlaps the window and reaches `to` (with slack). */
function cacheOverlapsRange(
  points: NavPoint[],
  since: string,
  to: string,
): boolean {
  if (!points.length) return false;
  if (firstIso(points) > to) return false;
  if (lastIso(points) < since) return false;
  return coversEnd(points, to);
}

function cacheUsable(
  entry: NavCacheEntry,
  since: string,
  to: string,
): boolean {
  if (!cacheCoversRange(entry.points, since, to)) return false;
  const min = firstIso(entry.points);
  const max = lastIso(entry.points);
  const freshSince = since < min ? min : since;
  const freshTo = to > max ? max : to;
  return isNavCacheFresh(entry.points, freshSince, freshTo, entry.writtenAt);
}

function mergeNav(a: NavPoint[], b: NavPoint[]): NavPoint[] {
  const byDate = new Map<string, number>();
  for (const p of a) byDate.set(p.date, p.nav);
  for (const p of b) byDate.set(p.date, p.nav);
  return [...byDate.entries()]
    .map(([date, nav]) => ({ date, nav }))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

export function useNavQuery(settings: LabSettings, baskets: Basket[]) {
  const [run, setRun] = useState<NavRun>(BOOT_NAV_RUN);
  const runIdRef = useRef(0);

  const runAnalysis = useCallback(async () => {
    const runId = ++runIdRef.current;
    setRun((prev) => beginNavRun(prev, runId));
    const finish = (next: NavRun) => {
      if (runId !== runIdRef.current) return;
      setRun(next);
    };
    const { start, end } = resolveRange(
      settings.period,
      settings.customStart,
      settings.customEnd,
    );
    if (start > end) {
      finish(finishBadRange(runId));
      return;
    }
    const resolved: LabSettings = {
      ...settings,
      customStart: start,
      customEnd: end,
    };
    if (settings.amount < 100) {
      finish(finishIdle(runId));
      return;
    }

    const active = baskets.filter((b) => b.active);
    if (
      active.some((b) => Math.abs(weightSum(b) - 100) >= WEIGHT_TOLERANCE)
    ) {
      finish(finishIdle(runId));
      return;
    }
    if (!active.length) {
      finish(finishIdle(runId));
      return;
    }

    const codes = [
      ...new Set(
        active.flatMap((b) =>
          b.funds.filter((f) => f.weight > 0).map((f) => f.schemeCode),
        ),
      ),
    ];

    const navs: Record<string, NavPoint[]> = {};
    const toFetch: string[] = [];
    const entries = new Map<string, NavCacheEntry | null>();
    const staleCacheCodes = new Set<string>();

    try {
    await Promise.all(
      codes.map(async (code) => {
        try {
          const entry = await readNavCacheEntry(code);
          entries.set(code, entry);
          if (entry && cacheUsable(entry, start, end)) {
            navs[code] = entry.points;
            return;
          }
        } catch {
          entries.set(code, null);
        }
        toFetch.push(code);
      }),
    );

    if (runId !== runIdRef.current) return;

    if (toFetch.length) {
      const fetched = await fetchNav(
        toFetch,
        shiftIso(start, -FETCH_LOOKBACK_DAYS),
        end,
      );
      if (runId !== runIdRef.current) return;
      await Promise.all(
        toFetch.map(async (code) => {
          const points = fetched[code] ?? [];
          const prev = entries.get(code);
          if (points.length) {
            const merged = mergeNav(prev?.points ?? [], points);
            try {
              await writeNavCache(code, merged);
            } catch {}
            navs[code] = merged;
          } else if (prev && cacheOverlapsRange(prev.points, start, end)) {
            navs[code] = prev.points;
            staleCacheCodes.add(code);
          } else {
            navs[code] = [];
          }
        }),
      );
    }

    if (runId !== runIdRef.current) return;
    const nextResults = active.map((b) =>
      backtestBasket(b, navsForBasket(b, navs), resolved),
    );
    finish(commitNavRun(runId, nextResults, navs, staleCacheCodes));
    } catch {
      finish(finishFailed(runId));
    }
  }, [settings, baskets]);

  return {
    results: navResults(run),
    navByCode: navMap(run),
    analyzing: run.analyzing,
    navStatus: navStatus(run),
    runAnalysis,
  };
}
