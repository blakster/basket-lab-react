export type SchemeCode = string;

export type FundLine = {
  schemeCode: SchemeCode;
  schemeName: string;
  isin: string | null;
  weight: number;
  locked: boolean;
};

export type Basket = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  funds: FundLine[];
};

export type Period =
  | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "10Y" | "Custom";

export type LabSettings = {
  mode: "lumpsum" | "sip";
  amount: number;
  period: Period;
  customStart: string | null;
  customEnd: string | null;
};

export type NavPoint = { date: string; nav: number };

export type TimePoint = { x: string; y: number; drawdown: number };

export type BasketStats = {
  initial: number;
  final: number;
  abs: number;
  cagr: number;
  mdd: number;
};

export type BacktestResult = {
  basketId: string;
  series: TimePoint[];
  stats: BasketStats;
  error?: "no-nav";
};

export type SearchHit = {
  schemeCode: SchemeCode;
  schemeName: string;
  isin: string | null;
};
