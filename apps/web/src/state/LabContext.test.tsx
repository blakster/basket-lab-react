import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import defaults from "../data/defaults.json";
import { LabProvider, useLab } from "./LabContext";
import type { Basket, LabSettings } from "../types";

const { fetchNavMock, readNavCacheEntryMock, writeNavCacheMock } = vi.hoisted(
  () => ({
    fetchNavMock: vi.fn(),
    readNavCacheEntryMock: vi.fn(),
    writeNavCacheMock: vi.fn(),
  }),
);

vi.mock("../lib/api/nav", () => ({
  fetchNav: (...args: unknown[]) => fetchNavMock(...args),
}));

vi.mock("../lib/navCache", () => ({
  isNavCacheFresh: () => false,
  readNavCacheEntry: (...args: unknown[]) => readNavCacheEntryMock(...args),
  writeNavCache: (...args: unknown[]) => writeNavCacheMock(...args),
}));

function makeBasket(weight: number): Basket {
  return {
    id: "test-1",
    name: "Test",
    color: "#18181b",
    active: true,
    funds: [
      {
        schemeCode: "118741",
        schemeName: "UTI Nifty 50 Index Fund",
        isin: null,
        weight,
        locked: false,
      },
    ],
  };
}

function Consumer({
  api,
}: {
  api: { current: ReturnType<typeof useLab> | null };
}) {
  api.current = useLab();
  return null;
}

describe("LabContext persisted baskets", () => {
  beforeEach(() => {
    window.localStorage.removeItem("basket-lab-v1");
  });

  it("renames a blank-named basket persisted in localStorage", () => {
    const saved = {
      settings: {
        mode: "lumpsum" as const,
        amount: 9999,
        period: "1Y" as const,
        customStart: "2020-01-01",
        customEnd: "2021-01-01",
      },
      baskets: [{ ...makeBasket(100), name: "   " }],
    };
    window.localStorage.setItem("basket-lab-v1", JSON.stringify(saved));

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    expect(api.current!.baskets).toHaveLength(1);
    expect(api.current!.baskets[0].name.trim()).not.toBe("");
  });

  it("ignores a stale ?s= query and loads the persisted setup", () => {
    const saved = {
      settings: {
        mode: "lumpsum" as const,
        amount: 9999,
        period: "1Y" as const,
        customStart: "2020-01-01",
        customEnd: "2021-01-01",
      },
      baskets: [makeBasket(100)],
    };
    window.localStorage.setItem("basket-lab-v1", JSON.stringify(saved));
    const url = new URL(window.location.href);
    url.searchParams.set("s", "%%%corrupt%%%");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    expect(api.current!.settings.amount).toBe(9999);
    expect(api.current!.baskets).toHaveLength(1);
    expect(api.current!.baskets[0].id).toBe("test-1");
    // The stale query is ignored but left untouched in the address bar.
    expect(new URL(window.location.href).searchParams.get("s")).toBe(
      "%%%corrupt%%%",
    );
  });

  it("ignores a stale ?s= query and falls back to defaults", () => {
    const url = new URL(window.location.href);
    url.searchParams.set(
      "s",
      "eJyNkctqwzAQRX9FTLcuWI7zaJZJ7WIKbiDpopQsVFuJRWTJ6NGkBP9",
    );
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    const fallback = defaults as { settings: LabSettings; baskets: Basket[] };
    expect(api.current!.baskets.map((b) => b.id)).toEqual(
      fallback.baskets.map((b) => b.id),
    );
    expect(new URL(window.location.href).searchParams.get("s")).toBe(
      "eJyNkctqwzAQRX9FTLcuWI7zaJZJ7WIKbiDpopQsVFuJRWTJ6NGkBP9",
    );
  });
});

