const GROUP = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const MONEY = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Indian grouping: 1,00,000 — never Western 100,000. */
export function formatInrGroup(n: number): string {
  if (!Number.isFinite(n)) return "";
  return GROUP.format(n);
}

/** Rupee with Indian grouping. Whole rupees drop decimals. */
export function formatInr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `₹${MONEY.format(n)}`;
}

function trimTenth(n: number): string {
  const text = n.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

/** Axis ticks: ₹1.2L, ₹80k, ₹3Cr. */
export function formatCompactInr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${sign}₹${trimTenth(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trimTenth(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${trimTenth(abs / 1e3)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

export function parseInrInput(raw: string): {
  status: "empty" | "invalid" | "ok";
  value?: number;
  text?: string;
} {
  const text = raw.trim();
  if (!text) return { status: "empty" };
  if (!/^[\d,]+$/.test(text)) return { status: "invalid" };
  const value = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(value)) return { status: "invalid" };
  return { status: "ok", value, text };
}
