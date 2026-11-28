import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, ChevronRight, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteManualTransaction,
  getPortfolio,
  postCommissionCheck,
  type PortfolioTransaction,
} from "../lib/api/portfolio";
import { formatCompactInr, formatInr } from "../lib/format";
import { summarizeCommission, valuesForCommission } from "../lib/portfolio/commission";
import {
  buildPortfolioBasket,
  loadCachedPortfolioNav,
  localTodayIso,
} from "../lib/portfolio/portfolioNav";
import {
  buildPositions,
  folioGroupKey,
  growthSeries,
  holdingsFromStatements,
  portfolioTotals,
  unitsByInstrument,
  xirrPercent,
  type Position,
} from "../lib/portfolio/returns";
import { useOptionalLab } from "../state/LabContext";
import { CasImportDialog } from "./CasImportDialog";
import { CommissionCheck } from "./CommissionCheck";
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

function formatKindLabel(kind: string): string {
  switch (kind) {
    case "buy":
      return "Buy";
    case "sip":
      return "SIP";
    case "sell":
      return "Sell";
    case "switch-in":
      return "Switch in";
    case "switch-out":
      return "Switch out";
    case "dividend":
      return "Dividend";
    default:
      return kind;
  }
}

export function PortfolioWorkspace() {
  const lab = useOptionalLab();
  const queryClient = useQueryClient();
  const portfolioQuery = useQuery({ queryKey: ["portfolio"], queryFn: getPortfolio });
  const [importOpen, setImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteManualTransaction(id),
    onSuccess: () => {
      setDeleteError(null);
      setConfirmDeleteId(null);
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
    const txByInstrument = new Map<string, PortfolioTransaction[]>();
    for (const tx of data.transactions) {
      const list = txByInstrument.get(tx.instrumentId);
      if (list) list.push(tx);
      else txByInstrument.set(tx.instrumentId, [tx]);
    }
    for (const list of txByInstrument.values()) {
      list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    }

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

    const tradedAccounts = new Set(data.transactions.map((t) => `${t.instrumentId} ${t.accountId}`));
    let earliestSnapshot: string | null = null;
    const snapshotGroups = new Map<string, Map<string, { date: string; value: number; traded: boolean }>>();
    const accountsByInstrument = new Map<string, Set<string>>();
    for (const tx of data.transactions) {
      let set = accountsByInstrument.get(tx.instrumentId);
      if (!set) {
        set = new Set();
        accountsByInstrument.set(tx.instrumentId, set);
      }
      set.add(tx.accountId);
    }
    for (const snap of data.snapshots) {
      if (!earliestSnapshot || snap.date < earliestSnapshot) earliestSnapshot = snap.date;
      let set = accountsByInstrument.get(snap.instrumentId);
      if (!set) {
        set = new Set();
        accountsByInstrument.set(snap.instrumentId, set);
      }
      set.add(snap.accountId);
      let groups = snapshotGroups.get(snap.instrumentId);
      if (!groups) {
        groups = new Map();
        snapshotGroups.set(snap.instrumentId, groups);
      }
      const key = folioGroupKey(snap.accountId);
      const candidate = {
        date: snap.date,
        value: snap.value,
        traded: tradedAccounts.has(`${snap.instrumentId} ${snap.accountId}`),
      };
      const prev = groups.get(key);
      if (
        !prev ||
        snap.date > prev.date ||
        (snap.date === prev.date && candidate.traded && !prev.traded)
      ) {
        groups.set(key, candidate);
      }
    }
    const snapshotByInstrument = new Map<string, { date: string; value: number }>();
    for (const [id, groups] of snapshotGroups) {
      let date = "";
      let value = 0;
      for (const group of groups.values()) {
        value += group.value;
        if (group.date > date) date = group.date;
      }
      snapshotByInstrument.set(id, { date, value });
    }

    let since: string | null = null;
    const sinceByCode: Record<string, string> = {};
    for (const [id, code] of codeByInstrument.entries()) {
      const d =
        firstTxDateByInstrument.get(id) ??
        snapshotByInstrument.get(id)?.date ??
        null;
      if (!d) continue;
      if (!sinceByCode[code] || d < sinceByCode[code]) sinceByCode[code] = d;
      if (firstTxDateByInstrument.has(id) && (!since || d < since)) since = d;
    }
    if (!since && earliestSnapshot) since = earliestSnapshot;
    const navCodes = [...new Set(codeByInstrument.values())].sort();
    const heldInstrumentIds = [...positions.values()]
      .filter((position) => {
        const held = holdings.get(position.instrumentId)?.heldUnits ?? position.units;
        return held > 0 && instrumentsById.get(position.instrumentId)?.kind === "mf";
      })
      .map((position) => position.instrumentId)
      .sort();

    return {
      instrumentsById,
      accountsById,
      accountsByInstrument,
      txByInstrument,
      positions,
      units,
      holdings,
      codeByInstrument,
      firstTxDateByInstrument,
      snapshotByInstrument,
      navCodes,
      since,
      sinceByCode,
      heldInstrumentIds,
    };
  }, [data]);

  const today = useMemo(() => localTodayIso(), []);
  const sinceByCodeKey = model
    ? model.navCodes.map((c) => `${c}:${model.sinceByCode[c] ?? ""}`).join(",")
    : "";
  const navQuery = useQuery({
    queryKey: [
      "portfolio-nav",
      model?.navCodes.join(",") ?? "",
      model?.since ?? "",
      sinceByCodeKey,
      today,
    ],
    queryFn: () =>
      loadCachedPortfolioNav(
        model!.navCodes,
        model!.since!,
        today,
        model!.sinceByCode,
      ),
    enabled: !!model && model.navCodes.length > 0 && !!model.since,
    staleTime: 5 * 60 * 1000,
  });
  const commissionQuery = useQuery({
    queryKey: ["portfolio-commission", model?.heldInstrumentIds.join(",") ?? ""],
    queryFn: () => postCommissionCheck(model!.heldInstrumentIds),
    enabled: !!model && model.heldInstrumentIds.length > 0,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const derived = useMemo(() => {
    if (!data || !model) return null;
    const navByCode = new Map<string, { date: string; nav: number }[]>();
    for (const [code, points] of Object.entries(navQuery.data ?? {})) {
      if (points.length) navByCode.set(code, points);
    }

    const values = new Map<string, number>();
    const valueDateByInstrument = new Map<string, string>();
    const latestNavByInstrument = new Map<string, number>();
    const snapshotValued = new Set<string>();
    for (const id of model.positions.keys()) {
      const code = model.codeByInstrument.get(id);
      const series = code ? navByCode.get(code) : undefined;
      const held = model.holdings.get(id)?.heldUnits ?? model.units.get(id)?.total ?? 0;
      if (series && series.length) {
        const latest = series[series.length - 1]!;
        values.set(id, held > 0 ? held * latest.nav : 0);
        valueDateByInstrument.set(id, latest.date);
        latestNavByInstrument.set(id, latest.nav);
      } else {
        snapshotValued.add(id);
        const snap = model.snapshotByInstrument.get(id);
        values.set(id, snap?.value ?? 0);
        valueDateByInstrument.set(id, snap?.date ?? today);
      }
    }

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
        const heldUnits = model.holdings.get(position.instrumentId)?.heldUnits ?? position.units;
        const covered = model.holdings.get(position.instrumentId)?.covered ?? true;
        const gain = covered ? value + position.proceeds + position.income - position.invested : null;
        const accountIds = model.accountsByInstrument.get(position.instrumentId) ?? new Set<string>();
        const accounts = [...accountIds]
          .map((id) => model.accountsById.get(id))
          .filter(Boolean)
          .map((a) => a!.label);
        const kindLabel =
          instrument?.kind === "stock" ? "Stock" : instrument?.kind === "mf" ? "Mutual fund" : null;
        const stockSnapshots =
          instrument?.kind === "stock"
            ? data.snapshots.filter((snap) => snap.instrumentId === position.instrumentId)
            : [];
        const stockSnapshotDates = new Set(stockSnapshots.map((snap) => snap.date));
        const stockSnapshotUnits = stockSnapshots.reduce((sum, snap) => sum + snap.units, 0);
        const stockSnapshotValue = stockSnapshots.reduce((sum, snap) => sum + snap.value, 0);
        const subtitle = [
          kindLabel,
          instrument?.kind === "stock" ? instrument.symbol : null,
          accounts.join(" · ") || position.instrumentId,
          instrument?.kind === "mf" && !instrument.schemeCode ? "no NAV history" : null,
          !covered
            ? instrument?.kind === "stock"
              ? "cost history unavailable"
              : "predates statement"
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          position,
          heldUnits,
          instrument,
          value,
          valDate: valueDateByInstrument.get(position.instrumentId) ?? asOfDate,
          latestNav: latestNavByInstrument.get(position.instrumentId) ?? null,
          statementPrice:
            instrument?.kind === "stock" && stockSnapshotDates.size === 1 && stockSnapshotUnits > 0
              ? stockSnapshotValue / stockSnapshotUnits
              : null,
          gain,
          gainPct: covered && gain !== null && position.invested > 0 ? (gain / position.invested) * 100 : null,
          covered,
          xirr: covered ? xirrPercent(data.transactions, value, valueDate(position.instrumentId), position.instrumentId) : null,
          subtitle,
          transactions: model.txByInstrument.get(position.instrumentId) ?? [],
        };
      })
      .filter((row) => row.position.units !== 0 || row.position.invested > 0 || row.value > 0)
      .sort((a, b) => b.value - a.value);

    const commissionRows = commissionQuery.data?.rows ?? [];
    const commission = summarizeCommission(
      commissionRows,
      valuesForCommission(
        commissionRows,
        values,
        model.codeByInstrument,
        new Set(navByCode.keys()),
      ),
    );

    return {
      totals,
      seriesPoints,
      rows,
      asOf: asOfDate,
      complete,
      snapshotValued,
      navLoading: navQuery.isLoading,
      commission,
    };
  }, [data, model, navQuery.data, navQuery.isLoading, commissionQuery.data, today]);

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
  const chartData = derived.seriesPoints.map((p) => ({ date: p.date, value: Math.round(p.value) }));
  const showChart =
    derived.complete && chartData.length >= 2 && chartData.some((p) => p.value > 0);
  const fallbackCount = derived.rows.filter((row) =>
    derived.snapshotValued.has(row.position.instrumentId),
  ).length;
  const mfHoldingsForBasket = derived.rows
    .filter((row) => row.instrument?.kind === "mf" && row.instrument.schemeCode && row.value > 0)
    .map((row) => ({
      schemeCode: row.instrument!.schemeCode!,
      schemeName: row.instrument!.name,
      isin: row.instrument!.isin,
      value: row.value,
    }));

  function handleAnalyzeInInsights() {
    if (!lab) return;
    const basket = buildPortfolioBasket(mfHoldingsForBasket, lab.baskets);
    if (!basket) return;
    if (lab.saveBasket(basket)) {
      lab.openInsights(basket.id, { allowPending: true });
    }
  }

  return (
    <div className="portfolio-desk">
      <header className="portfolio-header">
        <div className="portfolio-header-copy">
          <h2>Portfolio</h2>
          <p>
            {hasHoldings
              ? `Valued as of ${derived.asOf} · ${derived.rows.length} holding${derived.rows.length === 1 ? "" : "s"}`
              : "Track real mutual fund and stock holdings locally from CAS PDFs or manual entries."}
          </p>
        </div>
        <div className="portfolio-header-actions">
          {lab && mfHoldingsForBasket.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={handleAnalyzeInInsights}>
              Health check
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setManualOpen(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add transaction
          </Button>
          <Button type="button" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="size-3.5" aria-hidden="true" />
            Import CAS
          </Button>
        </div>
      </header>

      <CasImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(summary) => setImportNote(summary)}
      />
      <ManualTransactionDialog open={manualOpen} onOpenChange={setManualOpen} />

      {importNote && (
        <div className="portfolio-banner" role="status">
          <span>{importNote}</span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setImportNote(null)}>
            Dismiss
          </Button>
        </div>
      )}
      {deleteError && (
        <div className="portfolio-banner is-error" role="alert">
          <span>{deleteError}</span>
          <Button type="button" variant="ghost" size="xs" onClick={() => setDeleteError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {!hasHoldings ? (
        <section className="portfolio-empty-card" aria-label="Get started">
          <h3>Import your real holdings to see XIRR and regular-plan leaks</h3>
          <p>
            Upload a CAMS, KFintech, NSDL, or CDSL consolidated account
            statement with mutual funds or stocks, or log a trade by hand.
            Everything stays in your local SQLite database.
          </p>
          <div className="portfolio-empty-actions">
            <Button type="button" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" aria-hidden="true" />
              Import CAS PDF
            </Button>
            <Button type="button" variant="outline" onClick={() => setManualOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add transaction
            </Button>
          </div>
        </section>
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
            <section className="portfolio-chart-block" aria-label="Portfolio growth">
              <div className="portfolio-chart-head">
                <h3>Portfolio value</h3>
                <span>Hover to inspect daily value</span>
              </div>
              <GrowthPathChart
                data={chartData}
                startAmount={derived.totals.invested}
                ariaLabel="Portfolio value over time"
                series={[{ key: "value", label: "Portfolio", color: "var(--ink)", lead: true }]}
              />
            </section>
          )}

          <CommissionCheck
            summary={
              (commissionQuery.data || model.heldInstrumentIds.length === 0) &&
              !navQuery.isLoading
                ? derived.commission
                : null
            }
            loading={commissionQuery.isLoading || navQuery.isLoading}
            error={commissionQuery.isError}
          />

          {fallbackCount > 0 && (
            <p className="cas-hint">
              {fallbackCount} holding{fallbackCount === 1 ? "" : "s"} valued at
              the statement&apos;s latest figure.
            </p>
          )}
          {!derived.complete && (
            <p className="cas-hint">
              Some holdings have incomplete cost history, so all-time gain
              and XIRR are hidden; current value is exact.
            </p>
          )}

          <div className="table-scroll">
            <Table className="insight-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Holding</TableHead>
                  <TableHead className="text-right">Invested</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">All-time gain</TableHead>
                  <TableHead className="text-right">XIRR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {derived.rows.map((row) => {
                  const id = row.position.instrumentId;
                  const isExpanded = expandedId === id;
                  return (
                    <Fragment key={id}>
                      <TableRow>
                        <TableCell>
                          <button
                            type="button"
                            className="holding-toggle"
                            aria-expanded={isExpanded}
                            onClick={() => setExpandedId((prev) => (prev === id ? null : id))}
                          >
                            <ChevronRight aria-hidden="true" />
                            <span>
                              {row.instrument?.name ?? id}
                              <span className="holding-sub">{row.subtitle}</span>
                            </span>
                          </button>
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
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={5} className="holding-detail-cell">
                            <div className="holding-detail">
                              <div className="holding-detail-meta">
                                <span>
                                  {row.instrument?.kind === "stock" ? "Shares" : "Units"}: {row.heldUnits.toFixed(3)}
                                </span>
                                {row.latestNav !== null && (
                                  <span>Latest NAV: ₹{row.latestNav.toFixed(4)}</span>
                                )}
                                {row.statementPrice !== null && (
                                  <span>Statement price: {formatInr(row.statementPrice)}</span>
                                )}
                                <span>Valued as of {row.valDate}</span>
                                {row.instrument?.isin && <span>ISIN {row.instrument.isin}</span>}
                              </div>
                              {row.transactions.length > 0 ? (
                                <ul className="holding-tx-list">
                                  {row.transactions.slice(0, 12).map((tx) => (
                                    <li key={tx.id}>
                                      <span>{tx.date}</span>
                                      <span>{formatKindLabel(tx.kind)}</span>
                                      <span>{tx.units.toFixed(3)} units</span>
                                      <span>{formatInr(tx.amount)}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="cas-hint">
                                  Closing balance from depository statement (no transaction ledger).
                                </p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {manualTransactions.length > 0 && (
            <div className="manual-entries">
              <h3 className="manual-entries-title">Added by hand</h3>
              <ul className="manual-entries-list">
                {manualTransactions.map((tx) => {
                  const confirming = confirmDeleteId === tx.id;
                  return (
                    <li key={tx.id} className="manual-entry">
                      <span className="manual-entry-main">
                        {model.instrumentsById.get(tx.instrumentId)?.name ??
                          tx.instrumentId}
                        <span className="holding-sub">
                          {tx.date} · {tx.kind === "sell" ? "Sell" : "Buy"} ·{" "}
                          {tx.units} units · {formatInr(tx.amount)}
                        </span>
                      </span>
                      {confirming ? (
                        <span className="inline-confirm">
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={deleteMutation.isPending}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            className="inline-confirm-danger"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(tx.id)}
                          >
                            {deleteMutation.isPending ? "Removing…" : "Confirm remove"}
                          </Button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="manual-remove"
                          disabled={deleteMutation.isPending}
                          onClick={() => setConfirmDeleteId(tx.id)}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
