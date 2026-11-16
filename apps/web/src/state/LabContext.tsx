import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import defaults from "../data/defaults.json";
import { ensureFilings } from "../lib/api/insights";
import { fetchNav } from "../lib/api/nav";
import { backtestBasket } from "../lib/backtest/performance";
import {
  isNavCacheFresh,
  readNavCacheEntry,
  writeNavCache,
  type NavCacheEntry,
} from "../lib/navCache";
import { resolveRange } from "../lib/resolveSettings";
import { decodeShare, encodeShare } from "../lib/shareUrl";
import type {
  BacktestResult,
  Basket,
  LabSettings,
  NavPoint,
} from "../types";

const STORAGE_KEY = "basket-lab-v1";
const WEIGHT_TOLERANCE = 0.1;
/** Last trading day before a weekend/holiday `to` still covers the range. */
const RANGE_SLACK_DAYS = 4;

export type LabStatusKind =
  | "ready"
  | "cached-nav"
  | "no-nav"
  | "search-busy"
  | "search-down"
  | "insights-down";

export type LabStatus = { kind: LabStatusKind; detail?: string };

export type StatusSource = "nav" | "search" | "insights";

const READY_STATUS: LabStatus = { kind: "ready" };

const STATUS_PRIORITY: Record<LabStatusKind, number> = {
  "no-nav": 5,
  "cached-nav": 4,
  "search-down": 3,
  "search-busy": 2,
  "insights-down": 1,
  ready: 0,
};

function pickStatus(parts: LabStatus[]): LabStatus {
  return parts.reduce((best, cur) =>
    STATUS_PRIORITY[cur.kind] > STATUS_PRIORITY[best.kind] ? cur : best,
  );
}

function lastPointDate(points: NavPoint[]): string {
  return points.reduce((a, p) => (p.date > a ? p.date : a), points[0].date);
}

export type Workspace = "compare" | "baskets" | "insights";

const INSIGHTS_HASH = "#insights";

function workspaceFromHash(): Workspace {
  const hash = window.location.hash;
  if (hash === "#baskets") return "baskets";
  if (hash === INSIGHTS_HASH || hash.startsWith(`${INSIGHTS_HASH}=`)) {
    return "insights";
  }
  return "compare";
}

function readInsightsBasketId(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith(`${INSIGHTS_HASH}=`)) return null;
  try {
    return decodeURIComponent(hash.slice(`${INSIGHTS_HASH}=`.length)) || null;
  } catch {
    return null;
  }
}

function writeWorkspaceHash(workspace: Workspace, basketId?: string | null): void {
  const url = new URL(window.location.href);
  if (workspace === "compare") url.hash = "";
  else if (workspace === "baskets") url.hash = "baskets";
  else if (basketId) url.hash = `insights=${encodeURIComponent(basketId)}`;
  else url.hash = "insights";
  const next = `${url.pathname}${url.search}${url.hash}`;
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === here) return;
  window.history.replaceState(null, "", next);
}

type LabContextValue = {
  settings: LabSettings;
  setSettings: Dispatch<SetStateAction<LabSettings>>;
  baskets: Basket[];
  setBaskets: Dispatch<SetStateAction<Basket[]>>;
  editingId: string | null;
  /** Seed for a basket not yet in `baskets` (create-new draft). */
  editorSeed: Basket | null;
  openEditor: (id: string, seed?: Basket) => void;
  closeEditor: () => void;
  saveBasket: (basket: Basket) => boolean;
  results: BacktestResult[];
  navByCode: Record<string, NavPoint[]>;
  analyzing: boolean;
  runAnalysis: () => Promise<void>;
  /** True when `?s=` was present but could not be decoded. */
  shareHydrateError: boolean;
  status: LabStatus;
  insightsStatus: LabStatus;
  reportStatus: (source: StatusSource, next: LabStatus) => void;
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
  insightsOpen: boolean;
  insightsBasketId: string | null;
  openInsights: (basketId?: string) => void;
  closeInsights: () => void;
};

const LabContext = createContext<LabContextValue | null>(null);

function cloneDefaults(): { settings: LabSettings; baskets: Basket[] } {
  return structuredClone(defaults) as { settings: LabSettings; baskets: Basket[] };
}

