/* The stress lab (/industry/csm?view=stress): the insurers' own disclosed sensitivities turned into scenarios, nothing modelled beyond them.
   Every effect is read off a piecewise-linear line through the disclosed points and the origin (no shock, no effect): between two disclosed
   points it is interpolated, beyond the widest disclosed point it is held at that point (clamped) and tagged "אקסטרפולציה". Effects of
   several shocks are added as printed, with no diversification credit, and tagged "ללא פיזור". At a disclosed shock size the lab returns
   the disclosed figure exactly (tests/stress.unit.ts checks every row of csm/sens.json and csm/solvency.json).
   Pure functions only: the page supplies the files; the unit test bundles this module into node. */
import type { SensRow } from './csmData';
import type { SolvSens } from './solvency';

export type SRisk = 'rate' | 'equity' | 'mortality' | 'morbidity' | 'lapse';
/** one scenario: rates in basis points (parallel shift of the risk-free curve), the others in % of the base (equity prices, rates of mortality, morbidity, lapse) */
export type Scenario = Record<SRisk, number>;
export const ZERO: Scenario = { rate: 0, equity: 0, mortality: 0, morbidity: 0, lapse: 0 };
export const SLIDERS: { k: SRisk; he: string; unit: 'נ״ב' | '%'; min: number; max: number; step: number; q: string }[] = [
  { k: 'rate', he: 'ריבית', unit: 'נ״ב', min: -300, max: 300, step: 5, q: 'r' },
  { k: 'equity', he: 'מחירי מניות', unit: '%', min: -50, max: 30, step: 1, q: 'eq' },
  { k: 'mortality', he: 'תמותה', unit: '%', min: -20, max: 20, step: 1, q: 'mo' },
  { k: 'morbidity', he: 'תחלואה', unit: '%', min: -20, max: 20, step: 1, q: 'mb' },
  { k: 'lapse', he: 'ביטולים', unit: '%', min: -30, max: 30, step: 1, q: 'la' },
];
export const RISK_OF = Object.fromEntries(SLIDERS.map((s) => [s.k, s])) as Record<SRisk, (typeof SLIDERS)[number]>;
const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ---------- the line through the disclosed points ---------- */
/** one disclosed point: the shock in slider units, the printed effect, and the row it was printed in */
export interface Pt<R> { x: number; v: number; row: R }
export interface Eval<R> {
  /** the effect read off the line */ v: number;
  /** the shock asked for, and the shock the effect was read at (the nearest disclosed edge when outside the range) */ x: number; xe: number;
  /** outside the disclosed range: held at the edge */ extra: boolean;
  /** the disclosed points around it (null = the origin) */ a: Pt<R> | null; b: Pt<R> | null;
}
/** the effect of a shock of size x on a line through (0,0) and the disclosed points; null when nothing was disclosed for the risk */
export function evalLine<R>(pts: Pt<R>[], x: number): Eval<R> | null {
  if (!pts.length) return null;
  const all: (Pt<R> | null)[] = [...pts].sort((p, q) => p.x - q.x);
  const at = (p: Pt<R> | null) => (p ? p.x : 0), val = (p: Pt<R> | null) => (p ? p.v : 0);
  // the origin sits between the negative and the positive points
  const i0 = all.findIndex((p) => p!.x > 0);
  all.splice(i0 < 0 ? all.length : i0, 0, null);
  if (x === 0) return { v: 0, x, xe: 0, extra: false, a: null, b: null };
  const lo = at(all[0]), hi = at(all[all.length - 1]);
  const xe = clampTo(x, lo, hi), extra = xe !== x;
  const hit = all.find((p) => at(p) === xe);
  if (hit !== undefined) return { v: val(hit), x, xe, extra, a: hit, b: hit };
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i], b = all[i + 1];
    if (at(a) < xe && xe < at(b)) return { v: val(a) + ((val(b) - val(a)) * (xe - at(a))) / (at(b) - at(a)), x, xe, extra, a, b };
  }
  return null;
}

