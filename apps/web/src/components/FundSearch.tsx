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

function stepActiveIndex(index: number, delta: number, count: number): number {
  if (index < 0) return delta > 0 ? 0 : count - 1;
  return (index + delta + count) % count;
}

function firstAddableIndex(hits: SearchHit[], selectedCodes: string[]): number {
  const index = hits.findIndex(
    (row) => !selectedCodes.includes(row.schemeCode),
  );
  return index < 0 ? 0 : index;
}

export function FundSearch({ onSelect, selectedCodes = [] }: FundSearchProps) {
  const { reportStatus } = useLab();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [attempt, setAttempt] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hitsQuery, setHitsQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const dismissedQueryRef = useRef<string | null>(null);
  const immediateRef = useRef(false);
  const scrollActiveRef = useRef(false);
  const hintId = useId();
  const listId = `${hintId}-options`;
  const listOpen = (state === "ready" || state === "loading") && hits.length > 0;
  const stale = query.trim() !== hitsQuery;

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    if (query.trim().length < 2) {
      immediateRef.current = false;
      reportStatus("search", { kind: "ready" });
      return () => {
        controller.abort();
        if (controllerRef.current === controller) controllerRef.current = null;
      };
    }

    const delay = immediateRef.current ? 0 : 300;
    immediateRef.current = false;

    const timer = window.setTimeout(() => {
      if (dismissedQueryRef.current === query.trim()) return;
      reportStatus("search", { kind: "search-busy" });
      setState("loading");
      void searchFunds(query, fetch, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return;
          reportStatus("search", { kind: "ready" });
          setHits(rows);
          setHitsQuery(query.trim());
          setActiveIndex(-1);
          setState("ready");
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          reportStatus("search", { kind: "search-down" });
          setHits([]);
          setHitsQuery(query.trim());
          setState("error");
        });
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [query, attempt, reportStatus]);

  useEffect(() => {
    return () => {
      reportStatus("search", { kind: "ready" });
    };
  }, [reportStatus]);

  useEffect(() => {
    if (!listOpen || activeIndex < 0 || !scrollActiveRef.current) return;
    scrollActiveRef.current = false;
    document
      .getElementById(`${listId}-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listOpen, listId]);

  function closeList() {
    setHits([]);
    setActiveIndex(-1);
    setState("idle");
  }

  function dismissSearch() {
    const trimmed = query.trim();
    if (trimmed.length >= 2) dismissedQueryRef.current = trimmed;
    controllerRef.current?.abort();
    reportStatus("search", { kind: "ready" });
    closeList();
  }

  const dismissRef = useRef(dismissSearch);
  dismissRef.current = dismissSearch;

  useEffect(() => {
    const active = query.trim().length >= 2 || state !== "idle" || hits.length > 0;
    if (!active) return;
    function onDocumentClick(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return;
      }
      dismissRef.current();
    }
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [query, state, hits.length]);

  function selectHit(hit: SearchHit) {
    onSelect(hit);
    setQuery("");
    closeList();
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="fund-search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          dismissedQueryRef.current = null;
          immediateRef.current = true;
          setAttempt((value) => value + 1);
        }}
      >
        <label className="field">
          <span>Search funds</span>
          <Input
            ref={inputRef}
            type="search"
            role="combobox"
            className="fund-search-input"
            value={query}
            placeholder="Fund or ETF name"
            aria-describedby={hintId}
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              listOpen && activeIndex >= 0
                ? `${listId}-${activeIndex}`
                : undefined
            }
            autoComplete="off"
            onChange={(event) => {
              const next = event.target.value;
              dismissedQueryRef.current = null;
              setQuery(next);
              setActiveIndex(-1);
              if (next.trim().length < 2) closeList();
            }}
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                dismissSearch();
                return;
              }
              if (!listOpen) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                scrollActiveRef.current = true;
                const delta = event.key === "ArrowDown" ? 1 : -1;
                setActiveIndex((index) =>
                  stepActiveIndex(index, delta, hits.length),
                );
              } else if (event.key === "Enter" && !stale) {
                event.preventDefault();
                if (activeIndex < 0) {
                  scrollActiveRef.current = true;
                  setActiveIndex(firstAddableIndex(hits, selectedCodes));
                } else {
                  const hit = hits[activeIndex];
                  if (hit && !selectedCodes.includes(hit.schemeCode)) {
                    selectHit(hit);
                  }
                }
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                dismissSearch();
              }
            }}
          />
        </label>
      </form>
      <p id={hintId} className="fund-search-hint">
        Search by name using at least 2 characters.
      </p>
      <div className="fund-search-feedback" role="status">
        {state === "loading" && <p>Searching funds…</p>}
        {state === "ready" && hits.length === 0 && !stale && (
          <p>No funds found. Try another name.</p>
        )}
        {state === "ready" && hits.length > 0 && (
          <p>
            {stale
              ? "Updating results…"
              : `${hits.length} ${hits.length === 1 ? "fund" : "funds"} found`}
          </p>
        )}
        {state === "error" && !stale && (
          <div className="fund-search-error">
            <p>Search unavailable. Your basket is unchanged.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                dismissedQueryRef.current = null;
                immediateRef.current = true;
                setAttempt((value) => value + 1);
              }}
            >
              Retry search
            </Button>
          </div>
        )}
      </div>
      <ul
        id={listId}
        className="fund-search-list"
        role="listbox"
        aria-label="Fund search results"
        hidden={!listOpen}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
      >
        {listOpen &&
          hits.map((hit, index) => {
            const added = selectedCodes.includes(hit.schemeCode);
            const inert = added || stale;
            return (
              <li
                key={hit.schemeCode}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={inert || undefined}
                onMouseEnter={() => {
                  if (!inert) {
                    scrollActiveRef.current = false;
                    setActiveIndex(index);
                  }
                }}
                onClick={() => {
                  if (!inert) selectHit(hit);
                }}
              >
                <span className="fund-search-name">
                  {hit.schemeName}
                  <span className="fund-search-code">{hit.schemeCode}</span>
                </span>
                <span className="fund-search-action">
                  {added ? "Added" : "+ Add"}
                </span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
