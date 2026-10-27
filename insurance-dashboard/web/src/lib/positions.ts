/** The position book (module A6): positions.json (pipeline/build_positions.py). Every value carries the cells it is made of, so each one
 *  opens to its source: a Savings Lens cell (and from there the report page), an XBRL fact, or a report card's printed ratio. */
import { nf, pubLabel, sn } from './format';
import { LensSrc, type LensData } from './lens';
import type { Prov } from './prov';
import { useLoad } from './useData';

export type Conf = 'low' | 'medium' | 'high';
export type Dir = 'constructive' | 'cautious' | 'neutral';
export type OutSt = 'open' | 'confirmed' | 'falsified' | 'expired' | 'withdrawn';
export type PUnit = 'pct' | 'pp' | 'm';
export type Cell =
  | { k: 'lens'; g: number; s: string; q: string; f: string; v: number | null }
  | { k: 'term'; l: string; v: number; in: Cell[] }
  | { k: 'kpi'; c: string; p: string; m: string; v: number; rid: number | null }
  | { k: 'card'; c: string; card: string; row: string; v: number; url: string | null; pg: number | null; at: string; l: string };
/** [period (2026Q2 / 2025FY), value, publication day of the report, the cells it is made of] */
export type SerPt = [string, number, string | null, Cell[]];
export interface PMetric { key: string; label: string; unit: PUnit; fx: string | null; to: string; ser: SerPt[] }
export interface Obs { p: string; v: number; d: string | null }
export interface PFals { metric: string; op: '<' | '<=' | '>' | '>='; value: number; period: string; note?: string; since?: string; label?: string; unit?: PUnit;
  st: 'met' | 'clear' | 'watch' | 'pending' | 'unresolved'; at?: Obs; last?: Obs; n?: number; why?: string }
export interface PTrig { metric: string; threshold_pp?: number; threshold_pct?: number; base?: { per: string; v: number }; label?: string; unit?: PUnit;
  last?: Obs; dpp?: number; dpct?: number | null; fired?: boolean; size?: number; first?: Obs | null; st: 'ok' | 'fired' | 'unresolved'; why?: string }
export interface PEvid { ref: string; note: string; ok: boolean; kind: 'route' | 'metric' | 'target' | 'card' | 'missing'; label: string; to: string | null;
  pdf?: { url: string; pg: number | null } | null; val?: { v: number | null; u: string; p?: string; lo?: number | null; hi?: number | null; st?: string } }
export interface Position {
  id: string; status: 'published' | 'draft'; claim: string; horizon: string; confidence: Conf; direction: Dir; mechanism: string; mechanism_edge: string | null;
  review: string; company: string[]; rev: number; opened: string | null; revised: string | null;
  revs: { rev: number; date: string; note: string; hash: string; supersedes: string | null }[];
  outcome: { st: OutSt; date?: string; note?: string }; outcomes: { seq: number; date: string; st: OutSt; note: string }[];
  evidence: PEvid[]; falsifiers: PFals[]; triggers: PTrig[]; next_review: string | null; review_basis: string; due: { d: string; c: string; per: string } | null;
  drift: boolean; suggest: 'falsified' | null; involved: string[]; problems?: string[];
}
export interface HitAgg { n: number; confirmed: number; falsified: number; expired: number; withdrawn: number; hit: number | null }
export interface PositionsFile {
  v: 1; asof: { lens: string; kpi: string }; drafts: boolean; abstain: Record<string, string>; withheld: number; rules: Record<string, string>;
  cos: Record<string, string>; groups: string[]; metrics: Record<string, PMetric>; positions: Position[];
  hit: HitAgg & { by_conf: Record<Conf, HitAgg>; open: number }; events: unknown[];
}
export const usePositions = (enabled = true) => useLoad<PositionsFile>(enabled ? 'positions.json' : null);

export const CONF_HE: Record<Conf, string> = { low: 'נמוך', medium: 'בינוני', high: 'גבוה' };
export const DIR_HE: Record<Dir, string> = { constructive: 'חיובית', cautious: 'זהירה', neutral: 'ניטרלית' };
export const OUT_HE: Record<OutSt, string> = { open: 'פתוחה', confirmed: 'אושרה', falsified: 'הופרכה', expired: 'פג תוקף', withdrawn: 'נמשכה' };
export const FST_HE: Record<PFals['st'], string> = { met: 'התקיים', clear: 'לא התקיים', watch: 'במעקב', pending: 'טרם פורסם', unresolved: 'לא נפתר' };
const OP_HE: Record<PFals['op'], string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥' };
export const opHe = (op: PFals['op']) => OP_HE[op];

