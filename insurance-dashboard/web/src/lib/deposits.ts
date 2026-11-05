/* W7 saver · the deposit watchdog: the 12 rows of the annual statement's table ה' (or the clearing-house file's deposit rows) against
   the deposit the employer owes each month, in plain figures: months with nothing, months with less (and how much), the total in ₪,
   deposits that reached the fund late, and a ready-to-copy letter to the employer. Pure, node-testable (tests/deposits.unit.ts).

   The expected deposit (the saver may edit the rates on the card):
   - Pension: the statutory minimum since the January 2017 salary under the extension orders (צו ההרחבה לביטוח פנסיוני מקיף במשק, 2008,
     and צו הרחבה בדבר הגדלת ההפרשות לביטוח פנסיוני במשק, 2016): 6% employee + 6.5% employer + 6% severance = 18.5% of the insured
     salary. The order computes the minimum on the base salary (no overtime) or the national average wage, the lower (13,769 ₪ in 2026);
     many agreements insure the whole salary, and the saver's statement says which. Severance may be 8.33% (full severance in place of
     the statutory 6%) when the employer completes it. Source: Kol Zchut, "חובת ביטוח פנסיוני לעובדים" (read 02.11.26).
   - השתלמות: no statutory duty; where agreed, the usual 2.5% employee + 7.5% employer, tax-exempt up to a monthly salary of 15,712 ₪
     (188,544 ₪ a year, 2026; lib/productRules RULE.hishtalmut). Source: Kol Zchut, "קרן השתלמות"; the Tax Authority's 2026 booklet.
   The deadline: 7 business days from the salary payment or 15 days from the end of the salary month, the earlier (תקנות הפיקוח על
   שירותים פיננסיים (קופות גמל) (תשלומים לקופת גמל), התשע"ד-2014, reg. 10; Kol Zchut, "העברת כספים לביטוח פנסיוני ולקרן השתלמות על ידי
   המעסיק"). Knowing only the salary month, the watchdog marks a deposit late when it reached the fund after the 15th of the following
   month, the latest date the rule allows. Late deposits owe the fund arrears interest from the 16th of the following month.
   Complaints about an employer that does not deposit: מינהל הסדרה ואכיפת חוקי עבודה במשרד העבודה (hotline 1-800-354-354); about the fund
   itself: היחידה לפניות הציבור ברשות שוק ההון, ביטוח וחיסכון (*3002). */
import type { DepositRow } from './clientTypes';

export interface Rates { employee: number; employer: number; severance: number }
export type DepKind = 'pension' | 'hishtalmut';
/** the statutory minimum since the January 2017 salary (percent of the insured salary) */
export const PENSION_RATES: Rates = { employee: 6, employer: 6.5, severance: 6 };
/** full severance (1/12 of the monthly salary) when the employer completes it */
export const SEVERANCE_FULL = 8.33;
export const PENSION_SINCE = '01/2017';
/** the national average wage the order caps the minimum at (2026, Kol Zchut) */
export const AVG_WAGE = 13769;
/** השתלמות, the usual agreed rates (no statutory duty) */
export const HISH_RATES: Rates = { employee: 2.5, employer: 7.5, severance: 0 };
/** השתלמות: the monthly salary up to which the deposit is tax-exempt (2026) */
export const HISH_CAP_MONTHLY = 15712;
export const RATES_YEAR = 2026;
/** the latest day of the following month the deposit may reach the fund */
export const DEADLINE_DAY = 15;

