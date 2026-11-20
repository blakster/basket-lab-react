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
import type {
  BacktestResult,
  Basket,
  LabSettings,
  NavPoint,
} from "../types";
import { writeShareQuery, weightSum } from "./basketStore";
import {
  IDLE_STATUS,
  READY_STATUS,
  type LabStatus,
  type StatusSource,
} from "./labTypes";

/** Last trading day before a weekend/holiday `to` still covers the range. */
const RANGE_SLACK_DAYS = 4;

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

export function useNavQuery(
  settings: LabSettings,
  baskets: Basket[],
  reportStatus: (source: StatusSource, next: LabStatus) => void,
) {
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [navByCode, setNavByCode] = useState<Record<string, NavPoint[]>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const runIdRef = useRef(0);

  const runAnalysis = useCallback(async () => {
    const runId = ++runIdRef.current;
    setAnalyzing(true);
    const finish = (apply?: () => void) => {
      if (runId !== runIdRef.current) return;
      apply?.();
      setAnalyzing(false);
    };
    // A guard that empties the page must also drop the header status off LIVE.
    const clearRun = () => {
      reportStatus("nav", IDLE_STATUS);
      setResults([]);
      setNavByCode({});
    };
    const { start, end } = resolveRange(
      settings.period,
      settings.customStart,
      settings.customEnd,
    );
    // A Custom window whose start is after its end is a settings error, not a
    // NAV outage: skip the fetch and flag the dates instead of BLACKOUT.
    if (start > end) {
      finish(() => {
        reportStatus("nav", { kind: "bad-range" });
        setResults([]);
        setNavByCode({});
      });
      return;
    }
    const resolved: LabSettings = {
      ...settings,
      customStart: start,
      customEnd: end,
    };
    if (settings.amount < 100) {
      finish(clearRun);
      return;
    }

    const active = baskets.filter((b) => b.active);
    if (
      active.some((b) => Math.abs(weightSum(b) - 100) >= WEIGHT_TOLERANCE)
    ) {
      finish(clearRun);
      return;
    }
    if (!active.length) {
      finish(clearRun);
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
      // Look back a week so weekend/holiday starts still have a prior NAV.
      const fetched = await fetchNav(toFetch, shiftIso(start, -7), end);
      if (runId !== runIdRef.current) return;
      await Promise.all(
        toFetch.map(async (code) => {
          const points = fetched[code] ?? [];
          const prev = entries.get(code);
          if (points.length) {
            const merged = mergeNav(prev?.points ?? [], points);
            try {
              await writeNavCache(code, merged);
            } catch {
              // Quota / private mode: still run on the live series.
            }
            navs[code] = merged;
          } else {
            // Failed fetch: reuse overlapping stale cache ("Using saved NAV"),
            // including series that start after `start` (fund launched later).
            if (prev && cacheOverlapsRange(prev.points, start, end)) {
              navs[code] = prev.points;
              staleCacheCodes.add(code);
            } else {
              navs[code] = [];
            }
          }
        }),
      );
    }

    if (runId !== runIdRef.current) return;
    const nextResults = active.map((b) =>
      backtestBasket(b, navsForBasket(b, navs), resolved),
    );
    // Global no-nav only when every active basket failed (one empty scheme
    // still leaves sibling baskets runnable and the header ready/cached-nav).
    const allNoNav =
      nextResults.length > 0 &&
      nextResults.every((r) => r.error === "no-nav");
    finish(() => {
      if (allNoNav) {
        reportStatus("nav", { kind: "no-nav" });
      } else if (staleCacheCodes.size) {
        let detail = "";
        for (const code of staleCacheCodes) {
          const pts = navs[code];
          if (!pts?.length) continue;
          const last = lastIso(pts);
          if (last > detail) detail = last;
        }
        reportStatus("nav", { kind: "cached-nav", detail: detail || undefined });
      } else {
        reportStatus("nav", READY_STATUS);
      }
      setResults(nextResults);
      setNavByCode(navs);
      writeShareQuery(settings, baskets);
    });
    } catch {
      // Don't leave the previous run's NAV paired with the new settings.
      finish(() => {
        setNavByCode({});
      });
    }
  }, [settings, baskets, reportStatus]);

  return { results, navByCode, analyzing, runAnalysis };
}
