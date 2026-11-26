/* Track compare, "לאורך זמן" (C8, spec 4.7): the numbers behind <CompareLong>. Pure, node-tested (scripts/compare-long-test.mjs).
   - The period ("שנה אחרונה | 3 שנים | 5 שנים"; agent and Pro add YTD) picks the figure of every row, the sentence and the chart window together,
     so a tap on "שנה אחרונה" can never leave the board unchanged (regression of the old "1Y changes nothing").
   - Figures are the site's published ones (lib/funds retOf: gross, as the regulator publishes, before fees), the category
     average is compounded from funds/cat.json (lib/compareMonths periodRow). Places and ties: lib/pageMonths placeGroups (the screener's, the hub's and the card's ranking) on the period's band. */
import type { Basis, CatX, FundX, HistX, Per } from './funds';
import { growth, onAxis, retOf, underwater } from './funds';
import { cum, periodRow, seriesOf } from './compareMonths';
import { addMonths } from './market';
import { rankText, tieBand } from './fundsTie';
import { placeGroups } from './pageMonths';   // P6 R2: the one site-wide ranking

export type LongPer = Extract<Per, 'ytd' | 'y12' | 'a3' | 'a5'>;
export type LongMode = 'g' | 'd';   // growth of 100 | how far below the peak

export const SAVER_PERS: [LongPer, string][] = [['y12', 'שנה אחרונה'], ['a3', '3 שנים'], ['a5', '5 שנים']];
export const FULL_PERS: [LongPer, string][] = [['ytd', 'YTD'], ['y12', 'LTM'], ['a3', '3Y'], ['a5', '5Y']];
export const DEFAULT_LONG: LongPer = 'a5';
/** the unit line under a row's figure */
export const PER_UNIT: Record<LongPer, string> = { ytd: 'מתחילת השנה', y12: 'בשנה האחרונה', a3: 'בשנה, בממוצע', a5: 'בשנה, בממוצע' };

/** the periods a door offers */
export const persOf = (saver: boolean) => (saver ? SAVER_PERS : FULL_PERS);
/** the period of the URL (`per`), within what the door offers; else 5 years */
export function perFrom(q: string | null | undefined, saver: boolean): LongPer {
  return persOf(saver).some(([p]) => p === q) ? (q as LongPer) : DEFAULT_LONG;
}
/** months in the chart's window (a return window; the axis has one more point, the base) */
export const windowMonths = (per: LongPer, asof: number): number => (per === 'ytd' ? Math.max(1, asof % 100) : per === 'y12' ? 12 : per === 'a3' ? 36 : 60);
/** the chart's axis, oldest first: the base month (end of the month before the window) and then each month of the window */
export const windowAxis = (per: LongPer, asof: number): number[] => {
  const n = windowMonths(per, asof);
  return Array.from({ length: n + 1 }, (_, i) => addMonths(asof, i - n));
};

