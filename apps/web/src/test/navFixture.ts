import type { NavPoint } from "../types";

/** Two funds, three month-ends, easy mental math. */
export const NAV_A: NavPoint[] = [
  { date: "2023-01-01", nav: 10 },
  { date: "2023-02-01", nav: 11 },
  { date: "2024-01-01", nav: 12 },
];

export const NAV_B: NavPoint[] = [
  { date: "2023-01-01", nav: 20 },
  { date: "2023-02-01", nav: 20 },
  { date: "2024-01-01", nav: 22 },
];

/** Monthly SIP series with a late drop so max drawdown is real (negative). */
export const NAV_SIP: NavPoint[] = [
  { date: "2023-01-01", nav: 10 },
  { date: "2023-02-01", nav: 12 },
  { date: "2023-03-01", nav: 12 },
  { date: "2023-04-01", nav: 6 },
];