function loadPersisted(): { settings: LabSettings; baskets: Basket[] } {
  const fallback = cloneDefaults();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      settings?: LabSettings;
      baskets?: Basket[];
    };
    if (!parsed.settings || !Array.isArray(parsed.baskets)) return fallback;
    return { settings: parsed.settings, baskets: parsed.baskets };
  } catch {
    return fallback;
  }
}

function loadInitial(): {
  settings: LabSettings;
  baskets: Basket[];
  shareHydrateError: boolean;
} {
  try {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("s");
    if (s != null && s !== "") {
      const decoded = decodeShare(s);
      if (decoded) {
        return {
          settings: decoded.settings,
          baskets: decoded.baskets,
          shareHydrateError: false,
        };
      }
      // Drop corrupt s= so a refresh does not keep failing hydrate.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("s");
        window.history.replaceState(
          null,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      } catch {
        // ignore
      }
      return { ...cloneDefaults(), shareHydrateError: true };
    }
  } catch {
    // Fall through to localStorage.
  }
  return { ...loadPersisted(), shareHydrateError: false };
}

function writeShareQuery(settings: LabSettings, baskets: Basket[]): void {
  try {
    const encoded = encodeShare({ settings, baskets });
    const url = new URL(window.location.href);
    url.searchParams.set("s", encoded);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Ignore history / encode failures (private mode, etc.).
  }
}

function weightSum(basket: Basket): number {
  return basket.funds.reduce((s, f) => s + f.weight, 0);
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lastIso(points: NavPoint[]): string {
  return points.reduce((a, p) => (p.date > a ? p.date : a), points[0].date);
}

function firstIso(points: NavPoint[]): string {
  return points.reduce((a, p) => (p.date < a ? p.date : a), points[0].date);
}

function coversEnd(points: NavPoint[], to: string): boolean {
  if (points.some((p) => p.date >= to)) return true;
  const last = lastIso(points);
  if (last > to) return false;
  const gap =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) /
    86_400_000;
  return gap <= RANGE_SLACK_DAYS;
}

function cacheCoversRange(
  points: NavPoint[],
  since: string,
  to: string,
): boolean {
  if (!points.length) return false;
  const hasOnOrBeforeSince = points.some((p) => p.date <= since);
  if (!hasOnOrBeforeSince) return false;
  return coversEnd(points, to);
}

/** Stale-cache reuse: series overlaps the window and reaches `to` (with slack). */
function cacheOverlapsRange(
  points: NavPoint[],
  since: string,
  to: string,
): boolean {
  if (!points.length) return false;
  if (firstIso(points) > to) return false;
  if (lastIso(points) < since) return false;
  return coversEnd(points, to);
}

function cacheUsable(
  entry: NavCacheEntry,
  since: string,
  to: string,
): boolean {
  if (!cacheCoversRange(entry.points, since, to)) return false;
  const min = entry.points.reduce(
    (a, p) => (p.date < a ? p.date : a),
    entry.points[0].date,
  );
  const max = entry.points.reduce(
    (a, p) => (p.date > a ? p.date : a),
    entry.points[0].date,
  );
  const freshSince = since < min ? min : since;
  const freshTo = to > max ? max : to;
  return isNavCacheFresh(entry.points, freshSince, freshTo, entry.writtenAt);
}

/** Per-basket map: only that basket's codes, empty series omitted. */
function navsForBasket(
  basket: Basket,
  navs: Record<string, NavPoint[]>,
): Record<string, NavPoint[]> {
  const subset: Record<string, NavPoint[]> = {};
  for (const f of basket.funds) {
    if (f.weight <= 0) continue;
    const series = navs[f.schemeCode];
    if (series?.length) subset[f.schemeCode] = series;
  }
  return subset;
}

