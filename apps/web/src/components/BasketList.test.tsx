import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LabProvider } from "../state/LabContext";
import { ThemeProvider } from "../state/ThemeContext";
import { BasketList } from "./BasketList";

afterEach(() => {
  cleanup();
});

function renderBasketList() {
  return render(
    <ThemeProvider>
      <LabProvider>
        <BasketList />
      </LabProvider>
    </ThemeProvider>,
  );
}

describe("BasketList", () => {
  it("renders the Baskets section with new basket button and active count badge", () => {
    renderBasketList();
    expect(
      screen.getByRole("heading", { name: /^baskets/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new basket/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reset defaults/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/\d+ of \d+ active/i)).toBeInTheDocument();
  });

  it("lists the default baskets with their action buttons", () => {
    renderBasketList();
    const editButtons = screen.getAllByRole("button", { name: /^edit$/i });
    expect(editButtons.length).toBeGreaterThan(0);

    const insightButtons = screen.getAllByRole("button", {
      name: /^insights$/i,
    });
    expect(insightButtons.length).toBeGreaterThan(0);
  });
});
