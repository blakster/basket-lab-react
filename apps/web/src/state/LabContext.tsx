import {
  createContext,
  useContext,
  useMemo,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { BacktestResult, Basket, LabSettings, NavPoint } from "../types";
import { useBasketStore } from "./basketStore";
import { useLabStatus } from "./useLabStatus";
import { useNavQuery } from "./useNavQuery";
import { useWorkspace } from "./useWorkspace";
import { pickStatus, type LabStatus, type StatusSource, type Workspace } from "./labTypes";

export type {
  LabStatus,
  LabStatusKind,
  StatusSource,
  Workspace,
} from "./labTypes";

type LabContextValue = {
  settings: LabSettings;
  setSettings: Dispatch<SetStateAction<LabSettings>>;
  baskets: Basket[];
  setBaskets: Dispatch<SetStateAction<Basket[]>>;
  editingId: string | null;
  editorSeed: Basket | null;
  openEditor: (id: string, seed?: Basket) => void;
  closeEditor: () => void;
  saveBasket: (basket: Basket) => boolean;
  results: BacktestResult[];
  navByCode: Record<string, NavPoint[]>;
  analyzing: boolean;
  runAnalysis: () => Promise<void>;
  status: LabStatus;
  insightsStatus: LabStatus;
  reportStatus: (source: StatusSource, next: LabStatus) => void;
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
  insightsOpen: boolean;
  insightsBasketId: string | null;
  openInsights: (basketId?: string, options?: { allowPending?: boolean }) => void;
  closeInsights: () => void;
};

const LabContext = createContext<LabContextValue | null>(null);

export function LabProvider({ children }: { children: ReactNode }) {
  const {
    settings,
    setSettings,
    baskets,
    setBaskets,
    editingId,
    editorSeed,
    openEditor,
    closeEditor,
    saveBasket,
  } = useBasketStore();
  const { searchStatus, insightsStatus, reportStatus } = useLabStatus();
  const { results, navByCode, analyzing, navStatus, runAnalysis } = useNavQuery(
    settings,
    baskets,
  );
  const status = useMemo(
    () => pickStatus([navStatus, searchStatus, insightsStatus]),
    [navStatus, searchStatus, insightsStatus],
  );
  const {
    workspace,
    setWorkspace,
    insightsOpen,
    insightsBasketId,
    openInsights,
    closeInsights,
  } = useWorkspace(baskets);

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

export function useOptionalLab(): LabContextValue | null {
  return useContext(LabContext);
}
