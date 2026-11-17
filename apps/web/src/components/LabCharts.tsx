import { useMemo, type ReactNode } from "react";
import { formatCompactInr } from "../lib/format";
import type { YearlyRank } from "../lib/ranking";
import type { BacktestResult, Basket } from "../types";
import { formatFullDate, formatPctValue, formatTick, type MixSeries } from "./chartFormat";
import { Line } from "./dither-kit/area";
import { LineChart } from "./dither-kit/area-chart";
import { Bar } from "./dither-kit/bar";
import { BarChart } from "./dither-kit/bar-chart";
import { BlockLegend } from "./dither-kit/block-legend";
import type { ChartConfig } from "./dither-kit/chart-context";
import type { DitherColor } from "./dither-kit/palette";
import { Tooltip } from "./dither-kit/tooltip";
import { XAxis } from "./dither-kit/x-axis";
import { YAxis } from "./dither-kit/y-axis";

export type { MixSeries };

const BEES_ID = "__nifty-bees";
// Dither Kit only takes named palette colours. Ink-on-white: the leader is blue,
// the BeES reference is grey, everyone else gets the next quiet hue.
const OTHER_COLORS: DitherColor[] = ["purple", "green", "orange", "pink"];
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

type Row = Record<string, string | number>;
type ChartKey = ReturnType<typeof chartable>["keys"][number];

/** One colour per basket, shared by the growth and drawdown charts. */
function seriesConfig(
  keys: ChartKey[],
  colorOf: (id: string) => DitherColor,
): ChartConfig {
  return Object.fromEntries(
    keys.map(({ key, basket, result }) => [
      key,
      { label: basket?.name ?? key, color: colorOf(result.basketId) },
    ]),
  );
}

function leaderId(keys: ChartKey[]): string | undefined {
  let best: { id: string; cagr: number } | null = null;
  for (const { result } of keys) {
    if (result.basketId === BEES_ID) continue;
    if (!best || result.stats.cagr > best.cagr) {
      best = { id: result.basketId, cagr: result.stats.cagr };
    }
  }
  return best?.id;
}

function paletteFor(keys: ChartKey[]) {
  const lead = leaderId(keys);
  const others = keys.filter(
    (k) => k.result.basketId !== lead && k.result.basketId !== BEES_ID,
  );
  return (id: string): DitherColor => {
    if (id === lead) return "blue";
    if (id === BEES_ID) return "grey";
    const i = others.findIndex((k) => k.result.basketId === id);
    return OTHER_COLORS[i % OTHER_COLORS.length]!;
  };
}

/**
 * Dither Kit reads a missing value as 0, so a basket that starts later would
 * dive to the floor. Carry the nearest known value across gaps instead.
 */
function seriesRows(
  dates: string[],
  keys: ChartKey[],
  pick: (p: BacktestResult["series"][number]) => number,
): Row[] {
  const rows: Row[] = dates.map((date) => ({ date, label: formatFullDate(date) }));
  for (const { key, result } of keys) {
    const byDate = new Map(result.series.map((p) => [p.x, pick(p)]));
    let last: number | undefined;
    const vals = dates.map((d) => (last = byDate.get(d) ?? last));
    const first = vals.find((v) => v !== undefined) ?? 0;
    vals.forEach((v, i) => {
      rows[i]![key] = v ?? first;
    });
  }
  return rows;
}

/** Config order is paint order in Dither Kit, so the series to read goes last. */
function lastOnTop(keys: ChartKey[], id?: string): ChartKey[] {
  const top = keys.filter((k) => k.result.basketId === id);
  return [...keys.filter((k) => k.result.basketId !== id), ...top];
}

function DitherPlot({
  config,
  height,
  ending,
  children,
}: {
  config: ChartConfig;
  height: string;
  ending?: Record<string, number>;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className={height}>{children}</div>
      <BlockLegend
        config={config}
        values={ending}
        valueFormatter={formatCompactInr}
        className="text-[11px]"
      />
    </div>
  );
}