describe("LabContext saveBasket", () => {
  beforeEach(() => {
    window.localStorage.removeItem("basket-lab-v1");
  });

  it("returns false when weights sum to 90 and true when they sum to 100", () => {
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    let ok90 = true;
    act(() => {
      ok90 = api.current!.saveBasket(makeBasket(90));
    });
    expect(ok90).toBe(false);
    expect(api.current!.baskets.some((b) => b.id === "test-1")).toBe(false);

    let ok100 = false;
    act(() => {
      ok100 = api.current!.saveBasket(makeBasket(100));
    });
    expect(ok100).toBe(true);
    const saved = api.current!.baskets.find((b) => b.id === "test-1");
    expect(saved).toBeDefined();
    expect(saved!.name).toBe("Test");
    expect(saved!.funds.reduce((s, f) => s + f.weight, 0)).toBe(100);
  });

  it("returns false for a blank or whitespace-only name at 100% weights", () => {
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    for (const name of ["", "   ", "\t\n"]) {
      let ok = true;
      act(() => {
        ok = api.current!.saveBasket({ ...makeBasket(100), id: `blank-${name.length}`, name });
      });
      expect(ok).toBe(false);
    }
    expect(api.current!.baskets.every((b) => b.name.trim() !== "")).toBe(true);
  });

  it("create-new draft cancel leaves baskets unchanged and does not persist a 0% basket", () => {
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    const before = api.current!.baskets;
    const beforeLen = before.length;
    const draft: Basket = {
      id: "draft-new",
      name: "New Basket",
      color: "#18181b",
      active: true,
      funds: [],
    };

    act(() => {
      api.current!.openEditor(draft.id, draft);
    });
    expect(api.current!.editingId).toBe("draft-new");
    expect(api.current!.editorSeed?.id).toBe("draft-new");
    expect(api.current!.baskets).toHaveLength(beforeLen);
    expect(api.current!.baskets.some((b) => b.id === "draft-new")).toBe(false);

    act(() => {
      api.current!.closeEditor();
    });
    expect(api.current!.editingId).toBeNull();
    expect(api.current!.editorSeed).toBeNull();
    expect(api.current!.baskets).toHaveLength(beforeLen);
    expect(api.current!.baskets.some((b) => b.id === "draft-new")).toBe(false);

    const raw = window.localStorage.getItem("basket-lab-v1");
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as { baskets: Basket[] };
    expect(persisted.baskets).toHaveLength(beforeLen);
    expect(persisted.baskets.some((b) => b.id === "draft-new")).toBe(false);
    expect(
      persisted.baskets.some(
        (b) => b.funds.length === 0 || b.funds.reduce((s, f) => s + f.weight, 0) === 0,
      ),
    ).toBe(false);
  });
});

