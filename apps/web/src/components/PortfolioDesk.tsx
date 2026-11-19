import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatInr } from "../lib/format";
import type {
  Concentration,
  GrowthSplit,
  MixMeter,
  OverlapRow,
  RedFlag,
} from "../lib/portfolioDetails";

function formatPct(n: number): string {
  const text = n.toFixed(2);
  return `${text === "-0.00" ? "0.00" : text}%`;
}

function MixMeters({
  title,
  meters,
}: {
  title: string;
  meters: MixMeter[] | null;
}) {
  if (!meters?.length) return null;
  return (
    <div className="insight-basket">
      <h4>{title}</h4>
      {meters.map((m) => (
        <div key={m.key} className="insight-meter">
          <div className="insight-meter-row">
            <span>{m.label}</span>
            <span>{formatPct(m.weight)}</span>
          </div>
          <Progress
            value={Math.min(100, Math.max(0, m.weight))}
            className="h-1 rounded-none bg-[var(--paper-deep)] [&_[data-slot=progress-indicator]]:bg-[var(--ink)]"
          />
        </div>
      ))}
    </div>
  );
}

export function PortfolioDesk({
  growth,
  stale = false,
  beesCagr,
  beesMissing,
  concentration,
  peText,
  flags,
  asset,
  equity,
  sectors,
}: {
  growth: GrowthSplit | null;
  /** Run is in flight or was computed for other settings. */
  stale?: boolean;
  beesCagr: number | null;
  beesMissing: boolean;
  concentration: Concentration | null;
  peText: string | null;
  flags: RedFlag[];
  asset: MixMeter[] | null;
  equity: MixMeter[] | null;
  sectors: MixMeter[] | null;
}) {
  return (
    <div className="portfolio-desk">
      {growth ? (
        <div className="desk-kpis">
          <div className="desk-kpi">
            <span className="kpi-label">Invested</span>
            <span className="kpi-value">{formatInr(growth.invested)}</span>
            <span className="kpi-sub">Money you put in</span>
          </div>
          <div className="desk-kpi">
            <span className="kpi-label">Current</span>
            <span className="kpi-value">{formatInr(growth.current)}</span>
            <span className="kpi-sub">Basket value</span>
          </div>
          <div className="desk-kpi">
            <span className="kpi-label">Return</span>
            <span
              className={`kpi-value${growth.gain < 0 ? " is-down" : " is-up"}`}
            >
              {formatPct(growth.absPct)}
            </span>
            <span className="kpi-sub">{formatInr(growth.gain)}</span>
          </div>
          <div className="desk-kpi">
            <span className="kpi-label">{growth.rateLabel}</span>
            <span
              className={`kpi-value${growth.rate < 0 ? " is-down" : " is-up"}`}
            >
              {formatPct(growth.rate)}
            </span>
            <span className="kpi-sub">
              {beesCagr != null
                ? `Nifty BeES ${formatPct(beesCagr)}`
                : beesMissing
                  ? "Nifty BeES NAV missing"
                  : "vs Nifty BeES"}
            </span>
          </div>
        </div>
      ) : stale ? (
        <p className="insight-empty" role="status">
          Recalculating…
        </p>
      ) : (
        <p className="insight-empty">No run yet. Check amount, weights, and NAV.</p>
      )}
      {growth && (
        <div className="growth-split">
          <div className="growth-split-legend">
            <span>Invested {formatInr(growth.invested)}</span>
            <span className={growth.gain < 0 ? "is-down" : "is-up"}>
              {growth.gain < 0 ? "Loss" : "Returns"}{" "}
              {formatInr(Math.abs(growth.gain))}
            </span>
          </div>
          <div
            className="growth-bar"
            role="img"
            aria-label={
              growth.gain < 0
                ? "Invested versus loss"
                : "Invested versus returns"
            }
          >
            {growth.gain >= 0 ? (
              <>
                <span
                  className="growth-bar-invested"
                  style={{ flexGrow: growth.invested, flexShrink: 0, flexBasis: 0 }}
                />
                <span
                  className="growth-bar-gain"
                  style={{ flexGrow: Math.max(growth.gain, 0), flexShrink: 0, flexBasis: 0 }}
                />
              </>
            ) : (
              <>
                <span
                  className="growth-bar-invested"
                  style={{
                    flexGrow: Math.max(growth.current, 0),
                    flexShrink: 0,
                    flexBasis: 0,
                  }}
                />
                <span
                  className="growth-bar-loss"
                  style={{
                    flexGrow: Math.abs(growth.gain),
                    flexShrink: 0,
                    flexBasis: 0,
                  }}
                />
              </>
            )}
          </div>
        </div>
      )}
      {(concentration || peText) && (
        <ul className="desk-chips">
          {concentration ? (
            <>
              <li>{concentration.count} holdings</li>
              <li>Top 5 {formatPct(concentration.top5)}</li>
              <li>Top 10 {formatPct(concentration.top10)}</li>
            </>
          ) : null}
          {peText ? <li>PE {peText}</li> : null}
        </ul>
      )}
      {flags.length > 0 && (
        <ul className="insight-flags">
          {flags.map((flag) => (
            <li key={`${flag.kind}-${flag.text}`}>{flag.text}</li>
          ))}
        </ul>
      )}
      {asset?.length || equity?.length || sectors?.length ? (
        <div className="desk-mix">
          <MixMeters title="Asset" meters={asset} />
          <MixMeters title="Equity split" meters={equity} />
          <MixMeters title="Sectors" meters={sectors} />
        </div>
      ) : null}
    </div>
  );
}

export function OverlapBlock({
  rows,
  twoBaskets,
}: {
  rows: OverlapRow[];
  twoBaskets: boolean;
}) {
  if (!twoBaskets) {
    return (
      <p className="insight-empty">Need two baskets with filings to score overlap.</p>
    );
  }
  if (!rows.length) {
    return (
      <p className="insight-empty">Need filings on two baskets to score overlap.</p>
    );
  }
  return (
    <div className="insight-basket">
      <div className="table-scroll">
        <Table className="insight-table">
          <TableHeader>
            <TableRow>
              <TableHead>Basket</TableHead>
              <TableHead className="text-right">Overlap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell data-label="Basket">{row.otherName}</TableCell>
                <TableCell className="text-right" data-label="Overlap">
                  {formatPct(row.pct)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.map((row) =>
        row.names.length ? (
          <div key={`${row.key}-names`}>
            <h4>Shared with {row.otherName}</h4>
            <Table className="insight-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Holding</TableHead>
                  <TableHead className="text-right">Min weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {row.names.map((h, i) => (
                  <TableRow key={h.isin || `${h.name}-${i}`}>
                    <TableCell>{h.name}</TableCell>
                    <TableCell className="text-right">
                      {formatPct(h.minWeight)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null,
      )}
    </div>
  );
}
