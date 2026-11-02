/* The saver's numbers for one product of "המוצרים שלי", and the strip at the top of /my that adds them up (W4 saver, red team 02.11.26).
   Pure, node-testable: the card (components/saver/ProductCard) and the strip (pages/My) read the same figures, so they never disagree.
   Inputs that are not the reader's are assumptions and say so (`ex*` flags); nothing here recommends a product. */
import type { FeePair } from './fundsCalc';
import type { DefaultFile } from './fundsTools';
import { isPension, verdictOf, type DecLite, type MyFees, type VFund, type Verdict } from './verdict';
import { AGE_DEFAULT, BALANCE_EX, GROWTH_DEFAULT, INFL_DEFAULT, LIQ_YEARS, RETIRE_AGE, annualFees, exampleMonthly, feeGap, horizon, project, refPair, type FeeGap, type Plan } from './retire';
import type { CareerOut } from './fundsCalc';

export interface MyIn extends MyFees { balance?: number | null; monthly?: number | null }
export interface CalcOpts { age: number; coef: number; ret: number }
export interface CardCalc {
  v: Verdict; plan: Plan;
  /** the fee pair used: the reader's own where entered, else the track's average */
  mine: FeePair; ownAny: boolean; exBalance: boolean; exMonthly: boolean; exWhy: string;
  /** the category median pair; `med0`: the category publishes no deposit fee, and the reference assumes 0% */
  med: FeePair | null; med0: boolean; gMed: FeeGap | null;
  /** the default-fund pairs the tender allows, and the one that leaves the most money on these assumptions */
  tPairs: FeePair[]; tBest: { p: FeePair; g: FeeGap } | null;
  out: CareerOut;
  annual: { acc: number; dep: number; total: number };
  /** השתלמות: the same gaps at the 6-year liquidity horizon */
  liq: { years: number; gMed: FeeGap | null } | null;
}

export const clampAge = (a: number | null | undefined) => Math.min(Math.max(a || AGE_DEFAULT, 16), RETIRE_AGE - 1);

export function cardCalc(f: VFund, all: VFund[], asof: number, dfile: DefaultFile | null | undefined, my: MyIn | null | undefined, dec: DecLite | null | undefined, o: CalcOpts): CardCalc {
  const v = verdictOf(f, all, asof, dfile, my, dec);
  const ex = exampleMonthly(f.prod);
  const exBalance = my?.balance == null, exMonthly = my?.monthly == null;
  const plan: Plan = { age: clampAge(o.age), retire: RETIRE_AGE, balance: my?.balance ?? BALANCE_EX, monthly: my?.monthly ?? ex.v, growth: GROWTH_DEFAULT, ret: o.ret, infl: INFL_DEFAULT, coef: o.coef };
  const mine: FeePair = { fee: v.fee.v ?? 0, depfee: v.dep?.v ?? f.depfee ?? 0 };
  const ownAny = v.fee.own || !!v.dep?.own;
  const medDep = v.dep?.med ?? null;
  const med = refPair(v.fee.med, medDep);
  const gMed = med ? feeGap(plan, mine, med) : null;
  const tPairs: FeePair[] = v.dflt && v.dflt.fee != null && v.dflt.depfee != null ? [{ fee: v.dflt.fee, depfee: v.dflt.depfee }, ...(v.dflt.tender.fee_alt ?? [])] : [];
  const tBest = tPairs.length ? tPairs.map((p) => ({ p, g: feeGap(plan, mine, p) })).sort((a, b) => b.g.balReal - a.g.balReal)[0] : null;
  const liq = f.prod === 'השתלמות' ? { years: LIQ_YEARS, gMed: med ? feeGap(horizon(plan, LIQ_YEARS), mine, med) : null } : null;
  return { v, plan, mine, ownAny, exBalance, exMonthly, exWhy: ex.why, med, med0: med != null && medDep == null, gMed, tPairs, tBest, out: project(plan, mine),
    annual: annualFees(plan.balance, plan.monthly, mine), liq };
}

/** the gap a product's fees leave against the closest reference, at its own horizon (השתלמות: 6 years), and what it is against */
export function gapOf(c: CardCalc): { v: number; ref: 'med' | 'dflt'; years: number } | null {
  const opts: { v: number; ref: 'med' | 'dflt'; years: number }[] = [];
  if (c.liq) { if (c.liq.gMed && c.liq.gMed.balReal > 0) opts.push({ v: c.liq.gMed.balReal, ref: 'med', years: c.liq.years }); }
  else {
    if (c.gMed && c.gMed.balReal > 0) opts.push({ v: c.gMed.balReal, ref: 'med', years: c.gMed.years });
    if (c.tBest && c.tBest.g.balReal > 0) opts.push({ v: c.tBest.g.balReal, ref: 'dflt', years: c.tBest.g.years });
  }
  // the median first when both: it is the comparison every product has; the default-fund terms are for new members only
  return opts.find((x) => x.ref === 'med') ?? opts[0] ?? null;
}

export interface SumRow { k: string; name: string; prod: string; c: CardCalc }
export interface Summary {
  /** this year's fees in ₪, all products; `ex`: at least one balance or deposit is an example, `avg`: at least one fee is the track's average */
  fees: number; feesEx: boolean; feesAvg: boolean;
  /** the monthly pension estimate from the pension funds, today's ₪, and how many funds it adds up */
  pension: number | null; penN: number; penEx: boolean;
  /** the single most valuable descriptive action */
  act: { kind: 'fee'; k: string; name: string; prod: string; v: number; ref: 'med' | 'dflt'; years: number; own: boolean } | { kind: 'enter'; k: string; name: string } | { kind: 'none' };
}

export function summaryOf(rows: SumRow[]): Summary {
  const fees = rows.reduce((s, r) => s + r.c.annual.total, 0);
  const pens = rows.filter((r) => isPension(r.prod) || r.prod === 'פנסיה כללית');
  const pension = pens.length ? pens.reduce((s, r) => s + r.c.out.pensionReal, 0) : null;
  const gaps = rows.map((r) => ({ r, g: gapOf(r.c) })).filter((x): x is { r: SumRow; g: NonNullable<ReturnType<typeof gapOf>> } => !!x.g).sort((a, b) => b.g.v - a.g.v);
  const top = gaps[0];
  const noFees = rows.find((r) => !r.c.v.fee.own);
  const act: Summary['act'] = top ? { kind: 'fee', k: top.r.k, name: top.r.name, prod: top.r.prod, v: top.g.v, ref: top.g.ref, years: top.g.years, own: top.r.c.v.fee.own }
    : noFees ? { kind: 'enter', k: noFees.k, name: noFees.name } : { kind: 'none' };
  return { fees, feesEx: rows.some((r) => r.c.exBalance || r.c.exMonthly), feesAvg: rows.some((r) => !r.c.v.fee.own || (r.c.v.dep != null && !r.c.v.dep.own && (r.c.v.dep.v ?? 0) > 0)),
    pension, penN: pens.length, penEx: pens.some((r) => r.c.exBalance || r.c.exMonthly), act };
}
