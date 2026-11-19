import {
  dailyTwrs,
  sharpeFromTwrs,
  sortinoFromTwrs,
  volatilityFromTwrs,
  type CashflowSpec,
  type DatedReturn,
} from "../risk";
import type { BacktestResult } from "../../types";

/**
 * Registry of the backtest metrics the result tables render.
 *
 * One definition per metric: how it is labelled, computed from a
 * `BacktestResult`, formatted, and coloured. Tables look metrics up by id
 * (`METRICS[id]`) or iterate `METRIC_ORDER` instead of re-deriving numbers
 * and labels locally, so a metric reads the same in every table.
 */

export type MetricId = "rate" | "mdd" | "vol" | "sharpe" | "sortino";

/** What a metric needs beyond the result itself (SIP cashflow for TWR). */
export type MetricContext = {
  /** Defaults to `result.cashflow`; pass the run's cashflow when missing. */
  cashflow?: CashflowSpec;
  /** Precomputed daily TWRs; computed from the series when omitted. */
  twrs?: DatedReturn[];
  /** Risk-free annual rate as a decimal for Sharpe/Sortino (0 = raw). */
  rfAnnual?: number;
};

export type MetricTone = "gain" | "loss" | "flat";

export type MetricDef = {
  id: MetricId;
  /** Column header; `rate` switches CAGR/XIRR on the result's cashflow mode. */
  label: string | ((result: BacktestResult) => string);
  compute: (result: BacktestResult, ctx: MetricContext) => number | null;
  format: (value: number) => string;
  /** Sign-based colour for the rendered value. */
  tone: (value: number) => MetricTone;
};

export function formatMetricPct(n: number): string {
  const text = n.toFixed(2);
  return `${text === "-0.00" ? "0.00" : text}%`;
}

export function formatMetricRatio(n: number): string {
  const text = n.toFixed(2);
  return text === "-0.00" ? "0.00" : text;
}

const signTone: (v: number) => MetricTone = (v) =>
  v > 0 ? "gain" : v < 0 ? "loss" : "flat";

function twrsOf(result: BacktestResult, ctx: MetricContext): number[] {
  const twrs =
    ctx.twrs ?? dailyTwrs(result.series, ctx.cashflow ?? result.cashflow);
  return twrs.map((d) => d.r);
}

export const METRICS: Record<MetricId, MetricDef> = {
  rate: {
    id: "rate",
    // `stats.cagr` holds XIRR when the run's cashflow is a SIP.
    label: (r) => (r.cashflow?.mode === "sip" ? "XIRR" : "CAGR"),
    compute: (r) => r.stats.cagr,
    format: formatMetricPct,
    tone: signTone,
  },
  mdd: {
    id: "mdd",
    label: "Max DD",
    compute: (r) => r.stats.mdd,
    format: formatMetricPct,
    // A drawdown is a loss by construction; 0 means never off the peak.
    tone: (v) => (v < 0 ? "loss" : "flat"),
  },
  vol: {
    id: "vol",
    label: "Vol",
    compute: (r, ctx) => volatilityFromTwrs(twrsOf(r, ctx)),
    format: formatMetricPct,
    tone: () => "flat",
  },
  sharpe: {
    id: "sharpe",
    label: "Sharpe",
    compute: (r, ctx) => sharpeFromTwrs(twrsOf(r, ctx), ctx.rfAnnual ?? 0),
    format: formatMetricRatio,
    tone: signTone,
  },
  sortino: {
    id: "sortino",
    label: "Sortino",
    compute: (r, ctx) => sortinoFromTwrs(twrsOf(r, ctx), ctx.rfAnnual ?? 0),
    format: formatMetricRatio,
    tone: signTone,
  },
};

/** Display order for tables that render the whole set. */
export const METRIC_ORDER: MetricId[] = [
  "rate",
  "mdd",
  "vol",
  "sharpe",
  "sortino",
];

/** All metrics for one result, in `METRIC_ORDER`, `null` where undefined. */
export function computeMetrics(
  result: BacktestResult,
  ctx: MetricContext = {},
): Record<MetricId, number | null> {
  const out = {} as Record<MetricId, number | null>;
  for (const id of METRIC_ORDER) out[id] = METRICS[id].compute(result, ctx);
  return out;
}

/** Resolved label; `result` is only needed for `rate` (CAGR vs XIRR). */
export function metricLabel(id: MetricId, result?: BacktestResult): string {
  const label = METRICS[id].label;
  return typeof label === "function"
    ? result
      ? label(result)
      : "Rate"
    : label;
}

/** `num-gain` / `num-loss` class for a metric value, or `num-empty` for null. */
export function metricClass(id: MetricId, value: number | null): string {
  if (value == null) return "num-empty";
  const tone = METRICS[id].tone(value);
  return tone === "gain" ? "num-gain" : tone === "loss" ? "num-loss" : "";
}

/** Rendered cell text, `—` when the metric is undefined. */
export function metricText(id: MetricId, value: number | null): string {
  return value == null ? "—" : METRICS[id].format(value);
}
