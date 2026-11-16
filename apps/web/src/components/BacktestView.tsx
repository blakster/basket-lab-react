import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { loadNiftyBeesNav, NIFTY_BEES_CODE } from "../lib/api/benchmarkNav";
import { formatInr } from "../lib/format";
import {
  beesCagrFromNavs,
  scaleNavToAmount,
} from "../lib/portfolioDetails";
import { yearlyRanking } from "../lib/ranking";
import { resolveRange } from "../lib/resolveSettings";
import { useLab } from "../state/LabContext";
import type { BacktestResult, Basket, LabSettings, TimePoint } from "../types";
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
  return funds.length > 0 && funds.every((f) => f.schemeCode === NIFTY_BEES_CODE);
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

function LeadStory({ beesCagr }: { beesCagr: number | null }) {
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
  const leaderCf = leader.cashflow;
  const fromIso =
    leaderCf?.requestedStartIso && leaderCf.startIso > leaderCf.requestedStartIso
      ? leaderCf.startIso
      : "";
  const fromNote = fromIso ? ` from ${formatAsOf(fromIso)}` : "";

  const laggards = scored
    .filter((r) => beesCagr != null && r.stats.cagr < beesCagr)
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
  const hasSeries = results.some((r) => r.series.length >= 2);
  const benchQuery = useQuery({
    queryKey: ["nav", NIFTY_BEES_CODE, range.start, range.end],
    queryFn: () => loadNiftyBeesNav(range.start, range.end),
    retry: 1,
    enabled: hasSeries,
  });
  const beesCagr = useMemo(
    () => beesCagrFromNavs(benchQuery.data),
    [benchQuery.data],
  );
  const showBeesOverlay =
    settings.mode === "lumpsum" &&
    !baskets.some((b) => b.active && isBeesOnly(b));
  const beesResult = useMemo((): BacktestResult | null => {
    if (!showBeesOverlay) return null;
    const series = scaleNavToAmount(benchQuery.data, settings.amount);
    if (series.length < 2) return null;
    return {
      basketId: BEES_ID,
      series,
      stats: {
        initial: settings.amount,
        final: series[series.length - 1]!.y,
        abs: 0,
        cagr: beesCagr ?? 0,
        mdd: 0,
      },
    };
  }, [showBeesOverlay, benchQuery.data, settings.amount, beesCagr]);
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
  const beesVol = beesResult ? volFromSeries(beesResult.series) : null;

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
      <LeadStory beesCagr={beesCagr} />
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
                <p className="league-value">{formatInr(settings.amount)}</p>
                {fund ? <p className="league-fund">{fund}</p> : null}
              </li>
            );
          }
          const vol = volFromSeries(r.series);
          const vs =
            beesCagr == null ? null : r.stats.cagr - beesCagr;
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
                <div className="league-metric">
                  <dt>Max DD</dt>
                  <dd className="num-loss">{formatPct(r.stats.mdd)}</dd>
                </div>
                <div className="league-metric">
                  <dt>Vol</dt>
                  <dd>
                    {vol == null ? (
                      <span className="num-empty">—</span>
                    ) : (
                      formatPct(vol)
                    )}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
        {beesResult && beesCagr != null ? (
          <li className="league-col is-ref">
            <span className="league-tick" aria-hidden="true" />
            <p className="league-name">Nifty BeES · reference</p>
            <p className="league-rate">{formatPct(beesCagr)}</p>
            <p className="league-value">
              {formatInr(beesResult.stats.final)}
            </p>
            <p className="league-fund">Not a basket. Overlay only.</p>
            <dl className="league-metrics">
              <div className="league-metric">
                <dt>vs BeES</dt>
                <dd>—</dd>
              </div>
              <div className="league-metric">
                <dt>Max DD</dt>
                <dd className="num-loss">—</dd>
              </div>
              <div className="league-metric">
                <dt>Vol</dt>
                <dd>{beesVol == null ? "—" : formatPct(beesVol)}</dd>
              </div>
            </dl>
          </li>
        ) : null}
      </ul>
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
        Source: Basket Lab · Data as on {asOf ? formatAsOf(asOf) : "—"} · All
        figures annualised
      </p>
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
