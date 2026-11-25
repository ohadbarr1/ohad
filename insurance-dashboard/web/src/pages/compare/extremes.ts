/* Track compare: "החודש הכי גרוע והכי טוב ב-5 שנים" (the collapsed block under the month grid, mockup v3 #extremes). Pure, node-tested
   (scripts/compare-shell-test.mjs). Over the `n` months that end in `asof` (the track's own published months; a missing month is skipped,
   and `n` reports how many were counted): the worst and the best month, and the largest drop before it rose again (the deepest fall of
   the compounded index from its running peak, base 100 at the start of the window, with the month of the trough). Percent, unrounded. */

export interface Ext { v: number; p: number }
export interface Extremes { worst: Ext | null; best: Ext | null; mdd: Ext | null; n: number }

const back = (asof: number, n: number) => {
  const out: number[] = [];
  let y = Math.floor(asof / 100), m = asof % 100;
  for (let i = 0; i < n; i++) { out.unshift(y * 100 + m); m--; if (m === 0) { m = 12; y--; } }
  return out;
};

export function extremes(p: number[], y: (number | null)[], asof: number, n = 60): Extremes {
  const at = new Map(p.map((m, i) => [m, y[i]] as const));
  const ms = back(asof, n).filter((m) => at.get(m) != null);
  if (!ms.length) return { worst: null, best: null, mdd: null, n: 0 };
  let worst: Ext | null = null, best: Ext | null = null, mdd: Ext | null = null;
  let idx = 100, peak = 100;
  for (const m of ms) {
    const r = at.get(m)!;
    if (!worst || r < worst.v) worst = { v: r, p: m };
    if (!best || r > best.v) best = { v: r, p: m };
    idx *= 1 + r / 100; peak = Math.max(peak, idx);
    const dd = (idx / peak - 1) * 100;
    if (dd < 0 && (!mdd || dd < mdd.v)) mdd = { v: dd, p: m };
  }
  return { worst, best, mdd, n: ms.length };
}
