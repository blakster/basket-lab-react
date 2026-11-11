import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BacktestResult, Basket, LabSettings } from "../types";
import { BacktestView } from "./BacktestView";

const { labState } = vi.hoisted(() => ({
  labState: {
    baskets: [] as Basket[],
    results: [] as BacktestResult[],
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
}));

vi.mock("../state/LabContext", () => ({
  useLab: () => labState,
}));

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

  it("shows invested and current as Indian-rupee columns", () => {
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

    render(<BacktestView />);

    expect(screen.getByRole("columnheader", { name: "Invested" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Current" })).toBeInTheDocument();
    expect(screen.getByText("₹36,00,000")).toBeInTheDocument();
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

    render(<BacktestView />);

    expect(screen.queryByText(/Recalculating/)).toBeNull();
    expect(screen.getByText(/from 01 Jul 2023/)).toBeInTheDocument();
    expect(screen.getByText("₹1,20,000")).toBeInTheDocument();
  });
});
