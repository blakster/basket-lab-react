import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchNav } from "../lib/api/nav";
import {
  CAS_FILE_REJECT_MESSAGE,
  casFileRejected,
  deleteManualTransaction,
  getPortfolio,
  importCas,
} from "../lib/api/portfolio";
import { formatCompactInr, formatInr } from "../lib/format";
import {
  buildPositions,
  growthSeries,
  holdingsFromStatements,
  portfolioTotals,
  unitsByInstrument,
  xirrPercent,
  type Position,
} from "../lib/portfolio/returns";
import { GrowthPathChart } from "./LabPlots";
import { ManualTransactionDialog } from "./ManualTransactionDialog";

function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const text = n.toFixed(2);
  return `${text === "-0.00" ? "0.00" : text}%`;
}

function formatSignedInr(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${formatInr(Math.abs(n))}`;
}

export function PortfolioWorkspace() {
  const queryClient = useQueryClient();
  const portfolioQuery = useQuery({ queryKey: ["portfolio"], queryFn: getPortfolio });
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Choose a CAS PDF first.");
      return importCas(file, password);
    },
    onSuccess: (result) => {
      setFile(null);
      setPassword("");
      setFormError(null);
      setImportNote(
        `Imported ${result.imported} transaction${result.imported === 1 ? "" : "s"}` +
          (result.duplicates > 0 ? `, ${result.duplicates} already known` : "") +
          (result.skipped > 0 ? `, ${result.skipped} skipped` : "") +
          (result.warnings?.length ? `, ${result.warnings.length} parser warning${result.warnings.length === 1 ? "" : "s"}` : "") +
          ".",
      );
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
    onError: (error: Error) => {
      setFormError(error.message || "Could not read this statement.");
      setImportNote(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteManualTransaction(id),
    onSuccess: () => {
      setDeleteError(null);
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
    onError: (error: Error) => {
      setDeleteError(error.message || "Could not delete this transaction.");
    },
  });

  const data = portfolioQuery.data;

  const model = useMemo(() => {
    if (!data) return null;
    const instrumentsById = new Map(data.instruments.map((i) => [i.id, i]));
    const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
    const positions = buildPositions(data.transactions);
    const units = unitsByInstrument(data.transactions);

    // Held units per instrument: statement closing units extended by any
    // later transactions, with coverage of the statement period itself.
    const holdings = holdingsFromStatements(data.transactions, data.snapshots);
    for (const [id, holding] of holdings) {
      if (!positions.has(id)) {
        positions.set(id, {
          instrumentId: id,
          units: holding.heldUnits,
          invested: 0,
          proceeds: 0,
          income: 0,
          firstDate: null,
          lastDate: null,
        });
      }
    }

    const codeByInstrument = new Map<string, string>();
    for (const inst of data.instruments) {
      if (inst.schemeCode) codeByInstrument.set(inst.id, inst.schemeCode);
    }
    const firstTxDateByInstrument = new Map<string, string>();
    for (const tx of data.transactions) {
      const prev = firstTxDateByInstrument.get(tx.instrumentId);
      if (!prev || tx.date < prev) firstTxDateByInstrument.set(tx.instrumentId, tx.date);
    }

    // One snapshot per account+instrument; sum across accounts (folios) so a
    // fund held in several folios keeps every one, dated by the latest.
    let earliestSnapshot: string | null = null;
    const snapshotByInstrument = new Map<string, { date: string; value: number }>();
    for (const snap of data.snapshots) {
      if (!earliestSnapshot || snap.date < earliestSnapshot) earliestSnapshot = snap.date;
      const prev = snapshotByInstrument.get(snap.instrumentId);
      if (!prev) {
        snapshotByInstrument.set(snap.instrumentId, { date: snap.date, value: snap.value });
      } else {
        snapshotByInstrument.set(snap.instrumentId, {
          date: snap.date > prev.date ? snap.date : prev.date,
          value: prev.value + snap.value,
        });
      }
    }

    // NAV fetch window: earliest transaction of any NAV-backed fund → today.
    let since: string | null = null;
    for (const id of codeByInstrument.keys()) {
      if (!firstTxDateByInstrument.has(id)) continue;
      const d = firstTxDateByInstrument.get(id)!;
      if (!since || d < since) since = d;
    }
    // Snapshot-only holdings (no trades in the period) still need live NAVs.
    if (!since && earliestSnapshot) since = earliestSnapshot;
    const navCodes = [...new Set(codeByInstrument.values())].sort();

    return {
      instrumentsById,
      accountsById,
      positions,
      units,
      holdings,
      codeByInstrument,
      firstTxDateByInstrument,
      snapshotByInstrument,
      navCodes,
      since,
    };
  }, [data]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const navQuery = useQuery({
    queryKey: ["portfolio-nav", model?.navCodes.join(",") ?? "", model?.since ?? ""],
    queryFn: () => fetchNav(model!.navCodes, model!.since!, today),
    enabled: !!model && model.navCodes.length > 0 && !!model.since,
    staleTime: 5 * 60 * 1000,
  });

  const derived = useMemo(() => {
    if (!data || !model) return null;
    const navByCode = new Map<string, { date: string; nav: number }[]>();
    for (const [code, points] of Object.entries(navQuery.data ?? {})) {
      if (points.length) navByCode.set(code, points);
    }

    const values = new Map<string, number>();
    const valueDateByInstrument = new Map<string, string>();
    const snapshotValued = new Set<string>();
    for (const id of model.positions.keys()) {
      const code = model.codeByInstrument.get(id);
      const series = code ? navByCode.get(code) : undefined;
      const held = model.holdings.get(id)?.heldUnits ?? model.units.get(id)?.total ?? 0;
      if (series && series.length) {
        const latest = series[series.length - 1];
        values.set(id, held > 0 ? held * latest.nav : 0);
        valueDateByInstrument.set(id, latest.date);
      } else {
        snapshotValued.add(id);
        const snap = model.snapshotByInstrument.get(id);
        values.set(id, snap?.value ?? 0);
        valueDateByInstrument.set(id, snap?.date ?? today);
      }
    }

    // A fund's value date is its own freshest valuation, never before its last
    // transaction: XIRR cannot credit a purchase before the money went out,
    // and one fund's newer NAV must not redate another fund's return.
    const valueDate = (id: string) => {
      const v = valueDateByInstrument.get(id) ?? today;
      const t = model.positions.get(id)?.lastDate;
      return t && t > v ? t : v;
    };
    let asOf = "";
    for (const id of model.positions.keys()) {
      const d = valueDate(id);
      if (d > asOf) asOf = d;
    }
    const asOfDate = asOf || today;
    // A statement that closes above the summed transactions carries an
    // opening balance it does not describe; gains and XIRR are unknowable.
    const complete = [...model.positions.keys()].every(
      (id) => model.holdings.get(id)?.covered ?? true,
    );
    const totals = portfolioTotals(data.transactions, model.positions, values, asOfDate, complete);
    const seriesPoints = growthSeries(
      data.transactions,
      navByCode,
      model.codeByInstrument,
      model.snapshotByInstrument,
      model.firstTxDateByInstrument,
    );

    const rows = [...model.positions.values()]
      .map((position: Position) => {
        const instrument = model.instrumentsById.get(position.instrumentId);
        const value = values.get(position.instrumentId) ?? 0;
        const covered = model.holdings.get(position.instrumentId)?.covered ?? true;
        const gain = covered ? value + position.proceeds + position.income - position.invested : null;
        const accountIds = new Set(
          data.transactions
            .filter((t) => t.instrumentId === position.instrumentId)
            .map((t) => t.accountId),
        );
        return {
          position,
          instrument,
          value,
          gain,
          gainPct: covered && gain !== null && position.invested > 0 ? (gain / position.invested) * 100 : null,
          covered,
          xirr: covered ? xirrPercent(data.transactions, value, valueDate(position.instrumentId), position.instrumentId) : null,
          accounts: [...accountIds]
            .map((id) => model.accountsById.get(id))
            .filter(Boolean)
            .map((a) => a!.label),
        };
      })
      .filter((row) => row.position.units !== 0 || row.position.invested > 0 || row.value > 0)
      .sort((a, b) => b.value - a.value);

    return { totals, seriesPoints, rows, asOf: asOfDate, complete, snapshotValued, navLoading: navQuery.isLoading };
  }, [data, model, navQuery.data, navQuery.isLoading, today]);

  if (portfolioQuery.isLoading) {
    return <p className="insight-empty" role="status">Loading portfolio…</p>;
  }
  if (portfolioQuery.isError || !data || !model || !derived) {
    return (
      <p className="insight-empty" role="alert">
        Portfolio unavailable. Check that the API is running.
      </p>
    );
  }

  const hasHoldings = data.transactions.length > 0 || data.snapshots.length > 0;
  const manualTransactions = data.transactions
    .filter((tx) => tx.manual)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const chartData = derived.seriesPoints.map((p) => ({ date: p.date, value: p.value }));
  const showChart =
    derived.complete && chartData.length >= 2 && chartData.some((p) => p.value > 0);
  const fallbackCount = derived.rows.filter((row) =>
    derived.snapshotValued.has(row.position.instrumentId),
  ).length;

  return (
    <div className="portfolio-desk">
      <form
        className="cas-import"
        onSubmit={(event) => {
          event.preventDefault();
          importMutation.mutate();
        }}
      >
        <label className="cas-import-file">
          <span className="cas-import-label">CAS PDF</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              const picked = event.target.files?.[0] ?? null;
              if (picked && casFileRejected(picked)) {
                setFormError(CAS_FILE_REJECT_MESSAGE);
                setFile(null);
              } else {
                setFormError(null);
                setFile(picked);
              }
            }}
          />
        </label>
        <Input
          className="cas-password"
          type="password"
          placeholder="Statement password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-label="CAS statement password"
        />
        <Button type="submit" disabled={!file || importMutation.isPending}>
          {importMutation.isPending ? "Importing…" : "Import"}
        </Button>
        {importNote && <span className="cas-note cas-ok">{importNote}</span>}
        {formError && <span className="cas-note cas-error">{formError}</span>}
      </form>
      <p className="cas-hint">
        CAMS or KFintech consolidated account statement. Re-importing the same file
        adds nothing twice.
      </p>
      <div className="portfolio-actions">
        <Button type="button" onClick={() => setManualOpen(true)}>
          Add transaction
        </Button>
        <ManualTransactionDialog open={manualOpen} onOpenChange={setManualOpen} />
        {deleteError && <span className="cas-note cas-error">{deleteError}</span>}
      </div>

      {!hasHoldings ? (
        <p className="insight-empty">
          No holdings yet. Import a CAS PDF above or add a transaction by
          hand to see returns, XIRR and the growth graph.
        </p>
      ) : (
        <>
          <div className="desk-kpis">
            <div className="desk-kpi">
              <span className="kpi-label">Current value</span>
              <span className="kpi-value">{formatInr(derived.totals.currentValue)}</span>
              <span className="kpi-sub">As of {derived.asOf}</span>
            </div>
            <div className="desk-kpi">
              <span className="kpi-label">Invested</span>
              <span className="kpi-value">{formatInr(derived.totals.invested)}</span>
              <span className="kpi-sub">
                {derived.totals.income > 0
                  ? `Plus ${formatInr(derived.totals.income)} dividends`
                  : "Money you put in"}
              </span>
            </div>
            <div className="desk-kpi">
              <span className="kpi-label">All-time gain</span>
              <span
                className={`kpi-value${(derived.totals.gain ?? 0) < 0 ? " is-down" : " is-up"}`}
              >
                {derived.totals.gain === null ? "—" : formatSignedInr(derived.totals.gain)}
              </span>
              <span className="kpi-sub">{formatPct(derived.totals.gainPct)}</span>
            </div>
            <div className="desk-kpi">
              <span className="kpi-label">XIRR</span>
              <span
                className={`kpi-value${(derived.totals.xirr ?? 0) < 0 ? " is-down" : " is-up"}`}
              >
                {formatPct(derived.totals.xirr)}
              </span>
              <span className="kpi-sub">Money-weighted, all cashflows</span>
            </div>
          </div>

          {derived.navLoading && (
            <p className="insight-empty" role="status">
              Loading NAV history…
            </p>
          )}
          {showChart && (
            <GrowthPathChart
              data={chartData}
              startAmount={derived.totals.invested}
              series={[{ key: "value", label: "Portfolio", color: "var(--ink)", lead: true }]}
            />
          )}
          {fallbackCount > 0 && (
            <p className="cas-hint">
              {fallbackCount} holding{fallbackCount === 1 ? "" : "s"} without NAV
              history valued at the statement's latest figure.
            </p>
          )}
          {!derived.complete && (
            <p className="cas-hint">
              Some holdings predate the imported statement, so all-time gain
              and XIRR are hidden; current value is exact.
            </p>
          )}

          <div className="table-scroll">
            <Table className="insight-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Fund</TableHead>
                  <TableHead className="text-right">Invested</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">All-time gain</TableHead>
                  <TableHead className="text-right">XIRR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {derived.rows.map((row) => (
                  <TableRow key={row.position.instrumentId}>
                    <TableCell>
                      {row.instrument?.name ?? row.position.instrumentId}
                      <span className="holding-sub">
                        {row.accounts.join(" · ") || row.position.instrumentId}
                        {!row.instrument?.schemeCode && " · no NAV history"}
                        {!row.covered && " · predates statement"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.covered ? formatCompactInr(row.position.invested) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCompactInr(row.value)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.gain === null ? (
                        "—"
                      ) : (
                        <>
                          <span className={row.gain < 0 ? "is-down" : "is-up"}>
                            {formatSignedInr(row.gain)}
                          </span>{" "}
                          <span className="insight-weight">{formatPct(row.gainPct)}</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatPct(row.xirr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {manualTransactions.length > 0 && (
            <div className="manual-entries">
              <h3 className="manual-entries-title">Added by hand</h3>
              <ul className="manual-entries-list">
                {manualTransactions.map((tx) => (
                  <li key={tx.id} className="manual-entry">
                    <span className="manual-entry-main">
                      {model.instrumentsById.get(tx.instrumentId)?.name ??
                        tx.instrumentId}
                      <span className="holding-sub">
                        {tx.date} · {tx.kind === "sell" ? "Sell" : "Buy"} ·{" "}
                        {tx.units} units · {formatInr(tx.amount)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="manual-remove"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm("Remove this transaction?")) {
                          deleteMutation.mutate(tx.id);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
