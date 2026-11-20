import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LabProvider, useLab } from "../state/LabContext";
import { ThemeProvider } from "../state/ThemeContext";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { AppHeader, statusLabel } from "./AppHeader";

function renderHeader(api?: { current: ReturnType<typeof useLab> | null }) {
  return render(
    <ThemeProvider>
      <LabProvider>
        <Consumer api={api} />
        <AppHeader />
      </LabProvider>
    </ThemeProvider>,
  );
}

function Consumer({
  api,
}: {
  api: { current: ReturnType<typeof useLab> | null } | undefined;
}) {
  if (api) api.current = useLab();
  return null;
}

describe("statusLabel", () => {
  it("maps each kind to banner copy", () => {
    expect(statusLabel({ kind: "ready" })).toBe("LIVE");
    expect(statusLabel({ kind: "idle" })).toBe("SETUP");
    expect(statusLabel({ kind: "cached-nav", detail: "2024-01-15" })).toBe(
      "SAVED NAV 2024-01-15",
    );
    expect(statusLabel({ kind: "cached-nav" })).toBe("SAVED NAV");
    expect(statusLabel({ kind: "no-nav" })).toBe("BLACKOUT");
    expect(statusLabel({ kind: "search-busy" })).toBe("Search busy…");
    expect(statusLabel({ kind: "search-down" })).toBe("Search unavailable");
    expect(statusLabel({ kind: "insights-down" })).toBe("Insights unavailable");
  });
});

describe("AppHeader", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("shows LIVE on the status line and does not render a blocking dialog", () => {
    renderHeader();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Basket Lab" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggles night edition on the root and remembers the choice", () => {
    renderHeader();
    const toggle = screen.getByRole("button", { name: "Night edition" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});
