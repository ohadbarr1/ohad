/* Wave 3 flows: "מי ניצח החודש". The files pipeline/build_flows.py publishes (flows.json, flows/<prod>.json, flows/m/<yyyymm>.json,
   flows/sig.json, flows/fees.json) and the arithmetic the pages run on them: the 3M / 12M windows (the same sums as flows.json `latest`,
   pinned by tests/flows.unit.ts), the scorecard rows of a month, the headline, the provenance of a cell (its tracks), the fund card's
   flow signal, the saver's one line and the fee change log. Units: NIS millions; fees percent; months yyyymm. */
import type { Prov } from './prov';
import type { RegDs } from './sources';
import { nf, sn } from './format';

export const FLOWS_PATH = 'flows.json';
export const SIG_PATH = 'flows/sig.json';
export const FEES_PATH = 'flows/fees.json';
export const prodPath = (id: string) => `flows/${id}.json`;
export const monthPath = (p: number) => `flows/m/${p}.json`;

export type Field = 'n' | 'nf' | 'a' | 'af' | 'dep' | 'wd' | 'tr' | 'org' | 'net' | 'nd' | 'mig' | 'dd' | 'dt' | 'cl' | 'comp' | 'res' | 'rk';
export type Series = Partial<Record<Field, (number | null)[]>>;
export interface ProdMeta { id: string; label: string; flows: boolean; from: number; flows_from: number | null; groups: string[]; n_groups: number }
export interface CovProd { id: string; assets_from: number; flows_from: number | null; dep_wd: boolean; tr_split: boolean; thin_n: number; thin: number[]; note: string }
export interface Tender { id: string; label: string; from: number; to: number; months: number; winners: { grp: string; co: string; n: number; map: string }[] }
export interface FlowsIndex {
  v: number; asof: number; received: string | null; src: string; from: number; months: number[]; prods: ProdMeta[]; groups: string[]; bucket: string;
  method: Record<string, string>;
  coverage: { prods: CovProd[]; tr_split: string; thin: string; nd_off: number; nd_note: string; fees: string; group: string; default: string };
  tenders: Tender[];
  latest: Record<string, Record<string, Record<string, number>>>;
}
export interface FlowsProd { v: number; id: string; label: string; asof: number; flows: boolean; months: number[]; groups: Record<string, Series>; tot: Series }
/** a track's row in a month: [k, dep, wd, tr, nd, a, a0, y, default?, closing?] */
export type MRow = [string, number | null, number | null, number | null, number | null, number | null, number | null, number | null, 0 | 1, 0 | 1];
export interface FlowsMonth { v: number; p: number; cols: string[]; g: Record<string, Record<string, MRow[]>> }
export interface SigFile { v: number; asof: number; method: string; t: Record<string, [number | null, number | null]>; cats: Record<string, [number, number, number, number]> }
export interface FeeRow { k: string; grp: string; prod: string; track: string; a?: number; fee: number; fee12?: number; d12?: number; log: [number, number, number][]; df?: number; df12?: number; dlog?: [number, number, number][] }
export interface FeesFile { v: number; asof: number; method: string; move_bp: number; since: number; rows: FeeRow[] }

/** the flows product file of a funds.json product name (null: no such product) */
export const PROD_ID: Record<string, string> = {
  'פנסיה מקיפה': 'pm', 'פנסיה כללית': 'pk', 'גמל': 'gm', 'השתלמות': 'hs', 'גמל להשקעה': 'gl', 'חיסכון לילד': 'ch', 'מרכזית לפיצויים': 'mp', 'גמל, מטרה אחרת': 'go',
  'פוליסות חיסכון וביטוחי מנהלים (מ-2004)': 'po', 'ביטוחי מנהלים 1992-2003': 'bm', 'ביטוחי מנהלים 1990-1991': 'bm', 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים': 'bm',
};
export const HE_MONTH = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const monthLong = (p: number) => `${HE_MONTH[(p % 100) - 1]} ${Math.floor(p / 100)}`;
export const ym = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
export const addM = (p: number, d: number) => { const t = Math.floor(p / 100) * 12 + (p % 100 - 1) + d; return Math.floor(t / 12) * 100 + (t % 12) + 1; };