export interface DepSrc { title: string; url: string }
export const SRC = {
  order: { title: 'כל זכות: חובת ביטוח פנסיוני לעובדים (צו ההרחבה לביטוח פנסיוני מקיף במשק; צו הרחבה בדבר הגדלת ההפרשות, 2016)', url: 'https://www.kolzchut.org.il/he/%D7%97%D7%95%D7%91%D7%AA_%D7%91%D7%99%D7%98%D7%95%D7%97_%D7%A4%D7%A0%D7%A1%D7%99%D7%95%D7%A0%D7%99_%D7%9C%D7%A2%D7%95%D7%91%D7%93%D7%99%D7%9D' },
  transfer: { title: 'כל זכות: העברת כספים לביטוח פנסיוני ולקרן השתלמות על ידי המעסיק (תקנות התשלומים לקופת גמל, התשע"ד-2014)', url: 'https://www.kolzchut.org.il/he/%D7%94%D7%A2%D7%91%D7%A8%D7%AA_%D7%9B%D7%A1%D7%A4%D7%99%D7%9D_%D7%9C%D7%91%D7%99%D7%98%D7%95%D7%97_%D7%A4%D7%A0%D7%A1%D7%99%D7%95%D7%A0%D7%99_%D7%95%D7%9C%D7%A7%D7%A8%D7%9F_%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA_%D7%A2%D7%9C_%D7%99%D7%93%D7%99_%D7%94%D7%9E%D7%A2%D7%A1%D7%99%D7%A7' },
  hish: { title: 'כל זכות: קרן השתלמות (2.5% עובד, 7.5% מעסיק, תקרת שכר 15,712 ש"ח לחודש ב-2026)', url: 'https://www.kolzchut.org.il/he/%D7%A7%D7%A8%D7%9F_%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA' },
  complain: { title: 'משרד העבודה, מינהל הסדרה ואכיפת חוקי עבודה: הגשת תלונה על מעסיק (מוקד 1-800-354-354, לפי כל זכות)', url: 'https://www.gov.il/he/service/work-rights-violation-complaints' },
  authority: { title: 'כל זכות: הגשת תלונה ליחידה לפניות הציבור ברשות שוק ההון, ביטוח וחיסכון (על הקרן, לא על המעסיק; מוקד *3002)', url: 'https://www.kolzchut.org.il/he/%D7%94%D7%92%D7%A9%D7%AA_%D7%AA%D7%9C%D7%95%D7%A0%D7%94_%D7%90%D7%95_%D7%A4%D7%A0%D7%99%D7%99%D7%94_%D7%9C%D7%99%D7%97%D7%99%D7%93%D7%94_%D7%9C%D7%A4%D7%A0%D7%99%D7%95%D7%AA_%D7%94%D7%A6%D7%99%D7%91%D7%95%D7%A8_%D7%91%D7%A8%D7%A9%D7%95%D7%AA_%D7%A9%D7%95%D7%A7_%D7%94%D7%94%D7%95%D7%9F_%D7%91%D7%A2%D7%A0%D7%99%D7%99%D7%A0%D7%99_%D7%91%D7%99%D7%98%D7%95%D7%97,_%D7%92%D7%9E%D7%9C_%D7%95%D7%A4%D7%A0%D7%A1%D7%99%D7%94' },
} satisfies Record<string, DepSrc>;
export const COMPLAIN_BODY = 'מינהל הסדרה ואכיפת חוקי עבודה במשרד העבודה';
export const COMPLAIN_PHONE = '1-800-354-354';

/** which products the watchdog reads, and their default rates */
export function kindOf(prod: string): DepKind | null {
  if (prod === 'פנסיה מקיפה' || prod === 'פנסיה כללית') return 'pension';
  if (prod === 'השתלמות') return 'hishtalmut';
  return null;
}
export const defaultRates = (kind: DepKind): Rates => (kind === 'pension' ? { ...PENSION_RATES } : { ...HISH_RATES });
export const rateTotal = (r: Rates) => r.employee + r.employer + r.severance;

export interface Expected { employee: number; employer: number; severance: number; total: number; base: number; capped: boolean }
/** the deposit a month owes on a salary: each part × its rate; השתלמות capped at the tax-exempt salary */
export function expectedOf(salary: number, rates: Rates, kind: DepKind): Expected {
  const cap = kind === 'hishtalmut' ? HISH_CAP_MONTHLY : null;
  const base = cap != null ? Math.min(salary, cap) : salary;
  const part = (p: number) => Math.round((base * p) / 100 * 100) / 100;
  const employee = part(rates.employee), employer = part(rates.employer), severance = part(rates.severance);
  return { employee, employer, severance, total: employee + employer + severance, base, capped: cap != null && salary > cap };
}

/** what a row carries: the itemised parts when any is given, else the stated total; null when the row says nothing */
export function rowTotal(r: DepositRow): number | null {
  const parts = [r.employee, r.employer, r.severance].filter((x): x is number => x != null && Number.isFinite(x));
  if (parts.length) return parts.reduce((s, x) => s + x, 0);
  return r.total != null && Number.isFinite(r.total) ? r.total : null;
}

