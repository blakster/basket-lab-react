import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { searchFunds } from "../lib/api/search";
import { useLab } from "../state/LabContext";
import type { SearchHit } from "../types";

type FundSearchProps = {
  onSelect: (hit: SearchHit) => void;
};

export function FundSearch({ onSelect }: FundSearchProps) {
  const { reportStatus } = useLab();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (query.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return () => controller.abort();
    }

    const timer = window.setTimeout(() => {
      reportStatus("search", { kind: "search-busy" });
      void searchFunds(query, fetch, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return;
          reportStatus("search", { kind: "ready" });
          setHits(rows);
          setOpen(true);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          reportStatus("search", { kind: "search-down" });
          setHits([]);
          setOpen(false);
        });
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, reportStatus]);

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
          type="search"
          value={query}
          placeholder="Type a fund or ETF name"
          className="rounded-md"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {open && query.trim().length >= 2 && (
        <ul className="fund-search-list" role="listbox">
          {hits.length === 0 ? (
            <li className="fund-search-empty">No results</li>
          ) : (
            hits.map((hit) => (
              <li key={hit.schemeCode}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => {
                    onSelect(hit);
                    setQuery("");
                    setHits([]);
                    setOpen(false);
                  }}
                >
                  <span className="fund-search-name">{hit.schemeName}</span>
                  <span className="fund-search-code">{hit.schemeCode}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
