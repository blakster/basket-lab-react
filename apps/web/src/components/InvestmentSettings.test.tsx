import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LabSettings } from "../types";
import { InvestmentSettings } from "./InvestmentSettings";

const { labState } = vi.hoisted(() => ({
  labState: {
    settings: {
      mode: "lumpsum",
      amount: 100_000,
      period: "3Y",
      customStart: null,
      customEnd: null,
    } as LabSettings,
    setSettings: vi.fn(),
  },
}));

vi.mock("../state/LabContext", () => ({
  useLab: () => labState,
}));

describe("InvestmentSettings amount", () => {
  afterEach(() => {
    cleanup();
    labState.settings = {
      mode: "lumpsum",
      amount: 100_000,
      period: "3Y",
      customStart: null,
      customEnd: null,
    };
    labState.setSettings.mockReset();
    labState.setSettings.mockImplementation((next: LabSettings) => {
      labState.settings = next;
    });
  });

  it("shows the amount with Indian commas", () => {
    labState.setSettings.mockImplementation((next: LabSettings) => {
      labState.settings = next;
    });
    render(<InvestmentSettings />);
    const input = screen.getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
    expect(input.value).toBe("1,00,000");
  });

  it("formats Indian commas on blur", () => {
    labState.setSettings.mockImplementation((next: LabSettings) => {
      labState.settings = next;
    });
    render(<InvestmentSettings />);
    const input = screen.getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "500000" } });
    fireEvent.blur(input);
    expect(input.value).toBe("5,00,000");
    expect(labState.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500000 }),
    );
  });
});
