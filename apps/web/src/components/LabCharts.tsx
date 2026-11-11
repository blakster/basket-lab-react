import { EvilAreaChart } from "@/components/evilcharts/charts/recharts-area-chart";
import { EvilBarChart } from "@/components/evilcharts/charts/recharts-bar-chart";
import type { ChartConfig } from "@/components/evilcharts/ui/recharts-chart";
import { useMemo } from "react";
import { formatCompactInr, formatInr } from "../lib/format";
import { seriesPair } from "../lib/theme";
import type { YearlyRank } from "../lib/ranking";
import type { BacktestResult, Basket } from "../types";
import {
  formatFullDate,
  formatPctValue,
  formatTick,
  type MixSeries,
} from "./chartFormat";
import {
  DrawdownLineChart,
  MixStackChart,
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

function configFor(
  keys: { key: string; basket: Basket | undefined }[],
  colors: "basket" | "loss",
): ChartConfig {
  const config: ChartConfig = {};
  for (const { key, basket } of keys) {
    const color = basket?.color ?? "#111111";
    config[key] = {
      label: basket?.name ?? key,
      colors: seriesPair(color, colors === "loss" ? "loss" : "basket"),
    };
  }
  return config;
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

  const config = useMemo(() => configFor(keys, "basket"), [keys]);

  if (!keys.length || !data.length) {
    return <p className="chart-empty">No NAV series to plot.</p>;
  }

  return (
    <EvilAreaChart
      data={data}
      config={config}
      className="h-[280px] w-full"
      xDataKey="date"
      curveType="monotone"
      animationType="left-to-right"
    >
      <EvilAreaChart.Grid />
      <EvilAreaChart.XAxis
        dataKey="date"
        minTickGap={28}
        tickFormatter={(v) => formatTick(String(v))}
      />
      <EvilAreaChart.YAxis tickFormatter={(v) => formatCompactInr(Number(v))} width={52} />
      <EvilAreaChart.Legend isClickable variant="circle" align="center" verticalAlign="bottom" />
      <EvilAreaChart.Tooltip
        variant="frosted-glass"
        roundness="sm"
        labelFormatter={(label) => formatFullDate(String(label ?? ""))}
        valueFormatter={formatInr}
      />
      {keys.map(({ key }) => (
        <EvilAreaChart.Area
          key={key}
          dataKey={key}
          variant="gradient"
          strokeVariant="solid"
          strokeWidth={2}
          connectNulls
          isClickable
        >
          <EvilAreaChart.ActiveDot variant="colored-border" />
        </EvilAreaChart.Area>
      ))}
    </EvilAreaChart>
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

  if (!keys.length || !data.length) {
    return <p className="chart-empty">No drawdown series to plot.</p>;
  }

  return (
    <DrawdownLineChart
      data={data}
      series={keys.map(({ key, basket }) => ({
        key,
        label: basket?.name ?? key,
        color: basket?.color ?? "#1f3038",
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

  const data = useMemo(
    () =>
      ranking.map((year) => {
        const label =
          year.kind === "ytd"
            ? `${year.year} YTD`
            : year.kind === "partial"
              ? `${year.year}*`
              : String(year.year);
        const row: Record<string, string | number> = { year: label };
        for (const entry of year.order) {
          row[seriesKey(entry.basketId)] = Number(entry.ret.toFixed(2));
        }
        return row;
      }),
    [ranking],
  );

  const config = useMemo(() => configFor(keys, "basket"), [keys]);

  if (!keys.length || !data.length) return null;

  return (
    <EvilBarChart
      data={data}
      config={config}
      className="h-[260px] w-full"
      xDataKey="year"
      animationType="left-to-right"
      barRadius={4}
      barCategoryGap={16}
    >
      <EvilBarChart.Grid />
      <EvilBarChart.XAxis dataKey="year" />
      <EvilBarChart.YAxis tickFormatter={(v) => `${v}%`} width={48} />
      <EvilBarChart.Legend isClickable variant="circle" align="center" verticalAlign="bottom" />
      <EvilBarChart.Tooltip
        variant="frosted-glass"
        roundness="sm"
        valueFormatter={formatPctValue}
      />
      {keys.map(({ key }) => (
        <EvilBarChart.Bar key={key} dataKey={key} variant="gradient" />
      ))}
    </EvilBarChart>
  );
}

type MixCompareProps = {
  series: MixSeries[];
  categories: string[];
  unit?: "pct" | "raw";
};

export function MixCompareChart({ series, categories }: MixCompareProps) {
  return <MixStackChart series={series} categories={categories} />;
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
    <div className="alloc-stack" role="img" aria-label="Fund weights">
      {live.map((s) => (
        <span
          key={s.key}
          className="alloc-seg"
          style={{ flexGrow: s.weight, background: s.color }}
          title={`${s.label} ${s.weight.toFixed(1)}%`}
        />
      ))}
    </div>
  );
}