/* ---------- IFRS 17 sensitivities (csm/sens.json) ---------- */
export type IfrsEff = 'csm' | 'equity';
/** the shock of a printed row in slider units: rates are printed in percentage points (0.5) and move in basis points (50) */
export const xOfSens = (r: Pick<SensRow, 'risk' | 'dir' | 'size'>): number | null => (r.dir == null || r.size == null ? null : r.dir * r.size * (r.risk === 'rate' ? 100 : 1));
const SLIDER_RISKS = new Set<string>(SLIDERS.map((s) => s.k));
/** the disclosed points of one insurer, effect line and basis: one point per risk and direction; rows with no stated direction are left out */
export function ifrsLines(rows: SensRow[], c: string, eff: SensRow['eff'], b: string): Map<SRisk, Pt<SensRow>[]> {
  const out = new Map<SRisk, Pt<SensRow>[]>();
  for (const r of rows) {
    if (r.c !== c || r.eff !== eff || r.b !== b || !SLIDER_RISKS.has(r.risk)) continue;
    const x = xOfSens(r);
    if (x == null) continue;
    const l = out.get(r.risk as SRisk) ?? [];
    if (!l.some((p) => p.x === x)) l.push({ x, v: r.v, row: r });
    out.set(r.risk as SRisk, l);
  }
  return out;
}
/** which printed lines stand for an effect, risk by risk: CSM on the basis asked for (else the basis printed); equity as printed, else profit
    and equity printed as one row, else profit alone (then tagged: the filer printed no equity effect for that risk and profit stands in) */
export function pickIfrs(rows: SensRow[], c: string, eff: IfrsEff, basis: 'net' | 'gross'): { lines: Map<SRisk, Pt<SensRow>[]>; eff: SensRow['eff']; b: string; proxy: SRisk[] } | null {
  const mine = rows.filter((r) => r.c === c);
  const effs: SensRow['eff'][] = eff === 'csm' ? ['csm'] : ['equity', 'pe', 'profit'];
  const bases = [basis, 'na', basis === 'net' ? 'gross' : 'net'];
  const lines = new Map<SRisk, Pt<SensRow>[]>(), used: [SensRow['eff'], string][] = [], proxy: SRisk[] = [];
  for (const s of SLIDERS) {
    found: for (const e of effs) for (const b of bases) {
      const l = ifrsLines(mine.filter((r) => r.risk === s.k), c, e, b).get(s.k);
      if (!l?.length) continue;
      lines.set(s.k, l); used.push([e, b]); if (e === 'profit') proxy.push(s.k);
      break found;
    }
  }
  if (!lines.size) return null;
  const most = <T,>(xs: T[]) => xs.sort((x, y) => xs.filter((z) => z === y).length - xs.filter((z) => z === x).length)[0];
  return { lines, eff: most(used.map((u) => u[0])), b: most(used.map((u) => u[1])), proxy };
}

