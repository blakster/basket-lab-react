import type { CommissionCheckRow } from "../api/portfolio";

export type CommissionLine = {
  check: CommissionCheckRow;
  currentValue: number | null;
  yearlySavings: number | null;
  fiveYearSavings: number | null;
  tenYearSavings: number | null;
};

export type CommissionSummary = {
  lines: CommissionLine[];
  totalYearly: number | null;
  totalFiveYear: number | null;
  totalTenYear: number | null;
  missingCount: number;
};

export function compoundedSavings(
  currentValue: number,
  expenseGapPct: number,
  years: number,
): number {
  return currentValue * (Math.pow(1 + expenseGapPct / 100, years) - 1);
}

export function summarizeCommission(
  rows: CommissionCheckRow[],
  values: Map<string, number>,
): CommissionSummary {
  const lines = rows.map((check) => {
    const value = values.get(check.instrumentId) ?? 0;
    const currentValue = value > 0 ? value : null;
    if (check.status !== "ready" || currentValue === null) {
      return {
        check,
        currentValue,
        yearlySavings: null,
        fiveYearSavings: null,
        tenYearSavings: null,
      };
    }
    return {
      check,
      currentValue,
      yearlySavings: compoundedSavings(currentValue, check.expenseGapPct, 1),
      fiveYearSavings: compoundedSavings(currentValue, check.expenseGapPct, 5),
      tenYearSavings: compoundedSavings(currentValue, check.expenseGapPct, 10),
    };
  });
  const total = (key: "yearlySavings" | "fiveYearSavings" | "tenYearSavings") => {
    let seen = false;
    let sum = 0;
    for (const line of lines) {
      const value = line[key];
      if (value === null) continue;
      seen = true;
      sum += value;
    }
    return seen ? sum : null;
  };
  return {
    lines,
    totalYearly: total("yearlySavings"),
    totalFiveYear: total("fiveYearSavings"),
    totalTenYear: total("tenYearSavings"),
    missingCount: lines.filter((line) => line.yearlySavings === null).length,
  };
}
