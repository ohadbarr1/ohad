import { useMemo } from 'react';
import { useLoad } from './useData';
import type { IfrsData, IfrsFact } from './types';
import type { Prov } from './prov';
import { nf, byPeriodDesc } from './format';
import { BASIS, best, bridge, endOf, equityAt, factProv, hrefOf, lineProv, monthsOf, periodName, quarter, ratios, tag } from './csm';
import type { Bridge, Line, Ratios, Reports, RF, Win } from './csm';

/* Data of the IFRS 17 · CSM · capital ledger: the files build_csm.py and build_boi_curve.py write, and the industry arithmetic on them.
   Industry figures are sums of the insurers that print the inputs on the same basis; every one lists its members in its source sheet. */

export const INSURERS = ['phoenix', 'harel', 'migdal', 'clal', 'menora', 'ayalon', 'hachshara'];
export const MM = 'מיליוני ש"ח';
export const amt = (v: number) => nf(v, Math.abs(v) < 100 ? 1 : 0);

interface FactsFile { built: string; files: IfrsData['files']; reports: Record<string, IfrsFact[]> }
export interface Ledger { d: IfrsData; byCo: Map<string, Reports>; periods: string[]; built: string }
/** Every report of every insurer from one file, grouped by company and ordered oldest first. */
export function useLedger(): { data: Ledger | null; error: string | null } {
  const f = useLoad<FactsFile>('csm/facts.json');
  const data = useMemo(() => {
    if (!f.data) return null;
    const periods = Object.keys(f.data.reports).sort(byPeriodDesc);
    const byCo = new Map<string, Reports>();
    [...periods].reverse().forEach((p) => {
      const by = new Map<string, RF[]>();
      tag(f.data!.reports[p], p).forEach((x) => { if (!by.has(x.c)) by.set(x.c, []); by.get(x.c)!.push(x); });
      by.forEach((F, c) => { if (!byCo.has(c)) byCo.set(c, []); byCo.get(c)!.push({ p, F }); });
    });
    return { d: { unit: 'NIS millions', files: f.data.files }, byCo, periods, built: f.data.built };
  }, [f.data]);
  return { data, error: f.error };
}

/* ---------- one company at one date ---------- */
export interface At { id: string; b: Bridge | null; r: Ratios; eq: RF | null; re: Restated | null }
/** The restatement of a closing balance: first printed in one report, reprinted with another figure in a later one. */
export interface Restated { first: RF; last: RF }

export const equityFor = (rs: Reports, p: string): RF | null => [rs.find((r) => r.p === p), ...[...rs].reverse()].map((r) => (r ? equityAt(r.F, endOf(p)) : null)).find(Boolean) ?? null;

/** The closing balance of a table as each report printed it, oldest report first; a restatement when two of them differ. */
export function restatedOf(rs: Reports, b: Bridge | null): Restated | null {
  if (!b?.close) return null;
  const seen: RF[] = [];
  for (const r of rs) {
    const x = bridge(r.F, b.end, b.w === 'fy' ? 'fy' : b.w, { scope: b.scope, basis: b.b });
    const f = x?.close?.fs.length === 1 ? x.close.fs[0] : null;
    if (f) seen.push(f);
  }
  if (seen.length < 2) return null;
  const v = (f: RF) => f.dv ?? f.v;
  const first = seen[0], last = seen[seen.length - 1];
  return Math.abs(v(first) - v(last)) > 0.5 ? { first, last } : null;
}

export function at(rs: Reports, id: string, p: string, w: Win, pref: string): At {
  const b = best(rs, p, endOf(p), w, { pref }), eq = equityFor(rs, p);
  return { id, b, eq, r: ratios(b, eq?.v ?? null), re: restatedOf(rs, b) };
}
/** One quarter (the fourth = FY less 9M), or the cumulative window of the year. */
export function atQ(rs: Reports, id: string, k: string, span: 'q' | 'ytd', pref: string): At {
  const b = span === 'q' ? quarter(rs, k, { pref }) : best(rs, k, endOf(k), k.endsWith('FY') ? 'fy' : 'ytd', { pref });
  const eq = equityFor(rs, k);
  return { id, b, eq, r: ratios(b, eq?.v ?? null), re: restatedOf(rs, b) };
}

