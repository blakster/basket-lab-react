import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "../types";
import { FundSearch } from "./FundSearch";

const { searchMock, reportStatus } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  reportStatus: vi.fn(),
}));

vi.mock("../lib/api/search", () => ({ searchFunds: searchMock }));
vi.mock("../state/LabContext", () => ({ useLab: () => ({ reportStatus }) }));

const fund: SearchHit = {
  schemeCode: "118741",
  schemeName: "UTI Nifty 50",
  isin: null,
};

async function debounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

describe("FundSearch feedback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchMock.mockReset();
    reportStatus.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows local failure, retries the same query, and returns focus after adding", async () => {
    searchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([fund]);
    const onSelect = vi.fn();
    render(<FundSearch onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "nifty" } });
    expect(screen.queryByText("Searching funds…")).not.toBeInTheDocument();
    await debounce();
    expect(screen.getByText(/Search unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry search" }));
    await debounce();
    fireEvent.click(screen.getByRole("option", { name: /UTI Nifty 50/ }));
    expect(onSelect).toHaveBeenCalledWith(fund);
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("ignores a stale response after clearing and resets the busy banner", async () => {
    let finish!: (hits: SearchHit[]) => void;
    searchMock.mockImplementationOnce(
      () =>
        new Promise<SearchHit[]>((resolve) => {
          finish = resolve;
        }),
    );
    render(<FundSearch onSelect={vi.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "nifty" } });
    await debounce();
    fireEvent.change(input, { target: { value: "n" } });
    await act(async () => {
      finish([fund]);
    });
    expect(
      screen.getByRole("listbox", { hidden: true }),
    ).toHaveAttribute("hidden");
    expect(screen.queryByText("Searching funds…")).not.toBeInTheDocument();
    expect(reportStatus).toHaveBeenLastCalledWith("search", { kind: "ready" });
  });

  it("marks existing funds as added and gives an explicit no-results state", async () => {
    searchMock.mockResolvedValueOnce([fund]).mockResolvedValueOnce([]);
    render(<FundSearch onSelect={vi.fn()} selectedCodes={[fund.schemeCode]} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "nifty" } });
    await debounce();
    expect(screen.getByRole("option", { name: /UTI Nifty 50/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Added")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "unknown" } });
    expect(screen.getByRole("option", { name: /UTI Nifty 50/ })).toBeInTheDocument();
    await debounce();
  });

  it("keeps stale results inert while a new query debounces", async () => {
    searchMock.mockResolvedValueOnce([fund]).mockResolvedValueOnce([]);
    const onSelect = vi.fn();
    render(<FundSearch onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "nifty" } });
    await debounce();
    fireEvent.change(input, { target: { value: "nifty midcap" } });
    const option = screen.getByRole("option", { name: /UTI Nifty 50/ });
    expect(option).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(option);
    expect(onSelect).not.toHaveBeenCalled();
    await debounce();
    expect(
      screen.getByText("No funds found. Try another name."),
    ).toBeInTheDocument();
  });

  it("navigates options with arrows and selects with Enter", async () => {
    const hits: SearchHit[] = [
      { schemeCode: "1", schemeName: "Alpha Fund", isin: null },
      { schemeCode: "2", schemeName: "Beta Fund", isin: null },
      { schemeCode: "3", schemeName: "Gamma Fund", isin: null },
    ];
    searchMock.mockResolvedValueOnce(hits);
    const onSelect = vi.fn();
    render(<FundSearch onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "fund" } });
    await debounce();
    expect(screen.getAllByRole("option")).toHaveLength(3);

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(
      screen.getByRole("option", { name: /Gamma Fund/ }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      screen.getByRole("option", { name: /Alpha Fund/ }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(hits[1]);
    expect(input).toHaveFocus();
  });

  it("highlights the first option on Enter instead of adding it", async () => {
    const hits: SearchHit[] = [
      { schemeCode: "1", schemeName: "Alpha Fund", isin: null },
      { schemeCode: "2", schemeName: "Beta Fund", isin: null },
    ];
    searchMock.mockResolvedValueOnce(hits);
    const onSelect = vi.fn();
    render(<FundSearch onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "fund" } });
    await debounce();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.getByRole("option", { name: /Alpha Fund/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("collapses the list on Escape and keeps the query", async () => {
    searchMock.mockResolvedValueOnce([fund]);
    render(<FundSearch onSelect={vi.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "nifty" } });
    await debounce();
    expect(screen.getByRole("listbox")).not.toHaveAttribute("hidden");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      screen.getByRole("listbox", { hidden: true }),
    ).toHaveAttribute("hidden");
    expect(input).toHaveValue("nifty");
  });

  it("cancels a pending search when Escape dismisses the list", async () => {
    searchMock.mockResolvedValueOnce([fund]);
    render(<FundSearch onSelect={vi.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "nifty" } });
    await debounce();
    fireEvent.change(input, { target: { value: "nifty bank" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await debounce();
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("listbox", { hidden: true }),
    ).toHaveAttribute("hidden");
  });
});
