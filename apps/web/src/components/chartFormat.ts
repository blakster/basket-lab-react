export function formatTick(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

export function formatFullDate(iso: string): string {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatPctValue(n: number): string {
  return `${n.toFixed(2)}%`;
}

export type MixSeries = {
  key: string;
  label: string;
  color: string;
  values: Record<string, number>;
};
