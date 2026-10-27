/** A10 · the Fragility Monitor: fragility.json (pipeline/build_fragility.py). Seven signals per manager, each with its value, trend, peer
 *  percentile, a stated threshold rule and a state. No composite: a manager's status is the list of its signals in watch / alert.
 *  The thresholds are labelled assumptions; the page re-runs the same rules (stateOf = build_fragility.state) on URL overrides. */
import { nf, sn } from './format';
import type { Prov } from './prov';

export type SigId = 'flow' | 'fee' | 'perf' | 'cost' | 'solv' | 'csm' | 'scen';
export type St = 'ok' | 'watch' | 'alert' | 'nodata' | 'na';
export type SegId = 'pen' | 'gem' | 'ins' | 'all';
/** a provenance node as the builder writes it (the A1 file shape): Prov, plus `lts` and calc inputs with `p` */
export type ProvJ =
  | Exclude<Prov, { k: 'calc' }>
  | { k: 'calc'; title: string; value: string; unit?: string; formula: string; inputs: { label: string; v: string; p?: ProvJ }[]; est?: boolean; note?: string }
  | { k: 'lts'; c: string; metric: string; period: string; title: string; unit: string; value: string; note?: string };
export type X = Record<string, number | string | null>;
export interface Seg {
  st: St; why?: string; stale?: boolean; x?: X; v?: number | null; t?: number | null; m?: number | null; pct?: number | null; n?: number;
  asof?: string | null; d?: string | null; dk?: 'pub' | 'month'; prov?: ProvJ; provT?: ProvJ | null; provM?: ProvJ; provR?: ProvJ; provA?: ProvJ; provP?: ProvJ | null;
  ser?: [string, number | null][]; h?: [string, number, St, ...unknown[]][];
  /** flow: the Savings Lens quarter beside it */ lens?: { q: string; tr: number | null; fs: number | null; prov: ProvJ } | null;
  /** perf */ own?: number; peer?: number; nt?: number;
  /** cost: the latest quarter's own ratio */ q?: number | null;
  /** solv */ basis?: string; target?: { v: number; label: string; period: string; est?: string };
  /** csm */ C?: number; R?: number;
  /** scen */ pre?: { id: string; he: string; y10: number; eq: number; v: number | null }[]; worst?: string; worst_he?: string; lines?: string | null; h0?: number | null;
}
export interface Cell { st: St; seg: SegId | null; why?: string; stale?: boolean; segs: Partial<Record<SegId, Seg>> }
export interface Row { c: string; name: string; kind: 'insurance_group' | 'fund_house'; sig: Record<SigId, Cell>; flags: { sig: SigId; st: 'watch' | 'alert' }[]; nodata: SigId[] }
export interface SigDef { id: SigId; he: string; short: string; metric: string; u: 'dm' | 'pct' | 'r' | 'pp'; better: 'hi' | 'lo'; pctl: string; rule: { watch: string; alert: string }; src: string; segs: SegId[] }
export interface Param { v: number; he: string; u: string; sig: SigId }
export interface FragFile {
  v: 1; asof: { lens: string; reg: string; funds: string; base: string }; rule: string; sigs: SigDef[]; params: Record<string, Param>; stale_ratio_m: number;
  presets: { id: string; he: string; y10: number; eq: number; ok: boolean }[]; cos: Record<string, string>; rows: Row[]; skipped: { c: string; why: string }[]; events: unknown[];
}
/** resolves an `lts` node (a managing company's printed components): lens.ts ltsProv on the page (lib/fragilityLoad.ts) */
export type LtsFn = (j: Extract<ProvJ, { k: 'lts' }>) => Prov;

export const SIG_ORDER: SigId[] = ['flow', 'fee', 'perf', 'cost', 'solv', 'csm', 'scen'];
export const ST_HE: Record<St, string> = { ok: 'תקין', watch: 'מעקב', alert: 'התראה', nodata: 'אין נתונים', na: 'לא רלוונטי' };
export const SEG_HE: Record<SegId, string> = { pen: 'פנסיה', gem: 'גמל והשתלמות', ins: 'ביטוחי מנהלים ופוליסות חיסכון', all: '' };
export const RANK: Record<'ok' | 'watch' | 'alert', number> = { ok: 0, watch: 1, alert: 2 };
export const isData = (s: St): s is 'ok' | 'watch' | 'alert' => s === 'ok' || s === 'watch' || s === 'alert';