/** Python's round(x, 1) on a finite sum, as build_flows.r1 (half to even matters only at exact .x5, which sums of 0.1s rarely hit) */
export const r1 = (x: number) => Math.round(x * 10) / 10 + 0;

/** the sum of the n months ending at index j; null when one is missing or the series is shorter (flows.json `method.win`) */
export function win(xs: (number | null)[] | undefined, j: number, n: number): number | null {
  if (!xs || j - n + 1 < 0) return null;
  let s = 0;
  for (let i = j - n + 1; i <= j; i++) { const x = xs[i]; if (x == null) return null; s += x; }
  return r1(s);
}

export interface ScoreRow {
  grp: string; bucket: boolean; rk: number | null;
  a: number | null; dep: number | null; wd: number | null; org: number | null; tr: number | null; net: number | null;
  mig: number | null; dd: number | null; dt: number | null; cl: number | null; comp: number | null; res: number | null; nf: number | null; n: number | null;
  comp3: number | null; comp12: number | null; tr3: number | null; tr12: number | null; org3: number | null; org12: number | null;
}
/** the scorecard of month index j: every group that reported assets that month */
export function scoreRows(doc: FlowsProd, j: number, bucket: string): ScoreRow[] {
  const at = (S: Series, f: Field) => S[f]?.[j] ?? null;
  return Object.entries(doc.groups).filter(([, S]) => at(S, 'a') != null).map(([grp, S]) => ({
    grp, bucket: grp === bucket, rk: at(S, 'rk'), a: at(S, 'a'), dep: at(S, 'dep'), wd: at(S, 'wd'), org: at(S, 'org'), tr: at(S, 'tr'), net: at(S, 'net'),
    mig: at(S, 'mig'), dd: at(S, 'dd'), dt: at(S, 'dt'), cl: at(S, 'cl'), comp: at(S, 'comp'), res: at(S, 'res'), nf: at(S, 'nf'), n: at(S, 'n'),
    comp3: win(S.comp, j, 3), comp12: win(S.comp, j, 12), tr3: win(S.tr, j, 3), tr12: win(S.tr, j, 12), org3: win(S.org, j, 3), org12: win(S.org, j, 12),
  })).sort((x, y) => (x.rk ?? 1e9) - (y.rk ?? 1e9) || (y.a ?? 0) - (x.a ?? 0));
}

