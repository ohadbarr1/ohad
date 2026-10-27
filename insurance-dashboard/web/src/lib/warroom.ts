/* A5 · the Competitive War Room: a fee move and the competitors' answers, simulated over the estimated flow elasticity
   (web/public/data/warroom/elasticity.json) on the board of one product × track category (warroom/board.json), both built by
   pipeline/build_warroom.py; AUM, revenue and operating profit through A1 (drivers.ts propagate), the value of a flow through M3.
   Pure functions, no React: the page and the unit test call exactly this API.

   The flow model (pairwise, zero-sum, linear):
     a manager i that cuts δ_i bp more than a manager k draws from k, every month t after the move,
       F(k → i, t) = −B / 100 × ramp(t) × A_i × d(i → k) × (δ_i − δ_k)
     B      the product's elasticity: % of the cutter's own category assets a month per 1bp of relative fee (negative = a cheaper track gains)
     ramp   the cumulative share of B reached k months after the move (from the lags, or a six-month straight line: labelled)
     A_i    the cutter's assets in the category, d(i → k) who loses when i wins (revealed substitution, or the share of the category's assets)
   With one mover and the others holding, the mover's flow is exactly B × its relative-fee change × its assets (the regression's own
   quantity); with share weights a full match is exactly the relative-fee arithmetic of the regression (others' asset-weighted mean).

   The value (M3, pipeline/build_flow_npv.py; the A1 edge tr.npv carries m, a(D, ke), ke per company and product):
     NPV_i = a_i × [ Σ_q F_i,q × (m_i − δ_i / 100) / 100 × (1 + ke)^−(q + ½)/4  −  A_i × δ_i / 10,000 ]
     the fee given up on the manager's own book over its M3 tenure, against the margin (after the cut) on the flow it wins or loses. */
import { fmt, fmtS, propagate, toProv, type DriverFile, type Edge, type LtsResolver, type ProvJ } from './drivers';
import type { Prov } from './prov';

/* ---------- the files ---------- */
export type WProd = 'pen' | 'gemel' | 'hisht';
export const WPRODS: WProd[] = ['pen', 'gemel', 'hisht'];
export type Q4 = 'high' | 'medium' | 'low' | 'none';
export interface Coef { x: string; b: number; se: number; t: number }
export interface Spec { B: number; se: number; t: number; n: number; clusters: number; r2: number; coef: Coef[] }
export type RobKey = 'mgr' | 'fd' | 'posted';
export interface ElProd {
  he: string; a1: 'pen' | 'gem'; fam: string; ds: string; main: Spec; rob: Record<RobKey, Spec>; quality: Q4; why: string; per_bp_year: number;
  ramp: { how: 'lags' | 'assumed'; c: number[] }; peak_lag: number | null; half_lag: number | null; events: { ge1: number; ge5: number; cuts: number; rises: number };
  tracks: number; window: string; flow_share?: number; prov: ProvJ;
}
export interface ElFile {
  meta: { built: string; asof: number; window: string; lags: number; source: string;
    fee_timing: { corr_same: number | null; n_same: number; corr_prior: number | null; n_prior: number; changes: number; january: number; rule: string } };
  products: Record<WProd, ElProd>;
  pooled: { main: Spec; quality: Q4; why: string; per_bp_year: number };
}
/** [dataset, fund id, name, assets (latest month), posted fee (%), net transfers in the quarter's three months, net transfers LTM] */
export type Track = [string, number, string, number, number | null, [number, number, number], number];
export interface Mgr { g: number; c: string | null; he: string; A: number; fee: number | null; trq: number; tr12: number; tracks: Track[] }
export interface Div { how: 'revealed' | 'share'; cover: number; n: number; w: Record<string, number>; raw?: Record<string, { b: number; t: number | null }> }
export interface Cat { cat: string; A: number; mgrs: Mgr[]; div: Record<string, Div> }
export interface BoardFile {
  meta: { built: string; asof: number; fee_year: number; q_months: number[]; l12: number[]; div: { min_n: number; min_cover: number };
    ke: { v: number; rf?: number; rf_month?: string; beta?: number; erp?: number; rf_url?: string }; dur: Record<string, number>; resources?: Record<string, string[]> };
  groups: string[]; co: Record<string, string | null>;
  products: Record<WProd, { he: string; a1: 'pen' | 'gem'; ds: string; cats: Cat[] }>;
  ctx: { q: string[]; pi: Record<string, number>; tr: Record<string, Partial<Record<'pen' | 'gem', Record<string, number>>>> };
}
export const EL_PATH = 'warroom/elasticity.json', BOARD_PATH = 'warroom/board.json';