/** Quarter keys from the first comparative year to the newest report. */
export function quarterKeys(periods: string[]): string[] {
  if (!periods.length) return [];
  const last = periods[0], out: string[] = [];
  for (let y = Number(periods[periods.length - 1].slice(0, 4)) - 1; y <= Number(last.slice(0, 4)); y++) for (const q of ['Q1', 'Q2', 'Q3', 'FY']) out.push(`${y}${q}`);
  return out.filter((k) => byPeriodDesc(k, last) >= 0);
}
export const qLabel = (k: string, span: 'q' | 'ytd' = 'q') => (span === 'q' ? periodName(k).replace('FY', 'Q4') : k.endsWith('FY') ? periodName(k) : `${monthsOf(endOf(k), 'ytd')}M'${k.slice(2, 4)}`);

/** The source of a closing balance, with its restatement when a later report reprinted it with another figure. */
export function closeProv(l: Line, re: Restated | null, d: IfrsData, title: string, text?: string): Prov {
  const p = lineProv(l, d, title, text);
  if (!re || p.k !== 'report') return p;
  return { ...p, restated: { first: `${amt(re.first.dv ?? re.first.v)} · ${periodName(re.first.rp)}`, last: `${amt(re.last.dv ?? re.last.v)} · ${periodName(re.last.rp)}`, firstHref: hrefOf(re.first, d) ?? undefined, lastHref: hrefOf(re.last, d) ?? undefined, in: periodName(re.last.rp) } };
}

/* ---------- the industry ---------- */
type Part = { id: string; v: number; src: () => Prov };
export interface Agg { v: number; parts: Part[] }
export interface Industry {
  basis: string; members: string[]; out: { id: string; why: string }[];
  open: Agg | null; close: Agg | null; eq: Agg | null; gap: Agg | null; steps: Map<string, Agg>;
  nbRel: Agg2 | null; csmEq: Agg2 | null; relOpen: Agg2 | null; intOpen: Agg2 | null; estOpen: Agg2 | null; chg: Agg2 | null;
}
/** A ratio of two industry sums, over the insurers that print both. */
export interface Agg2 { v: number; num: Agg; den: Agg; scale: number }
const sum = (parts: Part[]): Agg | null => (parts.length ? { v: parts.reduce((t, x) => t + x.v, 0), parts } : null);

/** The industry table: the insurers whose table is on the basis asked for, added line by line. Companies on another basis are left out and named.
    With `full`, only insurers whose table carries opening, closing, new business and release, so the column rolls forward like a company's. */