function mergeNav(a: NavPoint[], b: NavPoint[]): NavPoint[] {
  const byDate = new Map<string, number>();
  for (const p of a) byDate.set(p.date, p.nav);
  for (const p of b) byDate.set(p.date, p.nav);
  return [...byDate.entries()]
    .map(([date, nav]) => ({ date, nav }))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

export function LabProvider({ children }: { children: ReactNode }) {
  const initial = loadInitial();
  const [settings, setSettingsState] = useState<LabSettings>(initial.settings);
  const [baskets, setBasketsState] = useState<Basket[]>(initial.baskets);
  const [shareHydrateError] = useState(initial.shareHydrateError);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorSeed, setEditorSeed] = useState<Basket | null>(null);
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [navByCode, setNavByCode] = useState<Record<string, NavPoint[]>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [navStatus, setNavStatus] = useState<LabStatus>(READY_STATUS);
  const [searchStatus, setSearchStatus] = useState<LabStatus>(READY_STATUS);
  const [insightsStatus, setInsightsStatus] = useState<LabStatus>(READY_STATUS);
  const [workspace, setWorkspaceState] = useState<Workspace>(workspaceFromHash);
  const [insightsBasketId, setInsightsBasketId] = useState<string | null>(
    readInsightsBasketId,
  );
  const insightsOpen = workspace === "insights";
  const runIdRef = useRef(0);
  /** After a failed `?s=` hydrate, keep session defaults without wiping storage until the user edits. */
  const blockPersistRef = useRef(initial.shareHydrateError);

  useEffect(() => {
    if (blockPersistRef.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ baskets, settings }));
    } catch {
      // Ignore quota / private-mode failures.
    }
  }, [baskets, settings]);

  useEffect(() => {
    ensureFilings(baskets.flatMap((b) => b.funds.map((f) => f.schemeCode)));
  }, [baskets]);

  const setSettings = useCallback<Dispatch<SetStateAction<LabSettings>>>((action) => {
    blockPersistRef.current = false;
    setSettingsState(action);
  }, []);

  const setBaskets = useCallback<Dispatch<SetStateAction<Basket[]>>>((action) => {
    blockPersistRef.current = false;
    setBasketsState(action);
  }, []);

  const openEditor = useCallback((id: string, seed?: Basket) => {
    setEditingId(id);
    setEditorSeed(seed ?? null);
  }, []);

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setEditorSeed(null);
  }, []);

  const saveBasket = useCallback((basket: Basket): boolean => {
    const sum = weightSum(basket);
    if (Math.abs(sum - 100) >= WEIGHT_TOLERANCE) return false;
    blockPersistRef.current = false;
    setBasketsState((prev) => {
      const idx = prev.findIndex((b) => b.id === basket.id);
      if (idx === -1) return [...prev, basket];
      const next = [...prev];
      next[idx] = basket;
      return next;
    });
    ensureFilings(basket.funds.map((f) => f.schemeCode));
    return true;
  }, []);

  const reportStatus = useCallback((source: StatusSource, next: LabStatus) => {
    if (source === "nav") setNavStatus(next);
    else if (source === "search") setSearchStatus(next);
    else setInsightsStatus(next);
  }, []);

  useEffect(() => {
    const sync = () => {
      setWorkspaceState(workspaceFromHash());
      setInsightsBasketId(readInsightsBasketId());
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const setWorkspace = useCallback(
    (next: Workspace) => {
      setWorkspaceState(next);
      if (next !== "insights") {
        writeWorkspaceHash(next);
        return;
      }
      setInsightsBasketId((prev) => {
        const id =
          prev ??
          baskets.find((b) => b.active)?.id ??
          baskets[0]?.id ??
          null;
        writeWorkspaceHash("insights", id);
        return id;
      });
    },
    [baskets],
  );

  const openInsights = useCallback((basketId?: string) => {
    setInsightsBasketId((prev) => {
      const asked = typeof basketId === "string" && basketId ? basketId : undefined;
      const next =
        asked ??
        prev ??
        baskets.find((b) => b.active)?.id ??
        baskets[0]?.id ??
        null;
      writeWorkspaceHash("insights", next);
      return next;
    });
    setWorkspaceState("insights");
  }, [baskets]);

  const closeInsights = useCallback(() => {
    writeWorkspaceHash("compare");
    setWorkspaceState("compare");
  }, []);

  const status = useMemo(
    () => pickStatus([navStatus, searchStatus, insightsStatus]),
    [navStatus, searchStatus, insightsStatus],
  );

  const runAnalysis = useCallback(async () => {
    const runId = ++runIdRef.current;
    setAnalyzing(true);
    const finish = (apply?: () => void) => {
      if (runId !== runIdRef.current) return;
      apply?.();
      setAnalyzing(false);
    };
    if (settings.amount < 100) {
      finish(() => {
        setResults([]);
        setNavByCode({});
      });
      return;
    }

    const active = baskets.filter((b) => b.active);
    if (
      active.some((b) => Math.abs(weightSum(b) - 100) >= WEIGHT_TOLERANCE)
    ) {
      finish(() => {
        setResults([]);
        setNavByCode({});
      });
      return;
    }
    if (!active.length) {
      finish(() => {
        setResults([]);
        setNavByCode({});
      });
      return;
    }

    const { start, end } = resolveRange(
      settings.period,
      settings.customStart,
      settings.customEnd,
    );
    const resolved: LabSettings = {
      ...settings,
      customStart: start,
      customEnd: end,
    };

    const codes = [
      ...new Set(
        active.flatMap((b) =>
          b.funds.filter((f) => f.weight > 0).map((f) => f.schemeCode),
        ),
      ),
    ];

    const navs: Record<string, NavPoint[]> = {};
    const toFetch: string[] = [];
    const entries = new Map<string, NavCacheEntry | null>();
    const staleCacheCodes = new Set<string>();

    try {
    await Promise.all(
      codes.map(async (code) => {
        try {
          const entry = await readNavCacheEntry(code);
          entries.set(code, entry);
          if (entry && cacheUsable(entry, start, end)) {
            navs[code] = entry.points;
            return;
          }
        } catch {
          entries.set(code, null);
        }
        toFetch.push(code);
      }),
    );

    if (runId !== runIdRef.current) return;

    if (toFetch.length) {
      // Look back a week so weekend/holiday starts still have a prior NAV.
      const fetched = await fetchNav(toFetch, shiftIso(start, -7), end);
      if (runId !== runIdRef.current) return;
      await Promise.all(
        toFetch.map(async (code) => {
          const points = fetched[code] ?? [];
          const prev = entries.get(code);
          if (points.length) {
            const merged = mergeNav(prev?.points ?? [], points);
            try {
              await writeNavCache(code, merged);
            } catch {
              // Quota / private mode: still run on the live series.
            }
            navs[code] = merged;
          } else {
            // Failed fetch: reuse overlapping stale cache ("Using saved NAV"),
            // including series that start after `start` (fund launched later).
            if (prev && cacheOverlapsRange(prev.points, start, end)) {
              navs[code] = prev.points;
              staleCacheCodes.add(code);
            } else {
              navs[code] = [];
            }
          }
        }),
      );
    }

    if (runId !== runIdRef.current) return;
    const nextResults = active.map((b) =>
      backtestBasket(b, navsForBasket(b, navs), resolved),
    );
    // Global no-nav only when every active basket failed (one empty scheme
    // still leaves sibling baskets runnable and the header ready/cached-nav).
    const allNoNav =
      nextResults.length > 0 &&
      nextResults.every((r) => r.error === "no-nav");
    finish(() => {
      if (allNoNav) {
        setNavStatus({ kind: "no-nav" });
      } else if (staleCacheCodes.size) {
        let detail = "";
        for (const code of staleCacheCodes) {
          const pts = navs[code];
          if (!pts?.length) continue;
          const last = lastPointDate(pts);
          if (last > detail) detail = last;
        }
        setNavStatus({ kind: "cached-nav", detail: detail || undefined });
      } else {
        setNavStatus(READY_STATUS);
      }
      setResults(nextResults);
      setNavByCode(navs);
      writeShareQuery(settings, baskets);
    });
    } catch {
      finish();
    }
  }, [settings, baskets]);

  const value = useMemo(
    () => ({
      settings,
      setSettings,
      baskets,
      setBaskets,
      editingId,
      editorSeed,
      openEditor,
      closeEditor,
      saveBasket,
      results,
      navByCode,
      analyzing,
      runAnalysis,
      shareHydrateError,
      status,
      insightsStatus,
      reportStatus,
      workspace,
      setWorkspace,
      insightsOpen,
      insightsBasketId,
      openInsights,
      closeInsights,
    }),
    [
      settings,
      baskets,
      editingId,
      editorSeed,
      openEditor,
      closeEditor,
      saveBasket,
      results,
      navByCode,
      analyzing,
      runAnalysis,
      shareHydrateError,
      status,
      insightsStatus,
      reportStatus,
      workspace,
      setWorkspace,
      insightsOpen,
      insightsBasketId,
      openInsights,
      closeInsights,
    ],
  );

  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLab(): LabContextValue {
  const ctx = useContext(LabContext);
  if (!ctx) throw new Error("useLab must be used within LabProvider");
  return ctx;
}