const num = (x: X | undefined, k: string): number | null => { const v = x?.[k]; return typeof v === 'number' ? v : null; };

/** the threshold rule of one signal (pipeline/build_fragility.py state: the same function, checked by tests/fragility.unit.ts) */
export function stateOf(sig: SigId, x: X, p: Record<string, number>): 'ok' | 'watch' | 'alert' {
  const n = (k: string) => num(x, k);
  switch (sig) {
    case 'flow': {
      const v3 = n('v3')!, a0 = n('a0'), p3 = n('p3');
      if (v3 >= 0) return 'ok';
      if (n('run')! >= p.flow_run && a0 && (-v3 / a0) * 100 >= p.flow_pct) return 'alert';
      return p3 != null && v3 < p3 ? 'watch' : 'ok';
    }
    case 'fee': {
      const d = n('d')!, rel = n('rel'), relOk = rel == null || rel <= -p.fee_rel;
      return d <= -p.fee_alert && relOk ? 'alert' : d <= -p.fee_watch && relOk ? 'watch' : 'ok';
    }
    case 'perf': {
      const g = n('g')!, d = n('d');
      if (g <= -p.perf_alert) return 'alert';
      return g <= -p.perf_watch || (g < 0 && d != null && d <= -p.perf_decay) ? 'watch' : 'ok';
    }
    case 'cost': {
      const d = n('d');
      if (n('l')! >= p.cost_alert) return 'alert';
      return d != null && d >= p.cost_watch ? 'watch' : 'ok';
    }
    case 'solv': {
      const h = n('h')!, d = n('d');
      if (h < 0) return 'alert';
      return h < p.solv_watch || (d != null && d <= -p.solv_drop) ? 'watch' : 'ok';
    }
    case 'csm': {
      const y = n('y')!, d = n('d');
      if (y < p.csm_alert) return 'alert';
      return y < p.csm_watch || (d != null && d <= -p.csm_drop) ? 'watch' : 'ok';
    }
    case 'scen': {
      const hw = n('hw')!, h0 = n('h0')!;
      if (hw < 0 || h0 < 0) return 'alert';
      return hw < p.scen_watch ? 'watch' : 'ok';
    }
  }
}

/** the defaults, with the URL's overrides (?fee_watch=3): only known keys, finite numbers */
export function readParams(F: FragFile, sp: URLSearchParams): { p: Record<string, number>; changed: string[] } {
  const p: Record<string, number> = {}, changed: string[] = [];
  for (const [k, d] of Object.entries(F.params)) {
    const raw = sp.get(k), v = raw == null || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(v) && v !== d.v) { p[k] = v; changed.push(k); } else p[k] = d.v;
  }
  return { p, changed };
}
export const defaults = (F: FragFile) => Object.fromEntries(Object.entries(F.params).map(([k, d]) => [k, d.v]));

/** every cell re-run under the thresholds `p` (the defaults reproduce the file); percentiles and figures do not depend on them */
export function evaluate(F: FragFile, p: Record<string, number>): Row[] {
  return F.rows.map((r) => {
    const sig = {} as Record<SigId, Cell>;
    for (const s of SIG_ORDER) {
      const c = r.sig[s];
      const segs: Cell['segs'] = {};
      let best: SegId | null = null;
      for (const [k, x] of Object.entries(c.segs) as [SegId, Seg][]) {
        const st = isData(x.st) && x.x ? stateOf(s, x.x, p) : x.st;
        segs[k] = { ...x, st };
        if (isData(st)) {
          const b = best ? segs[best]! : null;
          if (!b || RANK[st] > RANK[b.st as 'ok'] || (RANK[st] === RANK[b.st as 'ok'] && (x.pct ?? 50) < (b.pct ?? 50))) best = k;
        }
      }
      sig[s] = best ? { st: segs[best]!.st, seg: best, segs } : { ...c, segs };
    }
    const flags = SIG_ORDER.filter((s) => sig[s].st === 'watch' || sig[s].st === 'alert').map((s) => ({ sig: s, st: sig[s].st as 'watch' | 'alert' }))
      .sort((a, b) => RANK[b.st] - RANK[a.st] || SIG_ORDER.indexOf(a.sig) - SIG_ORDER.indexOf(b.sig));
    return { ...r, sig, flags };
  });
}

