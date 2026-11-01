/* The funds tools' arithmetic (wave F2, TOOLS): pure functions, no React, no fetch, so the unit test runs them in node.
   - Hindsight ("מה היה לי", plan #8): a deposit history run through a track's published monthly returns.
   - Fees over a career (plan #7): a salary path, a deposit rate, a fee from deposit and a fee from accumulation, a return assumption.
   - Small statistics: quantiles, a place among peers, a money-weighted (internal) rate of return, a median.
   Months are yyyymm numbers; returns and fees are in percent, as the regulator publishes them. */

/* ---------- months ---------- */
export const addM = (p: number, d: number) => { const t = Math.floor(p / 100) * 12 + (p % 100 - 1) + d; return Math.floor(t / 12) * 100 + (t % 12) + 1; };
/** months from `a` to `b`, both included (empty when b < a) */
export function monthsFromTo(a: number, b: number): number[] {
  const out: number[] = [];
  for (let p = a; p <= b && out.length < 1200; p = addM(p, 1)) out.push(p);
  return out;
}
export const monthDiff = (a: number, b: number) => (Math.floor(b / 100) - Math.floor(a / 100)) * 12 + (b % 100) - (a % 100);
export const validYm = (p: number) => Number.isInteger(p) && p % 100 >= 1 && p % 100 <= 12 && p > 190000 && p < 210000;

/* ---------- a deposit plan ---------- */
export interface DepPlan {
  /** 'm': a monthly amount from `start` to `end`; 'l': one lump sum in `start` */
  mode: 'm' | 'l';
  start: number;
  end: number;
  /** ₪ a month (mode m) or the lump sum (mode l) */
  amount: number;
  /** % a year: the monthly amount rises by this every 12 months from the start */
  raise: number;
  /** more one-off deposits [yyyymm, ₪] */
  extra?: [number, number][];
}
/** The deposits of a plan, month by month. Month i (0 = start) deposits amount × (1 + raise)^⌊i/12⌋. */
export function deposits(plan: DepPlan): Map<number, number> {
  const out = new Map<number, number>();
  if (!validYm(plan.start) || !validYm(plan.end) || plan.end < plan.start || !(plan.amount >= 0)) return out;
  if (plan.mode === 'l') out.set(plan.start, plan.amount);
  else monthsFromTo(plan.start, plan.end).forEach((p, i) => out.set(p, plan.amount * (1 + plan.raise / 100) ** Math.floor(i / 12)));
  for (const [p, a] of plan.extra ?? []) if (validYm(p) && p >= plan.start && p <= plan.end && a > 0) out.set(p, (out.get(p) ?? 0) + a);
  return out;
}
export const totalOf = (dep: Map<number, number>) => [...dep.values()].reduce((s, x) => s + x, 0);

/* ---------- hindsight: one track ---------- */
export interface RunOpts {
  start: number;
  end: number;
  /** % of each deposit taken as the deposit fee */
  depfee: number;
  /** returns used when the track has none: after it closed (its money moved on) or a month missing inside its life. Usually the
   *  category's asset-weighted average of the same month. */
  fill?: Map<number, number | null>;
}
export interface Run {
  bal: number;
  /** ₪ deposited (before the deposit fee) */
  dep: number;
  /** ₪ of deposit fees */
  depFee: number;
  months: number;
  /** months inside the track's life with no return, filled from `fill` */
  filled: number;
  /** months after the track's last month, run on `fill` */
  after: number;
  /** months with no return at all (neither the track nor the fill): counted as 0% */
  zero: number;
  /** the track's last month when it ends before `end` */
  closedAt: number | null;
  /** balance at the end of each month of the window */
  path: number[];
}
/** Runs deposits through a track: each month, the deposit (less the deposit fee) is added at the start of the month and the whole
 *  balance earns that month's return. A track born after `start`, or already closed by then, could not have been chosen: null. */
export function runTrack(p: number[], r: (number | null)[], dep: Map<number, number>, o: RunOpts): Run | null {
  if (!p.length || p[0] > o.start) return null;
  const last = (() => { for (let i = p.length - 1; i >= 0; i--) if (r[i] != null) return p[i]; return p[0]; })();
  if (last < o.start) return null;
  const at = new Map(p.map((x, i) => [x, r[i]]));
  let bal = 0, dsum = 0, fsum = 0, filled = 0, after = 0, zero = 0;
  const path: number[] = [];
  const ms = monthsFromTo(o.start, o.end);
  for (const m of ms) {
    const d = dep.get(m) ?? 0;
    if (d) { dsum += d; fsum += d * o.depfee / 100; bal += d * (1 - o.depfee / 100); }
    let x = m <= last ? at.get(m) ?? null : null;
    if (x == null) {
      const f = o.fill?.get(m) ?? null;
      if (m > last) after++; else filled++;
      if (f == null) zero++; else x = f;
    }
    bal *= 1 + (x ?? 0) / 100;
    path.push(bal);
  }
  return { bal, dep: dsum, depFee: fsum, months: ms.length, filled, after, zero, closedAt: last < o.end ? last : null, path };
}

