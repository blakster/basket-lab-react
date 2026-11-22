import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useId, useRef, useState } from "react";
import { searchFunds } from "../lib/api/search";
import { useLab } from "../state/LabContext";
import {
  BOOT_SEARCH_RUN,
  armFetch,
  beginFetch,
  clearAfterSelect,
  dismissSearch,
  failFetch,
  finishFetch,
  moveActive,
  searchHits,
  searchListOpen,
  searchPhase,
  searchStatus,
  searchStale,
  typeQuery,
} from "../state/searchRun";
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
  const [run, setRun] = useState(BOOT_SEARCH_RUN);
  const runRef = useRef(run);
  runRef.current = run;
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const immediateRef = useRef(false);
  const scrollActiveRef = useRef(false);
  const hintId = useId();
  const listId = `${hintId}-options`;
  const hits = searchHits(run);
  const listOpen = searchListOpen(run);
  const stale = searchStale(run);
  const phase = searchPhase(run);
  const { query, activeIndex } = run;

  useEffect(() => {
    reportStatus("search", searchStatus(run));
  }, [run, reportStatus]);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const rawQuery = run.query;
    const request = rawQuery.trim();
    if (request.length < 2) {
      immediateRef.current = false;
      return () => {
        controller.abort();
        if (controllerRef.current === controller) controllerRef.current = null;
      };
    }

    const delay = immediateRef.current ? 0 : 300;
    immediateRef.current = false;

    const timer = window.setTimeout(() => {
      if (!beginFetch(runRef.current, request)) return;
      setRun((prev) => beginFetch(prev, request) ?? prev);
      void searchFunds(rawQuery, fetch, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return;
          setRun((prev) => finishFetch(prev, request, rows) ?? prev);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setRun((prev) => failFetch(prev, request) ?? prev);
        });
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [run.query, run.attempt]);

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

  function closeAndAbort() {
    controllerRef.current?.abort();
    setRun(dismissSearch);
  }

  const dismissRef = useRef(closeAndAbort);
  dismissRef.current = closeAndAbort;

  useEffect(() => {
    const active =
      query.trim().length >= 2 || phase !== "idle" || hits.length > 0;
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
  }, [query, phase, hits.length]);

  function selectHit(hit: SearchHit) {
    onSelect(hit);
    setRun(clearAfterSelect);
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="fund-search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          immediateRef.current = true;
          setRun(armFetch);
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
              setRun((prev) => typeQuery(prev, event.target.value));
            }}
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                if (event.shiftKey || phase !== "error" || stale) {
                  closeAndAbort();
                }
                return;
              }
              if (!listOpen) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                scrollActiveRef.current = true;
                const delta = event.key === "ArrowDown" ? 1 : -1;
                setRun((prev) =>
                  moveActive(
                    prev,
                    stepActiveIndex(prev.activeIndex, delta, hits.length),
                  ),
                );
              } else if (event.key === "Enter" && !stale) {
                event.preventDefault();
                if (activeIndex < 0) {
                  scrollActiveRef.current = true;
                  setRun((prev) =>
                    moveActive(
                      prev,
                      firstAddableIndex(searchHits(prev), selectedCodes),
                    ),
                  );
                } else {
                  const hit = hits[activeIndex];
                  if (hit && !selectedCodes.includes(hit.schemeCode)) {
                    selectHit(hit);
                  }
                }
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeAndAbort();
              }
            }}
          />
        </label>
      </form>
      <p id={hintId} className="fund-search-hint">
        Search by name using at least 2 characters.
      </p>
      <div className="fund-search-feedback" role="status">
        {phase === "loading" && <p>Searching funds…</p>}
        {phase === "ready" && hits.length === 0 && !stale && (
          <p>No funds found. Try another name.</p>
        )}
        {phase === "ready" && hits.length > 0 && (
          <p>
            {stale
              ? "Updating results…"
              : `${hits.length} ${hits.length === 1 ? "fund" : "funds"} found`}
          </p>
        )}
        {phase === "error" && !stale && (
          <div className="fund-search-error">
            <p>Search unavailable. Your basket is unchanged.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                immediateRef.current = true;
                setRun(armFetch);
                inputRef.current?.focus();
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
                    setRun((prev) => moveActive(prev, index));
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