/* ---------- labels ---------- */
export const Q_HE: Record<Q4, string> = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה', none: 'אין אות' };
export type ElSrc = 'main' | RobKey | 'pooled' | 'set';
export const EL_SRC_HE: Record<ElSrc, string> = { main: 'אומדן ראשי', fd: 'הפרשים ראשונים', mgr: 'עם אפקט מנהל × חודש', posted: 'דמי ניהול כפי שפורסמו', pooled: 'מאוחד, שלושת המוצרים', set: 'הנחה שלך' };
export type Strat = 'match' | 'partial' | 'hold' | 'counter';
export const STRATS: Strat[] = ['match', 'partial', 'hold', 'counter'];
export const STRAT_HE: Record<Strat, string> = { match: 'השוואה', partial: 'השוואה חלקית', hold: 'החזקה', counter: 'מענה בזירה אחרת' };
export const STRAT_SUB: Record<Strat, string> = { match: '−δ באותו מסלול', partial: '−δ/2 באותו מסלול', hold: 'ללא שינוי', counter: '−δ בקטגוריה הגדולה הבאה של המניע' };
export const H = 24;   // months: 8 quarters
export const MM = 'מיליוני ש"ח';
const ml = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
export const monthLabel = ml;
export const short = (g: string) => g.replace('מנורה מבטחים', 'מנורה').replace('אלטשולר שחם', 'אלטשולר').replace('ילין לפידות', 'ילין').replace('ביטוח ישיר', 'ישיר');

