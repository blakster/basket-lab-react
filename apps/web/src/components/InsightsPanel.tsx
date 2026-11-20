import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadNiftyBeesNav, NIFTY_BEES_CODE } from "../lib/api/benchmarkNav";
import {
  ensureFilings,
  insightsBasketSignature,
  postInsights,
  uploadFiling,
  type FilingState,
  type InsightsBasket,
} from "../lib/api/insights";
import {
  assetMeters,
  benchmarkForResult,
  concentrationFromHoldings,
  equityMeters,
  growthFromResult,
  overlapForBasket,
  redFlags,
  topSectorMeters,
} from "../lib/portfolioDetails";
import {
  alphaBeta,
  calmar,
  correlation,
  dailyTwrs,
  navToTwrs,
  rollingCagr,
  type CashflowSpec,
  type DatedReturn,
} from "../lib/risk";
import { computeMetrics } from "../lib/backtest/metrics";
import { resolveRange } from "../lib/resolveSettings";
import { seriesKey } from "../lib/series";
import { runIsStale } from "../lib/runFreshness";
import { inkAlpha } from "../lib/theme";
import { scriptScrollBehavior } from "../lib/motion";
import { useLab } from "../state/LabContext";
import type { BacktestResult, Basket, LabSettings } from "../types";
import {
  MixCompareChart,
  type MixSeries,
} from "./LabCharts";

import { BasketSwitch, basketSwitchTabId } from "./BasketSwitch";
import { OverlapBlock, PortfolioDesk } from "./PortfolioDesk";

const EQUITY_ORDER = ["large", "mid", "small", "unclassified"] as const;

function formatPct(n: number): string {
  const text = n.toFixed(2);
  return `${text === "-0.00" ? "0.00" : text}%`;
}

/** Never substitute 0 for a JSON-null PE / expense. */
function formatFilingMetric(
  value: number | null,
  incomplete: boolean,
): string {
  if (value == null) return "not in filing";
  const text = value.toFixed(2);
  return incomplete ? `${text} incomplete` : text;
}

