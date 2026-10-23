import type { KpiData, KpiEntity, KpiFix, PriceData } from './types';
import { nf } from './format';
import type { Prov } from './prov';
import { mayaReport } from './sources';

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
  { key: 'pe', label: 'מכפיל רווח (P/E), LTM', unit: 'x', flow: false, derived: true, group: 'שוק ההון' },
  { key: 'mcap', label: 'שווי שוק', unit: 'm', flow: false, derived: true, group: 'שוק ההון' },
];
export const KPI_BY_KEY = Object.fromEntries(KPI_DEFS.map((d) => [d.key, d]));

export interface Point { period: string; end: string; v: number | null }
const qOf = (p: string) => (p.endsWith('FY') ? 4 : Number(p.slice(5)));
const yOf = (p: string) => Number(p.slice(0, 4));
export const KPI_CONCEPTS: Record<string, string> = {
  profit: 'ProfitLossAttributableToOwnersOfParent', oci: 'ComprehensiveIncomeAttributableToOwnersOfParent', pretax: 'ProfitLossBeforeTax', revenue: 'Revenue',
  cfo: 'CashFlowsFromUsedInOperatingActivities', eps: 'BasicEarningsLossPerShare', equity: 'EquityAttributableToOwnersOfParent', assets: 'Assets',
};
const NAMES: Record<string, string> = { phoenix: 'הפניקס', harel: 'הראל', migdal: 'מגדל', clal: 'כלל', menora: 'מנורה מבטחים', hachshara: 'הכשרה', ayalon: 'איילון', altshuler: 'אלטשולר שחם', more: 'מור', analyst: 'אנליסט', yelin: 'ילין לפידות', more_gemel: 'מור גמל ופנסיה', ibi: 'אי.בי.אי' };
const STATUS: Record<string, string> = { verified: 'אומת מול הדוח', fy: 'שנתי', corrected: 'תוקן', unverified: 'לא אומת מול הדוח', withheld: 'הושמט', cumulative: 'מצטבר' };
/** Period as shown on the site: Q2'26, FY'25. */
export const periodTag = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `Q${p.slice(5)}'${p.slice(2, 4)}`);
const none = (title: string, why: string): Prov => ({ k: 'none', title, why });
const MUL = (v: number, d = 2) => `${nf(v, d)}x`;
/** Last-twelve-months dividend per share, in agorot, by ex-date. */
export function ttmDividend(p: PriceData): number {
  const lo = `${Number(p.asof.slice(0, 4)) - 1}${p.asof.slice(4)}`;
  return p.dividends.filter(([d]) => d > lo).reduce((s, [, v]) => s + v, 0);
}
export const priceProv = (p: PriceData, title = 'מחיר סגירה אחרון'): Prov => ({ k: 'price', title, value: `${nf(p.last / 100, 2)} ש"ח`, ticker: p.ticker, vendor: p.source, date: p.asof });
export const dividendProv = (p: PriceData, title = 'דיבידנד למניה, LTM (לפי יום האקס)'): Prov => ({ k: 'price', title, value: `${nf(ttmDividend(p) / 100, 2)} ש"ח`, ticker: p.ticker, vendor: p.source, date: p.asof });
/** Dividend yield = LTM dividend per share over the last close. The one price-based figure on the valuation page. */
export function dividendYield(p: PriceData): number | null { const d = ttmDividend(p); return d > 0 && p.last > 0 ? (d / p.last) * 100 : null; }
export function dividendYieldProv(p: PriceData): Prov {
  const y = dividendYield(p);
  if (y == null) return none('תשואת דיבידנד', 'לא חולק דיבידנד (לפי יום האקס) ב-12 החודשים שעד תאריך המחיר האחרון');
  return { k: 'calc', title: 'תשואת דיבידנד', value: `${nf(y, 1)}%`, unit: '%', formula: 'תשואה = דיבידנד למניה LTM ÷ מחיר סגירה אחרון × 100',
    inputs: [{ label: 'דיבידנד למניה, LTM', v: `${nf(ttmDividend(p) / 100, 2)} ש"ח`, src: () => dividendProv(p) }, { label: 'מחיר סגירה אחרון', v: `${nf(p.last / 100, 2)} ש"ח`, src: () => priceProv(p) }] };
}

