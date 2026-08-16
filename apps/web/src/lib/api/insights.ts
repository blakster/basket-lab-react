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

export type FilingState =
  | "fresh"
  | "stale"
  | "missing-source"
  | "download-failed"
  | "parse-failed"
  | "unmapped";

export type FilingStatus = {
  schemeCode: string;
  state: FilingState;
  requestedMonth: string;
  attemptedAt: string;
  finishedAt: string | null;
  asOf: string | null;
  amc: string | null;
  sourceUrl: string | null;
  reason: string | null;
};

export type FilingCoverage = {
  covered: number;
  total: number;
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
  filings?: FilingStatus[];
  filingCoverage?: FilingCoverage;
  filingAsOf?: string | null;
};

export type EnsureFilingsResponse = {
  fetched: number;
  missing: string[];
  amcs: string[];
  filings: FilingStatus[];
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

const EMPTY_ENSURE: EnsureFilingsResponse = {
  fetched: 0,
  missing: [],
  amcs: [],
  filings: [],
};

const inflightEnsure = new Map<string, Promise<EnsureFilingsResponse>>();

function ensureKey(codes: string[]): string {
  return [...codes].sort().join("\0");
}

async function postEnsure(codes: string[]): Promise<EnsureFilingsResponse> {
  try {
    const res = await fetch("/api/ingest/ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schemeCodes: codes }),
    });
    if (!res.ok) throw new Error("Ensure filings failed");
    return (await res.json()) as EnsureFilingsResponse;
  } catch {
    return { fetched: 0, missing: codes, amcs: [], filings: [] };
  }
}

/** Refresh missing or stale AMC filings; always returns the structured body. */
export async function ensureFilings(
  schemeCodes: string[],
): Promise<EnsureFilingsResponse> {
  const codes = [...new Set(schemeCodes.filter(Boolean))];
  if (!codes.length) return EMPTY_ENSURE;
  const key = ensureKey(codes);
  const existing = inflightEnsure.get(key);
  if (existing) return existing;
  const request = postEnsure(codes).finally(() => {
    if (inflightEnsure.get(key) === request) inflightEnsure.delete(key);
  });
  inflightEnsure.set(key, request);
  return request;
}
