import { nf } from './format';
import { mayaReport } from './sources';
import type { Prov } from './prov';
import { useLoad } from './useData';

/* csm/solvency.json (pipeline/build_solvency.py): the separate economic-solvency (Solvency II) reports, one cell per insurer, date and measure.
   Every cell carries its report id and page; `i` = read from the page image; `alt` = another report printed a different value for the date. */
export interface SolvCell { v: number; r: number; pg: number | null; l?: string; i?: 1; hi?: number; alt?: { v: number; r: number; pg: number | null } }
export interface SolvSens { c: string; d: string; l: string; risk: string; b: 'w' | 'wo' | 'na'; v: number; r: number; pg: number | null; i?: 1 }
export interface SolvRep { c: string; as_of: string; f: string | null; pub: string | null; e: string }
export interface SolvFile { built: string; source: string; files: string; reports: Record<string, SolvRep>; companies: Record<string, Record<string, Record<string, SolvCell>>>; sens: SolvSens[] }
export const useSolvency = () => useLoad<SolvFile>('csm/solvency.json');

/** The risk modules of the standard formula in the order the reports print them; diversification and the loss-absorbing adjustments are negative. */
export const MODULES: [string, string][] = [
  ['m_market', 'שוק'], ['m_counterparty', 'צד נגדי'], ['m_life', 'חיתום חיים'], ['m_health', 'חיתום בריאות'], ['m_nonlife', 'חיתום כללי'], ['m_intangible', 'בלתי מוחשיים'],
  ['m_div', 'השפעת פיזור'], ['m_operational', 'תפעולי'], ['m_managers', 'חברות מנהלות'], ['m_lac_dt', 'ספיגת הפסדים, מס נדחה'], ['m_lac_tp', 'ספיגת הפסדים, עתודות'],
];
export const TIERS: [string, string][] = [['t1b', 'רובד 1 בסיסי'], ['t1r', 'רובד 1 נוסף'], ['t2', 'רובד 2'], ['t3', 'רובד 3']];
export const RISK_HE: Record<string, string> = { rate: 'ריבית', equity: 'מניות', morbidity: 'תחלואה', mortality: 'תמותה', lapse: 'ביטולים', expense: 'הוצאות', other: 'אחר' };
export const LABEL: Record<string, string> = {
  sr_w: 'יחס כושר פירעון, עם הוראות מעבר', sr_wo: 'יחס כושר פירעון, ללא הוראות מעבר', of_w: 'הון עצמי לעניין SCR', of_wo: 'הון עצמי לעניין SCR, ללא הוראות מעבר',
  scr_w: 'SCR', scr_wo: 'SCR, ללא הוראות מעבר', su_w: 'עודף הון', su_wo: 'עודף הון, ללא הוראות מעבר', bscr: 'BSCR (לפני תפעולי והתאמות)', mcr: 'MCR', ofm: 'הון עצמי לעניין MCR',
  t1: 'רובד 1', ...Object.fromEntries(TIERS), ...Object.fromEntries(MODULES.map(([k, l]) => [k, `SCR · ${l}`])),
};

/** the reporting date as a period: 2025-12-31 -> Q4'25 */
export const dLab = (d: string) => `${({ '03': 'Q1', '06': 'Q2', '09': 'Q3', '12': 'Q4' } as Record<string, string>)[d.slice(5, 7)] ?? d.slice(5, 7)}'${d.slice(2, 4)}`;
export const showV = (k: string, v: number) => (k.startsWith('sr') || k.startsWith('tg') ? `${nf(v, Number.isInteger(v) ? 0 : 1)}%` : nf(v, Math.abs(v) < 100 ? 1 : 0));
export const unitOf = (k: string) => (k.startsWith('sr') || k.startsWith('tg') ? '%' : 'מיליוני ש"ח');

/** the source sheet of one solvency-report figure: the PDF page, the row as printed, the MAYA filing, and whether it was read from an image */
export function solvProv(S: SolvFile, x: { v: number; r: number; pg: number | null; l?: string; i?: 1; alt?: SolvCell['alt'] }, title: string, d: string, unit: string, value: string, extra?: string): Prov {
  const rep = S.reports[String(x.r)];
  return {
    k: 'report', title, value, unit, url: rep?.f ? S.files + rep.f : null, pg: x.pg, period: dLab(d), srcType: 'דוח כושר פירעון כלכלי (MAYA)',
    doc: `${rep?.e || 'חברת הביטוח'}, דוח כושר פירעון כלכלי ליום ${dLab(rep?.as_of ?? d)}`,
    note: [x.l ? `שורה בדוח: ${x.l}` : '', x.i ? 'נקרא מתמונה' : '', rep?.as_of && rep.as_of !== d ? 'מעמודת ההשוואה של דוח מאוחר' : '',
      x.alt ? `בדוח אחר (${x.alt.r}, עמ׳ ${x.alt.pg ?? '–'}) הודפס ${nf(x.alt.v, Math.abs(x.alt.v) < 100 ? 1 : 0)}` : '', extra ?? '', `דיווח ${x.r}: ${mayaReport(x.r)}`].filter(Boolean).join(' · '),
  };
}

/** the latest date of an insurer that prints the SCR modules */
export const latestWith = (S: SolvFile, c: string, key: string) => Object.keys(S.companies[c] ?? {}).filter((d) => S.companies[c][d][key]).sort().pop() ?? null;