/* ---------- provenance of the board ---------- */
export class BoardSrc {
  constructor(readonly b: BoardFile) {}
  fund(t: Track, col: string, period: number, value: string, unit: string, title?: string): Prov {
    return { k: 'fund', title: title ?? `${t[2]} · ${ml(period)}`, value, unit, ds: t[0] as 'gemel' | 'pensia', id: t[1], period, col };
  }
  /** a manager's assets in a category: the sum of its tracks' TOTAL_ASSETS in the latest month */
  assets(m: Mgr, cat: string): Prov {
    const p = this.b.meta.asof;
    return { k: 'calc', title: `נכסים · ${m.he} · ${cat} · ${ml(p)}`, value: fmt(m.A, 0), unit: MM, formula: 'Σ TOTAL_ASSETS של מסלולי המנהל בקטגוריה, החודש האחרון שפורסם',
      inputs: m.tracks.map((t) => ({ label: t[2], v: fmt(t[3], 1), src: () => this.fund(t, 'TOTAL_ASSETS', p, fmt(t[3], 1), MM) })) };
  }
  /** the manager's posted fee in the category: the asset-weighted January value (the average charged the previous year) */
  fee(m: Mgr, cat: string): Prov {
    const p = this.b.meta.fee_year * 100 + 1;
    return { k: 'calc', title: `דמי ניהול ממוצעים מהצבירה · ${m.he} · ${cat}`, value: m.fee == null ? '–' : `${fmt(m.fee, 3)}%`, unit: 'לשנה',
      formula: `ממוצע משוקלל בנכסים (${ml(this.b.meta.asof)}) של AVG_ANNUAL_MANAGEMENT_FEE שפורסם ב-${ml(p)}: דמי הניהול שנגבו בפועל ב-${this.b.meta.fee_year - 1}`,
      inputs: m.tracks.filter((t) => t[4] != null).map((t) => ({ label: `${t[2]} · משקל ${fmt(t[3], 0)}`, v: `${fmt(t[4], 2)}%`, src: () => this.fund(t, 'AVG_ANNUAL_MANAGEMENT_FEE', p, `${fmt(t[4], 2)}%`, 'לשנה') })) };
  }
  /** the manager's net transfers in the category over the last quarter: Σ INTERNAL_TRANSFERS of its tracks, month by month */
  trq(m: Mgr, cat: string): Prov {
    const qm = this.b.meta.q_months;
    return { k: 'calc', title: `ניוד נטו · ${m.he} · ${cat} · ${ml(qm[0])}–${ml(qm[2])}`, value: fmtS(m.trq, 0), unit: MM, formula: 'Σ INTERNAL_TRANSFERS של מסלולי המנהל בקטגוריה, שלושת חודשי הרבעון',
      inputs: m.tracks.flatMap((t) => qm.map((p, i) => ({ label: `${t[2]} · ${ml(p)}`, v: fmtS(t[5][i], 1), src: () => this.fund(t, 'INTERNAL_TRANSFERS', p, fmtS(t[5][i], 1), MM) }))) };
  }
  /** the category's asset-weighted fee of everyone but the manager (the regression's comparison) */
  relFee(c: Cat, m: Mgr): { v: number | null; p: () => Prov } {
    const o = c.mgrs.filter((x) => x.g !== m.g && x.fee != null);
    const w = o.reduce((t, x) => t + x.A, 0);
    const avg = w ? o.reduce((t, x) => t + x.A * x.fee!, 0) / w : null;
    const v = avg != null && m.fee != null ? (m.fee - avg) * 100 : null;
    return { v, p: () => ({ k: 'calc', title: `דמי ניהול יחסיים · ${m.he} · ${c.cat}`, value: v == null ? '–' : `${fmtS(v, 1)} נ״ב`, unit: 'נ״ב',
      formula: '(דמי הניהול של המנהל − הממוצע המשוקלל בנכסים של שאר המנהלים בקטגוריה) × 100',
      inputs: [{ label: m.he, v: m.fee == null ? '–' : `${fmt(m.fee, 3)}%`, src: () => this.fee(m, c.cat) },
        ...o.map((x) => ({ label: `${x.he} · משקל ${fmt(x.A, 0)}`, v: `${fmt(x.fee, 3)}%`, src: () => this.fee(x, c.cat) }))] }) };
  }
  /** the quarter's net transfers of a group in a segment (lens.json, the regulator aggregate) */
  ctxTr(g: number, s: 'pen' | 'gem', q: string): { v: number; p: () => Prov } | null {
    const v = this.b.ctx.tr[String(g)]?.[s]?.[q], pi = this.b.ctx.pi[q];
    if (v == null || pi == null) return null;
    return { v, p: () => ({ k: 'reg', metric: 'transfers', pi, w: 'q', set: s === 'pen' ? 'fam:pension' : 'fam:gemel', g }) };
  }
}

