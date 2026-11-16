import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightsResponse } from "../lib/api/insights";
import type { Basket, BacktestResult, LabSettings, NavPoint } from "../types";
import { ThemeProvider } from "../state/ThemeContext";
import { InsightsPanel } from "./InsightsPanel";

const userEvent = {
  async upload(input: HTMLInputElement, file: File) {
    fireEvent.change(input, { target: { files: [file] } });
  },
};

const { postInsightsMock, ensureFilingsMock, uploadFilingMock, loadBeesMock, labState } =
  vi.hoisted(() => ({
  postInsightsMock: vi.fn(),
  ensureFilingsMock: vi.fn(),
  uploadFilingMock: vi.fn(),
  loadBeesMock: vi.fn(),
  labState: {
    baskets: [] as Basket[],
    results: [] as BacktestResult[],
    analyzing: false,
    reportStatus: vi.fn(),
    insightsOpen: true,
    insightsBasketId: "1" as string | null,
    openInsights: vi.fn(),
    closeInsights: vi.fn(),
    settings: {
      mode: "lumpsum",
      amount: 100_000,
      period: "Custom",
      customStart: "2023-01-01",
      customEnd: "2026-01-01",
    } as LabSettings,
  },
}));

vi.mock("../lib/api/insights", () => ({
  insightsBasketSignature: () => "sig",
  postInsights: (...args: unknown[]) => postInsightsMock(...args),
  ensureFilings: (...args: unknown[]) => ensureFilingsMock(...args),
  uploadFiling: (...args: unknown[]) => uploadFilingMock(...args),
}));