/** 2026Q2 -> Q2'26, 2025FY -> FY'25 */
export const perLabel = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : /^\d{4}Q\d$/.test(p) ? `${p.slice(4)}'${p.slice(2, 4)}` : p);
export const unitHe = (u: PUnit | undefined) => (u === 'm' ? 'מיליוני ש"ח' : u === 'pp' ? 'נק׳' : u === 'pct' ? '%' : '');
/** a value the way the book shows it: ratios in % (three decimals below 1%: fee yields), gaps in points (the number; נק׳ beside it), NIS m */
export function fmtV(v: number | null | undefined, u: PUnit | undefined): string {
  if (v == null) return '–';
  if (u === 'pct') return `${nf(v, Math.abs(v) < 1 ? 3 : Math.abs(v) < 10 ? 2 : 1)}%`;
  if (u === 'pp') return nf(v, Math.abs(v) < 1 ? 3 : 1);  // the unit (נק׳) is printed outside the number, so the bidi order holds
  return nf(v, Math.abs(v) < 100 ? 1 : 0);
}
/** a threshold or condition value without its unit (the unit is printed beside it) */
export const fmtN = (v: number, u: PUnit | undefined) => (u === 'm' ? nf(v, Math.abs(v) < 100 ? 1 : 0) : nf(v, Math.abs(v) < 1 ? 3 : Math.abs(v) < 10 ? 2 : 1));
/** a change: points of a ratio (or of a gap), or NIS m; the number only */
export const fmtD = (v: number | null | undefined, u: PUnit | undefined, thr?: number) => {
  if (v == null) return '–';
  if (v === 0) return '0';
  const d = thr != null ? (thr < 0.1 ? 3 : thr < 1 ? 2 : 1) : Math.abs(v) < 1 ? 3 : 1;
  return u === 'm' ? sn(v, 0) : sn(v, d);  // points: the caller prints נק׳ outside the number
};

const DAY = 86_400_000;
export const today = () => new Date().toISOString().slice(0, 10);
export const daysTo = (d: string | null | undefined, from = today()) => (d ? Math.round((Date.parse(d) - Date.parse(from)) / DAY) : null);
/** the state the page shows: the ledger's outcome, or for an open position the engine's suggestion and the horizon */
export function stateOf(p: Position, t = today()): { k: OutSt | 'suggest' | 'due'; he: string } {
  if (p.outcome.st !== 'open') return { k: p.outcome.st, he: OUT_HE[p.outcome.st] };
  if (p.suggest === 'falsified') return { k: 'suggest', he: 'הפרכה התקיימה: ממתין לסגירה' };
  if (p.horizon < t) return { k: 'due', he: 'האופק עבר: ממתין לסגירה' };
  return { k: 'open', he: OUT_HE.open };
}
export const companiesHe = (F: PositionsFile, p: Position) => p.company.map((c) => F.cos[c] ?? c).join(', ');
export { pubLabel };

/* ---------- sources ---------- */
const LENS_FIELD: Record<string, string> = { ci: 'יחס הוצאות להכנסות', fy_rep: 'תשואת דמי ניהול, נכסים מדווחים', fy_reg: 'תשואת דמי ניהול, נכסי הרשות', aum_share: 'נתח מנכסים',
  flow_share: 'נתח מהצבירה נטו', growth: 'צמיחה אורגנית', tr: 'העברות נטו', org: 'צבירה אורגנית', fees: 'הכנסות מדמי ניהול', sm: 'שיווק ומכירה', ga: 'הנהלה וכלליות', op: 'רווח תפעולי' };

function cellLabel(c: Cell, F: PositionsFile): string {
  switch (c.k) {
    case 'lens': return `${LENS_FIELD[c.f] ?? c.f} · ${F.groups[c.g] ?? ''} · ${c.q.slice(0, 2)}'${c.q.slice(5)}`;
    case 'term': return c.l;
    case 'kpi': return `${c.m} · ${F.cos[c.c] ?? c.c} · ${perLabel(c.p)}`;
    case 'card': return `${c.l} · ${pubLabel(c.at)}`;
  }
}
function cellValue(c: Cell, u: PUnit): string {
  if (c.v == null) return '–';
  if (c.k === 'lens') return ['tr', 'org', 'fees', 'sm', 'ga', 'op'].includes(c.f) ? nf(c.v, 1) : `${nf(c.v, Math.abs(c.v) < 1 ? 3 : 2)}%`;
  return fmtV(c.v, u === 'pp' ? 'pct' : u);
}

