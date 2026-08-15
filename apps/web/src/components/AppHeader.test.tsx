import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LabProvider } from "../state/LabContext";
import { AppHeader, statusLabel } from "./AppHeader";

describe("statusLabel", () => {
  it("maps each kind to banner copy", () => {
    expect(statusLabel({ kind: "ready" })).toBe("ready");
    expect(statusLabel({ kind: "cached-nav", detail: "2024-01-15" })).toBe(
      "Using saved NAV (2024-01-15)",
    );
    expect(statusLabel({ kind: "no-nav" })).toBe("Can't load NAV");
    expect(statusLabel({ kind: "search-down" })).toBe("Search unavailable");
    expect(statusLabel({ kind: "insights-down" })).toBe("Insights unavailable");
  });
});

describe("AppHeader", () => {
  it("shows ready on the status line and does not render a blocking dialog", () => {
    render(
      <LabProvider>
        <AppHeader />
      </LabProvider>,
    );
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Basket Lab" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
