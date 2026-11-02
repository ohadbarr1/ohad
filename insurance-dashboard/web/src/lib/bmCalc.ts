/* W5 · /funds/bm, the agent's decision support for an old managers' policy: the guaranteed annuity coefficient of the policy (the
   reader's input, from the policy) against the coefficient a new pension fund would apply to the same balance (an assumption, never a
   fact: a new fund sets it at retirement, by its bylaws and the life-expectancy tables). Pure, node-testable.
   monthly annuity = balance ÷ coefficient. A lower coefficient gives a larger annuity. The new-fund default is the site's own
   (lib/retire coefOf: Bizportal, 22.07.26, at 67), so the saver's card and this page agree. */
import { coefOf, type Sex } from './retire';

export const NEW_COEF_SRC = { url: 'https://www.bizportal.co.il/longtermsavings/news/article/20036400', title: 'ביזפורטל, 22.07.26' };
/** a coefficient outside this range is a typo, not a policy (old policies run roughly 120–250; a new fund around 180–210) */
export const COEF_MIN = 80, COEF_MAX = 400;

export interface BmIn {
  /** ₪ accumulated in the policy */
  balance: number;
  /** the policy's guaranteed conversion coefficient (מקדם המרה מובטח) */
  coefG: number;
  /** the coefficient assumed for a new pension fund */
  coefNew: number;
  /** % a year from savings, optional: the policy's and the new fund's */
  fee?: number | null; feeNew?: number | null;
}
export interface BmOut {
  /** ₪ a month: guaranteed by the policy, and the new fund at the assumed coefficient */
  annG: number; annNew: number;
  /** annG − annNew (₪ a month) and the same as % of annNew */
  diff: number; pct: number;
  /** ₪ a year of fees on today's balance, when the fee is given */
  feeG: number | null; feeN: number | null;
}
export const coefOk = (c: number | null | undefined): c is number => c != null && Number.isFinite(c) && c >= COEF_MIN && c <= COEF_MAX;

export function bmCompare(i: BmIn): BmOut | null {
  if (!(i.balance > 0) || !coefOk(i.coefG) || !coefOk(i.coefNew)) return null;
  const annG = i.balance / i.coefG, annNew = i.balance / i.coefNew;
  const fee = (f: number | null | undefined) => (f != null && Number.isFinite(f) && f >= 0 && f <= 5 ? (i.balance * f) / 100 : null);
  return { annG, annNew, diff: annG - annNew, pct: (annG / annNew - 1) * 100, feeG: fee(i.fee), feeN: fee(i.feeNew) };
}

const ils = (v: number) => `${Math.round(Math.abs(v)).toLocaleString('en-US')} ש"ח`;
/** the one-line conclusion: what the two coefficients do to the same balance. Facts of the arithmetic, not advice. */
export function bmLine(o: BmOut, coefG: number, coefNew: number): string {
  if (Math.abs(o.pct) < 0.5) return `על אותה יתרה, שני המקדמים נותנים כמעט אותה קצבה חודשית (${ils(o.annG)}).`;
  return o.diff > 0
    ? `על אותה יתרה, המקדם המובטח בפוליסה (${coefG}) נותן קצבה חודשית גבוהה ב-${Math.round(o.pct)}% (${ils(o.diff)} בחודש) מהמקדם המשוער בקרן פנסיה חדשה (${coefNew}).`
    : `על אותה יתרה, המקדם המובטח בפוליסה (${coefG}) נותן קצבה חודשית נמוכה ב-${Math.round(-o.pct)}% (${ils(o.diff)} בחודש) מהמקדם המשוער בקרן פנסיה חדשה (${coefNew}).`;
}

/** the new-fund coefficient the page starts from: the site's assumption by sex (lib/retire) */
export const newCoefDefault = (sex: Sex | null) => coefOf(sex);
