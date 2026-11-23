export type LabStatusKind =
  | "ready"
  | "idle"
  | "cached-nav"
  | "no-nav"
  | "bad-range"
  | "search-busy"
  | "search-down"
  | "insights-down";

export type LabStatus = { kind: LabStatusKind; detail?: string };

export type StatusSource = "search" | "insights";

export const READY_STATUS: LabStatus = { kind: "ready" };
export const IDLE_STATUS: LabStatus = { kind: "idle" };

const STATUS_PRIORITY: Record<LabStatusKind, number> = {
  "bad-range": 7,
  "no-nav": 6,
  "cached-nav": 5,
  "search-down": 4,
  "search-busy": 3,
  idle: 2,
  "insights-down": 1,
  ready: 0,
};

export function pickStatus(parts: LabStatus[]): LabStatus {
  return parts.reduce((best, cur) =>
    STATUS_PRIORITY[cur.kind] > STATUS_PRIORITY[best.kind] ? cur : best,
  );
}

export type Workspace = "compare" | "portfolio" | "baskets" | "insights";
