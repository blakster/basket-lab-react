import { describe, expect, it } from "vitest";
import type { SearchHit } from "../types";
import {
  BOOT_SEARCH_RUN,
  armFetch,
  beginFetch,
  dismissSearch,
  failFetch,
  finishFetch,
  searchHits,
  searchListOpen,
  searchPhase,
  searchStatus,
  typeQuery,
  type SearchSession,
} from "./searchRun";

const hit: SearchHit = {
  schemeCode: "118741",
  schemeName: "UTI Nifty 50",
  isin: null,
};

describe("SearchRun", () => {
  it("a dismissed in-flight resolve cannot reopen the list (SWF a47bf2d)", () => {
    let run = typeQuery(BOOT_SEARCH_RUN, "nifty midcap");
    run = beginFetch(run, "nifty midcap")!;
    expect(searchPhase(run)).toBe("loading");
    run = dismissSearch(run);
    expect(run.session.kind).toBe("dismissed");
    expect(searchListOpen(run)).toBe(false);
    expect(finishFetch(run, "nifty midcap", [hit])).toBeNull();
    expect(failFetch(run, "nifty midcap")).toBeNull();
    expect(searchHits(run)).toEqual([]);
    expect(searchStatus(run).kind).toBe("ready");
  });

  it("the same dismissed query cannot start another fetch until the user types or retries", () => {
    let run = typeQuery(BOOT_SEARCH_RUN, "nifty");
    run = beginFetch(run, "nifty")!;
    run = dismissSearch(run);
    expect(beginFetch(run, "nifty")).toBeNull();
    run = armFetch(run);
    expect(beginFetch(run, "nifty")?.session.kind).toBe("loading");
  });

  it("typing after dismiss clears the dismissed lock", () => {
    let run = typeQuery(BOOT_SEARCH_RUN, "nifty");
    run = beginFetch(run, "nifty")!;
    run = dismissSearch(run);
    run = typeQuery(run, "nifty bank");
    expect(run.session.kind).toBe("idle");
    expect(beginFetch(run, "nifty bank")?.session.kind).toBe("loading");
  });

  it("stale hits stay on loading and drop on error", () => {
    let run = typeQuery(BOOT_SEARCH_RUN, "nifty");
    run = beginFetch(run, "nifty")!;
    run = finishFetch(run, "nifty", [hit])!;
    run = typeQuery(run, "nifty midcap");
    run = beginFetch(run, "nifty midcap")!;
    expect(searchHits(run)).toEqual([hit]);
    expect(searchPhase(run)).toBe("loading");
    const failed = failFetch(run, "nifty midcap")!;
    expect(searchHits(failed)).toEqual([]);
    expect(searchPhase(failed)).toBe("error");
  });

});

const idle: SearchSession = { kind: "idle" };
void idle;

const dismissedWithHits: SearchSession = {
  kind: "dismissed",
  request: "nifty",
  // @ts-expect-error dismissed has no hits. Applying them reopened the list (a47bf2d).
  hits: [hit],
};
void dismissedWithHits;