vi.mock("../lib/api/benchmarkNav", () => ({
  NIFTY_BEES_CODE: "140084",
  loadNiftyBeesNav: (...args: unknown[]) => loadBeesMock(...args),
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

const partialFiling: InsightsResponse = {
  asOf: "2026-07-31",
  overlap: null,
  baskets: [
    {
      id: "1",
      missingSchemes: ["B"],
      holdings: [{ isin: "INE1", name: "Covered Holding", weight: 20 }],
      sector: { Energy: 20 },
      asset: { Equity: 20 },
      credit: null,
      creditNote: "N/A — no debt holdings",
      equitySplit: { large: 20, mid: 0, small: 0, unclassified: 0 },
      expenseRatio: 0.5,
      expenseIncomplete: false,
      pe: 18,
      peIncomplete: false,
      filings: [
        {
          schemeCode: "A",
          state: "stale",
          requestedMonth: "2026-08",
          attemptedAt: "2026-08-16T00:00:00Z",
          finishedAt: "2026-08-16T00:00:01Z",
          asOf: "2026-07-31",
          amc: "Example AMC",
          sourceUrl: "https://amc.example/xls",
          reason: null,
        },
        {
          schemeCode: "B",
          state: "unmapped",
          requestedMonth: "2026-08",
          attemptedAt: "2026-08-16T00:00:00Z",
          finishedAt: "2026-08-16T00:00:01Z",
          asOf: null,
          amc: null,
          sourceUrl: null,
          reason: "scheme has no AMC mapping",
        },
      ],
      filingCoverage: { covered: 1, total: 2 },
      filingAsOf: "2026-07-31",
    },
  ],
};

const partialFilingWithFilings: InsightsResponse = {
  ...partialFiling,
  baskets: [
    {
      ...partialFiling.baskets[0]!,
      holdings: [{ isin: "INE1", name: "Reliance Industries", weight: 20 }],
    },
  ],
};

const failedFiling: InsightsResponse = {
  asOf: null,
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
      filings: [
        {
          schemeCode: "A",
          state: "download-failed",
          requestedMonth: "2026-08",
          attemptedAt: "2026-08-16T00:00:00Z",
          finishedAt: "2026-08-16T00:00:01Z",
          asOf: null,
          amc: "Example AMC",
          sourceUrl: null,
          reason: "connection timed out",
        },
      ],
      filingCoverage: { covered: 0, total: 1 },
      filingAsOf: null,
    },
  ],
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <InsightsPanel />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("InsightsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    postInsightsMock.mockReset();
    ensureFilingsMock.mockReset();
    uploadFilingMock.mockReset();
    uploadFilingMock.mockResolvedValue({
      schemeCode: "A",
      state: "fresh",
      requestedMonth: "2026-08",
      attemptedAt: "2026-08-16T00:00:00Z",
      finishedAt: "2026-08-16T00:00:01Z",
      asOf: "2026-07-31",
      amc: null,
      sourceUrl: null,
      reason: "user upload",
    });
    ensureFilingsMock.mockResolvedValue({
      fetched: 0,
      missing: [],
      amcs: [],
      filings: [],
    });
    loadBeesMock.mockReset();
    loadBeesMock.mockResolvedValue([] as NavPoint[]);
    labState.reportStatus.mockReset();
    labState.insightsBasketId = "1";
    labState.baskets = [basket];
    labState.results = [];
    labState.analyzing = false;
    labState.settings = {
      mode: "lumpsum",
      amount: 100_000,
      period: "Custom",
      customStart: "2023-01-01",
      customEnd: "2026-01-01",
    };
  });

  it("does not render 0.00% equity buckets when filings are missing", async () => {
    postInsightsMock.mockResolvedValue(emptyFiling);
    renderPanel();
    await waitFor(() => {
      expect(screen.getAllByText("No fund details").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("0.00%")).toBeNull();
    expect(screen.queryByText("Large")).toBeNull();
  });

  it("shows Risk & skill from NAV series when insights fail", async () => {
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
    const card = screen.getByText("Risk & skill").closest("article");
    expect(card).toBeTruthy();
    expect(card!.textContent).toMatch(/Sharpe/);
    expect(card!.textContent).toMatch(/-?\d+\.\d{2}/);
    expect(card!.textContent).toMatch(/Nifty BeES NAV missing/);
  });

  it("does not print 0.00% volatility for a constant series", async () => {
    postInsightsMock.mockRejectedValue(new Error("down"));
    labState.results = [
      {
        basketId: "1",
        series: [
          { x: "2023-01-01", y: 100, drawdown: 0 },
          { x: "2023-01-02", y: 100, drawdown: 0 },
          { x: "2023-01-03", y: 100, drawdown: 0 },
          { x: "2023-01-04", y: 100, drawdown: 0 },
        ],
        stats: { initial: 100, final: 100, abs: 0, cagr: 0, mdd: 0 },
      },
    ];
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Risk & skill")).toBeInTheDocument();
    });
    const card = screen.getByText("Risk & skill").closest("article")!;
    expect(card.textContent).not.toMatch(/Vol\s*0\.00%/);
  });

  it("shows pairwise correlation when two baskets have series", async () => {
    postInsightsMock.mockRejectedValue(new Error("down"));
    const other: Basket = {
      ...basket,
      id: "2",
      name: "Sat",
      funds: [
        {
          schemeCode: "B",
          schemeName: "Fund B",
          isin: null,
          weight: 100,
          locked: false,
        },
      ],
    };
    labState.baskets = [basket, other];
    labState.results = [
      {
        basketId: "1",
        series: [
          { x: "2023-01-01", y: 100, drawdown: 0 },
          { x: "2023-01-02", y: 101, drawdown: 0 },
          { x: "2023-01-03", y: 103, drawdown: 0 },
        ],
        stats: { initial: 100, final: 103, abs: 3, cagr: 3, mdd: 0 },
      },
      {
        basketId: "2",
        series: [
          { x: "2023-01-01", y: 100, drawdown: 0 },
          { x: "2023-01-02", y: 102, drawdown: 0 },
          { x: "2023-01-03", y: 101, drawdown: 0 },
        ],
        stats: { initial: 100, final: 101, abs: 1, cagr: 1, mdd: 0 },
      },
    ];
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/Core × Sat/)).toBeInTheDocument();
    });
  });

  it("shows only the focused basket's filings, not sibling baskets", async () => {
    const other: Basket = {
      ...basket,
      id: "2",
      name: "Sat",
      funds: [
        {
          schemeCode: "B",
          schemeName: "Fund B",
          isin: null,
          weight: 100,
          locked: false,
        },
      ],
    };
    labState.baskets = [basket, other];
    labState.insightsBasketId = "1";
    postInsightsMock.mockResolvedValue({
      asOf: "2026-07-31",
      overlap: { "1|2": 12.5 },
      baskets: [
        {
          id: "1",
          missingSchemes: [],
          holdings: [{ isin: "INE1", name: "Core Holding", weight: 20 }],
          sector: { Energy: 20 },
          asset: { Equity: 20 },
          credit: null,
          creditNote: "N/A — no debt holdings",
          equitySplit: { large: 20, mid: 0, small: 0, unclassified: 0 },
          expenseRatio: 0.5,
          expenseIncomplete: false,
          pe: 18,
          peIncomplete: false,
        },
        {
          id: "2",
          missingSchemes: [],
          holdings: [{ isin: "INE2", name: "Sat Holding", weight: 40 }],
          sector: { Financial: 40 },
          asset: { Equity: 40 },
          credit: null,
          creditNote: "N/A — no debt holdings",
          equitySplit: { large: 40, mid: 0, small: 0, unclassified: 0 },
          expenseRatio: 0.8,
          expenseIncomplete: false,
          pe: 22,
          peIncomplete: false,
        },
      ],
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Core Holding")).toBeInTheDocument();
    });
    expect(screen.queryByText("Sat Holding")).toBeNull();
    const holdings = screen.getByRole("heading", { name: "Holdings" }).closest("article")!;
    expect(holdings.textContent).not.toMatch(/Sat/);
    const mix = screen.getByRole("heading", { name: "Mix" }).closest("article")!;
    expect(mix.textContent).not.toMatch(/Sat/);
    expect(screen.queryByText("Financial")).toBeNull();
  });

  it("still renders holdings and mix empty states when AMFI filings are missing", async () => {
    postInsightsMock.mockResolvedValue(emptyFiling);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("No fund details for Fund A")).toBeInTheDocument();
    });
    const mix = screen.getByRole("heading", { name: "Mix" }).closest("article")!;
    expect(mix.textContent).toMatch(/No fund details/);
    expect(mix.textContent).toMatch(/Sector/);
    expect(mix.textContent).toMatch(/Asset/);
    expect(screen.queryByText("0.00%")).toBeNull();
  });

  it("renders cached insights before the automatic filing refresh settles", async () => {
    ensureFilingsMock.mockReturnValue(new Promise(() => {}));
    postInsightsMock.mockResolvedValue(partialFiling);
    renderPanel();
    expect(await screen.findByText("1 of 2 funds covered")).toBeInTheDocument();
  });

  it("offers a retry with the stored failure reason", async () => {
    postInsightsMock.mockResolvedValue(failedFiling);
    renderPanel();
    expect(await screen.findByRole("button", { name: "Fetch latest filings" })).toBeInTheDocument();
    expect(screen.getByText("connection timed out")).toBeInTheDocument();
  });

  it("offers Add filing on every coverage fund", async () => {
    postInsightsMock.mockResolvedValue(partialFilingWithFilings);
    renderPanel();
    expect(await screen.findAllByRole("button", { name: "Add filing" })).toHaveLength(2);
  });

  it("shows Reading filing then keeps holdings if upload fails", async () => {
    postInsightsMock.mockResolvedValue(partialFilingWithFilings);
    uploadFilingMock.mockRejectedValue(new Error("Upload failed."));
    renderPanel();
    const input = (await screen.findAllByLabelText("Add filing"))[0] as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "x.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await userEvent.upload(input, file);
    expect(await screen.findByText("Upload failed.")).toBeInTheDocument();
    expect(screen.getByText("Reliance Industries")).toBeInTheDocument();
  });

  it("rejects a pdf on the client without calling upload", async () => {
    postInsightsMock.mockResolvedValue(partialFilingWithFilings);
    renderPanel();
    const input = (await screen.findAllByLabelText("Add filing"))[0] as HTMLInputElement;
    const file = new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" });
    await userEvent.upload(input, file);
    expect(await screen.findByText(/under 5 MB/)).toBeInTheDocument();
    expect(uploadFilingMock).not.toHaveBeenCalled();
  });

  it("shows invested, current, and overlap for the focused basket", async () => {
    const other: Basket = {
      ...basket,
      id: "2",
      name: "Sat",
      funds: [
        {
          schemeCode: "B",
          schemeName: "Fund B",
          isin: null,
          weight: 100,
          locked: false,
        },
      ],
    };
    labState.baskets = [basket, other];
    labState.insightsBasketId = "1";
    labState.results = [
      {
        basketId: "1",
        series: [
          { x: "2023-01-01", y: 100_000, drawdown: 0 },
          { x: "2024-01-01", y: 118_000, drawdown: 0 },
        ],
        stats: { initial: 100_000, final: 118_000, abs: 18, cagr: 12.4, mdd: -8 },
      },
    ];
    postInsightsMock.mockResolvedValue({
      asOf: "2026-07-31",
      overlap: { "1|2": 12.5 },
      overlapHoldings: {
        "1|2": [
          {
            isin: "INE1",
            name: "Reliance Industries",
            weightA: 10,
            weightB: 8,
            minWeight: 8,
          },
        ],
      },
      baskets: [
        {
          id: "1",
          missingSchemes: [],
          holdings: [
            { isin: "INE1", name: "Reliance Industries", weight: 22 },
            { isin: "INE2", name: "HDFC Bank", weight: 18 },
          ],
          sector: { Financials: 48, Energy: 12 },
          asset: { Equity: 92, Debt: 8 },
          credit: null,
          creditNote: "N/A — no debt holdings",
          equitySplit: { large: 55, mid: 10, small: 35, unclassified: 0 },
          expenseRatio: 0.5,
          expenseIncomplete: false,
          pe: 18,
          peIncomplete: false,
        },
        {
          id: "2",
          missingSchemes: [],
          holdings: [{ isin: "INE1", name: "Reliance Industries", weight: 8 }],
          sector: { Energy: 8 },
          asset: { Equity: 8 },
          credit: null,
          creditNote: "N/A — no debt holdings",
          equitySplit: { large: 8, mid: 0, small: 0, unclassified: 0 },
          expenseRatio: 0.8,
          expenseIncomplete: false,
          pe: 22,
          peIncomplete: false,
        },
      ],
    });
    renderPanel();
    expect(await screen.findByText("12.50%")).toBeInTheDocument();
    expect(screen.getByText("Invested")).toBeInTheDocument();
    expect(screen.getByText("₹1,00,000")).toBeInTheDocument();
    expect(screen.getByText("₹1,18,000")).toBeInTheDocument();
    expect(screen.getAllByText("Reliance Industries").length).toBeGreaterThan(0);
    expect(screen.getByText("Financials is 48.0% of this basket")).toBeInTheDocument();
    expect(screen.getByText("Small-cap is 35.0% of this basket")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overlap" })).toBeInTheDocument();
  });

  it("hides desk invested/current while a run is in flight", async () => {
    labState.results = [
      {
        basketId: "1",
        series: [
          { x: "2023-01-01", y: 100_000, drawdown: 0 },
          { x: "2024-01-01", y: 118_000, drawdown: 0 },
        ],
        stats: { initial: 100_000, final: 118_000, abs: 18, cagr: 12.4, mdd: -8 },
      },
    ];
    labState.analyzing = true;
    postInsightsMock.mockResolvedValue(emptyFiling);
    renderPanel();
    expect(await screen.findByText("Recalculating…")).toBeInTheDocument();
    expect(screen.queryByText("₹1,18,000")).toBeNull();
  });

  it("hides desk metrics from a run for other settings", async () => {
    labState.results = [
      {
        basketId: "1",
        series: [
          { x: "2023-01-01", y: 1_000, drawdown: 0 },
          { x: "2024-01-01", y: 14_000, drawdown: 0 },
        ],
        cashflow: { mode: "sip", amount: 1000, startIso: "2023-01-01" },
        stats: { initial: 13_000, final: 14_000, abs: 7.7, cagr: 14, mdd: -2 },
      },
    ];
    postInsightsMock.mockResolvedValue(emptyFiling);
    renderPanel();
    expect(await screen.findByText("Recalculating…")).toBeInTheDocument();
    expect(screen.queryByText("₹14,000")).toBeNull();
  });

  it("lets the user open the full holdings list", async () => {
    const holdings = Array.from({ length: 12 }, (_, i) => ({
      isin: `INE${i}`,
      name: `Name ${i}`,
      weight: 12 - i,
    }));
    postInsightsMock.mockResolvedValue({
      ...partialFiling,
      baskets: [
        {
          ...partialFiling.baskets[0]!,
          missingSchemes: [],
          holdings,
        },
      ],
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Name 0")).toBeInTheDocument();
    });
    expect(screen.queryByText("Name 10")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 12 holdings" }));
    expect(screen.getByText("Name 10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show top 10" }));
    expect(screen.queryByText("Name 10")).toBeNull();
  });
});
