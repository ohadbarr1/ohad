/* A2 · the Scenario Studio (/scenarios): one macro scenario through every company's driver graph (lib/drivers.ts propagate), the
   companies ranked by how much of their cushion it consumes, and template sentences over the numbers. Pure functions only, no React:
   the page and tests/scenarios.unit.ts call exactly this.

   The scenario (Scn) is eight inputs: BoI policy rate and 10Y yield (bp), equities (%), credit spreads (bp), CPI (pp), net transfers
   (% change of each company's own LTM run rate, over a 4- or 8-quarter horizon), fee compression (bp, pension and provident funds
   apart) and cost inflation (%), plus the "current quarter" overlay (M1's regulator-implied AUM and fee yield per product).
   Per company it becomes a drivers.ts Shock: flows and fees go per product through Shock.by.

   The vulnerability ranking (no score beyond what is shown): two cushions, each a visible share
     capital   the headroom over the board solvency target, pp (ratio − target, same basis): the share the scenario consumes
     earnings  LTM net profit to shareholders: the share the scenario takes
   a company ranks by the larger of the two; below its target (at base or after the scenario) ranks first, by the stressed headroom. */
import {
  NO_SHOCK, OUT_KEYS, fmt, fmtS, propagate, toProv,
  type DriverFile, type Edge, type LtsResolver, type OutKey, type Output, type Product, type Propagated, type Quality, type Shock,
} from './drivers';
import type { Prov } from './prov';

