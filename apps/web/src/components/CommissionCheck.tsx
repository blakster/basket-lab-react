import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatInrGroup } from "../lib/format";
import type {
  CommissionLine,
  CommissionSummary,
} from "../lib/portfolio/commission";

function formatPct(n: number): string {
  const text = n.toFixed(2);
  return `${text === "-0.00" ? "0.00" : text}%`;
}

function formatMoney(value: number | null): string {
  return value === null ? "—" : `₹${formatInrGroup(Math.round(value))}`;
}

function statusText(status: string): string {
  if (status === "missing-direct-plan") return "No direct match";
  if (status === "missing-expense-ratio") return "Expense unavailable";
  return "";
}

function ExpenseGap({ line }: { line: CommissionLine }) {
  const check = line.check;
  if (check.status !== "ready") {
    return check.status === "missing-expense-ratio" ? (
      <>{statusText(check.status)}</>
    ) : (
      <>—</>
    );
  }
  return (
    <>
      {formatPct(check.expenseGapPct)}
      <span className="holding-sub commission-ratio">
        {formatPct(check.regularExpenseRatio)} → {formatPct(check.directExpenseRatio)}
      </span>
    </>
  );
}

export function CommissionCheck({
  summary,
  loading,
  error,
}: {
  summary: CommissionSummary | null;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="insight-empty" role="status">
        Checking regular plans…
      </p>
    );
  }
  if (error) {
    return (
      <p className="insight-empty" role="alert">
        Commission check unavailable. Portfolio returns are unaffected.
      </p>
    );
  }
  if (!summary) return null;
  if (summary.lines.length === 0) {
    return (
      <p className="commission-empty">
        Commission check: no regular-plan holdings found.
      </p>
    );
  }

  const asOf = [
    ...new Set(
      summary.lines
        .flatMap((line) =>
          line.check.status === "ready"
            ? [line.check.regularExpenseRatioAsOf, line.check.directExpenseRatioAsOf]
            : [],
        )
        .filter((value): value is string => !!value),
    ),
  ].sort();
  return (
    <section className="commission-check" aria-labelledby="commission-check-title">
      <div className="commission-summary">
        <div>
          <h3 id="commission-check-title">Commission check</h3>
          <p>
            {summary.lines.length} regular plan{summary.lines.length === 1 ? "" : "s"}
            {summary.missingCount > 0 &&
              ` · ${summary.missingCount} without a complete saving estimate`}
          </p>
        </div>
        <div className="commission-total">
          {summary.totalYearly === null ? (
            <span>Direct-plan saving unavailable</span>
          ) : (
            <>
              <span>Switching to direct saves</span>
              <strong>{formatMoney(summary.totalYearly)}/yr</strong>
              <span>
                {formatMoney(summary.totalFiveYear)} in 5y ·{" "}
                {formatMoney(summary.totalTenYear)} in 10y
              </span>
            </>
          )}
        </div>
      </div>
      <div className="table-scroll commission-table-scroll">
        <Table className="insight-table commission-table">
          <TableHeader>
            <TableRow>
              <TableHead>Regular holding</TableHead>
              <TableHead className="text-right">Expense gap</TableHead>
              <TableHead className="text-right">Saved / year</TableHead>
              <TableHead className="text-right">5 years</TableHead>
              <TableHead className="text-right">10 years</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.lines.map((line) => {
              const check = line.check;
              const status = statusText(check.status);
              return (
                <TableRow key={check.instrumentId}>
                  <TableCell className="align-top">
                    {check.schemeName}
                    <span className="holding-sub">
                      {check.directSchemeName
                        ? `Direct: ${check.directSchemeName}`
                        : status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <ExpenseGap line={line} />
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {formatMoney(line.yearlySavings)}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {formatMoney(line.fiveYearSavings)}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {formatMoney(line.tenYearSavings)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="commission-cards">
        {summary.lines.map((line) => {
          const check = line.check;
          const status = statusText(check.status);
          return (
            <article className="commission-card" key={check.instrumentId}>
              <div className="commission-card-heading">
                <h4>{check.schemeName}</h4>
                <p className="holding-sub">
                  {check.directSchemeName ? `Direct: ${check.directSchemeName}` : status}
                </p>
              </div>
              <dl className="commission-card-metrics">
                <div>
                  <dt>Expense gap</dt>
                  <dd>
                    <ExpenseGap line={line} />
                  </dd>
                </div>
                <div>
                  <dt>Saved / year</dt>
                  <dd>{formatMoney(line.yearlySavings)}</dd>
                </div>
                <div>
                  <dt>5 years</dt>
                  <dd>{formatMoney(line.fiveYearSavings)}</dd>
                </div>
                <div>
                  <dt>10 years</dt>
                  <dd>{formatMoney(line.tenYearSavings)}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      <p className="commission-note">
        Savings use today's value times the expense-ratio gap. Projections assume
        the gap compounds and the holding stays unchanged; taxes, exit load and
        future flows are not included.
        {asOf.length > 0 && ` Expense ratios dated ${asOf.join(", ")}.`}
      </p>
    </section>
  );
}
