/* P6-2e (spec p6 §5.2, §14.1 G2/G4, §14.4 T-C6–T-C8; tester round 3 "same basis"): the pure rules behind the company page's depth lenses.
   Node-tested in scripts/p6-lenses-test.mjs. No React, no fetching: the lens files feed it the shipped data (targets.json, csm/solvency.json). */

/** "561.0 → 692.0 מיליוני ש"ח" → "561 → 692 מיליוני ש"ח": a million never carries ".0" on this page (tester T4, N9); 23.4% and 0.05 stay. */
export const noDotZero = (s: string): string => s.replace(/(\d)\.0(?![\d%])/g, '$1');

/* ---------- targets: the same-basis rule ---------- */

export type Basis = 'w' | 'wo' | '?';
export const BASIS_HE: Record<Basis, string> = { w: 'עם הוראות מעבר', wo: 'ללא הוראות מעבר', '?': 'בסיס לא צוין' };
const WO = /without_(the_)?(transitional|tmtp)|_wo$|ללא (התחשבות ב|יישום )?הוראות/i;
const WI = /with_(the_)?(transitional|tmtp)|_w$|(עם|ביישום|בהתחשב ב)(ה)?הוראות/i;

/** The transitional basis a solvency target or threshold is stated on: from its metric name, else its printed label; '?' when neither says. */
export function targetBasis(t: { m: string; l: string }): Basis {
  if (WO.test(t.m)) return 'wo';
  if (WI.test(t.m)) return 'w';
  if (WO.test(t.l)) return 'wo';
  if (WI.test(t.l)) return 'w';
  return '?';
}
/** The basis of one input of an actual ("יחס כושר פירעון, עם הוראות מעבר"); a bare label takes the basis its formula states. */
export function inputBasis(label: string, formula = ''): Basis {
  if (/ללא הוראות/.test(label)) return 'wo';
  if (/עם הוראות/.test(label)) return 'w';
  if (/ללא הוראות מעבר/.test(formula) && !/עם ובלי/.test(formula)) return 'wo';
  if (/עם הוראות מעבר/.test(formula) && !/עם ובלי/.test(formula)) return 'w';
  return '?';
}

/** targets.json's `act.in` row: [label, value, url, page, period, solvency report id] */
export type ActIn = [string, number, string | null, number | null, string, number | null];
export interface ActLike { k: string; v: number; y: number; f: string; in: ActIn[] }
export type SameBasis =
  /** not a solvency comparison: the actual as the data carries it */
  | { kind: 'asis' }
  /** the ratio on the threshold's own basis, with the input it comes from */
  | { kind: 'same'; basis: Basis; v: number; input: ActIn }
  /** the target names no basis: the data's own pick (the lower), said so */
  | { kind: 'unstated'; v: number; input: ActIn | null }
  /** the data has no ratio on the threshold's basis: nothing is compared */
  | { kind: 'missing'; basis: Basis; why: string };

/** A solvency target is compared only with the ratio printed on the SAME basis (with / without the transitional measures). */
export function sameBasisActual(t: { m: string; l: string }, act: ActLike | null | undefined): SameBasis | null {
  if (!act) return null;
  if (act.k !== 'sr') return { kind: 'asis' };
  const b = targetBasis(t);
  const ins = act.in.map((x) => ({ x, b: inputBasis(x[0], act.in.length === 1 ? act.f : '') }));
  if (b === '?') {
    const lo = ins.reduce<ActIn | null>((m, { x }) => (m == null || x[1] < m[1] ? x : m), null);
    return { kind: 'unstated', v: lo ? lo[1] : act.v, input: lo };
  }
  const hit = ins.find((x) => x.b === b);
  if (hit) return { kind: 'same', basis: b, v: hit.x[1], input: hit.x };
  const per = act.in[0]?.[4] ?? `FY'${String(act.y).slice(2)}`;
  return { kind: 'missing', basis: b, why: `אין בנתונים יחס ${BASIS_HE[b]} ל-${per}; היעד אינו מושווה ליחס על בסיס אחר` };
}

/** Where the actual sits against the target: above, inside the range, below. A threshold or a minimum reads "מעל הסף" / "מתחת לסף". */
export function vsTarget(a: number, t: { m: string; l: string; v: number | null; lo: number | null; hi: number | null }): string {
  const lo = t.lo ?? t.v, hi = t.hi ?? t.v;
  const floor = /threshold|minimum|_min/.test(t.m) || /^סף/.test(t.l);
  if (hi != null && a > hi) return floor ? 'מעל הסף' : 'מעל היעד';
  if (lo != null && a < lo) return floor ? 'מתחת לסף' : 'מתחת ליעד';
  if (lo != null && hi != null && lo !== hi) return 'בטווח היעד';
  return floor ? 'בגובה הסף' : 'בגובה היעד';
}

