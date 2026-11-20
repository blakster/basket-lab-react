import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import defaults from "../data/defaults.json";
import { ensureFilings } from "../lib/api/insights";
import { decodeShare, encodeShare } from "../lib/shareUrl";
import { WEIGHT_TOLERANCE } from "../lib/weights";
import type { Basket, LabSettings } from "../types";

const STORAGE_KEY = "basket-lab-v1";

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
      return { ...cloneDefaults(), shareHydrateError: true };
    }
  } catch {
    // Fall through to localStorage.
  }
  return { ...loadPersisted(), shareHydrateError: false };
}

export function writeShareQuery(
  settings: LabSettings,
  baskets: Basket[],
): void {
  try {
    const encoded = encodeShare({ settings, baskets });
    const url = new URL(window.location.href);
    url.searchParams.set("s", encoded);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Ignore history / encode failures (private mode, etc.).
  }
}

export function weightSum(basket: Basket): number {
  return basket.funds.reduce((s, f) => s + f.weight, 0);
}

export function useBasketStore() {
  const [initial] = useState(loadInitial);
  const [settings, setSettingsState] = useState<LabSettings>(initial.settings);
  const [baskets, setBasketsState] = useState<Basket[]>(initial.baskets);
  const [shareHydrateError] = useState(initial.shareHydrateError);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorSeed, setEditorSeed] = useState<Basket | null>(null);
  /** After a failed `?s=` hydrate, keep session defaults without wiping storage until the user edits. */
  const blockPersistRef = useRef(initial.shareHydrateError);

  useEffect(() => {
    if (!initial.shareHydrateError) return;
    // Keep initialization pure so StrictMode cannot consume this error before
    // the committed render. Remove the corrupt query only after mounting.
    const url = new URL(window.location.href);
    url.searchParams.delete("s");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [initial.shareHydrateError]);

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
    shareHydrateError,
  };
}
