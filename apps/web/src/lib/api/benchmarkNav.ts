import type { NavPoint } from "../../types";
import { fetchNav } from "./nav";
import { readNavCacheEntry, writeNavCache } from "../navCache";

export const NIFTY_BEES_CODE = "140084";

function mergeNav(a: NavPoint[], b: NavPoint[]): NavPoint[] {
  const byDate = new Map<string, number>();
  for (const p of a) byDate.set(p.date, p.nav);
  for (const p of b) byDate.set(p.date, p.nav);
  return [...byDate.entries()]
    .map(([date, nav]) => ({ date, nav }))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

function inRange(points: NavPoint[], since: string, to: string): NavPoint[] {
  return points.filter((p) => p.date >= since && p.date <= to);
}

/** Nifty BeES NAV for alpha/beta. Cache first; TigZig/MFAPI if the range is thin. */
export async function loadNiftyBeesNav(
  since: string,
  to: string,
): Promise<NavPoint[]> {
  const cached = await readNavCacheEntry(NIFTY_BEES_CODE);
  if (cached?.points.length) {
    const slice = inRange(cached.points, since, to);
    if (slice.length >= 3) return slice;
  }

  const fetched = await fetchNav([NIFTY_BEES_CODE], since, to);
  const pts = fetched[NIFTY_BEES_CODE] ?? [];
  if (pts.length) {
    const merged = cached?.points.length ? mergeNav(cached.points, pts) : pts;
    await writeNavCache(NIFTY_BEES_CODE, merged);
  }
  return inRange(pts, since, to);
}
