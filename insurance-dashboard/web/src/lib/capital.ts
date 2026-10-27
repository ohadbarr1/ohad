/* A7 · Capital & Strategic Options: the surplus capital of an insurer, the option set over it, and how much of it survives each A2 preset.
   Pure functions only, no React: the company panel, /capital and tests/capital.unit.ts call exactly this.

   capital/options.json (pipeline/build_capital.py) carries, per insurer, own funds and SCR on each printed basis, the board's targets and
   dividend thresholds as printed, the management buffer (a labelled assumption), the distributable capital and the four option rows at
   that buffer. Here:
     optionsAt(c, pp)   the same rows for a buffer the reader chose (the formulas of build_capital.options, cross-checked by the unit test)
     stressOf(...)      every A2 preset through drivers.ts propagate: Δ solvency ratio per basis × SCR (held fixed, A1's rule) on every
                        constraint; the stressed distributable is the lowest constraint less the buffer
     cprov(c, j)        a file provenance node as a Prov (refs inside the company resolved; nested sources lazy)
   Nothing here is a recommendation: the rows are analytical options, ranked by ROIC − ke per NIS deployed, with their solvency cost. */
import { propagate, fmt, fmtS, type DriverFile, type LtsResolver, type ProvJ } from './drivers';
import { makeCtx, shockFor, scnText, type NcBase, type NcRowJ, type Preset } from './scenarios';
import type { Prov } from './prov';

/* ---------- the file ---------- */
export type CProvJ = ProvJ | { k: 'ref'; r: string } | { k: 'calc'; title: string; value: string; unit?: string; formula: string; inputs: { label: string; v: string; p?: CProvJ }[]; est?: boolean; note?: string };
export interface CFig { v: number | null; prov: CProvJ }
export type Basis = 'w' | 'wo';
export interface CBasis { of: CFig; scr: CFig; ratio: CFig; printed: number | null; printed_prov?: CProvJ }
export interface Con { id: string; kind: 'board' | 'div' | 'reg'; basis: Basis; stated: Basis | null; t: number; t_prov: CProvJ; period: string; he: string; headroom: CFig; pp: number }
export interface OptRow { id: 'div' | 'org'; cap: CFig; roic: CFig; solv: CFig; per_bn: number; roe: CFig; eps: CFig; eps_bb?: CFig }
/** the A9 bolt-on (pipeline/build_consolidation.py): the best-ranked target the insurer can afford at a 20% premium, at the file's buffer;
    its provenance table `src` travels with the row (refs `bolt.<pointer>`) */
export interface BoltRow { id: 'bolt'; status: 'ok'; tgt: string; tgt_name: string; pair: string; rank_a9: number; premium: number;
  cap: CFig; roic: CFig; solv?: CFig; solv_gw?: CFig; roe: CFig; eps: CFig; npv: CFig; metric: CFig; src: Record<string, CProvJ> }
export type Opt = OptRow | BoltRow | { id: 'bolt'; status: 'none'; why: string } | { id: 'bolt'; status: 'A9' } | { id: 'hold'; status: 'A2' };
export interface Policy { he: string; v: number; unit: string; d: string; prov: CProvJ }
export interface CapOk {
  id: string; name: string; kind: string; status: 'ok'; flag?: string; date: string; period: string;
  bases: Partial<Record<Basis, CBasis>>; constraints: Con[]; binding: string;
  buffer: { pp: number; v: number; rule: 'drift' | 'fallback'; n: number; basis: Basis; prov: CProvJ; v_prov: CProvJ };
  distributable: CFig;
  pnl: Record<'net_profit' | 'equity' | 'roe' | 'ke' | 'tax' | 'rf', CFig> & Partial<Record<'equity_end' | 'pb', CFig>>;
  dividend: { ltm: CFig | null; policy: Policy[]; printed_over: { v: number; d: string; basis: Basis | null; after: boolean; prov: CProvJ } | null };
  options: Opt[]; rank: string[];
}
export interface CapNa { id: string; name: string; kind: string; status: 'na'; why: string; flag?: string }
export type CapCo = CapOk | CapNa;
export interface CapFile { meta: { built: string; base: { q: string; end: string; ltm: string[] }; v: number; formula: string; buffer_rule: string; stress: string }; companies: CapCo[] }
export const CAPITAL_PATH = 'capital/options.json';
export const isOk = (c: CapCo): c is CapOk => c.status === 'ok';
export const isRow = (o: Opt): o is OptRow => o.id === 'div' || o.id === 'org';
export const isBolt = (o: Opt): o is BoltRow => o.id === 'bolt' && o.status === 'ok';
export const boltOf = (c: CapOk): Opt => c.options.find((o) => o.id === 'bolt') ?? { id: 'bolt', status: 'A9' };

