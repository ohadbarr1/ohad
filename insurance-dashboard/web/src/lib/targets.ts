import { nf, pubLabel } from './format';
import type { Prov } from './prov';
import { useLoad } from './useData';

/* targets.json v2 (pipeline/build_targets.py): management targets from the filings and the investor decks, each with its first and last
   statement, its revisions, and the actual where the site carries it (calc provenance). */
export type Stmt = [string, number | null, number | null] | null; // [date, report id, page]
export interface TargetAct { k: 'roe' | 'ci' | 'profit' | 'sr' | 'payout'; v: number; y: number; f: string; in: [string, number, string | null, number | null, string, number | null][]; ref?: 1; prog?: 1 }
export interface Target {
  c: string; m: string; l: string; e: string; seg: string; t: 'strategy' | 'payout' | 'capital'; u: 'pct' | 'm' | 'n' | 'x'; h: number | null; b: string; d: string;
  v: number | null; lo: number | null; hi: number | null; r: string | null; doc: number | null; pg: number | null; q: string; n: number;
  hist: (string | number | null)[][] | null; src: 'pres' | 'report'; st0: Stmt; st1: Stmt; img?: 1; nt?: string; st: 'open' | 'met' | 'missed'; act?: TargetAct;
}
export interface Targets { v: number; built: string; source: string; files: string; docs: Record<string, [string, string, string, string, string]>; status: Record<string, [string, string, number | null, number | null, string][]>; rows: Target[] }
export const useTargets = () => useLoad<Targets>('targets.json');

export const TOPIC: [Target['t'], string][] = [['strategy', 'יעדים אסטרטגיים'], ['capital', 'הון וכושר פירעון'], ['payout', 'מדיניות חלוקה']];
export const ST_HE: Record<Target['st'], string> = { open: 'פתוח', met: 'הושג', missed: 'פוספס' };
const DOC_HE: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'כושר פירעון' };
const UNIT_HE: Record<Target['u'], string> = { pct: '%', m: 'מיליוני ש"ח', n: 'לקוחות', x: '' };

const one = (u: Target['u'], v: number) => (u === 'pct' ? `${nf(v, Number.isInteger(v) ? 0 : 1)}%` : nf(v, Math.abs(v) < 100 && !Number.isInteger(v) ? 1 : 0));
/** a target as printed: a value, a range, "at least" or "up to" */
export function tv(t: { u: Target['u']; v: number | null; lo: number | null; hi: number | null }): string {
  if (t.v != null) return one(t.u, t.v);
  if (t.lo != null && t.hi != null) return t.u === 'pct' ? `${nf(t.lo, Number.isInteger(t.lo) ? 0 : 1)}–${one(t.u, t.hi)}` : `${one(t.u, t.lo)}–${one(t.u, t.hi)}`;
  if (t.lo != null) return `≥ ${one(t.u, t.lo)}`;
  if (t.hi != null) return `≤ ${one(t.u, t.hi)}`;
  return '–';
}
export const actText = (t: Target) => (t.act ? (t.act.k === 'sr' || t.act.k === 'roe' || t.act.k === 'payout' ? `${nf(t.act.v, 1)}%` : nf(t.act.v, 0)) : '');
export const unitHe = (t: Target) => UNIT_HE[t.u];
export const horizon = (t: Target) => (t.h ? String(t.h) : 'מדיניות');
export const docName = (d: Targets, id: number | null | undefined) => { const x = id != null ? d.docs[String(id)] : undefined; return x ? `${DOC_HE[x[1]] ?? 'דוח'} ${x[2].endsWith('FY') ? `FY'${x[2].slice(2, 4)}` : `${x[2].slice(4)}'${x[2].slice(2, 4)}`}` : 'דוח'; };

