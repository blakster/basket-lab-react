import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef } from "react";
import { loadNiftyBeesNav, NIFTY_BEES_CODE } from "../lib/api/benchmarkNav";
import {
  METRICS,
  metricClass,
  metricLabel,
  metricText,
  type MetricId,
} from "../lib/backtest/metrics";
import { formatInr } from "../lib/format";
import { benchmarkForResult } from "../lib/portfolioDetails";
import { yearlyRanking } from "../lib/ranking";
import { resolveRange } from "../lib/resolveSettings";
import { runIsStale } from "../lib/runFreshness";
import { unionDates } from "../lib/series";
import { WEIGHT_TOLERANCE } from "../lib/weights";
import { useLab } from "../state/LabContext";
import type { BacktestResult, Basket } from "../types";
import { CashflowCompare } from "./CashflowCompare";
import { DrawdownChart, GrowthChart, YearlyRankingChart } from "./LabCharts";

const BEES_ID = "__nifty-bees";

const BEES_BASKET: Basket = {
  id: BEES_ID,
  name: "Nifty BeES",
  color: "#6B6B6B",
  active: true,
  funds: [
    {
      schemeCode: NIFTY_BEES_CODE,
      schemeName: "Nifty BeES",
      isin: null,
      weight: 100,
      locked: false,
    },
  ],
};

function isBeesOnly(basket: Basket): boolean {
  const funds = basket.funds.filter((f) => f.weight > 0);
  return (
    funds.length > 0 && funds.every((f) => f.schemeCode === NIFTY_BEES_CODE)
  );
}

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

// Registry metrics shown under each league card after the bespoke vs-BeES cell.
const LEAGUE_METRICS: MetricId[] = ["mdd", "vol", "sharpe", "sortino"];

