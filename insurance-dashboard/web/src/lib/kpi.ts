import type { KpiData, PriceData } from './types';

export type Basis = 'q' | 'ltm' | 'fy';
export interface KpiDef { key: string; label: string; unit: 'm' | 'nis' | '%' | 'x'; flow: boolean; derived?: boolean; group: 'דוחות' | 'יחסים' | 'שוק ההון' }

export const KPI_DEFS: KpiDef[] = [
  { key: 'profit', label: 'רווח נקי לבעלי המניות', unit: 'm', flow: true, group: 'דוחות' },
  { key: 'oci', label: 'רווח כולל לבעלי המניות', unit: 'm', flow: true, group: 'דוחות' },
  { key: 'pretax', label: 'רווח לפני מס', unit: 'm', flow: true, group: 'דוחות' },
  { key: 'equity', label: 'הון לבעלי המניות', unit: 'm', flow: false, group: 'דוחות' },
  { key: 'assets', label: 'סך הנכסים', unit: 'm', flow: false, group: 'דוחות' },
  { key: 'eps', label: 'רווח למניה', unit: 'nis', flow: true, group: 'דוחות' },
  { key: 'roe', label: 'תשואה על ההון (ROE)', unit: '%', flow: false, derived: true, group: 'יחסים' },
  { key: 'leverage', label: 'נכסים להון', unit: 'x', flow: false, derived: true, group: 'יחסים' },
  { key: 'pb', label: 'מכפיל הון (P/B)', unit: 'x', flow: false, derived: true, group: 'שוק ההון' },
  { key: 'pe', label: 'מכפיל רווח (P/E), 12 חודשים', unit: 'x', flow: false, derived: true, group: 'שוק ההון' },
  { key: 'mcap', label: 'שווי שוק', unit: 'm', flow: false, derived: true, group: 'שוק ההון' },
];
export const KPI_BY_KEY = Object.fromEntries(KPI_DEFS.map((d) => [d.key, d]));

export interface Point { period: string; end: string; v: number | null }
const qOf = (p: string) => (p.endsWith('FY') ? 4 : Number(p.slice(5)));
const yOf = (p: string) => Number(p.slice(0, 4));
export const periodLabelShort = (p: string) => (p.endsWith('FY') ? `Q4'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);

/** Quarterly, trailing-twelve-month and annual series for one company, built from the headline figures tagged in each periodic report. */
export class CompanyKpi {
  readonly quarters: { period: string; end: string; y: number; q: number }[];
  private raw: Record<string, (number | null)[]>;
  private idx = new Map<string, number>();
  constructor(readonly id: string, d: KpiData['companies'][string], private price: PriceData | null) {
    this.quarters = d.periods.map((p, i) => ({ period: p, end: d.end[i], y: yOf(p), q: qOf(p) }));
    this.raw = d.values;
    d.periods.forEach((p, i) => this.idx.set(p, i));
  }
  private at(key: string, y: number, q: number): number | null {
    const i = this.idx.get(q === 4 ? `${y}FY` : `${y}Q${q}`);
    return i == null ? null : this.raw[key]?.[i] ?? null;
  }
  /** Flow for a single quarter. Q4 is the annual figure less the first three quarters. */
  quarter(key: string, y: number, q: number): number | null {
    if (q < 4) return this.at(key, y, q);
    const fy = this.at(key, y, 4), a = this.at(key, y, 1), b = this.at(key, y, 2), c = this.at(key, y, 3);
    return fy == null || a == null || b == null || c == null ? null : fy - a - b - c;
  }
  private ltm(key: string, i: number): number | null {
    let s = 0;
    for (let k = 0; k < 4; k++) { const t = this.quarters[i - k]; if (!t) return null; const v = this.quarter(key, t.y, t.q); if (v == null) return null; s += v; }
    return s;
  }
  private priceAt(end: string): number | null {
    if (!this.price) return null;
    let v: number | null = null;
    for (let i = 0; i < this.price.dates.length && this.price.dates[i] <= end; i++) v = this.price.close[i];
    return v == null ? null : v / 100;
  }
  /** Shares implied by annual profit / basic EPS of the latest full year at or before the period. Derived, not reported. */
  shares(i: number): number | null {
    for (let k = i; k >= 0; k--) {
      const t = this.quarters[k];
      if (t.q !== 4) continue;
      const p = this.at('profit', t.y, 4), e = this.at('eps', t.y, 4);
      if (p != null && e) return (p * 1000) / e;
    }
    return null;
  }
  private value(key: string, i: number, basis: Basis): number | null {
    const t = this.quarters[i], def = KPI_BY_KEY[key];
    const stock = (k: string) => this.at(k, t.y, t.q);
    switch (key) {
      case 'roe': { const p = this.ltm('profit', i), e1 = stock('equity'), e0 = this.quarters[i - 4] ? this.at('equity', this.quarters[i - 4].y, this.quarters[i - 4].q) : null; return p != null && e1 && e0 ? (p / ((e1 + e0) / 2)) * 100 : null; }
      case 'leverage': { const a = stock('assets'), e = stock('equity'); return a && e ? a / e : null; }
      case 'mcap': { const px = this.priceAt(t.end), sh = this.shares(i); return px && sh ? (px * sh) / 1e6 : null; }
      case 'pb': { const m = this.value('mcap', i, basis), e = stock('equity'); return m && e ? m / (e / 1000) : null; }
      case 'pe': { const m = this.value('mcap', i, basis), p = this.ltm('profit', i); return m && p && p > 0 ? m / (p / 1000) : null; }
    }
    const scale = def.unit === 'm' ? 1000 : 1;
    if (!def.flow) return stock(key) == null ? null : stock(key)! / scale;
    const v = basis === 'q' ? this.quarter(key, t.y, t.q) : basis === 'ltm' ? this.ltm(key, i) : t.q === 4 ? this.at(key, t.y, 4) : null;
    return v == null ? null : v / scale;
  }
  series(key: string, basis: Basis): Point[] {
    const def = KPI_BY_KEY[key];
    return this.quarters.map((t, i) => ({ period: t.period, end: t.end, v: this.value(key, i, basis) }))
      .filter((p) => !(basis === 'fy' && (def.flow || key === 'roe') && !p.period.endsWith('FY')));
  }
  latest(key: string, basis: Basis = 'ltm'): Point | null {
    const s = this.series(key, basis);
    for (let i = s.length - 1; i >= 0; i--) if (s[i].v != null) return s[i];
    return null;
  }
  lastPrice(): number | null { return this.price ? this.price.last / 100 : null; }
  lastShares(): number | null { return this.shares(this.quarters.length - 1); }
}