/** the source of one cell: lens cells open the Savings Lens arithmetic (and from there the printed page), when lens.json is loaded */
function cellProv(c: Cell, F: PositionsFile, lens: LensData | null, u: PUnit): Prov {
  const title = cellLabel(c, F);
  switch (c.k) {
    case 'term': return c.in.length === 1 ? cellProv(c.in[0], F, lens, u)
      : { k: 'calc', title, value: cellValue(c, u), formula: c.in.every((x) => x.k === 'term') ? 'חציון החברות' : c.in.some((x) => x.k === 'lens' && x.f === 'ci') ? '(סכום שיווק ומכירה + סכום הנהלה וכלליות) ÷ סכום דמי הניהול × 100, ארבעת הרבעונים' : 'סכום ארבעת הרבעונים (LTM)', inputs: c.in.map((x) => ({ label: cellLabel(x, F), v: cellValue(x, u), src: () => cellProv(x, F, lens, u) })) };
    case 'kpi': return { k: 'xbrl', title, value: nf(c.v, 0), unit: 'מיליוני ש"ח', company: F.cos[c.c] ?? c.c, period: perLabel(c.p), rid: c.rid, concept: c.m, note: 'kpi.json מדפיס אלפי ש"ח; כאן במיליונים' };
    case 'card': return { k: 'report', title, value: `${nf(c.v, 0)}%`, url: c.url, pg: c.pg, doc: `כרטיס דוח ${perLabel(c.card)}`, period: pubLabel(c.at), note: 'כפי שהודפס בדוח, כמו בכרטיס הדוח' };
    case 'lens': {
      if (!lens) return { k: 'none', title, why: 'עדשת החיסכון נטענת. נסו שוב בעוד רגע.' };
      const r = lens.rows.find((x) => x.g === c.g && x.s === c.s && x.q === c.q);
      if (!r) return { k: 'none', title, why: 'התא אינו בעדשת החיסכון' };
      const S = new LensSrc(lens);
      switch (c.f) {
        case 'ci': return r.rep ? S.ci(r) : { k: 'none', title, why: 'אין נתוני דוח לרבעון' };
        case 'fy_rep': return S.fyRep(r);
        case 'fy_reg': return S.fyReg(r);
        case 'aum_share': return S.share(r, lens.rows, 'aum');
        case 'flow_share': return S.share(r, lens.rows, 'flow');
        case 'growth': return S.growth(r);
        case 'tr': return S.reg('transfers', r.reg.e, 'q', r.s, r.g, nf((r.reg.tr ?? 0) / 1000, 2), 'מיליארד ש"ח', title);
        case 'org': return S.reg('organic', r.reg.e, 'q', r.s, r.g, nf((r.reg.org ?? 0) / 1000, 2), 'מיליארד ש"ח', title);
        default: return S.rep(r, c.f as 'fees' | 'sm' | 'ga' | 'op', 'q');
      }
    }
  }
}

/** the source of a metric value at one period: its formula over its cells */
export function valueProv(F: PositionsFile, key: string, per: string, lens: LensData | null): Prov {
  const m = F.metrics[key];
  const pt = m?.ser.find((x) => x[0] === per);
  if (!m || !pt) return { k: 'none', title: m?.label ?? key, why: 'הערך אינו בקובץ' };
  const [, v, d, cells] = pt;
  const title = `${m.label} · ${perLabel(per)}`;
  const note = [d ? `הדוח פורסם ${pubLabel(d)}` : '', `מפתח: ${key}`].filter(Boolean).join(' · ');
  if (cells.length === 1 && !m.fx) { const p = cellProv(cells[0], F, lens, m.unit); return p.k === 'calc' ? { ...p, title, note } : p; }
  return { k: 'calc', title, value: fmtV(v, m.unit), unit: m.unit === 'pct' ? undefined : unitHe(m.unit), formula: m.fx ?? (cells.length === 2 ? 'האיבר הראשון פחות השני' : 'הרכיבים'), note,
    inputs: cells.map((c) => ({ label: cellLabel(c, F), v: cellValue(c, m.unit), src: () => cellProv(c, F, lens, m.unit) })) };
}