/* ---------- provenance ---------- */
/** the provenance a ref points at (the rule of build_capital.resolve) */
export function resolveRef(c: CapOk, path: string): CProvJ | null {
  const a = path.split('.');
  if (a[0] === 'distributable') return c.distributable.prov;
  if (a[0] === 'buffer') return a[1] === 'v' ? c.buffer.v_prov : c.buffer.prov;
  if (a[0] === 'pnl') return (c.pnl as Record<string, CFig | undefined>)[a[1]]?.prov ?? null;
  if (a[0] === 'bases') return c.bases[a[1] as Basis]?.[a[2] as 'of' | 'scr' | 'ratio']?.prov ?? null;
  if (a[0] === 'bolt') { const b = c.options.find(isBolt); return b?.src[path.slice(5)] ?? null; }
  if (a[0] === 'con') { const k = c.constraints.find((x) => x.id === a[1]); return k ? (a[2] === 't' ? k.t_prov : k.headroom.prov) : null; }
  return null;
}
const noLts: LtsResolver = (j) => ({ k: 'none', title: j.title, why: 'רכיבי הדוח של החברה המנהלת נטענים בעמוד עצמו' });
export function cprov(c: CapOk, j: CProvJ, lts: LtsResolver = noLts, depth = 0): Prov {
  if (depth > 30) return { k: 'none', title: 'מקור', why: 'שרשרת מקורות ארוכה מדי' };
  if (j.k === 'ref') { const r = resolveRef(c, j.r); return r ? cprov(c, r, lts, depth + 1) : { k: 'none', title: j.r, why: 'המקור לא נמצא בקובץ' }; }
  if (j.k === 'lts') return lts(j);
  if (j.k === 'calc') return { k: 'calc', title: j.title, value: j.value, unit: j.unit, formula: j.formula, est: j.est, note: j.note,
    inputs: j.inputs.map((x) => ({ label: x.label, v: x.v, src: x.p ? () => cprov(c, x.p as CProvJ, lts, depth + 1) : undefined })) };
  return j as Prov;
}

/* ---------- formats ---------- */
export const MM = 'מיליוני ש"ח';
const pctT = (v: number | null, d = 1) => (v == null ? '–' : `${fmt(v, d)}%`);
export const BASIS_HE: Record<Basis, string> = { w: 'עם הוראות מעבר', wo: 'ללא הוראות מעבר' };
export const KIND_HE: Record<Con['kind'], string> = { board: 'יעד הדירקטוריון', div: 'סף לחלוקת דיבידנד', reg: 'דרישה רגולטורית' };
export const OPT_HE: Record<Opt['id'], string> = { div: 'דיבידנד / רכישה עצמית', org: 'הון לצמיחה אורגנית', bolt: 'רכישה משלימה (bolt-on)', hold: 'החזקה מול תרחיש לחץ' };
export const bindingOf = (c: CapOk) => c.constraints.find((x) => x.id === c.binding)!;

