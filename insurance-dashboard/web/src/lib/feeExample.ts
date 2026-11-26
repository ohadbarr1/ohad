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

/** The reader's own amounts in place of the example (approved O9, lane L2-b): a balance, and a monthly deposit (null: the product's
 *  example deposit). */
export interface FeeBase { balance: number; monthly: number | null }

/** The example's parts for one track. `deposits` false: the balance only. A missing deposit fee counts as 0 (gemel lehashkaa
 *  publishes none); a missing accumulation fee makes the total null. `base`: the reader's own balance and deposit (O9). */
export function feeParts(f: FeeF, deposits = true, base?: FeeBase | null): FeeParts {
  const ex = exampleMonthly(f.prod), own = base?.monthly != null;
  const monthly = deposits ? (own ? base!.monthly! : ex.v) : 0, balance = base?.balance ?? BALANCE_EX;
  const acc = ((f.fee ?? 0) / 100) * balance, dep = ((f.depfee ?? 0) / 100) * monthly * 12;
  return { balance, monthly, why: deposits ? (own ? 'ההפקדה החודשית שלך' : ex.why) : 'בלי הפקדות', acc, dep, total: f.fee == null ? null : Math.round((acc + dep) / 10) * 10 };
}
/** `fee% × 100,000 + depfee% × exampleMonthly(prod) × 12`, rounded to 10 ₪; null when the track publishes no accumulation fee. */
export const feeCost = (f: FeeF, deposits = true, base?: FeeBase | null): number | null => feeParts(f, deposits, base).total;

/* ---- the fee row and the fee sheet together (lane L2-b): one function, so the table's row and the sheet always agree ---- */

/** A product the reader holds (lib/mine MyProduct, structurally: kept free of React for the node test). `fee` / `depfee` are the
 *  reader's own fees from their statement or the clearing-house import, percent. */
export interface OwnFee { k: string; fee?: number | null; depfee?: number | null; balance?: number | null; monthly?: number | null }
export interface FeeCol { k: string; parts: FeeParts; cost: number | null; own: boolean; fee: number | null; depfee: number | null }
export interface FeeTable { cols: FeeCol[]; ring: number[]; base: FeeBase | null; deposits: boolean }

/** The fee of every track on screen, in column order. Approved O9: when the reader holds one of the tracks and their own fee is known
 *  ("לפי הדוח שלך"), that track is costed with their fee and deposit fee, and every track is costed on the reader's balance and monthly
 *  deposit (when they gave them); the other tracks keep their published average fees. Else the example for everyone. */
export function feeTable(funds: (FeeF & { k: string } | null | undefined)[], deposits = true, mine: OwnFee[] = []): FeeTable {
  const ks = new Set(funds.map((f) => f?.k));
  const ownOf = (k: string) => mine.find((m) => m.k === k && m.fee != null && Number.isFinite(m.fee));
  const first = funds.map((f) => (f ? ownOf(f.k) : undefined)).find(Boolean);
  const base: FeeBase | null = first && first.balance != null && first.balance > 0 && ks.has(first.k) ? { balance: first.balance, monthly: first.monthly != null && first.monthly >= 0 ? first.monthly : null } : null;
  const cols = funds.flatMap((f) => {
    if (!f) return [];
    const o = ownOf(f.k), x = o ? { prod: f.prod, fee: o.fee!, depfee: o.depfee ?? f.depfee } : f;
    const parts = feeParts(x, deposits, base);
    return [{ k: f.k, parts, cost: parts.total, own: !!o, fee: x.fee, depfee: x.depfee }];
  });
  return { cols, ring: feeRing(cols.map((c) => c.cost)), base, deposits };
}

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
 *  - "דמי ניהול: הכי נמוכים אצל הראל ומגדל, כ-550 ש״ח בשנה. מנורה: כ-610." (two or more cheapest; the figure is the lowest;
 *    worded on the fees, not "X ו-Y הזולים", so no adjective agrees with a company name: coordinator, stage 2)
 *  - "דמי ניהול: כמעט זהים, כ-550 ש״ח בשנה." (every cost inside the tie)
 *  - one cheapest (not in 6.1; worded on the fees, so no adjective agrees with a company name): "דמי ניהול: הכי נמוכים אצל הראל, כ-550 ש״ח בשנה. מנורה: כ-610."
 *  Costs above the tie follow cheapest first, one clause each. Rows without a cost are left out; null when none has one. */
export function feeSentence(rows: { label: string; cost: number | null }[]): string | null {
  const r = rows.filter((x): x is { label: string; cost: number } => x.cost != null).sort((a, b) => a.cost - b.cost);
  if (!r.length) return null;
  const lo = r[0].cost, low = r.filter((x) => x.cost - lo < FEE_TIE), rest = r.filter((x) => x.cost - lo >= FEE_TIE);
  if (!rest.length) return `דמי ניהול: ${r.length > 1 ? 'כמעט זהים, ' : ''}כ-${ils(lo)} ש״ח בשנה.`;
  const head = `הכי נמוכים אצל ${list(low.map((x) => x.label))}`;
  return `דמי ניהול: ${head}, כ-${ils(lo)} ש״ח בשנה. ${rest.map((x) => `${x.label}: כ-${ils(x.cost)}.`).join(' ')}`;
}
