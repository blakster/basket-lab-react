import { useCallback, useEffect, useState } from "react";
import type { Basket } from "../types";
import type { Workspace } from "./labTypes";

const INSIGHTS_HASH = "#insights";

function workspaceFromHash(): Workspace {
  const hash = window.location.hash;
  if (hash === "#baskets") return "baskets";
  if (hash === "#portfolio") return "portfolio";
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
  else if (workspace === "portfolio") url.hash = "portfolio";
  else if (basketId) url.hash = `insights=${encodeURIComponent(basketId)}`;
  else url.hash = "insights";
  const next = `${url.pathname}${url.search}${url.hash}`;
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === here) return;
  window.history.replaceState(null, "", next);
}

const WORKSPACE_TITLES: Record<Workspace, string> = {
  compare: "Compare · Basket Lab",
  portfolio: "Portfolio · Basket Lab",
  baskets: "Baskets · Basket Lab",
  insights: "Insights · Basket Lab",
};

export function useWorkspace(baskets: Basket[]) {
  const [workspace, setWorkspaceState] = useState<Workspace>(workspaceFromHash);
  const [insightsBasketId, setInsightsBasketId] = useState<string | null>(
    readInsightsBasketId,
  );
  const insightsOpen = workspace === "insights";

  useEffect(() => {
    document.title = WORKSPACE_TITLES[workspace];
  }, [workspace]);

  useEffect(() => {
    const sync = () => {
      setWorkspaceState(workspaceFromHash());
      setInsightsBasketId(readInsightsBasketId());
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const pickInsightsId = useCallback(
    (prev: string | null, asked?: string) => {
      const valid = (id: string | null | undefined) =>
        id != null && baskets.some((b) => b.id === id) ? id : undefined;
      return (
        valid(asked) ??
        valid(prev) ??
        baskets.find((b) => b.active)?.id ??
        baskets[0]?.id ??
        null
      );
    },
    [baskets],
  );

  const setWorkspace = useCallback(
    (next: Workspace) => {
      setWorkspaceState(next);
      if (next !== "insights") {
        writeWorkspaceHash(next);
        return;
      }
      const id = pickInsightsId(insightsBasketId);
      setInsightsBasketId(id);
      writeWorkspaceHash("insights", id);
    },
    [pickInsightsId, insightsBasketId],
  );

  const openInsights = useCallback(
    (basketId?: string, options?: { allowPending?: boolean }) => {
      const asked =
        typeof basketId === "string" && basketId ? basketId : undefined;
      const id =
        options?.allowPending && asked
          ? asked
          : pickInsightsId(insightsBasketId, asked);
      setInsightsBasketId(id);
      writeWorkspaceHash("insights", id);
      setWorkspaceState("insights");
    },
    [pickInsightsId, insightsBasketId],
  );

  const closeInsights = useCallback(() => {
    writeWorkspaceHash("compare");
    setWorkspaceState("compare");
  }, []);

  return {
    workspace,
    setWorkspace,
    insightsOpen,
    insightsBasketId,
    openInsights,
    closeInsights,
  };
}