/* ---------- the option rows at a buffer (build_capital.options, the same formulas) ---------- */
export interface Rows { pp: number; buffer: number; dist: number; div: OptRow; org: OptRow; rank: ('div' | 'org' | 'bolt')[]; override: boolean }
type Calc = Extract<CProvJ, { k: 'calc' }>;
const recalc = (title: string, value: string, unit: string, formula: string, pp: number, base: CFig): Calc =>
  ({ k: 'calc', title, value, unit, formula, est: true, note: 'מחושב מחדש עם המרווח הניהולי שבחרת; שאר הקלטים כבחישוב ברירת המחדל',
    inputs: [{ label: 'מרווח ניהולי (הקלט שלך)', v: `${fmt(pp, 1)} נ״א` }, { label: 'בחישוב ברירת המחדל', v: base.v == null ? '–' : fmt(base.v, Math.abs(base.v) < 100 ? 2 : 1), p: base.prov }] });
export function optionsAt(c: CapOk, ppIn?: number | null): Rows {
  const pp = ppIn == null || !Number.isFinite(ppIn) ? c.buffer.pp : ppIn;
  const override = Math.abs(pp - c.buffer.pp) > 1e-9;
  const bind = bindingOf(c), Bb = c.bases[bind.basis]!;
  const P = c.pnl;
  const np = P.net_profit.v!, E = P.equity.v!, roe = P.roe.v!, ke = P.ke.v!, rf = P.rf.v!, tax = P.tax.v!;
  const Ee = P.equity_end?.v ?? null, pb = P.pb?.v ?? null;
  const scrB = Bb.scr.v!, ofB = Bb.of.v!, rB = Bb.ratio.v!;
  const buf = scrB * pp / 100;
  const D = bind.headroom.v! - buf, X = Math.max(D, 0);
  const keep = 1 - tax / 100, lost = X * rf / 100 * keep;
  const fileDiv = c.options.find((o) => o.id === 'div') as OptRow, fileOrg = c.options.find((o) => o.id === 'org') as OptRow;
  // dividend / buyback
  const cost = X / scrB * 100;
  const roe1 = E && E > X ? (np - lost) / (E - X) * 100 : null;
  const epsDiv = np ? -lost / np * 100 : null;
  const sh = pb && Ee ? X / (pb * Ee) : null;
  const epsBb = sh != null && sh < 1 && np ? ((1 - lost / np) / (1 - sh) - 1) * 100 : null;
  const pick = (v: number | null, f: CFig, title: string, value: string, unit: string): CFig => ({ v, prov: override ? recalc(title, value, unit, (f.prov as Calc).formula ?? '', pp, f) : f.prov });
  const div: OptRow = { id: 'div',
    cap: pick(X, fileDiv.cap, `הון בר-חלוקה · ${c.name}`, fmt(X, 0), MM), roic: fileDiv.roic,
    solv: pick(-cost, fileDiv.solv, `עלות כושר פירעון · דיבידנד / רכישה עצמית · ${c.name}`, `${fmtS(-cost, 1)} נ״א`, 'נקודות אחוז'), per_bn: -1000 / scrB * 100,
    roe: pick(roe1 == null ? null : roe1 - roe, fileDiv.roe, `השפעה על ROE · דיבידנד / רכישה עצמית · ${c.name}`, roe1 == null ? '–' : `${fmtS(roe1 - roe, 1)} נ״א`, 'נקודות אחוז'),
    eps: pick(epsDiv, fileDiv.eps, `השפעה על הרווח למניה · דיבידנד · ${c.name}`, `${fmtS(epsDiv, 1)}%`, '%'),
    eps_bb: fileDiv.eps_bb ? pick(epsBb, fileDiv.eps_bb, `השפעה על הרווח למניה · רכישה עצמית ב-P/B מוצדק · ${c.name}`, `${fmtS(epsBb, 1)}%`, '%') : undefined };
  // organic growth: capital written to the target supports SCR of capital ÷ target; own funds unchanged
  const T = bind.t / 100, Bf = pp / 100;
  const Xo = Math.max(Math.min(...c.constraints.map((x) => x.t / 100 * (c.bases[x.basis]!.of.v! / (x.t / 100 + Bf) - c.bases[x.basis]!.scr.v!))), 0);
  const costO = rB - ofB / (scrB + Xo / T) * 100, perO = rB - ofB / (scrB + 1000 / T) * 100;
  const extra = Xo * (roe / 100 - rf / 100 * keep);
  const org: OptRow = { id: 'org',
    cap: pick(Xo, fileOrg.cap, `קיבולת לצמיחה אורגנית · ${c.name}`, fmt(Xo, 0), MM), roic: fileOrg.roic,
    solv: pick(-costO, fileOrg.solv, `עלות כושר פירעון · צמיחה אורגנית · ${c.name}`, `${fmtS(-costO, 1)} נ״א`, 'נקודות אחוז'), per_bn: -perO,
    roe: pick(E ? extra / E * 100 : null, fileOrg.roe, `השפעה על ROE · צמיחה אורגנית · ${c.name}`, E ? `${fmtS(extra / E * 100, 1)} נ״א` : '–', 'נקודות אחוז'),
    eps: pick(np ? extra / np * 100 : null, fileOrg.eps, `השפעה על הרווח למניה · צמיחה אורגנית · ${c.name}`, np ? `${fmtS(extra / np * 100, 1)}%` : '–', '%') };
  const bolt = c.options.find(isBolt);   // the bolt-on is priced at the file's buffer (A9); ranked on the same ROIC − ke
  const rank = [...[div, org].filter((o) => (o.cap.v ?? 0) > 0).map((o) => [o.id, o.roic.v! - ke] as const),
    ...(bolt && bolt.roic.v != null && (bolt.cap.v ?? 0) > 0 ? [['bolt', bolt.roic.v - ke] as const] : [])]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([i]) => i);
  return { pp, buffer: buf, dist: D, div, org, rank, override };
}
/** the distributable capital at a buffer, with its provenance */
export function distAt(c: CapOk, r: Rows): CFig {
  return r.override ? { v: r.dist, prov: recalc(`הון בר-חלוקה · ${c.name}`, fmt(r.dist, 0), MM, 'הון עצמי − SCR × יעד − מרווח ניהולי (האילוץ המחייב)', r.pp, c.distributable) } : c.distributable;
}

