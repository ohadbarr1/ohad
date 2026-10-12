import type { Family, Fund, MarketData } from './types';
import type { Prov } from './prov';
import type { RegDs } from './sources';
import { nf, sn } from './format';

/** A selection of products: everything, a family, or a single product. */
export interface ProductSet { id: string; label: string; sub?: boolean; has: Set<number> }
export type Win = 'm' | 'q' | 'ytd' | 'ltm';
export type MetricKey = 'assets' | 'share' | 'growth' | 'organic' | 'transfers' | 'netflow' | 'rate' | 'fee' | 'ret';

interface Cell { a: number; af: number; dep: number; wd: number; tr: number; fa: number; fn: number; fd: number; yn: number; yd: number }
export interface MetricDef { key: MetricKey; label: string; short: string; unit: '%' | 'bn'; win: boolean; ratio: boolean; dec?: number }

export const WIN_LABEL: Record<Win, string> = { m: 'חודש', q: 'QTD', ytd: 'YTD', ltm: 'LTM' };

export const METRIC_DEFS: MetricDef[] = [
  { key: 'assets', label: 'נכסים מנוהלים', short: 'נכסים', unit: 'bn', win: false, ratio: false },
  { key: 'share', label: 'נתח שוק', short: 'נתח שוק', unit: '%', win: false, ratio: false },
  { key: 'growth', label: 'שינוי בנכסים', short: 'שינוי בנכסים', unit: '%', win: true, ratio: true },
  { key: 'organic', label: 'צבירה אורגנית (הפקדות פחות משיכות)', short: 'צבירה אורגנית', unit: 'bn', win: true, ratio: false },
  { key: 'transfers', label: 'העברות (ניוד) נטו', short: 'ניוד נטו', unit: 'bn', win: true, ratio: false },
  { key: 'netflow', label: 'צבירה נטו כולל ניוד', short: 'צבירה כולל ניוד', unit: 'bn', win: true, ratio: false },
  { key: 'rate', label: 'צבירה אורגנית כ-% מנכסי פתיחה', short: 'צבירה % מנכסים', unit: '%', win: true, ratio: true },
  { key: 'fee', label: 'דמי ניהול ממוצעים (משוקללים בנכסים)', short: 'דמי ניהול', unit: '%', win: false, ratio: true, dec: 2 },
  { key: 'ret', label: 'תשואה (משוקללת בנכסים, ריבית דריבית)', short: 'תשואה', unit: '%', win: true, ratio: true },
];
export const METRIC_BY_KEY = Object.fromEntries(METRIC_DEFS.map((m) => [m.key, m])) as Record<MetricKey, MetricDef>;

export class Market {
  readonly P: number[];
  readonly LAST: number;
  private rowsByP: number[][][];
  private INS: boolean[];
  private memo = new Map<string, Cell>();
  readonly sets: ProductSet[];
  private setMap: Record<string, ProductSet>;

  constructor(readonly d: MarketData) {
    this.P = d.periods; this.LAST = d.periods.length - 1;
    this.rowsByP = d.periods.map(() => []);
    d.rows.forEach((r) => this.rowsByP[r[0]].push(r));
    this.INS = d.products.map((p) => p.family === 'insurance');
    const all = d.products.map((_, i) => i);
    const fam = (f: Family) => all.filter((i) => d.products[i].family === f);
    this.sets = [{ id: 'all', label: 'כל המוצרים', has: new Set(all) }];
    (['pension', 'gemel', 'insurance'] as Family[]).forEach((f) => this.sets.push({ id: 'fam:' + f, label: d.families[f], has: new Set(fam(f)) }));
    d.products.forEach((p, i) => this.sets.push({ id: 'p:' + p.key, label: p.label, sub: true, has: new Set([i]) }));
    this.setMap = Object.fromEntries(this.sets.map((s) => [s.id, s]));
  }

  groupIndex(name: string): number { return this.d.groups.indexOf(name); }
  productSetId(key: string): string { return 'p:' + key; }
  plabel(pi: number): string {
    const MN = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
    return `${MN[this.P[pi] % 100 - 1]} ${Math.floor(this.P[pi] / 100)}`;
  }

