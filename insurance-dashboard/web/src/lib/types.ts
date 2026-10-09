export type Family = 'pension' | 'gemel' | 'insurance';

export interface Fund {
  id: number; fam: Family; prod: string; name: string; grp: string; mgr: string;
  assets: number | null; fee: number | null; depfee: number | null; ym: number | null; ytd: number | null; y12: number | null;
  y3: number | null; y5: number | null; a3: number | null; a5: number | null; sd: number | null; sharpe: number | null; alpha: number | null;
  stock: number | null; foreign: number | null; fx: number | null; liquid: number | null;
  spec: string | null; target: string | null; since: number | null; net12: number | null; tr12: number | null;
}

export interface QaCheck { name: string; ok: boolean; status?: 'pass' | 'review' | 'fail'; detail: string }

export interface MarketData {
  meta: { asof: number; generated: string; source: string; units: string; funds_latest: number };
  products: { key: string; label: string; family: Family }[];
  families: Record<Family, string>;
  groups: string[];
  periods: number[];
  cols: string[];
  rows: number[][];
  funds: Fund[];
  qa: { checks: QaCheck[]; notes: string[] };
}

export interface CompanyPeriod { id: string; label: string; type: string; end: string; months: number }
export interface CompanyMetric { entity: 'F' | 'I'; sheet: string; group: string; label: string; dim?: string; unit: 'k' | 'm' | 'nis' | 'pct'; header: boolean; order: number }
export interface CompanyData {
  company: string;
  sources: { entity: 'F' | 'I'; name: string; doc: string; url: string | null; pages: number | null }[];
  groups: Record<string, string>;
  sheets: { code: string; entity: 'F' | 'I'; title: string; pages: string; group: string }[];
  periods: CompanyPeriod[];
  metrics: CompanyMetric[];
  facts: [number, number, number, number | null][]; // metricIdx, periodIdx, value, pdf page
  stats: Record<string, unknown>;
}

export interface RegistryCompany {
  id: string; name_he: string; name_en: string; kind: 'insurance_group' | 'fund_house';
  market_group: string | null; has_financials: boolean; docs: number; has_price: boolean;
  filings: { period: string; end: string; entity: string; name: string; doc: string; url: string | null; pages: number | null }[];
}

export interface DocEntry { id: number; date: string; type: 'annual' | 'quarterly' | 'presentation' | 'solvency'; period: string; title: string; pages: number | null; kb: number | null; en: boolean; url: string }
export interface DocsData { source: string; docs: DocEntry[] }
export interface PriceData { ticker: string; source: string; unit: 'agorot'; asof: string; last: number; dates: string[]; close: number[]; dividends: [string, number][] }
