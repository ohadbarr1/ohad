/* W11 · the claims-adjusted cover price (agent door). funds/covers.json (pipeline/build_covers.py) prices the disability and survivors
   cover of each new comprehensive pension fund per ₪1,000 of insured salary, for a standard member at 30/40/50, man or woman, from the
   tables the fund prints in its bylaws (page-cited). Here each part is divided by the share of that kind of claim the fund's managing
   company reports as approved AND the share it closed within 30 days (annex B3, funds/decision.json, a company self-report):
     effective = disability ÷ (disability approved × disability closed ≤ 30 days) + survivors ÷ (survivors approved × survivors ≤ 30 days)
   "₪ of bylaws price per ₪ of claims paid and paid fast", a description of two published figures side by side, never a ranking or a
   recommendation: the B3 shares are company-wide, include claims the cover does not owe, and say nothing of the amounts paid.
   Pure: no React, no fetch (the node test runs it). */
import type { Prov } from './prov';
import { claimProv, claimsWhy, companyOf, type DecisionFile } from './decision';

export const COVERS_PATH = 'funds/covers.json';
export type CSex = 'm' | 'f';
export interface CoverSrc { title: string; edition: string; url: string; retrieved: string; kind?: string; publisher?: string; fund?: string; page_url?: string; official_url?: string; official_edition?: string; note?: string; sha256: string }
export interface CoverTable { kind: 'dis' | 'wid' | 'orph' | 'mort' | 'comb'; sex: CSex; pages: number[]; quote: string; col?: string; years?: number[]; note?: string }
export interface CoverCell {
  sex: CSex; age: number;
  dis: { f: number; pg: number[]; cost: number } | null; dis_why?: string;
  surv: { w?: number; o?: number; comb?: number; pg_w?: number[]; pg_o?: number[]; pg_c?: number[]; by: number; by_m?: number; m: number; pg_m: number[]; sar: number; cost: number } | null; surv_why?: string;
  total: number | null;
}
export interface CoverFund { grp: string; src: CoverSrc; tables: CoverTable[]; excluded: { kind: string; sex: CSex; pages: number[]; why: string }[]; cells: CoverCell[] }
export interface CoversFile {
  v: number; asof: string; method: string; standard_note: string; dis_amount: number;
  standard: { year: number; ages: number[]; disability_pct: number; survivors_pct: number; widow_share: number; orphan_share: number; contrib_pct: number; waiver_pct: number; end_age: number; double_disability: boolean; balance: number };
  funds: Record<string, CoverFund>;
  coverage: { grp: string; id?: string; status: 'table' | 'missing'; cells?: number; of?: number; reason?: string }[];
}

export const EFF_METHOD = 'מחיר אפקטיבי = עלות הנכות ÷ (שיעור תביעות הנכות שאושרו × שיעור תביעות הנכות שנסגרו עד 30 יום) + עלות השאירים ÷ (אותו דבר לתביעות השאירים). '
  + 'השיעורים מנספח ב3 של החברה המנהלת ל-2025 (דיווח עצמי, ברמת החברה ולא הקרן, כולל תביעות שהכיסוי אינו חב בהן, בלי סכומים). '
  + 'זה תיאור של שני נתונים שפורסמו זה לצד זה, לא דירוג ולא המלצה: מחיר נמוך יותר אינו "טוב יותר".';
export const SEX_HE: Record<CSex, string> = { m: 'גבר', f: 'אישה' };

/** the fund whose bylaws were read, for a company group (null when none) */
export const coverFundOf = (c: CoversFile | null | undefined, grp: string): [string, CoverFund] | null => {
  const e = Object.entries(c?.funds ?? {}).find(([, f]) => f.grp === grp);
  return e ?? null;
};
export const cellOf = (f: CoverFund | null | undefined, sex: CSex, age: number): CoverCell | null => f?.cells.find((c) => c.sex === sex && c.age === age) ?? null;

