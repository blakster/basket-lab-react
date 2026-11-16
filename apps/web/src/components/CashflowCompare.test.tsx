import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Basket, LabSettings, NavPoint } from "../types";
import { CashflowCompare } from "./CashflowCompare";

const { labState } = vi.hoisted(() => ({
  labState: {
    baskets: [] as Basket[],
    navByCode: {} as Record<string, NavPoint[]>,
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
