import { afterEach, describe, expect, it } from "vitest";
import {
  INK_DARK,
  INK_LIGHT,
  PAPER_DARK,
  PAPER_LIGHT,
  THEME_STORAGE_KEY,
  applyTheme,
  contrastRatio,
  inkAlpha,
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

describe("css helpers", () => {
  it("tints toward the live paper well token", () => {
    expect(tintTowardWell("#111111", 0.5, "light")).toContain("var(--paper-well)");
    expect(tintTowardWell("#111111", 1, "dark")).toMatch(/^color-mix\(in srgb, #/i);
  });

  it("writes ink as a theme-aware alpha", () => {
    expect(inkAlpha(0.22)).toBe("color-mix(in srgb, var(--ink) 22%, transparent)");
  });
});