/* ---------- solvency-ratio sensitivities (csm/solvency.json) ---------- */
/** the shock a solvency-report row describes, read from its printed wording: "ירידה בריבית של 50 נקודות בסיס", "עלייה של 10% בשיעורי הביטולים" */
export function xOfSolv(s: Pick<SolvSens, 'l' | 'risk'>): number | null {
  if (!SLIDER_RISKS.has(s.risk)) return null;
  const t = s.l.replace(/\s+/g, ' ');
  const dir = /ירידה|הפחתה|decrease|down/i.test(t) ? -1 : /עלייה|עליה|תוספת|increase|up/i.test(t) ? 1 : 0;
  if (!dir) return null;
  const bp = t.match(/(\d+(?:\.\d+)?)\s*(?:נקודות בסיס|נ"ב|bp)/i), pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (s.risk === 'rate') return bp ? dir * Number(bp[1]) : null;
  return pct ? dir * Number(pct[1]) : null;
}
/** the disclosed solvency points of one insurer at one date, one line per risk (identical repeated rows count once) */
export function solvLines(sens: SolvSens[], c: string, d: string): Map<SRisk, Pt<SolvSens>[]> {
  const out = new Map<SRisk, Pt<SolvSens>[]>();
  for (const s of sens) {
    if (s.c !== c || s.d !== d) continue;
    const x = xOfSolv(s);
    if (x == null) continue;
    const l = out.get(s.risk as SRisk) ?? [];
    if (!l.some((p) => p.x === x)) l.push({ x, v: s.v, row: s });
    out.set(s.risk as SRisk, l);
  }
  return out;
}
/** the newest date an insurer disclosed solvency sensitivities for */
export const solvDate = (sens: SolvSens[], c: string) => sens.filter((s) => s.c === c && xOfSolv(s) != null).map((s) => s.d).sort().pop() ?? null;

/* ---------- a scenario on one set of lines ---------- */
export interface Part<R> { k: SRisk; e: Eval<R> }
export interface Effect<R> {
  /** sum of the effects of the shocks in force */ v: number; parts: Part<R>[];
  /** a shock outside the disclosed range (held at the edge) */ extra: boolean;
  /** more than one shock added with no diversification */ combo: boolean;
  /** shocks in force with no disclosed line (left out of the sum) */ none: SRisk[];
}
export function applyLines<R>(lines: Map<SRisk, Pt<R>[]>, sc: Scenario): Effect<R> {
  const parts: Part<R>[] = [], none: SRisk[] = [];
  for (const s of SLIDERS) {
    const x = sc[s.k];
    if (!x) continue;
    const e = evalLine(lines.get(s.k) ?? [], x);
    if (e) parts.push({ k: s.k, e }); else none.push(s.k);
  }
  return { v: parts.reduce((t, p) => t + p.e.v, 0), parts, extra: parts.some((p) => p.e.extra), combo: parts.length > 1, none };
}
export const activeRisks = (sc: Scenario) => SLIDERS.filter((s) => sc[s.k] !== 0).map((s) => s.k);

/* ---------- board targets and dividend thresholds, by basis ---------- */
export type SBasis = 'w' | 'wo';
export interface TargetFact { m: string; d: string; v: number; l?: string; pg?: number | null; rp?: string; u?: string | null; s?: string; n?: string }
// the wording rules of components/DividendCapacity.tsx: metric first, then the printed label, the entity column and the extractor's note
const WO = /without[ _](the )?(application of )?(the )?(transitional|tmtp)|ללא (התחשבות ב|יישום |)הוראות/i;
const WI = /\bwith[ _](the )?(application of )?(the )?(transitional|tmtp)|taking (the |into account the )?transitional|בתקופת הפריסה|ביישום הוראות|בהתחשב בהוראות|תוך התחשבות בהוראות/i;
/** the basis a printed target names: with or without the transitional measures; null when the wording does not say */
export function basisOf(f: Pick<TargetFact, 'm' | 'l' | 's' | 'n'>): SBasis | null {
  if (/without_(transitional|tmtp)/.test(f.m)) return 'wo';
  if (/with_(transitional|tmtp)/.test(f.m)) return 'w';
  for (const t of [f.l ?? '', f.s ?? '', f.n ?? '']) { if (WO.test(t)) return 'wo'; if (WI.test(t)) return 'w'; }
  return null;
}
const TARGET = /^target_solvency_ratio(_board|_minimum|_min_stability|_min_stability_with_transitional|_min_with_transitional|_min_without_transitional|_with_transitional_minimum|_min(imum)?_with(out)?_transitional)?$/;
const THRESH = /^target_(solvency_ratio_dividend_threshold|dividend_threshold|solvency_dividend_threshold)/;
export const isDividendThreshold = (f: Pick<TargetFact, 'm'>) => THRESH.test(f.m);
/** the board target and the dividend threshold in force at a date on one basis: the latest printed for a date up to six months after it
    (thresholds are often set when the annual report is approved); glide-path values for later years are left out */
export function targetsAt(facts: TargetFact[], d: string, basis: SBasis): { board: TargetFact | null; div: TargetFact | null } {
  const lim = new Date(d); lim.setMonth(lim.getMonth() + 6);
  const until = lim.toISOString().slice(0, 10);
  const ok = facts.filter((f) => (TARGET.test(f.m) || THRESH.test(f.m)) && f.v >= 90 && f.v <= 250 && f.d <= until && basisOf(f) === basis);
  const latest = (xs: TargetFact[]) => [...xs].sort((a, b) => a.d.localeCompare(b.d) || (a.rp ?? '').localeCompare(b.rp ?? '')).pop() ?? null;
  return { board: latest(ok.filter((f) => TARGET.test(f.m))), div: latest(ok.filter((f) => THRESH.test(f.m))) };
}

/* ---------- historical presets from fox's own macro files ---------- */
export interface CurveFile { source: string; url: string; retrieved: string; months: string[]; nominal: Record<string, (number | null)[]>; real: Record<string, (number | null)[]>; codes: Record<string, Record<string, string>> }
export interface CatFile { [cat: string]: { p: number[]; y: number[]; n: number[] } }
export const EQ_CAT = 'גמל | מניות';
export interface PresetDef { id: string; he: string; rate: [string, string]; eq: [string, string] }
/** the rate move = change of the monthly-average 10-year real zero yield between two months (BoI ZCM); the equity move = compounded monthly
    return of the equity tracks of provident funds (גמל-נט, asset-weighted category return) over the months of the episode */
export const PRESETS: PresetDef[] = [
  { id: '2022', he: 'העלאות הריבית 2022', rate: ['2021-12', '2022-12'], eq: ['2022-01', '2022-12'] },
  { id: '2020', he: 'מרץ 2020', rate: ['2020-01', '2020-03'], eq: ['2020-02', '2020-03'] },
  { id: '2023', he: 'אוקטובר 2023', rate: ['2023-09', '2023-10'], eq: ['2023-10', '2023-10'] },
];
export interface Preset extends PresetDef {
  sc: Scenario;
  r: { from: number; to: number; code: string; url: string; retrieved: string } | null;
  e: { months: [number, number][]; n: number[]; cat: string } | null;
}
export function buildPreset(p: PresetDef, curve: CurveFile | null, cat: CatFile | null): Preset {
  let r: Preset['r'] = null, e: Preset['e'] = null;
  if (curve) {
    const s = curve.real['10'], i0 = curve.months.indexOf(p.rate[0]), i1 = curve.months.indexOf(p.rate[1]);
    if (s && i0 >= 0 && i1 >= 0 && s[i0] != null && s[i1] != null) r = { from: s[i0]!, to: s[i1]!, code: curve.codes.real?.['10'] ?? 'ZC_TSB_ZRD_10Y_MA', url: curve.url, retrieved: curve.retrieved };
  }
  const c = cat?.[EQ_CAT];
  if (c) {
    const a = Number(p.eq[0].replace('-', '')), b = Number(p.eq[1].replace('-', ''));
    const idx = c.p.map((m, i) => [m, i] as const).filter(([m]) => m >= a && m <= b);
    if (idx.length && idx.length === monthsBetween(a, b)) e = { months: idx.map(([m, i]) => [m, c.y[i]] as [number, number]), n: idx.map(([, i]) => c.n[i]), cat: EQ_CAT };
  }
  const rate = r ? Math.round((r.to - r.from) * 100) : 0;
  const equity = e ? Math.round((e.months.reduce((t, [, y]) => t * (1 + y / 100), 1) - 1) * 1000) / 10 : 0;
  return { ...p, sc: { ...ZERO, rate, equity }, r, e };
}
function monthsBetween(a: number, b: number) { return (Math.floor(b / 100) - Math.floor(a / 100)) * 12 + (b % 100) - (a % 100) + 1; }

/* ---------- the scenario in the URL ---------- */
export function readScenario(sp: URLSearchParams): Scenario {
  const sc = { ...ZERO };
  for (const s of SLIDERS) { const v = Number(sp.get(s.q)); if (Number.isFinite(v) && v) sc[s.k] = clampTo(v, s.min, s.max); }
  return sc;
}
export function writeScenario(prev: URLSearchParams, sc: Scenario): URLSearchParams {
  const n = new URLSearchParams(prev);
  for (const s of SLIDERS) { if (sc[s.k]) n.set(s.q, String(sc[s.k])); else n.delete(s.q); }
  return n;
}
/** the shock as text, the sign isolated left-to-right: "ריבית +50 נ״ב" */
export const shockText = (k: SRisk, x: number) => `${RISK_OF[k].he} ⁦${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}${RISK_OF[k].unit === '%' ? '%' : ' נ״ב'}⁩`;