function LeadStory({ beesRateById }: { beesRateById: Map<string, number> }) {
  const { results, baskets, settings, analyzing, runAnalysis, setWorkspace } =
    useLab();
  const scored = results.filter((r) => r.error !== "no-nav");
  const runMode = scored[0]?.cashflow?.mode ?? settings.mode;

  if (!results.length) {
    if (analyzing) return null;
    const { start, end } = resolveRange(
      settings.period,
      settings.customStart,
      settings.customEnd,
    );
    if (start > end) {
      return (
        <div className="lead-story lead-empty" role="status">
          <p>
            Start {formatAsOf(start)} is after End {formatAsOf(end)}.
          </p>
          <p>Pick an End on or after the Start to run the comparison.</p>
        </div>
      );
    }
    const active = baskets.filter((basket) => basket.active);
    const invalidWeights = active.some(
      (basket) =>
        Math.abs(
          basket.funds.reduce((sum, fund) => sum + fund.weight, 0) - 100,
        ) >= WEIGHT_TOLERANCE,
    );
    const needsBaskets = !active.length || invalidWeights;
    return (
      <div className="lead-story lead-empty">
        <p>
          {!active.length
            ? "No active baskets"
            : settings.amount < 100
              ? "Set an investment amount"
              : invalidWeights
                ? "Check your basket weights"
                : "No comparison yet"}
        </p>
        <p>
          {!active.length
            ? "Activate a basket to start comparing."
            : settings.amount < 100
              ? "Enter at least ₹100 in the settings above."
              : invalidWeights
                ? "Each active basket needs funds with weights totaling 100%."
                : "Check your settings, then try loading NAV again."}
        </p>
        {needsBaskets ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setWorkspace("baskets")}
          >
            Choose baskets
          </Button>
        ) : settings.amount >= 100 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void runAnalysis()}
          >
            Retry NAV
          </Button>
        ) : null}
      </div>
    );
  }

  if (!scored.length) {
    return (
      <div className="lead-story lead-empty">
        <p>Can&apos;t load NAV for the active baskets.</p>
        <p>
          Your baskets are saved. Try again when the data source is available.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={analyzing}
          onClick={() => void runAnalysis()}
        >
          {analyzing ? "Loading NAV…" : "Retry NAV"}
        </Button>
      </div>
    );
  }

  const leader = scored.reduce((best, cur) =>
    cur.stats.cagr >= best.stats.cagr ? cur : best,
  );
  const name = baskets.find((b) => b.id === leader.basketId)?.name ?? "Leader";
  const rate = runMode === "sip" ? "XIRR" : "CAGR";
  const leaderCf = leader.cashflow;
  const fromIso =
    leaderCf?.requestedStartIso &&
    leaderCf.startIso > leaderCf.requestedStartIso
      ? leaderCf.startIso
      : "";
  const fromNote = fromIso ? ` from ${formatAsOf(fromIso)}` : "";

  const laggards = scored
    .filter((r) => {
      const bees = beesRateById.get(r.basketId);
      return bees != null && r.stats.cagr < bees;
    })
    .map((r) => baskets.find((b) => b.id === r.basketId)?.name ?? r.basketId);

  return (
    <div className="lead-story">
      <p className="lead-line">
        {name} leads at {formatPct(leader.stats.cagr)} {rate}
        {fromNote}.
      </p>
      {laggards.length > 0 ? (
        <p className="lead-flag">
          {laggards.join(", ")} {laggards.length === 1 ? "trails" : "trail"}{" "}
          Nifty BeES
        </p>
      ) : (
        <p className="lead-hint">Select a basket for weights and filings.</p>
      )}
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

  const labels = unionDates(results);
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
  const hasSeries = results.some((r) => r.series.length >= 2);
  const benchQuery = useQuery({
    queryKey: ["nav", NIFTY_BEES_CODE, range.start, range.end],
    queryFn: () => loadNiftyBeesNav(range.start, range.end),
    retry: 1,
    enabled: hasSeries,
  });
  const benchRun = useMemo(
    () => ({
      mode: settings.mode,
      amount: settings.amount,
      startIso: range.start,
      endIso: range.end,
    }),
    [settings.mode, settings.amount, range.start, range.end],
  );
  // BeES on each basket's own cashflow: same start, same mode (XIRR vs XIRR
  // in SIP mode, CAGR vs CAGR in lumpsum).
  const beesRateById = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of results) {
      const bench = benchmarkForResult(r, benchQuery.data, benchRun);
      if (bench) out.set(r.basketId, bench.stats.cagr);
    }
    return out;
  }, [results, benchQuery.data, benchRun]);
  const showBeesOverlay =
    settings.mode === "lumpsum" &&
    !baskets.some((b) => b.active && isBeesOnly(b));
  const beesResult = useMemo((): BacktestResult | null => {
    if (!showBeesOverlay) return null;
    // One overlay line: start it with the earliest basket so it shares that
    // basket's first priced day and amount.
    const anchor = results
      .filter((r) => r.error !== "no-nav" && r.series.length >= 2)
      .reduce<BacktestResult | null>(
        (first, r) =>
          !first ||
          (r.cashflow?.startIso ?? range.start) <
            (first.cashflow?.startIso ?? range.start)
            ? r
            : first,
        null,
      );
    if (!anchor) return null;
    const bench = benchmarkForResult(anchor, benchQuery.data, benchRun);
    if (!bench) return null;
    return { ...bench, basketId: BEES_ID };
  }, [showBeesOverlay, results, benchQuery.data, benchRun, range.start]);
  const growthResults = beesResult ? [...results, beesResult] : results;
  const growthBaskets = beesResult ? [...baskets, BEES_BASKET] : baskets;
  const ranked = [...results].sort((a, b) => {
    if (a.error === "no-nav" && b.error !== "no-nav") return 1;
    if (b.error === "no-nav" && a.error !== "no-nav") return -1;
    if (a.error === "no-nav" && b.error === "no-nav") return 0;
    return b.stats.cagr - a.stats.cagr;
  });
  const asOf = labels.length ? labels[labels.length - 1]! : "";
  const leaderId = ranked.find((row) => row.error !== "no-nav")?.basketId;

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
      <LeadStory beesRateById={beesRateById} />
      <ul className="league">
        {ranked.map((r) => {
          const basket = baskets.find((b) => b.id === r.basketId);
          const name = basket?.name ?? r.basketId;
          const fund =
            basket && basket.funds.length === 1
              ? `${basket.funds[0]!.schemeName} · ${basket.funds[0]!.schemeCode}`
              : basket && basket.funds.length > 1
                ? `${basket.funds.length} funds`
                : null;
          const isLead = leaderId === r.basketId;
          if (r.error === "no-nav") {
            return (
              <li key={r.basketId} className="league-col">
                <span className="league-tick" aria-hidden="true" />
                <p className="league-name">{name}</p>
                <p className="league-rate num-empty">No NAV</p>
                <p
                  className="league-value num-empty"
                  aria-label="Current value unavailable"
                >
                  —
                </p>
                {fund ? <p className="league-fund">{fund}</p> : null}
              </li>
            );
          }
          const bees = beesRateById.get(r.basketId);
          const vs = bees == null ? null : r.stats.cagr - bees;
          return (
            <li
              key={r.basketId}
              className={`league-col${isLead ? " is-lead" : ""}`}
            >
              <span className="league-tick" aria-hidden="true" />
              <p className="league-name">{name}</p>
              <p className="league-rate">{formatPct(r.stats.cagr)}</p>
              <p className="league-value">{formatInr(r.stats.final)}</p>
              {fund ? <p className="league-fund">{fund}</p> : null}
              <dl className="league-metrics">
                <div className="league-metric">
                  <dt>vs BeES</dt>
                  <dd
                    className={
                      vs == null
                        ? "num-empty"
                        : vs >= 0
                          ? "num-gain"
                          : "num-loss"
                    }
                  >
                    {vs == null ? "—" : formatPct(vs)}
                  </dd>
                </div>
                {LEAGUE_METRICS.map((id) => {
                  const value = METRICS[id].compute(r, {});
                  return (
                    <div key={id} className="league-metric">
                      <dt>{metricLabel(id, r)}</dt>
                      <dd className={metricClass(id, value)}>
                        {metricText(id, value)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </li>
          );
        })}
        {beesResult ? (
          <li className="league-col is-ref">
            <span className="league-tick" aria-hidden="true" />
            <p className="league-name">Nifty BeES · reference</p>
            <p className="league-rate">{formatPct(beesResult.stats.cagr)}</p>
            <p className="league-value">{formatInr(beesResult.stats.final)}</p>
            <p className="league-fund">Not a basket. Overlay only.</p>
            <dl className="league-metrics">
              <div className="league-metric">
                <dt>vs BeES</dt>
                <dd>—</dd>
              </div>
              {LEAGUE_METRICS.map((id) => {
                const value =
                  id === "mdd"
                    ? null
                    : METRICS[id].compute(beesResult, {});
                return (
                  <div key={id} className="league-metric">
                    <dt>{metricLabel(id)}</dt>
                    <dd className={metricClass(id, value)}>
                      {metricText(id, value)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ) : null}
      </ul>
      {hasSeries && (
        <>
          <CashflowCompare />
          <div className="backtest-charts">
            <figure className="backtest-chart">
              <figcaption>
                Who pulled away from {formatInr(settings.amount)}
                <span className="chart-hint">
                  The path, not the ending rate. {settings.period} window.
                </span>
              </figcaption>
              <GrowthChart results={growthResults} baskets={growthBaskets} />
            </figure>
            <figure className="backtest-chart backtest-chart--drawdown">
              <figcaption>
                How far from a peak
                <span className="chart-hint">
                  Rust fill is the worst trough in this run. 0% is a new high.
                </span>
              </figcaption>
              <DrawdownChart results={results} baskets={baskets} />
            </figure>
          </div>
          <p className="source-rule">
            Source: Basket Lab · Data as on {asOf ? formatAsOf(asOf) : "—"} ·
            All figures annualised
          </p>
        </>
      )}
      {ranking.length > 0 && (
        <div className="yearly-ranking">
          <h3>Who won each calendar year</h3>
          <p className="yearly-ranking-note">
            Rank, not return. Hover a cell for the year&apos;s time-weighted
            number. * started mid-window. YTD is through the last NAV date.
          </p>
          <div className="ranking-chart-well">
            <YearlyRankingChart ranking={ranking} baskets={baskets} />
          </div>
        </div>
      )}
    </section>
  );
}