function formatLabel(key: string): string {
  if (!key) return key;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function fundName(basket: Basket | undefined, schemeCode: string): string {
  return (
    basket?.funds.find((f) => f.schemeCode === schemeCode)?.schemeName ??
    schemeCode
  );
}

const FILING_STATE_LABEL: Record<FilingState, string> = {
  fresh: "Fresh",
  stale: "Stale",
  "missing-source": "Missing source",
  "download-failed": "Download failed",
  "parse-failed": "Parse failed",
  unmapped: "Unmapped",
};

function formatFilingState(state: string): string {
  return FILING_STATE_LABEL[state as FilingState] ?? state;
}

function needsFilingRetry(states: Iterable<string> | undefined): boolean {
  if (!states) return false;
  for (const state of states) {
    if (state !== "fresh") return true;
  }
  return false;
}

function basketName(id: string, labBaskets: Basket[]): string {
  return labBaskets.find((b) => b.id === id)?.name ?? id;
}

function basketColor(id: string, labBaskets: Basket[]): string {
  return labBaskets.find((b) => b.id === id)?.color ?? "#111111";
}

function cashflowOf(settings: LabSettings): CashflowSpec {
  const { start } = resolveRange(
    settings.period,
    settings.customStart,
    settings.customEnd,
  );
  return { mode: settings.mode, amount: settings.amount, startIso: start };
}

function formatFixed(n: number): string {
  const text = n.toFixed(2);
  return text === "-0.00" ? "0.00" : text;
}

function formatRolling(w: { min: number; median: number; max: number }): string {
  return `${formatFixed(w.min)} / ${formatFixed(w.median)} / ${formatFixed(w.max)}%`;
}

function topCategories(
  maps: Record<string, number>[],
  limit = 8,
): string[] {
  const totals = new Map<string, number>();
  for (const map of maps) {
    for (const [key, weight] of Object.entries(map)) {
      if (weight <= 0) continue;
      totals.set(key, (totals.get(key) ?? 0) + weight);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

function mixSeries(
  baskets: InsightsBasket[],
  labBaskets: Basket[],
  pick: (ib: InsightsBasket) => Record<string, number> | null,
  categories: string[],
): MixSeries[] {
  return baskets.flatMap((ib) => {
    const map = pick(ib);
    if (!map) return [];
    const values: Record<string, number> = {};
    for (const cat of categories) values[cat] = map[cat] ?? 0;
    return [
      {
        key: seriesKey(ib.id),
        label: basketName(ib.id, labBaskets),
        color: basketColor(ib.id, labBaskets),
        values,
      },
    ];
  });
}

function scrollToSection(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: scriptScrollBehavior(), block: "start" });
}

type RiskRow = {
  id: string;
  name: string;
  color: string;
  vol: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  rolling1y: ReturnType<typeof rollingCagr>;
  rolling3y: ReturnType<typeof rollingCagr>;
  alpha: number | null;
  beta: number | null;
  twrs: DatedReturn[];
};

function buildRiskRow(
  result: BacktestResult,
  basket: Basket | undefined,
  cashflow: CashflowSpec,
  benchTwrs: DatedReturn[] | null,
): RiskRow {
  const twrs = dailyTwrs(result.series, result.cashflow ?? cashflow);
  const ab = benchTwrs && benchTwrs.length >= 2 ? alphaBeta(twrs, benchTwrs) : null;
  const metrics = computeMetrics(result, {
    cashflow: result.cashflow ?? cashflow,
    twrs,
  });
  return {
    id: result.basketId,
    name: basket?.name ?? result.basketId,
    color: basket?.color ?? "#111111",
    vol: metrics.vol,
    sharpe: metrics.sharpe,
    sortino: metrics.sortino,
    calmar: calmar(result.stats.cagr, result.stats.mdd),
    rolling1y: rollingCagr(result.series, twrs, 252),
    rolling3y: rollingCagr(result.series, twrs, 756),
    alpha: ab?.alpha ?? null,
    beta: ab?.beta ?? null,
    twrs,
  };
}

function riskRowHasContent(row: RiskRow, beesMissing: boolean): boolean {
  return (
    row.vol != null ||
    row.sharpe != null ||
    row.sortino != null ||
    row.calmar != null ||
    row.rolling1y != null ||
    row.rolling3y != null ||
    row.alpha != null ||
    row.beta != null ||
    beesMissing ||
    row.twrs.length > 0
  );
}

function useInsightsDesk() {
  const {
    baskets,
    results,
    analyzing,
    reportStatus,
    settings,
    insightsBasketId,
    insightsOpen,
  } = useLab();
  const active = useMemo(() => baskets.filter((b) => b.active), [baskets]);
  const basketSignature = useMemo(
    () => insightsBasketSignature(active),
    [active],
  );
  const range = useMemo(
    () =>
      resolveRange(settings.period, settings.customStart, settings.customEnd),
    [settings.period, settings.customStart, settings.customEnd],
  );
  const cashflow = useMemo(() => cashflowOf(settings), [settings]);
  const hasSeries = results.some((r) => r.series.length >= 2);

  const schemeCodes = useMemo(
    () => [
      ...new Set(
        active.flatMap((b) => b.funds.map((f) => f.schemeCode)).filter(Boolean),
      ),
    ],
    [active],
  );

  const { data, isError, isSuccess, isLoading, refetch } = useQuery({
    queryKey: ["insights", basketSignature],
    queryFn: () => postInsights(active),
    retry: 1,
    enabled: active.length > 0,
    staleTime: 0,
  });

  const ensureQuery = useQuery({
    queryKey: ["ensure-filings", schemeCodes],
    queryFn: () => ensureFilings(schemeCodes),
    enabled: insightsOpen && schemeCodes.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  const retryMutation = useMutation({
    mutationFn: () => ensureFilings(schemeCodes),
    onSettled: () => {
      void refetch();
    },
  });

  useEffect(() => {
    if (ensureQuery.isSuccess) void refetch();
  }, [ensureQuery.dataUpdatedAt, ensureQuery.isSuccess, refetch]);

  const benchQuery = useQuery({
    queryKey: ["nav", NIFTY_BEES_CODE, range.start, range.end],
    queryFn: () => loadNiftyBeesNav(range.start, range.end),
    retry: 1,
    enabled: hasSeries,
  });

  useEffect(() => {
    if (isError) reportStatus("insights", { kind: "insights-down" });
    else if (isSuccess) reportStatus("insights", { kind: "ready" });
  }, [isError, isSuccess, reportStatus]);

  useEffect(() => {
    if (insightsOpen) void refetch();
  }, [insightsOpen, refetch]);

  const benchTwrs = useMemo(() => {
    const pts = benchQuery.data;
    if (!pts?.length) return null;
    const twrs = navToTwrs(pts);
    return twrs.length ? twrs : null;
  }, [benchQuery.data]);

  const beesMissing =
    hasSeries &&
    !benchQuery.isPending &&
    (benchQuery.isError || benchTwrs == null);

  const riskRows = useMemo(() => {
    const byId = new Map(baskets.map((b) => [b.id, b]));
    const rows: RiskRow[] = [];
    for (const r of results) {
      if (r.series.length < 2) continue;
      rows.push(buildRiskRow(r, byId.get(r.basketId), cashflow, benchTwrs));
    }
    return rows;
  }, [results, baskets, cashflow, benchTwrs]);

  const corrRows = useMemo(() => {
    const out: { key: string; label: string; value: number }[] = [];
    for (let i = 0; i < riskRows.length; i++) {
      for (let j = i + 1; j < riskRows.length; j++) {
        const left = riskRows[i]!;
        const right = riskRows[j]!;
        const value = correlation(left.twrs, right.twrs);
        if (value == null) continue;
        out.push({
          key: `${left.id}|${right.id}`,
          label: `${left.name} × ${right.name}`,
          value,
        });
      }
    }
    return out;
  }, [riskRows]);

  const focusedId =
    insightsBasketId ??
    active[0]?.id ??
    baskets[0]?.id ??
    null;

  const focusedData = useMemo(() => {
    if (!data || !focusedId) return data;
    return {
      ...data,
      baskets: data.baskets.filter((ib) => ib.id === focusedId),
    };
  }, [data, focusedId]);

  const focusedRiskRows = useMemo(
    () => (focusedId ? riskRows.filter((row) => row.id === focusedId) : riskRows),
    [riskRows, focusedId],
  );

  const focusedCorrRows = useMemo(
    () =>
      focusedId
        ? corrRows.filter((row) => row.key.split("|").includes(focusedId))
        : corrRows,
    [corrRows, focusedId],
  );

  const showRisk =
    focusedRiskRows.some((row) => riskRowHasContent(row, beesMissing)) ||
    focusedCorrRows.length > 0;

  const focusedResult = useMemo(
    () => results.find((r) => r.basketId === focusedId),
    [results, focusedId],
  );

  // Same guard as BacktestView: don't show a run computed for other settings.
  const runStale = analyzing || runIsStale(results, settings, range.start);

  // BeES on the focused basket's own cashflow (start date and SIP schedule),
  // so the desk compares XIRR to XIRR and CAGR to CAGR.
  const beesCagr = useMemo(() => {
    if (runStale) return null;
    const bench = benchmarkForResult(focusedResult, benchQuery.data, {
      mode: settings.mode,
      amount: settings.amount,
      startIso: range.start,
      endIso: range.end,
    });
    return bench ? bench.stats.cagr : null;
  }, [
    runStale,
    focusedResult,
    benchQuery.data,
    settings.mode,
    settings.amount,
    range.start,
    range.end,
  ]);

  return {
    baskets,
    data: focusedData,
    overlap: data?.overlap ?? null,
    overlapHoldings: data?.overlapHoldings ?? null,
    isError,
    loading: isLoading,
    riskRows: focusedRiskRows,
    corrRows: focusedCorrRows,
    showRisk,
    beesMissing,
    beesCagr,
    focusedId,
    focusedResult,
    runStale,
    mode: settings.mode,
    fetchingFilings: ensureQuery.isFetching || retryMutation.isPending,
    retryFilings: retryMutation.mutate,
    refetchInsights: refetch,
  };
}

export function InsightsPanel() {
  const desk = useInsightsDesk();
  return (
    <section className="insights-page" aria-label="Insights">
      <InsightsDesk {...desk} />
    </section>
  );
}

function InsightsDesk({
  baskets,
  data,
  overlap,
  overlapHoldings,
  isError,
  loading,
  riskRows,
  corrRows,
  showRisk,
  beesMissing,
  beesCagr,
  focusedId,
  focusedResult,
  runStale,
  mode,
  fetchingFilings,
  retryFilings,
  refetchInsights,
}: ReturnType<typeof useInsightsDesk>) {
  const { openInsights } = useLab();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState("insight-snapshot");
  const sectorCats = useMemo(
    () => (data ? topCategories(data.baskets.map((b) => b.sector)) : []),
    [data],
  );
  const assetCats = useMemo(
    () => (data ? topCategories(data.baskets.map((b) => b.asset)) : []),
    [data],
  );
  const creditCats = useMemo(
    () =>
      data
        ? topCategories(data.baskets.map((b) => b.credit ?? {}))
        : [],
    [data],
  );
  const equityCats = useMemo(() => {
    if (!data) return [];
    const any = data.baskets.some((ib) =>
      EQUITY_ORDER.some((key) => (ib.equitySplit[key] ?? 0) > 0),
    );
    return any ? [...EQUITY_ORDER] : [];
  }, [data]);

  const filingById = useMemo(() => {
    const map = new Map<string, InsightsBasket>();
    for (const ib of data?.baskets ?? []) map.set(ib.id, ib);
    return map;
  }, [data]);
  const switchable = baskets.filter((b) => b.active);
  const showOverlap = switchable.length >= 2;

  const switchRef = useRef<HTMLDivElement>(null);
  const [switchFade, setSwitchFade] = useState({ left: false, right: false });

  // Fade the strip's edge only on sides that actually hide tabs.
  useEffect(() => {
    const el = switchRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      setSwitchFade({
        left: el.scrollLeft > 1,
        right: el.scrollLeft < maxScroll - 1,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [switchable.length]);

  // Keep the focused tab fully inside the scrollable strip.
  useEffect(() => {
    const el = switchRef.current;
    const tab = el?.querySelector('[aria-selected="true"]');
    if (!el || !tab) return;
    const tabRect = tab.getBoundingClientRect();
    const stripRect = el.getBoundingClientRect();
    const overflowLeft = stripRect.left - tabRect.left;
    const overflowRight = tabRect.right - stripRect.right;
    if (overflowLeft > 0) {
      el.scrollBy({ left: -(overflowLeft + 12), behavior: scriptScrollBehavior() });
    } else if (overflowRight > 0) {
      el.scrollBy({ left: overflowRight + 12, behavior: scriptScrollBehavior() });
    }
  }, [focusedId]);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          seen.set(entry.target.id, entry.intersectionRatio);
        }
        let bestId = "";
        let best = 0;
        for (const [id, ratio] of seen) {
          if (ratio > best) {
            best = ratio;
            bestId = id;
          }
        }
        if (bestId) setActiveSection(bestId);
      },
      { root: null, rootMargin: "-15% 0px -55% 0px", threshold: [0, 0.15, 0.4, 0.7] },
    );
    for (const section of [
      "insight-snapshot",
      "insight-holdings",
      "insight-mix",
      "insight-overlap",
      "insight-risk",
    ]) {
      const el = root.querySelector(`#${section}`);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [data, showRisk, showOverlap]);

  const focusedName = focusedId ? basketName(focusedId, baskets) : "Insights";
  // The panel is labelled by the focused basket's tab only when that tab is
  // actually rendered (≥2 switchable baskets and the focused one among them).
  const selectedTabId =
    switchable.length > 1 &&
    focusedId != null &&
    switchable.some((b) => b.id === focusedId)
      ? basketSwitchTabId("insights-switch", focusedId)
      : undefined;
  const showDesk = Boolean(data || showRisk || focusedId);
  const overlapRows = useMemo(
    () => overlapForBasket(focusedId, overlap, overlapHoldings, baskets),
    [focusedId, overlap, overlapHoldings, baskets],
  );
  const focusedFiling = focusedId ? filingById.get(focusedId) : undefined;
  const growth = runStale ? null : growthFromResult(focusedResult, mode);
  const concentration = concentrationFromHoldings(focusedFiling?.holdings);
  const asset = assetMeters(focusedFiling?.asset);
  const equity = equityMeters(focusedFiling?.equitySplit);
  const sectors = topSectorMeters(focusedFiling?.sector);
  const flags = redFlags({ overlap: overlapRows, sectors, equity });
  const peText = focusedFiling
    ? formatFilingMetric(focusedFiling.pe, focusedFiling.peIncomplete)
    : null;
  const peChip = peText && peText !== "not in filing" ? peText : null;
  const sections = [
    { id: "insight-snapshot", label: "Snapshot" },
    ...(data
      ? [
          { id: "insight-holdings", label: "Holdings" },
          { id: "insight-mix", label: "Mix" },
        ]
      : []),
    ...(showOverlap ? [{ id: "insight-overlap", label: "Overlap" }] : []),
    ...(showRisk ? [{ id: "insight-risk", label: "Risk" }] : []),
  ];

  return (
    <div className="insights-desk">
      <div className="insights-chrome">
        <header className="insights-sheet-header">
          <h2 className="insights-sheet-title">Insights</h2>
          <p id="insights-desk-desc" className="insights-sheet-desc">
            {data?.asOf
              ? `${focusedName}. Filings as of ${data.asOf}. Missing PE or expense stays empty.`
              : `${focusedName}. Filings, mix, and risk for this basket.`}
          </p>
        </header>
        {switchable.length > 1 && (
          <BasketSwitch
            baskets={switchable}
            selectedId={focusedId}
            onSelect={openInsights}
            idPrefix="insights-switch"
            panelId="insights-desk-panel"
            listRef={switchRef}
            fades={switchFade}
          />
        )}
        {isError && (
          <p className="insight-empty insight-alert" role="status">
            Insights unavailable
          </p>
        )}
        {loading && !data && !isError && (
          <p className="insight-empty insight-loading" role="status">
            Loading filings…
          </p>
        )}
      </div>
      {showDesk && (
        <nav className="insights-nav" aria-label="On this page">
          {sections.map((section, i) => (
            <span key={section.id} className="insights-nav-slot">
              {i > 0 ? (
                <span className="insights-nav-dot" aria-hidden="true">
                  ·
                </span>
              ) : null}
              <button
                type="button"
                className="insights-nav-item"
                aria-current={activeSection === section.id ? "true" : undefined}
                onClick={() => {
                  setActiveSection(section.id);
                  scrollToSection(section.id);
                }}
              >
                {section.label}
              </button>
            </span>
          ))}
        </nav>
      )}
      {showDesk && (
        <>
          <div
            className="insights-sections"
            ref={bodyRef}
            role="tabpanel"
            id="insights-desk-panel"
            aria-labelledby={selectedTabId}
            tabIndex={0}
          >
            {data?.baskets.map((ib) =>
              ib.filingCoverage ? (
                <FilingCoverageBlock
                  key={`coverage-${ib.id}`}
                  ib={ib}
                  basket={baskets.find((b) => b.id === ib.id)}
                  fetching={fetchingFilings}
                  onRetry={() => retryFilings()}
                  onUploaded={() => {
                    void refetchInsights();
                  }}
                />
              ) : null,
            )}
            <InsightSection id="insight-snapshot" title="Snapshot">
              <PortfolioDesk
                growth={growth}
                stale={runStale}
                beesCagr={beesCagr}
                beesMissing={beesMissing}
                concentration={concentration}
                peText={peChip}
                flags={flags}
                asset={asset}
                equity={equity}
                sectors={sectors}
              />
              <SnapshotBlock
                baskets={baskets}
                filingById={filingById}
                riskRows={riskRows}
              />
            </InsightSection>
            {data && (
              <>
                <InsightSection id="insight-holdings" title="Holdings">
                  {data.baskets.map((ib) => (
                    <HoldingsBlock
                      key={ib.id}
                      ib={ib}
                      basket={baskets.find((b) => b.id === ib.id)}
                    />
                  ))}
                </InsightSection>
                <InsightSection id="insight-mix" title="Mix">
                  <div className="insight-grid">
                    <MixBlock
                      title="Sector"
                      series={mixSeries(
                        data.baskets,
                        baskets,
                        (ib) => ib.sector,
                        sectorCats,
                      )}
                      categories={sectorCats.map(formatLabel)}
                      rawCategories={sectorCats}
                    />
                    <MixBlock
                      title="Asset"
                      series={mixSeries(
                        data.baskets,
                        baskets,
                        (ib) => ib.asset,
                        assetCats,
                      )}
                      categories={assetCats.map(formatLabel)}
                      rawCategories={assetCats}
                    />
                    <MixBlock
                      title="Credit"
                      series={mixSeries(
                        data.baskets,
                        baskets,
                        (ib) => ib.credit,
                        creditCats,
                      )}
                      categories={creditCats}
                      rawCategories={creditCats}
                      empty={
                        creditCats.length === 0
                          ? (data.baskets.find((b) => b.creditNote)?.creditNote ??
                            "N/A — no debt holdings")
                          : null
                      }
                    />
                    <EquityMixBlock
                      dataBaskets={data.baskets}
                      labBaskets={baskets}
                      categories={equityCats}
                    />
                  </div>
                </InsightSection>
              </>
            )}
            {showOverlap && (
              <InsightSection id="insight-overlap" title="Overlap">
                <OverlapBlock rows={overlapRows} twoBaskets={showOverlap} />
              </InsightSection>
            )}
            {showRisk && (
              <InsightSection id="insight-risk" title="Risk & skill">
                <p className="insight-empty">
                  rf = 0 · vs Nifty BeES. The table is the comparison — numbers,
                  not a radar.
                </p>
                <div className="table-scroll">
                  <Table className="insight-table risk-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Basket</TableHead>
                        <TableHead className="text-right">Vol</TableHead>
                        <TableHead className="text-right">Sharpe</TableHead>
                        <TableHead className="text-right">Sortino</TableHead>
                        <TableHead className="text-right">Calmar</TableHead>
                        <TableHead className="text-right">Alpha</TableHead>
                        <TableHead className="text-right">Beta</TableHead>
                        <TableHead className="text-right">Roll 1Y</TableHead>
                        <TableHead className="text-right">Roll 3Y</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {riskRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell data-label="Basket">{row.name}</TableCell>
                          <TableCell className="text-right" data-label="Vol">
                            {row.vol != null ? formatPct(row.vol) : "—"}
                          </TableCell>
                          <TableCell className="text-right" data-label="Sharpe">
                            {row.sharpe != null ? formatFixed(row.sharpe) : "—"}
                          </TableCell>
                          <TableCell className="text-right" data-label="Sortino">
                            {row.sortino != null ? formatFixed(row.sortino) : "—"}
                          </TableCell>
                          <TableCell className="text-right" data-label="Calmar">
                            {row.calmar != null ? formatFixed(row.calmar) : "—"}
                          </TableCell>
                          <TableCell className="text-right" data-label="Alpha">
                            {row.alpha != null ? formatPct(row.alpha) : "—"}
                          </TableCell>
                          <TableCell className="text-right" data-label="Beta">
                            {row.beta != null ? formatFixed(row.beta) : "—"}
                          </TableCell>
                          <TableCell className="text-right" data-label="Roll 1Y">
                            {row.rolling1y
                              ? formatRolling(row.rolling1y)
                              : "need 1Y of NAV"}
                          </TableCell>
                          <TableCell className="text-right" data-label="Roll 3Y">
                            {row.rolling3y
                              ? formatRolling(row.rolling3y)
                              : "need 3Y of NAV"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {beesMissing &&
                  riskRows.some((row) => row.alpha == null) && (
                    <p className="insight-empty">Nifty BeES NAV missing</p>
                  )}
                {corrRows.length > 0 && (
                  <div className="insight-basket">
                    <h4>Correlation</h4>
                    <Table className="insight-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Pair</TableHead>
                          <TableHead className="text-right">Corr</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {corrRows.map((row) => (
                          <TableRow key={row.key}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell className="text-right">
                              <span
                                className="corr-cell"
                                style={{
                                  background: inkAlpha(0.08 + Math.abs(row.value) * 0.28),
                                }}
                              >
                                {formatFixed(row.value)}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </InsightSection>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function InsightSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="insight-card insight-section" id={id}>
      <h3>{title}</h3>
      {children}
    </article>
  );
}

const FILING_FILE_COPY =
  "Use an AMC portfolio file under 5 MB (.xlsx, .xls, or .csv).";

function clientRejectsFiling(file: File): boolean {
  return file.size > 5 * 1024 * 1024 || !/\.(xlsx|xls|xlsm|csv)$/i.test(file.name);
}

function FilingCoverageBlock({
  ib,
  basket,
  fetching,
  onRetry,
  onUploaded,
}: {
  ib: InsightsBasket;
  basket: Basket | undefined;
  fetching: boolean;
  onRetry: () => void;
  onUploaded: () => void;
}) {
  const coverage = ib.filingCoverage;
  const [busyCodes, setBusyCodes] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inflight = useRef(new Set<string>());
  if (!coverage) return null;
  const filings = ib.filings ?? [];
  const showRetry = needsFilingRetry(filings.map((f) => f.state));

  async function handleFile(schemeCode: string, file: File | undefined) {
    if (!file) return;
    if (inflight.current.has(schemeCode)) return;
    if (clientRejectsFiling(file)) {
      setErrors((prev) => ({ ...prev, [schemeCode]: FILING_FILE_COPY }));
      return;
    }
    inflight.current.add(schemeCode);
    setBusyCodes((prev) => ({ ...prev, [schemeCode]: true }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[schemeCode];
      return next;
    });
    try {
      await uploadFiling(schemeCode, file);
      onUploaded();
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Upload failed.";
      setErrors((prev) => ({ ...prev, [schemeCode]: message }));
    } finally {
      inflight.current.delete(schemeCode);
      setBusyCodes((prev) => {
        const next = { ...prev };
        delete next[schemeCode];
        return next;
      });
    }
  }

  return (
    <section className="insight-filings" aria-label="Filing coverage">
      <h3 className="insight-filings-flag">Filing coverage</h3>
      <p className="insight-filings-count">
        {coverage.covered} of {coverage.total} funds covered
      </p>
      {ib.filingAsOf ? (
        <p className="insight-filings-asof">As of {ib.filingAsOf}</p>
      ) : null}
      {filings.length > 0 && (
        <ul className="insight-filings-list">
          {filings.map((filing) => {
            const code = filing.schemeCode;
            const inputId = `add-filing-${code || filing.requestedMonth}`;
            const busy = Boolean(busyCodes[code]);
            return (
              <li key={code || filing.requestedMonth}>
                <span className="insight-filings-name">
                  {fundName(basket, code)}
                </span>
                <span
                  className="insight-filings-state"
                  data-state={filing.state}
                >
                  {formatFilingState(filing.state)}
                </span>
                <div className="insight-filings-action">
                  <input
                    id={inputId}
                    className="sr-only"
                    type="file"
                    accept=".xlsx,.xls,.xlsm,.csv"
                    aria-label="Add filing"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void handleFile(code, file);
                    }}
                  />
                  <button
                    type="button"
                    className="ds-btn-outlined"
                    disabled={busy}
                    aria-busy={busy || undefined}
                    onClick={() => {
                      document.getElementById(inputId)?.click();
                    }}
                  >
                    {busy ? "Reading filing" : "Add filing"}
                  </button>
                </div>
                {filing.reason ? (
                  <p className="insight-filings-reason">{filing.reason}</p>
                ) : null}
                {filing.sourceUrl ? (
                  <p className="insight-filings-source">
                    <a href={filing.sourceUrl} rel="noreferrer" target="_blank">
                      {filing.sourceUrl}
                    </a>
                  </p>
                ) : null}
                {errors[code] ? (
                  <p className="insight-filings-error">{errors[code]}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {showRetry && (
        <div className="insight-filings-action">
          <button
            type="button"
            className="ds-btn-outlined"
            disabled={fetching}
            aria-busy={fetching || undefined}
            onClick={onRetry}
          >
            {fetching ? "Fetching latest filings" : "Fetch latest filings"}
          </button>
        </div>
      )}
    </section>
  );
}

function formatAum(value: number | null | undefined): string {
  if (value == null) return "—";
  return `₹${value} Cr`;
}

function formatTurnover(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value}×`;
}

function SnapshotBlock({
  baskets,
  filingById,
  riskRows,
}: {
  baskets: Basket[];
  filingById: Map<string, InsightsBasket>;
  riskRows: RiskRow[];
}) {
  const ids = new Set([
    ...filingById.keys(),
    ...riskRows.map((r) => r.id),
  ]);
  const riskById = new Map(riskRows.map((r) => [r.id, r]));
  const rows = [...ids].map((id) => {
    const filing = filingById.get(id);
    const risk = riskById.get(id);
    const aum = filing?.aumCr ?? null;
    const turnover = filing?.turnover ?? null;
    return {
      id,
      name: basketName(id, baskets),
      expense: filing
        ? formatFilingMetric(filing.expenseRatio, filing.expenseIncomplete)
        : "—",
      pe: filing
        ? formatFilingMetric(filing.pe, filing.peIncomplete)
        : "—",
      aum: formatAum(aum),
      turnover: formatTurnover(turnover),
      vol: risk?.vol,
      sharpe: risk?.sharpe,
      sortino: risk?.sortino,
      calmar: risk?.calmar,
    };
  });

  if (!rows.length) {
    return <p className="insight-empty">No active baskets to score.</p>;
  }

  return (
    <div className="table-scroll">
      <Table className="insight-table snapshot-table">
        <TableHeader>
          <TableRow>
            <TableHead>Basket</TableHead>
            <TableHead className="text-right">Expense</TableHead>
            <TableHead className="text-right">PE</TableHead>
            <TableHead className="text-right">AUM</TableHead>
            <TableHead className="text-right">Turnover</TableHead>
            <TableHead className="text-right">Vol</TableHead>
            <TableHead className="text-right">Sharpe</TableHead>
            <TableHead className="text-right">Sortino</TableHead>
            <TableHead className="text-right">Calmar</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell data-label="Basket">{row.name}</TableCell>
              <TableCell className="text-right" data-label="Expense">
                {row.expense}
              </TableCell>
              <TableCell className="text-right" data-label="PE">
                {row.pe}
              </TableCell>
              <TableCell className="text-right" data-label="AUM">
                {row.aum}
              </TableCell>
              <TableCell className="text-right" data-label="Turnover">
                {row.turnover}
              </TableCell>
              <TableCell className="text-right" data-label="Vol">
                {row.vol != null ? formatPct(row.vol) : "—"}
              </TableCell>
              <TableCell className="text-right" data-label="Sharpe">
                {row.sharpe != null ? formatFixed(row.sharpe) : "—"}
              </TableCell>
              <TableCell className="text-right" data-label="Sortino">
                {row.sortino != null ? formatFixed(row.sortino) : "—"}
              </TableCell>
              <TableCell className="text-right" data-label="Calmar">
                {row.calmar != null ? formatFixed(row.calmar) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const HOLDINGS_PREVIEW = 10;

function HoldingsBlock({
  ib,
  basket,
}: {
  ib: InsightsBasket;
  basket: Basket | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? ib.holdings : ib.holdings.slice(0, HOLDINGS_PREVIEW);
  const extra = ib.holdings.length - HOLDINGS_PREVIEW;

  return (
    <div className="insight-basket">
      <h4>
        {basket?.name ?? ib.id}
        {ib.holdings.length > 0 ? (
          <span className="holdings-count"> {ib.holdings.length} holdings</span>
        ) : null}
      </h4>
      {ib.missingSchemes.map((code) => (
        <p key={code} className="insight-missing">
          No fund details for {fundName(basket, code)}
        </p>
      ))}
      {ib.holdings.length > 0 && (
        <div className="table-scroll">
          <Table className="insight-table">
            <TableHeader>
              <TableRow>
                <TableHead>Holding</TableHead>
                <TableHead className="text-right">Weight</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((h, i) => (
                <TableRow key={h.isin || `${h.name}-${h.weight}-${i}`}>
                  <TableCell>{h.name}</TableCell>
                  <TableCell className="text-right">
                    {formatPct(h.weight)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {extra > 0 && (
        <button
          type="button"
          className="ds-btn-outlined holdings-more"
          onClick={() => setShowAll((open) => !open)}
        >
          {showAll
            ? "Show top 10"
            : `Show all ${ib.holdings.length} holdings`}
        </button>
      )}
    </div>
  );
}

function MixBlock({
  title,
  series,
  categories,
  rawCategories,
  empty,
}: {
  title: string;
  series: MixSeries[];
  categories: string[];
  rawCategories: string[];
  empty?: string | null;
}) {
  if (empty) {
    return (
      <div className="insight-basket">
        <h4>{title}</h4>
        <p className="insight-empty">{empty}</p>
      </div>
    );
  }
  if (!rawCategories.length) {
    return (
      <div className="insight-basket">
        <h4>{title}</h4>
        <p className="insight-empty">No fund details</p>
      </div>
    );
  }
  const labeled = series.map((s) => ({
    ...s,
    values: Object.fromEntries(
      rawCategories.map((raw, i) => [categories[i] ?? raw, s.values[raw] ?? 0]),
    ),
  }));
  return (
    <div className="insight-basket">
      <h4>{title}</h4>
      <MixCompareChart series={labeled} categories={categories} />
    </div>
  );
}

function EquityMixBlock({
  dataBaskets,
  labBaskets,
  categories,
}: {
  dataBaskets: InsightsBasket[];
  labBaskets: Basket[];
  categories: string[];
}) {
  return (
    <div className="insight-basket">
      <h4>Equity split</h4>
      {dataBaskets.map((ib) => {
        const empty = equitySplitEmpty(
          ib,
          labBaskets.find((b) => b.id === ib.id),
        );
        if (empty) {
          return (
            <p key={ib.id} className="insight-empty">
              {empty}
            </p>
          );
        }
        return null;
      })}
      {categories.length > 0 && (
        <MixCompareChart
          series={mixSeries(
            dataBaskets.filter((ib) =>
              EQUITY_ORDER.some((key) => (ib.equitySplit[key] ?? 0) > 0),
            ),
            labBaskets,
            (ib) => ib.equitySplit,
            categories,
          ).map((s) => ({
            ...s,
            values: Object.fromEntries(
              categories.map((raw) => [formatLabel(raw), s.values[raw] ?? 0]),
            ),
          }))}
          categories={categories.map(formatLabel)}
        />
      )}
    </div>
  );
}

function equitySplitEmpty(
  ib: InsightsBasket,
  basket: Basket | undefined,
): string | null {
  const missing = new Set(ib.missingSchemes);
  const codes = (basket?.funds ?? [])
    .filter((f) => f.weight > 0)
    .map((f) => f.schemeCode);
  const allMissing =
    codes.length > 0 && codes.every((c) => missing.has(c));
  if (allMissing) return "No fund details";
  const hasEquity = EQUITY_ORDER.some((key) => (ib.equitySplit[key] ?? 0) > 0);
  if (!hasEquity) return "No equity holdings";
  return null;
}