/* ---------- targets: the table and the policy block ---------- */

export interface TgRow { c: string; m: string; l: string; e: string; t: string; h: number | null; d: string; src: string; st: string; st1: [string, number | null, number | null] | null; act?: unknown }
const TOPIC_ORDER: Record<string, number> = { strategy: 0, capital: 1, payout: 2 };
const said = (t: TgRow) => t.st1?.[0] ?? t.d;

/** The open horizons a company has stated (years from `fromYear` on), nearest first. */
export function openYears(rows: TgRow[], fromYear: number): number[] {
  return [...new Set(rows.filter((t) => t.h != null && t.h >= fromYear && t.st !== 'met' && t.st !== 'missed').map((t) => t.h as number))].sort((a, b) => a - b);
}
/** One row per target (kind, entity) for one horizon: the latest statement wins; on a tie, the deck (it is the newer, rounder form). */
export function horizonRows<T extends TgRow>(rows: T[], year: number): T[] {
  const m = new Map<string, T>();
  rows.filter((t) => t.h === year).forEach((t) => {
    const k = `${t.m}|${t.e}`, c = m.get(k);
    if (!c || said(t) > said(c) || (said(t) === said(c) && t.src === 'pres' && c.src !== 'pres')) m.set(k, t);
  });
  // the topics in order (strategy, capital, payout); inside one, a target the site can set an actual against comes first
  return [...m.values()].sort((a, b) => (TOPIC_ORDER[a.t] ?? 9) - (TOPIC_ORDER[b.t] ?? 9) || Number(!a.act) - Number(!b.act));
}
/** "מדיניות וספים": the standing statements (no horizon), one group per kind and entity, newest first; the first is the one shown. */
export function policyGroups<T extends TgRow>(rows: T[]): T[][] {
  const g = new Map<string, T[]>();
  rows.filter((t) => t.h == null).forEach((t) => { const k = `${t.m}|${t.e}`; g.set(k, [...(g.get(k) ?? []), t]); });
  return [...g.values()]
    .map((xs) => [...xs].sort((a, b) => b.d.localeCompare(a.d) || said(b).localeCompare(said(a)) || (a.src === 'pres' ? -1 : 1)))
    .sort((a, b) => (TOPIC_ORDER[a[0].t] ?? 9) - (TOPIC_ORDER[b[0].t] ?? 9) || a[0].l.localeCompare(b[0].l, 'he'));
}

/** A money target as it reads: millions under 100,000, billions above (520,000 → "520", מיליארדי ש"ח). */
export function moneyScale(vals: (number | null)[]): { div: number; unit: string } {
  const big = Math.max(0, ...vals.map((v) => Math.abs(v ?? 0))) >= 100000;
  return big ? { div: 1000, unit: 'מיליארדי ש"ח' } : { div: 1, unit: 'מיליוני ש"ח' };
}

/* ---------- solvency by report ---------- */

export interface SolvPt { d: string; wo: number | null; w: number | null }
/** The economic-solvency reports, newest first, with the change from the previous report on each basis (points; null when either side is missing). */
export function solvencyByReport(byDate: Record<string, Record<string, { v: number } | undefined>>, max = 8): (SolvPt & { dwo: number | null; dw: number | null; prev: string | null })[] {
  const ds = Object.keys(byDate).filter((d) => byDate[d].sr_wo || byDate[d].sr_w).sort();
  const pts = ds.map((d) => ({ d, wo: byDate[d].sr_wo?.v ?? null, w: byDate[d].sr_w?.v ?? null }));
  return pts.map((p, i) => {
    const q = i > 0 ? pts[i - 1] : null;
    return { ...p, prev: q?.d ?? null, dwo: q && p.wo != null && q.wo != null ? p.wo - q.wo : null, dw: q && p.w != null && q.w != null ? p.w - q.w : null };
  }).reverse().slice(0, max);
}
/** A solvency report date as its period: 30.06 → H1'26, 31.12 → FY'25 (any other month: Q-label). */
export const halfLabel = (d: string) => (d.slice(5, 7) === '06' ? `H1'${d.slice(2, 4)}` : d.slice(5, 7) === '12' ? `FY'${d.slice(2, 4)}` : `${({ '03': 'Q1', '09': 'Q3' } as Record<string, string>)[d.slice(5, 7)] ?? d.slice(5, 7)}'${d.slice(2, 4)}`);

/** The bridge's own end against the report on screen ('2026Q3' vs '2026Q3'): true when the bridge stops earlier. */
export function bridgeBehind(bridgeEnd: string, report: string | null | undefined): boolean {
  const r = report && /^\d{4}FY$/.test(report) ? `${report.slice(0, 4)}Q4` : report;
  return !!r && /^\d{4}Q[1-4]$/.test(r) && bridgeEnd < r;
}