const mil = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}₪${nf(Math.abs(x), 0)} מיליון`;
/** one factual line from the data: the first-ranked group's competitive transfers, and the last-ranked one's (no adjectives) */
export function headline(doc: FlowsProd, j: number, bucket: string): string | null {
  const rows = scoreRows(doc, j, bucket).filter((r) => !r.bucket && r.comp != null && r.rk != null);
  if (!rows.length) return null;
  const top = rows[0], low = rows[rows.length - 1], p = doc.months[j];
  const deduct = doc.id === 'pm' ? 'אחרי ניכוי ברירת מחדל ונדידה פנימית' : 'אחרי ניכוי נדידה פנימית';
  let s = `ב${monthLong(p)}, ${doc.label}: ${top.grp} ${mil(top.comp!)} בהעברות תחרותיות, ${deduct}`;
  if (low !== top && low.comp! < 0) s += `; ${low.grp} ${mil(low.comp!)}`;
  return s + '.';
}

/* ---------- provenance ---------- */
const DS: Record<string, RegDs> = { g: 'gemel', p: 'pensia', i: 'insurance' };
const COL: Record<'dep' | 'wd' | 'tr' | 'a', [number, string, string]> = { dep: [1, 'DEPOSITS', 'הפקדות'], wd: [2, 'WITHDRAWLS', 'משיכות'], tr: [3, 'INTERNAL_TRANSFERS', 'העברות נטו'], a: [5, 'TOTAL_ASSETS', 'נכסים'] };
const trackP = (k: string, name: string, p: number, c: keyof typeof COL, v: number | null): Prov =>
  ({ k: 'fund', title: `${COL[c][2]} · ${name}`, value: v == null ? '–' : nf(v, 1), unit: 'מיליוני ש"ח', ds: DS[k[0]], id: Number(k.slice(1)), period: p, col: COL[c][1] });

/** the source of one cell: the formula in words (flows.json `method`) and the tracks it sums, each opening its published figure */
export function cellProv(o: { idx: FlowsIndex; prod: FlowsProd; grp: string; p: number; f: Field; value: number | null; rows: MRow[] | null; name: (k: string) => string }): Prov {
  const { idx, prod, grp, p, f, value, rows, name } = o;
  const title = `${FIELD_HE[f]} · ${grp} · ${prod.label} · ${ym(p)}`;
  const val = value == null ? '–' : f === 'rk' || f === 'n' || f === 'nf' ? nf(value, 0) : nf(value, 1);
  const formula = `${idx.method[f] ?? ''}. ${idx.method.cell}`;
  if (!rows) return { k: 'calc', title, value: val, unit: 'מיליוני ש"ח', formula, inputs: [], note: 'קובץ המסלולים של החודש לא נטען' };
  const flows = rows.filter((r) => r[1] != null && r[2] != null && r[3] != null);
  const one = (c: keyof typeof COL, keep: (r: MRow) => boolean = () => true) => (c === 'a' ? rows : flows).filter(keep).filter((r) => r[COL[c][0]] != null)
    .sort((x, y) => Math.abs((y[COL[c][0]] as number)) - Math.abs((x[COL[c][0]] as number)))
    .map((r) => ({ label: `${name(r[0])}${r[8] ? ' · ברירת מחדל' : ''}${r[9] ? ' · נסגר' : ''}`, v: nf(r[COL[c][0]] as number, 1), src: () => trackP(r[0], name(r[0]), p, c, r[COL[c][0]] as number) }));
  const sub = (label: string, ff: Field, v: number | null | undefined): { label: string; v: string; src: () => Prov } =>
    ({ label, v: v == null ? '–' : nf(v, 1), src: () => cellProv({ ...o, f: ff, value: v ?? null }) });
  const S = prod.groups[grp] ?? prod.tot, j = prod.months.indexOf(p), g = (ff: Field) => S[ff]?.[j] ?? null;
  let inputs: { label: string; v: string; src?: () => Prov }[];
  switch (f) {
    case 'a': case 'dep': case 'wd': case 'tr': inputs = one(f); break;
    case 'dd': inputs = one('dep', (r) => !!r[8]); break;
    case 'dt': inputs = one('tr', (r) => !!r[8]); break;
    case 'cl': inputs = [...one('tr', (r) => !!r[9]), sub('ניוד נטו של הקבוצה', 'tr', g('tr'))]; break;
    case 'mig': inputs = one('tr'); break;
    case 'org': inputs = [sub('הפקדות', 'dep', g('dep')), sub('משיכות', 'wd', g('wd'))]; break;
    case 'net': inputs = [sub('הפקדות', 'dep', g('dep')), sub('משיכות', 'wd', g('wd')), sub('ניוד נטו', 'tr', g('tr'))]; break;
    case 'comp': inputs = [sub('ניוד נטו', 'tr', g('tr')), ...(g('dt') != null ? [sub('ניוד לקרן ברירת מחדל', 'dt', g('dt'))] : []), sub('סגירת מסלולים', 'cl', g('cl'))]; break;
    default: inputs = [];
  }
  return { k: 'calc', title, value: val, unit: f === 'rk' ? undefined : 'מיליוני ש"ח', formula, inputs, note: f === 'res' ? 'אומדן: התשואה ברוטו' : undefined };
}
/** a 3M / 12M window: the monthly values it adds */
export function winProv(prod: FlowsProd, grp: string, f: Field, j: number, n: number, value: number | null, monthSrc?: (p: number) => (() => Prov) | undefined): Prov {
  const S = prod.groups[grp] ?? prod.tot;
  const ps = prod.months.slice(Math.max(0, j - n + 1), j + 1);
  return { k: 'calc', title: `${FIELD_HE[f]}, ${n === 3 ? '3M' : '12M'} · ${grp} · ${prod.label}`, value: value == null ? '–' : nf(value, 1), unit: 'מיליוני ש"ח',
    formula: `סכום ${n} החודשים עד ${ym(prod.months[j])}; חודש חסר = אין ערך`,
    inputs: ps.map((p) => { const v = S[f]?.[prod.months.indexOf(p)] ?? null; return { label: ym(p), v: v == null ? '–' : nf(v, 1), src: monthSrc?.(p) }; }) };
}

export const FIELD_HE: Record<Field, string> = {
  n: 'מסלולים', nf: 'מסלולים עם תזרים', a: 'נכסים', af: 'נכסים עם תזרים', dep: 'הפקדות', wd: 'משיכות', tr: 'ניוד נטו', org: 'צבירה אורגנית', net: 'צבירה נטו',
  nd: 'NET_MONTHLY_DEPOSITS', mig: 'נדידה פנימית (קוזזה)', dd: 'הפקדות לקרן ברירת מחדל', dt: 'ניוד לקרן ברירת מחדל', cl: 'סגירת מסלולים', comp: 'ניוד תחרותי',
  res: 'לא מוסבר', rk: 'מקום',
};

/* ---------- the flow signal of one track (fund card, /my) ---------- */
export interface Signal { nd3: number | null; nd12: number | null; n3: number; up3: number; n12: number; up12: number; share3: number | null; share12: number | null }
export function signalOf(sig: SigFile | null | undefined, k: string, cat: string): Signal | null {
  const t = sig?.t[k];
  if (!t) return null;
  const c = sig!.cats[cat] ?? [0, 0, 0, 0];
  return { nd3: t[0], nd12: t[1], n3: c[0], up3: c[1], n12: c[2], up12: c[3], share3: c[0] ? c[1] / c[0] : null, share12: c[2] ? c[3] / c[2] : null };
}
export const MIN_PEERS = 5;
/** the saver's line shows only when the track lost money on net over 3 months while most of its category (≥ 5 tracks) gained, or when
 *  the build flagged intra-group migration; otherwise nothing (the /my word cap) */
export function saverAlert(s: Signal | null, mig: boolean): 'out' | 'mig' | null {
  if (mig) return 'mig';
  if (s && s.nd3 != null && s.nd3 < 0 && s.n3 >= MIN_PEERS && s.share3 != null && s.share3 > 0.5) return 'out';
  return null;
}
/** "ב-3 החודשים: יצאו ₪X מיליון; 60% מהמסלולים בקטגוריה גדלו" */
export function signalText(nd: number, share: number | null, months: 3 | 12): string {
  const head = `ב-${months} החודשים: ${nd < 0 ? 'יצאו' : 'נכנסו'} ₪${nf(Math.abs(nd), 0)} מיליון נטו`;
  return share == null ? head : `${head}; ${nf(share * 100, 0)}% מהמסלולים בקטגוריה גדלו`;
}
export const signedMil = (x: number | null | undefined) => (x == null ? '–' : sn(x, 0));

/* ---------- the fee history ---------- */
export const FEE_MOVE = 0.05;
/** [[month, previous published, new]] for every published month ≥ since whose fee moved 5bp or more from the previous published one
 *  (build_flows.fee_log; unpublished months are skipped, not filled) */
export function feeLog(p: number[], fee: (number | null)[], since = 0): [number, number, number][] {
  const out: [number, number, number][] = [];
  let prev: number | null = null;
  p.forEach((q, i) => { const x = fee[i]; if (x == null) return; if (prev != null && q >= since && Math.abs(x - prev) >= FEE_MOVE - 1e-9) out.push([q, prev, x]); prev = x; });
  return out;
}
export const bp = (from: number, to: number) => Math.round((to - from) * 1000) / 10;
