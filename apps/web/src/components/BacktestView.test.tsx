import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benchmarkForResult } from "../lib/portfolioDetails";
import { cagr } from "../lib/backtest/performance";
import type { BacktestResult, Basket, LabSettings, NavPoint } from "../types";
import { BacktestView } from "./BacktestView";

const { labState, loadBeesMock } = vi.hoisted(() => ({
  labState: {
    baskets: [] as Basket[],
    results: [] as BacktestResult[],
    navByCode: {} as Record<string, NavPoint[]>,
    analyzing: false,
    runAnalysis: vi.fn(),
    setWorkspace: vi.fn(),
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

  it("offers basket activation rather than an empty run or charts", () => {
    labState.baskets = [{ ...basket, active: false }];
    labState.results = [];
    labState.analyzing = false;
    renderView();
    expect(screen.getByText("No active baskets")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose baskets" }));
    expect(labState.setWorkspace).toHaveBeenCalledWith("baskets");
    expect(
      screen.queryByText("Same basket, different cashflows"),
    ).not.toBeInTheDocument();
  });

  it("names the inverted Custom dates instead of blaming NAV", () => {
    labState.settings = {
      mode: "lumpsum",
      amount: 100_000,
      period: "Custom",
      customStart: "2025-12-31",
      customEnd: "2020-01-01",
    };
    labState.baskets = [basket];
    labState.results = [];
    labState.analyzing = false;
    renderView();
    expect(screen.getByText(/is after End/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Try again when the data source/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry NAV" }),
    ).not.toBeInTheDocument();
  });

  it("keeps missing NAV values unavailable and offers retry", () => {
    labState.baskets = [basket];
    labState.results = [
      {
        basketId: basket.id,
        error: "no-nav",
        series: [],
        stats: { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 },
      },
    ];
    labState.analyzing = false;
    renderView();
    expect(
      screen.getByLabelText("Current value unavailable"),
    ).toHaveTextContent("—");
    fireEvent.click(screen.getByRole("button", { name: "Retry NAV" }));
    expect(labState.runAnalysis).toHaveBeenCalled();
    expect(screen.queryByText("₹1,00,000")).not.toBeInTheDocument();
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
      expect(
        screen.getByText("Flexi Cap trails Nifty BeES"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("-90.00%")).toBeInTheDocument();
  });

  it("aligns BeES to the basket's effective start", async () => {
    loadBeesMock.mockResolvedValue([
      { date: "2023-01-01", nav: 100 },
      { date: "2023-07-01", nav: 100 },
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
          { x: "2023-07-01", y: 100000, drawdown: 0 },
          { x: "2024-01-01", y: 120000, drawdown: 0 },
        ],
        cashflow: {
          mode: "lumpsum",
          amount: 100_000,
          startIso: "2023-07-01",
          requestedStartIso: "2023-01-01",
        },
        stats: { initial: 100000, final: 120000, abs: 20, cagr: 44, mdd: 0 },
      },
    ];

    renderView();

    const years =
      (new Date("2024-01-01T00:00:00").getTime() -
        new Date("2023-07-01T00:00:00").getTime()) /
      (365 * 86400000);
    const aligned = cagr(100_000, 200_000, years);
    await waitFor(() => {
      expect(screen.getByText(`${aligned.toFixed(2)}%`)).toBeInTheDocument();
    });
    // Reference row ends at 2× the amount from the basket's start, not
    // from the window start.
    expect(screen.getByText("₹2,00,000")).toBeInTheDocument();
    expect(
      screen.getByText(`${(44 - aligned).toFixed(2)}%`),
    ).toBeInTheDocument();
    // Window-start BeES CAGR (100%) is not used.
    expect(screen.queryByText("100.00%")).toBeNull();
  });

  it("compares SIP XIRR to BeES XIRR on the same schedule", async () => {
    const bees: NavPoint[] = Array.from({ length: 13 }, (_, i) => {
      const d = new Date("2023-01-01T00:00:00");
      d.setMonth(d.getMonth() + i);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      return { date: `${d.getFullYear()}-${m}-01`, nav: 100 + i * 5 };
    });
    loadBeesMock.mockResolvedValue(bees);
    labState.settings = {
      mode: "sip",
      amount: 1000,
      period: "Custom",
      customStart: "2023-01-01",
      customEnd: "2024-01-01",
    };
    labState.analyzing = false;
    labState.baskets = [basket];
    const result: BacktestResult = {
      basketId: "1",
      series: [
        { x: "2023-01-01", y: 1000, drawdown: 0 },
        { x: "2024-01-01", y: 14000, drawdown: 0 },
      ],
      cashflow: {
        mode: "sip",
        amount: 1000,
        startIso: "2023-01-01",
        requestedStartIso: "2023-01-01",
      },
      stats: { initial: 13000, final: 14000, abs: 7.69, cagr: 14, mdd: 0 },
    };
    labState.results = [result];
    const beesXirr = benchmarkForResult(result, bees, {
      mode: "sip",
      amount: 1000,
      startIso: "2023-01-01",
      endIso: "2024-01-01",
    })!.stats.cagr;

    renderView();

    await waitFor(() => {
      expect(
        screen.getByText(`${(14 - beesXirr).toFixed(2)}%`),
      ).toBeInTheDocument();
    });
    // Lumpsum BeES CAGR over the window is 60%; 14 − 60 must not appear.
    expect(screen.queryByText("-46.00%")).toBeNull();
    expect(beesXirr).toBeGreaterThan(14);
    expect(screen.getByText("Flexi Cap trails Nifty BeES")).toBeInTheDocument();
  });
});
