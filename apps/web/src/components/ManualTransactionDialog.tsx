import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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
import type { SearchHit } from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ManualTransactionDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [kind, setKind] = useState<ManualTransactionKind>("buy");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [units, setUnits] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || selected) {
      setHits([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      searchFunds(q, fetch, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setHits(results.slice(0, 8));
        })
        .catch(() => {
          if (!controller.signal.aborted) setHits([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected]);

  const reset = () => {
    setQuery("");
    setHits([]);
    setSelected(null);
    setKind("buy");
    setDate(new Date().toISOString().slice(0, 10));
    setUnits("");
    setAmount("");
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
          <DialogDescription>
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
                <span className="fund-picker-name">{selected.schemeName}</span>
                <button
                  type="button"
                  className="fund-picker-change"
                  onClick={() => {
                    setSelected(null);
                    setQuery("");
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search mutual fund schemes"
                  aria-label="Search mutual fund schemes"
                />
                {hits.length > 0 && (
                  <ul className="fund-picker-list">
                    {hits.map((hit) => (
                      <li key={`${hit.schemeCode}-${hit.schemeName}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(hit);
                            setHits([]);
                            setQuery("");
                          }}
                        >
                          {hit.schemeName}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {searching && <span className="cas-hint">Searching…</span>}
                {!searching &&
                  !selected &&
                  query.trim().length >= 2 &&
                  hits.length === 0 && (
                    <span className="cas-hint">No funds found.</span>
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
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDate(event.target.value)}
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
          </div>

          {error && <span className="cas-note cas-error">{error}</span>}

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