  cell(pi: number, setId: string, g: number): Cell {
    const k = `${pi}|${setId}|${g}`;
    const hit = this.memo.get(k);
    if (hit) return hit;
    const s = this.setMap[setId];
    const o: Cell = { a: 0, af: 0, dep: 0, wd: 0, tr: 0, fa: 0, fn: 0, fd: 0, yn: 0, yd: 0 };
    if (pi >= 0) for (const r of this.rowsByP[pi]) {
      if (!s.has.has(r[1]) || (g !== -1 && r[2] !== g)) continue;
      o.a += r[3]; if (!this.INS[r[1]]) o.af += r[3];
      o.dep += r[4]; o.wd += r[5]; o.tr += r[6]; o.fa += r[7]; o.fn += r[8]; o.fd += r[9]; o.yn += r[10]; o.yd += r[11];
    }
    this.memo.set(k, o);
    return o;
  }

  private windowIdx(pi: number, w: Win): number[] | null {
    if (w === 'm') return [pi];
    const n = w === 'ltm' ? 12 : w === 'q' ? 3 : this.P[pi] % 100, from = pi - n + 1;
    if (from < 0) return null;
    return Array.from({ length: n }, (_, i) => from + i);
  }
  baseIdx(pi: number, w: Win): number { return w === 'm' ? pi - 1 : w === 'q' ? pi - 3 : w === 'ltm' ? pi - 12 : pi - (this.P[pi] % 100); }

  ret(pi: number, w: Win, s: string, g: number): number | null {
    const ix = this.windowIdx(pi, w); if (!ix) return null;
    let f = 1;
    for (const i of ix) { const c = this.cell(i, s, g); if (!(c.yd > 0)) return null; f *= 1 + c.yn / c.yd / 100; }
    return (f - 1) * 100;
  }
  flows(pi: number, w: Win, s: string, g: number): { org: number; tr: number } | null {
    const ix = this.windowIdx(pi, w); if (!ix) return null;
    let org = 0, tr = 0;
    for (const i of ix) { const c = this.cell(i, s, g); if (!(c.af > 0) || c.fa < 0.98 * c.af) return null; org += c.dep - c.wd; tr += c.tr; }
    return { org, tr };
  }
  growth(pi: number, w: Win, s: string, g: number): number | null {
    const b = this.baseIdx(pi, w); if (b < 0) return null;
    const a0 = this.cell(b, s, g).a, a1 = this.cell(pi, s, g).a;
    return a0 > 0 ? (a1 / a0 - 1) * 100 : null;
  }

  /** value of a metric; g = -1 for the whole market. Amounts are NIS billions, ratios are %. */
  value(key: MetricKey, pi: number, w: Win, s: string, g: number): number | null {
    switch (key) {
      case 'assets': return this.cell(pi, s, g).a / 1000;
      case 'share': { const m = this.cell(pi, s, -1).a; return m > 0 ? this.cell(pi, s, g).a / m * 100 : null; }
      case 'growth': return this.growth(pi, w, s, g);
      case 'organic': { const f = this.flows(pi, w, s, g); return f ? f.org / 1000 : null; }
      case 'transfers': { const f = this.flows(pi, w, s, g); return f ? f.tr / 1000 : null; }
      case 'netflow': { const f = this.flows(pi, w, s, g); return f ? (f.org + f.tr) / 1000 : null; }
      case 'rate': { const f = this.flows(pi, w, s, g), b = this.baseIdx(pi, w); if (!f || b < 0) return null; const a0 = this.cell(b, s, g).af; return a0 > 0 ? f.org / a0 * 100 : null; }
      case 'fee': { const c = this.cell(pi, s, g); return c.fd > 0 ? c.fn / c.fd : null; }
      case 'ret': return this.ret(pi, w, s, g);
    }
  }

