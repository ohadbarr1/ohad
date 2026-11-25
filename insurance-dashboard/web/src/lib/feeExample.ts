/* Track compare, the fee row and the fee sheet (redesign F4): what a track's two fees cost in shekels, on one example for everyone so
   that tracks can be compared. A first-year illustration, not a projection, and not the reader's own fee.
   - The example is lib/retire's: a balance of BALANCE_EX (100,000 ₪) and, with deposits, the product's example monthly deposit
     `exampleMonthly(prod)` (pension: salary 12,000 × 18.5% = 2,220 ₪; hishtalmut: 1,200 ₪; other products: none).
   - Cost = fee% × balance + depfee% × monthly × 12, rounded to 10 ₪ (funds.json `fee` = the track's average accumulation fee, `depfee` =
     its average deposit fee, both % a year as the regulator publishes them).
   - "Almost equal": a cost less than FEE_TIE (20 ₪) above the LOWEST cost. Measured from the lowest only, never chained: 540 / 550 / 560
     → 540 and 550 ringed, 560 not (usability round 3). */
import type { Fund } from './useData';
import { BALANCE_EX, exampleMonthly } from './retire';

/** ₪ a year under which two example costs read "כמעט שווים" (strictly less than, measured from the lowest) */
export const FEE_TIE = 20;
const LRI = '⁦', PDI = '⁩';

type FeeF = Pick<Fund, 'prod' | 'fee' | 'depfee'>;
export interface FeeParts {
  /** the example: balance ₪, monthly deposit ₪ (0 without deposits), and the deposit's wording from lib/retire */
  balance: number; monthly: number; why: string;
  /** ₪ a year, unrounded: from the balance, from the deposits, and the total rounded to 10 ₪ (null: the track publishes no fee) */
  acc: number; dep: number; total: number | null;
}

/** Does the product have an example deposit (pension, hishtalmut)? The "עם הפקדה חודשית / בלי הפקדות" switch shows only then. */
export const hasDeposit = (prod: string) => exampleMonthly(prod).v > 0;

/** The example's parts for one track. `deposits` false: the balance only. A missing deposit fee counts as 0 (gemel lehashkaa
 *  publishes none); a missing accumulation fee makes the total null. */
export function feeParts(f: FeeF, deposits = true): FeeParts {
  const ex = exampleMonthly(f.prod), monthly = deposits ? ex.v : 0;
  const acc = ((f.fee ?? 0) / 100) * BALANCE_EX, dep = ((f.depfee ?? 0) / 100) * monthly * 12;
  return { balance: BALANCE_EX, monthly, why: deposits ? ex.why : 'בלי הפקדות', acc, dep, total: f.fee == null ? null : Math.round((acc + dep) / 10) * 10 };
}
/** `fee% × 100,000 + depfee% × exampleMonthly(prod) × 12`, rounded to 10 ₪; null when the track publishes no accumulation fee. */
export const feeCost = (f: FeeF, deposits = true): number | null => feeParts(f, deposits).total;

/** Indexes of the costs less than FEE_TIE above the lowest (the lowest included). Not chained. */
export function feeLow(costs: (number | null)[], tie = FEE_TIE): number[] {
  const s = costs.filter((c): c is number => c != null);
  if (!s.length) return [];
  const lo = Math.min(...s);
  return costs.flatMap((c, i) => (c != null && c - lo < tie ? [i] : []));
}
/** The cells to ring in the fee row: `feeLow`, except nothing when fewer than two costs are present or every cost is inside the tie. */
export function feeRing(costs: (number | null)[], tie = FEE_TIE): number[] {
  const n = costs.filter((c) => c != null).length, low = feeLow(costs, tie);
  return n < 2 || low.length === n ? [] : low;
}

const ils = (v: number) => `${LRI}${v.toLocaleString('en-US')}${PDI}`;
/** "הראל ומגדל", "הראל, מגדל ומנורה" */
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ו${xs[xs.length - 1]}`);

/** The fee sentence of section 6.1, figures in LRI…PDI (components/NumText):
 *  - "דמי ניהול: הראל ומגדל הזולים, כ-550 ש״ח בשנה. מנורה: כ-610." (two or more cheapest; the figure is the lowest)
 *  - "דמי ניהול: כמעט זהים, כ-550 ש״ח בשנה." (every cost inside the tie)
 *  - one cheapest (not in 6.1; worded on the fees, so no adjective agrees with a company name): "דמי ניהול: הכי נמוכים אצל הראל, כ-550 ש״ח בשנה. מנורה: כ-610."
 *  Costs above the tie follow cheapest first, one clause each. Rows without a cost are left out; null when none has one. */
export function feeSentence(rows: { label: string; cost: number | null }[]): string | null {
  const r = rows.filter((x): x is { label: string; cost: number } => x.cost != null).sort((a, b) => a.cost - b.cost);
  if (!r.length) return null;
  const lo = r[0].cost, low = r.filter((x) => x.cost - lo < FEE_TIE), rest = r.filter((x) => x.cost - lo >= FEE_TIE);
  if (!rest.length) return `דמי ניהול: ${r.length > 1 ? 'כמעט זהים, ' : ''}כ-${ils(lo)} ש״ח בשנה.`;
  const head = low.length > 1 ? `${list(low.map((x) => x.label))} הזולים` : `הכי נמוכים אצל ${low[0].label}`;
  return `דמי ניהול: ${head}, כ-${ils(lo)} ש״ח בשנה. ${rest.map((x) => `${x.label}: כ-${ils(x.cost)}.`).join(' ')}`;
}
