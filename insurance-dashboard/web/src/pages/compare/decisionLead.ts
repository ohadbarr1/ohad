/* Track compare, "להחלטה" lens (lane L3-a, D2): which cells of a decision row are marked as the row's lead. Pure, unit-tested
   (scripts/compare-decision-test.mjs).
   - A lead is judged only among tracks of one category (same product and investment track): across categories or products a lower fee
     or a higher return says nothing about the manager (spec §6.2, §6.3). Old-generation policies and missing tracks carry no group and
     are never marked.
   - Inside a group: the best value and every value within the band of it share the lead; when every value of the group is within the
     band of the best, nobody is singled out; a group of one is never marked.
   - Bands: fees and Sharpe tie at their published precision (equal values share; band ~0); returns use the section's band
     (lib/fundsTie tieBand: 0.10 points on LTM, 3Y, 5Y). */

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

/** a signed figure with a true minus (U+2212) and its unit; "–" when missing */
export function signed(v: number | null | undefined, d = 1, unit = '%'): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const r = Number(v.toFixed(d));
  const body = Math.abs(r).toFixed(d);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${body}${unit}`;
}

/** assets in "מיליארד ש״ח", one decimal, from the file's millions */
export const billions = (m: number | null | undefined): string => (m == null || !Number.isFinite(m) ? '–' : (m / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