export function GrowthChart({ results, baskets }: LabChartsProps) {
  const { keys, dates } = useMemo(() => chartable(results, baskets), [results, baskets]);
  // Dither Kit always draws from 0. Lift the floor to just under the lowest
  // value so the paths use the full height, and add it back in the labels.
  const { data, floor } = useMemo(() => {
    const rows = seriesRows(dates, keys, (p) => Math.round(p.y));
    const values = rows.flatMap((r) => keys.map(({ key }) => Number(r[key])));
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const step = 10 ** Math.floor(Math.log10(Math.max(hi - lo, 1)));
    const base = Math.max(0, Math.floor((lo - (hi - lo) * 0.1) / step) * step);
    for (const r of rows) for (const { key } of keys) r[key] = Number(r[key]) - base;
    return { data: rows, floor: base };
  }, [dates, keys]);
  const money = (v: number) => formatCompactInr(v + floor);
  const ending = useMemo(() => {
    const last = data[data.length - 1];
    return Object.fromEntries(keys.map(({ key }) => [key, Number(last?.[key] ?? 0) + floor]));
  }, [data, keys, floor]);
  const config = useMemo(
    () => seriesConfig(lastOnTop(keys, leaderId(keys)), paletteFor(keys)),
    [keys],
  );

  if (!keys.length || !data.length) {
    return <p className="chart-empty">No NAV series to plot.</p>;
  }

  return (
    <DitherPlot config={config} height="h-[260px]" ending={ending}>
      <LineChart data={data} config={config} margins={{ left: 48 }}>
        <XAxis dataKey="date" maxTicks={6} tickFormatter={(v) => formatTick(String(v))} />
        <YAxis tickFormatter={money} />
        <Tooltip labelKey="label" valueFormatter={money} />
        {keys.map(({ key, result }) => (
          <Line
            key={key}
            dataKey={key}
            strokeVariant={result.basketId === BEES_ID ? "dashed" : "solid"}
          />
        ))}
      </LineChart>
    </DitherPlot>
  );
}

export function DrawdownChart({ results, baskets }: LabChartsProps) {
  const { keys, dates } = useMemo(() => chartable(results, baskets), [results, baskets]);
  const data = useMemo(
    () => seriesRows(dates, keys, (p) => Number(p.drawdown.toFixed(2))),
    [dates, keys],
  );
  const worstId = useMemo(() => {
    let worst: { id: string; mdd: number } | null = null;
    for (const { result } of keys) {
      if (!worst || result.stats.mdd < worst.mdd) {
        worst = { id: result.basketId, mdd: result.stats.mdd };
      }
    }
    return worst?.id;
  }, [keys]);
  const config = useMemo(() => {
    const color = paletteFor(keys);
    return seriesConfig(lastOnTop(keys, worstId), (id) => (id === worstId ? "red" : color(id)));
  }, [keys, worstId]);

  if (!keys.length || !data.length) {
    return <p className="chart-empty">No drawdown series to plot.</p>;
  }

  return (
    <DitherPlot config={config} height="h-[180px]">
      <LineChart data={data} config={config} margins={{ left: 40 }}>
        <XAxis dataKey="date" maxTicks={8} tickFormatter={(v) => formatTick(String(v))} />
        <YAxis tickFormatter={(v) => (Math.abs(v) < 0.05 ? "0%" : `${v.toFixed(0)}%`)} />
        <Tooltip labelKey="label" valueFormatter={(v) => formatPctValue(v)} />
        {keys.map(({ key }) => (
          <Line key={key} dataKey={key} />
        ))}
      </LineChart>
    </DitherPlot>
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
};

const MIX_COLORS: DitherColor[] = ["blue", "purple", "green", "orange"];

function shortLabel(cat: string): string {
  return cat.length > 17 ? `${cat.slice(0, 16)}…` : cat;
}

export function MixCompareChart({ series, categories }: MixCompareProps) {
  const cats = categories.filter((cat) => series.some((s) => (s.values[cat] ?? 0) >= 0.5));
  if (!series.length || !cats.length) {
    return <p className="chart-empty">No mix to plot.</p>;
  }
  // One or two categories (asset, equity split) read better as meters than as
  // a wall of dither.
  if (cats.length < 3) return <MixMeters series={series} categories={cats} />;
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: MIX_COLORS[i % MIX_COLORS.length]! }]),
  );
  const data = cats.map((cat) => ({
    cat,
    ...Object.fromEntries(series.map((s) => [s.key, Number((s.values[cat] ?? 0).toFixed(1))])),
  }));
  return (
    <div className="flex flex-col gap-2">
      <div className="h-[200px]">
        <BarChart data={data} config={config} margins={{ left: 36 }}>
          <XAxis dataKey="cat" maxTicks={12} tickFormatter={(v) => shortLabel(String(v))} />
          <YAxis tickFormatter={(v) => `${v}%`} />
          <Tooltip labelKey="cat" valueFormatter={(v) => `${v.toFixed(1)}%`} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} variant="gradient" />
          ))}
        </BarChart>
      </div>
      {series.length > 1 ? <BlockLegend config={config} /> : null}
    </div>
  );
}

function MixMeters({ series, categories }: MixCompareProps) {
  return (
    <div className="mix-strips">
      {series.map((s) => (
        <div key={s.key} className="mix-strip">
          {series.length > 1 ? <p className="mix-strip-name">{s.label}</p> : null}
          <ul className="mix-meters" aria-label={`${s.label} mix`}>
            {categories.map((cat) => {
              const w = s.values[cat] ?? 0;
              return (
                <li key={cat}>
                  <span className="mix-meter-row">
                    <span>{cat}</span>
                    <span className="alloc-pct">{w.toFixed(0)}%</span>
                  </span>
                  <span className="alloc-track">
                    <span style={{ width: `${Math.min(100, Math.max(0, w))}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
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