/* ---- months ---- */
const YM = /^(\d{4})-(\d{2})$/;
export const validYm = (s: unknown): s is string => typeof s === 'string' && YM.test(s) && +s.slice(5, 7) >= 1 && +s.slice(5, 7) <= 12;
export function addMonths(ym: string, n: number): string {
  const t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
/** 'YYYY-MM' → 'MM/YYYY' */
export const ymHe = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
/** 'YYYY-MM-DD' → 'DD.MM.YYYY' */
export const dateHe = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
/** the `n` months ending at `last` (the latest valid row, else the month before `today`) */
export function monthsWindow(rows: DepositRow[], n = 12, today = new Date()): string[] {
  const yms = rows.map((r) => r.ym).filter(validYm).sort();
  const last = yms.length ? yms[yms.length - 1] : addMonths(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`, -1);
  return Array.from({ length: n }, (_, i) => addMonths(last, i - (n - 1)));
}
/** the last date the deposit for a salary month may reach the fund: the 15th of the following month */
export const deadlineOf = (ym: string) => `${addMonths(ym, 1)}-${String(DEADLINE_DAY).padStart(2, '0')}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/* ---- the audit ---- */
export type Status = 'ok' | 'short' | 'missing' | 'over';
export interface MonthAudit {
  ym: string; rows: DepositRow[];
  /** what reached the fund for the month (all rows), null when nothing */
  got: number | null;
  /** the deposit owed; `salary`: the base it used (the row's own when stated) */
  exp: Expected; salary: number;
  /** owed minus received, when positive beyond the tolerance */
  gap: number; status: Status;
  /** the latest payment date among the rows, and how many days after the deadline (0 when in time) */
  paid: string | null; lateDays: number;
}
export interface Audit {
  months: MonthAudit[]; missing: MonthAudit[]; short: MonthAudit[]; late: MonthAudit[];
  totalGot: number; totalExp: number; totalGap: number;
  /** months with any row */
  n: number; kind: DepKind; rates: Rates; salary: number; tol: number;
}
export interface AuditOpts { months?: string[]; tol?: number }
/** `tol`: a gap this small (₪) is rounding, not a shortfall; default 1% of the month's expected deposit, at least 20 ₪ */
export function auditDeposits(rows: DepositRow[], salary: number, rates: Rates, kind: DepKind, o: AuditOpts = {}): Audit {
  const valid = rows.filter((r) => r && validYm(r.ym));
  const months = o.months ?? monthsWindow(valid);
  const out: MonthAudit[] = months.map((ym) => {
    const rs = valid.filter((r) => r.ym === ym);
    const totals = rs.map(rowTotal).filter((x): x is number => x != null);
    const got = totals.length ? totals.reduce((s, x) => s + x, 0) : null;
    const rowSal = rs.map((r) => r.salary).find((x): x is number => x != null && Number.isFinite(x) && x > 0);
    const sal = rowSal ?? salary;
    const exp = expectedOf(sal, rates, kind);
    const tol = o.tol ?? Math.max(20, exp.total * 0.01);
    const diff = exp.total - (got ?? 0);
    const status: Status = got == null ? 'missing' : diff > tol ? 'short' : diff < -tol ? 'over' : 'ok';
    const paids = rs.map((r) => r.paid).filter((p): p is string => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p)).sort();
    const paid = paids.length ? paids[paids.length - 1] : null;
    const lateDays = paid ? Math.max(0, daysBetween(deadlineOf(ym), paid)) : 0;
    return { ym, rows: rs, got, exp, salary: sal, gap: status === 'missing' || status === 'short' ? Math.round(diff) : 0, status, paid, lateDays };
  });
  const missing = out.filter((m) => m.status === 'missing'), short = out.filter((m) => m.status === 'short'), late = out.filter((m) => m.lateDays > 0);
  return { months: out, missing, short, late, totalGot: out.reduce((s, m) => s + (m.got ?? 0), 0), totalExp: out.reduce((s, m) => s + m.exp.total, 0),
    totalGap: out.reduce((s, m) => s + m.gap, 0), n: out.filter((m) => m.rows.length).length, kind, rates, salary, tol: o.tol ?? -1 };
}

/* ---- the letter ---- */
const ils = (v: number) => `${Math.round(v).toLocaleString('en-US')} ש"ח`;
const pc = (v: number) => `${v % 1 === 0 ? v : v.toFixed(2).replace(/0+$/, '')}%`;
export interface LetterIn { fund: string; prod: string; id?: number | null; third?: boolean }
/** A plain letter to the employer: the months and amounts, the duty the order and the regulations set, the request, and where a
 *  complaint goes. Facts and figures only; the saver checks it against the statement before sending.
 *  S1 (fox 3.0): always in the first person, which Hebrew does not gender ("אבקש", "אפנה"), so no "החוסך/ת" and no slashes: the
 *  letter is sent by the person whose savings these are, also for a household profile (`third` is kept for callers, and ignored). */
export function letterOf(a: Audit, s: LetterIn): string {
  const my = 'שלי';
  const out: string[] = ['שלום,'];
  out.push(`לפי הדוח השנתי של ${s.fund}${s.id ? ` (מספר קופה ${s.id})` : ''}, ${s.prod === 'השתלמות' ? 'קרן ההשתלמות' : 'קרן הפנסיה'} ${my}, בדקתי את ההפקדות של ${a.months.length} החודשים ${ymHe(a.months[0].ym)}–${ymHe(a.months[a.months.length - 1].ym)}.`);
  if (a.missing.length) out.push(`חודשים שבהם לא נמצאה הפקדה: ${a.missing.map((m) => ymHe(m.ym)).join(', ')}.`);
  if (a.short.length) out.push(`חודשים שבהם ההפקדה נמוכה מהצפוי: ${a.short.map((m) => `${ymHe(m.ym)}: הופקדו ${ils(m.got ?? 0)} במקום כ-${ils(m.exp.total)} (חסרים כ-${ils(m.gap)})`).join('; ')}.`);
  if (a.totalGap > 0) out.push(`סך ההפרש: כ-${ils(a.totalGap)}.`);
  if (a.late.length) out.push(`הפקדות שהגיעו לקרן באיחור: ${a.late.map((m) => `${ymHe(m.ym)} הגיעה ב-${dateHe(m.paid!)} (${m.lateDays} ימים אחרי ה-${DEADLINE_DAY} בחודש העוקב)`).join('; ')}.`);
  if (!a.missing.length && !a.short.length && !a.late.length) out.push('כל ההפקדות נמצאו בסכום הצפוי ובמועד.');
  const r = a.rates;
  if (a.kind === 'pension') {
    out.push(`הסכום הצפוי מחושב לפי שכר מבוטח של ${ils(a.salary)} לחודש: ${pc(r.employee)} עובד, ${pc(r.employer)} מעסיק ו-${pc(r.severance)} פיצויים (${pc(rateTotal(r))} בסך הכול), ${rateTotal(r) === rateTotal(PENSION_RATES) ? 'המינימום לפי' : 'לפי ההסכם, ולא פחות מהמינימום של'} צו ההרחבה לביטוח פנסיוני מקיף במשק (18.5% ממשכורת ינואר 2017).`);
  } else {
    out.push(`הסכום הצפוי מחושב לפי שכר של ${ils(a.salary)} לחודש: ${pc(r.employee)} עובד ו-${pc(r.employer)} מעסיק (${pc(rateTotal(r))}), כפי שסוכם${a.months.some((m) => m.exp.capped) ? `, עד תקרת השכר של ${ils(HISH_CAP_MONTHLY)} לחודש` : ''}.`);
  }
  out.push(`לפי תקנות הפיקוח על שירותים פיננסיים (קופות גמל) (תשלומים לקופת גמל), התשע"ד-2014, על המעסיק להעביר את ההפקדות עד 7 ימי עסקים ממועד תשלום המשכורת או עד 15 יום מתום החודש, המוקדם מביניהם; על איחור מגיעה לקופה ריבית פיגורים מה-16 בחודש העוקב.`);
  if (a.missing.length || a.short.length || a.late.length) out.push(`אבקש להעביר את ההפקדות החסרות בצירוף הריבית, ולשלוח לי אישור על ההעברה. אם ההפקדות לא יושלמו, אפנה ל${COMPLAIN_BODY} (מוקד ${COMPLAIN_PHONE}).`);
  out.push('תודה,');
  return out.join('\n');
}

/** one line for the folded card: how many months are missing or short, and the ₪ */
export function depSummary(a: Audit): string | null {
  const n = a.missing.length + a.short.length;
  if (!n && !a.late.length) return null;
  const bits: string[] = [];
  if (n) bits.push(`${n === 1 ? 'חודש אחד חסר או חלקי' : `${n} חודשים חסרים או חלקיים`}, כ-${ils(a.totalGap)}`);
  if (a.late.length) bits.push(`${a.late.length === 1 ? 'הפקדה אחת הגיעה באיחור' : `${a.late.length} הפקדות הגיעו באיחור`}`);
  return bits.join('; ');
}
