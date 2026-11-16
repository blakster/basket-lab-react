import { useMemo, type ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
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
import { formatCompactInr } from "../lib/format";
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
  "#121212",
  "#6b6b6b",
  "#5e5e5e",
  "#b33a2b",
  "#8a8a8a",
  "#3a3a3a",
  "#f5c400",
  "#9a9a9a",
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
  hideZero,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string }>;
  label?: string | number;
  formatLabel?: (label: string) => ReactNode;
  formatValue?: (value: number) => string;
  hideZero?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const rows = hideZero
    ? payload.filter((item) => {
        const n = typeof item.value === "number" ? item.value : Number(item.value);
        return Number.isFinite(n) && n !== 0;
      })
    : payload;
  if (!rows.length) return null;
  return (
    <div className="lab-tooltip">
      <p className="lab-tooltip-label">
        {formatLabel ? formatLabel(String(label ?? "")) : String(label ?? "")}
      </p>
      {rows.map((item) => {
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

type PathSeries = LineSeries & {
  dashed?: boolean;
  lead?: boolean;
};

export function GrowthPathChart({
  data,
  series,
  startAmount,
}: {
  data: Array<Record<string, string | number | null>>;
  series: PathSeries[];
  startAmount: number;
}) {
  const plot = useMemo(() => {
    const values: number[] = [startAmount];
    for (const row of data) {
      for (const s of series) {
        const n = row[s.key];
        if (typeof n === "number" && Number.isFinite(n)) values.push(n);
      }
    }
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.08 || 1;
    const min = lo - pad;
    const max = hi + pad;
    return { min, max };
  }, [data, series, startAmount]);

  if (!data.length || !series.length) {
    return <p className="chart-empty">No NAV series to plot.</p>;
  }

  const W = 1000;
  const H = 240;
  const L = 52;
  const R = 12;
  const T = 12;
  const B = 28;
  const innerW = W - L - R;
  const innerH = H - T - B;
  const n = Math.max(data.length - 1, 1);
  const xAt = (i: number) => L + (i / n) * innerW;
  const yAt = (v: number) =>
    T + ((plot.max - v) / (plot.max - plot.min || 1)) * innerH;

  const lastIdx = data.length - 1;
  const ticks = [plot.min, startAmount, plot.max];
  const xLabels = [0, Math.round(n / 2), lastIdx];

  return (
    <div className="path-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="path-chart-svg"
        role="img"
        aria-label="Growth of each basket"
      >
        <line
          x1={L}
          y1={yAt(startAmount)}
          x2={L + innerW}
          y2={yAt(startAmount)}
          stroke="var(--plate)"
          strokeWidth="1.25"
        />
        {ticks.map((t) => (
          <text
            key={`y-${t}`}
            x={L - 8}
            y={yAt(t) + 4}
            textAnchor="end"
            fill="var(--ink-soft)"
            fontSize="11"
            fontFamily="IBM Plex Mono, ui-monospace, monospace"
          >
            {formatCompactInr(t)}
          </text>
        ))}
        {series.map((s) => {
          const pts: string[] = [];
          data.forEach((row, i) => {
            const n = row[s.key];
            if (typeof n !== "number" || !Number.isFinite(n)) return;
            pts.push(`${xAt(i).toFixed(1)},${yAt(n).toFixed(1)}`);
          });
          if (pts.length < 2) return null;
          return (
            <polyline
              key={s.key}
              fill="none"
              points={pts.join(" ")}
              stroke={s.lead ? "var(--ink)" : s.color}
              strokeWidth={s.lead ? 2.4 : 1.4}
              strokeDasharray={s.dashed ? "6 5" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {series.map((s) => {
          const last = data[lastIdx]?.[s.key];
          if (typeof last !== "number" || !Number.isFinite(last)) return null;
          return (
            <circle
              key={`${s.key}-end`}
              cx={xAt(lastIdx)}
              cy={yAt(last)}
              r={s.lead ? 4 : 2.5}
              fill={s.lead ? "var(--plate)" : s.color}
              stroke="var(--paper)"
              strokeWidth="1.25"
            />
          );
        })}
        {xLabels.map((i) => (
          <text
            key={`x-${i}`}
            x={xAt(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === lastIdx ? "end" : "middle"}
            fill="var(--ink-soft)"
            fontSize="11"
            fontFamily="IBM Plex Sans, system-ui, sans-serif"
          >
            {formatTick(String(data[i]?.date ?? ""))}
          </text>
        ))}
      </svg>
      <ul className="path-legend">
        {series.map((s) => {
          const last = data[lastIdx]?.[s.key];
          return (
            <li key={s.key} className={s.lead ? "is-lead" : s.dashed ? "is-ref" : undefined}>
              <i style={{ background: s.lead ? "var(--plate)" : s.color }} />
              {s.label}
              {typeof last === "number" ? ` ${formatCompactInr(last)}` : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DrawdownLineChart({
  data,
  series,
  worstKey,
}: {
  data: Array<Record<string, string | number | null>>;
  series: LineSeries[];
  worstKey?: string;
}) {
  if (!data.length || !series.length) {
    return <p className="chart-empty">No drawdown series to plot.</p>;
  }
  return (
    <div className="lab-plot lab-plot--drawdown">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="0" />
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
          <ReferenceLine y={0} stroke={INK} strokeOpacity={0.35} />
          <Tooltip
            content={
              <FrostTooltip
                formatLabel={(label) => formatFullDate(label)}
                formatValue={formatPctValue}
              />
            }
          />
          {worstKey ? (
            <Area
              type="monotone"
              dataKey={worstKey}
              fill="var(--loss)"
              fillOpacity={0.16}
              stroke="none"
              connectNulls
              legendType="none"
              tooltipType="none"
            />
          ) : null}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.key === worstKey ? "var(--loss)" : s.color}
              strokeWidth={s.key === worstKey ? 2.2 : 1.4}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MixStripChart({
  series,
  categories,
}: {
  series: MixSeries[];
  categories: string[];
}) {
  if (!series.length || !categories.length) {
    return <p className="chart-empty">No mix to plot.</p>;
  }
  return (
    <div className="mix-strips">
      {series.map((s) => {
        const rows = categories
          .map((cat) => ({ cat, w: s.values[cat] ?? 0 }))
          .filter((row) => row.w >= 0.5)
          .sort((a, b) => b.w - a.w);
        if (!rows.length) return null;
        return (
          <div key={s.key} className="mix-strip">
            {series.length > 1 ? (
              <p className="mix-strip-name">{s.label}</p>
            ) : null}
            <ul className="mix-meters" aria-label={`${s.label} mix`}>
              {rows.map((row) => (
                <li key={row.cat}>
                  <span className="mix-meter-row">
                    <span>{row.cat}</span>
                    <span className="alloc-pct">{row.w.toFixed(0)}%</span>
                  </span>
                  <span className="alloc-track">
                    <span
                      style={{ width: `${Math.min(100, Math.max(0, row.w))}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
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

  const legendRows = Math.max(1, Math.ceil(categories.length / 3));
  const height = Math.min(360, Math.max(168, series.length * 52 + 48 + legendRows * 22));

  return (
    <div className="lab-plot lab-plot--mix" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 12, bottom: 10 + legendRows * 18, left: 8 }}
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
          <Tooltip
            content={<FrostTooltip formatValue={formatPctValue} hideZero />}
            cursor={{ fill: "color-mix(in srgb, var(--ink) 6%, transparent)" }}
            offset={16}
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 8, pointerEvents: "none" }}
            isAnimationActive={false}
          />
          <Legend
            verticalAlign="bottom"
            wrapperStyle={{ fontSize: 12, color: INK, paddingTop: 4 }}
          />
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