  /** The source of any aggregate this class computes: what it is, how it is built, and the inputs, each with its own source. */
  explain(key: MetricKey, pi: number, w: Win, s: string, g: number): Prov {
    const def = METRIC_BY_KEY[key], ww: Win = def.win ? w : 'm';
    const v = this.value(key, pi, ww, s, g), setL = this.setMap[s].label, who = g < 0 ? 'כלל השוק' : this.d.groups[g];
    const title = `${def.short}${def.win ? ' · ' + WIN_LABEL[ww] : ''} · ${who} · ${setL} · ${this.plabel(pi)}`;
    const fmt = (x: number | null, signed = false) => (x == null ? '–' : (signed ? sn(x, def.dec ?? 1) : nf(x, def.dec ?? (def.unit === '%' ? 1 : Math.abs(x) < 10 ? 2 : 1))));
    if (key !== 'growth' && key !== 'rate') return { k: 'reg', metric: key, pi, w: ww, set: s, g };
    const b = this.baseIdx(pi, ww);
    if (key === 'growth') {
      const a1 = this.value('assets', pi, 'm', s, g), a0 = b >= 0 ? this.value('assets', b, 'm', s, g) : null;
      return { k: 'calc', title, value: fmt(v, true), unit: '%', formula: 'נכסים בסוף התקופה חלקי נכסים בבסיסה, פחות 1. כולל תשואה, צבירה והעברות תיקים',
        inputs: [{ label: `נכסים, ${this.plabel(pi)}`, v: fmt(a1), src: () => ({ k: 'reg', metric: 'assets', pi, w: 'm', set: s, g }) },
          ...(b >= 0 ? [{ label: `נכסים בבסיס, ${this.plabel(b)}`, v: fmt(a0), src: () => ({ k: 'reg' as const, metric: 'assets' as const, pi: b, w: 'm' as const, set: s, g }) }] : [])] };
    }
    // organic accrual as % of opening assets of pension and gemel (insurance publishes no flows)
    const sets = s === 'all' ? ['fam:pension', 'fam:gemel'] : [s];
    return { k: 'calc', title, value: fmt(v, true), unit: '%', formula: 'צבירה אורגנית בתקופה חלקי נכסי הפתיחה של פנסיה וגמל (ביטוח אינו מפרסם תזרימים)',
      inputs: [{ label: `צבירה אורגנית, ${WIN_LABEL[ww]}`, v: fmt(this.value('organic', pi, ww, s, g), true), src: () => ({ k: 'reg', metric: 'organic', pi, w: ww, set: s, g }) },
        ...sets.map((x) => ({ label: `נכסי פתיחה${sets.length > 1 ? ', ' + this.setMap[x].label : ''}${b >= 0 ? ', ' + this.plabel(b) : ''}`, v: nf(this.cell(b, x, g).af / 1000, 1), src: () => ({ k: 'reg' as const, metric: 'assets' as const, pi: b, w: 'm' as const, set: x, g }) }))] };
  }

  activeGroups(pi: number, s: string): number[] {
    return this.d.groups.map((_, i) => i).filter((i) => this.cell(pi, s, i).a > 0);
  }
}


/* ---------- sources of single tracks, shared by the fund pages ---------- */
export interface TrackRef { ds: RegDs; id: number; name: string }
export const dsOf = (fam: string): RegDs => (fam === 'gemel' ? 'gemel' : fam === 'insurance' ? 'insurance' : 'pensia');
export const trackKey = (ds: RegDs, id: number) => (ds === 'gemel' ? 'g' : ds === 'pensia' ? 'p' : 'i') + id;
export const addMonths = (p: number, d: number) => { const t = Math.floor(p / 100) * 12 + (p % 100 - 1) + d; return Math.floor(t / 12) * 100 + (t % 12) + 1; };
export const monthsBack = (p: number, n: number) => Array.from({ length: n }, (_, i) => addMonths(p, i - n + 1));
export const ymLabel = (p: number) => `${String(p % 100).padStart(2, '0')}/${Math.floor(p / 100)}`;

