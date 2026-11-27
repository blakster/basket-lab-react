import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import defaults from "../data/defaults.json";
import { ensureFilings } from "../lib/api/insights";
import { isWeightBalanced } from "../lib/weights";
import type { Basket, LabSettings } from "../types";

const STORAGE_KEY = "basket-lab-v1";

function cloneDefaults(): { settings: LabSettings; baskets: Basket[] } {
  return structuredClone(defaults) as { settings: LabSettings; baskets: Basket[] };
}

const FALLBACK_BASKET_NAME = "Untitled basket";

function withFallbackNames(baskets: Basket[]): Basket[] {
  return baskets.map((basket) =>
    typeof basket.name === "string" && basket.name.trim()
      ? basket
      : { ...basket, name: FALLBACK_BASKET_NAME },
  );
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
    return { settings: parsed.settings, baskets: withFallbackNames(parsed.baskets) };
  } catch {
    return fallback;
  }
}

export function weightSum(basket: Basket): number {
  return basket.funds.reduce((s, f) => s + f.weight, 0);
}

export function useBasketStore() {
  const [initial] = useState(loadPersisted);
  const [settings, setSettingsState] = useState<LabSettings>(initial.settings);
  const [baskets, setBasketsState] = useState<Basket[]>(initial.baskets);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorSeed, setEditorSeed] = useState<Basket | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ baskets, settings }));
    } catch {
      // Ignore quota / private-mode failures.
    }
  }, [baskets, settings]);

  // Only trigger filing refresh when the unique scheme codes actually change,
  // not when toggling active checkboxes, renaming, or changing chart colors.
  const schemeCodesKey = useMemo(
    () =>
      [...new Set(baskets.flatMap((b) => b.funds.map((f) => f.schemeCode)).filter(Boolean))]
        .sort()
        .join(","),
    [baskets],
  );

  useEffect(() => {
    if (!schemeCodesKey) return;
    ensureFilings(schemeCodesKey.split(","));
  }, [schemeCodesKey]);

  const setSettings = useCallback<Dispatch<SetStateAction<LabSettings>>>((action) => {
    setSettingsState(action);
  }, []);

  const setBaskets = useCallback<Dispatch<SetStateAction<Basket[]>>>((action) => {
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
    if (!isWeightBalanced(sum)) return false;
    if (typeof basket.name !== "string" || !basket.name.trim()) return false;
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

  return {
    settings,
    setSettings,
    baskets,
    setBaskets,
    editingId,
    editorSeed,
    openEditor,
    closeEditor,
    saveBasket,
  };
}
