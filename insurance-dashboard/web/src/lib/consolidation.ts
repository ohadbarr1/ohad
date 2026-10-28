/* A9 · Consolidation Screen: every acquirer × target among the long-term-savings managers whose costs are printed.
   Pure functions only, no React: /consolidation, the tear sheets and tests/consolidation.unit.ts call exactly this.

   consolidation/matrix.json (pipeline/build_consolidation.py) carries each company's inputs with their sources (A1 products, A7 capital,
   the valuation inputs), the assumptions (each labelled, overridable in the address) and the pair rows at the defaults. Here:
     pairAt(M, a, t, A)   one pair at the reader's assumptions: the formulas of build_consolidation.compute (cross-checked by the unit test)
     screen(M, A)         every pair, ranked on the one primary metric (synergy NPV ÷ price at a 20% premium); flagged pairs not ranked
     xprov(M, j)          a file provenance node as a Prov (pointers c/<id>:… and a:… resolved; nested sources lazy)
   The fit components (product overlap, track crowding, channel) do not depend on the assumptions: they come from the pair files.
   Nothing here is a recommendation: analytical figures, with every assumption visible. */
import { fmt, fmtS, type LtsResolver, type ProvJ } from './drivers';
import type { Prov } from './prov';

/* ---------- the files ---------- */
export type XProvJ = Exclude<ProvJ, { k: 'calc' }> | { k: 'ref'; r: string }
  | { k: 'calc'; title: string; value: string; unit?: string; formula: string; inputs: { label: string; v: string; p?: XProvJ }[]; est?: boolean; note?: string };
export interface Fig { v: number | null; prov: XProvJ }
export type Seg = 'pen' | 'gem';
export interface Prod { s: Seg; he: string; g: number; aum: Fig; fy: Fig; fees: Fig; opex: Fig; op: Fig; ci: Fig; dur: Fig }
export type PnlKey = 'net_profit' | 'equity' | 'equity_end' | 'roe' | 'ke' | 'pb' | 'debt_total' | 'rf' | 'tax' | 'g';
export interface Co {
  id: string; name: string; kind: string; flag?: string; status: 'ok'; nc: boolean; nc_why?: string;
  products: Partial<Record<Seg, Prod>>; blend: Fig; pnl: Partial<Record<PnlKey, Fig>>; lev: Fig;
  cap: { kind: 'a7' | 'equity'; period?: string; basis?: string; dist?: Fig; cash: Fig; scr?: Fig };
  /** v0 = max(just, floor): the justified value or the AUM floor (target AUM × the listed houses' median market value per NIS bn), `binds` names which */
  val: { basis: 'pb' | 'pe'; v0: Fig; just: Fig; floor: Fig; binds: 'just' | 'aum'; earn: Fig; book: Fig | null };
}
export type AKey = 'r' | 'ic' | 'h' | 'lev' | 'kd';
export interface AssumeJ { v: number | null; he: string; unit: string; url: string; prov: XProvJ }
export interface Row {
  a: string; t: string; rank: number | null; nc: boolean; gross: number; net: number; npv_g: number; npv: number; cap: number; price: number; ok: boolean;
  metric: number | null; eps: number | null; roe: number | null; solv: number | null; fit_prod: number; fit_track: number;
}
export interface Example { claim: string; id: string; seg: Seg; q: string; ci: Fig; ppb: Fig; ok: boolean; aum: number; first: { q: string; ci: number; aum: number }; pg_ci: number | null; pg_ppb: number | null; roe: number; note: string }
export interface Mult { v: number; date: string; aum_month: string; he: string; peers: { id: string; name: string; mcap: number; aum: number; v: number; date: string }[]; excl: { id: string; why: string }[]; prov: XProvJ }
export interface BoltSum { status: 'ok' | 'none'; why?: string; t?: string; name?: string; pair?: string; rank?: number; premium?: number; price?: number; roic?: number; solv?: number; solv_gw?: number; roe?: number; eps?: number; npv?: number; metric?: number }
export interface MatrixFile {
  meta: { built: string; base: { q: string; end: string; ltm: string[] }; v: number; asof: { aum: string; funds: string }; formula: Record<string, string>;
    assume: Record<AKey, AssumeJ>; mult: Mult; premia: number[]; primary: number; products: Record<Seg, string>; inputs: string[]; example: Example;
    excluded: { id: string; name: string; why: string }[]; note: string };
  cos: Record<string, Co>; pairs: Row[]; bolt: Record<string, BoltSum>;
}
export interface MixFile {
  id: string; name: string; g: number;
  aum: { period: string; tot: number; prods: { key: string; he: string; v: number; w: number; prov: XProvJ }[] };
  tracks: { period: string; tot: number; n: number; cats: { cat: string; v: number; w: number; n: number; prov: XProvJ }[] };
}
export interface FitJ {
  prod: { v: Fig; rows: { key: string; he: string; wa: number; wt: number }[]; period: string };
  track: { v: Fig; rows: { cat: string; wa: number; wt: number; na: number; nt: number }[]; period: string; n: [number, number] };
  channel: { status: 'nodata'; why: string };
}
export interface PairFile { meta: { a: string; t: string }; nc: boolean; rank: number | null; fit: FitJ }
export const MATRIX_PATH = 'consolidation/matrix.json';
export const pairPath = (a: string, t: string) => `consolidation/pairs/${a}__${t}.json`;
export const mixPath = (id: string) => `consolidation/mix/${id}.json`;
export const MM = 'מיליוני ש"ח';
const PP = 'נקודות אחוז';

