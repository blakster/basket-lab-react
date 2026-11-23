export type PortfolioAccount = {
  id: string;
  provider: string;
  label: string;
};

export type PortfolioInstrument = {
  id: string;
  kind: string;
  name: string;
  isin: string | null;
  schemeCode: string | null;
};

export type PortfolioTransaction = {
  id: string;
  accountId: string;
  instrumentId: string;
  date: string;
  kind: string;
  units: number;
  amount: number;
};

export type PortfolioSnapshot = {
  date: string;
  accountId: string;
  instrumentId: string;
  units: number;
  value: number;
};

export type PortfolioResponse = {
  accounts: PortfolioAccount[];
  instruments: PortfolioInstrument[];
  transactions: PortfolioTransaction[];
  snapshots: PortfolioSnapshot[];
};

export type CasImportResult = {
  importId: string;
  accountsInserted: number;
  instrumentsInserted: number;
  imported: number;
  duplicates: number;
  skipped: number;
  snapshotsWritten: number;
  statementPeriod: unknown;
  warnings?: string[];
};

export async function getPortfolio(): Promise<PortfolioResponse> {
  const res = await fetch("/api/portfolio");
  if (!res.ok) throw new Error("Portfolio unavailable");
  return (await res.json()) as PortfolioResponse;
}

export const CAS_FILE_REJECT_MESSAGE =
  "Use a CAS PDF from CAMS or KFintech.";

export function casFileRejected(file: File): boolean {
  return file.type !== "application/pdf" && !/\.pdf$/i.test(file.name);
}

export async function importCas(
  file: File,
  password: string,
): Promise<CasImportResult> {
  if (casFileRejected(file)) throw new Error(CAS_FILE_REJECT_MESSAGE);
  const body = new FormData();
  body.set("file", file);
  body.set("password", password);
  const res = await fetch("/api/portfolio/import/cas", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as {
    detail?: unknown;
    message?: string;
  } & Partial<CasImportResult>;
  if (!res.ok) {
    const detail = json.detail;
    throw new Error(
      typeof detail === "string" && detail
        ? detail
        : typeof json.message === "string" && json.message
          ? json.message
          : "Could not read this statement.",
    );
  }
  return json as CasImportResult;
}
