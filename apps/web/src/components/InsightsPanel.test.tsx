import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightsResponse } from "../lib/api/insights";
import type { Basket, BacktestResult } from "../types";
import { InsightsPanel } from "./InsightsPanel";

const { postInsightsMock, labState } = vi.hoisted(() => ({
  postInsightsMock: vi.fn(),
  labState: {
    baskets: [] as Basket[],
    results: [] as BacktestResult[],
    reportStatus: vi.fn(),
  },
}));

vi.mock("../lib/api/insights", () => ({
  insightsBasketSignature: () => "sig",
  postInsights: (...args: unknown[]) => postInsightsMock(...args),
}));

vi.mock("../state/LabContext", () => ({
  useLab: () => labState,
}));

const basket: Basket = {
  id: "1",
  name: "Core",
  color: "#000",
  active: true,
  funds: [
    { schemeCode: "A", schemeName: "Fund A", isin: null, weight: 100, locked: false },
  ],
};

const emptyFiling: InsightsResponse = {
  asOf: "2026-07-31",
  overlap: null,
  baskets: [
    {
      id: "1",
      missingSchemes: ["A"],
      holdings: [],
      sector: {},
      asset: {},
      credit: null,
      creditNote: "N/A — no debt holdings",
      equitySplit: { large: 0, mid: 0, small: 0, unclassified: 0 },
      expenseRatio: null,
      expenseIncomplete: true,
      pe: null,
      peIncomplete: true,
    },
  ],
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InsightsPanel />
    </QueryClientProvider>,
  );
}

describe("InsightsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    postInsightsMock.mockReset();
    labState.reportStatus.mockReset();
    labState.baskets = [basket];
    labState.results = [];
  });

  it("does not render 0.00% equity buckets when filings are missing", async () => {
    postInsightsMock.mockResolvedValue(emptyFiling);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("No AMFI filing")).toBeInTheDocument();
    });
    expect(screen.queryByText("0.00%")).toBeNull();
    expect(screen.queryByText("Large")).toBeNull();
  });

  it("shows Sharpe from NAV series when insights fail", async () => {
    postInsightsMock.mockRejectedValue(new Error("down"));
    labState.results = [
      {
        basketId: "1",
        series: [
          { x: "2023-01-01", y: 100, drawdown: 0 },
          { x: "2023-01-02", y: 101, drawdown: 0 },
          { x: "2023-01-03", y: 103, drawdown: 0 },
          { x: "2023-01-04", y: 106, drawdown: 0 },
        ],
        stats: { initial: 100, final: 106, abs: 6, cagr: 6, mdd: 0 },
      },
    ];
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Insights unavailable")).toBeInTheDocument();
    });
    const sharpeCard = screen.getByText("Sharpe").closest("article");
    expect(sharpeCard).toBeTruthy();
    expect(sharpeCard!.textContent).toMatch(/-?\d+\.\d{2}/);
  });
});
