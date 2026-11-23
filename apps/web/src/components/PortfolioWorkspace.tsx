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
  getPortfolio,
  importCas,
} from "../lib/api/portfolio";
import { formatCompactInr, formatInr } from "../lib/format";
import {
  buildPositions,
  growthSeries,
  portfolioTotals,
  unitsByInstrument,
  xirrPercent,
  type Position,
} from "../lib/portfolio/returns";
import { GrowthPathChart } from "./LabPlots";

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
          ".",
      );
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    },
    onError: (error: Error) => {
      setFormError(error.message || "Could not read this statement.");
      setImportNote(null);
    },
  });

  const data = portfolioQuery.data;

  const model = useMemo(() => {
    if (!data) return null;
    const instrumentsById = new Map(data.instruments.map((i) => [i.id, i]));
    const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
    const positions = buildPositions(data.transactions);
    const units = unitsByInstrument(data.transactions);

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
    const snapshotByInstrument = new Map<string, { date: string; value: number }>();
    for (const snap of data.snapshots) {
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
    const navCodes = [...new Set(codeByInstrument.values())].sort();

    return {
      instrumentsById,
      accountsById,
      positions,
      units,
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
    const snapshotValued = new Set<string>();
    let asOf = today;
    for (const id of model.positions.keys()) {
      const code = model.codeByInstrument.get(id);
      const series = code ? navByCode.get(code) : undefined;
      const held = model.units.get(id)?.total ?? 0;
      if (series && series.length) {
        const latest = series[series.length - 1];
        if (latest.date > asOf) asOf = latest.date;
        values.set(id, held > 0 ? held * latest.nav : 0);
      } else {
        snapshotValued.add(id);
        values.set(id, model.snapshotByInstrument.get(id)?.value ?? 0);
        const snapDate = model.snapshotByInstrument.get(id)?.date;
        if (snapDate && snapDate > asOf) asOf = snapDate;
      }
    }

    const totals = portfolioTotals(data.transactions, model.positions, values, asOf);
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
        const gain = value + position.proceeds + position.income - position.invested;
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
          gainPct: position.invested > 0 ? (gain / position.invested) * 100 : null,
          xirr: xirrPercent(data.transactions, value, asOf, position.instrumentId),
          accounts: [...accountIds]
            .map((id) => model.accountsById.get(id))
            .filter(Boolean)
            .map((a) => a!.label),
        };
      })
      .filter((row) => row.position.units !== 0 || row.position.invested > 0 || row.value > 0)
      .sort((a, b) => b.value - a.value);

    return { totals, seriesPoints, rows, asOf, snapshotValued, navLoading: navQuery.isLoading };
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

  const hasHoldings = data.transactions.length > 0;
  const chartData = derived.seriesPoints.map((p) => ({ date: p.date, value: p.value }));
  const showChart = chartData.length >= 2 && chartData.some((p) => p.value > 0);
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

      {!hasHoldings ? (
        <p className="insight-empty">
          No holdings yet. Import a CAS PDF above to see returns, XIRR and the
          growth graph.
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
                className={`kpi-value${derived.totals.gain < 0 ? " is-down" : " is-up"}`}
              >
                {formatSignedInr(derived.totals.gain)}
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
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCompactInr(row.position.invested)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCompactInr(row.value)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={row.gain < 0 ? "is-down" : "is-up"}>
                        {formatSignedInr(row.gain)}
                      </span>{" "}
                      <span className="insight-weight">{formatPct(row.gainPct)}</span>
                    </TableCell>
                    <TableCell className="text-right">{formatPct(row.xirr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
