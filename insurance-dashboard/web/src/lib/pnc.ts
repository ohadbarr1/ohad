/* W10 · P&C ratios by line of business (pnc.json, pipeline/build_pnc.py). The file carries every printed input with its page (`base`) and the
   values per period with the ratios (`per`); this library builds the source of each ratio: a calc whose inputs are the printed lines, and for a
   derived period (Q1 = H1 − Q2, LTM = FY + H1 − H1 last year) the derivation of each input. The test re-derives every ratio from `base`. */
import { fmt } from './drivers';
import type { Prov } from './prov';

export const PNC_PATH = 'pnc.json';
export type Metric = 'rev' | 'ise' | 'isr_gross' | 'rx' | 'ri' | 'rnet' | 'isr' | 'cl' | 'past';
export type RatioKey = 'lr' | 'er' | 'cr' | 'crn' | 'ces';
export interface Per { x: Partial<Record<Metric, number>>; r: Partial<Record<RatioKey, number>> }
export interface Line { base: Record<string, Partial<Record<Metric, [number, number]>>>; per: Record<string, Per> }
export interface PncFile {
  meta: { v: 1; built: string; source: string; files: string; periods: [string, string, [number, string][]][]; lines: [string, string][]; gaps: [string, string, string][];
    defs: Record<RatioKey | 'rr', string> };
  reports: Record<string, { rid: number; f: string; pub: string; period: string; unit: string; note: string }>;
  cos: Record<string, { name: string; lines: Record<string, Line> }>;
}

export const M_HE: Record<Metric, string> = {
  rev: 'הכנסות משירותי ביטוח', ise: 'הוצאות שירותי ביטוח', isr_gross: 'רווח משירותי ביטוח לפני ביטוח משנה', rx: 'הוצאות מביטוח משנה', ri: 'הכנסות מביטוח משנה',
  rnet: 'תוצאת ביטוח משנה, נטו', isr: 'רווח משירותי ביטוח', cl: 'תביעות והוצאות שירותי ביטוח אחרות שהתהוו', past: 'שינויים לשירותי עבר (תביעות שהתהוו)',
};
export const R_HE: Record<RatioKey, string> = { lr: 'יחס נזק', er: 'יחס הוצאות', cr: 'משולב, ברוטו', crn: 'משולב, נטו ביטוח משנה', ces: 'שיעור ביטוח משנה' };
const BASE_HE: Record<string, string> = { h126: "H1'26", h125: "H1'25", q226: "Q2'26", q225: "Q2'25", fy25: "FY'25" };
const MM = 'מיליוני ש"ח';

/** the ratios from the inputs (the same formulas as build_pnc.py `ratios`) */
export function ratios(x: Per['x']): Per['r'] {
  const rev = x.rev;
  if (!rev || rev <= 0) return {};
  const r: Per['r'] = {};
  if (x.cl != null && x.past != null) { r.lr = (x.cl + x.past) / rev; if (x.ise != null) r.er = (x.ise - x.cl - x.past) / rev; }
  if (x.ise != null) r.cr = x.ise / rev;
  if (x.ise != null && x.ri != null && x.rx != null && rev - x.rx > 0) r.crn = (x.ise - x.ri) / (rev - x.rx);
  if (x.rx != null) r.ces = x.rx / rev;
  return r;
}

export const pct = (v: number | null | undefined, d = 1) => (v == null ? '–' : `${fmt(v * 100, d)}%`);

