import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useId, useRef, useState } from "react";
import { searchFunds } from "../lib/api/search";
import { useLab } from "../state/LabContext";
import type { SearchHit } from "../types";

type FundSearchProps = {
  onSelect: (hit: SearchHit) => void;
  selectedCodes?: string[];
};

export function FundSearch({ onSelect, selectedCodes = [] }: FundSearchProps) {
  const { reportStatus } = useLab();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  useEffect(() => {
    const controller = new AbortController();
    if (query.trim().length < 2) {
      reportStatus("search", { kind: "ready" });
      return () => controller.abort();
    }

    const timer = window.setTimeout(() => {
      reportStatus("search", { kind: "search-busy" });
      void searchFunds(query, fetch, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return;
          reportStatus("search", { kind: "ready" });
          setHits(rows);
          setState("ready");
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          reportStatus("search", { kind: "search-down" });
          setHits([]);
          setState("error");
        });
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, attempt, reportStatus]);

  useEffect(() => {
    return () => {
      reportStatus("search", { kind: "ready" });
    };
  }, [reportStatus]);

  return (
    <div className="fund-search">
      <label className="field">
        <span>Search funds</span>
        <Input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Fund or ETF name"
          className="border-0 rounded-[var(--r-sm)] bg-[var(--paper)] px-[0.65rem] py-[0.45rem] min-w-[8rem] shadow-[var(--shadow-border)]"
          aria-describedby={hintId}
          autoComplete="off"
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setHits([]);
            setState(next.trim().length >= 2 ? "loading" : "idle");
          }}
        />
      </label>
      <p id={hintId} className="fund-search-hint">
        Search by name using at least 2 characters.
      </p>
      <div className="fund-search-feedback" role="status">
        {state === "loading" && <p>Searching funds…</p>}
        {state === "ready" && hits.length === 0 && (
          <p>No funds found. Try another name.</p>
        )}
        {state === "ready" && hits.length > 0 && (
          <p>
            {hits.length} {hits.length === 1 ? "fund" : "funds"} found
          </p>
        )}
        {state === "error" && (
          <div className="fund-search-error">
            <p>Search unavailable. Your basket is unchanged.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setState("loading");
                setAttempt((value) => value + 1);
              }}
            >
              Retry search
            </Button>
          </div>
        )}
      </div>
      {state === "ready" && hits.length > 0 && (
        <ul className="fund-search-list" aria-label="Fund search results">
          {hits.map((hit) => {
            const added = selectedCodes.includes(hit.schemeCode);
            return (
              <li key={hit.schemeCode}>
                <button
                  type="button"
                  disabled={added}
                  onClick={() => {
                    onSelect(hit);
                    setQuery("");
                    setHits([]);
                    setState("idle");
                    inputRef.current?.focus();
                  }}
                >
                  <span className="fund-search-name">
                    {hit.schemeName}
                    <span className="fund-search-code">{hit.schemeCode}</span>
                  </span>
                  <span className="fund-search-action">
                    {added ? "Added" : "+ Add"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
