import { useMemo, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatFullDate,
  formatPctValue,
  formatTick,
  type MixSeries,
} from "./chartFormat";

const INK = "var(--ink)";
const MUTED = "var(--ink-soft)";
const GRID = "color-mix(in srgb, var(--ink) 12%, transparent)";

const PART_COLORS = [
  "#0d7480",
  "#3d6b8a",
  "#c4a35a",
  "#b54a42",
  "#5a8f8a",
  "#8a6b4a",
  "#1f3038",
  "#5d6b72",
  "#2c6e49",
  "#a15c38",
  "#4a6fa5",
];

function tickStyle(size = 12) {
  return { fill: MUTED, fontSize: size, fontFamily: "inherit" };
}

function FrostTooltip({
  active,
  payload,
  label,
  formatLabel,
  formatValue,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string }>;
  label?: string | number;
  formatLabel?: (label: string) => ReactNode;
  formatValue?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="lab-tooltip">
      <p className="lab-tooltip-label">
        {formatLabel ? formatLabel(String(label ?? "")) : String(label ?? "")}
      </p>
      {payload.map((item) => {
        const n = typeof item.value === "number" ? item.value : Number(item.value);
        const text = Number.isFinite(n)
          ? formatValue
            ? formatValue(n)
            : String(item.value)
          : "—";
        return (
          <p key={String(item.dataKey ?? item.name)} className="lab-tooltip-row">
            <span className="lab-tooltip-swatch" style={{ background: item.color }} />
            <span>{item.name}</span>
            <span className="lab-tooltip-value">{text}</span>
          </p>
        );
      })}
    </div>
  );
}

type LineSeries = {
  key: string;
  label: string;
  color: string;
};

export function DrawdownLineChart({
  data,
  series,
}: {
  data: Array<Record<string, string | number | null>>;
  series: LineSeries[];
}) {
  if (!data.length || !series.length) {
    return <p className="chart-empty">No drawdown series to plot.</p>;
  }
  return (
    <div className="lab-plot lab-plot--line">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tick={tickStyle()}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tickFormatter={(v) => formatTick(String(v))}
          />
          <YAxis
            domain={["dataMin", 0]}
            tick={tickStyle()}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v) => {
              const n = Number(v);
              if (!Number.isFinite(n) || Math.abs(n) < 0.05) return "0%";
              return `${n.toFixed(0)}%`;
            }}
          />
          <ReferenceLine y={0} stroke={INK} strokeOpacity={0.28} />
          <Tooltip
            content={
              <FrostTooltip
                formatLabel={(label) => formatFullDate(label)}
                formatValue={formatPctValue}
              />
            }
          />
          <Legend
            verticalAlign="bottom"
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: INK, paddingTop: 8 }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MixStackChart({
  series,
  categories,
}: {
  series: MixSeries[];
  categories: string[];
}) {
  const data = useMemo(
    () =>
      series.map((s) => {
        const row: Record<string, string | number> = { name: s.label };
        for (const cat of categories) row[cat] = s.values[cat] ?? 0;
        return row;
      }),
    [series, categories],
  );

  if (!series.length || !categories.length) return null;

  const height = Math.min(280, Math.max(140, series.length * 56 + 72));

  return (
    <div className="lab-plot" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
          barCategoryGap="28%"
        >
          <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis
            type="number"
            tick={tickStyle()}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={108}
            tick={tickStyle()}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<FrostTooltip formatValue={formatPctValue} />} />
          <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, color: INK }} />
          {categories.map((cat, i) => (
            <Bar
              key={cat}
              dataKey={cat}
              name={cat}
              stackId="mix"
              fill={PART_COLORS[i % PART_COLORS.length]}
              maxBarSize={28}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RiskRadarChart({
  metrics,
  series,
}: {
  metrics: { key: string; label: string }[];
  series: Array<{
    key: string;
    label: string;
    color: string;
    values: Record<string, number | null>;
  }>;
}) {
  const data = useMemo(
    () =>
      metrics.map((m) => {
        const row: Record<string, string | number> = { metric: m.label };
        for (const s of series) {
          const n = s.values[m.key];
          if (n != null) row[s.key] = Number(n.toFixed(2));
        }
        return row;
      }),
    [metrics, series],
  );

  if (!series.length || !metrics.length) return null;
  if (data.every((row) => series.every((s) => row[s.key] == null))) return null;

  return (
    <div className="lab-plot lab-plot--radar">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke={GRID} />
          <PolarAngleAxis dataKey="metric" tick={tickStyle()} />
          <PolarRadiusAxis tick={false} axisLine={false} />
          <Tooltip content={<FrostTooltip />} />
          <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, color: INK }} />
          {series.map((s) => (
            <Radar
              key={s.key}
              name={s.label}
              dataKey={s.key}
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.12}
              strokeWidth={2}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HoldingsBarChart({
  items,
}: {
  items: Array<{ name: string; weight: number; color: string }>;
}) {
  if (!items.length) return null;
  const data = items.map((item) => ({ name: item.name, weight: item.weight, fill: item.color }));
  const height = Math.min(360, Math.max(140, items.length * 28 + 48));

  return (
    <div className="lab-plot" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 12, bottom: 4, left: 8 }}
        >
          <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis
            type="number"
            tick={tickStyle()}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={128}
            tick={tickStyle(11)}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<FrostTooltip formatValue={formatPctValue} />} />
          <Bar dataKey="weight" name="Weight" maxBarSize={16} radius={[0, 4, 4, 0]}>
            {data.map((row) => (
              <Cell key={row.name} fill={row.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
