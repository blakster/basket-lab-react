import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BacktestResult, Basket, LabSettings, NavPoint } from "../types";
import { BacktestView } from "./BacktestView";

const { labState, loadBeesMock } = vi.hoisted(() => ({
  labState: {
    baskets: [] as Basket[],
    results: [] as BacktestResult[],
    navByCode: {} as Record<string, NavPoint[]>,
    analyzing: false,
    runAnalysis: vi.fn(),
    settings: {
      mode: "lumpsum",
      amount: 100_000,
      period: "3Y",
      customStart: null,
      customEnd: null,
    } as LabSettings,
  },
  loadBeesMock: vi.fn(),
}));

vi.mock("../state/LabContext", () => ({
  useLab: () => labState,
}));

vi.mock("../lib/api/benchmarkNav", () => ({
  NIFTY_BEES_CODE: "140084",
  loadNiftyBeesNav: (...args: unknown[]) => loadBeesMock(...args),
}));

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BacktestView />
    </QueryClientProvider>,
  );
}

vi.mock("./LabCharts", () => ({
  GrowthChart: () => null,
  DrawdownChart: () => null,
  YearlyRankingChart: () => null,
}));

const basket: Basket = {
  id: "1",
  name: "Flexi Cap",
  color: "#0B7A3B",
  active: true,
  funds: [
    {
      schemeCode: "122639",
      schemeName: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
      isin: null,
      weight: 100,
      locked: false,
    },
  ],
};

describe("BacktestView table", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    loadBeesMock.mockReset();
    loadBeesMock.mockResolvedValue([] as NavPoint[]);
  });

  it("shows invested and current as Indian-rupee amounts", () => {
    labState.baskets = [basket];
    labState.results = [
      {
        basketId: "1",
        series: [
          { x: "2023-01-01", y: 100000, drawdown: 0 },
          { x: "2026-01-01", y: 3995626.53, drawdown: -6 },
        ],
        stats: {
          initial: 3600000,
          final: 3995626.53,
          abs: 10.99,
          cagr: 10.99,
          mdd: -6,
        },
      },
    ];

    renderView();

    expect(screen.getByText("10.99%")).toBeInTheDocument();
    expect(screen.getByText("₹39,95,626.53")).toBeInTheDocument();
    expect(screen.queryByText("₹3,600,000")).toBeNull();
    expect(screen.queryByText("₹100,000")).toBeNull();
  });

  it("does not stay in Recalculating when NAV starts after the requested date", () => {
    labState.settings = {
      mode: "lumpsum",
      amount: 100_000,
      period: "Custom",
      customStart: "2023-01-01",
      customEnd: "2024-01-01",
    };
    labState.analyzing = false;
    labState.baskets = [basket];
    labState.results = [
      {
        basketId: "1",
        series: [
          { x: "2023-07-01", y: 100000, drawdown: 0 },
          { x: "2024-01-01", y: 120000, drawdown: 0 },
        ],
        cashflow: {
          mode: "lumpsum",
          amount: 100_000,
          startIso: "2023-07-01",
          requestedStartIso: "2023-01-01",
        },
        stats: {
          initial: 100000,
          final: 120000,
          abs: 20,
          cagr: 44,
          mdd: 0,
        },
      },
    ];

    renderView();

    expect(screen.queryByText(/Recalculating/)).toBeNull();
    expect(screen.getByText(/from 01 Jul 2023/)).toBeInTheDocument();
    expect(screen.getByText("₹1,20,000")).toBeInTheDocument();
  });

  it("shows vs BeES excess and names a laggard", async () => {
    loadBeesMock.mockResolvedValue([
      { date: "2023-01-01", nav: 100 },
      { date: "2024-01-01", nav: 200 },
    ]);
    labState.settings = {
      mode: "lumpsum",
      amount: 100_000,
      period: "Custom",
      customStart: "2023-01-01",
      customEnd: "2024-01-01",
    };
    labState.analyzing = false;
    labState.baskets = [basket];
    labState.results = [
      {
        basketId: "1",
        series: [
          { x: "2023-01-01", y: 100000, drawdown: 0 },
          { x: "2024-01-01", y: 110000, drawdown: 0 },
        ],
        stats: {
          initial: 100000,
          final: 110000,
          abs: 10,
          cagr: 10,
          mdd: 0,
        },
      },
    ];

    renderView();

    expect(screen.getByText("vs BeES")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Flexi Cap trails Nifty BeES")).toBeInTheDocument();
    });
    expect(screen.getByText("-90.00%")).toBeInTheDocument();
  });
});
