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
import { formatCompactInr } from "../lib/format";
import {
  formatFullDate,
  formatPctValue,
  formatTick,
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