export interface ClaimPair { approved: number | null; fast: number | null; n: number | null }
export interface EffRow {
  id: string; grp: string; fund: CoverFund; cell: CoverCell | null;
  raw: number | null; dis: number | null; surv: number | null;
  d: ClaimPair | null; s: ClaimPair | null;
  effDis: number | null; effSurv: number | null; eff: number | null;
  /** factor the raw price is multiplied by (eff ÷ raw), or null */
  mult: number | null;
  why: string | null;
}
const pair = (x: { approved: number | null; closed: (number | null)[]; n_closed?: number } | undefined): ClaimPair | null =>
  x ? { approved: x.approved, fast: x.closed?.[0] ?? null, n: x.n_closed ?? null } : null;
/** one part divided by approved × fast (shares in %); null when a share is missing or zero */
export function adjust(cost: number | null, p: ClaimPair | null): number | null {
  if (cost == null || !p || p.approved == null || p.fast == null || p.approved <= 0 || p.fast <= 0) return null;
  return cost / ((p.approved / 100) * (p.fast / 100));
}
/** every fund with a table, at one age and sex, with its claims shares and the effective price */
export function effRows(c: CoversFile | null | undefined, d: DecisionFile | null | undefined, sex: CSex, age: number): EffRow[] {
  return Object.entries(c?.funds ?? {}).map(([id, f]) => {
    const cell = cellOf(f, sex, age);
    const cl = companyOf(d, f.grp)?.claims;
    const dp = pair(cl?.disability), sp = pair(cl?.survivors);
    const dis = cell?.dis?.cost ?? null, surv = cell?.surv?.cost ?? null;
    const effDis = adjust(dis, dp), effSurv = adjust(surv, sp);
    const eff = effDis != null && effSurv != null ? effDis + effSurv : null;
    const raw = cell?.total ?? null;
    let why: string | null = null;
    if (!cell) why = 'אין תא לגיל ולמין';
    else if (raw == null) why = cell.surv_why ?? cell.dis_why ?? 'חסר חלק מהמחיר';
    else if (!cl) why = d ? claimsWhy(d, f.grp) : 'נתוני התביעות לא נטענו';
    else if (eff == null) why = 'אחד השיעורים בדוח התביעות חסר או אפס';
    return { id, grp: f.grp, fund: f, cell, raw, dis, surv, d: dp, s: sp, effDis, effSurv, eff, mult: eff != null && raw ? eff / raw : null, why };
  });
}

export type EffSort = 'raw' | 'eff' | 'dApp' | 'dFast' | 'sApp' | 'sFast' | 'grp';
/** sorted, nulls last; 'grp' alphabetical (Hebrew) */
export function sortEff(rows: EffRow[], by: EffSort, dir: 1 | -1 = 1): EffRow[] {
  const v = (r: EffRow): number | string | null => by === 'grp' ? r.grp : by === 'raw' ? r.raw : by === 'eff' ? r.eff : by === 'dApp' ? r.d?.approved ?? null : by === 'dFast' ? r.d?.fast ?? null : by === 'sApp' ? r.s?.approved ?? null : r.s?.fast ?? null;
  return [...rows].sort((a, b) => {
    const x = v(a), y = v(b);
    if (x == null && y == null) return a.grp.localeCompare(b.grp, 'he');
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y as string, 'he') : x - (y as number);
    return (c || a.grp.localeCompare(b.grp, 'he')) * dir;
  });
}