export interface TrackHist { p: number[]; y: (number | null)[]; a: (number | null)[]; fee: (number | null)[]; dep?: (number | null)[]; wd?: (number | null)[]; tr?: (number | null)[] }
const histCache = new Map<string, TrackHist>(), pending = new Set<string>();
/** Monthly history of a track, loaded when a row is hovered or a card opens, so the sheet of a derived figure can list its months. */
export function warmHist(f: Pick<TrackRef, 'ds' | 'id'>) {
  const k = trackKey(f.ds, f.id);
  if (histCache.has(k) || pending.has(k)) return;
  pending.add(k);
  fetch(`${import.meta.env.BASE_URL}data/funds/${k}.json`).then((r) => (r.ok ? r.json() : null)).then((h) => { if (h) histCache.set(k, h); }).catch(() => {}).finally(() => pending.delete(k));
}
export const seedHist = (f: Pick<TrackRef, 'ds' | 'id'>, h: TrackHist) => { histCache.set(trackKey(f.ds, f.id), h); };
const COLNAME = { y: 'MONTHLY_YIELD', dep: 'DEPOSITS', wd: 'WITHDRAWLS', tr: 'INTERNAL_TRANSFERS', a: 'TOTAL_ASSETS', fee: 'AVG_ANNUAL_MANAGEMENT_FEE' } as const;
type HCol = keyof typeof COLNAME;
const HUNIT: Record<HCol, string | undefined> = { y: undefined, dep: 'מיליוני ש"ח', wd: 'מיליוני ש"ח', tr: 'מיליוני ש"ח', a: 'מיליוני ש"ח', fee: undefined };
const hv = (f: TrackRef, c: HCol, p: number): number | null | undefined => { const h = histCache.get(trackKey(f.ds, f.id)); if (!h) return undefined; const i = h.p.indexOf(p); return i < 0 ? null : (h[c]?.[i] ?? null); };
const HLABEL: Record<HCol, string> = { y: 'תשואה חודשית', dep: 'הפקדות', wd: 'משיכות', tr: 'העברות', a: 'נכסים', fee: 'דמי ניהול' };
const showH = (c: HCol, v: number | null | undefined) => (v === undefined ? 'ברשומה' : v == null ? '–' : c === 'y' ? sn(v, 2) + '%' : c === 'fee' ? nf(v, 2) + '%' : nf(v, 1));

/** One published figure of one track in one month. `value` is shown as is. */
export const fundP = (f: TrackRef, period: number, col: string, label: string, value: string, unit?: string, note?: string): Prov =>
  ({ k: 'fund', title: `${label} · ${f.name}`, value, unit, ds: f.ds, id: f.id, period, col, note });
/** A month of a track as an input row: its value comes from the loaded history when there is one. */
export function monthIn(f: TrackRef, c: HCol, p: number, known?: number | null) {
  const v = known !== undefined ? known : hv(f, c, p);
  return { label: `${HLABEL[c]} · ${ymLabel(p)}`, v: showH(c, v), src: () => fundP(f, p, COLNAME[c], HLABEL[c], showH(c, v), HUNIT[c]) };
}
/** Compounded return of the last 12 months, built from the 12 published monthly returns. */
export function y12P(f: TrackRef, period: number, value: string): Prov {
  return { k: 'calc', title: `תשואה LTM · ${f.name}`, value, formula: '(1 + r₁) × … × (1 + r₁₂) − 1 על 12 התשואות החודשיות האחרונות (MONTHLY_YIELD). מחושב רק כשכל 12 החודשים פורסמו',
    inputs: monthsBack(period, 12).map((p) => monthIn(f, 'y', p)) };
}
/** Compounded return over any run of months. */
export function retP(f: TrackRef, periods: number[], value: string, title: string, formula = '(1 + r₁) × … × (1 + rₙ) − 1 על התשואות החודשיות שפורסמו (MONTHLY_YIELD)'): Prov {
  return { k: 'calc', title: `${title} · ${f.name}`, value, formula, inputs: periods.map((p) => monthIn(f, 'y', p)) };
}
/** Exposure as % of the track's assets. The regulator publishes the amount; the percentage is ours. */
export function expP(f: TrackRef, period: number, col: string, label: string, pctV: number | null, assets: number | null): Prov {
  const amt = pctV != null && assets != null ? pctV * assets / 100 : null;
  return { k: 'calc', title: `${label} · ${f.name}`, value: pctV == null ? '–' : nf(pctV, 1) + '%', formula: `${col} חלקי TOTAL_ASSETS`,
    inputs: [{ label: `${col} (גולמי)`, v: amt == null ? '–' : `≈ ${nf(amt, 0)}`, src: () => fundP(f, period, col, label, amt == null ? '–' : `≈ ${nf(amt, 0)}`, 'מיליוני ש"ח', 'הערך הגולמי מוצג מעוגל, כפי שנגזר מהאחוז; הרשומה במאגר מציגה אותו במדויק') },
      { label: 'נכסים', v: assets == null ? '–' : nf(assets, 0), src: () => fundP(f, period, 'TOTAL_ASSETS', 'נכסים', assets == null ? '–' : nf(assets, 1), 'מיליוני ש"ח') }] };
}
/** Net accrual or transfers of the last 12 months. */
export function flowP(f: TrackRef, period: number, kind: 'net' | 'tr', value: string, unit = 'מיליוני ש"ח'): Prov {
  const ms = monthsBack(period, 12);
  return { k: 'calc', title: `${kind === 'net' ? 'צבירה אורגנית' : 'העברות נטו'}, LTM · ${f.name}`, value, unit,
    formula: kind === 'net' ? 'סכום DEPOSITS פחות WITHDRAWLS על 12 החודשים האחרונים' : 'סכום INTERNAL_TRANSFERS על 12 החודשים האחרונים',
    inputs: kind === 'net' ? ms.flatMap((p) => [monthIn(f, 'dep', p), monthIn(f, 'wd', p)]) : ms.map((p) => monthIn(f, 'tr', p)) };
}
/** A figure built from a list of tracks (a manager, a category): the list, each with its own source. */
export function listP(title: string, value: string, unit: string | undefined, formula: string, items: { label: string; v: string; src: () => Prov }[], note?: string): Prov {
  return { k: 'calc', title, value, unit, formula, inputs: items, note };
}
export const countP = (title: string, n: number, what: string): Prov => ({ k: 'calc', title, value: nf(n, 0), formula: `ספירת ${what}`, inputs: [] });