export const periodLabelShort = (p: string) => (p.endsWith('FY') ? `Q4'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);

/** Quarterly, trailing-twelve-month and annual series for one company, built from the headline figures tagged in each periodic report. */
export class CompanyKpi {
  readonly quarters: { period: string; end: string; y: number; q: number }[];
  private raw: Record<string, (number | null)[]>;
  private idx = new Map<string, number>();
  private rid: (number | null)[];
  private fix: Record<string, KpiFix>;
  private statusOf: string[];
  private canon: NonNullable<KpiData['companies'][string]['canon']>;
  readonly filer: KpiData['companies'][string]['filer'];
  /** the company itself at 100%, from its own statements, where the listed filer is another entity (Yelin Lapidot under Atrao): the front page reads this */
  readonly entity: CompanyKpi | null;
  constructor(readonly id: string, d: KpiData['companies'][string], private price: PriceData | null, private ent?: KpiEntity) {
    this.rid = d.rid ?? d.periods.map(() => null);
    this.fix = d.fix ?? {};
    this.statusOf = d.status ?? d.periods.map(() => 'unverified');
    this.quarters = d.periods.map((p, i) => ({ period: p, end: d.end[i], y: yOf(p), q: qOf(p) }));
    d.periods.forEach((p, i) => this.idx.set(p, i));
    // one value per figure: where the printed statement and the tag differ by rounding, the printed figure is the one on screen
    this.canon = d.canon ?? {};
    this.filer = d.filer;
    this.entity = d.entity ? new CompanyKpi(id, { periods: d.entity.periods, end: d.entity.end, values: d.entity.values, canon: d.entity.canon, status: d.entity.periods.map(() => 'verified') }, null, d.entity) : null;
    this.raw = Object.fromEntries(Object.entries(d.values).map(([k, arr]) => [k, arr.map((v, i) => this.canon[k]?.[d.periods[i]]?.[0] ?? v)]));
  }
  private at(key: string, y: number, q: number): number | null {
    const i = this.idx.get(q === 4 ? `${y}FY` : `${y}Q${q}`);
    return i == null ? null : this.raw[key]?.[i] ?? null;
  }
  /** Flow for a single quarter. Q4 is the annual figure less the first three quarters. */
  quarter(key: string, y: number, q: number): number | null {
    if (q < 4) return this.at(key, y, q);
    // FY less the nine months as printed, where the tag series would land a rounding away from the statements (canon_kpi.py)
    const c4 = this.canon[key]?.[`${y}Q4`];
    if (c4) return c4[0];
    const fy = this.at(key, y, 4), a = this.at(key, y, 1), b = this.at(key, y, 2), c = this.at(key, y, 3);
    return fy == null || a == null || b == null || c == null ? null : fy - a - b - c;
  }
  private ltm(key: string, i: number): number | null {
    // at a year end the annual figure as printed, as on the company page and the peer table
    if (this.quarters[i]?.q === 4 && this.raw[key]?.[i] != null) return this.raw[key][i];
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

  /** MAYA report the period's figures were read from. */
  reportId(period: string): number | null { const i = this.idx.get(period); return i == null ? null : this.rid[i]; }

  /* ---------- provenance: every figure explained from the filings ---------- */
  private cur(key: string, period: string): number | null { const i = this.idx.get(period); return i == null ? null : this.raw[key]?.[i] ?? null; }
  private show(key: string, v: number): string { return key === 'eps' ? `${nf(v, 2)} ש"ח` : `${nf(v, 0)} אלפי ש"ח`; }
  private title(key: string, period: string) { return `${KPI_BY_KEY[key]?.label ?? key}, ${periodTag(period)}`; }
  private xbrl(key: string, period: string, note?: string, value?: number | null, status?: string): Prov {
    if (this.ent) {
      const s = this.ent.src[key]?.[period], eq = key === 'equity' && this.ent.eq_alt, alt = this.ent.alt?.includes(key);
      if (!s) return none(this.title(key, period), 'השורה אינה בדוחות שנקראו לתקופה זו');
      return this.report(key, period, { rid: s[0], pg: s[1] }, [`${this.ent.name}, דוחות כספיים (100%) · שורה: ${s[2]}`, eq ? 'אין בדוח שורת הון המיוחס לבעלי המניות; מוצג סך ההון' : alt ? `אין בדוח שורת ייחוס לבעלי המניות; מוצגת שורת ${key === 'oci' ? 'סך הרווח הכולל' : 'הרווח לתקופה'}` : '', s[3] ? 'נגזר מהנתונים המצטברים' : '', note ?? ''].filter(Boolean).join(' · '));
    }
    const cn = value == null ? this.canon[key]?.[period] : undefined;
    if (cn) return this.report(key, period, { rid: cn[2], pg: cn[3] }, cn[1] === 0 ? 'כפי שהודפס בדוח. התג ב-XBRL ריק (0)' : `כפי שהודפס בדוח. בתג ה-XBRL: ${this.show(key, cn[1])} (הפרש עיגול)`);
    const i = this.idx.get(period), v = value ?? this.cur(key, period);
    if (i == null || v == null) return none(this.title(key, period), 'התקופה אינה בדוחות שנקראו או שהמושג אינו מתויג בה');
    const st = status ?? (KPI_BY_KEY[key]?.flow ? this.statusOf[i] : this.statusOf[i] === 'fy' ? 'fy' : undefined);
    return { k: 'xbrl', title: this.title(key, period), value: this.show(key, v), company: this.filer?.name ?? NAMES[this.id] ?? this.id, period: periodTag(period), rid: this.rid[i], concept: KPI_CONCEPTS[key], status: st ? STATUS[st] : undefined, note: [note, this.filer?.note].filter(Boolean).join(' · ') || undefined };
  }
  private report(key: string, period: string, f: { rid?: number | null; pg?: number | null }, note: string): Prov {
    const i = this.idx.get(period), v = this.cur(key, period);
    if (i == null || v == null) return none(this.title(key, period), 'אין ערך');
    const rid = f.rid ?? this.rid[i];
    return { k: 'report', title: this.title(key, period), value: this.show(key, v), url: rid ? mayaReport(rid) : null, pg: f.pg ?? null, doc: this.filer?.name ?? this.ent?.name ?? NAMES[this.id], period: periodTag(period), note: [note, this.filer?.note].filter(Boolean).join(' · ') };
  }
  /** A single quarter of a flow: the tag, the printed figure, the tagged year-to-date less the quarters before it, or FY less the first three quarters. */
  private qProv(key: string, period: string): Prov {
    const t = this.title(key, period);
    if (period.endsWith('FY')) {
      const y = yOf(period), v = this.quarter(key, y, 4);
      if (v == null) return none(t, 'חסר אחד מהרבעונים הראשונים של השנה, ולכן Q4 אינו ניתן לחישוב');
      const c4 = this.canon[key]?.[`${y}Q4`], yy = String(y).slice(2);
      if (c4) {
        const n9 = this.cur(key, period)! - c4[0];
        return { k: 'calc', title: t, value: this.show(key, v), formula: `Q4'${yy} = FY'${yy} − 9M'${yy} (כפי שהודפסו)`,
          inputs: [{ label: `FY'${yy}`, v: this.show(key, this.cur(key, period)!), src: () => this.xbrl(key, period) },
            { label: `9M'${yy}`, v: this.show(key, n9), src: () => ({ k: 'report', title: `${KPI_BY_KEY[key]?.label ?? key}, 9M'${yy}`, value: this.show(key, n9), url: c4[2] ? mayaReport(c4[2]) : null, pg: c4[3], doc: this.filer?.name ?? NAMES[this.id], period: `9M'${yy}`, note: 'תשעת החודשים כפי שהודפסו בדוח הרבעון השלישי' }) }] };
      }
      const ps = [`${y}Q1`, `${y}Q2`, `${y}Q3`];
      return { k: 'calc', title: t, value: this.show(key, v), formula: `Q4'${String(y).slice(2)} = FY'${String(y).slice(2)} − Q1 − Q2 − Q3`,
        inputs: [{ label: `FY'${String(y).slice(2)}`, v: this.show(key, this.cur(key, period)!), src: () => this.xbrl(key, period) }, ...ps.map((p) => ({ label: periodTag(p), v: this.show(key, this.cur(key, p)!), src: () => this.qProv(key, p) }))] };
    }
    const f = this.fix[period];
    if (f?.t === 'withheld') return none(t, 'המסנן אינו מבחין בין רבעון לתקופה מצטברת בדוח של חברה זו, והערך הושמט במקום להציג מספר שגוי');
    if (f?.t === 'printed') return key === 'profit' ? this.report(key, period, f, 'הרבעון כפי שהודפס בדוח; התג ב-XBRL אינו תואם אף אחד מהמספרים המודפסים') : none(t, 'התג ב-XBRL אינו תואם את הדוח המודפס, ושורה זו אינה נקראה ממנו');
    if (f?.t === 'diff') {
      if (key === 'profit' && f.profit) return this.report(key, period, f.profit, 'הרבעון כפי שהודפס בדוח; ב-XBRL התג מצטבר');
      const v = this.cur(key, period);
      if (v == null) return none(t, f.gap ? 'התג מצטבר ואחד הרבעונים הקודמים אינו נקי, ולכן ההפרש אינו ניתן לחישוב' : 'אין ערך');
      const prior = f.from ?? [], ytd = key === 'profit' && f.raw != null ? f.raw : v + prior.reduce((s, p) => s + (this.cur(key, p) ?? 0), 0);
      return { k: 'calc', title: t, value: this.show(key, v), formula: `רבעון = תג מצטבר (${prior.length ? `Q1–Q${prior.length}` : ''} עד ${periodTag(period)}) − הרבעונים הקודמים`,
        inputs: [{ label: `תג מצטבר, ${periodTag(period)}`, v: this.show(key, ytd), src: () => this.xbrl(key, period, 'מתויג כתקופה מצטברת, לא כרבעון בודד', ytd, 'cumulative') }, ...prior.map((p) => ({ label: periodTag(p), v: this.show(key, this.cur(key, p) ?? 0), src: () => this.qProv(key, p) }))] };
    }
    return this.xbrl(key, period);
  }
  private ltmProv(key: string, i: number): Prov {
    const t = this.quarters[i], title = `${KPI_BY_KEY[key].label}, LTM עד ${periodTag(t.period)}`, v = this.ltm(key, i);
    if (v == null) return none(title, 'חסר רבעון באחד מארבעת הרבעונים האחרונים');
    if (t.q === 4 && this.raw[key]?.[i] != null) return this.xbrl(key, t.period, 'LTM בסוף שנה = הנתון השנתי');
    const ps = [0, 1, 2, 3].map((k) => this.quarters[i - k].period).reverse();
    return { k: 'calc', title, value: this.show(key, v), formula: 'LTM = סכום ארבעת הרבעונים האחרונים', inputs: ps.map((p) => ({ label: periodTag(p), v: this.show(key, this.quarter(key, yOf(p), qOf(p)) ?? 0), src: () => this.qProv(key, p) })) };
  }
  /** Shares implied by the latest annual profit / basic EPS at or before quarter i. */
  sharesProv(i = this.quarters.length - 1): Prov {
    for (let k = i; k >= 0; k--) {
      const t = this.quarters[k];
      if (t.q !== 4) continue;
      const sh = this.shares(i);
      if (sh == null) break;
      return { k: 'calc', title: `מניות, אומדן לפי FY'${String(t.y).slice(2)}`, value: `${nf(sh / 1e6, 1)} מיליון`, formula: 'מניות = רווח FY לבעלי המניות × 1,000 ÷ רווח למניה בסיסי', est: true,
        inputs: [{ label: 'רווח FY', v: this.show('profit', this.cur('profit', t.period)!), src: () => this.xbrl('profit', t.period) }, { label: 'רווח למניה, FY', v: this.show('eps', this.cur('eps', t.period)!), src: () => this.xbrl('eps', t.period) }] };
    }
    return none('מניות', 'אין רווח למניה שנתי לחברה זו, ולכן מספר המניות אינו ניתן לגזירה');
  }
  private priceDate(end: string): string | null { if (!this.price) return null; let d: string | null = null; for (let i = 0; i < this.price.dates.length && this.price.dates[i] <= end; i++) d = this.price.dates[i]; return d; }
  /** Market value at a price: `px` in NIS and its provenance. */
  private mcapProv(i: number, px: number | null, pxSrc: () => Prov, label: string): Prov {
    const sh = this.shares(i);
    if (px == null || sh == null) return none('שווי שוק', px == null ? 'אין קובץ מחיר לחברה' : 'מספר המניות אינו ניתן לגזירה');
    return { k: 'calc', title: 'שווי שוק', value: `${nf((px * sh) / 1e6, 0)} מיליוני ש"ח`, formula: 'שווי שוק = מחיר × מניות', est: true,
      inputs: [{ label, v: `${nf(px, 2)} ש"ח`, src: pxSrc }, { label: 'מניות', v: `${nf(sh / 1e6, 1)} מיליון`, src: () => this.sharesProv(i) }] };
  }
  /** Market value at the latest close of `p` (valuation page). */
  marketCapNow(p: PriceData): Prov { return this.mcapProv(this.quarters.length - 1, p.last / 100, () => priceProv(p), 'מחיר סגירה אחרון'); }
  /** P/B or P/E (LTM) at the latest close of `p`, on the latest period's figures. */
  multipleNow(key: 'pb' | 'pe', p: PriceData): Prov {
    const i = this.quarters.length - 1, pe = key === 'pe', per = this.quarters[i].period;
    const px = p.last / 100, sh = this.shares(i), den = pe ? this.ltm('profit', i) : this.at('equity', this.quarters[i].y, this.quarters[i].q);
    const title = pe ? 'מכפיל רווח (P/E), LTM' : 'מכפיל הון (P/B)';
    if (sh == null || !den || (pe && den <= 0)) return none(title, !den || den <= 0 ? 'אין רווח LTM חיובי' : 'מספר המניות אינו ניתן לגזירה');
    const mc = (px * sh) / 1e6, v = mc / (den / 1000);
    return { k: 'calc', title, value: MUL(v), formula: pe ? 'P/E = שווי שוק ÷ רווח נקי LTM' : 'P/B = שווי שוק ÷ הון לבעלי המניות', est: true,
      inputs: [{ label: 'שווי שוק', v: `${nf(mc, 0)} מיליוני ש"ח`, src: () => this.marketCapNow(p) }, pe ? { label: `רווח LTM, ${periodTag(per)}`, v: `${nf(den / 1000, 0)} מיליוני ש"ח`, src: () => this.ltmProv('profit', i) } : { label: `הון, ${periodTag(per)}`, v: `${nf(den / 1000, 0)} מיליוני ש"ח`, src: () => this.xbrl('equity', per) }] };
  }
  /** Where a headline figure comes from. Reported values open the filing; derived ones show the formula and open their components. */
  explain(key: string, basis: Basis, period: string): Prov {
    const i = this.idx.get(period), def = KPI_BY_KEY[key];
    if (!def) return none(key, 'מדד לא מוכר');
    if (i == null) return none(`${def.label}, ${periodTag(period)}`, 'התקופה אינה בדוחות שנקראו');
    const t = this.quarters[i], tag = periodTag(period), v = this.value(key, i, basis);
    const title = `${def.label}, ${key === 'roe' ? `LTM עד ${tag}` : tag}`;
    switch (key) {
      case 'roe': {
        const j = this.quarters[i - 4];
        if (v == null || !j) return none(title, 'חסר רווח LTM או הון לפני שנה');
        const p0 = j.period;
        return { k: 'calc', title, value: `${nf(v, 1)}%`, unit: '%', formula: 'ROE = רווח נקי LTM ÷ ממוצע (הון סוף תקופה, הון לפני שנה) × 100',
          inputs: [{ label: 'רווח נקי LTM', v: this.show('profit', this.ltm('profit', i)!), src: () => this.ltmProv('profit', i) }, { label: `הון, ${tag}`, v: this.show('equity', this.cur('equity', period)!), src: () => this.xbrl('equity', period) }, { label: `הון, ${periodTag(p0)}`, v: this.show('equity', this.cur('equity', p0)!), src: () => this.xbrl('equity', p0) }] };
      }
      case 'leverage': {
        if (v == null) return none(title, 'חסר סך נכסים או הון');
        return { k: 'calc', title, value: MUL(v), formula: 'נכסים להון = סך הנכסים ÷ הון לבעלי המניות',
          inputs: [{ label: 'סך הנכסים', v: this.show('assets', this.cur('assets', period)!), src: () => this.xbrl('assets', period) }, { label: 'הון', v: this.show('equity', this.cur('equity', period)!), src: () => this.xbrl('equity', period) }] };
      }
      case 'mcap': {
        const d = this.priceDate(t.end), px = this.priceAt(t.end);
        return this.mcapProv(i, px, () => (d && this.price ? { k: 'price', title: `מחיר סגירה ל-${tag}`, value: `${nf(px!, 2)} ש"ח`, ticker: this.price.ticker, vendor: this.price.source, date: d } : none('מחיר', 'אין מחיר')), `מחיר סגירה בסוף ${tag}`);
      }
      case 'pb': case 'pe': {
        const mc = this.value('mcap', i, basis);
        const den = key === 'pb' ? this.at('equity', t.y, t.q) : this.ltm('profit', i);
        if (v == null || mc == null || den == null) return none(title, key === 'pe' ? 'אין רווח LTM חיובי או מחיר' : 'אין מחיר או הון');
        return { k: 'calc', title, value: MUL(v), formula: key === 'pe' ? 'P/E = שווי שוק ÷ רווח נקי LTM' : 'P/B = שווי שוק ÷ הון לבעלי המניות', est: true,
          inputs: [{ label: 'שווי שוק', v: `${nf(mc, 0)} מיליוני ש"ח`, src: () => this.explain('mcap', basis, period) }, key === 'pe' ? { label: 'רווח LTM', v: this.show('profit', den), src: () => this.ltmProv('profit', i) } : { label: 'הון', v: this.show('equity', den), src: () => this.xbrl('equity', period) }] };
      }
    }
    if (!def.flow) return this.xbrl(key, period);
    if (basis === 'fy') return period.endsWith('FY') ? this.xbrl(key, period) : none(title, 'הבסיס השנתי קיים לתקופות FY בלבד');
    return basis === 'ltm' ? this.ltmProv(key, i) : this.qProv(key, period);
  }
}
