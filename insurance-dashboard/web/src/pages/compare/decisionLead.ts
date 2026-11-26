/* Track compare, "להחלטה" lens (lane L3-a, D2): which cells of a decision row are marked as the row's lead. Pure, unit-tested
   (scripts/compare-decision-test.mjs).
   - A lead is judged only among tracks of one category (same product and investment track): across categories or products a lower fee
     or a higher return says nothing about the manager (spec §6.2, §6.3). Old-generation policies and missing tracks carry no group and
     are never marked.
   - Inside a group: the best value and every value within the band of it share the lead; when every value of the group is within the
     band of the best, nobody is singled out; a group of one is never marked.
   - Bands: fees and Sharpe tie at their published precision (equal values share; band ~0); returns use the section's band
     (lib/fundsTie tieBand: 0.10 points on LTM, 3Y, 5Y). */

import { roundHalf } from '../../lib/compareMonths';

export type Better = 'hi' | 'lo';
const EPS = 1e-9;

/** marks per column: true where the column leads its category's group in this row */
export function groupLead(vals: (number | null | undefined)[], groups: (string | null | undefined)[], better: Better, band = 0): boolean[] {
  const out = vals.map(() => false);
  const b = Math.max(band, 1e-6), sgn = better === 'hi' ? 1 : -1;
  const by = new Map<string, number[]>();
  vals.forEach((v, i) => { const g = groups[i]; if (g == null || v == null || !Number.isFinite(v)) return; by.set(g, [...(by.get(g) ?? []), i]); });
  by.forEach((ix) => {
    if (ix.length < 2) return;
    const s = ix.map((i) => sgn * (vals[i] as number)), best = Math.max(...s), worst = Math.min(...s);
    if (best - worst < b - EPS) return;   // all within the band: no lead
    ix.forEach((i, j) => { if (best - s[j] < b - EPS) out[i] = true; });
  });
  return out;
}

/** a signed figure with a true minus (U+2212) and its unit; "–" when missing. Rounded half-up on the decimal figure (lib/compareMonths
 *  roundHalf), the site's one rule: 8.85 reads "+8.9%" here as in the month table, "לאורך זמן", the picker and the track sheet (review B2
 *  N1: toFixed rounded the binary 8.8499… down to 8.8) */
export function signed(v: number | null | undefined, d = 1, unit = '%'): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const r = roundHalf(v, d);
  const body = Math.abs(r).toFixed(d);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${body}${unit}`;
}

/** assets in "מיליארד ש״ח", one decimal, from the file's millions */
export const billions = (m: number | null | undefined): string => (m == null || !Number.isFinite(m) ? '–' : (m / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/** months from p to asof (both yyyymm) */
export const monthsAgo = (asof: number, p: number): number => (Math.floor(asof / 100) * 12 + (asof % 100)) - (Math.floor(p / 100) * 12 + (p % 100));
/** The actuarial balance a fund last reported, from the track history (funds/<k>.json `act`, quarterly, aligned with `p`): the latest
 *  value no older than `maxAge` months before the data month (two quarters by default: a quarter is published with a lag), else null. */
export function lastAct(p: number[] | undefined, act: (number | null)[] | undefined, asof: number, maxAge = 6): { v: number; p: number } | null {
  if (!p || !act) return null;
  for (let j = Math.min(p.length, act.length) - 1; j >= 0; j--) {
    const v = act[j];
    if (v == null || !Number.isFinite(v)) continue;
    const age = monthsAgo(asof, p[j]);
    return age >= 0 && age <= maxAge ? { v, p: p[j] } : null;
  }
  return null;
}
