import type { SearchHit } from "../types";
import type { LabStatus } from "./labTypes";

export type SearchSession =
  | { kind: "idle" }
  | { kind: "loading"; request: string; hits: SearchHit[]; hitsQuery: string }
  | { kind: "ready"; hits: SearchHit[]; hitsQuery: string }
  | { kind: "error"; hitsQuery: string }
  | { kind: "dismissed"; request: string };

export type SearchRun = {
  query: string;
  attempt: number;
  activeIndex: number;
  session: SearchSession;
};

export const BOOT_SEARCH_RUN: SearchRun = {
  query: "",
  attempt: 0,
  activeIndex: -1,
  session: { kind: "idle" },
};

export function searchHits(run: SearchRun): SearchHit[] {
  const session = run.session;
  if (session.kind === "loading" || session.kind === "ready") return session.hits;
  return [];
}

export function searchHitsQuery(run: SearchRun): string {
  const session = run.session;
  if (session.kind === "loading" || session.kind === "ready") return session.hitsQuery;
  if (session.kind === "error") return session.hitsQuery;
  return "";
}

export function searchPhase(
  run: SearchRun,
): "idle" | "loading" | "ready" | "error" {
  return run.session.kind === "dismissed" ? "idle" : run.session.kind;
}

export function searchListOpen(run: SearchRun): boolean {
  const kind = run.session.kind;
  return (kind === "loading" || kind === "ready") && searchHits(run).length > 0;
}

export function searchStale(run: SearchRun): boolean {
  const hitsQuery = searchHitsQuery(run);
  return hitsQuery.length > 0 && run.query.trim() !== hitsQuery;
}

export function searchStatus(run: SearchRun): LabStatus {
  if (run.session.kind === "loading") return { kind: "search-busy" };
  if (run.session.kind === "error") return { kind: "search-down" };
  return { kind: "ready" };
}

export function typeQuery(run: SearchRun, query: string): SearchRun {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return {
      query,
      attempt: run.attempt,
      activeIndex: -1,
      session: { kind: "idle" },
    };
  }
  const session =
    run.session.kind === "dismissed" ? { kind: "idle" as const } : run.session;
  return { query, attempt: run.attempt, activeIndex: -1, session };
}

export function armFetch(run: SearchRun): SearchRun {
  const session =
    run.session.kind === "dismissed" ? { kind: "idle" as const } : run.session;
  return { ...run, attempt: run.attempt + 1, session };
}

export function dismissSearch(run: SearchRun): SearchRun {
  const trimmed = run.query.trim();
  return {
    ...run,
    activeIndex: -1,
    session:
      trimmed.length >= 2
        ? { kind: "dismissed", request: trimmed }
        : { kind: "idle" },
  };
}

export function beginFetch(run: SearchRun, request: string): SearchRun | null {
  if (run.session.kind === "dismissed" && run.session.request === request) {
    return null;
  }
  return {
    ...run,
    session: {
      kind: "loading",
      request,
      hits: searchHits(run),
      hitsQuery: searchHitsQuery(run),
    },
  };
}

export function finishFetch(
  run: SearchRun,
  request: string,
  hits: SearchHit[],
): SearchRun | null {
  if (run.session.kind !== "loading" || run.session.request !== request) {
    return null;
  }
  return {
    ...run,
    activeIndex: -1,
    session: { kind: "ready", hits, hitsQuery: request },
  };
}

export function failFetch(run: SearchRun, request: string): SearchRun | null {
  if (run.session.kind !== "loading" || run.session.request !== request) {
    return null;
  }
  return {
    ...run,
    activeIndex: -1,
    session: { kind: "error", hitsQuery: request },
  };
}

export function clearAfterSelect(run: SearchRun): SearchRun {
  return {
    query: "",
    attempt: run.attempt,
    activeIndex: -1,
    session: { kind: "idle" },
  };
}

export function moveActive(run: SearchRun, index: number): SearchRun {
  return { ...run, activeIndex: index };
}
