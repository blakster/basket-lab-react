import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LabProvider, useLab } from "../state/LabContext";
import { ThemeProvider } from "../state/ThemeContext";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { decodeShare, encodeShare } from "../lib/shareUrl";
import type { Basket, LabSettings } from "../types";
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

function makeBasket(id: string): Basket {
  return {
    id,
    name: `Basket ${id}`,
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

const SETTINGS: LabSettings = {
  mode: "lumpsum",
  amount: 100000,
  period: "3Y",
  customStart: null,
  customEnd: null,
};

function mockClipboard(): string[] {
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        writes.push(text);
        return Promise.resolve();
      },
    },
  });
  return writes;
}

function setShareQuery(encoded: string | null): void {
  const url = new URL(window.location.href);
  if (encoded == null) {
    url.searchParams.delete("s");
  } else {
    url.searchParams.set("s", encoded);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

async function copyShareLink(): Promise<URL> {
  const writes = mockClipboard();
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  return new URL(writes[0]!);
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
    expect(statusLabel({ kind: "bad-range" })).toBe("Check dates");
    expect(statusLabel({ kind: "search-busy" })).toBe("Search busy…");
    expect(statusLabel({ kind: "search-down" })).toBe("Search unavailable");
    expect(statusLabel({ kind: "insights-down" })).toBe("Insights unavailable");
  });
});

describe("AppHeader", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    setShareQuery(null);
    delete (navigator as { clipboard?: unknown }).clipboard;
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

  it("copies a link that encodes the live baskets after an edit, not the stale ?s=", async () => {
    // ?s= left over from a previous run encodes a different basket.
    setShareQuery(
      encodeShare({ settings: SETTINGS, baskets: [makeBasket("stale")] }),
    );
    const api: { current: ReturnType<typeof useLab> | null } = { current: null };
    renderHeader(api);

    const edited = [makeBasket("edited")];
    act(() => api.current!.setBaskets(edited));

    const copied = await copyShareLink();
    const decoded = decodeShare(copied.searchParams.get("s") ?? "");
    expect(decoded?.baskets).toEqual(edited);
    expect(decoded?.settings).toEqual(SETTINGS);
  });

  it("copies a link that encodes the current baskets before any run", async () => {
    const saved = { settings: SETTINGS, baskets: [makeBasket("saved")] };
    localStorage.setItem("basket-lab-v1", JSON.stringify(saved));
    renderHeader();

    const copied = await copyShareLink();
    const decoded = decodeShare(copied.searchParams.get("s") ?? "");
    expect(decoded?.settings).toEqual(saved.settings);
    expect(decoded?.baskets).toEqual(saved.baskets);
  });
});
