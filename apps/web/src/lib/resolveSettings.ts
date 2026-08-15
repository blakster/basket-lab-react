import type { Period } from "../types";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Calendar Y-M-D: UTC if the instant is UTC midnight (ISO date-only). */
function calendarYmd(date: Date): { y: number; m: number; d: number } {
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return {
      y: date.getUTCFullYear(),
      m: date.getUTCMonth() + 1,
      d: date.getUTCDate(),
    };
  }
  return {
    y: date.getFullYear(),
    m: date.getMonth() + 1,
    d: date.getDate(),
  };
}

/** Resolve a named period (or Custom ISO bounds) to inclusive start/end dates. */
export function resolveRange(
  period: Period,
  customStart: string | null,
  customEnd: string | null,
  today: Date = new Date(),
): { start: string; end: string } {
  const { y, m, d } = calendarYmd(today);
  if (period === "Custom") {
    return {
      start: customStart ?? ymd(y, m, d),
      end: customEnd ?? ymd(y, m, d),
    };
  }

  const end = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(end);
  switch (period) {
    case "3M":
      start.setUTCMonth(start.getUTCMonth() - 3);
      break;
    case "6M":
      start.setUTCMonth(start.getUTCMonth() - 6);
      break;
    case "1Y":
      start.setUTCFullYear(start.getUTCFullYear() - 1);
      break;
    case "3Y":
      start.setUTCFullYear(start.getUTCFullYear() - 3);
      break;
    case "5Y":
      start.setUTCFullYear(start.getUTCFullYear() - 5);
      break;
    case "10Y":
      start.setUTCFullYear(start.getUTCFullYear() - 10);
      break;
  }

  return {
    start: ymd(
      start.getUTCFullYear(),
      start.getUTCMonth() + 1,
      start.getUTCDate(),
    ),
    end: ymd(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()),
  };
}