/* ---------- the elasticity in use ---------- */
export interface ElUse { B: number | null; t: number | null; q: Q4 | 'set'; how: ElSrc; ramp: number[]; rampHow: 'lags' | 'assumed'; p: () => Prov; flag?: string }
/** the elasticity a scenario runs on: the product's main estimate unless its signal is absent (then nothing moves, and the page says so) */
export function elasticity(el: ElFile, prod: WProd, src: ElSrc, set: number | null, lts?: LtsResolver): ElUse {
  const P = el.products[prod];
  const ramp = P.ramp.c, rampHow = P.ramp.how;
  const base = () => toProv(P.prov, lts);
  const mk = (B: number | null, t: number | null, q: Q4 | 'set', title: string, formula: string, inputs: { label: string; v: string; src?: () => Prov }[], flag?: string): ElUse =>
    ({ B, t, q, how: src, ramp, rampHow, flag, p: () => ({ k: 'calc', title, value: B == null ? '–' : fmtS(B, 4), unit: '% מהנכסים בחודש לכל 1 נ״ב', est: true, formula, inputs }) });
  if (src === 'set') {
    const B = set == null ? null : -Math.abs(set) / 12;
    return mk(B, null, 'set', `גמישות הניוד · ${P.he} · הנחה`, 'ההנחה שלך: % מהנכסים בשנה לכל 1 נ״ב יתרון ÷ 12, בסימן שלילי',
      [{ label: 'ההנחה (% בשנה לכל נ״ב)', v: set == null ? '–' : fmt(set, 3) }, { label: 'האומדן הראשי לשם השוואה', v: fmtS(P.main.B, 4), src: base }]);
  }
  if (src === 'pooled') {
    const s = el.pooled;
    const ok = s.quality !== 'none';
    return mk(ok ? s.main.B : null, s.main.t, s.quality, 'גמישות הניוד · שלושת המוצרים יחד', 'אותה רגרסיה על פנסיה, גמל והשתלמות יחד (אפקט מוצר × קטגוריה × חודש)',
      [{ label: 'B', v: `${fmtS(s.main.B, 4)} (t ${fmt(s.main.t, 2)}, n ${s.main.n.toLocaleString('en-US')})` }, { label: 'R² בתוך', v: fmt(s.main.r2, 3) }, { label: 'האומדן של המוצר', v: fmtS(P.main.B, 4), src: base }],
      ok ? undefined : 'אין אות גם באומדן המאוחד: לא זזה זרימה');
  }
  const s = src === 'main' ? P.main : P.rob[src];
  const q: Q4 = src === 'main' ? P.quality : s.B < 0 && s.t <= -3 ? 'high' : s.B < 0 && s.t <= -2 ? 'medium' : s.B < 0 && s.t <= -1 ? 'low' : 'none';
  const ok = q !== 'none';
  return mk(ok ? s.B : null, s.t, q, `גמישות הניוד · ${P.he} · ${EL_SRC_HE[src]}`, src === 'main' ? 'האומדן הראשי (פירוט במקור)' : `בדיקת חוסן: ${EL_SRC_HE[src]}`,
    [{ label: 'B = Σ b_k', v: `${fmtS(s.B, 4)} (se ${fmt(s.se, 4)}, t ${fmt(s.t, 2)})`, src: base }, { label: 'n · מסלולים', v: `${s.n.toLocaleString('en-US')} · ${s.clusters}` }, { label: 'R² בתוך', v: fmt(s.r2, 3) }],
    ok ? undefined : `אין אות (t ${fmt(s.t, 2)}${s.B >= 0 ? ', סימן הפוך' : ''}): לא זזה זרימה. לבחירה: בדיקת חוסן או הנחה`);
}

/* ---------- the flow simulation ---------- */
export type Alloc = 'rev' | 'share';
export interface Move { cat: Cat; cuts: Map<number, number> }   // g -> bp cut (positive = lower fee)
/** who loses when i wins, in this category: revealed weights when estimable and chosen, else asset shares (excluding i) */
export function weights(c: Cat, g: number, alloc: Alloc): { w: Map<number, number>; how: 'revealed' | 'share' } {
  const d = c.div[String(g)];
  if (alloc === 'rev' && d?.how === 'revealed') return { w: new Map(Object.entries(d.w).map(([k, v]) => [Number(k), v])), how: 'revealed' };
  const o = c.mgrs.filter((m) => m.g !== g), A = o.reduce((t, m) => t + m.A, 0);
  return { w: new Map(o.map((m) => [m.g, A ? m.A / A : 0])), how: 'share' };
}
export interface Flows { m: Map<number, number[]>; pairs: { from: number; to: number; rate: number }[] }
/** monthly net flow of every manager of the category (NIS m, months 1..H), and the pairwise full-ramp rates behind it */
export function simulate(mv: Move, B: number | null, ramp: number[], alloc: Alloc): Flows {
  const m = new Map<number, number[]>(mv.cat.mgrs.map((x) => [x.g, Array(H).fill(0)]));
  const pairs: Flows['pairs'] = [];
  if (B == null || B >= 0) return { m, pairs };
  const A = new Map(mv.cat.mgrs.map((x) => [x.g, x.A]));
  for (const [i, di] of mv.cuts) {
    if (!(di > 0) || !A.has(i)) continue;
    const { w } = weights(mv.cat, i, alloc);
    for (const [k, d] of w) {
      const gap = di - (mv.cuts.get(k) ?? 0);
      if (gap <= 0 || !d || !m.has(k)) continue;
      const rate = -B / 100 * A.get(i)! * d * gap;
      pairs.push({ from: k, to: i, rate });
      for (let t = 0; t < H; t++) { const f = rate * ramp[Math.min(t, ramp.length - 1)]; m.get(i)![t] += f; m.get(k)![t] -= f; }
    }
  }
  return { m, pairs };
}
export const quarters = (xs: number[]) => Array.from({ length: H / 3 }, (_, q) => xs[3 * q] + xs[3 * q + 1] + xs[3 * q + 2]);
export const total = (xs: number[]) => xs.reduce((t, x) => t + x, 0);

