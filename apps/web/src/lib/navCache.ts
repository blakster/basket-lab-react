import { get, set } from "idb-keyval";
import type { NavPoint, SchemeCode } from "../types";

export type NavCacheEntry = {
  points: NavPoint[];
  /** Epoch ms when the entry was written. */
  writtenAt: number;
};

function cacheKey(code: SchemeCode): string {
  return `nav:${code}`;
}

function minDate(points: NavPoint[]): string {
  return points.reduce((a, p) => (p.date < a ? p.date : a), points[0].date);
}

function maxDate(points: NavPoint[]): string {
  return points.reduce((a, p) => (p.date > a ? p.date : a), points[0].date);
}

/** Next calendar day 21:00 Asia/Kolkata after the IST calendar day of `fromMs`. */
export function nextCalendarDay2100Ist(fromMs: number): number {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(fromMs));
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  return Date.parse(`${ny}-${nm}-${nd}T21:00:00+05:30`);
}

/** Next 21:00 IST after the calendar day of an ISO date `YYYY-MM-DD`. */
export function next2100IstAfterDate(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  return Date.parse(`${ny}-${nm}-${nd}T21:00:00+05:30`);
}

/**
 * Fresh when points cover [since, to] and the entry has not passed its TTL.
 * Prefer the plan deadline (next 21:00 IST after lastPoint.date) while it is
 * still in the future; otherwise fall back to next calendar day 21:00 IST
 * after writtenAt so historical ranges remain usable.
 */
export function isNavCacheFresh(
  points: NavPoint[],
  since: string,
  to: string,
  writtenAt: number,
  now: number = Date.now(),
): boolean {
  if (!points.length) return false;
  const min = minDate(points);
  const max = maxDate(points);
  if (min > since || max < to) return false;

  const lastPointDeadline = next2100IstAfterDate(max);
  if (now < lastPointDeadline) {
    return writtenAt <= lastPointDeadline;
  }
  return now < nextCalendarDay2100Ist(writtenAt);
}

export async function readNavCacheEntry(
  code: SchemeCode,
): Promise<NavCacheEntry | null> {
  const value = await get(cacheKey(code));
  if (value == null) return null;
  if (Array.isArray(value)) {
    return { points: value as NavPoint[], writtenAt: 0 };
  }
  const entry = value as NavCacheEntry;
  if (!entry?.points || !Array.isArray(entry.points)) return null;
  return entry;
}

export async function readNavCache(
  code: SchemeCode,
): Promise<NavPoint[] | null> {
  const entry = await readNavCacheEntry(code);
  return entry ? entry.points : null;
}

export async function writeNavCache(
  code: SchemeCode,
  points: NavPoint[],
): Promise<void> {
  const entry: NavCacheEntry = { points, writtenAt: Date.now() };
  await set(cacheKey(code), entry);
}
