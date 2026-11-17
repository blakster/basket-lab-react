/**
 * Horizontal port of Dither Kit's ordered-dither bar fill (`paintColumn`,
 * gradient variant). Source: github.com/Boring-Software-Inc/dither-kit
 * @ 1e7faee, registry/dither-kit/dither-paint.ts, MIT (Boring Software Inc.).
 *
 * Same rules as the kit: one colour, density drives alpha (so it reads on
 * light and dark), dense at the base, dissolving toward the value, capped
 * with a soft edge.
 */
export type Rgb = [number, number, number];

// 4×4 Bayer matrix normalised to 0–1 thresholds.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

/** CSS px per dither cell. */
export const CELL = 2;
const BORDER_ALPHA = 0.72;
const OFF_TIER = 0.4;

const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${Math.min(1, Math.max(0, a))})`;

/** Fill backing row `y` from column 0 to `len`, base at the left. */
export function paintRow(c: CanvasRenderingContext2D, y: number, len: number, color: Rgb) {
  const end = Math.round(len);
  if (end <= 0) return;
  for (let x = 0; x < end; x++) {
    const density = 1 - x / end;
    const lit = density > BAYER[y & 3]![x & 3]!;
    const k = 0.3 + density * 0.7;
    c.fillStyle = rgba(color, lit ? k : k * OFF_TIER);
    c.fillRect(x, y, 1, 1);
  }
  c.fillStyle = rgba(color, BORDER_ALPHA);
  c.fillRect(end - 1, y, 1, 1);
  if (end > 1) {
    c.fillStyle = rgba(color, BORDER_ALPHA * 0.5);
    c.fillRect(end - 2, y, 1, 1);
  }
}
