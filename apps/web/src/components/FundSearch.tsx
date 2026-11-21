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
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const listId = `${hintId}-options`;
  const listOpen = state === "ready" && hits.length > 0;

  useEffect(() => {
    const controller = new AbortController();
    if (query.trim().length < 2) {
      reportStatus("search", { kind: "ready" });
      return () => controller.abort();
    }

    const timer = window.setTimeout(() => {
      reportStatus("search", { kind: "search-busy" });
      setState("loading");
      void searchFunds(query, fetch, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return;
          reportStatus("search", { kind: "ready" });
          setHits(rows);
          setActiveIndex(-1);
          setState("ready");
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          reportStatus("search", { kind: "search-down" });
          setHits([]);
          setState("error");
        });
    }, 300);

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

  useEffect(() => {
    if (!listOpen || activeIndex < 0) return;
    document
      .getElementById(`${listId}-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listOpen, listId]);

  function selectHit(hit: SearchHit) {
    onSelect(hit);
    setQuery("");
    setHits([]);
    setActiveIndex(-1);
    setState("idle");
    inputRef.current?.focus();
  }

  return (
    <div className="fund-search">
      <label className="field">
        <span>Search funds</span>
        <Input
          ref={inputRef}
          type="search"
          role="combobox"
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
            setQuery(next);
            setHits([]);
            setActiveIndex(-1);
            setState("idle");
          }}
          onKeyDown={(event) => {
            if (!listOpen) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const delta = event.key === "ArrowDown" ? 1 : -1;
              setActiveIndex((index) =>
                index < 0
                  ? delta > 0
                    ? 0
                    : hits.length - 1
                  : (index + delta + hits.length) % hits.length,
              );
            } else if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              const hit = hits[activeIndex];
              if (hit && !selectedCodes.includes(hit.schemeCode)) {
                selectHit(hit);
              }
            } else if (event.key === "Escape") {
              event.stopPropagation();
              setHits([]);
              setActiveIndex(-1);
              setState("idle");
            }
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
      <ul
        id={listId}
        className="fund-search-list"
        role="listbox"
        aria-label="Fund search results"
        hidden={!listOpen}
      >
        {listOpen &&
          hits.map((hit, index) => {
            const added = selectedCodes.includes(hit.schemeCode);
            return (
              <li
                key={hit.schemeCode}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === activeIndex}
                aria-disabled={added || undefined}
                onClick={() => {
                  if (!added) selectHit(hit);
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
