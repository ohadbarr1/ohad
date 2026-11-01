/* W1 · agent door: the bottom line of a head-to-head, descriptive, not advice. Who charges the least (each fee on its own, average
   actual), who has the best shared 5Y place (the section's tie band: a gap under 10bp a year is a shared place, so no single winner is
   crowned inside it), and who has the highest Sharpe as published. A fee or a Sharpe ratio ties at its published precision (2 dp).
   Tracks with no value for a measure are left out of it and counted. Pure (no React). */
import { TIE_BP, tieRanks } from './fundsTie';

export interface CmpIn { k: string; name: string; prod: string; fee: number | null; depfee: number | null; r5: number | null; sharpe: number | null }
export interface Lead { ks: string[]; v: number; of: number; missing: string[]; all: boolean }
export interface CmpSummary { fee: Lead | null; depfee: Lead | null; r5: (Lead & { gap: number | null }) | null; sharpe: Lead | null; mixed: boolean }

const r2 = (v: number) => Math.round(v * 100) / 100;
/** the rows that share the best value (lower or higher is better), at the published precision */
function best(xs: CmpIn[], val: (x: CmpIn) => number | null, low: boolean): Lead | null {
  const have = xs.filter((x) => val(x) != null && Number.isFinite(val(x)!));
  if (have.length < 2) return null;
  const vs = have.map((x) => r2(val(x)!)), b = low ? Math.min(...vs) : Math.max(...vs);
  const ks = have.filter((_, i) => vs[i] === b).map((x) => x.k);
  return { ks, v: b, of: have.length, missing: xs.filter((x) => !have.includes(x)).map((x) => x.k), all: ks.length === have.length };
}

export function compareSummary(xs: CmpIn[]): CmpSummary {
  const band = TIE_BP / 100;
  const have5 = xs.filter((x) => x.r5 != null);
  let r5: CmpSummary['r5'] = null;
  if (have5.length >= 2) {
    const tr = tieRanks(have5, (x) => x.r5, band);
    const ks = have5.filter((x) => tr.get(x.k)!.lo === 1).map((x) => x.k);
    const top = Math.max(...have5.map((x) => x.r5!));
    // the gap from the shared head to the best of the rest (null when every track shares the head)
    const rest = have5.filter((x) => !ks.includes(x.k)).map((x) => x.r5!);
    const headLow = Math.min(...have5.filter((x) => ks.includes(x.k)).map((x) => x.r5!));
    r5 = { ks, v: top, of: have5.length, missing: xs.filter((x) => x.r5 == null).map((x) => x.k), all: ks.length === have5.length, gap: rest.length ? headLow - Math.max(...rest) : null };
  }
  return { fee: best(xs, (x) => x.fee, true), depfee: best(xs, (x) => x.depfee, true), r5, sharpe: best(xs, (x) => x.sharpe, false), mixed: new Set(xs.map((x) => x.prod)).size > 1 };
}