/* ---------- provenance ---------- */
/** the provenance a pointer names (the rule of build_consolidation.res) */
export function resolve(M: MatrixFile, r: string, mixes?: Record<string, MixFile>, doc?: unknown): XProvJ | null {
  const i = r.indexOf(':');
  const scope = r.slice(0, i), path = r.slice(i + 1);
  let node: unknown = scope.startsWith('c/') ? M.cos[scope.slice(2)] : scope.startsWith('m/') ? mixes?.[scope.slice(2)] : scope === 'a' ? M.meta.assume : scope === 'k' ? M.meta : scope === 'p' ? doc : null;
  for (const k of path.split('.')) {
    if (node == null) return null;
    node = Array.isArray(node) ? node[Number(k)] : (node as Record<string, unknown>)[k];
  }
  if (node && typeof node === 'object' && 'prov' in node) return (node as { prov: XProvJ }).prov;
  return node && typeof node === 'object' && 'k' in node ? node as XProvJ : null;
}
const noLts: LtsResolver = (j) => ({ k: 'none', title: j.title, why: 'רכיבי הדוח של החברה המנהלת נטענים בעמוד עצמו' });
export function xprov(M: MatrixFile, j: XProvJ, lts: LtsResolver = noLts, mixes?: Record<string, MixFile>, depth = 0): Prov {
  if (depth > 60) return { k: 'none', title: 'מקור', why: 'שרשרת מקורות ארוכה מדי' };
  if (j.k === 'ref') { const q = resolve(M, j.r, mixes); return q ? xprov(M, q, lts, mixes, depth + 1) : { k: 'none', title: j.r, why: 'המקור לא נמצא בקובץ' }; }
  if (j.k === 'lts') return lts(j);
  if (j.k === 'calc') return { k: 'calc', title: j.title, value: j.value, unit: j.unit, formula: j.formula, est: j.est, note: j.note,
    inputs: j.inputs.map((x) => ({ label: x.label, v: x.v, src: x.p ? () => xprov(M, x.p as XProvJ, lts, mixes, depth + 1) : undefined })) };
  return j as Prov;
}

