import type { Prov } from './prov';
import { nf } from './format';

/* Sum of the parts seeded from the sources-of-profit extraction (web/public/data/sop/<id>.json): segment profit before tax as each
   insurer prints it, LTM where the half-year report prints the same line for both years (FY'25 + H1'26 − H1'25), otherwise FY'25.
   The line chosen for each company is the one whose segments add up to the group's pre-tax (comprehensive) profit. */

interface SopFact { f: string; m: string; s: string; w: string; d: string; v: number; pg: number | null; b: string; u?: string | null }
export type SopData = Record<string, { url: string | null; facts: SopFact[] }>;
/** [label, metric, segment, core] */
type Spec = [string, string, string, boolean];
const seg = (m: string, rows: [string, string, boolean?][]): Spec[] => rows.map(([label, s, core = true]) => [label, m, s, core]);
const grp = (rows: [string, string, boolean?][]): Spec[] => rows.map(([label, m, core = true]) => [label, `sop:${m}`, 'group', core]);

export const SOTP_SPEC: Record<string, { basis: string; parts: Spec[] }> = {
  phoenix: { basis: 'תוצאות הפעילות לפי מגזרים, רווח כולל לפני מס', parts: seg('sop:תוצאות הפעילות לפי מגזרים', [
    ['ביטוח כללי', 'pc'], ['בריאות', 'health'], ['חיים וחיסכון', 'life'], ['הון אחר (ביטוח)', 'other', false], ['פנסיה וגמל', 'pension_gemel'],
    ['ניהול השקעות', 'ניהול השקעות'], ['סוכנויות', 'סוכנויות'], ['אשראי', 'אשראי'], ['ניהול נכסים, אחר', 'אחר (ניהול נכסים)']]) },
  harel: { basis: 'רווחי ליבה לפני מס לפי מגזר ופריטים שאינם ליבה', parts: [...seg('sop:רווחי ליבה', [
    ['ביטוח חיים', 'life'], ['ביטוח בריאות', 'health'], ['ביטוח כללי', 'pc'], ['ניהול נכסים', 'ניהול נכסים'], ['אשראי', 'אשראי'], ['הון', 'הון', false]]),
    ...grp([['מרווח השקעתי עודף', 'מרווח השקעתי עודף', false], ['השפעות מיוחדות', 'השפעות מיוחדות', false]])] },
  migdal: { basis: 'רווח מפעילויות ליבה ופריטים שאינם ליבה, לפני מס', parts: grp([
    ['חיסכון ארוך טווח', 'חא"ט'], ['ביטוח בריאות', 'ביטוח בריאות'], ['ביטוח כללי', 'ביטוח כללי'], ['שירותים פיננסים', 'שירותים פיננסים'], ['סוכנויות', 'סוכנויות'], ['הון', 'הון', false],
    ['רווח פיננסי עודף', 'רווח (הפסד) פיננסי עודף', false], ['השפעות מיוחדות', 'רווח (הפסד) מהשפעות מיוחדות', false]]) },
  clal: { basis: 'רווח מעסקי ליבה ורווח אחר, לפני מס', parts: grp([
    ['ביטוח חיים', 'ביטוח חיים'], ['ביטוח כללי', 'ביטוח כללי'], ['ביטוח אשראי', 'ביטוח אשראי'], ['ביטוח בריאות', 'ביטוח בריאות'], ['פנסיה', 'פנסיה'], ['גמל', 'גמל'],
    ['כרטיסי אשראי', 'כרטיסי אשראי'], ['סוכנויות ואחר', 'סוכנויות ואחר'], ['לא מיוחס למגזרים', 'לא מיוחס למגזרי פעילות', false],
    ['מרווח פיננסי עודף', 'מרווח פיננסי עודף', false], ['התאמות', 'התאמות', false], ['חלק מיעוט', 'חלק מיעוט', false]]) },
  menora: { basis: 'רווח כולל לפני מס לפי מגזר (חלוקת המגזרים של FY\'25)', parts: seg('sop_total:סך כל הרווח הכולל לפני מסים על ההכנסה', [
    ['ביטוח כללי', 'pc'], ['בריאות', 'health'], ['חיים וחיסכון', 'life'], ['אשראי', 'credit'], ['לא מיוחס למגזרים', 'other:לא מיוחס למגזרי פעילות', false], ['התאמות וקיזוזים', 'other:התאמות וקיזוזים', false]]) },
  ayalon: { basis: 'רווח כולל לפני מס לפי מגזר', parts: seg('sop:סה"כ רווח כולל לפני מס (לפי מגזר)', [
    ['ביטוח כללי, איילון', 'pc:ביטוח כללי איילון'], ['ביטוח כללי, ווישור', 'pc:ביטוח כללי ווישור'], ['חיים וחיסכון', 'life'], ['בריאות', 'health'], ['אחר', 'other', false]]) },
};