/* ---------- value: M3 over the A1 edge ---------- */
export interface Val { m: number; a: number; ke: number; D: number; est: boolean; p: () => Prov; why?: string }
/** m, a(D, ke) of a manager's product, from its A1 tr.npv edge; where it is missing, the asset-weighted mean of the category's priced managers (labelled) */
export function valueOf(files: Map<string, DriverFile>, c: Cat, x: Mgr, a1: 'pen' | 'gem', lts?: LtsResolver): Val | null {
  const edge = (cid: string | null): Edge | undefined => (cid ? files.get(cid)?.products.find((p) => p.s === a1)?.edges.find((e) => e.e === 'tr.npv' && e.v != null && e.quality !== 'missing') : undefined);
  const e = edge(x.c);
  if (e && e.m != null && e.a != null) return { m: e.m, a: e.a, ke: e.ke ?? 0, D: e.D ?? 0, est: false, p: () => toProv(e.prov, lts) };
  const priced = c.mgrs.map((y) => ({ y, e: edge(y.c) })).filter((z) => z.e?.m != null && z.e.a != null);
  const W = priced.reduce((t, z) => t + z.y.A, 0);
  if (!W) return null;
  const m = priced.reduce((t, z) => t + z.y.A * z.e!.m!, 0) / W, a = priced.reduce((t, z) => t + z.y.A * z.e!.a!, 0) / W;
  return { m, a, ke: priced[0].e!.ke ?? 0, D: priced[0].e!.D ?? 0, est: true, why: x.c ? 'אין מרווח M3 לחברה במוצר זה' : 'אין דוחות לקבוצה',
    p: () => ({ k: 'calc', title: `מרווח וגורם היוון · ${x.he} · ממוצע הקטגוריה (הנחה)`, value: `${fmt(m, 4)}%`, unit: 'לשנה', est: true,
      formula: 'אין קשר tr.npv לחברה: ממוצע משוקלל בנכסי הקטגוריה של m ושל a(D, ke) אצל המנהלים שיש להם (M3)',
      inputs: priced.map((z) => ({ label: `${z.y.he} · m · a`, v: `${fmt(z.e!.m!, 4)}% · ${fmt(z.e!.a!, 3)}`, src: () => toProv(z.e!.prov, lts) })) }) };
}
export const disc = (ke: number, q: number) => Math.pow(1 + ke / 100, -(q + 0.5) / 4);
/** NPV (NIS m) of one manager's position in one category: the margin after its cut on its quarterly flow, less the fee given up on its book */
export function npv(v: Val, flowsQ: number[], A: number, bp: number) {
  const flow = v.a * flowsQ.reduce((t, f, q) => t + f * (v.m - bp / 100) / 100 * disc(v.ke, q), 0);
  const fee = v.a * A * bp / 10_000;
  return { flow, fee, v: flow - fee };
}

