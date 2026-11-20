import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LabProvider, useLab } from "../state/LabContext";
import { ThemeProvider } from "../state/ThemeContext";
import { BasketEditor } from "./BasketEditor";
import type { Basket } from "../types";

afterEach(() => {
  cleanup();
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