const n2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pgs = (p: number[] | undefined) => (p && p.length ? p.join(', ') : '–');
/** where the bylaws price of one cell comes from: the fund's PDF, the pages of every table, the arithmetic */
export function rawProv(c: CoversFile, f: CoverFund, cell: CoverCell, part: 'total' | 'dis' | 'surv' = 'total'): Prov {
  const who = `${f.src.fund ?? f.grp}, ${SEX_HE[cell.sex]} ${cell.age}`;
  const s = cell.surv, d = cell.dis;
  const inputs: { label: string; v: string; src?: () => Prov }[] = [];
  const page = (label: string, v: string, pg: number[] | undefined): { label: string; v: string; src: () => Prov } => ({ label, v, src: () => ({ k: 'report', title: `${label} · ${f.src.title}`, value: v, url: f.src.url, pg: pg?.[0] ?? null, doc: f.src.title, note: `עמ' ${pgs(pg)} בקובץ התקנון (מהדורת ${f.src.edition}, נקרא ${f.src.retrieved}).${f.src.kind === 'mirror' ? ` ${f.src.note ?? 'עותק של צד שלישי'}` : ''}`, srcType: 'תקנון' }) });
  if (part !== 'surv' && d) inputs.push(page('מקדם עלות נכות (כולל נכות כפולה, עד 67)', String(d.f), d.pg), { label: 'סכום נכות מבוטח ל-₪1,000 שכר', v: `₪${n2(c.dis_amount)}` });
  if (part !== 'dis' && s) {
    if (s.comb != null) inputs.push(page(`מקדם סכום בסיכון לשאירים (60/40), שנת לידה ${s.by}`, String(s.comb), s.pg_c));
    else { inputs.push(page(`מקדם סכום בסיכון לאלמן/ה, שנת לידה ${s.by}`, String(s.w), s.pg_w)); inputs.push(page('מקדם סכום בסיכון ליתומים', String(s.o), s.pg_o)); }
    inputs.push(page(`תעריף מוות ל-₪100,000 בסיכון, שנת לידה ${s.by_m ?? s.by}`, String(s.m), s.pg_m), { label: 'סכום בסיכון', v: `₪${Math.round(s.sar).toLocaleString('en-US')}` });
  }
  const v = part === 'dis' ? d?.cost : part === 'surv' ? s?.cost : cell.total;
  const formula = part === 'dis' ? 'סכום נכות מבוטח × מקדם הנכות ÷ 1,000' : part === 'surv' ? 'סכום בסיכון × תעריף המוות ÷ 100,000 (סכום בסיכון = 600 × מקדם האלמן/ה + 400 × מקדם היתומים, בלי יתרה)' : 'נכות + שאירים';
  return { k: 'calc', title: `מחיר הכיסוי לפי התקנון · ${who}`, value: v == null ? '–' : `₪${n2(v)}`, unit: 'לחודש ל-₪1,000 שכר', formula, inputs, note: `${c.standard_note}. ${c.method}` };
}
/** where the effective price comes from: the raw price and the two claim shares of each part */
export function effProv(c: CoversFile, d: DecisionFile, r: EffRow): Prov {
  const sh = (side: 'disability' | 'survivors', what: 'approved' | 'closed0') => () => claimProv(d, r.grp, side, what);
  const pc = (v: number | null | undefined) => (v == null ? '–' : `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);
  return { k: 'calc', title: `מחיר אפקטיבי · ${r.fund.src.fund ?? r.grp}, ${SEX_HE[r.cell?.sex ?? 'm']} ${r.cell?.age ?? ''}`, value: r.eff == null ? '–' : `₪${n2(r.eff)}`, unit: 'לחודש ל-₪1,000 שכר', est: true,
    formula: 'נכות ÷ (אושרו × עד 30 יום) + שאירים ÷ (אושרו × עד 30 יום)',
    inputs: [
      { label: 'עלות נכות לפי התקנון', v: r.dis == null ? '–' : `₪${n2(r.dis)}`, src: r.cell ? () => rawProv(c, r.fund, r.cell!, 'dis') : undefined },
      { label: 'תביעות נכות שאושרו', v: pc(r.d?.approved), src: sh('disability', 'approved') },
      { label: 'תביעות נכות שנסגרו עד 30 יום', v: pc(r.d?.fast), src: sh('disability', 'closed0') },
      { label: 'עלות שאירים לפי התקנון', v: r.surv == null ? '–' : `₪${n2(r.surv)}`, src: r.cell ? () => rawProv(c, r.fund, r.cell!, 'surv') : undefined },
      { label: 'תביעות שאירים שאושרו', v: pc(r.s?.approved), src: sh('survivors', 'approved') },
      { label: 'תביעות שאירים שנסגרו עד 30 יום', v: pc(r.s?.fast), src: sh('survivors', 'closed0') },
    ], note: EFF_METHOD };
}
