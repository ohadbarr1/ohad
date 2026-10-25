/** Long-term savings sector comparison: figures keyed metric x company x period, each with the slide or report it was read from. */
export interface LtsData { source: string; companies: Record<string, string>; notes: Record<string, string>; marks?: Record<string, { metrics: string[]; text: string }>; facts: [string, string, string, number, number][] }

/** The report a chart is measured on: a year and a quarter. Every period a chart shows is derived from it. */
export interface Base { y: number; q: number }
export const baseKey = (b: Base) => `${b.y}Q${b.q}`;
export const parseBase = (k: string): Base => ({ y: Number(k.slice(0, 4)), q: Number(k.slice(5)) });
export const baseLabel = (b: Base) => (b.q === 4 ? `FY'${String(b.y).slice(2)}` : `Q${b.q}'${String(b.y).slice(2)}`);
const MM = ['03', '06', '09', '12'];
const YTD = ['Q1-', 'H1-', '9M-', 'FY'];

/** balance date of the base, or December k years before it */
export const inst = (b: Base, k = 0) => (k === 0 ? `${b.y}-${MM[b.q - 1]}` : `${b.y - k}-12`);
/** the year-to-date window of the base: Q1, H1, 9M or the full year */
export const ytd = (b: Base, back = 0) => `${YTD[b.q - 1]}${b.y - back}`;
export const quarter = (b: Base, back = 0) => { const n = b.y * 4 + (b.q - 1) - back; return `Q${(n % 4) + 1}-${Math.floor(n / 4)}`; };

export type PeriodSet = 'inst3' | 'inst4' | 'flow3' | 'same3' | 'annual3' | 'q6' | 'q5' | 'qyoy' | 'iq5' | 'iyoy';
/** How a chart reads time: full years and the year to date, the last quarters in a row, or the same quarter year over year. */
export type View = 'y' | 'q' | 'yoy';
export const VIEWS: [View, string][] = [['y', 'שנים ומצטבר'], ['q', 'רבעונים ברצף'], ['yoy', 'רבעון מול רבעון']];
const INSTANT = new Set<PeriodSet>(['inst3', 'inst4']);
/** the period set a chart shows under a view: balances stay balances, flows become single quarters */
export function viewSet(set: PeriodSet, view: View): PeriodSet {
  if (view === 'y' || set === 'q6') return set;
  if (INSTANT.has(set)) return view === 'q' ? 'iq5' : 'iyoy';
  return view === 'q' ? 'q5' : 'qyoy';
}
const instBack = (b: Base, k: number) => { const n = b.y * 4 + (b.q - 1) - k; return `${Math.floor(n / 4)}-${MM[n % 4]}`; };
export function periodsOf(set: PeriodSet, b: Base): string[] {
  switch (set) {
    case 'inst3': return b.q === 4 ? [inst(b, 2), inst(b, 1), inst(b)] : [inst(b, 2), inst(b, 1), inst(b)];
    case 'inst4': return [inst(b, 3), inst(b, 2), inst(b, 1), inst(b)];
    // two full years and the year to date; on an annual report, three full years
    case 'flow3': return b.q === 4 ? [`FY${b.y - 2}`, `FY${b.y - 1}`, `FY${b.y}`] : [`FY${b.y - 2}`, `FY${b.y - 1}`, ytd(b)];
    case 'same3': return [ytd(b, 2), ytd(b, 1), ytd(b)];
    case 'annual3': { const f = b.q === 4 ? b.y : b.y - 1; return [`FY${f - 2}`, `FY${f - 1}`, `FY${f}`]; }
    case 'q6': return [5, 4, 3, 2, 1, 0].map((k) => quarter(b, k));
    case 'q5': return [4, 3, 2, 1, 0].map((k) => quarter(b, k));
    case 'qyoy': return [8, 4, 0].map((k) => quarter(b, k));
    case 'iq5': return [4, 3, 2, 1, 0].map((k) => instBack(b, k));
    case 'iyoy': return [8, 4, 0].map((k) => instBack(b, k));
  }
}
export function periodLabel(p: string): string {
  if (/^\d{4}-\d{2}$/.test(p)) { const m = Number(p.slice(5)); return m % 3 === 0 ? `Q${m / 3}'${p.slice(2, 4)}` : `${p.slice(5)}/${p.slice(2, 4)}`; }
  if (p.startsWith('FY')) return `FY'${p.slice(4)}`;
  const [w, y] = p.split('-');
  return `${w}'${y.slice(2)}`;
}

/** The printed components of the report-based figures of one company: loaded in the background, read when a source is opened. */
export interface LtsProv { entity?: string; urls: Record<string, string | null>; parts: [string, number | null, string, number, string, string, string][]; facts: Record<string, [string, number[]]> }

export class Lts {
  prov: Record<string, LtsProv> = {};
  private m = new Map<string, [number, number]>();
  private byMetric = new Map<string, Set<string>>();
  constructor(readonly d: LtsData) {
    const F = d.facts;  // indexed loop: see CompanyStore (WebKit)
    for (let i = 0; i < F.length; i++) {
      const f = F[i], metric = f[0], c = f[1], p = f[2], v = f[3], s = f[4];
      this.m.set(`${metric}|${c}|${p}`, [v, s]);
      if (!this.byMetric.has(metric)) this.byMetric.set(metric, new Set());
      this.byMetric.get(metric)!.add(p);
    }
  }
  v(metric: string, c: string, p: string): number | null { return this.m.get(`${metric}|${c}|${p}`)?.[0] ?? null; }
  slide(metric: string, c: string, p: string): number | null { return this.m.get(`${metric}|${c}|${p}`)?.[1] ?? null; }
  /** companies with figures built from their own reports */
  reported(): string[] { return [...new Set(this.d.facts.filter((f) => f[4] === 0).map((f) => f[1]))]; }
  /** the reason a company's figure for this metric is not comparable as it stands, if there is one */
  mark(metric: string, c: string): string | null { const m = this.d.marks?.[c]; return m && m.metrics.includes(metric) ? m.text : null; }
  name(c: string): string { return this.d.companies[c] ?? c; }
  has(metric: string, p: string): boolean { return this.byMetric.get(metric)?.has(p) ?? false; }
  /** reports on which a chart can be measured: those whose own period carries the metric */
  bases(metric: string, current: (b: Base) => string): Base[] {
    const out: Base[] = [];
    for (let y = 2027; y >= 2021; y--) for (let q = 4; q >= 1; q--) { const b = { y, q }; if (this.has(metric, current(b))) out.push(b); }
    return out;
  }
}
