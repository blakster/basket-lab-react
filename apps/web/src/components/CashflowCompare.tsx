import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMemo, useState } from "react";
import {
  backtestPlan,
  skipYearWindow,
  type CashflowPlan,
} from "../lib/backtest/performance";
import { formatInr, formatInrGroup } from "../lib/format";
import { resolveRange } from "../lib/resolveSettings";
import { runIsStale } from "../lib/runFreshness";
import { useLab } from "../state/LabContext";
import type { BacktestResult, Basket, NavPoint } from "../types";

const STEP_UP = 0.1;

type Row = {
  id: string;
  label: string;
  note: string;
  result: BacktestResult | null;
  empty: string | null;
};

function formatPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function navsForBasket(
  basket: Basket,
  navs: Record<string, NavPoint[]>,
): Record<string, NavPoint[]> {
  const out: Record<string, NavPoint[]> = {};
  for (const f of basket.funds) {
    if (f.weight <= 0) continue;
    out[f.schemeCode] = navs[f.schemeCode] ?? [];
  }
  return out;
}

function runPlan(
  basket: Basket,
  navs: Record<string, NavPoint[]>,
  settings: ReturnType<typeof useLab>["settings"],
  start: string,
  end: string,
  plan: CashflowPlan,
): BacktestResult {
  return backtestPlan(
    basket,
    navs,
    { ...settings, customStart: start, customEnd: end },
    plan,
  );
}

export function CashflowCompare() {
  const { baskets, settings, navByCode, results, analyzing } = useLab();
  const active = useMemo(() => baskets.filter((b) => b.active), [baskets]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const basket =
    active.find((b) => b.id === focusedId) ?? active[0] ?? null;

  const range = useMemo(
    () =>
      resolveRange(settings.period, settings.customStart, settings.customEnd),
    [settings.period, settings.customStart, settings.customEnd],
  );

  // navByCode belongs to the last finished run; don't pair it with newer
  // settings while a run is in flight or after the settings moved on.
  const stale = analyzing || runIsStale(results, settings, range.start);

  const rows = useMemo((): Row[] => {
    if (!basket) return [];
    if (stale) {
      return [
        {
          id: "stale",
          label: "Cashflows",
          note: "",
          result: null,
          empty: `Recalculating ${settings.mode}…`,
        },
      ];
    }
    const navs = navsForBasket(basket, navByCode);
    const missing = basket.funds.some(
      (f) => f.weight > 0 && !(navs[f.schemeCode]?.length),
    );
    if (missing) {
      return [
        {
          id: "empty",
          label: "Cashflows",
          note: "",
          result: null,
          empty: "No NAV for this basket yet. Run Compare first.",
        },
      ];
    }
    const lumpsum = runPlan(basket, navs, settings, range.start, range.end, {
      kind: "lumpsum",
    });
    const sip = runPlan(basket, navs, settings, range.start, range.end, {
      kind: "sip",
      stepUp: 0,
    });
    // Year two of the SIP actually run: a newer fund pushes the first SIP
    // past the requested start, so anchor the skip window there.
    const sipStart =
      sip.error === "no-nav" ? range.start : (sip.cashflow?.startIso ?? range.start);
    const skip = skipYearWindow(sipStart, range.end);
    const step = runPlan(basket, navs, settings, range.start, range.end, {
      kind: "sip",
      stepUp: STEP_UP,
    });
    const skipResult = skip
      ? runPlan(basket, navs, settings, range.start, range.end, {
          kind: "sip",
          stepUp: 0,
          skipStartIso: skip.skipStartIso,
          skipEndIso: skip.skipEndIso,
          skipEndInclusive: skip.skipEndInclusive,
        })
      : null;
    return [
      {
        id: "lumpsum",
        label: "Lumpsum",
        note: "Once at start",
        result: lumpsum,
        empty: lumpsum.error === "no-nav" ? "No NAV" : null,
      },
      {
        id: "sip",
        label: "Monthly SIP",
        note: "Same installment",
        result: sip,
        empty: sip.error === "no-nav" ? "No NAV" : null,
      },
      {
        id: "step-up",
        label: "Step-up 10%",
        note: "SIP rises each year",
        result: step,
        empty: step.error === "no-nav" ? "No NAV" : null,
      },
      {
        id: "skip-year",
        label: "Skip year 2",
        note: skip
          ? `No SIP ${skip.skipStartIso}–${skip.skipEndIso}`
          : "Window shorter than 2Y",
        result: skipResult,
        empty: skip
          ? skipResult?.error === "no-nav"
            ? "No NAV"
            : null
          : "Need a window past year two",
      },
    ];
  }, [basket, navByCode, range.end, range.start, settings, stale]);

  if (!basket) return null;

  return (
    <section className="cashflow-compare" aria-label="Cashflow compare">
      <h3>Same basket, different cashflows</h3>
      <p className="cashflow-compare-note">
        {basket.name} · ₹{formatInrGroup(settings.amount)} ·{" "}
        {settings.period}. Invested totals differ on purpose.
      </p>
      {active.length > 1 && (
        <div className="insights-switch" role="tablist" aria-label="Basket">
          {active.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={b.id === basket.id}
              className="insights-switch-item"
              onClick={() => setFocusedId(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}
      <div className="table-scroll">
        <Table className="backtest-table">
          <TableHeader>
            <TableRow>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Invested</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Max DD</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              if (row.empty || !row.result || row.result.error === "no-nav") {
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.label}
                      {row.note ? (
                        <span className="basket-sub">{row.note}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="num-empty text-right" colSpan={4}>
                      {row.empty ?? "No NAV"}
                    </TableCell>
                  </TableRow>
                );
              }
              const r = row.result;
              const sipLike = r.cashflow?.mode === "sip";
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.label}
                    <span className="basket-sub">{row.note}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatInr(r.stats.initial)}
                  </TableCell>
                  <TableCell
                    className={`text-right ${r.stats.final >= r.stats.initial ? "num-gain" : "num-loss"}`}
                  >
                    {formatInr(r.stats.final)}
                    <span
                      className={`basket-sub ${r.stats.abs >= 0 ? "num-gain" : "num-loss"}`}
                    >
                      {formatPct(r.stats.abs)}
                    </span>
                  </TableCell>
                  <TableCell
                    className={`text-right ${r.stats.cagr >= 0 ? "num-gain" : "num-loss"}`}
                  >
                    {formatPct(r.stats.cagr)}
                    <span className="basket-sub">
                      {sipLike ? "XIRR" : "CAGR"}
                    </span>
                  </TableCell>
                  <TableCell className="num-loss text-right">
                    {formatPct(r.stats.mdd)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