describe("LabContext runAnalysis", () => {
  beforeEach(() => {
    window.localStorage.removeItem("basket-lab-v1");
    fetchNavMock.mockReset();
    readNavCacheEntryMock.mockReset();
    writeNavCacheMock.mockReset();
    fetchNavMock.mockResolvedValue({});
    readNavCacheEntryMock.mockResolvedValue(null);
    writeNavCacheMock.mockResolvedValue(undefined);
  });

  it("skips when amount is below 100 or an active basket is unbalanced", async () => {
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setSettings({ ...api.current!.settings, amount: 50 });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toEqual([]);

    act(() => {
      api.current!.setSettings({ ...api.current!.settings, amount: 1000 });
      api.current!.setBaskets(
        api.current!.baskets.map((b, i) =>
          i === 0
            ? { ...b, funds: b.funds.map((f) => ({ ...f, weight: 50 })) }
            : b,
        ),
      );
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toEqual([]);
  });

  it("clears results when amount drops below 100 after a successful run", async () => {
    fetchNavMock.mockResolvedValue({
      "118741": [
        { date: "2023-01-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toHaveLength(1);
    expect(api.current!.results[0].error).toBeUndefined();
    expect(api.current!.results[0].stats.final).toBeGreaterThan(0);

    act(() => {
      api.current!.setSettings({ ...api.current!.settings, amount: 50 });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toEqual([]);
  });

  it("drops the header status off LIVE whenever a cleared run leaves nothing shown", async () => {
    fetchNavMock.mockResolvedValue({
      "118741": [
        { date: "2023-01-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    const liveSettings = () => ({
      mode: "lumpsum" as const,
      amount: 1000,
      period: "Custom" as const,
      customStart: "2023-01-01",
      customEnd: "2024-01-01",
    });
    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings(liveSettings());
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toHaveLength(1);
    expect(api.current!.status.kind).toBe("ready");

    // Clearing the amount empties the page; the badge must not stay LIVE.
    act(() => {
      api.current!.setSettings({ ...api.current!.settings, amount: 50 });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toEqual([]);
    expect(api.current!.status.kind).not.toBe("ready");
    expect(api.current!.status.kind).toBe("idle");

    // A normal run afterwards restores LIVE exactly as before.
    act(() => {
      api.current!.setSettings(liveSettings());
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.status.kind).toBe("ready");

    // Unbalanced weights and no active baskets clear the run the same way.
    act(() => {
      api.current!.setBaskets([{ ...makeBasket(100), funds: [{ ...makeBasket(100).funds[0]!, weight: 50 }] }]);
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toEqual([]);
    expect(api.current!.status.kind).toBe("idle");

    act(() => {
      api.current!.setBaskets([{ ...makeBasket(100), active: false }]);
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toEqual([]);
    expect(api.current!.status.kind).toBe("idle");
  });

  it("reports bad-range and clears data when Custom start is after end", async () => {
    fetchNavMock.mockResolvedValue({
      "118741": [
        { date: "2023-01-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toHaveLength(1);
    expect(api.current!.navByCode["118741"]).toHaveLength(2);
    fetchNavMock.mockClear();

    act(() => {
      api.current!.setSettings({
        ...api.current!.settings,
        customStart: "2025-12-31",
        customEnd: "2020-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });

    expect(api.current!.status).toEqual({ kind: "bad-range" });
    expect(api.current!.results).toEqual([]);
    expect(api.current!.navByCode).toEqual({});
    expect(fetchNavMock).not.toHaveBeenCalled();
  });

  it("sets no-nav when fetch fails and cache does not cover the range", async () => {
    fetchNavMock.mockResolvedValue({ "118741": [] });
    readNavCacheEntryMock.mockResolvedValue({
      points: [
        { date: "2020-01-01", nav: 10 },
        { date: "2020-06-01", nav: 12 },
      ],
      writtenAt: Date.now(),
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });

    expect(api.current!.results).toHaveLength(1);
    expect(api.current!.results[0].error).toBe("no-nav");
    expect(api.current!.results[0].stats.final).toBe(0);
    expect(api.current!.results[0].stats.abs).not.toBe(-100);
    expect(api.current!.status).toEqual({ kind: "no-nav" });
  });

  it("sets cached-nav when fetch fails and covering cache is reused", async () => {
    fetchNavMock.mockResolvedValue({ "118741": [] });
    readNavCacheEntryMock.mockResolvedValue({
      points: [
        { date: "2023-01-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
      writtenAt: Date.now(),
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    expect(api.current!.status.kind).toBe("ready");

    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });

    expect(api.current!.results[0].error).toBeUndefined();
    expect(api.current!.results[0].stats.final).toBeGreaterThan(0);
    expect(api.current!.status).toEqual({
      kind: "cached-nav",
      detail: "2024-01-01",
    });
  });

  it("sets ready after a live NAV fetch and ranks nav over search/insights", async () => {
    fetchNavMock.mockResolvedValue({
      "118741": [
        { date: "2023-01-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.reportStatus("search", { kind: "search-down" });
    });
    expect(api.current!.status.kind).toBe("search-down");
    act(() => {
      api.current!.reportStatus("insights", { kind: "insights-down" });
    });
    expect(api.current!.status.kind).toBe("search-down");

    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });

    expect(api.current!.results[0].error).toBeUndefined();
    // live NAV is ready; search/insights still down — search-down wins over insights
    expect(api.current!.status.kind).toBe("search-down");

    act(() => {
      api.current!.reportStatus("search", { kind: "ready" });
    });
    expect(api.current!.status.kind).toBe("insights-down");
    act(() => {
      api.current!.reportStatus("insights", { kind: "ready" });
    });
    expect(api.current!.status.kind).toBe("ready");
  });

  it("does not zero sibling baskets when one scheme has an empty NAV series", async () => {
    fetchNavMock.mockResolvedValue({
      "118741": [],
      "122639": [
        { date: "2023-01-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });

    const basket1 = api.current!.results.find((r) => r.basketId === "1");
    const basket2 = api.current!.results.find((r) => r.basketId === "2");
    expect(basket1?.error).toBe("no-nav");
    expect(basket2?.error).toBeUndefined();
    expect(basket2!.stats.final).toBeGreaterThan(0);
    expect(basket2!.stats.abs).not.toBe(-100);
    // Header stays ready/cached-nav; only basket 1 shows No NAV
    expect(api.current!.status.kind).not.toBe("no-nav");
  });

  it("backtests a fund whose NAV starts after the requested window", async () => {
    fetchNavMock.mockResolvedValue({
      "118741": [
        { date: "2023-07-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });

    expect(api.current!.results[0].error).toBeUndefined();
    expect(api.current!.results[0].stats.final).toBeCloseTo(1200, 6);
    expect(api.current!.results[0].cashflow?.startIso).toBe("2023-07-01");
    expect(api.current!.status.kind).not.toBe("no-nav");
  });

  it("reuses a later-starting cache when the live fetch is empty", async () => {
    fetchNavMock.mockResolvedValue({ "118741": [] });
    readNavCacheEntryMock.mockResolvedValue({
      points: [
        { date: "2023-07-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
      writtenAt: Date.now(),
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });

    expect(api.current!.results[0].error).toBeUndefined();
    expect(api.current!.results[0].stats.final).toBeCloseTo(1200, 6);
    expect(api.current!.status).toEqual({
      kind: "cached-nav",
      detail: "2024-01-01",
    });
  });
  it("clears navByCode when a later run's fetch throws", async () => {
    fetchNavMock.mockResolvedValueOnce({
      "118741": [
        { date: "2023-01-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.navByCode["118741"]).toHaveLength(2);

    fetchNavMock.mockRejectedValueOnce(new Error("network down"));
    act(() => {
      api.current!.setSettings({
        ...api.current!.settings,
        customStart: "2021-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.navByCode).toEqual({});
    expect(api.current!.analyzing).toBe(false);
  });

  it("clears results and flags the run when a run throws", async () => {
    fetchNavMock.mockResolvedValue({
      "118741": [
        { date: "2023-01-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toHaveLength(1);
    expect(api.current!.status.kind).toBe("ready");
    expect(api.current!.navByCode["118741"]).toHaveLength(2);

    // An unexpected throw mid-run must not leave the previous run's numbers
    // on screen under a LIVE badge.
    fetchNavMock.mockRejectedValueOnce(new Error("boom"));
    act(() => {
      api.current!.setSettings({
        ...api.current!.settings,
        customStart: "2021-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.analyzing).toBe(false);
    expect(api.current!.results).toEqual([]);
    expect(api.current!.navByCode).toEqual({});
    expect(api.current!.status.kind).toBe("no-nav");

    // The clearing paths still report their own status after a failure.
    act(() => {
      api.current!.setSettings({ ...api.current!.settings, amount: 50 });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.status.kind).toBe("idle");

    act(() => {
      api.current!.setSettings({
        ...api.current!.settings,
        amount: 1000,
        customStart: "2025-12-31",
        customEnd: "2020-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.status).toEqual({ kind: "bad-range" });

    // A good run restores LIVE.
    fetchNavMock.mockResolvedValue({
      "118741": [
        { date: "2021-01-01", nav: 8 },
        { date: "2024-01-01", nav: 12 },
      ],
    });
    act(() => {
      api.current!.setSettings({
        ...api.current!.settings,
        customStart: "2021-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    expect(api.current!.results).toHaveLength(1);
    expect(api.current!.status.kind).toBe("ready");
  });

  it("replaces navByCode with the expanded window after a successful refetch", async () => {
    fetchNavMock.mockResolvedValueOnce({
      "118741": [
        { date: "2023-01-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
    });

    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    act(() => {
      api.current!.setBaskets([makeBasket(100)]);
      api.current!.setSettings({
        mode: "lumpsum",
        amount: 1000,
        period: "Custom",
        customStart: "2023-01-01",
        customEnd: "2024-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });

    fetchNavMock.mockResolvedValueOnce({
      "118741": [
        { date: "2021-01-01", nav: 8 },
        { date: "2022-01-01", nav: 9 },
        { date: "2023-01-01", nav: 10 },
        { date: "2024-01-01", nav: 12 },
      ],
    });
    act(() => {
      api.current!.setSettings({
        ...api.current!.settings,
        customStart: "2021-01-01",
      });
    });
    await act(async () => {
      await api.current!.runAnalysis();
    });
    const pts = api.current!.navByCode["118741"]!;
    expect(pts[0]?.date).toBe("2021-01-01");
    expect(api.current!.results[0]?.cashflow?.startIso).toBe("2021-01-01");
  });
});

describe("LabContext insights basket id", () => {
  beforeEach(() => {
    window.localStorage.removeItem("basket-lab-v1");
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  });

  function basketWithId(id: string, active: boolean): Basket {
    const b = makeBasket(100);
    return { ...b, id, name: id, active };
  }

  it("drops a deleted basket's id when reopening insights", () => {
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    const a = basketWithId("basket-a", false);
    const b = basketWithId("basket-b", true);
    act(() => {
      api.current!.setBaskets([a, b]);
    });
    act(() => {
      api.current!.openInsights("basket-a");
    });
    expect(api.current!.insightsBasketId).toBe("basket-a");
    expect(window.location.hash).toBe("#insights=basket-a");

    act(() => {
      api.current!.setBaskets([b]);
    });
    act(() => {
      api.current!.openInsights();
    });
    expect(api.current!.insightsBasketId).toBe("basket-b");
    expect(window.location.hash).toBe("#insights=basket-b");
  });

  it("drops a deleted basket's id when returning to insights from baskets", () => {
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    render(
      <LabProvider>
        <Consumer api={api} />
      </LabProvider>,
    );

    const a = basketWithId("basket-a", false);
    const b = basketWithId("basket-b", true);
    act(() => {
      api.current!.setBaskets([a, b]);
    });
    act(() => {
      api.current!.openInsights("basket-a");
    });
    expect(api.current!.insightsBasketId).toBe("basket-a");

    act(() => {
      api.current!.setWorkspace("baskets");
    });
    expect(window.location.hash).toBe("#baskets");

    act(() => {
      api.current!.setBaskets([b]);
    });
    act(() => {
      api.current!.setWorkspace("insights");
    });
    expect(api.current!.workspace).toBe("insights");
    expect(api.current!.insightsBasketId).toBe("basket-b");
    expect(window.location.hash).toBe("#insights=basket-b");
  });
});
