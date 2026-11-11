import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEffect, useMemo, useRef } from "react";
import { formatInr } from "../lib/format";
import { yearlyRanking } from "../lib/ranking";
import { resolveRange } from "../lib/resolveSettings";
import { useLab } from "../state/LabContext";
import type { BacktestResult, LabSettings, TimePoint } from "../types";
import { DrawdownChart, GrowthChart, YearlyRankingChart } from "./LabCharts";

const DEBOUNCE_MS = 300;

function formatPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function formatAsOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function volFromSeries(series: TimePoint[]): number | null {
  if (series.length < 3) return null;
  const returns: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!.y;
    const curr = series[i]!.y;
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) continue;
    returns.push(curr / prev - 1);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const sq = returns.reduce((s, r) => s + (r - mean) ** 2, 0);
  const stdev = Math.sqrt(sq / (returns.length - 1));
  if (stdev === 0 || !Number.isFinite(stdev)) return null;
  return stdev * Math.sqrt(252) * 100;
}

function unionLabels(results: BacktestResult[]): string[] {
  const dates = new Set<string>();
  for (const r of results) {
    for (const p of r.series) dates.add(p.x);
  }
  return [...dates].sort();
}

function runIsStale(
  results: BacktestResult[],
  settings: LabSettings,
  start: string,
): boolean {
  return results.some((r) => {
    const cf = r.cashflow;
    if (!cf) return false;
    const runStart = cf.requestedStartIso ?? cf.startIso;
    return (
      cf.mode !== settings.mode ||
      cf.amount !== settings.amount ||
      runStart !== start
    );
  });
}

function LeadStory() {
  const { results, baskets, settings } = useLab();
  const scored = results.filter((r) => r.error !== "no-nav");
  const runMode = scored[0]?.cashflow?.mode ?? settings.mode;

  if (!results.length) {
    return (
      <div className="lead-story lead-empty">
        <p>No run yet. Check amount, weights, and NAV.</p>
      </div>
    );
  }

  if (!scored.length) {
    return (
      <div className="lead-story lead-empty">
        <p>Can&apos;t load NAV for the active baskets.</p>
      </div>
    );
  }

  const leader = scored.reduce((best, cur) =>
    cur.stats.cagr >= best.stats.cagr ? cur : best,
  );
  const name =
    baskets.find((b) => b.id === leader.basketId)?.name ?? "Leader";
  const rate = runMode === "sip" ? "XIRR" : "CAGR";
  const down = leader.stats.cagr < 0;
  const leaderCf = leader.cashflow;
  const fromIso =
    leaderCf?.requestedStartIso && leaderCf.startIso > leaderCf.requestedStartIso
      ? leaderCf.startIso
      : "";
  const fromNote = fromIso ? ` from ${formatAsOf(fromIso)}` : "";

  const worstDd = scored.reduce(
    (min, cur) => (cur.stats.mdd < min ? cur.stats.mdd : min),
    0,
  );

  return (
    <div className="lead-story">
      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-label">Best {rate}</span>
          <span className={`kpi-value${down ? " is-down" : " is-up"}`}>
            {formatPct(leader.stats.cagr)}
          </span>
          <span className="kpi-sub">
            {name}
            {fromNote}
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Amount</span>
          <span className="kpi-value">{formatInr(settings.amount)}</span>
          <span className="kpi-sub">{runMode}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Period</span>
          <span className="kpi-value">{settings.period}</span>
          <span className="kpi-sub">
            {runMode === "sip" ? "SIP window" : "Lumpsum window"}
          </span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Max drawdown</span>
          <span
            className={`kpi-value${worstDd < 0 ? " is-down" : ""}`}
          >
            {formatPct(worstDd)}
          </span>
          <span className="kpi-sub">Worst of this run</span>
        </div>
      </div>
    </div>
  );
}