/** a rule's text with its thresholds filled in */
export const ruleText = (t: string, p: Record<string, number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => nf(p[k] ?? NaN, p[k] != null && p[k] % 1 ? 2 : 0));

/* ---------- figures ---------- */
const MINUS = '−';
/** the headline of a segment the way the grid shows it */
export function headline(sig: SigId, x: Seg): string {
  if (x.v == null) return '–';
  switch (sig) {
    case 'flow': return `${sn(x.v / 1000, 2)}`;
    case 'fee': return `${nf(x.v, 3)}%`;
    case 'perf': return sn(x.v, 2);
    case 'cost': return `${nf(x.v, 1)}%`;
    case 'solv': return `${nf(x.v, 1)}%`;
    case 'csm': return nf(x.v, 1);
    case 'scen': return `${sn(x.v, 1)}`;
  }
}
export const UNIT_OF: Record<SigId, string> = { flow: 'מיליארד ש"ח', fee: '% שנתי', perf: 'שארפ', cost: '%', solv: '%', csm: 'שנים', scen: 'נ״א' };
/** the trend figure: what moved, in the signal's own unit */
export function trendText(sig: SigId, x: Seg): string {
  if (x.t == null) return '–';
  switch (sig) {
    case 'flow': return `${sn(x.t / 1000, 2)} מול 3M קודם`;
    case 'fee': return `${sn(x.t, 1)} נ״ב YoY`;
    case 'perf': return `${sn(x.t, 2)} ב-12 חודשים`;
    case 'cost': return `${sn(x.t, 1)} נ״א YoY`;
    case 'solv': return `${sn(x.t, 1)} נ״א בשנה`;
    case 'csm': return `${sn(x.t, 2)} שנים YoY`;
    case 'scen': return `${sn(x.t, 1)} מול הבסיס`;
  }
}
export const pctText = (x: Seg) => (x.pct == null ? null : `P${nf(x.pct, 0)}`);

/** a provenance node of the file as a Prov (nested sources become lazy thunks; `lts` opens the printed components of a managing company) */
export function toProv(j: ProvJ, lts: LtsFn): Prov {
  if (j.k === 'lts') return lts(j);
  if (j.k === 'calc') return { k: 'calc', title: j.title, value: j.value, unit: j.unit, formula: j.formula, est: j.est, note: j.note,
    inputs: j.inputs.map((x) => ({ label: x.label, v: x.v, src: x.p ? () => toProv(x.p!, lts) : undefined })) };
  return j as Prov;
}
/** a provenance node for a figure the cell shows without a dedicated node (the percentile among the peers) */
export function pctProv(F: FragFile, s: SigDef, seg: SegId, rows: Row[], c: string): Prov {
  const xs = rows.map((r) => ({ r, x: r.sig[s.id].segs[seg] })).filter((y) => y.x && isData(y.x.st) && y.x.m != null)
    .sort((a, b) => (s.better === 'hi' ? b.x!.m! - a.x!.m! : a.x!.m! - b.x!.m!));
  const me = xs.find((y) => y.r.c === c)?.x;
  return { k: 'calc', title: `מיקום בין העמיתים · ${F.cos[c] ?? c} · ${s.he}${SEG_HE[seg] ? ` · ${SEG_HE[seg]}` : ''}`, value: me?.pct == null ? '–' : `P${nf(me.pct, 0)}`,
    formula: `שיעור המנהלים האחרים עם ערך גרוע יותר (שוויון = חצי), ${s.pctl}; ${s.better === 'hi' ? 'גבוה' : 'נמוך'} = טוב`,
    inputs: xs.map((y) => ({ label: F.cos[y.r.c] ?? y.r.c, v: nf(y.x!.m!, Math.abs(y.x!.m!) < 10 ? 2 : 1) })) };
}
/** "Q2'26" / "08/26" / "31.03.26" of the as-of, or the reason a cell has none */
export const asOfText = (x: Seg | undefined) => x?.asof ?? '–';
export { MINUS };
