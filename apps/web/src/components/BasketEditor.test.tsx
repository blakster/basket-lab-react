import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabProvider, useLab } from "../state/LabContext";
import { ThemeProvider } from "../state/ThemeContext";
import { BasketEditor } from "./BasketEditor";
import type { Basket } from "../types";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock("../lib/api/search", () => ({ searchFunds: searchMock }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  searchMock.mockReset();
  window.localStorage.removeItem("basket-lab-v1");
});

function makeBasket(name: string): Basket {
  return {
    id: "edit-1",
    name,
    color: "#18181b",
    active: true,
    funds: [
      {
        schemeCode: "118741",
        schemeName: "UTI Nifty 50 Index Fund",
        isin: null,
        weight: 100,
        locked: false,
      },
    ],
  };
}

function Consumer({
  api,
}: {
  api: { current: ReturnType<typeof useLab> | null };
}) {
  api.current = useLab();
  return null;
}

function openEditor(basket: Basket) {
  const api: { current: ReturnType<typeof useLab> | null } = { current: null };
  render(
    <ThemeProvider>
      <LabProvider>
        <Consumer api={api} />
        <BasketEditor />
      </LabProvider>
    </ThemeProvider>,
  );
  act(() => {
    api.current!.openEditor(basket.id, basket);
  });
  return api;
}

function nameInput(): HTMLElement {
  return screen.getByLabelText("Name");
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /save basket/i });
}

describe("BasketEditor name gate", () => {
  it("blocks saving a blank name and says why", () => {
    openEditor(makeBasket("Nifty 50 Index"));
    expect(saveButton()).toBeEnabled();

    fireEvent.change(nameInput(), { target: { value: "" } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("Add a name to save")).toBeInTheDocument();
    expect(screen.getByText("100.00%")).toBeInTheDocument();
  });

  it("blocks saving a whitespace-only name", () => {
    openEditor(makeBasket("Nifty 50 Index"));
    fireEvent.change(nameInput(), { target: { value: "   " } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("Add a name to save")).toBeInTheDocument();
  });

  it("saves a named basket exactly as before", () => {
    const api = openEditor(makeBasket("Nifty 50 Index"));
    fireEvent.change(nameInput(), { target: { value: "My Renamed Basket" } });
    expect(saveButton()).toBeEnabled();
    expect(screen.getByText("Ready to save")).toBeInTheDocument();

    act(() => {
      fireEvent.click(saveButton());
    });
    const saved = api.current!.baskets.find((b) => b.id === "edit-1");
    expect(saved?.name).toBe("My Renamed Basket");
    expect(api.current!.editingId).toBeNull();
  });
});

describe("chart color swatches", () => {
  it("names every swatch with a human label, not a CSS variable", () => {
    openEditor(makeBasket("Nifty 50 Index"));
    const group = screen.getByRole("group", { name: "Chart color" });
    const swatches = within(group).getAllByRole("button");
    expect(swatches.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Ink",
      "Blue",
      "Green",
      "Amber",
      "Violet",
      "Red",
      "Gray 1",
      "Gray 2",
      "Gray 3",
      "Gray 4",
    ]);
    for (const swatch of swatches) {
      expect(swatch.getAttribute("aria-label")).not.toMatch(/var\(--/);
    }
  });

  it("announces the selected swatch as pressed", () => {
    openEditor({ ...makeBasket("Nifty 50 Index"), color: "#121212" });
    expect(screen.getByRole("button", { name: "Ink" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    expect(screen.getByRole("button", { name: "Red" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Ink" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("fund search Escape coordination", () => {
  it("collapses open search results on first Escape and closes editor on second", async () => {
    vi.useFakeTimers();
    searchMock.mockResolvedValueOnce([
      { schemeCode: "135320", schemeName: "UTI Nifty 50 ETF", isin: null },
    ]);
    const api = openEditor(makeBasket("Nifty 50 Index"));
    const input = screen.getByRole("combobox");
    input.focus();
    fireEvent.change(input, { target: { value: "nifty" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByRole("listbox")).not.toHaveAttribute("hidden");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(api.current!.editingId).toBe("edit-1");
    expect(
      screen.getByRole("listbox", { hidden: true }),
    ).toHaveAttribute("hidden");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(api.current!.editingId).toBeNull();
  });

  it("keeps results mounted on blur so allocation buttons act on first click", async () => {
    vi.useFakeTimers();
    searchMock.mockResolvedValueOnce([
      { schemeCode: "135320", schemeName: "UTI Nifty 50 ETF", isin: null },
    ]);
    openEditor(makeBasket("Nifty 50 Index"));
    const input = screen.getByRole("combobox");
    input.focus();
    fireEvent.change(input, { target: { value: "nifty" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    const lockBtn = screen.getByRole("button", {
      name: /Lock UTI Nifty 50 Index Fund/,
    });
    fireEvent.mouseDown(lockBtn);
    fireEvent.blur(input);
    expect(screen.getByRole("listbox")).not.toHaveAttribute("hidden");

    fireEvent.click(lockBtn);
    expect(
      screen.getByRole("button", { name: /Unlock UTI Nifty 50 Index Fund/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("listbox", { hidden: true }),
    ).toHaveAttribute("hidden");
  });
});
