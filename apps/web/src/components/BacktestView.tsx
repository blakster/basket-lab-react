import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { useEffect } from "react";
import { Line } from "react-chartjs-2";
import { useLab } from "../state/LabContext";
import type { BacktestResult, Basket } from "../types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

const DEBOUNCE_MS = 300;

function formatInr(n: number): string {
  return `₹${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(n)}`;
}

function formatPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function unionLabels(results: BacktestResult[]): string[] {
  const dates = new Set<string>();
  for (const r of results) {
    for (const p of r.series) dates.add(p.x);
  }
  return [...dates].sort();
}

function lineDatasets(
  results: BacktestResult[],
  baskets: Basket[],
  labels: string[],
  pick: "y" | "drawdown",
) {
  const byId = new Map(baskets.map((b) => [b.id, b]));
  return results.map((r) => {
    const basket = byId.get(r.basketId);
    const byDate = new Map(r.series.map((p) => [p.x, p]));
    return {
      label: basket?.name ?? r.basketId,
      data: labels.map((x) => {
        const p = byDate.get(x);
        return p ? p[pick] : null;
      }),
      borderColor: basket?.color ?? "#18181b",
      backgroundColor: basket?.color ?? "#18181b",
      pointRadius: 0,
      borderWidth: 1.75,
      tension: 0.15,
      spanGaps: true,
    };
  });
}

export function BacktestView() {
  const { baskets, results, runAnalysis } = useLab();

  useEffect(() => {
    const t = window.setTimeout(() => {
      void runAnalysis();
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [runAnalysis]);

  const labels = unionLabels(results);
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: { legend: { position: "bottom" as const } },
    scales: {
      x: { ticks: { maxTicksLimit: 8 } },
    },
  };

  return (
    <section className="backtest-view">
      <h2>Performance</h2>
      <table className="backtest-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Invested</th>
            <th>Current</th>
            <th>Abs</th>
            <th>CAGR/XIRR</th>
            <th>Max Drawdown</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const basket = baskets.find((b) => b.id === r.basketId);
            const name = basket?.name ?? r.basketId;
            if (r.error === "no-nav") {
              return (
                <tr key={r.basketId}>
                  <td>{name}</td>
                  <td>No NAV</td>
                  <td>No NAV</td>
                  <td>No NAV</td>
                  <td>No NAV</td>
                  <td>No NAV</td>
                </tr>
              );
            }
            return (
              <tr key={r.basketId}>
                <td>
                  <span
                    className="basket-swatch"
                    style={{ background: basket?.color ?? "#18181b" }}
                  />{" "}
                  {name}
                </td>
                <td>{formatInr(r.stats.initial)}</td>
                <td>{formatInr(r.stats.final)}</td>
                <td>{formatPct(r.stats.abs)}</td>
                <td>{formatPct(r.stats.cagr)}</td>
                <td>{formatPct(r.stats.mdd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="backtest-charts">
        <figure className="backtest-chart">
          <figcaption>Portfolio value</figcaption>
          <Line
            data={{
              labels,
              datasets: lineDatasets(results, baskets, labels, "y"),
            }}
            options={chartOptions}
          />
        </figure>
        <figure className="backtest-chart">
          <figcaption>Drawdown</figcaption>
          <Line
            data={{
              labels,
              datasets: lineDatasets(results, baskets, labels, "drawdown"),
            }}
            options={chartOptions}
          />
        </figure>
      </div>
    </section>
  );
}
