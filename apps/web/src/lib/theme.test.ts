import { afterEach, describe, expect, it } from "vitest";
import defaults from "../data/defaults.json";
import {
  AUTO_BASKET_COLORS,
  INK_DARK,
  INK_LIGHT,
  PAPER_DARK,
  PAPER_LIGHT,
  THEME_STORAGE_KEY,
  applyTheme,
  contrastRatio,
  inkAlpha,
  nextBasketColor,
  paintOnPaper,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  seriesPair,
  tintTowardWell,
} from "./theme";

describe("resolveTheme", () => {
  it("uses an explicit stored choice over the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system when nothing is stored", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(undefined, false)).toBe("light");
    expect(resolveTheme("nope", true)).toBe("dark");
  });
});

describe("theme storage", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips light and dark and ignores junk", () => {
    expect(readStoredTheme()).toBeNull();
    persistTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readStoredTheme()).toBeNull();
  });
});

describe("applyTheme", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  it("toggles the root class, color-scheme, and theme-color", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", PAPER_LIGHT);
    document.head.append(meta);

    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(meta.getAttribute("content")).toBe(PAPER_DARK);

    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(meta.getAttribute("content")).toBe(PAPER_LIGHT);
  });
});

describe("paintOnPaper", () => {
  it("keeps dashboard ink on the light field", () => {
    expect(paintOnPaper(INK_LIGHT, PAPER_LIGHT, INK_LIGHT)).toBe(INK_LIGHT);
  });

  it("lifts ink and navy so they stay readable on the dark field", () => {
    const inkOnNight = paintOnPaper(INK_LIGHT, PAPER_DARK, INK_DARK);
    expect(inkOnNight).not.toBe(INK_LIGHT);
    expect(contrastRatio(inkOnNight, PAPER_DARK)).toBeGreaterThanOrEqual(4.5);

    const navyOnNight = paintOnPaper("#1A3A6B", PAPER_DARK, INK_DARK);
    expect(contrastRatio(navyOnNight, PAPER_DARK)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("seriesPair", () => {
  it("keeps dashboard loss as the night red, not a cream mix", () => {
    expect(seriesPair("#111111", "loss")).toEqual({
      light: ["#B33A2B"],
      dark: ["#E07064"],
    });
  });
});

describe("nextBasketColor", () => {
  it("hands out every hue and ink before any gray repeats, never red", () => {
    const auto = AUTO_BASKET_COLORS.map((c) => c.label);
    expect(auto).not.toContain("Red");
    expect(auto.filter((l) => l.startsWith("Gray")).slice(0, 1)).toEqual(
      auto.slice(-4).slice(0, 1),
    );
    expect(auto.slice(0, 5)).toEqual(["Ink", "Blue", "Green", "Amber", "Violet"]);
    expect(auto.slice(5)).toEqual(["Gray 1", "Gray 2", "Gray 3", "Gray 4"]);
  });

  it("gives the three default baskets clearly different hues", () => {
    const colors = defaults.baskets.map((b) => b.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors).toEqual([
      "var(--chart-7)",
      "var(--chart-8)",
      "var(--chart-9)",
    ]);
  });

  it("picks the first hue no basket uses, counting colors saved as hex", () => {
    const taken = [
      { color: "var(--chart-7)" }, // Blue
      { color: "#121212" }, // Ink saved on an older basket
    ];
    expect(nextBasketColor(taken)).toBe("var(--chart-8)"); // Green
    expect(nextBasketColor([])).toBe("var(--chart-1)"); // Ink first
  });

  it("never auto-assigns red, even as a manual pick elsewhere", () => {
    const all = AUTO_BASKET_COLORS.map((s) => ({ color: s.value }));
    expect(nextBasketColor(all)).toBe("var(--chart-1)"); // cycle restarts at Ink
    for (let i = 0; i < 12; i++) {
      const baskets = AUTO_BASKET_COLORS.slice(0, i % AUTO_BASKET_COLORS.length);
      expect(nextBasketColor(baskets.map((s) => ({ color: s.value })))).not.toBe(
        "var(--chart-3)",
      );
    }
  });
});

describe("css helpers", () => {
  it("tints toward the live paper well token", () => {
    expect(tintTowardWell("#111111", 0.5, "light")).toContain("var(--paper-well)");
    expect(tintTowardWell("#111111", 1, "dark")).toMatch(/^color-mix\(in srgb, #/i);
  });

  it("writes ink as a theme-aware alpha", () => {
    expect(inkAlpha(0.22)).toBe("color-mix(in srgb, var(--ink) 22%, transparent)");
  });
});