/* ---------- a full scenario: the move plus a response profile ---------- */
export interface Ctx { prod: WProd; a1: 'pen' | 'gem'; cats: Cat[]; files: Map<string, DriverFile>; el: ElUse; alloc: Alloc; lts?: LtsResolver }
export interface Scen { mover: number; cat: string; bp: number; resp: Map<number, Strat> }
/** the category where a competitor answers elsewhere: the mover's largest other category of the product in which the competitor also has assets */
export function counterCat(ctx: Ctx, mover: number, cat: string, g: number): Cat | null {
  return ctx.cats.filter((c) => c.cat !== cat && c.mgrs.some((x) => x.g === mover) && c.mgrs.some((x) => x.g === g))
    .sort((a, b) => b.mgrs.find((x) => x.g === mover)!.A - a.mgrs.find((x) => x.g === mover)!.A)[0] ?? null;
}
export interface CatRun { cat: Cat; cuts: Map<number, number>; fl: Flows }
/** every category the profile touches, each with its cuts and simulated flows */
export function run(ctx: Ctx, s: Scen): CatRun[] {
  const by = new Map<string, Map<number, number>>();
  const cut = (c: string, g: number, bp: number) => { if (!by.has(c)) by.set(c, new Map()); by.get(c)!.set(g, (by.get(c)!.get(g) ?? 0) + bp); };
  cut(s.cat, s.mover, s.bp);
  for (const [g, st] of s.resp) {
    if (st === 'match') cut(s.cat, g, s.bp);
    else if (st === 'partial') cut(s.cat, g, s.bp / 2);
    else if (st === 'counter') { const c = counterCat(ctx, s.mover, s.cat, g); if (c) cut(c.cat, g, s.bp); }
  }
  return [...by].map(([c, cuts]) => { const cat = ctx.cats.find((x) => x.cat === c)!; return { cat, cuts, fl: simulate({ cat, cuts }, ctx.el.B, ctx.el.ramp, ctx.alloc) }; });
}
/** a manager's NPV over every touched category (null when no margin can be priced) */
export function payoff(ctx: Ctx, runs: CatRun[], g: number): { v: number; flow: number; fee: number; est: boolean } | null {
  let v = 0, flow = 0, fee = 0, est = false, any = false;
  for (const r of runs) {
    const x = r.cat.mgrs.find((m) => m.g === g); if (!x) continue;
    const val = valueOf(ctx.files, r.cat, x, ctx.a1, ctx.lts); if (!val) return null;
    const n = npv(val, quarters(r.fl.m.get(g)!), x.A, r.cuts.get(g) ?? 0);
    v += n.v; flow += n.flow; fee += n.fee; est ||= val.est; any = true;
  }
  return any ? { v, flow, fee, est } : null;
}

/* ---------- the response matrix and the best-response profile ---------- */
export interface Cell { s: Strat; v: number | null; est: boolean; na?: string }
export interface Row { g: number; cells: Cell[]; best: Strat | null; dominant: boolean; brAt: Strat[] }
export type Others = 'hold' | 'nash';
export function payoffOf(ctx: Ctx, base: Scen, g: number, st: Strat): Cell {
  if (st === 'counter' && !counterCat(ctx, base.mover, base.cat, g)) return { s: st, v: null, est: false, na: 'אין קטגוריה נוספת שבה שניהם פעילים' };
  const resp = new Map(base.resp); resp.set(g, st);
  const p = payoff(ctx, run(ctx, { ...base, resp }), g);
  return p ? { s: st, v: p.v, est: p.est } : { s: st, v: null, est: false, na: 'אין מרווח M3 לחברה ולקטגוריה' };
}
const argmax = (cells: Cell[]): Strat | null => {
  const ok = cells.filter((c) => c.v != null);
  if (!ok.length) return null;
  const top = Math.max(...ok.map((c) => c.v!));
  return (ok.find((c) => c.s === 'hold' && c.v! >= top - 1e-9) ?? ok.find((c) => c.v! >= top - 1e-9)!).s;   // ties: the status quo
};
/** iterated best responses from "everyone holds", in order of assets; stops at a fixed point (a pure Nash profile of the competitors,
    the mover's move held fixed) or after 30 rounds */
