import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioWorkspace } from "./PortfolioWorkspace";

const { getPortfolioMock, postCommissionCheckMock } = vi.hoisted(() => ({
  getPortfolioMock: vi.fn(),
  postCommissionCheckMock: vi.fn(),
}));

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
});