/* ---------- the scenario ---------- */
export interface Scn {
  policy: number; y10: number; eq: number; credit: number; cpi: number;
  /** net transfers, % change of the company's LTM run rate (−100 = frozen) */ flow: number; /** horizon of the flow change, quarters */ h: 4 | 8;
  /** fee compression, bp: pension */ fp: number; /** provident and study funds */ fg: number; cost: number;
  /** the current-quarter overlay: M1's regulator-implied AUM and fee yield per product */ nc: 0 | 1;
}
export const ZERO: Scn = { policy: 0, y10: 0, eq: 0, credit: 0, cpi: 0, flow: 0, h: 4, fp: 0, fg: 0, cost: 0, nc: 0 };
export type SKey = 'policy' | 'y10' | 'eq' | 'credit' | 'cpi' | 'flow' | 'fp' | 'fg' | 'cost';
export interface SliderDef { k: SKey; he: string; short: string; unit: string; min: number; max: number; step: number; q: string; group?: 'fee' }
export const SLIDERS: SliderDef[] = [
  { k: 'policy', he: 'ריבית בנק ישראל', short: 'ריבית בנ״י', unit: 'נ״ב', min: -300, max: 300, step: 5, q: 'p' },
  { k: 'y10', he: 'תשואת 10 שנים', short: '10 שנים', unit: 'נ״ב', min: -300, max: 300, step: 5, q: 'y' },
  { k: 'eq', he: 'מניות', short: 'מניות', unit: '%', min: -60, max: 30, step: 1, q: 'e' },
  { k: 'credit', he: 'מרווחי אשראי', short: 'אשראי', unit: 'נ״ב', min: -100, max: 400, step: 5, q: 'cr' },
  { k: 'cpi', he: 'מדד המחירים', short: 'מדד', unit: 'נ״א', min: -3, max: 8, step: 0.5, q: 'i' },
  { k: 'flow', he: 'ניוד נטו', short: 'ניוד', unit: '% מקצב LTM', min: -200, max: 200, step: 10, q: 'f' },
  { k: 'fp', he: 'דמי ניהול · פנסיה', short: 'ד״נ פנסיה', unit: 'נ״ב', min: 0, max: 20, step: 0.5, q: 'fp', group: 'fee' },
  { k: 'fg', he: 'דמי ניהול · גמל והשתלמות', short: 'ד״נ גמל', unit: 'נ״ב', min: 0, max: 20, step: 0.5, q: 'fg', group: 'fee' },
  { k: 'cost', he: 'אינפלציית הוצאות', short: 'הוצאות', unit: '%', min: -10, max: 20, step: 1, q: 'c' },
];
export const SL_OF = Object.fromEntries(SLIDERS.map((s) => [s.k, s])) as Record<SKey, SliderDef>;
/** inputs the driver graph has no calibrated channel for: shown as gaps, never as zero effects */
export const GAP_INPUT: Partial<Record<SKey, string>> = {
  credit: 'אף חברה לא גילתה רגישות למרווחי אשראי (CSM, רווח או כושר פירעון); לא מוזרם',
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const active = (s: Scn): SKey[] => SLIDERS.filter((d) => s[d.k] !== 0).map((d) => d.k);
const dec = (k: SKey, x: number) => (Math.abs(x) % 1 ? 1 : 0) || (SL_OF[k].step < 1 && x % 1 ? 1 : 0);
/** "מניות −25%" with the sign kept in front inside right-to-left text */
export const inputText = (k: SKey, x: number) => `${SL_OF[k].he} ⁦${fmtS(x, dec(k, x))}${SL_OF[k].unit === '%' ? '%' : ` ${SL_OF[k].unit}`}⁩`;
export const scnText = (s: Scn) => [...active(s).map((k) => inputText(k, s[k]) + (k === 'flow' ? ` · ${s.h} רבעונים` : '')), ...(s.nc ? ['נכסים ודמי ניהול ברבעון הנוכחי (M1)'] : [])].join(' · ') || 'ללא זעזוע';

/* ---------- the scenario in the URL ---------- */
export function readScn(sp: URLSearchParams): Scn {
  const s: Scn = { ...ZERO };
  for (const d of SLIDERS) { const v = Number(sp.get(d.q)); if (sp.has(d.q) && Number.isFinite(v)) s[d.k] = clamp(Math.round(v * 100) / 100, d.min, d.max); }   // a preset may sit between slider steps (1.4%)
  s.h = sp.get('h') === '8' ? 8 : 4;
  s.nc = sp.get('nc') === '1' ? 1 : 0;
  return s;
}
export function writeScn(prev: URLSearchParams, s: Scn): URLSearchParams {
  const n = new URLSearchParams(prev);
  for (const d of SLIDERS) { if (s[d.k]) n.set(d.q, String(+s[d.k].toFixed(2))); else n.delete(d.q); }
  if (s.h === 8) n.set('h', '8'); else n.delete('h');
  if (s.nc) n.set('nc', '1'); else n.delete('nc');
  return n;
}
export const sameScn = (a: Scn, b: Scn) => SLIDERS.every((d) => Math.abs(a[d.k] - b[d.k]) < 1e-9) && a.nc === b.nc && (a.flow === 0 || a.h === b.h);

/* ---------- presets ---------- */
export interface Inp { label: string; v: string; src?: () => Prov }
export interface Preset { id: string; he: string; sc: Scn; prov: Prov; gaps: string[]; ok: boolean }
const calcP = (title: string, value: string, formula: string, inputs: Inp[], note?: string, est?: boolean): Prov => ({ k: 'calc', title, value, formula, inputs, note, est });
const fixed = (id: string, he: string, sc: Partial<Scn>, why: string, gaps: string[] = []): Preset => {
  const s = { ...ZERO, ...sc };
  return { id, he, sc: s, ok: true, gaps, prov: calcP(`תרחיש · ${he}`, scnText(s), why, active(s).map((k) => ({ label: SL_OF[k].he, v: `⁦${fmtS(s[k], dec(k, s[k]))}⁩ ${SL_OF[k].unit}` }))) };
};

/** the files the computed presets read: BoI zero curve (from 2008), the provident funds' equity-track returns (גמל-נט), macro.json */
export interface CurveFile { source: string; url: string; retrieved: string; months: string[]; nominal: Record<string, (number | null)[]>; real: Record<string, (number | null)[]>; codes?: Record<string, Record<string, string>> }
export interface CatFile { [cat: string]: { p: number[]; y: number[]; n: number[] } }
interface Meta { label: string; unit: string; source: string; url: string; retrieved: string; code: string }
export interface MacroFile { series: { rate: Meta & { months: [string, number][] }; nom10?: Meta & { months: [string, number][] }; cpi?: Meta & { points: { m: string; idx?: number; yoy?: number | null }[] } } }
export const EQ_CAT = 'גמל | מניות';
const ym = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
const ymN = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
/** compounded monthly return of the equity tracks over [a, b] (yyyymm), with each month as an input; null if a month is missing */
function eqRun(cat: CatFile | null, a: number, b: number): { v: number; inputs: Inp[] } | null {
  const c = cat?.[EQ_CAT]; if (!c) return null;
  const rows = c.p.map((m, i) => [m, c.y[i], c.n[i]] as const).filter(([m]) => m >= a && m <= b);
  const want = (Math.floor(b / 100) - Math.floor(a / 100)) * 12 + (b % 100) - (a % 100) + 1;
  if (!rows.length || rows.length !== want) return null;
  const v = (rows.reduce((t, [, y]) => t * (1 + y / 100), 1) - 1) * 100;
  return { v, inputs: rows.map(([m, y, n]) => ({ label: `${ymN(m)} · ${n} מסלולים`, v: `${fmtS(y, 2)}%` })) };
}
const curveAt = (cv: CurveFile, basis: 'nominal' | 'real', t: string, m: string) => { const i = cv.months.indexOf(m); return i < 0 ? null : cv[basis][t]?.[i] ?? null; };

/** 2008 replay from the site's own files: calendar 2008. Equities = the provident funds' equity tracks, 01–12/08 compounded; the 10Y yield =
    the BoI nominal 10Y zero, monthly mean, 01/08 ← 12/08 (the curve's first month is 01/08); the policy rate = the BoI nominal 1Y zero over the
    same months (the policy-rate series in the site starts 2019: a proxy, labelled); CPI and credit spreads: not in the site's files for 2008 */
export function preset2008(cv: CurveFile | null, cat: CatFile | null): Preset {
  const gaps = ['מדד המחירים: סדרת המדד באתר מתחילה ב-2019; לא נכלל', 'מרווחי אשראי: אין סדרה באתר; לא נכלל'];
  const e = eqRun(cat, 200801, 200812);
  const n0 = cv && curveAt(cv, 'nominal', '10', '2008-01'), n1 = cv && curveAt(cv, 'nominal', '10', '2008-12');
  const s0 = cv && curveAt(cv, 'nominal', '1', '2008-01'), s1 = cv && curveAt(cv, 'nominal', '1', '2008-12');
  const ok = !!e && n0 != null && n1 != null && s0 != null && s1 != null;
  const sc: Scn = { ...ZERO, eq: e ? Math.round(e.v) : 0, y10: n0 != null && n1 != null ? Math.round((n1 - n0) * 20) * 5 : 0, policy: s0 != null && s1 != null ? Math.round((s1 - s0) * 20) * 5 : 0 };
  const curveNote = cv ? `${cv.source} · ${cv.url} · נמשך ${cv.retrieved}` : 'עקום האפס לא נטען';
  const prov = calcP('תרחיש · 2008 חוזר', scnText(sc), 'שנת 2008 מנתוני האתר: מניות = תשואה מצטברת של מסלולי המניות בגמל; 10 שנים ו-1 שנה = שינוי התשואה הנומינלית לאפס (ממוצע חודשי), 01/08 ← 12/08; מעוגל ל-5 נ״ב ולאחוז שלם', [
    { label: 'מניות, 01–12/08 (גמל-נט, מסלולי מניות)', v: e ? `${fmtS(e.v, 1)}%` : '–', src: e ? () => calcP('מניות · 2008', `${fmtS(e.v, 1)}%`, 'Π(1 + תשואה חודשית) − 1, ממוצע משוקלל בנכסים של מסלולי המניות בקופות הגמל', e.inputs, `גמל-נט (רשות שוק ההון, data.gov.il), קטגוריה "${EQ_CAT}"; מקרוב למחירי המניות, לא מדד`) : undefined },
    { label: 'תשואה נומינלית 10 שנים, 01/08 ← 12/08', v: n0 != null && n1 != null ? `${fmt(n0, 2)}% ← ${fmt(n1, 2)}% (${fmtS((n1 - n0) * 100, 0)} נ״ב)` : '–', src: () => calcP('10 שנים · 2008', n0 != null && n1 != null ? `${fmtS((n1 - n0) * 100, 0)} נ״ב` : '–', '(12/08 − 01/08) × 100', [{ label: '01/08', v: `${fmt(n0, 4)}%` }, { label: '12/08', v: `${fmt(n1, 4)}%` }], `${cv?.codes?.nominal?.['10'] ?? 'ZC_TSB_ZND_10Y_MA'} · ${curveNote}`) },
    { label: 'ריבית בנק ישראל: מקורבת בתשואה הנומינלית לשנה', v: s0 != null && s1 != null ? `${fmt(s0, 2)}% ← ${fmt(s1, 2)}% (${fmtS((s1 - s0) * 100, 0)} נ״ב)` : '–', src: () => calcP('ריבית קצרה · 2008', s0 != null && s1 != null ? `${fmtS((s1 - s0) * 100, 0)} נ״ב` : '–', '(12/08 − 01/08) × 100', [{ label: '01/08', v: `${fmt(s0, 4)}%` }, { label: '12/08', v: `${fmt(s1, 4)}%` }], `קירוב: סדרת ריבית בנק ישראל באתר מתחילה ב-2019 · ${cv?.codes?.nominal?.['1'] ?? 'ZC_TSB_ZND_01Y_MA'} · ${curveNote}`, true) },
    ...gaps.map((g) => ({ label: g.split(':')[0], v: 'חסר' })),
  ], gaps.join(' · '));
  return { id: '2008', he: '2008 חוזר', sc, prov, gaps, ok };
}

/** M1's live quarter: the newest stage-1/2 row per company (more_gemel reads more's: the same management company) */
export interface NcSegJ { avg: number; yld: number; months: { ym: number; a: number; est?: 1 }[]; base: { q: string; avg: number; fy: number }[] }
export interface NcRowJ { c: string; q: string; stage: number; asof: string; scope: string; segs: Partial<Record<'pen' | 'gem', NcSegJ>> }
export interface NowcastFile { meta: { method: string; live: { q: string; stage: number | null }; built_from: { regulator_asof: number } }; ledger: { quarter: string; stage: number; created_at: string; rows: NcRowJ[] }[]; cover: string[] }
export function ncRows(nc: NowcastFile | null): Map<string, NcRowJ> {
  const out = new Map<string, NcRowJ>();
  if (!nc) return out;
  const q = nc.meta.live.q;
  const L = nc.ledger.filter((l) => l.quarter === q).sort((a, b) => a.stage - b.stage || a.created_at.localeCompare(b.created_at));
  for (const l of L) for (const r of l.rows) out.set(r.c, r);
  if (out.has('more') && !out.has('more_gemel')) out.set('more_gemel', out.get('more')!);
  return out;
}
/** the current quarter, regulator-implied: the market moves since the base quarter's end (BoI rate, 10Y nominal zero, the provident funds'
    equity tracks, CPI YoY) plus M1's per-product AUM and fee yield for the quarter (the overlay, `nc`) */
export function presetNow(macro: MacroFile | null, cat: CatFile | null, nc: NowcastFile | null, baseEnd: string): Preset & { asof: string } {
  const bm = baseEnd.slice(0, 7), S = macro?.series;
  const at = (xs: [string, number][] | undefined, m: string) => xs?.find(([k]) => k === m)?.[1] ?? null;
  const rl = S?.rate.months.at(-1), r0 = at(S?.rate.months, bm);
  const nl = S?.nom10?.months.at(-1), n0 = at(S?.nom10?.months, bm);
  const cl = S?.cpi?.points.at(-1), c0 = S?.cpi?.points.find((p) => p.m === bm);
  const [by, bmo] = bm.split('-').map(Number);
  const eqEnd = cat?.[EQ_CAT]?.p.at(-1) ?? 0, eqA = bmo === 12 ? (by + 1) * 100 + 1 : by * 100 + bmo + 1;
  const e = eqEnd >= eqA ? eqRun(cat, eqA, eqEnd) : null;
  const sc: Scn = { ...ZERO, nc: nc ? 1 : 0,
    policy: rl && r0 != null ? Math.round((rl[1] - r0) * 100 / 5) * 5 : 0,
    y10: nl && n0 != null ? Math.round((nl[1] - n0) * 100 / 5) * 5 : 0,
    eq: e ? Math.round(e.v * 10) / 10 : 0,
    cpi: cl?.yoy != null && c0?.yoy != null ? Math.round((cl.yoy - c0.yoy) * 2) / 2 : 0 };
  const src = (m: Meta | undefined, extra = '') => (m ? `${m.source} · ${m.code} · ${m.url} · נמשך ${m.retrieved}${extra}` : '');
  const L = nc?.meta.live.q ?? '';
  const inputs: Inp[] = [
    { label: `ריבית בנק ישראל, ${ym(bm)} ← ${rl ? ym(rl[0]) : '–'}`, v: rl && r0 != null ? `${fmt(r0, 2)}% ← ${fmt(rl[1], 2)}%` : '–', src: () => calcP('ריבית בנק ישראל · מאז הבסיס', `${fmtS(sc.policy, 0)} נ״ב`, '(אחרון − סוף רבעון הבסיס) × 100', [], src(S?.rate)) },
    { label: `תשואה נומינלית 10 שנים, ${ym(bm)} ← ${nl ? ym(nl[0]) : '–'}`, v: nl && n0 != null ? `${fmt(n0, 2)}% ← ${fmt(nl[1], 2)}%` : '–', src: () => calcP('10 שנים · מאז הבסיס', `${fmtS(sc.y10, 0)} נ״ב`, '(ממוצע חודשי אחרון − ממוצע חודש הבסיס) × 100, מעוגל ל-5 נ״ב', [], src(S?.nom10)) },
    { label: `מניות, ${ymN(eqA)}–${ymN(eqEnd)} (גמל-נט, מסלולי מניות)`, v: e ? `${fmtS(e.v, 1)}%` : 'חסר', src: e ? () => calcP('מניות · מאז הבסיס', `${fmtS(e.v, 1)}%`, 'Π(1 + תשואה חודשית) − 1', e.inputs, `גמל-נט, קטגוריה "${EQ_CAT}": החודשים שהרשות פרסמה מאז סוף רבעון הבסיס`) : undefined },
    { label: `מדד, שינוי בקצב השנתי ${ym(bm)} ← ${cl ? ym(cl.m) : '–'}`, v: cl?.yoy != null && c0?.yoy != null ? `${fmt(c0.yoy, 1)}% ← ${fmt(cl.yoy, 1)}%` : '–', src: () => calcP('מדד · מאז הבסיס', `${fmtS(sc.cpi, 1)} נ״א`, 'אינפלציה שנתית (YoY) אחרונה − אינפלציה שנתית בחודש הבסיס: תוספת לקצב, מעוגל לחצי נקודה', [], src(S?.cpi)) },
    { label: `נכסים ודמי ניהול לכל מוצר, ${L.replace(/Q(\d)-20(\d\d)/, "Q$1'$2")} (M1, שלב ${nc?.meta.live.stage ?? '–'})`, v: nc ? `${nc.cover.length} חברות` : 'חסר' },
  ];
  const prov = calcP('תרחיש · הרבעון הנוכחי, לפי נתוני הרגולטור', scnText(sc), 'תזוזות השוק מאז סוף רבעון הבסיס, ולכל חברה שמכוסה ב-M1: הנכסים הממוצעים ברבעון ותשואת דמי הניהול שנגזרה מהם במקום ערוץ הנכסים', inputs, 'אומדן: הרבעון טרם דווח; נתוני הרשות עד החודש האחרון שפורסם', true);
  return { id: 'now', he: 'הרבעון הנוכחי', sc, prov, gaps: ['מרווחי אשראי: אין סדרה; לא נכלל'], ok: !!macro && !!e, asof: eqEnd ? ymN(eqEnd) : '' };
}

export function presets(cv: CurveFile | null, cat: CatFile | null, macro: MacroFile | null, nc: NowcastFile | null, baseEnd: string): Preset[] {
  return [
    fixed('rate', 'ירידת ריבית', { policy: -150, y10: -120 }, 'ריבית בנק ישראל −150 נ״ב, תשואת 10 שנים −120 נ״ב (הגדרת התרחיש)'),
    fixed('eqdd', 'מפולת מניות', { eq: -25, credit: 150 }, 'מניות −25%, מרווחי אשראי +150 נ״ב (הגדרת התרחיש)', ['מרווחי אשראי: אין גילוי; לא מוזרם']),
    preset2008(cv, cat),
    fixed('fee', 'תקרת דמי ניהול', { fp: 5, fg: 10 }, 'שחיקת דמי ניהול על הצבירה: פנסיה −5 נ״ב, גמל והשתלמות −10 נ״ב (הגדרת התרחיש); פוליסות חיסכון לא נכללות'),
    fixed('freeze', 'הקפאת ניוד', { flow: -100, h: 8 }, 'ניוד נטו לאפס במשך 8 רבעונים: לכל חברה ולכל מוצר, הניוד נטו LTM × 2 שנים יוצא מהנכסים; הכנסות ורווח בקצב שנתי בסוף האופק'),
    fixed('stag', 'סטגפלציה', { cpi: 4, policy: 200, y10: 200, eq: -10 }, 'מדד +4 נ״א, ריבית +200 נ״ב (בנק ישראל ו-10 שנים), מניות −10% (הגדרת התרחיש)'),
    presetNow(macro, cat, nc, baseEnd),
  ];
}

/* ---------- per company ---------- */
const usable = (e: Edge | undefined): e is Edge & { v: number } => !!e && e.quality !== 'missing' && e.v != null;
const per = (e: Edge & { v: number }) => e.v / (e.x || 1);
const pEdge = (p: Product, e: string) => p.edges.find((x) => x.e === e);
export type TBasis = 'w' | 'wo' | 'na';
export interface Target { v: number; basis: TBasis; ratio: 'solv_w' | 'solv_wo'; label: string; period: string; prov: () => Prov; est?: string }
export interface Ctx { id: string; name: string; f: DriverFile; ins: boolean; target: Target | null; nc: NcRowJ | null }
const TARGET = /^target_solvency_ratio(_board|_minimum|_min_stability|_min(imum)?_(with|without)_transitional|_with_transitional_minimum)?$/;
/** "Q2'25" / "FY'25" ← the quarter's last day */
const endOfPeriod = (p: string) => { const m = /^(Q[1-4]|FY)'(\d\d)$/.exec(p); if (!m) return null; const q = m[1] === 'FY' ? 4 : Number(m[1][1]); return `20${m[2]}-${['03-31', '06-30', '09-30', '12-31'][q - 1]}`; };
/** the board target the headroom is measured to: A1's node on the basis it chose (with the transitional measures first), else the latest
    target the company printed for a date up to six months after the ratio (Ayalon, Menora: the wording names no basis, so it is read against
    the ratio with the transitional measures and labelled) */
export function targetOf(f: DriverFile, lts: LtsResolver): Target | null {
  const N = f.nodes;
  const node = (k: string, r: 'solv_w' | 'solv_wo', b: TBasis, label: string): Target | null => {
    const n = N[k];
    return n?.v != null && N[r]?.v != null ? { v: n.v, basis: b, ratio: r, label, period: n.period, prov: () => toProv(n.prov, lts) } : null;
  };
  const t = node('target_board_w', 'solv_w', 'w', 'יעד הדירקטוריון, עם הוראות מעבר') ?? node('target_board_wo', 'solv_wo', 'wo', 'יעד הדירקטוריון, ללא הוראות מעבר');
  if (t || f.meta.kind !== 'insurance_group' || N.solv_w?.v == null) return t;
  const end = N.solv_w.d ?? endOfPeriod(N.solv_w.period);
  if (!end) return null;
  const lim = new Date(end); lim.setMonth(lim.getMonth() + 6);
  const until = lim.toISOString().slice(0, 10);
  const c = f.targets.filter((x) => TARGET.test(x.m) && x.v >= 90 && x.v <= 250 && x.d <= until).sort((a, b) => a.d.localeCompare(b.d) || (a.rp ?? '').localeCompare(b.rp ?? '')).pop();
  if (!c) return null;
  const per = c.rp ? c.rp.replace(/^(\d{4})Q(\d)$/, (_, y, q) => `Q${q}'${y.slice(2)}`).replace(/^(\d{4})FY$/, (_, y) => `FY'${y.slice(2)}`) : c.d;
  return { v: c.v, basis: 'na', ratio: 'solv_w', label: 'יעד יחס כושר הפירעון שפורסם', period: per, est: 'בסיס היעד לא צוין בנוסח: נמדד מול היחס עם הוראות מעבר',
    prov: () => ({ k: 'report', title: `יעד יחס כושר פירעון · ${f.meta.name}`, value: `${fmt(c.v, c.v % 1 ? 1 : 0)}%`, unit: '%', url: c.u ?? null, pg: c.pg ?? null, doc: 'דוח כספי', period: per, note: c.l }) };
}
export function makeCtx(id: string, name: string, f: DriverFile, nc: Map<string, NcRowJ>, lts: LtsResolver): Ctx {
  return { id, name, f, ins: f.meta.kind === 'insurance_group', target: targetOf(f, lts), nc: nc.get(id) ?? null };
}

/** the per-product inputs behind a company's shock (flows, fees, the M1 overlay), for the sources */
export interface ProdIn { s: Product['s']; he: string; fee: number; flow: number; inputs: Inp[]; gap?: string }
/** the macro values the M1 overlay was set against: AUM follows the regulator's figures at these, and moves by the β beyond them */
export interface NcBase { eq: number; y10: number }
export function shockFor(c: Ctx, s: Scn, ncAt: NcBase, lts: LtsResolver): { shock: Shock; prods: ProdIn[] } {
  const by: NonNullable<Shock['by']> = {}, prods: ProdIn[] = [];
  for (const p of c.f.products) {
    const A = p.avg.v; if (A == null) continue;
    const inputs: Inp[] = [];
    let fee = p.s === 'pen' ? s.fp : p.s === 'gem' ? s.fg : 0, flow = 0, gap: string | undefined;
    if (fee) inputs.push({ label: 'שחיקת דמי ניהול (התרחיש)', v: `${fmt(fee, 1)} נ״ב` });
    if (s.flow) {
      const tr = p.tr_ltm;
      if (tr?.v != null) {
        flow = s.flow / 100 * tr.v / A * 100 * (s.h / 4);
        inputs.push({ label: 'ניוד נטו LTM', v: fmt(tr.v, 0), src: () => toProv(tr.prov, lts) }, { label: 'נכסים ממוצעים', v: fmt(A, 0), src: () => toProv(p.avg.prov, lts) },
          { label: `× ${fmtS(s.flow, 0)}% × ${s.h / 4} שנים ÷ נכסים`, v: `${fmtS(flow, 2)}% מהנכסים` });
      } else gap = p.s === 'ic' ? 'אין נתוני ניוד לפוליסות חיסכון' : 'אין ניוד נטו LTM';
    }
    const seg = s.nc && c.nc && (p.s === 'pen' || p.s === 'gem') ? c.nc.segs[p.s] : undefined;
    if (seg && p.fy?.v != null) {
      const bEq = pEdge(p, 'eq.aum'), bY = pEdge(p, 'y10.aum');
      const tot = (seg.avg / A - 1) * 100, mkt = (usable(bEq) ? per(bEq) * ncAt.eq : 0) + (usable(bY) ? per(bY) * ncAt.y10 : 0);
      const dFee = (p.fy.v - seg.yld) * 100;
      flow += tot - mkt; fee += dFee;
      inputs.push({ label: `נכסים ממוצעים ${c.nc!.q.replace(/Q(\d)-20(\d\d)/, "Q$1'$2")} (M1, רשות שוק ההון)`, v: fmt(seg.avg, 0), src: () => calcP(`נכסים ממוצעים ברבעון · ${c.name} · ${p.he}`, fmt(seg.avg, 0), 'ממוצע סופי החודשים של הרשות ברבעון (M1; חודש מסומן "אומדן" = נאמד)', seg.months.map((m) => ({ label: `${ymN(m.ym)}${m.est ? ' · אומדן' : ''}`, v: fmt(m.a, 0) })), `M1 nowcast · ${c.nc!.asof}`, true) },
        { label: 'שינוי בנכסים מול הבסיס, פחות ערוץ השוק (β × התרחיש)', v: `${fmtS(tot, 2)}% − ${fmtS(mkt, 2)}%` },
        { label: 'תשואת דמי ניהול: בסיס LTM ← הרבעון (M1)', v: `${fmt(p.fy.v, 4)}% ← ${fmt(seg.yld, 4)}% (${fmtS(-dFee, 2)} נ״ב)`, src: () => toProv(p.fy!.prov, lts) });
    }
    by[p.s] = { fee, flow };
    prods.push({ s: p.s, he: p.he, fee, flow, inputs, gap });
  }
  const shock: Shock = { ...NO_SHOCK, policy: s.policy, y10: s.y10, eq: s.eq, credit: s.credit, cpi: s.cpi, cost: s.cost, by };
  return { shock, prods };
}

/* ---------- one company under the scenario ---------- */
export interface Cell {
  key: OutKey; o: Output; base: number | null; v: number | null; d: number | null;
  /** not applicable to the company (a fund house's solvency) */ na: boolean;
  /** an input in force with no channel to this figure: the reasons (never shown as a zero effect) */ gap: string[];
  /** assumptions and extrapolations in the figure */ est: string[];
  /** the weakest calibrated link the figure used */ q: Quality | null;
}
export interface Res {
  id: string; name: string; kind: string; P: Propagated; cells: Record<OutKey, Cell>; prods: ProdIn[];
  head: { t: Target; base: number; d: number | null; v: number | null; rp: string; prov: () => Prov } | null;
  capUse: number | null; earnUse: number | null; vul: number | null; driver: 'cap' | 'earn' | null;
  breach: boolean; below0: boolean; tier: 0 | 1 | 2; capProv: () => Prov; earnProv: () => Prov;
  /** inputs in force that reach none of the company's figures (credit spreads; the policy rate since A1-fix reaches the nostro's cash and bank credit): one mark per company, not per cell */
  rowGap: string[];
}
const Q_RANK: Record<Quality, number> = { high: 3, medium: 2, low: 1, missing: 0 };
const worst = (qs: Quality[]): Quality | null => (qs.length ? qs.reduce((a, b) => (Q_RANK[b] < Q_RANK[a] ? b : a)) : null);
/** the edges a figure reads, given the inputs in force */
function edgesFor(c: Ctx, key: OutKey, s: Scn, sh: Shock, t: Target | null): Edge[] {
  const anyAum = sh.eq !== 0 || sh.y10 !== 0 || Object.values(sh.by ?? {}).some((b) => b?.flow);
  const on = (e: Edge) => (e.from === 'aum' ? anyAum : e.from === 'fee' ? true : e.from in sh ? (sh as unknown as Record<string, number>)[e.from] !== 0 : false);
  const prod = (keys: string[]) => c.f.products.filter((p) => p.s !== 'ic' || key === 'net_profit' || key === 'roe' || key === 'pb').flatMap((p) => p.edges.filter((e) => keys.includes(e.e) && (e.e !== 'fee.op' || sh.by?.[p.s]?.fee)));
  const grp = (pred: (e: Edge) => boolean) => c.f.edges.filter(pred);
  const disc = (to: string) => grp((e) => e.to === to && e.method !== 'identity');
  let es: Edge[] = [];
  if (key === 'revenue') es = prod(['eq.aum', 'y10.aum', 'fee.op']);
  else if (key === 'op_profit') es = prod(['eq.aum', 'y10.aum', 'fee.op', 'aum.opex', 'cpi.opex']);
  else if (key === 'net_profit' || key === 'roe' || key === 'pb') es = [...prod(['eq.aum', 'y10.aum', 'fee.op', 'aum.opex', 'cpi.opex']), ...grp((e) => ['cpi.fin', 'y10.fin', 'policy.fin', 'policy.y1', 'y1.inv'].includes(e.e)), ...disc('net_profit'), ...(s.y10 || s.eq ? grp((e) => e.e === 'csm.isr') : [])];
  else if (key === 'csm') es = disc('csm');
  else if (key === 'solv_w') es = disc('solv_w');
  else if (key === 'solv_wo') es = [...disc('solv_wo'), ...disc('solv_w')];
  else es = disc(t?.ratio ?? 'solv_w');
  return es.filter((e) => on(e) && !(e.e === 'cpi.opex' && !(sh.cpi || sh.cost)) && !(e.e === 'cpi.fin' && !sh.cpi));
}
const SOLV: OutKey[] = ['solv_w', 'solv_wo', 'dist_capital', 'div_capacity'];
const INS_ONLY: OutKey[] = [...SOLV, 'csm'];
export function runOne(c: Ctx, s: Scn, ncAt: NcBase, mode: 'clamp' | 'linear', lts: LtsResolver): Res {
  const { shock, prods } = shockFor(c, s, ncAt, lts);
  const P = propagate(c.f, shock, { extrapolate: mode, lts });
  const L = c.f.lines, act = active(s);
  const solvShock = !!(s.y10 || s.eq), noSolvLines = c.ins && !L.solv;
  const cells = {} as Record<OutKey, Cell>;
  // a variable cost per ₪bn above the fee earned on it makes growth in assets cut profit: the calibration is shown as suspect, not hidden
  const odd = c.f.products.flatMap((p) => {
    const vc = pEdge(p, 'aum.opex'), part = P.parts.find((x) => x.id === `aum.${p.s}`);
    return usable(vc) && p.fy?.v != null && part && per(vc) > p.fy.v * 10
      ? [`כיול חשוד, ${p.he}: הוצאה משתנה ${fmt(per(vc), 2)} מיליון לכל מיליארד נכסים, מעל דמי הניהול (${fmt(p.fy.v * 10, 2)}); תוספת נכסים מקטינה כאן את הרווח`] : [];
  });
  for (const key of OUT_KEYS) {
    const o = P.out[key];
    const na = (INS_ONLY.includes(key) && !c.ins) || (o.base == null && o.v == null && (INS_ONLY.includes(key) || key === 'revenue' || key === 'op_profit') && !c.f.products.length);
    const gap: string[] = [], est: string[] = [];
    const edges = edgesFor(c, key, s, shock, c.target);
    // a savings policy's costs are never printed apart (A1 leaves them unallocated by design): not a gap of the scenario
    for (const e of edges) if (e.quality === 'missing' && e.from !== 'credit' && !(e.e === 'aum.opex' && e.seg === 'ic')) gap.push(`${e.he}: ${e.why ?? 'חסר'}`);
    let v = o.v, d = o.d;
    if (SOLV.includes(key) && c.ins && solvShock && noSolvLines) { v = null; d = null; gap.push('רגישויות יחס כושר הפירעון לא חולצו לחברה: היחס אחרי התרחיש לא חושב'); }
    if (key === 'csm' && c.ins && solvShock && !L.csm) { v = null; d = null; gap.push('לא חולצו גילויי IFRS 17'); }
    for (const fl of o.flags) {
      if (/אומדן|הנחה/.test(fl)) est.push(fl);
      else if (/מחוץ לטווח/.test(fl)) est.push(mode === 'clamp' ? 'זעזוע מחוץ לטווח שגולה: ההשפעה נחתכה בנקודה הקיצונית' : 'הארכה לינארית מעבר לגילוי (אומדן)');
      else if (/ישן/.test(fl)) est.push(fl);
      else if (/לא גולתה|לא חולצו|אין /.test(fl) && act.length) gap.push(fl);
    }
    if ((key === 'csm' || key === 'net_profit' || key === 'roe' || key === 'pb') && P.parts.some((p) => p.extra && (p.to === 'csm' || p.to === 'net_profit')))
      est.push(mode === 'clamp' ? 'זעזוע מחוץ לטווח שגולה: ההשפעה נחתכה בנקודה הקיצונית' : 'הארכה לינארית מעבר לגילוי (אומדן)');
    if (key === 'net_profit' || key === 'roe' || key === 'pb') for (const fl of P.flags) if (/לא גולתה רגישות|לא נכלל/.test(fl) && /רווח/.test(fl)) gap.push(fl);
    if ((key === 'op_profit' || key === 'net_profit' || key === 'roe' || key === 'pb') && odd.length) est.push(...odd);
    if ((key === 'revenue' || key === 'op_profit') && s.nc && c.nc) est.push('נכסים ודמי ניהול ברבעון הנוכחי: אומדן M1 מנתוני הרשות');
    if (s.nc && !c.nc && (key === 'revenue' || key === 'op_profit') && c.f.products.some((p) => p.s !== 'ic')) gap.push('M1 לא מכסה את החברה: הרבעון הנוכחי לא הוחל על הנכסים');
    if (s.flow) for (const p of prods) if (p.gap && (key === 'revenue' || key === 'op_profit' || key === 'net_profit')) gap.push(`${p.he}: ${p.gap}`);
    cells[key] = { key, o, base: o.base, v, d, na, gap: na ? [] : [...new Set(gap)], est: [...new Set(est)], q: worst(edges.filter((e) => e.quality !== 'missing').map((e) => e.quality)) };
  }
  // headroom over the board target (pp), the key fragility figure
  const t = c.target;
  let head: Res['head'] = null;
  if (t) {
    const R = cells[t.ratio], rb = R.base;
    if (rb != null) {
      const base = rb - t.v, d = R.d, v = d == null ? null : base + d;
      head = { t, base, d, v, rp: c.f.nodes[t.ratio]?.period ?? '', prov: () => ({ k: 'calc', title: `מרווח מעל יעד הדירקטוריון · ${c.name} · ${scnText(s)}`, value: v == null ? '–' : `${fmtS(v, 1)} נ״א`, unit: 'נקודות אחוז', est: !!(R.est.length || t.est) || undefined,
        formula: `יחס כושר הפירעון (${t.ratio === 'solv_w' ? 'עם' : 'ללא'} הוראות מעבר) אחרי התרחיש − היעד, אותו בסיס`,
        inputs: [{ label: `יחס ${t.ratio === 'solv_w' ? 'עם' : 'ללא'} הוראות מעבר, בסיס`, v: `${fmt(rb, 1)}%`, src: () => R.o.prov }, { label: 'Δ בתרחיש', v: d == null ? 'לא חושב' : `${fmtS(d, 1)} נ״א`, src: () => R.o.prov },
          { label: `${t.label} · ${t.period}`, v: `${fmt(t.v, t.v % 1 ? 1 : 0)}%`, src: t.prov }],
        note: [t.est, ...R.est, ...R.gap].filter(Boolean).join(' · ') || undefined }) };
    }
  }
  const npC = cells.net_profit, npB = npC.base;
  const capUse = head && head.base > 0 && head.d != null ? (-head.d / head.base) * 100 : null;
  const earnUse = npB != null && npB > 0 && npC.d != null ? (-npC.d / npB) * 100 : null;
  const below0 = !!head && head.base < 0, breach = !!head && !below0 && head.v != null && head.v < 0;
  const cand: [number, 'cap' | 'earn'][] = [];
  if (capUse != null) cand.push([capUse, 'cap']); if (earnUse != null) cand.push([earnUse, 'earn']);
  const top = cand.sort((a, b) => b[0] - a[0])[0];
  const vul = top ? top[0] : null, driver = top ? top[1] : null;
  const tier: Res['tier'] = below0 || breach ? 0 : vul != null ? 1 : 2;
  const capProv = (): Prov => (head && capUse != null
    ? calcP(`שחיקת המרווח ליעד · ${c.name}`, `${fmt(capUse, 0)}%`, '−Δ יחס בתרחיש ÷ המרווח מעל היעד בבסיס × 100', [{ label: 'Δ יחס', v: `${fmtS(head.d!, 1)} נ״א`, src: () => cells[head.t.ratio].o.prov }, { label: 'מרווח בבסיס', v: `${fmt(head.base, 1)} נ״א`, src: head.prov }], [head.t.est, ...cells[head.t.ratio].est].filter(Boolean).join(' · ') || undefined, !!cells[head.t.ratio].est.length)
    : { k: 'none', title: `שחיקת המרווח ליעד · ${c.name}`, why: !c.ins ? 'לא מבטחת' : !head ? 'לא נמצא יעד דירקטוריון ליחס' : head.base <= 0 ? 'מתחת ליעד כבר בבסיס' : 'היחס אחרי התרחיש לא חושב (אין רגישויות)' });
  const earnProv = (): Prov => (earnUse != null
    ? calcP(`שחיקת הרווח · ${c.name}`, `${fmt(earnUse, 1)}%`, '−Δ רווח נקי בתרחיש ÷ רווח נקי LTM × 100', [{ label: 'Δ רווח נקי', v: fmtS(npC.d!, 0), src: () => npC.o.prov }, { label: 'רווח נקי LTM', v: fmt(npB!, 0), src: () => npC.o.prov }], npC.gap.length ? `חסר בערוצים: ${npC.gap.join(' · ')}` : undefined, true)
    : { k: 'none', title: `שחיקת הרווח · ${c.name}`, why: npB == null ? 'אין רווח נקי LTM לחברה' : 'רווח LTM שלילי' });
  const rowGap = (['credit'] as const).filter((k) => s[k]).map((k) => `${SL_OF[k].he}: ${GAP_INPUT[k]}`);
  return { id: c.id, name: c.name, kind: c.f.meta.kind, P, cells, prods, head, capUse, earnUse, vul, driver, breach, below0, tier, capProv, earnProv, rowGap };
}

/* ---------- the ranking and its sentences ---------- */
export type RankKey = 'vul' | 'head' | 'roe' | 'np';
export const RANK_HE: Record<RankKey, string> = { vul: 'שחיקת הכרית', head: 'מרווח ליעד', roe: 'Δ ROE', np: 'Δ רווח נקי' };
const npPct = (r: Res) => (r.cells.net_profit.base && r.cells.net_profit.d != null && r.cells.net_profit.base > 0 ? (r.cells.net_profit.d / r.cells.net_profit.base) * 100 : null);
export function rank(rs: Res[], k: RankKey): Res[] {
  const val = (r: Res): number | null => (k === 'head' ? r.head?.v ?? null : k === 'roe' ? r.cells.roe.d : k === 'np' ? npPct(r) : null);
  const by = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b);
  return [...rs].sort((a, b) => {
    if (k === 'vul') return a.tier - b.tier || (a.tier === 0 ? by(a.head?.v ?? null, b.head?.v ?? null) : by(a.vul == null ? null : -a.vul, b.vul == null ? null : -b.vul)) || a.name.localeCompare(b.name, 'he');
    return by(val(a), val(b)) || a.name.localeCompare(b.name, 'he');
  });
}
const basisHe = (b: TBasis) => (b === 'w' ? 'עם הוראות מעבר' : b === 'wo' ? 'ללא הוראות מעבר' : 'בסיס לא צוין');
const pp = (v: number, d = 1) => `${fmt(Math.abs(v), d)} נ״א`;
/** one sentence per company, from the numbers only */
export function sentence(r: Res): string {
  const h = r.head, roe = r.cells.roe, parts: string[] = [];
  if (h && r.below0) {
    const ratio = h.base + h.t.v;
    return `${r.name} מתחת ליעד הדירקטוריון כבר בבסיס: ${fmt(ratio, 1)}% ב-${h.rp} מול יעד ${fmt(h.t.v, 0)}% (${basisHe(h.t.basis)}, ${h.t.period})${h.d ? `; בתרחיש עוד ${fmtS(h.d, 1)} נ״א` : ''}`;
  }
  if (h && r.breach) parts.push(`חוצה את יעד הדירקטוריון: ${fmt(h.v! + h.t.v, 1)}% מול ${fmt(h.t.v, 0)}% (${basisHe(h.t.basis)})`);
  else if (h && r.capUse != null && Math.abs(r.capUse) >= 1) parts.push(`${r.capUse > 0 ? 'שוחקת' : 'מגדילה'} ${fmt(Math.abs(r.capUse), 0)}% מהמרווח ליעד (${fmt(h.base, 1)} ← ${fmt(h.v!, 1)} נ״א)`);
  if (roe.d != null && Math.abs(roe.d) >= 0.05) parts.push(`${roe.d < 0 ? 'מאבדת' : 'מוסיפה'} ${pp(roe.d)} תשואה להון (${fmt(roe.base!, 1)}% ← ${fmt(roe.v!, 1)}%)`);
  else if (r.cells.op_profit.d != null && Math.abs(r.cells.op_profit.d) >= 0.5 && r.cells.roe.base == null) parts.push(`רווח תפעולי בפנסיה ובגמל ${fmtS(r.cells.op_profit.d, 0)} מיליוני ש״ח בשנה`);
  if (!parts.length) {
    const moved = OUT_KEYS.some((k) => r.cells[k].d != null && Math.abs(r.cells[k].d!) > 1e-9);
    const g = OUT_KEYS.some((k) => r.cells[k].gap.length && !r.cells[k].na);
    if (moved) return `${r.name}: השפעה זניחה${roe.d != null ? ` (ROE ${fmtS(roe.d, 2)} נ״א)` : ''}`;
    return `${r.name}: ${g ? 'אין ערוץ מכויל לזעזועים שנבחרו' : 'ללא השפעה'}`;
  }
  return `${r.name} ${parts.join(' ו')}`;
}
/** the headline: the first companies of the ranking in one line */
export function headline(ranked: Res[], label: string, n = 3): string {
  // companies already below their target lead only when the scenario moves them; otherwise they close the line
  const moves = (r: Res) => (r.head?.d ?? 0) !== 0 || Math.abs(r.earnUse ?? 0) >= 0.5;
  const hit = ranked.filter((r) => (r.tier === 0 && (r.breach || moves(r))) || (r.tier === 1 && r.vul != null && r.vul >= 0.5)).slice(0, n);
  const still = ranked.filter((r) => r.below0 && !hit.includes(r)).map((r) => `${r.name} מתחת ליעד כבר בבסיס`);
  if (!hit.length) return `${label}: אף חברה לא מאבדת חצי אחוז מהכרית${still.length ? `; ${still.join(', ')}` : ''}`;
  const frag = (r: Res) => {
    const h = r.head;
    if (h && r.below0) return `${r.name} מתחת ליעד הדירקטוריון כבר בבסיס`;
    if (h && r.breach) return `${r.name} חוצה את יעד הדירקטוריון`;
    if (r.driver === 'cap' && r.capUse != null && h?.v != null) return `${r.name} שוחקת ${fmt(r.capUse, 0)}% מהמרווח ליעד`;
    const roe = r.cells.roe;
    if (roe.d != null && roe.d < 0) return `${r.name} מאבדת ${pp(roe.d)} ROE`;
    return `${r.name} מאבדת ${fmt(r.earnUse ?? 0, 0)}% מהרווח`;
  };
  return `${label}: ${hit.map(frag).join(', ')}${still.length ? `; ${still.join(', ')}` : ''}`;
}

/* ---------- the whole set ---------- */
export function runAll(ctx: Ctx[], s: Scn, ncAt: NcBase, mode: 'clamp' | 'linear', lts: LtsResolver): Res[] {
  return ctx.map((c) => runOne(c, s, ncAt, mode, lts));
}

/* ---------- the graph's known gaps, from the files ---------- */
const qOf = (d: string) => `Q${Math.ceil(Number(d.slice(5, 7)) / 3)}'${d.slice(2, 4)}`;
export function graphGaps(ctx: Ctx[]): string[] {
  const ins = ctx.filter((c) => c.ins && c.f.nodes.solv_w?.v != null), out: string[] = [];
  const all = (e: string) => ctx.every((c) => c.f.edges.filter((x) => x.e === e).every((x) => x.quality === 'missing'));
  if (all('credit.csm') && all('credit.solv_w')) out.push('מרווחי אשראי: אין גילוי רגישות לאף חברה');
  if (all('policy.fin')) out.push('ריבית בנק ישראל: אין ערוץ מכויל (הרכב הריבית של החוב לא מודפס)');
  if (ins.every((c) => c.f.edges.filter((x) => x.e === 'lapse.csm').every((x) => x.quality === 'missing'))) out.push('ביטולים ← CSM: לא גולה');
  const noSolv = ins.filter((c) => !c.f.lines.solv).map((c) => c.name);
  if (noSolv.length) out.push(`רגישויות יחס כושר הפירעון לא חולצו: ${noSolv.join(', ')}`);
  const old = ins.filter((c) => c.f.lines.solv && c.f.edges.some((e) => e.to === 'solv_w' && e.method === 'disclosure' && e.quality === 'low')).map((c) => `${c.name} (${qOf(c.f.lines.solv!.d)})`);
  if (old.length) out.push(`רגישויות יחס ישנות, איכות נמוכה: ${old.join(', ')}`);
  const wo = ins.filter((c) => c.f.edges.some((e) => e.to === 'solv_wo' && e.method === 'assumption')).map((c) => c.name);
  if (wo.length) out.push(`ללא הוראות מעבר: הנחת תזוזה יחסית, איכות נמוכה (${wo.join(', ')})`);
  const na = ins.filter((c) => c.target?.basis === 'na').map((c) => c.name);
  if (na.length) out.push(`בסיס היעד לא צוין: ${na.join(', ')}`);
  return out;
}