/* ---------- assumptions (the address is the state) ---------- */
export type Assume = Record<AKey, number | null>;
const RANGE: Record<AKey, [number, number]> = { r: [0, 100], ic: [0, 5], h: [1, 30], lev: [0, 80], kd: [0, 10] };
export const defaults = (M: MatrixFile): Assume => ({ r: M.meta.assume.r.v, ic: M.meta.assume.ic.v, h: M.meta.assume.h.v, lev: M.meta.assume.lev.v, kd: M.meta.assume.kd.v });
export function assumeFrom(M: MatrixFile, sp: URLSearchParams): Assume {
  const A = defaults(M);
  for (const k of Object.keys(RANGE) as AKey[]) {
    const raw = sp.get(M.meta.assume[k].url);
    if (raw == null || raw === '') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) A[k] = Math.max(RANGE[k][0], Math.min(RANGE[k][1], v));
  }
  return A;
}
export const RANGES = RANGE;
export const isOver = (M: MatrixFile, A: Assume, k: AKey) => A[k] !== defaults(M)[k] && !(A[k] != null && defaults(M)[k] != null && Math.abs(A[k]! - defaults(M)[k]!) < 1e-9);
export const anyOver = (M: MatrixFile, A: Assume) => (Object.keys(RANGE) as AKey[]).some((k) => isOver(M, A, k));
export const queryOf = (M: MatrixFile, A: Assume) => {
  const q = new URLSearchParams();
  for (const k of Object.keys(RANGE) as AKey[]) if (isOver(M, A, k) && A[k] != null) q.set(M.meta.assume[k].url, String(A[k]));
  const s = q.toString();
  return s ? `?${s}` : '';
};

/* ---------- one pair (build_consolidation.compute: the same formulas) ---------- */
export const annuity = (h: number, ke: number) => { const k = ke / 100; return (1 - (1 + k) ** -h) / k; };
export interface PRow { s: Seg; he: string; own: boolean; aum: number; fy: number; cit: number; cia: number; gross: number; net: number; h: number; ann: number; npv_g: number; npv: number }
export interface Prem { p: number; price: number; cash: number; debt: number; ok: boolean; dnp: number; eps: number | null; roe: number | null; roic: number | null; solv: number | null; gw: number; solv_gw: number | null }
export interface Pair {
  a: string; t: string; ca: Co; ct: Co; A: Assume; nc: boolean;
  rows: PRow[]; gross: number; net: number; ic: number; npv_g: number; npv: number;
  room: number; cashCap: number; capacity: number; kd: number; prem: Prem[]; metric: number | null;
}
const v = (f: Fig | undefined | null) => f?.v ?? 0;
export function pairAt(M: MatrixFile, a: string, t: string, A: Assume): Pair {
  const ca = M.cos[a], ct = M.cos[t], P = ca.pnl;
  const tax = v(P.tax), ke = v(P.ke), rf = v(P.rf), after = 1 - tax / 100;
  const rows: PRow[] = (Object.keys(ct.products) as Seg[]).map((s) => {
    const x = ct.products[s]!, pa = ca.products[s];
    const cia = pa ? pa.ci.v! : ca.blend.v!;
    const gross = x.aum.v! * x.fy.v! / 100 * (x.ci.v! - cia) / 100;
    const h = A.h != null ? A.h : x.dur.v!;
    const an = annuity(h, ke), net = gross * A.r! / 100;
    return { s, he: x.he, own: !!pa, aum: x.aum.v!, fy: x.fy.v!, cit: x.ci.v!, cia, gross, net, h, ann: an, npv_g: gross * after * an, npv: net * after * an };
  });
  const G = rows.reduce((z, x) => z + x.gross, 0), N = rows.reduce((z, x) => z + x.net, 0);
  const ic = A.ic! * Math.max(G, 0);
  const npv_g = rows.reduce((z, x) => z + x.npv_g, 0), npv = rows.reduce((z, x) => z + x.npv, 0) - ic * after;
  const D = v(P.debt_total), E = v(P.equity_end), Eavg = v(P.equity), np = v(P.net_profit);
  const L = A.lev! / 100;
  const room = L < 1 ? Math.max(0, L / (1 - L) * E - D) : 0;
  const cashCap = ca.cap.cash.v!, capacity = cashCap + room;
  const v0 = ct.val.v0.v!, earn = ct.val.earn.v!, book = ct.val.book?.v ?? 0;
  const kd = rf + A.kd!, scr = ca.cap.scr?.v ?? null;
  const prem: Prem[] = M.meta.premia.map((p) => {
    const price = v0 * (1 + p / 100), cash = Math.min(price, cashCap), debt = price - cash;
    const dnp = earn + N * after - cash * rf / 100 * after - debt * kd / 100 * after;
    const gw = Math.max(price - book, 0);
    return { p, price, cash, debt, ok: debt <= room + 1e-9, dnp, eps: np ? dnp / np * 100 : null, roe: Eavg ? dnp / Eavg * 100 : null,
      roic: price > 0 ? (earn + N * after) / price * 100 : null, solv: scr ? -cash / scr * 100 : null, gw, solv_gw: scr ? -gw / scr * 100 : null };
  });
  const p20 = prem.find((x) => x.p === M.meta.primary)!;
  return { a, t, ca, ct, A, nc: ca.nc || ct.nc, rows, gross: G, net: N, ic, npv_g, npv, room, cashCap, capacity, kd, prem, metric: p20.price > 0 ? npv / p20.price * 100 : null };
}
export const p20Of = (M: MatrixFile, x: Pair) => x.prem.find((q) => q.p === M.meta.primary)!;

