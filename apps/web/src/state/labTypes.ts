export type LabStatusKind =
  | "ready"
  | "cached-nav"
  | "no-nav"
  | "search-busy"
  | "search-down"
  | "insights-down";

export type LabStatus = { kind: LabStatusKind; detail?: string };

export type StatusSource = "nav" | "search" | "insights";

export const READY_STATUS: LabStatus = { kind: "ready" };

const STATUS_PRIORITY: Record<LabStatusKind, number> = {
  "no-nav": 5,
  "cached-nav": 4,
  "search-down": 3,
  "search-busy": 2,
  "insights-down": 1,
  ready: 0,
};

export function pickStatus(parts: LabStatus[]): LabStatus {
  return parts.reduce((best, cur) =>
    STATUS_PRIORITY[cur.kind] > STATUS_PRIORITY[best.kind] ? cur : best,
  );
}

export type Workspace = "compare" | "baskets" | "insights";
