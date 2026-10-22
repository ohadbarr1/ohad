import { useLoad } from './useData';
import type { Prov } from './prov';
import { nf, pubLabel } from './format';

/* External inputs an IFRS 17 reader needs (pipeline/build_macro.py -> data/macro/macro.json): BoI rate, CPI, 10-year zero-coupon points.
   They are labelled as external inputs, never as company figures. The full curve is lane 2D's file (data/macro/boi_curve.json). */

interface Meta { label: string; unit: string; source: string; url: string; retrieved: string; stale?: boolean; code: string }
export interface MonthSeries extends Meta { basis?: string; months: [string, number][] }
export interface RateSeries extends Meta { last: [string, number]; changes: [string, number][]; months: [string, number][]; next: string | null; next_url: string }
export interface CpiPoint { m: string; idx?: number; base?: string; mom?: number | null; yoy?: number | null }
export interface CpiSeries extends Meta { points: CpiPoint[]; ytd?: { from: string; to: string; idx_from: number; idx_to: number; v: number } }
export interface MacroData { generated: string; series: { rate: RateSeries; cpi?: CpiSeries; nom10?: MonthSeries; real10?: MonthSeries; be10?: MonthSeries; exp1?: MonthSeries } }
export interface CurveData { source: string; url: string; retrieved: string; basis: string; unit: string; months: string[]; tenors: number[]; nominal: Record<string, (number | null)[]>; real: Record<string, (number | null)[]> }

export const useMacro = () => useLoad<MacroData>('macro/macro.json');
/** lane 2D's zero-coupon curve; absent until that build lands, and the panel then shows no curve */
export const useCurve = () => useLoad<CurveData>('macro/boi_curve.json');

/** "2026-09" -> "09/26", the way the site names a month of external data */
export const mLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
/** the month three months earlier: the previous quarter's month */
export const back3 = (m: string) => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 3; const yy = mo <= 0 ? y - 1 : y, mm = mo <= 0 ? mo + 12 : mo; return `${yy}-${String(mm).padStart(2, '0')}`; };

export function seriesProv(s: Meta, value: string, period: string, note?: string): Prov {
  return { k: 'report', title: s.label, value, unit: s.unit, url: s.url, pg: null, doc: s.source, period, srcType: 'נתון חיצוני', note: [s.code, note, `נמשך ${pubLabel(s.retrieved)}`, s.stale ? 'המשיכה האחרונה נכשלה; מוצג הקובץ הקודם' : ''].filter(Boolean).join(' · ') };
}
/** change between two published values, computed here */
export function deltaProv(s: Meta, a: [string, number], b: [string, number], bp: boolean): Prov {
  const d = (a[1] - b[1]) * (bp ? 100 : 1);
  return { k: 'calc', title: `${s.label}, שינוי ${mLabel(b[0])} → ${mLabel(a[0])}`, value: bp ? `${nf(d, 0)} נ"ב` : `${nf(d, 2)} נ"א`, formula: bp ? 'שינוי = (ערך אחרון − ערך לפני שלושה חודשים) × 100 נקודות בסיס' : 'שינוי = ערך אחרון − ערך קודם',
    inputs: [{ label: mLabel(a[0]), v: `${nf(a[1], 2)}%`, src: () => seriesProv(s, `${nf(a[1], 2)}%`, mLabel(a[0])) }, { label: mLabel(b[0]), v: `${nf(b[1], 2)}%`, src: () => seriesProv(s, `${nf(b[1], 2)}%`, mLabel(b[0])) }] };
}
