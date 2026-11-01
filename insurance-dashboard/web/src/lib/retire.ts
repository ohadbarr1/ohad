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

/** the reference pair for a fee comparison: the category median, with the reader's own deposit fee where the category publishes none */
export function refPair(mine: FeePair, medFee: number | null, medDep: number | null): FeePair | null {
  if (medFee == null) return null;
  return { fee: medFee, depfee: medDep ?? mine.depfee };
}

/** a ₪ amount, rounded to the nearest 1,000 when large (an estimate should not look precise) */
export function ilsRound(v: number): string {
  const a = Math.abs(v), r = a >= 100000 ? Math.round(a / 1000) * 1000 : a >= 10000 ? Math.round(a / 100) * 100 : Math.round(a / 10) * 10;
  return `${v < 0 ? '−' : ''}${r.toLocaleString('en-US')} ש"ח`;
}
export const ils0 = (v: number) => `${Math.round(v).toLocaleString('en-US')} ש"ח`;