export interface Seed { label: string; core: boolean; v: number; ltm: boolean; prov: () => Prov }
const tagOf = (_p: string, w: string, d: string) => (w === 'fy' ? `FY'${d.slice(2, 4)}` : `${d.slice(5, 7) === '06' ? 'H1' : d.slice(5, 7) === '09' ? '9M' : 'Q1'}'${d.slice(2, 4)}`);

/** The seeded parts of one company, each with its source: a printed line, or LTM built from three printed lines. */
export function sotpSeeds(id: string, data: SopData, wantLtm: boolean): { seeds: Seed[]; basis: string; ltmAll: boolean } | null {
  const spec = SOTP_SPEC[id];
  if (!spec) return null;
  const find = (p: string, m: string, s: string, d: string, w: string) => (data[p]?.facts ?? []).find((f) => f.f === 'sop' && f.m === m && f.s === s && f.d === d && f.w === w) ?? null;
  const ps = Object.keys(data);
  const fy = ps.filter((p) => p.endsWith('FY')).sort().pop();
  const h1 = ps.filter((p) => p.endsWith('Q2') && fy && p.slice(0, 4) > fy.slice(0, 4)).sort().pop();
  if (!fy) return null;
  const y = fy.slice(0, 4), fyEnd = `${y}-12-31`;
  const factProv = (f: SopFact, p: string, title: string): Prov => ({ k: 'report', title, value: nf(f.v, 0), unit: 'מיליוני ש"ח', url: f.u !== undefined ? f.u ?? null : data[p]?.url ?? null, pg: f.pg, doc: 'דוח כספי · מקורות רווח', period: tagOf(p, f.w, f.d), note: f.m.replace(/^sop(_total)?:/, '') });
  const seeds: Seed[] = [];
  for (const [label, m, s, core] of spec.parts) {
    const a = find(fy, m, s, fyEnd, 'fy');
    const b = h1 ? find(h1, m, s, `${h1.slice(0, 4)}-06-30`, 'ytd') : null, b0 = h1 ? find(h1, m, s, `${Number(h1.slice(0, 4)) - 1}-06-30`, 'ytd') : null;
    if (wantLtm && a && b && b0) {
      const v = a.v + b.v - b0.v, t = `${label}, רווח לפני מס, LTM`;
      seeds.push({ label, core, v, ltm: true, prov: () => ({ k: 'calc', title: t, value: nf(v, 0), unit: 'מיליוני ש"ח', formula: `LTM = ${tagOf(fy, 'fy', fyEnd)} + ${tagOf(h1!, 'ytd', b.d)} − ${tagOf(h1!, 'ytd', b0.d)}`,
        inputs: [{ label: tagOf(fy, 'fy', fyEnd), v: nf(a.v, 0), src: () => factProv(a, fy, `${label}, ${tagOf(fy, 'fy', fyEnd)}`) }, { label: tagOf(h1!, 'ytd', b.d), v: nf(b.v, 0), src: () => factProv(b, h1!, `${label}, ${tagOf(h1!, 'ytd', b.d)}`) },
          { label: `פחות ${tagOf(h1!, 'ytd', b0.d)}`, v: nf(b0.v, 0), src: () => factProv(b0, h1!, `${label}, ${tagOf(h1!, 'ytd', b0.d)}`) }] }) });
    } else if (a) {
      seeds.push({ label, core, v: a.v, ltm: false, prov: () => factProv(a, fy, `${label}, רווח לפני מס, ${tagOf(fy, 'fy', fyEnd)}`) });
    }
  }
  return seeds.length ? { seeds, basis: spec.basis, ltmAll: seeds.every((x) => x.ltm) } : null;
}