export function nash(ctx: Ctx, mover: number, cat: string, bp: number, players: number[]): { prof: Map<number, Strat>; rounds: number; stable: boolean } {
  const prof = new Map<number, Strat>(players.map((g) => [g, 'hold']));
  for (let r = 1; r <= 30; r++) {
    let moved = false;
    for (const g of players) {
      const cells = STRATS.map((s) => payoffOf(ctx, { mover, cat, bp, resp: prof }, g, s));
      const b = argmax(cells);
      if (b && b !== prof.get(g)) { prof.set(g, b); moved = true; }
    }
    if (!moved) return { prof, rounds: r, stable: true };
  }
  return { prof, rounds: 30, stable: false };
}
/** one row per competitor: the payoff of each answer with the others at `others`, its best answer, and whether that answer is best against
    every tested profile of the others (all hold, all match, all partial, all counter, the best-response profile): "dominant" in that set */
export function matrix(ctx: Ctx, mover: number, cat: string, bp: number, players: number[], others: Others, eq: Map<number, Strat>): Row[] {
  const profiles: Map<number, Strat>[] = [...STRATS.map((s) => new Map(players.map((g) => [g, s] as [number, Strat]))), eq];
  return players.map((g) => {
    const at = others === 'nash' ? eq : profiles[STRATS.indexOf('hold')];
    const cells = STRATS.map((s) => payoffOf(ctx, { mover, cat, bp, resp: at }, g, s));
    const brAt = profiles.map((pr) => argmax(STRATS.map((s) => payoffOf(ctx, { mover, cat, bp, resp: pr }, g, s)))).filter((x): x is Strat => !!x);
    const best = argmax(cells);
    return { g, cells, best, brAt, dominant: !!best && brAt.length === profiles.length && brAt.every((x) => x === brAt[0]) };
  });
}

/* ---------- A1: AUM, revenue and operating profit of a manager after the horizon ---------- */
export interface A1Out { dAum: number; rev: number | null; op: number | null; pRev?: () => Prov; pOp?: () => Prov; why?: string }
/** the run-rate effect at the end of the horizon, through the company's A1 graph restricted to the product: the flow as a share of the
    product's average assets, the cut as a fee compression scaled to the category's share of the product */
export function a1Impact(files: Map<string, DriverFile>, x: Mgr, a1: 'pen' | 'gem', dAum: number, bp: number, A: number, lts?: LtsResolver): A1Out {
  const f = x.c ? files.get(x.c) : undefined;
  const p = f?.products.find((q) => q.s === a1);
  if (!f || !p || p.avg.v == null) return { dAum, rev: null, op: null, why: !x.c ? 'אין דוחות לקבוצה' : !f ? 'קובץ המנגנונים לא נטען' : 'אין למוצר נכסים ממוצעים בגרף A1' };
  const one: DriverFile = { ...f, products: [p] };
  const r = propagate(one, { flow: dAum / p.avg.v * 100, fee: bp * A / p.avg.v }, { lts });
  return { dAum, rev: r.out.revenue.d, op: r.out.op_profit.d, pRev: () => r.out.revenue.prov, pOp: () => r.out.op_profit.prov };
}

/* ---------- break-even ---------- */
/** the elasticity at which the mover's NPV is zero with everyone holding (NPV is linear in B); null when the margin after the cut is not positive */
export function breakEven(ctx: Ctx, mover: number, cat: string, bp: number): number | null {
  const c = ctx.cats.find((x) => x.cat === cat)!, x = c.mgrs.find((m) => m.g === mover)!;
  const v = valueOf(ctx.files, c, x, ctx.a1, ctx.lts);
  if (!v || v.m - bp / 100 <= 0) return null;
  const unit = { ...ctx, el: { ...ctx.el, B: -1 } };
  const r = run(unit, { mover, cat, bp, resp: new Map() })[0];
  const n = npv(v, quarters(r.fl.m.get(mover)!), x.A, bp);
  return n.flow > 0 ? -n.fee / n.flow : null;
}
