import { fetchNav } from "../api/nav";
import {
  isNavCacheFresh,
  next2100IstAfterDate,
  readNavCacheEntry,
  writeNavCache,
  type NavCacheEntry,
} from "../navCache";
import { firstIso, lastIso } from "../series";
import { nextBasketColor } from "../theme";
import type { Basket, NavPoint } from "../../types";

const PORTFOLIO_NAV_LOOKBACK_DAYS = 7;
const RANGE_SLACK_DAYS = 4;

export function localTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftIsoDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
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

/** Stale-cache reuse: overlaps [since, to] and reaches `to` within slack. */
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
  now: number = Date.now(),
): boolean {
  if (!entry.points.length) return false;
  if (!entry.points.some((p) => p.date <= since)) return false;
  if (!coversEnd(entry.points, to)) return false;
  const min = firstIso(entry.points);
  const max = lastIso(entry.points);
  // When the live endpoint `to` is missing from cache, only reuse yesterday's
  // quote before the next 21:00 IST publication cutoff; never let a historical
  // write-time TTL certify a missing live NAV after publication time.
  if (max < to && now >= next2100IstAfterDate(max)) {
    return false;
  }
  return isNavCacheFresh(
    entry.points,
    since < min ? min : since,
    to > max ? max : to,
    entry.writtenAt,
    now,
  );
}

function mergeNav(a: NavPoint[], b: NavPoint[]): NavPoint[] {
  const byDate = new Map<string, number>();
  for (const p of a) byDate.set(p.date, p.nav);
  for (const p of b) byDate.set(p.date, p.nav);
  return [...byDate.entries()]
    .map(([date, nav]) => ({ date, nav }))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/**
 * Load portfolio NAV history using the shared IndexedDB cache with a 7-day
 * lookback so weekend, holiday, or pre-21:00 IST transactions still price.
 */
export async function loadCachedPortfolioNav(
  codes: string[],
  since: string,
  to: string,
  sinceByCode?: Record<string, string>,
): Promise<Record<string, NavPoint[]>> {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return {};

  const navs: Record<string, NavPoint[]> = {};
  const toFetch: string[] = [];
  const entries = new Map<string, NavCacheEntry | null>();

  await Promise.all(
    unique.map(async (code) => {
      const codeSince = sinceByCode?.[code] ?? since;
      try {
        const entry = await readNavCacheEntry(code);
        entries.set(code, entry);
        if (entry && cacheUsable(entry, codeSince, to)) {
          navs[code] = entry.points;
          return;
        }
      } catch {
        entries.set(code, null);
      }
      toFetch.push(code);
    }),
  );

  if (toFetch.length) {
    const fetchSince = shiftIsoDays(since, -PORTFOLIO_NAV_LOOKBACK_DAYS);
    let fetched: Record<string, NavPoint[]> = {};
    try {
      fetched = await fetchNav(toFetch, fetchSince, to);
    } catch {
      fetched = {};
    }
    await Promise.all(
      toFetch.map(async (code) => {
        const points = fetched[code] ?? [];
        const prev = entries.get(code);
        const codeSince = sinceByCode?.[code] ?? since;
        if (points.length) {
          const merged = mergeNav(prev?.points ?? [], points);
          try {
            await writeNavCache(code, merged);
          } catch {
            // Ignore IndexedDB quota/private-mode errors.
          }
          navs[code] = merged;
        } else if (prev && cacheOverlapsRange(prev.points, codeSince, to)) {
          navs[code] = prev.points;
        } else {
          navs[code] = [];
        }
      }),
    );
  }

  return navs;
}

/**
 * Look up a single fund's NAV on or shortly before `isoDate` for manual entry
 * autofill. Returns an exact cached date match immediately (or a prior quote
 * only if no newer NAV publication is due yet). Otherwise fetches the 7-day
 * lookback window without writing disjoint slices into the shared cache,
 * falling back to the cached prior quote only if the provider returns nothing.
 */
export async function lookupNavOnOrBefore(
  code: string,
  isoDate: string,
  now: number = Date.now(),
): Promise<NavPoint | null> {
  if (!code || !isoDate) return null;
  const lookbackStart = shiftIsoDays(isoDate, -PORTFOLIO_NAV_LOOKBACK_DAYS);
  let cachedHit: NavPoint | null = null;
  try {
    const cached = await readNavCacheEntry(code);
    const hit = navPointOnOrBefore(cached?.points, isoDate);
    if (hit && hit.date >= lookbackStart) {
      if (hit.date === isoDate) return hit;
      if (now < next2100IstAfterDate(hit.date)) return hit;
      cachedHit = hit;
    }
  } catch {
    // Fall through to network fetch.
  }
  try {
    const fetched = await fetchNav([code], lookbackStart, isoDate);
    const hit = navPointOnOrBefore(fetched[code], isoDate);
    if (
      hit &&
      hit.date >= lookbackStart &&
      (!cachedHit || hit.date >= cachedHit.date)
    ) {
      return hit;
    }
  } catch {
    // Fall back to cached quote if network fails.
  }
  return cachedHit;
}

export function navPointOnOrBefore(
  points: NavPoint[] | undefined,
  isoDate: string,
): NavPoint | null {
  if (!points?.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.date <= isoDate) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? points[ans]! : null;
}

export const PORTFOLIO_BASKET_ID = "portfolio-mirror";

export function buildPortfolioBasket(
  holdings: Array<{
    schemeCode: string;
    schemeName: string;
    isin: string | null;
    value: number;
  }>,
  existingBaskets: Basket[],
): Basket | null {
  const byCode = new Map<
    string,
    { schemeCode: string; schemeName: string; isin: string | null; value: number }
  >();
  for (const h of holdings) {
    if (!h.schemeCode || !(h.value > 0)) continue;
    const prev = byCode.get(h.schemeCode);
    if (prev) prev.value += h.value;
    else byCode.set(h.schemeCode, { ...h });
  }
  const items = [...byCode.values()].sort((a, b) => b.value - a.value);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!items.length || !(total > 0)) return null;

  const rawWeights = items.map((item) => Math.floor((item.value / total) * 10000));
  let remainder = 10000 - rawWeights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < rawWeights.length && remainder > 0; i++) {
    rawWeights[i] += 1;
    remainder -= 1;
  }

  const existing = existingBaskets.find((b) => b.id === PORTFOLIO_BASKET_ID);
  return {
    id: PORTFOLIO_BASKET_ID,
    name: existing?.name ?? "My Portfolio",
    color: existing?.color ?? nextBasketColor(existingBaskets),
    active: true,
    funds: items.map((item, idx) => ({
      schemeCode: item.schemeCode,
      schemeName: item.schemeName,
      isin: item.isin,
      weight: rawWeights[idx]! / 100,
      locked: false,
    })),
  };
}