/* ---------- the A2 overlay: how much of the surplus survives each preset ---------- */
export interface StressCon { id: string; basis: Basis; d: number | null; v: number | null }
export interface Stressed {
  id: string; he: string; preset: Preset;
  /** Δ solvency ratio, pp, per basis (null: not computed) */ dW: number | null; dWo: number | null;
  cons: StressCon[]; binding: string | null;
  /** stressed distributable = the lowest stressed constraint − the buffer */ v: number | null;
  /** v ÷ the base distributable × 100 */ survive: number | null; /** v ÷ SCR of the binding basis × 100 */ pctScr: number | null;
  gap: string[]; est: string[]; prov: () => Prov;
}
const SOLV_INPUTS = (p: Preset) => p.sc.y10 !== 0 || p.sc.eq !== 0;
export function stressOf(c: CapOk, f: DriverFile, presets: Preset[], nc: Map<string, NcRowJ>, ncAt: NcBase, lts: LtsResolver, pp: number, mode: 'clamp' | 'linear' = 'clamp'): Stressed[] {
  const ctx = makeCtx(c.id, c.name, f, nc, lts);
  const buf = c.bases[bindingOf(c).basis]!.scr.v! * pp / 100;
  const base = bindingOf(c).headroom.v! - buf;
  return presets.filter((p) => p.ok).map((p): Stressed => {
    const { shock } = shockFor(ctx, p.sc, ncAt, lts);
    const R = propagate(f, shock, { extrapolate: mode, lts });
    const gap: string[] = [], est: string[] = [];
    let dW: number | null = R.out.solv_w.d, dWo: number | null = R.out.solv_wo.d;
    if (SOLV_INPUTS(p) && !f.lines.solv) { dW = null; dWo = null; gap.push('רגישויות יחס כושר הפירעון לא חולצו לחברה: היחס אחרי התרחיש לא חושב'); }
    if (!SOLV_INPUTS(p)) gap.push('לתרחיש אין ערוץ ליחס כושר הפירעון (דמי ניהול, ניוד, מדד ואשראי אינם מגולגלים ליחס: אין גילוי); העודף מוצג כבבסיס');
    for (const fl of [...R.out.solv_w.flags, ...R.out.solv_wo.flags]) {
      if (/ישן|אומדן|הנחה|מחוץ לטווח|לא צוין/.test(fl)) est.push(fl);
      else if (/לא גולתה/.test(fl)) gap.push(fl);
    }
    for (const g of p.gaps) gap.push(g);
    const cons: StressCon[] = c.constraints.map((k) => {
      const d = k.basis === 'w' ? dW : dWo, scr = c.bases[k.basis]!.scr.v!;
      return { id: k.id, basis: k.basis, d, v: d == null ? null : k.headroom.v! + scr * d / 100 };
    });
    const ok = cons.every((x) => x.v != null);
    const low = ok ? cons.reduce((a, b) => (b.v! < a.v! ? b : a)) : null;
    const v = low ? low.v! - buf : null;
    const lowCon = low ? c.constraints.find((k) => k.id === low.id)! : null;
    const scrB = lowCon ? c.bases[lowCon.basis]!.scr.v! : null;
    const survive = v != null && base > 0 ? v / base * 100 : null;
    const pctScr = v != null && scrB ? v / scrB * 100 : null;
    const prov = (): Prov => {
      if (v == null || !lowCon || !low) return { k: 'none', title: `הון בר-חלוקה אחרי "${p.he}" · ${c.name}`, why: gap.join(' · ') || 'לא חושב' };
      return { k: 'calc', title: `הון בר-חלוקה אחרי "${p.he}" · ${c.name}`, value: fmt(v, 0), unit: MM, est: true,
        formula: 'min על האילוצים (עודף מעל היעד + SCR × Δ יחס ÷ 100, SCR קבוע) − מרווח ניהולי',
        note: [`התרחיש: ${scnText(p.sc)}`, ...est, ...gap].join(' · '),
        inputs: [
          { label: `עודף מעל ${lowCon.he}, בסיס`, v: fmt(lowCon.headroom.v, 0), src: () => cprov(c, lowCon.headroom.prov, lts) },
          { label: `Δ יחס כושר פירעון, ${BASIS_HE[lowCon.basis]} (drivers.ts)`, v: `${fmtS(low.d!, 1)} נ״א`, src: () => (lowCon.basis === 'w' ? R.out.solv_w.prov : R.out.solv_wo.prov) },
          { label: `SCR, ${BASIS_HE[lowCon.basis]}`, v: fmt(scrB, 0), src: () => cprov(c, c.bases[lowCon.basis]!.scr.prov, lts) },
          { label: 'פחות: מרווח ניהולי', v: fmt(buf, 0), src: () => cprov(c, c.buffer.v_prov, lts) },
          { label: 'התרחיש', v: p.he, src: () => p.prov },
        ] };
    };
    return { id: p.id, he: p.he, preset: p, dW, dWo, cons, binding: low?.id ?? null, v, survive, pctScr, gap: [...new Set(gap)], est: [...new Set(est)], prov };
  });
}
/** the worst preset that was computed (the lowest stressed distributable) */
export const worstOf = (xs: Stressed[]) => xs.filter((x) => x.v != null).reduce<Stressed | null>((a, b) => (a == null || b.v! < a.v! ? b : a), null);
export const pctText = pctT;
