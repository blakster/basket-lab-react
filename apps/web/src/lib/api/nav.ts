import type { NavPoint } from "../../types";

const TIGZIG_NAV = "https://api.tigzig.com/mf/v1/nav";
const MFAPI_MF = "https://api.mfapi.in/mf";
const CHUNK_SIZE = 50;

type RawNavRow = { date: string; nav: string | number };

type TigZigBulk = {
  schemes?:
    | Record<string, { data?: RawNavRow[] }>
    | Array<{ scheme_code?: string | number; data?: RawNavRow[] }>;
  data?: RawNavRow[];
};

function mapTigZigRows(rows: RawNavRow[] | undefined): NavPoint[] {
  if (!rows?.length) return [];
  return rows
    .map((r) => ({
      date: r.date,
      nav: typeof r.nav === "number" ? r.nav : Number(r.nav),
    }))
    .filter((p) => p.date && Number.isFinite(p.nav))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** MFAPI dates are DD-MM-YYYY. */
function mfapiDateToIso(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

function mapMfapiRows(
  rows: RawNavRow[] | undefined,
  since: string,
  to: string,
): NavPoint[] {
  if (!rows?.length) return [];
  return rows
    .map((r) => ({
      date: mfapiDateToIso(r.date),
      nav: typeof r.nav === "number" ? r.nav : Number(r.nav),
    }))
    .filter(
      (p) =>
        p.date &&
        Number.isFinite(p.nav) &&
        p.date >= since &&
        p.date <= to,
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

type TigZigSchemeRow = {
  scheme_code?: string | number;
  data?: RawNavRow[];
};

function parseTigZigBody(
  body: TigZigBulk,
  codes: string[],
): Record<string, NavPoint[]> {
  const out: Record<string, NavPoint[]> = {};

  if (Array.isArray(body.schemes)) {
    const byCode = new Map<string, NavPoint[]>();
    for (const row of body.schemes as TigZigSchemeRow[]) {
      if (row?.scheme_code == null) continue;
      byCode.set(String(row.scheme_code), mapTigZigRows(row.data));
    }
    for (const code of codes) {
      out[code] = byCode.get(code) ?? [];
    }
    return out;
  }

  if (body.schemes && typeof body.schemes === "object") {
    for (const code of codes) {
      const entry = body.schemes[code];
      out[code] = mapTigZigRows(entry?.data);
    }
    // Include any extra scheme keys returned
    for (const [code, entry] of Object.entries(body.schemes)) {
      if (!(code in out)) out[code] = mapTigZigRows(entry?.data);
    }
    return out;
  }

  // Single-scheme top-level { data: [...] }
  if (Array.isArray(body.data) && codes.length === 1) {
    out[codes[0]] = mapTigZigRows(body.data);
    return out;
  }

  for (const code of codes) out[code] = [];
  return out;
}

async function fetchMfapiOne(
  code: string,
  since: string,
  to: string,
  fetchFn: typeof fetch,
): Promise<NavPoint[]> {
  const res = await fetchFn(`${MFAPI_MF}/${code}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: RawNavRow[] };
  return mapMfapiRows(body.data, since, to);
}

export type NavFetchResult = {
  navs: Record<string, NavPoint[]>;
  usedFallback: boolean;
};

async function fetchTigZigChunk(
  codes: string[],
  since: string,
  to: string,
  fetchFn: typeof fetch,
): Promise<NavFetchResult> {
  const url =
    `${TIGZIG_NAV}?schemes=${encodeURIComponent(codes.join(","))}` +
    `&since=${encodeURIComponent(since)}&to=${encodeURIComponent(to)}`;

  try {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`TigZig NAV ${res.status}`);
    const body = (await res.json()) as TigZigBulk;
    return { navs: parseTigZigBody(body, codes), usedFallback: false };
  } catch {
    const out: Record<string, NavPoint[]> = {};
    await Promise.all(
      codes.map(async (code) => {
        try {
          out[code] = await fetchMfapiOne(code, since, to, fetchFn);
        } catch {
          out[code] = [];
        }
      }),
    );
    return { navs: out, usedFallback: true };
  }
}

/**
 * Fetch NAV series for scheme codes via TigZig (chunks of 50).
 * On chunk failure, fall back to MFAPI per code (DD-MM-YYYY → ISO).
 * `usedFallback` is true when any chunk used MFAPI.
 */
export async function fetchNavWithStatus(
  codes: string[],
  since: string,
  to: string,
  fetchFn: typeof fetch = fetch,
): Promise<NavFetchResult> {
  if (!codes.length) return { navs: {}, usedFallback: false };

  const navs: Record<string, NavPoint[]> = {};
  let usedFallback = false;
  for (const group of chunk(codes, CHUNK_SIZE)) {
    const part = await fetchTigZigChunk(group, since, to, fetchFn);
    Object.assign(navs, part.navs);
    if (part.usedFallback) usedFallback = true;
  }
  return { navs, usedFallback };
}

export async function fetchNav(
  codes: string[],
  since: string,
  to: string,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, NavPoint[]>> {
  const { navs } = await fetchNavWithStatus(codes, since, to, fetchFn);
  return navs;
}
