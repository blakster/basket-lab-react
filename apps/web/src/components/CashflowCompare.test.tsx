import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BacktestResult, Basket, LabSettings, NavPoint } from "../types";
import { CashflowCompare } from "./CashflowCompare";

const { labState } = vi.hoisted(() => ({
  labState: {
    baskets: [] as Basket[],
    navByCode: {} as Record<string, NavPoint[]>,
    results: [] as BacktestResult[],
    analyzing: false,
    settings: {
      mode: "lumpsum" as const,
      amount: 1000,
      period: "Custom" as const,
      customStart: "2023-01-01",
      customEnd: "2025-01-01",
    } as LabSettings,
  },
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
    {
      schemeCode: "S",
      schemeName: "S",
      isin: null,
      weight: 100,
      locked: false,
    },
  ],
};

const nav: NavPoint[] = Array.from({ length: 25 }, (_, i) => {
  const d = new Date("2023-01-01T00:00:00");
  d.setMonth(d.getMonth() + i);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return { date: `${y}-${m}-${day}`, nav: 10 };
});

describe("CashflowCompare", () => {
  afterEach(() => {
    cleanup();
    labState.settings = {
      mode: "lumpsum",
      amount: 1000,
      period: "Custom",
      customStart: "2023-01-01",
      customEnd: "2025-01-01",
    };
    labState.navByCode = {};
    labState.baskets = [];
    labState.results = [];
    labState.analyzing = false;
  });

  it("asks to run Compare when NAV is missing", () => {
    labState.baskets = [basket];
    labState.navByCode = {};
    render(<CashflowCompare />);
    expect(
      screen.getByText("No NAV for this basket yet. Run Compare first."),
    ).toBeInTheDocument();
  });

  it("lists lumpsum, SIP, step-up, and skip year 2", () => {
    labState.baskets = [basket];
    labState.navByCode = { S: nav };
    render(<CashflowCompare />);
    expect(screen.getByText("Lumpsum")).toBeInTheDocument();
    expect(screen.getByText("Monthly SIP")).toBeInTheDocument();
    expect(screen.getByText("Step-up 10%")).toBeInTheDocument();
    expect(screen.getByText("Skip year 2")).toBeInTheDocument();
    expect(screen.queryByText("Need a window past year two")).toBeNull();
  });

  it("anchors Skip year 2 to the SIP's first date when the fund is newer", () => {
    // Fund starts 2025-03-01, after year two of the requested window, which
    // would otherwise make Skip year 2 identical to Monthly SIP.
    const late: NavPoint[] = Array.from({ length: 25 }, (_, i) => {
      const d = new Date("2025-03-01T00:00:00");
      d.setMonth(d.getMonth() + i);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      return { date: `${d.getFullYear()}-${m}-01`, nav: 10 };
    });
    labState.baskets = [basket];
    labState.settings = {
      ...labState.settings,
      customStart: "2023-01-01",
      customEnd: "2027-03-01",
    };
    labState.navByCode = { S: late };
    render(<CashflowCompare />);
    expect(
      screen.getByText("No SIP 2026-03-01–2027-03-01"),
    ).toBeInTheDocument();
    const skipRow = screen.getByText("Skip year 2").closest("tr")!;
    const sipRow = screen.getByText("Monthly SIP").closest("tr")!;
    // 12 SIPs in year one + the 2027-03-01 SIP, vs 25 monthly SIPs.
    expect(skipRow.textContent).toContain("₹13,000");
    expect(sipRow.textContent).toContain("₹25,000");
  });

  it("does not pair old NAV with new settings while a run is in flight", () => {
    labState.baskets = [basket];
    labState.navByCode = { S: nav };
    labState.analyzing = true;
    render(<CashflowCompare />);
    expect(screen.getByText("Recalculating lumpsum…")).toBeInTheDocument();
    expect(screen.queryByText("Monthly SIP")).toBeNull();
  });

  it("treats a run for other settings as stale", () => {
    labState.baskets = [basket];
    labState.navByCode = { S: nav };
    labState.results = [
      {
        basketId: "1",
        series: [],
        cashflow: { mode: "sip", amount: 1000, startIso: "2023-01-01" },
        stats: { initial: 0, final: 0, abs: 0, cagr: 0, mdd: 0 },
      },
    ];
    render(<CashflowCompare />);
    expect(screen.getByText("Recalculating lumpsum…")).toBeInTheDocument();
    expect(screen.queryByText("Lumpsum")).toBeNull();
  });

  it("does not invent a skip year on a short window", () => {
    labState.baskets = [basket];
    labState.settings = {
      ...labState.settings,
      customStart: "2023-01-01",
      customEnd: "2023-06-01",
    };
    labState.navByCode = { S: nav.slice(0, 6) };
    render(<CashflowCompare />);
    expect(screen.getByText("Need a window past year two")).toBeInTheDocument();
  });
});
