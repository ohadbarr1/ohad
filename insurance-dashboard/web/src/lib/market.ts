import type { Family, MarketData } from './types';

/** A selection of products: everything, a family, or a single product. */
export interface ProductSet { id: string; label: string; sub?: boolean; has: Set<number> }
export type Win = 'm' | 'q' | 'ytd' | 'ltm';
export type MetricKey = 'assets' | 'share' | 'growth' | 'organic' | 'transfers' | 'netflow' | 'rate' | 'fee' | 'ret';

interface Cell { a: number; af: number; dep: number; wd: number; tr: number; fa: number; fn: number; fd: number; yn: number; yd: number }
export interface MetricDef { key: MetricKey; label: string; short: string; unit: '%' | 'bn'; win: boolean; ratio: boolean; dec?: number }

export const WIN_LABEL: Record<Win, string> = { m: 'חודש', q: 'רבעון', ytd: 'מתחילת השנה', ltm: '12 חודשים' };

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
  private baseIdx(pi: number, w: Win): number { return w === 'm' ? pi - 1 : w === 'q' ? pi - 3 : w === 'ltm' ? pi - 12 : pi - (this.P[pi] % 100); }

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

  activeGroups(pi: number, s: string): number[] {
    return this.d.groups.map((_, i) => i).filter((i) => this.cell(pi, s, i).a > 0);
  }
}
