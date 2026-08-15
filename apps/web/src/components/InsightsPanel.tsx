import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, type ReactNode } from "react";
import {
  insightsBasketSignature,
  postInsights,
  type InsightsBasket,
} from "../lib/api/insights";
import { sharpeFromSeries } from "../lib/sharpe";
import { useLab } from "../state/LabContext";
import type { Basket } from "../types";

const EQUITY_ORDER = ["large", "mid", "small", "unclassified"] as const;

function formatPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

/** Never substitute 0 for a JSON-null PE / expense. */
function formatFilingMetric(
  value: number | null,
  incomplete: boolean,
): string {
  if (value == null) return "not in filing";
  const text = value.toFixed(2);
  return incomplete ? `${text} incomplete` : text;
}

function formatLabel(key: string): string {
  if (!key) return key;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function fundName(basket: Basket | undefined, schemeCode: string): string {
  return (
    basket?.funds.find((f) => f.schemeCode === schemeCode)?.schemeName ??
    schemeCode
  );
}

function weightEntries(map: Record<string, number>): [string, number][] {
  return Object.entries(map).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

function WeightList({
  rows,
}: {
  rows: { key: string; label: string; weight: number }[];
}) {
  if (!rows.length) return null;
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.key}>
          <span>{row.label}</span>
          <span className="insight-weight">{formatPct(row.weight)}</span>
        </li>
      ))}
    </ul>
  );
}

function BasketSlice({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="insight-basket">
      <h4>{name}</h4>
      {children}
    </div>
  );
}

function basketName(id: string, labBaskets: Basket[]): string {
  return labBaskets.find((b) => b.id === id)?.name ?? id;
}

export function InsightsPanel() {
  const { baskets, results, reportStatus } = useLab();
  const active = useMemo(() => baskets.filter((b) => b.active), [baskets]);
  const basketSignature = useMemo(
    () => insightsBasketSignature(active),
    [active],
  );

  const { data, isError, isSuccess } = useQuery({
    queryKey: ["insights", basketSignature],
    queryFn: () => postInsights(active),
    retry: 1,
    enabled: active.length > 0,
  });

  useEffect(() => {
    if (isError) reportStatus("insights", { kind: "insights-down" });
    else if (isSuccess) reportStatus("insights", { kind: "ready" });
  }, [isError, isSuccess, reportStatus]);

  const sharpes = useMemo(() => {
    const rows: { id: string; name: string; value: number }[] = [];
    for (const r of results) {
      const value = sharpeFromSeries(r.series);
      if (value == null) continue;
      rows.push({
        id: r.basketId,
        name: basketName(r.basketId, baskets),
        value,
      });
    }
    return rows;
  }, [results, baskets]);

  return (
    <section className="insights-panel">
      <h2>Insights</h2>
      {isError ? (
        <p>Insights unavailable</p>
      ) : data ? (
        <>
          {data.asOf && <p className="insights-asof">As of {data.asOf}</p>}
          <div className="insights-grid">
            <InsightCard title="Top holdings">
              {data.baskets.map((ib) => (
                <HoldingsBlock
                  key={ib.id}
                  ib={ib}
                  basket={baskets.find((b) => b.id === ib.id)}
                />
              ))}
            </InsightCard>
            <InsightCard title="Sector">
              {data.baskets.map((ib) => (
                <BreakdownBlock
                  key={ib.id}
                  name={basketName(ib.id, baskets)}
                  map={ib.sector}
                />
              ))}
            </InsightCard>
            <InsightCard title="Asset">
              {data.baskets.map((ib) => (
                <BreakdownBlock
                  key={ib.id}
                  name={basketName(ib.id, baskets)}
                  map={ib.asset}
                />
              ))}
            </InsightCard>
            <InsightCard title="Credit">
              {data.baskets.map((ib) => (
                <CreditBlock
                  key={ib.id}
                  name={basketName(ib.id, baskets)}
                  ib={ib}
                />
              ))}
            </InsightCard>
            <InsightCard title="Equity split">
              {data.baskets.map((ib) => (
                <BasketSlice key={ib.id} name={basketName(ib.id, baskets)}>
                  <WeightList
                    rows={EQUITY_ORDER.map((key) => ({
                      key,
                      label: formatLabel(key),
                      weight: ib.equitySplit[key],
                    }))}
                  />
                </BasketSlice>
              ))}
            </InsightCard>
            <InsightCard title="Overlap">
              {data.overlap == null ? (
                <p className="insight-empty">
                  Add another basket with holdings data
                </p>
              ) : (
                <ul>
                  {Object.entries(data.overlap)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, weight]) => {
                      const [left, right] = key.split("|");
                      const label = `${basketName(left ?? "", baskets)} × ${basketName(right ?? "", baskets)}`;
                      return (
                        <li key={key}>
                          <span>{label}</span>
                          <span className="insight-weight">
                            {formatPct(weight)}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              )}
            </InsightCard>
            <InsightCard title="Expense">
              {data.baskets.map((ib) => (
                <BasketSlice key={ib.id} name={basketName(ib.id, baskets)}>
                  <p>{formatFilingMetric(ib.expenseRatio, ib.expenseIncomplete)}</p>
                </BasketSlice>
              ))}
            </InsightCard>
            <InsightCard title="PE">
              {data.baskets.map((ib) => (
                <BasketSlice key={ib.id} name={basketName(ib.id, baskets)}>
                  <p>{formatFilingMetric(ib.pe, ib.peIncomplete)}</p>
                </BasketSlice>
              ))}
            </InsightCard>
            {sharpes.length > 0 && (
              <InsightCard title="Sharpe">
                <ul>
                  {sharpes.map((row) => (
                    <li key={row.id}>
                      <span>{row.name}</span>
                      <span className="insight-weight">
                        {row.value.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </InsightCard>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function InsightCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="insight-card">
      <h3>{title}</h3>
      {children}
    </article>
  );
}

function HoldingsBlock({
  ib,
  basket,
}: {
  ib: InsightsBasket;
  basket: Basket | undefined;
}) {
  return (
    <BasketSlice name={basket?.name ?? ib.id}>
      {ib.missingSchemes.map((code) => (
        <p key={code} className="insight-missing">
          No AMFI filing for {fundName(basket, code)}
        </p>
      ))}
      <WeightList
        rows={ib.holdings.map((h, i) => ({
          key: h.isin || `${h.name}-${i}`,
          label: h.name,
          weight: h.weight,
        }))}
      />
    </BasketSlice>
  );
}

function BreakdownBlock({
  name,
  map,
}: {
  name: string;
  map: Record<string, number>;
}) {
  return (
    <BasketSlice name={name}>
      <WeightList
        rows={weightEntries(map).map(([key, weight]) => ({
          key,
          label: formatLabel(key),
          weight,
        }))}
      />
    </BasketSlice>
  );
}

function CreditBlock({ name, ib }: { name: string; ib: InsightsBasket }) {
  return (
    <BasketSlice name={name}>
      {ib.credit == null ? (
        <p className="insight-empty">{ib.creditNote ?? "N/A — no debt holdings"}</p>
      ) : (
        <WeightList
          rows={weightEntries(ib.credit).map(([key, weight]) => ({
            key,
            label: key,
            weight,
          }))}
        />
      )}
    </BasketSlice>
  );
}
