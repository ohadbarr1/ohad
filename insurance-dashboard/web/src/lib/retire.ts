/* The saver's shekel figures (W1 saver door): what a fee gap costs by retirement, and a rough pension estimate. Pure, node-testable.
   The arithmetic is the fees-over-a-career tool's (lib/fundsCalc.ts `career`, the /funds/tools/fees method), with the monthly deposit
   entered directly (salary = the deposit, rate = 100%): each month the deposit less the deposit fee is added, the balance grows by the
   monthly equivalent of the assumed gross return, (1 + R)^(1/12) − 1, and the accumulation fee (annual ÷ 12) comes off the balance.
   Today's ₪: divided by (1 + inflation)^(years). Every input that is not the reader's is an assumption and is labelled as one. */
import { career, type CareerOut, type FeePair } from './fundsCalc';

export interface Plan {
  /** age today and at retirement */
  age: number; retire: number;
  /** ₪ today in the product, ₪ deposited a month (all parties) */
  balance: number; monthly: number;
  /** % a year: the deposit rises by this every 12 months (nominal) */
  growth: number;
  /** gross annual return before fees, % (an assumption) */
  ret: number;
  /** inflation, % a year (an assumption) */
  infl: number;
  /** conversion coefficient: monthly pension = balance ÷ coefficient (an assumption) */
  coef: number;
}

export const RETIRE_AGE = 67;
export const AGE_DEFAULT = 38;
export const GROWTH_DEFAULT = 2;
export const INFL_DEFAULT = 2;
export const COEF_DEFAULT = 200;
/** the fallback return when the category has no 10 full years (the fees tool's default) */
export const RET_FALLBACK = 4;
/** example amounts when the reader has not entered theirs: a gross salary of 12,000 ₪ (the fees tool's default) × the deposit rate */
export const SALARY_EX = 12000;
export function exampleMonthly(prod: string): { v: number; why: string } {
  if (prod === 'פנסיה מקיפה' || prod === 'פנסיה כללית') return { v: Math.round(SALARY_EX * 0.185), why: 'שכר 12,000 ש"ח × 18.5% (עובד, מעסיק ופיצויים)' };
  if (prod === 'השתלמות') return { v: Math.round(SALARY_EX * 0.1), why: 'שכר 12,000 ש"ח × 10% (7.5% מעסיק ו-2.5% עובד)' };
  return { v: 0, why: 'בלי הפקדה חודשית (סכום חד-פעמי)' };
}
export const BALANCE_EX = 100000;

const toCareer = (p: Plan) => ({ age: p.age, retire: p.retire, salary: p.monthly, growth: p.growth, rate: 100, ret: p.ret, infl: p.infl, start: p.balance, coef: p.coef });
/** the plan run on one fee pair */
export const project = (p: Plan, f: FeePair): CareerOut => career(toCareer(p), f);

export interface FeeGap { mine: CareerOut; ref: CareerOut; years: number; balReal: number; bal: number; pensionReal: number; feesReal: number }
/** what the reader's fees cost against a reference pair, by retirement: positive = the reference leaves more money */
export function feeGap(p: Plan, mine: FeePair, ref: FeePair): FeeGap {
  const a = project(p, mine), b = project(p, ref);
  return { mine: a, ref: b, years: a.months / 12, balReal: b.balReal - a.balReal, bal: b.bal - a.bal, pensionReal: b.pensionReal - a.pensionReal, feesReal: a.feesReal - b.feesReal };
}

/** The reference pair for a fee comparison: the category median. Where the category publishes no deposit fee (השתלמות, most gemel:
 *  the regulator's AVG_DEPOSIT_FEE is empty), the reference charges none: 0% from deposits, an assumption the page labels. It never
 *  copies the reader's own deposit fee, which would hide that fee from the comparison and make a higher fee look cheaper (red team
 *  02.11.26: a 7% deposit fee shrank the gap). */
export function refPair(medFee: number | null, medDep: number | null): FeePair | null {
  if (medFee == null) return null;
  return { fee: medFee, depfee: medDep ?? 0 };
}

