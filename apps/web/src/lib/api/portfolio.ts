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
  symbol: string | null;
  schemeCode: string | null;
};

export type ManualTransactionKind = "buy" | "sell";

export type ManualTransactionBody = {
  instrumentId?: string;
  scheme?: { schemeCode: string; name: string; isin: string | null };
  date: string;
  kind: ManualTransactionKind;
  units: number;
  amount: number;
};

export type PortfolioTransaction = {
  id: string;
  accountId: string;
  instrumentId: string;
  date: string;
  kind: string;
  units: number;
  amount: number;
  manual?: boolean;
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

export type CommissionCheckStatus =
  | "ready"
  | "missing-direct-plan"
  | "missing-expense-ratio";

type CommissionCheckBase = {
  instrumentId: string;
  schemeCode: string | null;
  schemeName: string;
  directSchemeCode: string | null;
  directSchemeName: string | null;
};

export type CommissionCheckRow = CommissionCheckBase &
  (
    | {
        status: "ready";
        regularExpenseRatio: number;
        directExpenseRatio: number;
        expenseGapPct: number;
        regularExpenseRatioAsOf: string | null;
        directExpenseRatioAsOf: string | null;
      }
    | {
        status: Exclude<CommissionCheckStatus, "ready">;
        regularExpenseRatio?: never;
        directExpenseRatio?: never;
        expenseGapPct?: never;
        regularExpenseRatioAsOf?: never;
        directExpenseRatioAsOf?: never;
      }
  );

export type CommissionCheckResponse = {
  rows: CommissionCheckRow[];
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

const COMMISSION_CHECK_CHUNK = 200;

export async function postCommissionCheck(
  instrumentIds: string[],
): Promise<CommissionCheckResponse> {
  const chunks: string[][] = [];
  for (let start = 0; start < instrumentIds.length; start += COMMISSION_CHECK_CHUNK) {
    chunks.push(instrumentIds.slice(start, start + COMMISSION_CHECK_CHUNK));
  }
  const responses = await Promise.all(
    chunks.map(async (ids) => {
      const res = await fetch("/api/portfolio/commission-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrumentIds: ids }),
      });
      if (!res.ok) throw await apiError(res, "Commission check unavailable");
      return (await res.json()) as CommissionCheckResponse;
    }),
  );
  return { rows: responses.flatMap((response) => response.rows) };
}

export const CAS_FILE_REJECT_MESSAGE =
  "Use a CAS PDF from CAMS, KFintech, NSDL or CDSL.";

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

async function apiError(res: Response, fallback: string): Promise<Error> {
  const json = (await res.json().catch(() => ({}))) as { detail?: unknown };
  const detail = json.detail;
  return new Error(
    typeof detail === "string" && detail ? detail : fallback,
  );
}

export async function createManualTransaction(
  body: ManualTransactionBody,
): Promise<PortfolioTransaction> {
  const res = await fetch("/api/portfolio/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await apiError(res, "Could not add this transaction.");
  return (await res.json()) as PortfolioTransaction;
}

export async function deleteManualTransaction(id: string): Promise<void> {
  const res = await fetch(`/api/portfolio/transactions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await apiError(res, "Could not delete this transaction.");
}
