export const THEME_STORAGE_KEY = "basket-lab-theme";

export type Theme = "light" | "dark";

export const PAPER_LIGHT = "#FFFFFF";
export const PAPER_DEEP_LIGHT = "#F3F3F3";
export const PAPER_WELL_LIGHT = "#FFFFFF";
export const INK_LIGHT = "#121212";
export const INK_SOFT_LIGHT = "#5E5E5E";
export const GAIN_LIGHT = "#121212";
export const LOSS_LIGHT = "#B33A2B";

export const PAPER_DARK = "#121212";
export const PAPER_DEEP_DARK = "#0A0A0A";
export const PAPER_WELL_DARK = "#1C1C1C";
export const INK_DARK = "#F5F5F5";
export const INK_SOFT_DARK = "#9A9A9A";
export const GAIN_DARK = "#F5F5F5";
export const LOSS_DARK = "#E07064";

export interface BasketColor {
  /** Stored on the basket — a token reference so the color follows the theme. */
  value: string;
  /** Literal hex the reference replaced; matches colors saved on older baskets. */
  hex?: string;
  /** Human-facing name announced by pickers and screen readers. */
  label: string;
}

export const BASKET_COLORS: BasketColor[] = [
  { value: "var(--chart-1)", hex: "#121212", label: "Ink" },
  { value: "var(--chart-7)", label: "Blue" },
  { value: "var(--chart-8)", label: "Green" },
  { value: "var(--chart-9)", label: "Amber" },
  { value: "var(--chart-10)", label: "Violet" },
  { value: "var(--chart-3)", hex: "#B33A2B", label: "Red" },
  { value: "var(--chart-2)", hex: "#6B6B6B", label: "Gray 1" },
  { value: "var(--chart-6)", hex: "#5E5E5E", label: "Gray 2" },
  { value: "var(--chart-4)", hex: "#8A8A8A", label: "Gray 3" },
  { value: "var(--chart-5)", hex: "#3A3A3A", label: "Gray 4" },
];

/** Colors handed out automatically, in order: every hue first, then ink, then
 * grays. Red stays picker-only — it doubles as the loss color on charts. */
export const AUTO_BASKET_COLORS: BasketColor[] = BASKET_COLORS.filter(
  (color) => color.label !== "Red",
);

function swatchMatches(color: string, swatch: BasketColor): boolean {
  return (
    color === swatch.value || color.toUpperCase() === swatch.hex?.toUpperCase()
  );
}

/** First auto color no basket uses yet; once all are taken, cycle by position. */
export function nextBasketColor(
  baskets: ReadonlyArray<{ color: string }>,
): string {
  const taken = baskets.map((basket) => basket.color);
  const free = AUTO_BASKET_COLORS.find(
    (swatch) => !taken.some((color) => swatchMatches(color, swatch)),
  );
  return (
    free ?? AUTO_BASKET_COLORS[baskets.length % AUTO_BASKET_COLORS.length]
  ).value;
}

const MIN_SERIES_CONTRAST = 4.5;

export function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark";
}

export function resolveTheme(
  stored: string | null | undefined,
  prefersDark: boolean,
): Theme {
  if (isTheme(stored)) return stored;
  return prefersDark ? "dark" : "light";
}

export function readStoredTheme(
  storage: Pick<Storage, "getItem"> = localStorage,
): Theme | null {
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function persistTheme(
  theme: Theme,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage should still flip the live sheet.
  }
}

export function prefersDarkScheme(
  media: Pick<MediaQueryList, "matches"> | null = null,
): boolean {
  if (media) return media.matches;
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  const meta = root.ownerDocument.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", theme === "dark" ? PAPER_DARK : PAPER_LIGHT);
  }
}

export function themePalette(theme: Theme) {
  return theme === "dark"
    ? {
        paper: PAPER_DARK,
        paperDeep: PAPER_DEEP_DARK,
        paperWell: PAPER_WELL_DARK,
        ink: INK_DARK,
        inkSoft: INK_SOFT_DARK,
        gain: GAIN_DARK,
        loss: LOSS_DARK,
      }
    : {
        paper: PAPER_LIGHT,
        paperDeep: PAPER_DEEP_LIGHT,
        paperWell: PAPER_WELL_LIGHT,
        ink: INK_LIGHT,
        inkSoft: INK_SOFT_LIGHT,
        gain: GAIN_LIGHT,
        loss: LOSS_LIGHT,
      };
}

export function parseHex(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return [
      Number.parseInt(value[0]! + value[0], 16),
      Number.parseInt(value[1]! + value[1], 16),
      Number.parseInt(value[2]! + value[2], 16),
    ];
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
  }
  return null;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0").toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function mixHex(a: string, b: string, t: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  if (!from || !to) return a;
  return toHex(
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  );
}

export function paintOnPaper(hex: string, paper: string, ink: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const start = toHex(...rgb);
  if (contrastRatio(start, paper) >= MIN_SERIES_CONTRAST) return start;
  let lo = 0;
  let hi = 1;
  let best = ink;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const candidate = mixHex(start, ink, mid);
    if (contrastRatio(candidate, paper) >= MIN_SERIES_CONTRAST) {
      best = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

export function seriesPair(
  hex: string,
  role: "basket" | "gain" | "loss" = "basket",
): { light: string[]; dark: string[] } {
  if (role === "gain") return { light: [GAIN_LIGHT], dark: [GAIN_DARK] };
  if (role === "loss") return { light: [LOSS_LIGHT], dark: [LOSS_DARK] };
  return {
    light: [paintOnPaper(hex, PAPER_LIGHT, INK_LIGHT)],
    dark: [paintOnPaper(hex, PAPER_DARK, INK_DARK)],
  };
}

export function tintTowardWell(base: string, t: number, theme: Theme): string {
  const palette = themePalette(theme);
  const lifted = paintOnPaper(base, palette.paper, palette.ink);
  return `color-mix(in srgb, ${lifted} ${Math.round(t * 100)}%, var(--paper-well))`;
}

export function inkAlpha(alpha: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(alpha * 100)));
  return `color-mix(in srgb, var(--ink) ${pct}%, transparent)`;
}
