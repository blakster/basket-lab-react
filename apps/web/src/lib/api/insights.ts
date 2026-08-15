import type { Basket } from "../../types";

export type InsightHolding = {
  isin: string | null;
  name: string;
  weight: number;
};

export type EquitySplit = {
  large: number;
  mid: number;
  small: number;
  unclassified: number;
};

export type InsightsBasket = {
  id: string;
  missingSchemes: string[];
  holdings: InsightHolding[];
  sector: Record<string, number>;
  asset: Record<string, number>;
  credit: Record<string, number> | null;
  creditNote: string | null;
  equitySplit: EquitySplit;
  expenseRatio: number | null;
  expenseIncomplete: boolean;
  pe: number | null;
  peIncomplete: boolean;
};

export type InsightsResponse = {
  asOf: string | null;
  baskets: InsightsBasket[];
  overlap: Record<string, number> | null;
};

function insightsPayload(baskets: Basket[]) {
  return {
    baskets: baskets.map((b) => ({
      id: b.id,
      name: b.name,
      funds: b.funds.map((f) => ({
        schemeCode: f.schemeCode,
        weight: f.weight,
      })),
    })),
  };
}

export function insightsBasketSignature(baskets: Basket[]): string {
  return JSON.stringify(insightsPayload(baskets));
}

export async function postInsights(
  baskets: Basket[],
): Promise<InsightsResponse> {
  const res = await fetch("/api/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(insightsPayload(baskets)),
  });
  if (!res.ok) throw new Error("Insights unavailable");
  return (await res.json()) as InsightsResponse;
}
