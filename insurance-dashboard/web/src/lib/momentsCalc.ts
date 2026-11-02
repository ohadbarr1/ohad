/* W9 saver · the arithmetic of the moment pages, on the site's own engines: lib/retire `project` (the fees tool's career method),
   lib/coef `coefFor` (the fund's own coefficient from its bylaws), lib/deposits `expectedOf` (the statutory and usual rates), lib/nyud
   `allocOf` and lib/fundsTools (the default-fund tender in force and its price). No new model: each function only arranges those for
   one question. Every figure is an estimate on stated assumptions, and the pages label it so. Pure, node-testable. */
import { project, type Plan } from './retire';
import type { FeePair } from './fundsCalc';
import { expectedOf, HISH_CAP_MONTHLY, HISH_RATES, PENSION_RATES, type Expected, type Rates } from './deposits';
import { allocOf } from './nyud';
import { priceOf, tenderAt, tendersOf, type DefaultFile, type Tender, type Winner } from './fundsTools';

/* ---------- leaving a job: severance ---------- */
/** the severance exemption per year of work, 2026 (the Tax Authority's 2026 booklet, ch. ג; lib/productRules RULE.pension) */
export const SEV_EXEMPT_YEAR = 13750;
/** the 2026 exemption basket (9,430 × 57.5% × 180) and the factor exempt grants reduce it by (form 161ד guide, pp. 4 and 6) */
export const BASKET_2026 = 976005;
export const GRANT_FACTOR = 1.35;
export interface SevOut { exempt: number; taxable: number; basketCut: number; pensionCut: number | null }
/** a severance withdrawal: the exempt part (the cap × years of work), the part above it, what the exempt part takes off the exemption
 *  basket at retirement (× 1.35, before indexation), and the monthly pension it would have bought (`plan` from the age today to the
 *  retirement age, no deposits, the fund's fees; ÷ the coefficient) */
export function severance(amount: number, years: number, plan?: Plan, fees?: FeePair, coef?: number): SevOut {
  const a = Math.max(0, amount), exempt = Math.min(a, Math.max(0, years) * SEV_EXEMPT_YEAR);
  const grow = plan && fees && coef && plan.retire > plan.age ? project({ ...plan, balance: a, monthly: 0 }, fees).balReal / coef : null;
  return { exempt, taxable: a - exempt, basketCut: Math.min(BASKET_2026, exempt * GRANT_FACTOR), pensionCut: grow };
}

/* ---------- השתלמות: what a withdrawal costs ---------- */
/** the withholding rate on an early השתלמות withdrawal (the Tax Authority's 2026 booklet, ch. ז; Kol Zchut) */
export const HISH_WITHHOLD = 47;
/** the capital-gains rate on a real gain, as Kol Zchut states it for gains above the ceiling (and as a taxable account would pay) */
export const CGT = 25;
/** the employer's share of the usual השתלמות deposit, 7.5 of 10 (lib/deposits HISH_RATES): an assumption about the reader's deposits */
export const EMPLOYER_SHARE = HISH_RATES.employer / (HISH_RATES.employer + HISH_RATES.employee);

export interface HishIn { balance: number; fee: number; years: number; ret: number; infl: number }
export interface HishOut {
  /** management fees this year, ₪ */
  feeYear: number;
  /** the balance after `years` more years, today's ₪, with no new deposits */
  keepReal: number;
  /** its real gain over the balance today, today's ₪ */
  gainReal: number;
  /** what the same real gain would pay in capital-gains tax outside the fund (the exemption's worth), today's ₪ */
  taxSaved: number;
  /** an early withdrawal: the withholding, between the lower bound (only the employer's share and the gains; the gains assumed nil)
   *  and the upper bound (the whole balance) */
  early: { lo: number; hi: number };
}
export function hishCost(i: HishIn): HishOut {
  const B = Math.max(0, i.balance), n = Math.max(0, Math.round(i.years));
  const plan: Plan = { age: 40, retire: 40 + n, balance: B, monthly: 0, growth: 0, ret: i.ret, infl: i.infl, coef: 200 };
  const out = n > 0 ? project(plan, { fee: i.fee, depfee: 0 }) : null;
  const keepReal = out ? out.balReal : B;
  const gainReal = Math.max(0, keepReal - B);
  return { feeYear: B * i.fee / 100, keepReal, gainReal, taxSaved: gainReal * CGT / 100,
    early: { lo: B * EMPLOYER_SHARE * HISH_WITHHOLD / 100, hi: B * HISH_WITHHOLD / 100 } };
}