export function industry(rows: At[], pref: string, d: IfrsData, name: (id: string) => string, when: string, full = false): Industry {
  const has = (r: At, k: string) => r.b!.steps.some((s) => s.k === k);
  const live = rows.filter((r) => r.b?.close);
  const onBasis = live.filter((r) => r.b!.b === pref);
  const members = full ? onBasis.filter((r) => r.b!.open && has(r, 'nb') && has(r, 'rel')) : onBasis;
  const out = [...rows.filter((r) => !r.b?.close).map((r) => ({ id: r.id, why: 'אין טבלת תנועה' })), ...live.filter((r) => r.b!.b !== pref).map((r) => ({ id: r.id, why: `בסיס ${BASIS[r.b!.b] ?? r.b!.b}` })),
    ...onBasis.filter((r) => !members.includes(r)).map((r) => ({ id: r.id, why: 'אין גשר מלא בחלון' }))];
  const line = (r: At, l: Line | null | undefined, what: string): Part | null => (l ? { id: r.id, v: l.v, src: () => lineProv(l, d, `${what} · ${name(r.id)} · ${when}`) } : null);
  const parts = (get: (r: At) => Part | null, among = members) => among.map(get).filter((x): x is Part => !!x);
  const step = (r: At, k: string) => r.b!.steps.find((s) => s.k === k)?.line ?? null;
  const keys = [...new Set(members.flatMap((r) => r.b!.steps.map((s) => s.k)))];
  const steps = new Map(keys.map((k) => [k, sum(parts((r) => line(r, step(r, k), k)))!] as const));
  const ratio = (num: (r: At) => number | null, den: (r: At) => number | null, scale: number, src: (r: At, which: 'n' | 'd') => () => Prov): Agg2 | null => {
    const both = members.filter((r) => num(r) != null && den(r));
    if (both.length < 2) return null;
    const n = sum(both.map((r) => ({ id: r.id, v: num(r)!, src: src(r, 'n') })))!, dd = sum(both.map((r) => ({ id: r.id, v: den(r)!, src: src(r, 'd') })))!;
    return dd.v ? { v: (n.v / dd.v) * scale, num: n, den: dd, scale } : null;
  };
  const L = (r: At, k: string) => (k === 'open' ? r.b!.open : k === 'close' ? r.b!.close : step(r, k));
  const lsrc = (k: string, what: string) => (r: At) => () => { const l = L(r, k)!; return lineProv(k === 'rel' ? { ...l, v: Math.abs(l.v) } : l, d, `${what} · ${name(r.id)} · ${when}`); };
  const eqsrc = (r: At) => () => factProv(r.eq!, d, `הון לבעלי המניות · ${name(r.id)} · ${when}`);
  const v = (k: string) => (r: At) => { const l = L(r, k); return l ? (k === 'rel' ? Math.abs(l.v) : l.v) : null; };
  const mo = (r: At) => monthsOf(r.b!.end, r.b!.w);
  const pick = (k: string, what: string, dk: string, dwhat: string) => (r: At, which: 'n' | 'd') => (which === 'n' ? lsrc(k, what)(r) : lsrc(dk, dwhat)(r));
  return {
    basis: pref, members: members.map((r) => r.id), out,
    open: sum(parts((r) => line(r, r.b!.open, 'CSM פתיחה'))), close: sum(parts((r) => line(r, r.b!.close, 'CSM סגירה'))), gap: sum(parts((r) => (r.b!.gap == null ? null : { id: r.id, v: r.b!.gap, src: () => ({ k: 'calc', title: `הפרש לא מוסבר · ${name(r.id)} · ${when}`, value: amt(r.b!.gap!), formula: 'סגירה פחות פתיחה פחות כל שורות התנועה שהודפסו', inputs: [] }) }))),
    eq: sum(parts((r) => (r.eq ? { id: r.id, v: r.eq.v, src: eqsrc(r) } : null))), steps,
    nbRel: ratio(v('nb'), v('rel'), 100, pick('nb', 'CSM עסק חדש', 'rel', 'שחרור CSM')),
    csmEq: ratio(v('close'), (r) => r.eq?.v ?? null, 1, (r, w) => (w === 'n' ? lsrc('close', 'יתרת CSM')(r) : eqsrc(r))),
    relOpen: ratio((r) => { const x = v('rel')(r); return x == null ? null : x * (12 / mo(r)); }, v('open'), 100, pick('rel', 'שחרור CSM', 'open', 'CSM פתיחה')),
    intOpen: ratio(v('int'), v('open'), 100, pick('int', 'צבירת ריבית', 'open', 'CSM פתיחה')),
    estOpen: ratio(v('est'), v('open'), 100, pick('est', 'שינויי אומדן', 'open', 'CSM פתיחה')),
    chg: ratio((r) => { const c = v('close')(r), o = v('open')(r); return c == null || o == null ? null : c - o; }, v('open'), 100, pick('close', 'CSM סגירה', 'open', 'CSM פתיחה')),
  };
}
/** The change of an industry sum between two dates over the insurers present at both, never a sum of different companies against each other. */
export function likeForLike(a: Agg | null, b: Agg | null): { v: number; now: Agg; then: Agg } | null {
  if (!a || !b) return null;
  const ids = a.parts.filter((x) => b.parts.some((y) => y.id === x.id)).map((x) => x.id);
  if (ids.length < 2) return null;
  const pick = (g: Agg): Agg => { const parts = g.parts.filter((x) => ids.includes(x.id)); return { v: parts.reduce((t, x) => t + x.v, 0), parts }; };
  const now = pick(a), then = pick(b);
  return then.v ? { v: (now.v / then.v - 1) * 100, now, then } : null;
}
/** The source sheet of an industry sum: each insurer's figure, each linked to its page. */
export const aggProv = (a: Agg, title: string, name: (id: string) => string, text?: string): Prov => ({ k: 'calc', title, value: text ?? amt(a.v), unit: MM, formula: `סכום ${a.parts.length} החברות שמדפיסות את השורה על אותו בסיס`, inputs: a.parts.map((x) => ({ label: name(x.id), v: amt(x.v), src: x.src })) });
export const agg2Prov = (a: Agg2, title: string, formula: string, name: (id: string) => string, text: string, numL: string, denL: string): Prov => ({
  k: 'calc', title, value: text, formula: `${formula} · ${a.num.parts.length} חברות שמדפיסות את שני הרכיבים`,
  inputs: [{ label: `${numL}, סך הכול`, v: amt(a.num.v), src: () => aggProv(a.num, `${numL} · ענף`, name) }, { label: `${denL}, סך הכול`, v: amt(a.den.v), src: () => aggProv(a.den, `${denL} · ענף`, name) }],
});

