import { useMemo, type ReactNode } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactInr, formatInr } from "../lib/format";
import {
  formatFullDate,
  formatPctValue,
  formatTick,
  type MixSeries,
} from "./chartFormat";

const INK = "var(--ink)";
const MUTED = "var(--ink-soft)";
const GRID = "color-mix(in srgb, var(--ink) 12%, transparent)";

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
  ariaLabel = "Growth over time",
}: {
  data: Array<Record<string, string | number | null>>;
  series: PathSeries[];
  startAmount: number;
  ariaLabel?: string;
}) {
  const domain = useMemo(() => {
    const values: number[] = [];
    if (Number.isFinite(startAmount) && startAmount > 0) values.push(startAmount);
    for (const row of data) {
      for (const s of series) {
        const n = row[s.key];
        if (typeof n === "number" && Number.isFinite(n)) values.push(n);
      }
    }
    if (!values.length) return [0, 1] as const;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.08 || Math.max(Math.abs(hi) * 0.08, 1);
    return [Math.max(0, lo - pad), hi + pad] as const;
  }, [data, series, startAmount]);

  if (!data.length || !series.length) {
    return <p className="chart-empty">No NAV series to plot.</p>;
  }

  const lastIdx = data.length - 1;

  return (
    <div className="path-chart" role="region" aria-label={ariaLabel}>
      <div className="lab-plot lab-plot--growth">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="0" />
            <XAxis
              dataKey="date"
              tick={tickStyle()}
              tickLine={false}
              axisLine={false}
              minTickGap={36}
              tickFormatter={(v) => formatTick(String(v))}
            />
            <YAxis
              domain={[domain[0], domain[1]]}
              tick={tickStyle(11)}
              tickLine={false}
              axisLine={false}
              width={60}
              tickFormatter={(v) => formatCompactInr(Number(v))}
            />
            {Number.isFinite(startAmount) && startAmount > 0 && (
              <ReferenceLine
                y={startAmount}
                stroke={INK}
                strokeOpacity={0.28}
                strokeDasharray="4 4"
              />
            )}
            <Tooltip
              content={
                <FrostTooltip
                  formatLabel={(label) => formatFullDate(label)}
                  formatValue={(v) => formatInr(v)}
                />
              }
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.lead ? INK : s.color}
                strokeWidth={s.lead ? 2.4 : 1.5}
                strokeDasharray={s.dashed ? "6 5" : undefined}
                dot={false}
                activeDot={{ r: s.lead ? 4.5 : 3.5, strokeWidth: 0 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="path-legend">
        {series.map((s) => {
          const last = data[lastIdx]?.[s.key];
          return (
            <li key={s.key} className={s.lead ? "is-lead" : s.dashed ? "is-ref" : undefined}>
              <i style={{ background: s.lead ? "var(--ink)" : s.color }} />
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

