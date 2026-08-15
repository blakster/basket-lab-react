import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchNav, fetchNavWithStatus } from "./nav";
import { isNavCacheFresh, readNavCache, writeNavCache } from "../navCache";

const { store } = vi.hoisted(() => ({
  store: new Map<IDBValidKey, unknown>(),
}));

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: IDBValidKey) => store.get(key)),
  set: vi.fn(async (key: IDBValidKey, value: unknown) => {
    store.set(key, value);
  }),
}));

describe("fetchNav", () => {
  it("maps TigZig bulk schemes and requests schemes= in the URL", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(String(url)).toContain("api.tigzig.com/mf/v1/nav");
      expect(String(url)).toContain("schemes=118741");
      expect(String(url)).toContain("since=2023-01-01");
      expect(String(url)).toContain("to=2023-01-31");
      return {
        ok: true,
        json: async () => ({
          schemes: {
            "118741": {
              data: [{ date: "2023-01-02", nav: 100.1 }],
            },
          },
        }),
      } as Response;
    });

    const result = await fetchNav(
      ["118741"],
      "2023-01-01",
      "2023-01-31",
      fetchFn as unknown as typeof fetch,
    );

    expect(result["118741"][0].nav).toBe(100.1);
    expect(result["118741"][0].date).toBe("2023-01-02");
    expect(String(fetchFn.mock.calls[0][0])).toContain("schemes=118741");
  });

  it("falls back to MFAPI per code when TigZig throws, parsing DD-MM-YYYY", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("tigzig")) throw new Error("down");
      expect(u).toBe("https://api.mfapi.in/mf/118741");
      return {
        ok: true,
        json: async () => ({
          data: [{ date: "02-01-2023", nav: "100.10000" }],
        }),
      } as Response;
    });

    const result = await fetchNav(
      ["118741"],
      "2023-01-01",
      "2023-01-31",
      fetchFn as unknown as typeof fetch,
    );

    expect(result["118741"][0]).toEqual({ date: "2023-01-02", nav: 100.1 });
  });

  it("handles TigZig single-scheme top-level data shape", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ date: "2023-01-02", nav: 100.1 }],
      }),
    }));

    const result = await fetchNav(
      ["118741"],
      "2023-01-01",
      "2023-01-31",
      fetchFn as unknown as typeof fetch,
    );

    expect(result["118741"][0].nav).toBe(100.1);
  });

  it("chunks TigZig requests at 50 codes", async () => {
    const codes = Array.from({ length: 51 }, (_, i) => String(100000 + i));
    const fetchFn = vi.fn(async (url: string) => {
      const schemes = new URL(String(url)).searchParams.get("schemes")!.split(",");
      expect(schemes.length).toBeLessThanOrEqual(50);
      const body: Record<string, { data: { date: string; nav: number }[] }> = {};
      for (const c of schemes) {
        body[c] = { data: [{ date: "2023-01-02", nav: 1 }] };
      }
      return {
        ok: true,
        json: async () => ({ schemes: body }),
      } as Response;
    });

    const result = await fetchNav(
      codes,
      "2023-01-01",
      "2023-01-31",
      fetchFn as unknown as typeof fetch,
    );

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(Object.keys(result)).toHaveLength(51);
  });

  it("falls back to MFAPI when TigZig returns !ok", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("tigzig")) {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ date: "02-01-2023", nav: "100.10000" }],
        }),
      } as Response;
    });

    const result = await fetchNav(
      ["118741"],
      "2023-01-01",
      "2023-01-31",
      fetchFn as unknown as typeof fetch,
    );

    expect(result["118741"][0].nav).toBe(100.1);
  });

  it("surfaces usedFallback=false when TigZig succeeds", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        schemes: { "118741": { data: [{ date: "2023-01-02", nav: 100.1 }] } },
      }),
    }));

    const result = await fetchNavWithStatus(
      ["118741"],
      "2023-01-01",
      "2023-01-31",
      fetchFn as unknown as typeof fetch,
    );

    expect(result.usedFallback).toBe(false);
    expect(result.navs["118741"][0].nav).toBe(100.1);
  });

  it("surfaces usedFallback=true when TigZig fails and MFAPI succeeds", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes("tigzig")) throw new Error("down");
      return {
        ok: true,
        json: async () => ({
          data: [{ date: "02-01-2023", nav: "100.10000" }],
        }),
      } as Response;
    });

    const result = await fetchNavWithStatus(
      ["118741"],
      "2023-01-01",
      "2023-01-31",
      fetchFn as unknown as typeof fetch,
    );

    expect(result.usedFallback).toBe(true);
    expect(result.navs["118741"][0]).toEqual({ date: "2023-01-02", nav: 100.1 });
  });
});

describe("navCache", () => {
  beforeEach(() => {
    store.clear();
  });

  it("round-trips points under nav:{code}", async () => {
    const points = [{ date: "2023-01-02", nav: 100.1 }];
    await writeNavCache("118741", points);
    await expect(readNavCache("118741")).resolves.toEqual(points);
    await expect(readNavCache("missing")).resolves.toBeNull();

    const idb = await import("idb-keyval");
    expect(idb.set).toHaveBeenCalledWith(
      "nav:118741",
      expect.objectContaining({ points }),
    );
  });

  it("is fresh when range is covered and before next 21:00 IST after lastPoint", () => {
    const points = [
      { date: "2023-01-02", nav: 100 },
      { date: "2023-01-31", nav: 101 },
    ];
    // lastPoint 2023-01-31 → next 21:00 IST is 2023-02-01 21:00 IST
    const deadline = Date.parse("2023-02-01T21:00:00+05:30");
    const writtenAt = deadline - 60_000;

    expect(
      isNavCacheFresh(points, "2023-01-02", "2023-01-31", writtenAt, writtenAt),
    ).toBe(true);

    // past lastPoint deadline and past writtenAt daily TTL
    const longAfter = Date.parse("2023-02-03T00:00:00+05:30");
    expect(
      isNavCacheFresh(
        points,
        "2023-01-02",
        "2023-01-31",
        writtenAt,
        longAfter,
      ),
    ).toBe(false);

    // does not cover start (earliest point after since)
    expect(
      isNavCacheFresh(
        points,
        "2022-01-01",
        "2023-01-31",
        writtenAt,
        writtenAt,
      ),
    ).toBe(false);
  });

  it("stays fresh for historical ranges within writtenAt daily TTL", () => {
    const points = [
      { date: "2023-01-02", nav: 100 },
      { date: "2023-01-31", nav: 101 },
    ];
    // Written "today" long after lastPoint; still fresh until next day 21:00 IST
    const writtenAt = Date.parse("2026-08-15T10:00:00+05:30");
    const now = Date.parse("2026-08-15T18:00:00+05:30");
    expect(
      isNavCacheFresh(points, "2023-01-02", "2023-01-31", writtenAt, now),
    ).toBe(true);

    const afterTtl = Date.parse("2026-08-16T21:00:01+05:30");
    expect(
      isNavCacheFresh(points, "2023-01-02", "2023-01-31", writtenAt, afterTtl),
    ).toBe(false);
  });
});