/* ---------- sensitivities, discount rates, capital history, the BoI curve ---------- */
export type Risk = 'rate' | 'equity' | 'morbidity' | 'mortality' | 'lapse' | 'expense' | 'other';
export type Eff = 'csm' | 'profit' | 'equity' | 'pe';
export interface SensRow { c: string; rp: string; d: string; shock: string; risk: Risk; dir: 1 | -1 | null; size: number | null; eff: Eff; tax: 'after' | null; b: string; seg: 'group' | 'life_health'; s: string; v: number; pg: number | null; u: string | null; l: string }
export const useSens = () => useLoad<{ built: string; rows: SensRow[] }>('csm/sens.json');
export interface RateRow { c: string; rp: string; d: string; port: string | null; orig: string; t: number; v: number; pg: number | null; u: string | null; real: boolean; ilp: boolean }
export const useRates = () => useLoad<{ built: string; rows: RateRow[] }>('csm/rates.json');
export interface CapPt { v: number; pg?: number | null; u?: string | null; std?: string; der?: number; cmp?: number; s?: string }
export type CapCo = Partial<Record<'equity_attributable' | 'profit_attributable' | 'comprehensive_income_attributable' | 'dividend_paid' | 'dividend_declared' | 'sr_w' | 'sr_wo', Record<string, CapPt>>>;
export const useCapital = () => useLoad<{ built: string; source: string; companies: Record<string, CapCo> }>('csm/capital.json');
export interface Curve { source: string; url: string; retrieved: string; basis: string; unit: string; months: string[]; tenors: number[]; nominal: Record<string, (number | null)[]>; real: Record<string, (number | null)[]>; codes: Record<string, Record<string, string>> }
export const useCurve = () => useLoad<Curve>('macro/boi_curve.json');

export const RISK_HE: Record<Risk, string> = { rate: 'ריבית', equity: 'מחירי מניות', morbidity: 'תחלואה', mortality: 'תמותה', lapse: 'ביטולים', expense: 'הוצאות', other: 'אחר' };
export const EFF_HE: Record<Eff, string> = { csm: 'CSM', profit: 'רווח', equity: 'הון', pe: 'רווח והון' };
/** "ריבית +0.5 נ״א", the signed size isolated left-to-right so the sign stays in front of the number in right-to-left text and on a chart */
export const shockHe = (r: { risk: Risk; dir: 1 | -1 | null; size: number | null }) =>
  `${RISK_HE[r.risk]} \u2066${r.dir == null ? '±' : r.dir > 0 ? '+' : '−'}${r.size == null ? '' : nf(r.size, r.size % 1 ? 1 : 0)}${r.risk === 'rate' ? '\u2069 נ״א' : '%\u2069'}`;

/** A month (2025-12) on screen: 12/25. */
export const monthHe = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
/** The quarter-end month of a report period. */
export const monthOf = (p: string) => endOf(p).slice(0, 7);