/** every pair at the assumptions, ranked on the primary metric (flagged pairs and pairs without a price are not ranked) */
export interface Ranked { x: Pair; rank: number | null }
export function screen(M: MatrixFile, A: Assume): Ranked[] {
  const ids = Object.keys(M.cos).sort((p, q) => (M.cos[p].kind !== 'insurance_group' ? 1 : 0) - (M.cos[q].kind !== 'insurance_group' ? 1 : 0) || (p < q ? -1 : p > q ? 1 : 0));
  const xs: Pair[] = [];
  for (const a of ids) for (const t of ids) if (a !== t) xs.push(pairAt(M, a, t, A));
  const ranked = xs.filter((x) => !x.nc && x.metric != null).sort((p, q) => q.metric! - p.metric! || (p.a < q.a ? -1 : p.a > q.a ? 1 : 0) || (p.t < q.t ? -1 : 1));
  const rk = new Map(ranked.map((x, i) => [`${x.a}__${x.t}`, i + 1]));
  return xs.map((x) => ({ x, rank: rk.get(`${x.a}__${x.t}`) ?? null }))
    .sort((p, q) => (p.rank == null ? 1 : 0) - (q.rank == null ? 1 : 0) || (p.rank ?? 0) - (q.rank ?? 0) || (p.x.a < q.x.a ? -1 : 1) || (p.x.t < q.x.t ? -1 : 1));
}
/** affordability band of a price against the capacity */
export type Band = 'easy' | 'ok' | 'no' | 'none';
export const bandOf = (price: number, capacity: number): Band => (capacity <= 0 ? 'none' : price <= 0.5 * capacity ? 'easy' : price <= capacity + 1e-9 ? 'ok' : 'no');
export const BAND_HE: Record<Band, string> = { easy: 'בתוך הקיבולת (עד מחצית)', ok: 'בתוך הקיבולת', no: 'מעבר לקיבולת', none: 'אין קיבולת' };

