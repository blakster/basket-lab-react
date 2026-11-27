import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavPoint } from "../../types";

const { fetchNavMock, readCacheMock, writeCacheMock } = vi.hoisted(() => ({
  fetchNavMock: vi.fn(),
  readCacheMock: vi.fn(),
  writeCacheMock: vi.fn(),
}));

vi.mock("../api/nav", () => ({
  fetchNav: (...args: unknown[]) => fetchNavMock(...args),
}));

vi.mock("../navCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../navCache")>();
  return {
    ...actual,
    readNavCacheEntry: (...args: unknown[]) => readCacheMock(...args),
    writeNavCache: (...args: unknown[]) => writeCacheMock(...args),
  };
});

import { loadCachedPortfolioNav, lookupNavOnOrBefore } from "./portfolioNav";

describe("portfolioNav", () => {
  beforeEach(() => {
    fetchNavMock.mockReset();
    readCacheMock.mockReset();
    writeCacheMock.mockReset();
  });

  it("fetches trade-date NAV when cache only holds an older quote past publication cutoff", async () => {
    readCacheMock.mockResolvedValue({
      points: [{ date: "2026-04-13", nav: 100 }],
      writtenAt: Date.parse("2026-04-13T16:00:00Z"),
    });
    fetchNavMock.mockResolvedValue({
      "122639": [
        { date: "2026-04-13", nav: 100 },
        { date: "2026-04-16", nav: 104 },
      ] as NavPoint[],
    });

    const hit = await lookupNavOnOrBefore(
      "122639",
      "2026-04-16",
      Date.parse("2026-04-16T17:00:00Z"),
    );
    expect(fetchNavMock).toHaveBeenCalledWith(["122639"], "2026-04-09", "2026-04-16");
    expect(hit).toEqual({ date: "2026-04-16", nav: 104 });
    expect(writeCacheMock).not.toHaveBeenCalled();
  });

  it("keeps recent cached quotes offline for funds bought after the shared portfolio start", async () => {
    readCacheMock.mockResolvedValue({
      points: [
        { date: "2026-04-10", nav: 50 },
        { date: "2026-04-17", nav: 52 },
      ],
      writtenAt: Date.parse("2026-04-17T16:00:00Z"),
    });
    fetchNavMock.mockResolvedValue({ "122639": [] });

    const navs = await loadCachedPortfolioNav(
      ["122639"],
      "2025-06-01",
      "2026-04-18",
      { "122639": "2026-04-10" },
    );
    expect(navs["122639"]).toHaveLength(2);
    expect(navs["122639"]![1]).toEqual({ date: "2026-04-17", nav: 52 });
  });

  it("rejects stale unrelated cache entries offline when they do not reach the valuation date", async () => {
    readCacheMock.mockResolvedValue({
      points: [{ date: "2025-06-01", nav: 40 }],
      writtenAt: Date.parse("2025-06-01T16:00:00Z"),
    });
    fetchNavMock.mockResolvedValue({ "122639": [] });

    const navs = await loadCachedPortfolioNav(
      ["122639"],
      "2025-06-01",
      "2026-04-18",
    );
    expect(navs["122639"]).toEqual([]);
  });
});