export function BacktestView() {
  const { baskets, results, analyzing, runAnalysis, settings } = useLab();
  const prevModeRef = useRef(settings.mode);

  useEffect(() => {
    const modeFlipped = prevModeRef.current !== settings.mode;
    prevModeRef.current = settings.mode;
    const delay = modeFlipped ? 0 : DEBOUNCE_MS;
    const t = window.setTimeout(() => {
      void runAnalysis();
    }, delay);
    return () => window.clearTimeout(t);
  }, [runAnalysis, settings.mode]);

  const labels = unionLabels(results);
  const range = useMemo(
    () =>
      resolveRange(settings.period, settings.customStart, settings.customEnd),
    [settings.period, settings.customStart, settings.customEnd],
  );
  const ranking = useMemo(
    () =>
      yearlyRanking(results, {
        mode: settings.mode,
        amount: settings.amount,
        startIso: range.start,
      }),
    [results, settings, range.start],
  );
  const stale = analyzing || runIsStale(results, settings, range.start);
  const ranked = [...results].sort((a, b) => {
    if (a.error === "no-nav" && b.error !== "no-nav") return 1;
    if (b.error === "no-nav" && a.error !== "no-nav") return -1;
    if (a.error === "no-nav" && b.error === "no-nav") return 0;
    return b.stats.cagr - a.stats.cagr;
  });
  const asOf = labels.length ? labels[labels.length - 1]! : "";
  const runMode = results[0]?.cashflow?.mode ?? settings.mode;
  const sip = runMode === "sip";

  return (
    <section
      className={`backtest-view${stale ? " is-updating" : ""}`}
      aria-busy={stale}
    >
      {stale ? (
        <p className="updating-rule" role="status">
          Recalculating {settings.mode}…
        </p>
      ) : null}
      <LeadStory />
      <div className="table-scroll">
        <Table className="backtest-table">
          <TableHeader>
            <TableRow>
              <TableHead>Basket</TableHead>
              <TableHead className="col-invested text-right">Invested</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="col-cagr text-right">CAGR</TableHead>
              <TableHead className="text-right">XIRR</TableHead>
              <TableHead className="text-right">Max DD</TableHead>
              <TableHead className="col-vol text-right">Vol</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((r) => {
              const basket = baskets.find((b) => b.id === r.basketId);
              const name = basket?.name ?? r.basketId;
              const fundHint =
                basket && basket.funds.length === 1
                  ? basket.funds[0]!.schemeName
                  : null;
              if (r.error === "no-nav") {
                return (
                  <TableRow key={r.basketId}>
                    <TableCell className="whitespace-normal">
                      {basket?.color ? (
                        <span
                          className="basket-swatch"
                          style={{ background: basket.color }}
                        />
                      ) : null}
                      {name}
                      {fundHint ? (
                        <span className="basket-sub">{fundHint}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="col-invested text-right">
                      {formatInr(settings.amount)}
                    </TableCell>
                    <TableCell className="num-empty text-right">No NAV</TableCell>
                    <TableCell className="num-empty col-cagr text-right">No NAV</TableCell>
                    <TableCell className="num-empty text-right">No NAV</TableCell>
                    <TableCell className="num-empty text-right">No NAV</TableCell>
                    <TableCell className="num-empty col-vol text-right">
                      No NAV
                    </TableCell>
                  </TableRow>
                );
              }
              const vol = volFromSeries(r.series);
              return (
                <TableRow key={r.basketId}>
                  <TableCell className="whitespace-normal">
                    {basket?.color ? (
                      <span
                        className="basket-swatch"
                        style={{ background: basket.color }}
                      />
                    ) : null}
                    {name}
                    {fundHint ? (
                      <span className="basket-sub">{fundHint}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="col-invested text-right">
                    {formatInr(r.stats.initial)}
                  </TableCell>
                  <TableCell
                    className={`text-right ${r.stats.final >= r.stats.initial ? "num-gain" : "num-loss"}`}
                  >
                    {formatInr(r.stats.final)}
                    <span
                      className={`basket-sub ${r.stats.abs >= 0 ? "num-gain" : "num-loss"}`}
                    >
                      {formatPct(r.stats.abs)}
                    </span>
                  </TableCell>
                  <TableCell
                    className={`col-cagr text-right ${!sip && r.stats.cagr >= 0 ? "num-gain" : !sip ? "num-loss" : "num-empty"}`}
                  >
                    {sip ? "—" : formatPct(r.stats.cagr)}
                  </TableCell>
                  <TableCell
                    className={`text-right ${sip && r.stats.cagr >= 0 ? "num-gain" : sip ? "num-loss" : "num-empty"}`}
                  >
                    {sip ? formatPct(r.stats.cagr) : "—"}
                  </TableCell>
                  <TableCell className="num-loss text-right">
                    {formatPct(r.stats.mdd)}
                  </TableCell>
                  <TableCell className="col-vol text-right">
                    {vol == null ? (
                      <span className="num-empty">—</span>
                    ) : (
                      formatPct(vol)
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="backtest-charts">
        <figure className="backtest-chart">
          <figcaption>
            Growth
            <span className="chart-hint">
              Value of {formatInr(settings.amount)} over {settings.period}. Click a name to isolate a line.
            </span>
          </figcaption>
          <GrowthChart results={results} baskets={baskets} />
        </figure>
        <figure className="backtest-chart">
          <figcaption>
            Fall from peak
            <span className="chart-hint">
              How far each basket dropped from its high. 0% is a new peak.
            </span>
          </figcaption>
          <DrawdownChart results={results} baskets={baskets} />
        </figure>
      </div>
      <p className="source-rule">
        Source: Basket Lab · Data as on {asOf ? formatAsOf(asOf) : "—"} · All
        figures annualised
      </p>
      {ranking.length > 0 && (
        <div className="yearly-ranking">
          <h3>Yearly ranking</h3>
          <p className="yearly-ranking-note">
            Time-weighted calendar return. Years marked * start mid-window.
            YTD is through the last NAV date.
          </p>
          <div className="ranking-chart-well">
            <YearlyRankingChart ranking={ranking} baskets={baskets} />
          </div>
        </div>
      )}
    </section>
  );
}