/** The money-weighted annual return of a deposit stream: the monthly rate i solving Σ dₜ(1+i)^(T−t) = balance (deposits at the start
 *  of month t = 0…T−1, balance at the end of month T−1), annualised as (1+i)^12 − 1, in %. Bisection; null when it does not bracket. */
export function irr(start: number, dep: Map<number, number>, bal: number, months: number): number | null {
  const flows = [...dep].map(([p, d]) => [monthDiff(start, p), d] as [number, number]).filter(([t]) => t >= 0 && t < months);
  if (!flows.length || !(bal > 0)) return null;
  const f = (i: number) => flows.reduce((s, [t, d]) => s + d * (1 + i) ** (months - t), 0) - bal;
  let lo = -0.5, hi = 0.5;
  if (f(lo) > 0 || f(hi) < 0) return null;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  return ((1 + (lo + hi) / 2) ** 12 - 1) * 100;
}

/* ---------- distributions and places ---------- */
export function median(xs: number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b), n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
}
/** a quantile by linear interpolation between order statistics (q in 0…1) */
export function quantile(xs: number[], q: number): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b), n = s.length;
  if (!n) return null;
  const h = (n - 1) * q, lo = Math.floor(h);
  return lo + 1 < n ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
}
export interface Dist { n: number; min: number; p25: number; med: number; p75: number; max: number }
export function dist(xs: number[]): Dist | null {
  const s = xs.filter((x) => Number.isFinite(x));
  if (!s.length) return null;
  return { n: s.length, min: Math.min(...s), p25: quantile(s, 0.25)!, med: quantile(s, 0.5)!, p75: quantile(s, 0.75)!, max: Math.max(...s) };
}
/** place of `v` among `xs` (higher is better): rank 1 = best; percentile = (lower + half the ties) ÷ (n − 1) × 100 among the others */
export function placeOf(v: number, xs: number[]): { rank: number; n: number; pct: number | null } {
  const n = xs.length, above = xs.filter((x) => x > v).length, below = xs.filter((x) => x < v).length, ties = Math.max(0, n - above - below - 1);
  return { rank: above + 1, n, pct: n > 1 ? Math.round((below + ties / 2) / (n - 1) * 100) : null };
}

/** compounded annual return of the last n monthly returns, % (null when one is missing) */
export function annualised(y: (number | null)[], n: number): number | null {
  if (y.length < n) return null;
  let f = 1;
  for (const r of y.slice(-n)) { if (r == null) return null; f *= 1 + r / 100; }
  return (f ** (12 / n) - 1) * 100;
}

/* ---------- fees over a career ---------- */
export interface Career {
  /** age today and at retirement, years */
  age: number;
  retire: number;
  /** gross monthly salary today, ₪ */
  salary: number;
  /** % a year, nominal: the salary rises every 12 months */
  growth: number;
  /** % of salary deposited (employee + employer + severance) */
  rate: number;
  /** gross annual return before fees, % (an assumption) */
  ret: number;
  /** inflation, % a year (an assumption): turns future ₪ into today's ₪ */
  infl: number;
  /** balance today, ₪ */
  start: number;
  /** conversion coefficient: monthly pension = balance ÷ coefficient (an assumption) */
  coef: number;
}
export interface FeePair { depfee: number; fee: number }
export interface CareerOut {
  months: number;
  bal: number; balReal: number;
  dep: number;
  depFees: number; accFees: number; fees: number; feesReal: number;
  pension: number; pensionReal: number;
}
/** Month by month: deposit = salary × rate; the deposit fee comes off the deposit; the balance grows by the monthly equivalent of the
 *  gross annual return, (1 + R)^(1/12) − 1; the accumulation fee (annual % ÷ 12) comes off the balance at the end of the month.
 *  Today's ₪: divided by (1 + inflation)^(months ÷ 12). */
export function career(c: Career, f: FeePair): CareerOut {
  const months = Math.max(0, Math.round((c.retire - c.age) * 12));
  const rm = (1 + c.ret / 100) ** (1 / 12) - 1, fm = f.fee / 100 / 12, im = (1 + c.infl / 100) ** (1 / 12);
  let bal = c.start, dep = 0, depFees = 0, accFees = 0, feesReal = 0, defl = 1;
  for (let i = 0; i < months; i++) {
    defl *= im;
    const d = c.salary * (1 + c.growth / 100) ** Math.floor(i / 12) * c.rate / 100, df = d * f.depfee / 100;
    dep += d; depFees += df;
    bal = (bal + d - df) * (1 + rm);
    const af = bal * fm;
    bal -= af; accFees += af;
    feesReal += (df + af) / defl;
  }
  const balReal = bal / defl;
  return { months, bal, balReal, dep, depFees, accFees, fees: depFees + accFees, feesReal, pension: bal / c.coef, pensionReal: balReal / c.coef };
}
/** a deposit-fee × accumulation-fee grid of outcomes */
export function feeGrid(c: Career, deps: number[], accs: number[]): CareerOut[][] {
  return deps.map((d) => accs.map((a) => career(c, { depfee: d, fee: a })));
}
