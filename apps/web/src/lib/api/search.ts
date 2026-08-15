import type { SearchHit } from "../../types";

const TIGZIG_SEARCH = "https://api.tigzig.com/mf/v1/search";
const MFAPI_SEARCH = "https://api.mfapi.in/mf/search";

type TigZigResult = {
  scheme_code: string | number;
  scheme_name: string;
  isin?: string | null;
};

type MfapiResult = {
  schemeCode: string | number;
  schemeName: string;
};

function mapTigZig(results: TigZigResult[]): SearchHit[] {
  return results.map((r) => ({
    schemeCode: String(r.scheme_code),
    schemeName: r.scheme_name,
    isin: r.isin ?? null,
  }));
}

function mapMfapi(results: MfapiResult[]): SearchHit[] {
  return results.map((r) => ({
    schemeCode: String(r.schemeCode),
    schemeName: r.schemeName,
    isin: null,
  }));
}

/**
 * Search funds via TigZig; fall back to MFAPI search on network error or !ok.
 * Empty TigZig results are success (no fallback). Never hits MFAPI full list.
 */
export async function searchFunds(
  query: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const tigzigUrl = `${TIGZIG_SEARCH}?q=${encodeURIComponent(query)}&limit=20`;

  try {
    const res = await fetchFn(tigzigUrl, { signal });
    if (res.ok) {
      const data = (await res.json()) as { results?: TigZigResult[] };
      return mapTigZig(data.results ?? []);
    }
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      throw err;
    }
    // network error — fall through to MFAPI
  }

  const mfapiUrl = `${MFAPI_SEARCH}?q=${encodeURIComponent(query)}`;
  const res = await fetchFn(mfapiUrl, { signal });
  if (!res.ok) {
    throw new Error(`MFAPI search failed: ${res.status}`);
  }
  const data = (await res.json()) as MfapiResult[];
  return mapMfapi(Array.isArray(data) ? data : []);
}