/** What the fees cost this year, in ₪: the balance × the accumulation fee, plus a year of deposits × the deposit fee. */
export function annualFees(balance: number, monthly: number, f: FeePair): { acc: number; dep: number; total: number } {
  const acc = balance * f.fee / 100, dep = monthly * 12 * f.depfee / 100;
  return { acc, dep, total: acc + dep };
}

/** The money in a השתלמות is free to draw after 6 years (Income Tax Ordinance 3(ה), lib/productRules): the horizon of its ₪ figure. */
export const LIQ_YEARS = 6;
/** a plan cut at a horizon of `years` from today */
export const horizon = (p: Plan, years: number): Plan => ({ ...p, retire: p.age + years });

/** The conversion coefficient by the reader's sex, at 67 (Bizportal, 22.07.26, COEF_SRC on the card): about 188 for a man with a
 *  survivors' pension, about 204 for a woman with guaranteed payments and survivors; 200 when not given. All assumptions. */
export type Sex = 'm' | 'f';
export function coefOf(sex: Sex | null | undefined): { v: number; why: string } {
  if (sex === 'm') return { v: 188, why: 'גבר, עם פנסיית שארים, בגיל 67 (ביזפורטל)' };
  if (sex === 'f') return { v: 204, why: 'אישה, עם הבטחת תשלומים ושארים, בגיל 67 (ביזפורטל)' };
  return { v: COEF_DEFAULT, why: 'הנחה עגולה' };
}

/** Israel's statutory retirement age (W5, red team 3): 67 for men; for women, by birth date, rising from 62 (born to 12/1959) through
 *  62 and 4 months (1960) … 64 and 9 months (1969) to 65 for women born in 1970 and later (the 2021 amendment, in force from 01/2022).
 *  Source: Kol Zchut "גיל פרישה" (table checked 02.11.26, page updated 01.10.26) and the National Insurance circular 1632 (2021–2022
 *  legislation). The birth year is estimated as this year − age (an assumption that can be a year off); the reader can change the age. */
export const KZ_RETIRE = 'https://www.kolzchut.org.il/he/%D7%92%D7%99%D7%9C_%D7%A4%D7%A8%D7%99%D7%A9%D7%94';
const WOMEN: [number, number][] = [[1959, 62], [1960, 62 + 4 / 12], [1961, 62 + 8 / 12], [1962, 63], [1963, 63.25], [1964, 63.5], [1965, 63.75], [1966, 64], [1967, 64.25], [1968, 64.5], [1969, 64.75]];
export function retireAgeOf(sex: Sex | null | undefined, age: number, year = new Date().getFullYear()): { v: number; why: string } {
  if (sex === 'f') {
    const by = year - age;
    const row = by >= 1970 ? null : WOMEN.find(([y]) => by <= y) ?? WOMEN[WOMEN.length - 1];
    const v = row ? row[1] : 65;
    return { v, why: `גיל הפרישה בחוק לאישה ילידת ${by} בערך` };
  }
  if (sex === 'm') return { v: RETIRE_AGE, why: 'גיל הפרישה בחוק לגבר' };
  return { v: RETIRE_AGE, why: 'הנחה: גיל הפרישה לגבר; לאישה 62 עד 65 לפי שנת הלידה' };
}
/** a retirement age as words: 65, or 64 ו-9 חודשים */
export const ageText = (a: number) => { const y = Math.floor(a + 1e-9), m = Math.round((a - y) * 12); return m ? `${y} ו-${m} חודשים` : String(y); };

/** a ₪ amount, rounded to the nearest 1,000 when large (an estimate should not look precise) */
export function ilsRound(v: number): string {
  const a = Math.abs(v), r = a >= 100000 ? Math.round(a / 1000) * 1000 : a >= 10000 ? Math.round(a / 100) * 100 : Math.round(a / 10) * 10;
  return `${v < 0 ? '−' : ''}${r.toLocaleString('en-US')} ש"ח`;
}
export const ils0 = (v: number) => `${Math.round(v).toLocaleString('en-US')} ש"ח`;
