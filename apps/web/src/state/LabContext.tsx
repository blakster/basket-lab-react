import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import defaults from "../data/defaults.json";
import type { Basket, LabSettings } from "../types";

const STORAGE_KEY = "basket-lab-v1";
const WEIGHT_TOLERANCE = 0.1;

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

export function LabProvider({ children }: { children: ReactNode }) {
  const initial = loadPersisted();
  const [settings, setSettings] = useState<LabSettings>(initial.settings);
  const [baskets, setBaskets] = useState<Basket[]>(initial.baskets);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorSeed, setEditorSeed] = useState<Basket | null>(null);

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
    const sum = basket.funds.reduce((s, f) => s + f.weight, 0);
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
    }),
    [settings, baskets, editingId, editorSeed, openEditor, closeEditor, saveBasket],
  );

  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

export function useLab(): LabContextValue {
  const ctx = useContext(LabContext);
  if (!ctx) throw new Error("useLab must be used within LabProvider");
  return ctx;
}
