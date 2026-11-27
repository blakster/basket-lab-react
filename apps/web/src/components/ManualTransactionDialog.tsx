import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createManualTransaction,
  type ManualTransactionKind,
} from "../lib/api/portfolio";
import { searchFunds } from "../lib/api/search";
import {
  localTodayIso,
  lookupNavOnOrBefore,
} from "../lib/portfolio/portfolioNav";
import {
  armFetch,
  beginFetch,
  BOOT_SEARCH_RUN,
  clearAfterSelect,
  dismissSearch,
  failFetch,
  finishFetch,
  moveActive,
  searchHits,
  searchListOpen,
  searchPhase,
  searchStale,
  typeQuery,
  type SearchRun,
} from "../state/searchRun";
import type { SearchHit } from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ManualTransactionDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const listId = useId();
  const [searchRun, setSearchRun] = useState<SearchRun>(BOOT_SEARCH_RUN);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [kind, setKind] = useState<ManualTransactionKind>("buy");
  const [date, setDate] = useState(() => localTodayIso());
  const [units, setUnits] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const immediateRef = useRef(false);
  const runRef = useRef(searchRun);
  runRef.current = searchRun;

  const hits = searchHits(searchRun).slice(0, 8);
  const phase = searchPhase(searchRun);
  const stale = searchStale(searchRun);
  const listOpen = !selected && searchListOpen(searchRun);
  const activeIndex = searchRun.activeIndex;

  useEffect(() => {
    const request = searchRun.query.trim();
    if (request.length < 2 || selected) return;
    const delay = immediateRef.current ? 0 : 220;
    immediateRef.current = false;
    const controller = new AbortController();
    controllerRef.current = controller;

    const timer = window.setTimeout(() => {
      const next = beginFetch(runRef.current, request);
      if (!next) return;
      setSearchRun(next);

      searchFunds(request, fetch, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setSearchRun((prev) => finishFetch(prev, request, results) ?? prev);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setSearchRun((prev) => failFetch(prev, request) ?? prev);
        });
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [searchRun.query, searchRun.attempt, selected]);

  // Fetch NAV on or before the chosen trade date so users can auto-fill units/amount.
  const navLookupQuery = useQuery({
    queryKey: ["manual-nav-lookup", selected?.schemeCode ?? "", date],
    queryFn: () => lookupNavOnOrBefore(selected!.schemeCode, date),
    enabled: Boolean(open && selected?.schemeCode && date),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const navMatch = navLookupQuery.data ?? null;

  const reset = () => {
    controllerRef.current?.abort();
    setSearchRun(BOOT_SEARCH_RUN);
    setSelected(null);
    setKind("buy");
    setDate(localTodayIso());
    setUnits("");
    setAmount("");
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const pickHit = (hit: SearchHit) => {
    controllerRef.current?.abort();
    setSelected(hit);
    setSearchRun(clearAfterSelect);
    setError(null);
  };

  const mutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Pick a fund first.");
      if (!date) throw new Error("Pick a date.");
      const unitsNum = Number(units);
      const amountNum = Number(amount);
      if (!Number.isFinite(unitsNum) || unitsNum <= 0) {
        throw new Error("Units must be greater than zero.");
      }
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        throw new Error("Amount must be greater than zero.");
      }
      return createManualTransaction({
        scheme: {
          schemeCode: selected.schemeCode,
          name: selected.schemeName,
          isin: selected.isin ?? null,
        },
        date,
        kind,
        units: unitsNum,
        amount: amountNum,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      handleOpenChange(false);
    },
    onError: (err: Error) => setError(err.message || "Could not add this transaction."),
  });

  const amountNum = Number(amount);
  const unitsNum = Number(units);
  const canFillUnits = Boolean(navMatch && navMatch.nav > 0 && Number.isFinite(amountNum) && amountNum > 0);
  const canFillAmount = Boolean(navMatch && navMatch.nav > 0 && Number.isFinite(unitsNum) && unitsNum > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (listOpen) {
            event.preventDefault();
            controllerRef.current?.abort();
            setSearchRun(dismissSearch);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="editor-title">Add transaction</DialogTitle>
          <DialogDescription className="editor-description">
            Record a buy or sell by hand. If the same trade later arrives in a CAS
            statement, the import skips it instead of counting it twice.
          </DialogDescription>
        </DialogHeader>
        <form
          className="manual-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="fund-picker">
            {selected ? (
              <div className="fund-picker-selected">
                <span className="fund-picker-name">
                  {selected.schemeName}
                  <span className="editor-fund-code">{selected.schemeCode}</span>
                </span>
                <button
                  type="button"
                  className="fund-picker-change"
                  onClick={() => {
                    setSelected(null);
                    setSearchRun(BOOT_SEARCH_RUN);
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <Input
                  role="combobox"
                  aria-expanded={listOpen}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    listOpen && activeIndex >= 0
                      ? `${listId}-${activeIndex}`
                      : undefined
                  }
                  value={searchRun.query}
                  onChange={(event) =>
                    setSearchRun((prev) => typeQuery(prev, event.target.value))
                  }
                  onKeyDown={(event) => {
                    if (!listOpen) return;
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      const delta = event.key === "ArrowDown" ? 1 : -1;
                      const next =
                        activeIndex < 0
                          ? delta > 0
                            ? 0
                            : hits.length - 1
                          : (activeIndex + delta + hits.length) % hits.length;
                      setSearchRun((prev) => moveActive(prev, next));
                    } else if (event.key === "Enter" && !stale) {
                      const chosen = hits[activeIndex] ?? hits[0];
                      if (chosen) {
                        event.preventDefault();
                        pickHit(chosen);
                      }
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      controllerRef.current?.abort();
                      setSearchRun(dismissSearch);
                    }
                  }}
                  placeholder="Search mutual fund schemes"
                  aria-label="Search mutual fund schemes"
                  autoComplete="off"
                />
                {listOpen && (
                  <ul id={listId} role="listbox" className="fund-picker-list">
                    {hits.map((hit, idx) => (
                      <li key={`${hit.schemeCode}-${hit.schemeName}`}>
                        <button
                          id={`${listId}-${idx}`}
                          type="button"
                          role="option"
                          aria-selected={idx === activeIndex}
                          disabled={stale}
                          onMouseEnter={() =>
                            setSearchRun((prev) => moveActive(prev, idx))
                          }
                          onClick={() => pickHit(hit)}
                        >
                          {hit.schemeName}
                          <span className="fund-search-code">{hit.schemeCode}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {phase === "loading" && (
                  <span className="cas-hint" role="status">
                    Searching funds…
                  </span>
                )}
                {phase === "ready" &&
                  !stale &&
                  searchRun.query.trim().length >= 2 &&
                  hits.length === 0 && (
                    <span className="cas-hint" role="status">
                      No funds found. Try another scheme name.
                    </span>
                  )}
                {phase === "error" && !stale && (
                  <div className="fund-search-error" role="alert">
                    <p>Search unavailable. Check your connection.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        immediateRef.current = true;
                        setSearchRun(armFetch);
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="manual-kind" role="group" aria-label="Transaction type">
            {(["buy", "sell"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={kind === option ? "is-active" : ""}
                aria-pressed={kind === option}
                onClick={() => setKind(option)}
              >
                {option === "buy" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>

          <div className="manual-fields">
            <label className="manual-field">
              <span>Date</span>
              <Input
                type="date"
                value={date}
                max={localTodayIso()}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="manual-field">
              <span>Amount (₹)</span>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <label className="manual-field">
              <span>Units</span>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="0.000"
                value={units}
                onChange={(event) => setUnits(event.target.value)}
              />
            </label>
          </div>

          {selected && navMatch && (
            <div className="nav-autofill-row">
              <span>
                NAV ({navMatch.date}): <strong>₹{navMatch.nav.toFixed(4)}</strong>
              </span>
              <div className="inline-confirm">
                {canFillUnits && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setUnits((amountNum / navMatch.nav).toFixed(3))
                    }
                  >
                    Fill units
                  </Button>
                )}
                {canFillAmount && !canFillUnits && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setAmount((unitsNum * navMatch.nav).toFixed(2))
                    }
                  >
                    Fill amount
                  </Button>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="cas-note cas-error" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending || !selected}>
              {mutation.isPending ? "Adding…" : "Add transaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