type V = number | null;
/** One value per fund for the period, and the category's: the same figures as the rest of the site. */
export function periodFigures(funds: (FundX | null | undefined)[], basis: Basis, per: LongPer, asof: number, cat?: CatX | null): { vals: V[]; avg: V } {
  if (per !== 'ytd') { const r = periodRow(funds, basis, per, { cat, asof }); return { vals: r.vals, avg: r.avg }; }
  const vals = funds.map((f) => (f ? retOf(f, 'ytd', basis).v : null));
  let avg: V = null;
  if (cat) {
    const s = cat.y, n = windowMonths('ytd', asof);
    avg = cum(Array.from({ length: n }, (_, i) => { const j = cat.p.indexOf(addMonths(asof, -i)); return j < 0 ? null : s[j] ?? null; }));
  }
  return { vals, avg };
}
/** how many tracks the category's average covers in `asof` (`n`); null when unknown */
export function catCount(cat: CatX | null | undefined, _basis: Basis, asof: number): number | null {
  if (!cat) return null;
  const s = cat.n, j = cat.p.indexOf(asof);
  const v = s && j >= 0 ? s[j] : null;
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

export interface BoardIn { k: string; label: string; value: V }
export interface BoardOut { k: string; label: string; value: V; place: string | null; tie: boolean }
/** The rows in the order to show. Same category: best first (a missing figure last), each with its place and, when it shares one, the
 *  "almost equal" flag; ties keep the order chosen. Different risk levels (`cross`): the order chosen, no places. */
export function boardRows(rows: BoardIn[], per: LongPer, asof: number, cross: boolean): BoardOut[] {
  if (cross) return rows.map((r) => ({ ...r, place: null, tie: false }));
  const pl = placeGroups(rows.map((r) => r.value), tieBand(per, asof)), tr = new Map(rows.map((r, i) => [r.k, pl[i]] as const));
  const order = rows.map((r, i) => ({ r, i })).sort((a, b) => (b.r.value ?? -Infinity) - (a.r.value ?? -Infinity) || a.i - b.i);
  return order.map(({ r }) => {
    const t = tr.get(r.k);
    return { ...r, place: t && t.place != null && t.lo != null && t.hi != null && t.n > 1 ? rankText({ lo: t.lo, hi: t.hi }) : null, tie: !!t && t.shared };
  });
}

/** Track labels for a board and a legend: the company ("מגדל"); the same company twice: with the track ("מגדל כללי", "מגדל מניות") or, when
 *  the track is the same too, with the name's own tail. */
export function labelsOf(fs: Pick<FundX, 'k' | 'grp' | 'track' | 'name' | 'prod'>[]): string[] {
  const co = (g: string) => g.replace(/ מבטחים$/, '');   // "מנורה מבטחים" reads "מנורה" (as the sentences and the mockup)
  return fs.map((f) => {
    const same = fs.filter((x) => x.grp === f.grp), g = co(f.grp);
    if (same.length < 2) return g;
    if (new Set(same.map((x) => `${x.prod}|${x.track}`)).size === same.length) return `${g} ${same.every((x) => x.prod === f.prod) ? f.track : `${f.prod} ${f.track}`}`.trim();
    const tail = f.name.replace(f.grp, '').replace(/^[\s\-–·]+/, '').trim();
    return tail ? `${g} ${tail}` : `${g} ${f.k}`;
  });
}

/* ---------- chart ---------- */

/** The plotted series of a track on the axis: growth of 100 from the base month, or the fall from the running peak (0 at a new high). */
export function chartSeries(axis: number[], h: HistX, basis: Basis, mode: LongMode): V[] {
  const y = onAxis(axis, h.p, seriesOf(h, basis));
  return mode === 'g' ? growth(axis, y) : [0, ...underwater(y.slice(1))];
}
/** The readout line over the chart for the axis point `j` (the last point when nothing is touched). `ym` formats a month ("10/21"). */
export function readoutTitle(mode: LongMode, axis: number[], j: number, ym: (p: number) => string): string {
  const last = axis.length - 1, j2 = Math.max(0, Math.min(last, j));
  if (mode === 'g') {
    if (j2 === last) return `100 ש״ח שהושקעו בסוף ${ym(axis[0])} שווים היום:`;
    if (j2 === 0) return `100 ש״ח בסוף ${ym(axis[0])}, נקודת ההתחלה:`;
    return `100 ש״ח מסוף ${ym(axis[0])}, בסוף ${ym(axis[j2])}:`;
  }
  return j2 === 0 ? `נקודת ההתחלה, ${ym(axis[0])}:` : j2 === last ? `היום, ${ym(axis[j2])}, המרחק מהשיא:` : `המרחק מהשיא, ${ym(axis[j2])}:`;
}

/** The worst month and the deepest fall (from the running peak) over the last `n` months of a series; for the rows across risk levels. */
export function riskOf(h: HistX, basis: Basis, asof: number, n = 60): { worst: number; worstP: number; dd: number } | null {
  const y = seriesOf(h, basis), ms = Array.from({ length: n }, (_, i) => addMonths(asof, -(n - 1 - i)));
  let worst = Infinity, worstP = 0, idx = 1, peak = 1, dd = 0, got = 0;
  for (const p of ms) {
    const i = h.p.indexOf(p), r = i < 0 ? null : y[i];
    if (r == null) continue;
    got++;
    if (r < worst) { worst = r; worstP = p; }
    idx *= 1 + r / 100; peak = Math.max(peak, idx); dd = Math.min(dd, idx / peak - 1);
  }
  return got < 3 ? null : { worst, worstP, dd: dd * 100 };
}