/** the source of one printed input in one base window */
function leaf(F: PncFile, co: string, seg: string, w: string, m: Metric, lineHe: string): Prov {
  const c = F.cos[co], cell = c.lines[seg].base[w][m]!, rep = F.reports[co];
  return { k: 'report', title: `${M_HE[m]} · ${lineHe} · ${c.name} · ${BASE_HE[w]}`, value: fmt(cell[0], 1), unit: MM, url: F.meta.files + rep.f, pg: cell[1],
    doc: `${c.name}, דוח רבעוני ${rep.period.replace(/^20(\d\d)(Q\d)$/, "$2'$1")}, ביאור מגזר ביטוח כללי`, period: BASE_HE[w], srcType: 'דוח כספי (MAYA)',
    note: rep.unit.includes('thousands') ? 'הודפס באלפי ש"ח; מוצג במיליוני ש"ח. שורות הוצאה מוצגות בסימן חיובי' : 'שורות הוצאה מוצגות בסימן חיובי' };
}

/** one input of a period: the printed cell, or its derivation from the printed windows */
function input(F: PncFile, co: string, seg: string, pk: string, m: Metric, lineHe: string): Prov {
  const parts = F.meta.periods.find((p) => p[0] === pk)![2];
  if (parts.length === 1) return leaf(F, co, seg, parts[0][1], m, lineHe);
  const L = F.cos[co].lines[seg], v = L.per[pk].x[m]!;
  const ph = F.meta.periods.find((p) => p[0] === pk)![1];
  return { k: 'calc', title: `${M_HE[m]} · ${lineHe} · ${F.cos[co].name} · ${ph}`, value: fmt(v, 1), unit: MM,
    formula: parts.map(([s, w], i) => `${i ? (s > 0 ? ' + ' : ' − ') : s < 0 ? '−' : ''}${BASE_HE[w]}`).join(''),
    inputs: parts.map(([s, w]) => ({ label: `${s < 0 ? 'פחות: ' : ''}${BASE_HE[w]}`, v: fmt(L.base[w][m]![0], 1), src: () => leaf(F, co, seg, w, m, lineHe) })),
    note: pk === 'ltm' ? 'LTM = השנה המלאה האחרונה + המחצית הנוכחית − המחצית המקבילה' : 'רבעון ראשון = מחצית − רבעון שני (שניהם מודפסים בדוח הרבעון השני)' };
}

const NEED: Record<RatioKey, Metric[]> = { lr: ['cl', 'past', 'rev'], er: ['ise', 'cl', 'past', 'rev'], cr: ['ise', 'rev'], crn: ['ise', 'ri', 'rev', 'rx'], ces: ['rx', 'rev'] };

/** the source of a ratio: a calc over the printed inputs (each opens its page) */
export function ratioProv(F: PncFile, co: string, seg: string, pk: string, k: RatioKey, lineHe: string): Prov {
  const P = F.cos[co].lines[seg].per[pk], ph = F.meta.periods.find((p) => p[0] === pk)![1];
  return { k: 'calc', title: `${R_HE[k]} · ${lineHe} · ${F.cos[co].name} · ${ph}`, value: pct(P.r[k]), unit: '%', formula: F.meta.defs[k],
    inputs: NEED[k].map((m) => ({ label: M_HE[m], v: fmt(P.x[m], 1), src: () => input(F, co, seg, pk, m, lineHe) })),
    note: 'מחושב באתר משורות הביאור כפי שהודפסו; הגדרת החברה ליחס המשולב בדוח הדירקטוריון עשויה להיות שונה' };
}

/** the reinsurance result (NIS m) with its two inputs */
export function rrProv(F: PncFile, co: string, seg: string, pk: string, lineHe: string): Prov {
  const P = F.cos[co].lines[seg].per[pk], ph = F.meta.periods.find((p) => p[0] === pk)![1];
  const v = (P.x.ri ?? 0) - (P.x.rx ?? 0);
  return { k: 'calc', title: `תוצאת ביטוח משנה · ${lineHe} · ${F.cos[co].name} · ${ph}`, value: fmt(v, 1), unit: MM, formula: F.meta.defs.rr,
    inputs: (['ri', 'rx'] as Metric[]).map((m) => ({ label: M_HE[m], v: fmt(P.x[m], 1), src: () => input(F, co, seg, pk, m, lineHe) })) };
}