/* ---------- the tracks of the regulator snapshot (market.json `funds`) ---------- */
export const fundRef = (f: Fund): TrackRef => ({ ds: dsOf(f.fam), id: f.id, name: f.name });
/** The source of one figure of a track in the latest snapshot: a published column, or a figure built from the monthly files. */
export function fundCell(asof: number, f: Fund, k: keyof Fund): Prov | null {
  const r = fundRef(f), pc = (v: number | null | undefined, d = 2) => (v == null ? '–' : sn(v, d) + '%');
  switch (k) {
    case 'assets': return fundP(r, asof, 'TOTAL_ASSETS', 'נכסים', f.assets == null ? '–' : nf(f.assets, 1), 'מיליוני ש"ח');
    case 'fee': return fundP(r, asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', f.fee == null ? '–' : nf(f.fee, 2) + '%');
    case 'depfee': return fundP(r, asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה', f.depfee == null ? '–' : nf(f.depfee, 2) + '%');
    case 'ytd': return fundP(r, asof, 'YEAR_TO_DATE_YIELD', 'תשואה YTD', pc(f.ytd));
    case 'y12': return y12P(r, asof, pc(f.y12));
    case 'a3': return fundP(r, asof, 'AVG_ANNUAL_YIELD_TRAILING_3YRS', 'תשואה שנתית ממוצעת, 3 שנים', pc(f.a3));
    case 'a5': return fundP(r, asof, 'AVG_ANNUAL_YIELD_TRAILING_5YRS', 'תשואה שנתית ממוצעת, 5 שנים', pc(f.a5));
    case 'sd': return fundP(r, asof, 'STANDARD_DEVIATION', 'סטיית תקן', f.sd == null ? '–' : nf(f.sd, 2));
    case 'sharpe': return fundP(r, asof, 'SHARPE_RATIO', 'שארפ', f.sharpe == null ? '–' : nf(f.sharpe, 2));
    case 'stock': return expP(r, asof, 'STOCK_MARKET_EXPOSURE', 'חשיפה למניות', f.stock, f.assets);
    case 'foreign': return expP(r, asof, 'FOREIGN_EXPOSURE', 'חשיפה לחו"ל', f.foreign, f.assets);
    case 'net12': return flowP(r, asof, 'net', f.net12 == null ? '–' : sn(f.net12, 1));
    case 'tr12': return flowP(r, asof, 'tr', f.tr12 == null ? '–' : sn(f.tr12, 1));
    default: return null;
  }
}
