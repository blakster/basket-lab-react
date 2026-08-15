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
import { fetchNav } from "../lib/api/nav";
import { backtestBasket } from "../lib/backtest/performance";
import {
  isNavCacheFresh,
  readNavCacheEntry,
  writeNavCache,
  type NavCacheEntry,
} from "../lib/navCache";
import { resolveRange } from "../lib/resolveSettings";
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
  runAnalysis: () => Promise<void>;
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

function cacheCoversRange(
  points: NavPoint[],
  since: string,
  to: string,
): boolean {
  if (!points.length) return false;
  const hasOnOrBeforeSince = points.some((p) => p.date <= since);
  if (!hasOnOrBeforeSince) return false;
  if (points.some((p) => p.date >= to)) return true;
  const last = points.reduce(
    (a, p) => (p.date > a ? p.date : a),
    points[0].date,
  );
  if (last > to) return false;
  const gap =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) /
    86_400_000;
  return gap <= RANGE_SLACK_DAYS;
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
  const initial = loadPersisted();
  const [settings, setSettings] = useState<LabSettings>(initial.settings);
  const [baskets, setBaskets] = useState<Basket[]>(initial.baskets);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorSeed, setEditorSeed] = useState<Basket | null>(null);
  const [results, setResults] = useState<BacktestResult[]>([]);
  const runIdRef = useRef(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ baskets, settings }));
    } catch {
      // Ignore quota / private-mode failures.
    }
  }, [baskets, settings]);

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
    setBaskets((prev) => {
      const idx = prev.findIndex((b) => b.id === basket.id);
      if (idx === -1) return [...prev, basket];
      const next = [...prev];
      next[idx] = basket;
      return next;
    });
    return true;
  }, []);

  const runAnalysis = useCallback(async () => {
    const runId = ++runIdRef.current;
    if (settings.amount < 100) {
      if (runId === runIdRef.current) setResults([]);
      return;
    }

    const active = baskets.filter((b) => b.active);
    if (
      active.some((b) => Math.abs(weightSum(b) - 100) >= WEIGHT_TOLERANCE)
    ) {
      if (runId === runIdRef.current) setResults([]);
      return;
    }
    if (!active.length) {
      if (runId === runIdRef.current) setResults([]);
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

    await Promise.all(
      codes.map(async (code) => {
        const entry = await readNavCacheEntry(code);
        entries.set(code, entry);
        if (entry && cacheUsable(entry, start, end)) {
          navs[code] = entry.points;
        } else {
          toFetch.push(code);
        }
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
            await writeNavCache(code, merged);
            navs[code] = merged;
          } else {
            // Failed fetch: reuse covering-but-stale cache only ("Using saved NAV").
            navs[code] =
              prev && cacheCoversRange(prev.points, start, end)
                ? prev.points
                : [];
          }
        }),
      );
    }

    if (runId !== runIdRef.current) return;
    setResults(
      active.map((b) => backtestBasket(b, navsForBasket(b, navs), resolved)),
    );
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
      runAnalysis,
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
      runAnalysis,
    ],
  );

  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLab(): LabContextValue {
  const ctx = useContext(LabContext);
  if (!ctx) throw new Error("useLab must be used within LabProvider");
  return ctx;
}
