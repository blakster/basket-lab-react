import { useMemo } from "react";
import type { YearlyRank } from "../lib/ranking";
import type { BacktestResult, Basket } from "../types";
import { type MixSeries } from "./chartFormat";
import {
  DrawdownLineChart,
  GrowthPathChart,
  MixStripChart,
  RiskRadarChart,
} from "./LabPlots";

export type { MixSeries };

const MAX_POINTS = 120;

function seriesKey(id: string): string {
  return `b_${id.replace(/[^a-zA-Z0-9]/g, "")}`;
}

function downsample<T>(points: T[], max = MAX_POINTS): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round(i * step)]!);
  }
  return out;
}

function unionDates(results: BacktestResult[]): string[] {
  const dates = new Set<string>();
  for (const r of results) {
    if (r.error === "no-nav") continue;
    for (const p of r.series) dates.add(p.x);
  }
  return [...dates].sort();
}

function chartable(results: BacktestResult[], baskets: Basket[]) {
  const live = results.filter((r) => r.error !== "no-nav" && r.series.length > 0);
  const byId = new Map(baskets.map((b) => [b.id, b]));
  const keys = live.map((r) => ({
    result: r,
    key: seriesKey(r.basketId),
    basket: byId.get(r.basketId),
  }));
  const dates = downsample(unionDates(live));
  return { keys, dates };
}

type LabChartsProps = {
  results: BacktestResult[];
  baskets: Basket[];
};

export function GrowthChart({ results, baskets }: LabChartsProps) {
  const { keys, dates } = useMemo(
    () => chartable(results, baskets),
    [results, baskets],
  );

  const data = useMemo(() => {
    return dates.map((date) => {
      const row: Record<string, string | number | null> = { date };
      for (const { key, result } of keys) {
        const point = result.series.find((p) => p.x === date);
        row[key] = point ? Math.round(point.y) : null;
      }
      return row;
    });
  }, [dates, keys]);

  const startAmount = useMemo(() => {
    for (const { result } of keys) {
      const first = result.series[0]?.y;
      if (typeof first === "number" && Number.isFinite(first)) return first;
    }
    return 100000;
  }, [keys]);

  const leadId = useMemo(() => {
    let best: { id: string; cagr: number } | null = null;
    for (const { result } of keys) {
      if (result.error === "no-nav") continue;
      if (!best || result.stats.cagr > best.cagr) {
        best = { id: result.basketId, cagr: result.stats.cagr };
      }
    }
    return best?.id;
  }, [keys]);

  if (!keys.length || !data.length) {
    return <p className="chart-empty">No NAV series to plot.</p>;
  }

  return (
    <GrowthPathChart
      data={data}
      startAmount={startAmount}
      series={keys.map(({ key, basket, result }) => ({
        key,
        label: basket?.name ?? key,
        color: basket?.color ?? "#6B6B6B",
        dashed: basket?.id === "__nifty-bees",
        lead: result.basketId === leadId,
      }))}
    />
  );
}

export function DrawdownChart({ results, baskets }: Omit<LabChartsProps, "amount" | "period">) {
  const { keys, dates } = useMemo(
    () => chartable(results, baskets),
    [results, baskets],
  );

  const data = useMemo(() => {
    return dates.map((date) => {
      const row: Record<string, string | number | null> = { date };
      for (const { key, result } of keys) {
        const point = result.series.find((p) => p.x === date);
        row[key] = point ? Number(point.drawdown.toFixed(2)) : null;
      }
      return row;
    });
  }, [dates, keys]);

  const worstKey = useMemo(() => {
    let worst: { key: string; mdd: number } | null = null;
    for (const { key, result } of keys) {
      if (!worst || result.stats.mdd < worst.mdd) {
        worst = { key, mdd: result.stats.mdd };
      }
    }
    return worst?.key;
  }, [keys]);

  if (!keys.length || !data.length) {
    return <p className="chart-empty">No drawdown series to plot.</p>;
  }

  return (
    <DrawdownLineChart
      data={data}
      worstKey={worstKey}
      series={keys.map(({ key, basket }) => ({
        key,
        label: basket?.name ?? key,
        color: basket?.color ?? "#121212",
      }))}
    />
  );
}

type RankingChartProps = {
  ranking: YearlyRank[];
  baskets: Basket[];
};

export function YearlyRankingChart({ ranking, baskets }: RankingChartProps) {
  const byId = useMemo(
    () => new Map(baskets.map((b) => [b.id, b])),
    [baskets],
  );

  const keys = useMemo(() => {
    const seen = new Set<string>();
    const list: { key: string; id: string; basket: Basket | undefined }[] = [];
    for (const year of ranking) {
      for (const entry of year.order) {
        if (seen.has(entry.basketId)) continue;
        seen.add(entry.basketId);
        list.push({
          key: seriesKey(entry.basketId),
          id: entry.basketId,
          basket: byId.get(entry.basketId),
        });
      }
    }
    return list;
  }, [ranking, byId]);

  if (!keys.length || !ranking.length) return null;

  const nameOf = (id: string) =>
    keys.find((k) => k.id === id)?.basket?.name ?? id;

  return (
    <div className="rank-ledger" aria-label="Yearly ranking">
      {ranking.map((year) => (
        <div key={year.year} className="rank-year">
          <span className="rank-year-label">
            {year.kind === "ytd"
              ? `${year.year} YTD`
              : year.kind === "partial"
                ? `${year.year}*`
                : String(year.year)}
          </span>
          <ol>
            {year.order.map((entry, place) => (
              <li
                key={entry.basketId}
                className={place === 0 ? "is-first" : undefined}
              >
                <span className="place">{place + 1}</span>
                <span>{nameOf(entry.basketId)}</span>
                <span className="ret">{entry.ret.toFixed(2)}%</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

type MixCompareProps = {
  series: MixSeries[];
  categories: string[];
  unit?: "pct" | "raw";
};

export function MixCompareChart({ series, categories }: MixCompareProps) {
  return <MixStripChart series={series} categories={categories} />;
}

type MetricPoint = {
  key: string;
  label: string;
  color: string;
  values: Record<string, number | null>;
};

type MetricCompareProps = {
  metrics: { key: string; label: string }[];
  series: MetricPoint[];
};

export function MetricCompareChart({ metrics, series }: MetricCompareProps) {
  return <RiskRadarChart metrics={metrics} series={series} />;
}

type StackSegment = {
  key: string;
  label: string;
  weight: number;
  color: string;
};

export function AllocationStack({ segments }: { segments: StackSegment[] }) {
  const live = segments.filter((s) => s.weight > 0);
  if (!live.length) {
    return <p className="chart-empty">No weights to plot.</p>;
  }
  return (
    <ul className="alloc-rows" aria-label="Fund weights">
      {live.map((s) => (
        <li key={s.key}>
          <span className="alloc-name">{s.label}</span>
          <span className="alloc-pct">{s.weight.toFixed(0)}%</span>
          <span className="alloc-track">
            <span style={{ width: `${Math.min(100, Math.max(0, s.weight))}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
