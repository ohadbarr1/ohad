/* The legal ceilings on management fees (תקנות הפיקוח על שירותים פיננסיים (קופות גמל) (דמי ניהול), התשע"ב-2012), as Kol Zchut sets
   them out (checked 02.11.26, KZ_CAPS): a new comprehensive pension fund up to 6% of each deposit and 0.5% a year of the savings; a new
   general pension fund up to 4% and 1.05%; provident funds (gemel, השתלמות, גמל להשקעה) and managers' insurance up to 4% and 1.05%
   (1.05% from 01.01.2014). Kol Zchut's page for גמל להשקעה states the same 4% / 1.05% and cites section 2(a) of the regulations.
   A fee the reader types above the ceiling is not a fee anyone may charge: it is a typing slip, and the form says so instead of
   computing with it. Products the page does not cover (pure savings policies, a child's savings plan, central severance funds) get a
   loose sanity bound, labelled as such, not a legal claim. Pure, node-testable. */

export const KZ_CAPS = 'https://www.kolzchut.org.il/he/%D7%90%D7%99%D7%A1%D7%95%D7%A8_%D7%92%D7%91%D7%99%D7%99%D7%AA_%D7%93%D7%9E%D7%99_%D7%A0%D7%99%D7%94%D7%95%D7%9C_%D7%97%D7%A9%D7%91%D7%95%D7%9F_%D7%91%D7%99%D7%98%D7%95%D7%97_%D7%A4%D7%A0%D7%A1%D7%99%D7%95%D7%A0%D7%99_%D7%9E%D7%A2%D7%9C_%D7%94%D7%AA%D7%A7%D7%A8%D7%94_%D7%94%D7%9E%D7%A7%D7%A1%D7%99%D7%9E%D7%9C%D7%99%D7%AA';
export const KZ_CAPS_GEMEL = 'https://www.kolzchut.org.il/he/%D7%93%D7%9E%D7%99_%D7%A0%D7%99%D7%94%D7%95%D7%9C_%D7%91%D7%A7%D7%95%D7%A4%D7%AA_%D7%92%D7%9E%D7%9C_%D7%9C%D7%94%D7%A9%D7%A7%D7%A2%D7%94';
export const CAPS_REG = 'תקנות הפיקוח על שירותים פיננסיים (קופות גמל) (דמי ניהול), התשע"ב-2012';

export interface FeeCap { depfee: number; fee: number; legal: boolean; what: string }
const PEN_COMP: FeeCap = { depfee: 6, fee: 0.5, legal: true, what: 'קרן פנסיה מקיפה' };
const PEN_GEN: FeeCap = { depfee: 4, fee: 1.05, legal: true, what: 'קרן פנסיה כללית' };
const GEMEL: FeeCap = { depfee: 4, fee: 1.05, legal: true, what: 'קופות גמל, קרנות השתלמות וביטוח מנהלים' };
/** not covered by the page: a bound for typing slips only */
const LOOSE: FeeCap = { depfee: 6, fee: 2, legal: false, what: '' };

/** the ceiling for a product of funds.json (`prod`) */
export function capOf(prod: string): FeeCap {
  if (prod === 'פנסיה מקיפה') return PEN_COMP;
  if (prod === 'פנסיה כללית') return PEN_GEN;
  if (prod === 'גמל' || prod === 'השתלמות' || prod === 'גמל להשקעה' || /^ביטוחי מנהלים/.test(prod)) return GEMEL;
  return LOOSE;
}

/** null when the value is allowed; else the inline error, in plain Hebrew. `calc`: the fee tool, which computes with the ceiling instead */
export function feeError(prod: string, which: 'fee' | 'depfee', v: number | null | undefined, calc = false): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < 0) return 'דמי ניהול לא יכולים להיות שליליים.';
  const c = capOf(prod), max = which === 'fee' ? c.fee : c.depfee;
  if (v <= max + 1e-9) return null;
  const part = which === 'fee' ? 'מהצבירה' : 'מכל הפקדה';
  if (calc) return c.legal ? `מעל התקרה: ב${c.what} החוק מתיר עד ${max}% ${part}. החישוב לפי ${max}%.` : `${v}% ${part} גבוה מאוד ונראה כמו טעות הקלדה. החישוב לפי ${max}%.`;
  return c.legal
    ? `לא נשמר: ב${c.what} החוק מתיר עד ${max}% ${part}. כדאי לבדוק שוב בדוח (אולי נקודה עשרונית).`
    : `לא נשמר: ${v}% ${part} גבוה מאוד ונראה כמו טעות הקלדה. כדאי לבדוק שוב בדוח.`;
}
