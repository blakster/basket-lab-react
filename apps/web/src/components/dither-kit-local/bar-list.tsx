import { useEffect, useRef, useState } from "react";
import { CELL, paintRow, type Rgb } from "./paint";

/**
 * Horizontal dithered bars, one labelled row each. Dither Kit's BarChart only
 * draws vertical columns, so each track is painted with a horizontal port of
 * its fill (see ./paint.ts). Ink colour follows the theme.
 */
export type BarRow = { key: string; label: string; value: number; text: string };

const INK: Record<"light" | "dark", Rgb> = {
  light: [18, 18, 18],
  dark: [245, 245, 245],
};

function useThemeInk(): Rgb {
  const read = () =>
    document.documentElement.classList.contains("dark") ? "dark" : "light";
  const [mode, setMode] = useState<"light" | "dark">(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setMode(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return INK[mode];
}

function Track({ fraction, color }: { fraction: number; color: Rgb }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const c = canvas?.getContext("2d");
    const el = ref.current;
    if (!canvas || !c || !el || width <= 0) return;
    const cols = Math.max(1, Math.round(width / CELL));
    const rows = Math.max(1, Math.round(el.clientHeight / CELL));
    canvas.width = cols;
    canvas.height = rows;
    c.clearRect(0, 0, cols, rows);
    const len = Math.min(1, Math.max(0, fraction)) * cols;
    for (let y = 0; y < rows; y++) paintRow(c, y, len, color);
  }, [fraction, color, width]);

  return (
    <div ref={ref} className="relative h-3 w-full bg-[var(--ink-wash-soft)]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}

export function DitherBarList({
  rows,
  max,
  label,
}: {
  rows: BarRow[];
  /** Value at full width. Defaults to the largest row. */
  max?: number;
  label: string;
}) {
  const ink = useThemeInk();
  const top = max ?? Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label={label}>
      {rows.map((row) => (
        // `grid!`: the app's unlayered `.insight-card li { display: flex }`
        // outranks Tailwind's layered utilities.
        <li
          key={row.key}
          className="grid! grid-cols-[14rem_minmax(0,1fr)_4.5rem] items-center gap-4 text-sm"
        >
          <span className="truncate" title={row.label}>
            {row.label}
          </span>
          <Track fraction={top > 0 ? row.value / top : 0} color={ink} />
          <span className="text-right font-mono tabular-nums">{row.text}</span>
        </li>
      ))}
    </ul>
  );
}
