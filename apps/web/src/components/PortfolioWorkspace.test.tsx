import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LabProvider, useLab } from "../state/LabContext";
import { ThemeProvider } from "../state/ThemeContext";
import { PortfolioWorkspace } from "./PortfolioWorkspace";

const { getPortfolioMock, postCommissionCheckMock, ensureFilingsMock, loadPortfolioNavMock } = vi.hoisted(() => ({
  getPortfolioMock: vi.fn(),
  postCommissionCheckMock: vi.fn(),
  ensureFilingsMock: vi.fn(),
  loadPortfolioNavMock: vi.fn(),
}));

vi.mock("../lib/api/insights", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api/insights")>();
  return {
    ...actual,
    ensureFilings: (...args: unknown[]) => ensureFilingsMock(...args),
  };
});

vi.mock("../lib/portfolio/portfolioNav", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portfolio/portfolioNav")>();
  return {
    ...actual,
    loadCachedPortfolioNav: (...args: unknown[]) => loadPortfolioNavMock(...args),
  };
});

vi.mock("../lib/api/portfolio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api/portfolio")>();
  return {
    ...actual,
    getPortfolio: (...args: unknown[]) => getPortfolioMock(...args),
    postCommissionCheck: (...args: unknown[]) => postCommissionCheckMock(...args),
  };
});

function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PortfolioWorkspace />
    </QueryClientProvider>,
  );
}

describe("PortfolioWorkspace commission check", () => {
  beforeEach(() => {
    ensureFilingsMock.mockResolvedValue({ fetched: 0, missing: [], amcs: [], filings: [] });
    loadPortfolioNavMock.mockResolvedValue({});
    getPortfolioMock.mockResolvedValue({
      accounts: [
        { id: "cdsl:folio:123456", provider: "cdsl", label: "MF folio 123456" },
      ],
      instruments: [
        {
          id: "amfi:2002",
          kind: "mf",
          name: "Example Flexi Fund - Regular Plan - Growth",
          isin: "INF0000000R1",
          schemeCode: null,
        },
      ],
      transactions: [],
      snapshots: [
        {
          date: "2026-10-31",
          accountId: "cdsl:folio:123456",
          instrumentId: "amfi:2002",
          units: 100,
          value: 10_000,
        },
      ],
    });
    postCommissionCheckMock.mockResolvedValue({
      rows: [
        {
          instrumentId: "amfi:2002",
          schemeCode: "2002",
          schemeName: "Example Flexi Fund - Regular Plan - Growth",
          directSchemeCode: "2001",
          directSchemeName: "Example Flexi Fund - Direct Plan - Growth",
          status: "ready",
          regularExpenseRatio: 1.25,
          directExpenseRatio: 0.64,
          expenseGapPct: 0.61,
          regularExpenseRatioAsOf: "2026-10-31",
          directExpenseRatioAsOf: "2026-10-31",
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows regular-plan savings against the imported holding's current value", async () => {
    renderWorkspace();

    expect(
      await screen.findByRole("heading", { name: "Commission check" }),
    ).toBeInTheDocument();
    expect(postCommissionCheckMock).toHaveBeenCalledWith(["amfi:2002"]);
    expect(screen.getByText("Switching to direct saves")).toBeInTheDocument();
    expect(screen.getByText("₹61/yr")).toBeInTheDocument();
    expect(screen.getByText("₹309 in 5y · ₹627 in 10y")).toBeInTheDocument();
    expect(
      screen.getAllByText("Direct: Example Flexi Fund - Direct Plan - Growth"),
    ).toHaveLength(2);
    expect(screen.getAllByText("1.25% → 0.64%")).toHaveLength(2);
    expect(screen.getByText("Expense ratios dated 2026-10-31.", { exact: false })).toBeInTheDocument();
  });

  it("shows imported stocks as holdings with their statement values", async () => {
    getPortfolioMock.mockResolvedValue({
      accounts: [
        { id: "cdsl:demat:1200000012345678", provider: "cdsl", label: "Example demat" },
      ],
      instruments: [
        {
          id: "amfi:123456",
          kind: "mf",
          name: "Example Flexi Cap Fund Direct Plan Growth",
          isin: "INF000000001",
          schemeCode: null,
        },
        {
          id: "isin:INE000A01010",
          kind: "stock",
          name: "Example Corp Equity Shares",
          isin: "INE000A01010",
          schemeCode: null,
          symbol: "EXAMPLE",
        },
      ],
      transactions: [],
      snapshots: [
        {
          date: "2026-10-31",
          accountId: "cdsl:demat:1200000012345678",
          instrumentId: "amfi:123456",
          units: 50.5,
          value: 1010,
        },
        {
          date: "2026-10-31",
          accountId: "cdsl:demat:1200000012345678",
          instrumentId: "isin:INE000A01010",
          units: 10,
          value: 1000,
        },
      ],
    });

    renderWorkspace();

    expect(await screen.findByText("Example Corp Equity Shares")).toBeInTheDocument();
    expect(screen.getByText(/Stock · EXAMPLE · Example demat/)).toBeInTheDocument();
    expect(screen.queryByText(/Stock · EXAMPLE · .*no NAV history/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Example Corp Equity Shares/ }));
    expect(await screen.findByText("Shares: 10.000")).toBeInTheDocument();
    expect(screen.getByText("Statement price: ₹100")).toBeInTheDocument();
    expect(screen.getByText("Valued as of 2026-10-31")).toBeInTheDocument();
    expect(screen.getByText("ISIN INE000A01010")).toBeInTheDocument();
  });

  it("first Health check click opens the newly saved portfolio basket in Insights", async () => {
    getPortfolioMock.mockResolvedValue({
      accounts: [{ id: "cams:1", provider: "cams", label: "CAMS · 1" }],
      instruments: [
        {
          id: "amfi:122639",
          kind: "mf",
          name: "Parag Parikh Flexi Cap Fund - Direct Plan - Growth",
          isin: "INF879O01027",
          schemeCode: "122639",
        },
      ],
      transactions: [],
      snapshots: [
        {
          date: "2026-10-31",
          accountId: "cams:1",
          instrumentId: "amfi:122639",
          units: 100,
          value: 10_000,
        },
      ],
    });
    postCommissionCheckMock.mockResolvedValue({ rows: [] });
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    function Spy() {
      api.current = useLab();
      return null;
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 } },
    });
    render(
      <ThemeProvider>
        <LabProvider>
          <Spy />
          <QueryClientProvider client={client}>
            <PortfolioWorkspace />
          </QueryClientProvider>
        </LabProvider>
      </ThemeProvider>,
    );
    const btn = await screen.findByRole("button", { name: /health check/i });
    fireEvent.click(btn);
    expect(api.current?.workspace).toBe("insights");
    expect(api.current?.insightsBasketId).toBe("portfolio-mirror");
    expect(api.current?.baskets.some((b) => b.id === "portfolio-mirror")).toBe(true);
    window.localStorage.removeItem("basket-lab-v1");
  });
});
