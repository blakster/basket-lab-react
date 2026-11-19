import { useCallback, useEffect, useState } from "react";
import type { Basket } from "../types";
import type { Workspace } from "./labTypes";

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

export function useWorkspace(baskets: Basket[]) {
  const [workspace, setWorkspaceState] = useState<Workspace>(workspaceFromHash);
  const [insightsBasketId, setInsightsBasketId] = useState<string | null>(
    readInsightsBasketId,
  );
  const insightsOpen = workspace === "insights";

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

  return {
    workspace,
    setWorkspace,
    insightsOpen,
    insightsBasketId,
    openInsights,
    closeInsights,
  };
}