/* ---------- the provenance of a pair's figures (the same chain build_consolidation.pair_doc writes) ---------- */
type Calc = Extract<Prov, { k: 'calc' }>;
type In = Calc['inputs'][number];
const pct = (x: number | null | undefined, d = 1) => (x == null ? '–' : `${fmt(x, d)}%`);
export interface Provs {
  gross: (s: Seg) => Prov; net: (s: Seg) => Prov; npvS: (s: Seg) => Prov; cia: (s: Seg) => Prov; h: (s: Seg) => Prov;
  grossT: () => Prov; netT: () => Prov; ic: () => Prov; npv: () => Prov; npvG: () => Prov;
  room: () => Prov; capacity: () => Prov; cash: () => Prov; lev: () => Prov; levMax: () => Prov;
  price: (p: number) => Prov; cashP: (p: number) => Prov; debtP: (p: number) => Prov; dnp: (p: number) => Prov; eps: (p: number) => Prov; roe: (p: number) => Prov;
  roic: (p: number) => Prov; solv: (p: number) => Prov; solvGw: (p: number) => Prov; gw: (p: number) => Prov; metric: () => Prov; kd: () => Prov;
  co: (id: string, path: string) => Prov; assume: (k: AKey) => Prov;
}
export function provsOf(M: MatrixFile, x: Pair, lts: LtsResolver = noLts): Provs {
  const { ca, ct, A } = x, an = ca.name, tn = ct.name, D = defaults(M);
  const co = (id: string, path: string): Prov => { const j = resolve(M, `c/${id}:${path}`); return j ? xprov(M, j, lts) : { k: 'none', title: path, why: 'המקור לא נמצא בקובץ' }; };
  const assume = (k: AKey): Prov => {
    const base = xprov(M, M.meta.assume[k].prov, lts);
    if (!isOver(M, A, k)) return base;
    const J = M.meta.assume[k];
    return { k: 'calc', title: `${J.he} (הקלט שלך)`, value: A[k] == null ? 'משך הספר' : `${fmt(A[k], 1)}${J.unit === '%' ? '%' : ' ' + J.unit}`, unit: J.unit, est: true, formula: 'הוזן בכתובת',
      note: 'מחושב מחדש עם ההנחה שבחרת; שאר הקלטים כבחישוב ברירת המחדל',
      inputs: [{ label: 'ברירת המחדל', v: D[k] == null ? 'משך הספר' : fmt(D[k], 1), src: () => base }] };
  };
  const i_ = (label: string, val: string, src?: () => Prov): In => ({ label, v: val, src });
  const C = (title: string, value: string, formula: string, inputs: In[], unit = MM, est = true, note?: string): Calc => ({ k: 'calc', title, value, unit, formula, inputs, est, note });
  const row = (s: Seg) => x.rows.find((r) => r.s === s)!;
  const TX = () => co(ca.id, 'pnl.tax'), KE = () => co(ca.id, 'pnl.ke'), RF = () => co(ca.id, 'pnl.rf');
  const tax = v(ca.pnl.tax), ke = v(ca.pnl.ke), rf = v(ca.pnl.rf);
  const P: Provs = {
    co, assume,
    cia: (s) => (ca.products[s] ? co(ca.id, `products.${s}.ci`) : C(`יחס עלות להכנסה של הרוכשת · ${an} · ${M.meta.products[s]}`, pct(row(s).cia), 'הרוכשת אינה מנהלת את המוצר: היחס המשוקלל שלה בפנסיה ובגמל',
      [i_('פנסיה וגמל יחד', pct(row(s).cia), () => co(ca.id, 'blend'))], '%')),
    h: (s) => (A.h == null ? co(ct.id, `products.${s}.dur`) : assume('h')),
    gross: (s) => { const r = row(s); return C(`סינרגיה גולמית · ${an} ← ${tn} · ${r.he}`, fmtS(r.gross, 1), 'נכסי היעד × תשואת דמי ניהול ÷ 100 × (יחס עלות היעד − יחס עלות הרוכשת) ÷ 100',
      [i_(`נכסי היעד · ${r.he} · ${M.meta.asof.aum}`, fmt(r.aum, 0), () => co(ct.id, `products.${s}.aum`)), i_('תשואת דמי ניהול LTM', pct(r.fy, 4), () => co(ct.id, `products.${s}.fy`)),
        i_('יחס עלות להכנסה · היעד', pct(r.cit), () => co(ct.id, `products.${s}.ci`)), i_('יחס עלות להכנסה · הרוכשת', pct(r.cia), () => P.cia(s))], MM, false); },
    net: (s) => { const r = row(s); return C(`סינרגיה נטו · ${an} ← ${tn} · ${r.he}`, fmtS(r.net, 1), 'סינרגיה גולמית × שיעור מימוש ÷ 100',
      [i_('סינרגיה גולמית', fmtS(r.gross, 1), () => P.gross(s)), i_('שיעור מימוש (הנחה)', pct(A.r, 0), () => assume('r'))]); },
    npvS: (s) => { const r = row(s); return C(`ערך נוכחי של הסינרגיה נטו · ${r.he}`, fmtS(r.npv, 1), 'נטו × (1 − מס) × a(H, ke); a = (1 − (1 + ke)^−H) ÷ ke',
      [i_('סינרגיה נטו', fmtS(r.net, 1), () => P.net(s)), i_('מס (הנחה)', pct(tax, 2), TX), i_('H', `${fmt(r.h, 2)} שנים`, () => P.h(s)), i_('ke', pct(ke, 2), KE)]); },
    grossT: () => C(`סינרגיה גולמית · ${an} ← ${tn}`, fmtS(x.gross, 1), 'Σ המוצרים, מיליוני ש"ח לשנה, לפני מס', x.rows.map((r) => i_(r.he, fmtS(r.gross, 1), () => P.gross(r.s))), MM, false),
    netT: () => C(`סינרגיה נטו · ${an} ← ${tn}`, fmtS(x.net, 1), 'Σ המוצרים', x.rows.map((r) => i_(r.he, fmtS(r.net, 1), () => P.net(r.s)))),
    ic: () => C(`עלות אינטגרציה · ${an} ← ${tn}`, fmt(x.ic, 1), 'כפולה × max(סינרגיה גולמית, 0)', [i_('סינרגיה גולמית', fmtS(x.gross, 1), P.grossT), i_('כפולה (הנחה)', `${fmt(A.ic, 1)}x`, () => assume('ic'))]),
    npvG: () => C(`ערך נוכחי של הסינרגיה הגולמית · ${an} ← ${tn}`, fmtS(x.npv_g, 1), 'Σ גולמית × (1 − מס) × a(H, ke), לפני מימוש ואינטגרציה',
      [...x.rows.map((r) => i_(r.he, fmtS(r.gross, 1), () => P.gross(r.s))), i_('מס (הנחה)', pct(tax, 2), TX), i_('ke', pct(ke, 2), KE), ...x.rows.map((r) => i_(`H · ${r.he}`, `${fmt(r.h, 2)} שנים`, () => P.h(r.s)))]),
    npv: () => C(`ערך נוכחי של הסינרגיה · ${an} ← ${tn}`, fmtS(x.npv, 1), 'Σ ערך נוכחי נטו לפי מוצר − עלות אינטגרציה × (1 − מס)',
      [...x.rows.map((r) => i_(r.he, fmtS(r.npv, 1), () => P.npvS(r.s))), i_('פחות: עלות אינטגרציה', fmt(x.ic, 1), P.ic), i_('מס (הנחה)', pct(tax, 2), TX)]),
    lev: () => co(ca.id, 'lev'), levMax: () => assume('lev'), cash: () => co(ca.id, 'cap.cash'),
    room: () => C(`מרווח חוב · ${an}`, fmt(x.room, 0), 'max(0, L ÷ (1 − L) × הון עצמי − חוב)',
      [i_('מינוף מרבי L (הנחה)', pct(A.lev), () => assume('lev')), i_('הון עצמי לבעלי המניות', fmt(v(ca.pnl.equity_end), 1), () => co(ca.id, 'pnl.equity_end')),
        i_('קרן חוב (ת126)', fmt(v(ca.pnl.debt_total), 1), () => co(ca.id, 'pnl.debt_total'))]),
    capacity: () => C(`קיבולת תשלום · ${an}`, fmt(x.capacity, 0), 'קיבולת מזומן + מרווח חוב',
      [i_(`קיבולת מזומן${ca.cap.kind === 'a7' ? ' (A7)' : ' (הון עצמי)'}`, fmt(x.cashCap, 0), () => co(ca.id, 'cap.cash')), i_('מרווח חוב', fmt(x.room, 0), P.room)]),
    kd: () => C('עלות החוב', pct(x.kd, 2), 'rf + מרווח', [i_('rf', pct(rf, 2), RF), i_('מרווח (הנחה)', `${fmt(A.kd, 1)} נ״א`, () => assume('kd'))], '%'),
    price: (p) => { const q = x.prem.find((z) => z.p === p)!; return C(`מחיר · ${tn} · פרמיה ${fmt(p, 0)}%`, fmt(q.price, 0), 'מחיר בסיס × (1 + פרמיה); מחיר בסיס = max(שווי מוצדק, רצפת שווי לנכסים)',
      [i_(`מחיר בסיס (${ct.val.binds === 'aum' ? M.meta.mult.he : 'שווי מוצדק'})`, fmt(ct.val.v0.v, 0), () => co(ct.id, 'val.v0')), i_('פרמיה', pct(p, 0))]); },
    cashP: (p) => { const q = x.prem.find((z) => z.p === p)!; return C(`מזומן · פרמיה ${fmt(p, 0)}%`, fmt(q.cash, 0), 'min(מחיר, קיבולת מזומן): מזומן קודם',
      [i_('מחיר', fmt(q.price, 0), () => P.price(p)), i_('קיבולת מזומן', fmt(x.cashCap, 0), () => co(ca.id, 'cap.cash'))]); },
    debtP: (p) => { const q = x.prem.find((z) => z.p === p)!; return C(`חוב · פרמיה ${fmt(p, 0)}%`, fmt(q.debt, 0), 'מחיר − מזומן', [i_('מחיר', fmt(q.price, 0), () => P.price(p)), i_('מזומן', fmt(q.cash, 0), () => P.cashP(p))]); },
    dnp: (p) => { const q = x.prem.find((z) => z.p === p)!; return C(`תוספת לרווח הנקי · ${an} ← ${tn} · פרמיה ${fmt(p, 0)}%`, fmtS(q.dnp, 1),
      'רווח היעד + סינרגיה נטו × (1 − מס) − מזומן × rf × (1 − מס) − חוב × (rf + מרווח) × (1 − מס)',
      [i_('רווח היעד LTM', fmt(ct.val.earn.v, 1), () => co(ct.id, 'val.earn')), i_('סינרגיה נטו', fmtS(x.net, 1), P.netT), i_('מזומן', fmt(q.cash, 0), () => P.cashP(p)), i_('rf', pct(rf, 2), RF),
        i_('חוב', fmt(q.debt, 0), () => P.debtP(p)), i_('עלות החוב', pct(x.kd, 2), P.kd), i_('מס (הנחה)', pct(tax, 2), TX)], MM, true, 'סינרגיה בקצב מלא, בלי עלות האינטגרציה; אין הנפקת מניות; אין הפחתת מוניטין (IFRS)'); },
    eps: (p) => { const q = x.prem.find((z) => z.p === p)!; return C(`השפעה על הרווח למניה · ${an} · פרמיה ${fmt(p, 0)}%`, `${fmtS(q.eps, 1)}%`, 'תוספת לרווח ÷ רווח נקי LTM של הרוכשת × 100',
      [i_('תוספת לרווח', fmtS(q.dnp, 1), () => P.dnp(p)), i_('רווח נקי LTM', fmt(v(ca.pnl.net_profit), 1), () => co(ca.id, 'pnl.net_profit'))], '%'); },
    roe: (p) => { const q = x.prem.find((z) => z.p === p)!; return C(`השפעה על ROE · ${an} · פרמיה ${fmt(p, 0)}%`, `${fmtS(q.roe, 2)} נ״א`, 'תוספת לרווח ÷ הון ממוצע × 100 (ההון לא משתנה: מזומן וחוב)',
      [i_('תוספת לרווח', fmtS(q.dnp, 1), () => P.dnp(p)), i_('הון ממוצע', fmt(v(ca.pnl.equity), 1), () => co(ca.id, 'pnl.equity'))], PP); },
    roic: (p) => { const q = x.prem.find((z) => z.p === p)!; return C(`ROIC · ${an} ← ${tn} · פרמיה ${fmt(p, 0)}%`, pct(q.roic), '(רווח היעד + סינרגיה נטו × (1 − מס)) ÷ מחיר × 100',
      [i_('רווח היעד LTM', fmt(ct.val.earn.v, 1), () => co(ct.id, 'val.earn')), i_('סינרגיה נטו', fmtS(x.net, 1), P.netT), i_('מס (הנחה)', pct(tax, 2), TX), i_('מחיר', fmt(q.price, 0), () => P.price(p))], '%'); },
    gw: (p) => { const q = x.prem.find((z) => z.p === p)!; return C(`מוניטין · פרמיה ${fmt(p, 0)}%`, fmt(q.gw, 0), `max(מחיר − הון היעד, 0)${ct.val.book ? '' : '; הון זרוע החיסכון אינו מדווח בנפרד: כל המחיר'}`,
      [i_('מחיר', fmt(q.price, 0), () => P.price(p)), ...(ct.val.book ? [i_('הון עצמי של היעד', fmt(ct.val.book.v, 1), () => co(ct.id, 'val.book'))] : [])]); },
    solv: (p) => { const q = x.prem.find((z) => z.p === p)!; return C(`עלות כושר פירעון · ${an} · פרמיה ${fmt(p, 0)}%`, `${fmtS(q.solv, 1)} נ״א`, '− מזומן מהעודף ÷ SCR × 100 (מנגנון A7: העודף יוצא מההון כמו דיבידנד; החוב בחברת האם)',
      [i_('מזומן', fmt(q.cash, 0), () => P.cashP(p)), i_('SCR', fmt(ca.cap.scr?.v, 0), () => co(ca.id, 'cap.scr'))], PP); },
    solvGw: (p) => { const q = x.prem.find((z) => z.p === p)!; return C(`עלות כושר פירעון, רישום בחברת הביטוח · ${an} · פרמיה ${fmt(p, 0)}%`, `${fmtS(q.solv_gw, 1)} נ״א`,
      '− מוניטין ÷ SCR × 100 (הנחה: היעד מוחזק בחברת הביטוח; מוניטין מנוכה מההון העצמי לעניין SCR)', [i_('מוניטין', fmt(q.gw, 0), () => P.gw(p)), i_('SCR', fmt(ca.cap.scr?.v, 0), () => co(ca.id, 'cap.scr'))], PP); },
    metric: () => { const q = p20Of(M, x); return C(`ערך נוכחי של הסינרגיה ÷ מחיר · ${an} ← ${tn}`, pct(x.metric), `ערך נוכחי נטו ÷ מחיר בפרמיה ${fmt(M.meta.primary, 0)}% × 100 (המדד המדרג היחיד)`,
      [i_('ערך נוכחי של הסינרגיה', fmtS(x.npv, 1), P.npv), i_(`מחיר בפרמיה ${fmt(M.meta.primary, 0)}%`, fmt(q.price, 0), () => P.price(q.p))], '%'); },
  };
  return P;
}