/** the source sheet of one statement of a target (the last one by default) */
export function stmtProv(d: Targets, t: Target, name: string, which: 'st0' | 'st1' = 'st1'): Prov {
  const s = t[which] ?? t.st1, x = s?.[1] != null ? d.docs[String(s[1])] : undefined;
  const value = which === 'st0' && t.hist ? tvAt(t, 0) : tv(t);
  return {
    k: 'report', title: `${t.l} · ${t.e ? `${t.e} · ` : ''}${name}`, value, unit: UNIT_HE[t.u] || undefined, url: x ? d.files + x[4] : null, pg: s?.[2] ?? null,
    doc: `${name}, ${docName(d, s?.[1])}`, period: t.h ? `יעד ל-${t.h}` : 'מדיניות', srcType: t.src === 'pres' ? 'מצגת משקיעים (MAYA)' : undefined,
    note: [t.q ? `בנוסח: ${t.q}` : '', s?.[0] ? `הוצהר ${pubLabel(s[0])}` : '', t.n > 1 ? `הוצג ${t.n} פעמים` : '', t.hist ? `עדכונים: ${t.hist.map((h, i) => `${tvAt(t, i)} (${pubLabel(String(h[0]))})`).join(' ← ')}` : '',
      t.img ? 'נקרא מתמונה' : '', t.b === 'pre_tax' ? 'לפני מס' : t.b === 'post_tax' ? 'לאחר מס' : ''].filter(Boolean).join(' · ') || undefined,
  };
}
/** the value of revision i (deck rows: [date, v, lo, hi, rid, pg]; report rows: [period, v, rid, pg]) */
export function tvAt(t: Target, i: number): string {
  const h = t.hist?.[i]; if (!h) return tv(t);
  return t.src === 'pres' ? tv({ u: t.u, v: h[1] as number | null, lo: h[2] as number | null, hi: h[3] as number | null }) : tv({ u: t.u, v: h[1] as number, lo: null, hi: null });
}
/** the actual beside the target: computed on the site from printed figures, each input linked to its page */
export function actProv(t: Target, name: string): Prov | null {
  const a = t.act; if (!a) return null;
  const MM = 'מיליוני ש"ח';
  return {
    k: 'calc', title: `בפועל מול ${t.l} · ${name} · FY'${String(a.y).slice(2)}`, value: actText(t), unit: a.k === 'sr' || a.k === 'roe' || a.k === 'payout' ? '%' : MM, formula: a.f,
    note: [a.prog ? `השנה האחרונה שדווחה; היעד ל-${t.h ?? 'מדיניות'} טרם נמדד` : '', a.ref ? 'להשוואה בלבד: מזומן ששולם בשנה מול מדיניות על רווחי השנה' : '', a.k === 'roe' ? 'ההגדרה של החברה עשויה להיות שונה (ממוצע, רווח מתואם)' : ''].filter(Boolean).join(' · ') || undefined,
    inputs: a.in.map(([label, v, url, pg, per, solv]) => ({ label: `${label} · ${per}`, v: label.startsWith('יחס') ? `${nf(v, 1)}%` : nf(v, 0),
      src: () => ({ k: 'report', title: `${label} · ${name} · ${per}`, value: label.startsWith('יחס') ? `${nf(v, 1)}%` : nf(v, 0), unit: label.startsWith('יחס') ? '%' : MM, url, pg, period: per,
        doc: solv ? 'דוח כושר פירעון כלכלי' : 'דוח כספי', srcType: solv ? 'דוח כושר פירעון כלכלי (MAYA)' : undefined }) as Prov })),
  };
}

/* adjusted.json: company-defined KPIs (core profit, adjusted profit, core ROE), never mixed with statement figures */
export interface AdjPt { p: string; v: number; rid: number | null; pg: number | null; l: string; dd: string; i?: 1 }
export interface AdjSeries { l: string; u: 'pct' | 'm'; def: string; pts: AdjPt[] }
export interface Adjusted { built: string; source: string; files: string; docs: Record<string, [string, string, string, string, string]>; companies: Record<string, Record<string, AdjSeries>> }
export const useAdjusted = () => useLoad<Adjusted>('adjusted.json');
export const adjPeriod = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
export function adjProv(A: Adjusted, s: AdjSeries, x: AdjPt, name: string): Prov {
  const doc = x.rid != null ? A.docs[String(x.rid)] : undefined;
  return { k: 'report', title: `${s.l} · לפי הגדרת החברה · ${name} · ${adjPeriod(x.p)}`, value: s.u === 'pct' ? `${nf(x.v, 1)}%` : nf(x.v, 0), unit: s.u === 'pct' ? '%' : 'מיליוני ש"ח',
    url: doc ? A.files + doc[4] : null, pg: x.pg, period: adjPeriod(x.p), doc: `${name}, מצגת משקיעים${x.dd ? ` ${pubLabel(x.dd)}` : ''}`, srcType: 'מצגת משקיעים (MAYA)',
    note: ['מדד לפי הגדרת החברה, לא שורה בדוחות הכספיים', s.def ? `הגדרה: ${s.def}` : '', x.l ? `בשקף: ${x.l}` : '', x.i ? 'נקרא מתמונה' : ''].filter(Boolean).join(' · ') };
}