/* ---------- a raise: what the deposit should become ---------- */
export interface RaiseRow { kind: 'pension' | 'hishtalmut'; rates: Rates; now: Expected | null; next: Expected; delta: number | null;
  /** the monthly deposit the reader entered for the product, and the gap to what the current salary owes (positive: less than owed) */
  entered: number | null; gap: number | null }
/** the deposit each product owes at the new salary (and at the current one when known), against the reader's entered deposit */
export function raiseRows(salaryNow: number | null, salaryNew: number, prods: { kind: 'pension' | 'hishtalmut'; monthly: number | null; rates?: Rates | null }[]): RaiseRow[] {
  return prods.map((p) => {
    const rates = p.rates ?? (p.kind === 'pension' ? { ...PENSION_RATES } : { ...HISH_RATES });
    const now = salaryNow != null && salaryNow > 0 ? expectedOf(salaryNow, rates, p.kind) : null;
    const next = expectedOf(salaryNew, rates, p.kind);
    const gap = now && p.monthly != null ? Math.round(now.total - p.monthly) : null;
    return { kind: p.kind, rates, now, next, delta: now ? next.total - now.total : null, entered: p.monthly, gap };
  });
}
export { HISH_CAP_MONTHLY };

/* ---------- near 60: retiring at 62 / 65 / 67 ---------- */
export const RETIRE_AGES = [62, 65, 67];
export interface RetireRow { age: number; balReal: number; coef: number; real: boolean; pension: number }
/** the balance at each retirement age (today's ₪) on the reader's plan, divided by the coefficient `coefAt` gives for that age */
export function retireRows(plan: Plan, fees: FeePair, coefAt: (age: number) => { v: number; real: boolean }, ages = RETIRE_AGES): RetireRow[] {
  return ages.filter((a) => a > plan.age).map((a) => {
    const out = project({ ...plan, retire: a }, fees);
    const c = coefAt(a);
    return { age: a, balReal: out.balReal, coef: c.v, real: c.real, pension: out.balReal / c.v };
  });
}

/* ---------- the default fund by the ID's check digit ---------- */
export interface DefaultPick {
  tender: Tender;
  /** the winners the reader may land in: one by the digit (an employer of 50 and more), all of them (a smaller employer) */
  winners: Winner[];
  /** the allocation rule as the tender states it (null: the tender has none) */
  rule: string | null;
  big: boolean; digit: number | null;
}
/** The tender in force at `asof` (yyyymm) and the winner its mechanism assigns to `digit` at an employer of 50 and more; at a smaller
 *  employer, every winner (the employer declares one; no allocation by digit). Null when the file has no tender. */
export function defaultFor(d: DefaultFile | null | undefined, asof: number, digit: number | null, big: boolean): DefaultPick | null {
  const t = tenderAt(tendersOf(d), asof);
  if (!t) return null;
  const alloc = allocOf(t.alloc);
  const rule = t.alloc ? t.alloc.split(':').slice(1).join(':').split(';')[0].trim() : null;
  if (!big) return { tender: t, winners: t.winners, rule, big, digit };
  if (digit == null || !alloc.size) return { tender: t, winners: [], rule, big, digit };
  const grp = alloc.get(digit);
  return { tender: t, winners: t.winners.filter((w) => w.grp === grp), rule, big, digit };
}
/** a winner's price pair (its own, else the tender's) */
export function pairOf(t: Tender, w?: Winner): FeePair | null {
  const p = priceOf(t, w);
  return p.fee != null && p.depfee != null ? { fee: p.fee, depfee: p.depfee } : null;
}
/** the ID digit the reader types: the last digit only (a whole ID is never kept) */
export const digitOf = (s: string): number | null => { const d = s.replace(/\D/g, ''); return d ? Number(d[d.length - 1]) : null; };
