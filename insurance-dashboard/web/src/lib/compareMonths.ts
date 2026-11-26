/* Track compare, month vs month (redesign F1): the numbers behind <MonthGrid> — tracks in columns, months (or calendar years) in rows,
   newest first, with the summary rows "חצי שנה" and "שנה אחרונה", the row's lead inside the tie band and the heat scale. Pure, node-tested
   (scripts/compare-months-test.mjs, fixtures P3 = p2102, p2172, p2009 at 10/26).
   - Sources. A month is the regulator's published monthly return of the track (`funds/<k>.json` `y`, gross, before fees: owner
     26.11.26, no net-of-fee basis anywhere). The category average is `funds/cat.json` `y`: asset-weighted over the tracks that were in
     the category that month (point-in-time membership, closed tracks included), `n` of them.
   - Summary rows. "חצי שנה" and calendar years are compounded here from the monthly series; "שנה אחרונה" is the published LTM of
     funds.json (`f.y12`), so it matches the rest of the site to the decimal. A track missing any month of a window gets
     null for that window, never a shorter window shown as if full.
   - Values are returned unrounded; the display rounds (two decimals for a month, one for a window). `rowLead` / `rowMarks` take the
     display precision so the mark matches the figures the reader sees. */
import type { Basis, CatX, FundX, HistX, Per } from './funds';
import { retOf } from './funds';
import { addMonths } from './market';
import { TIE_BP, TIE_M1 } from './fundsTie';

type V = number | null;

/** One month row: `p` = yyyymm; `vals` in column order; `avg` = category average that month (null without cat data); `avgN` = tracks
 *  in that average; `spread` = highest − lowest of the row's values (null with fewer than two). */
export interface MonthRow { p: number; vals: V[]; avg: V; avgN: number | null; spread: V }
/** One calendar-year row: `yr`; `last` = the last month counted (yyyymm); `months` = months in the row (12, or the current year's
 *  months to date); `part` = the year is not complete ("2026 / עד אוק׳"). A track without all `months` months gets null. */
export interface YearRow { yr: number; last: number; months: number; part: boolean; vals: V[]; avg: V; spread: V }
/** A summary row under the grid ("חצי שנה", "שנה אחרונה", "3 שנים, בשנה", "5 שנים, בשנה"): one value per column and the category's. */
export interface SumRow { key: 'half' | 'y12' | 'a3' | 'a5'; vals: V[]; avg: V }

export interface GridOpts {
  /** the category of the columns in `funds/cat.json` (for `avg`); omit or null: no average */
  cat?: CatX | null;
  /** the newest month (funds.json `asof`); default: the newest month in any of the histories */
  asof?: number;
}

/* ---------- series ---------- */

/** The monthly series of a history: the published gross `y`. */
export function seriesOf(h: HistX, _basis: Basis = 'gross'): V[] {
  return h.y;
}
/** the category's monthly average (gross `y`) */
const catSeries = (c: CatX, _basis: Basis): V[] => c.y;
/** value of a month in a series, null when the month is not published */
function at(p: number[], y: V[], m: number): V {
  const i = p.indexOf(m);
  return i < 0 ? null : y[i] ?? null;
}
const newest = (hists: (HistX | null | undefined)[]) => Math.max(0, ...hists.map((h) => (h?.p.length ? h.p[h.p.length - 1] : 0)));
/** the months of a window, newest first */
const back = (asof: number, n: number) => Array.from({ length: n }, (_, i) => addMonths(asof, -i));

/** Compounded return of monthly % returns: (∏(1 + r/100) − 1) × 100. Null when the list is empty or any month is missing. */
export function cum(vals: V[]): V {
  if (!vals.length || vals.some((v) => v == null)) return null;
  return (vals.reduce<number>((f, v) => f * (1 + v! / 100), 1) - 1) * 100;
}
/** highest − lowest of the non-null values; null with fewer than two */
export function spreadOf(vals: V[]): V {
  const s = vals.filter((v): v is number => v != null);
  return s.length < 2 ? null : Math.max(...s) - Math.min(...s);
}

/* ---------- rows ---------- */

/** The `n` newest months, newest first, one value per history (column order kept; a missing history is a column of nulls). */
export function monthRows(hists: (HistX | null | undefined)[], basis: Basis, n: number, o: GridOpts = {}): MonthRow[] {
  const asof = o.asof ?? newest(hists);
  if (!asof || n <= 0) return [];
  const ser = hists.map((h) => (h ? seriesOf(h, basis) : null)), cs = o.cat ? catSeries(o.cat, basis) : null;
  const cn = o.cat ? o.cat.n : null;
  return back(asof, n).map((p) => {
    const vals = hists.map((h, i) => (h ? at(h.p, ser[i]!, p) : null));
    const avg = o.cat && cs ? at(o.cat.p, cs, p) : null;
    const avgN = avg != null && o.cat && cn ? (at(o.cat.p, cn, p) as number | null) : null;
    return { p, vals, avg, avgN, spread: spreadOf(vals) };
  });
}

/** The `n` newest calendar years, newest first; the current year runs January to `asof` (`part`). Each value compounds the year's
 *  months of that track; a track without every one of them gets null. */
export function yearRows(hists: (HistX | null | undefined)[], basis: Basis, n: number, o: GridOpts = {}): YearRow[] {
  const asof = o.asof ?? newest(hists);
  if (!asof || n <= 0) return [];
  const ser = hists.map((h) => (h ? seriesOf(h, basis) : null)), cs = o.cat ? catSeries(o.cat, basis) : null;
  const y0 = Math.floor(asof / 100), out: YearRow[] = [];
  for (let yr = y0; yr > y0 - n; yr--) {
    const last = yr === y0 ? asof : yr * 100 + 12, months = last % 100;
    const ms = Array.from({ length: months }, (_, i) => yr * 100 + i + 1);
    const vals = hists.map((h, i) => (h ? cum(ms.map((m) => at(h.p, ser[i]!, m))) : null));
    const avg = o.cat && cs ? cum(ms.map((m) => at(o.cat!.p, cs, m))) : null;
    out.push({ yr, last, months, part: months < 12, vals, avg, spread: spreadOf(vals) });
  }
  return out;
}
/** How many calendar years of history the columns have, newest first: the years in which at least one track has a full year (or the
 *  current partial year). For "עוד שנים ▾": min(12, this). */
export function yearsAvailable(hists: (HistX | null | undefined)[], basis: Basis, o: GridOpts = {}): number {
  const asof = o.asof ?? newest(hists), first = Math.min(...hists.filter((h): h is HistX => !!h?.p.length).map((h) => h.p[0]));
  if (!asof || !Number.isFinite(first)) return 0;
  const rs = yearRows(hists, basis, Math.floor(asof / 100) - Math.floor(first / 100) + 1, o);
  let k = 0;
  while (k < rs.length && rs[k].vals.some((v) => v != null)) k++;
  return k;
}

/* ---------- summary rows ---------- */

/** "חצי שנה": the last six months compounded, per track, and the category's average compounded the same way. */
export function halfYear(hists: (HistX | null | undefined)[], basis: Basis, o: GridOpts = {}): SumRow {
  const rows = monthRows(hists, basis, 6, o);
  return { key: 'half', vals: hists.map((_, i) => cum(rows.map((r) => r.vals[i]))), avg: o.cat ? cum(rows.map((r) => r.avg)) : null };
}
/** A published window of funds.json per track (lib/funds retOf: `f[per]`, gross). `avg`: the category's monthly average compounded over the window (annualised for 3Y and 5Y),
 *  computed here, null without cat data or when a month is missing. */
export function periodRow(funds: (FundX | null | undefined)[], basis: Basis, per: Extract<Per, 'y12' | 'a3' | 'a5'>, o: GridOpts = {}): SumRow {
  const vals = funds.map((f) => (f ? retOf(f, per, basis).v : null));
  let avg: V = null;
  if (o.cat && o.asof) {
    const n = per === 'y12' ? 12 : per === 'a3' ? 36 : 60, c = cum(back(o.asof, n).map((m) => at(o.cat!.p, catSeries(o.cat!, basis), m)));
    avg = c == null ? null : per === 'y12' ? c : ((1 + c / 100) ** (12 / n) - 1) * 100;
  }
  return { key: per, vals, avg };
}
/** "שנה אחרונה": the published LTM (`f.y12`). */
export const lastYear = (funds: (FundX | null | undefined)[], basis: Basis, o: GridOpts = {}): SumRow => periodRow(funds, basis, 'y12', o);

/* ---------- marks ---------- */

/** The tie band of a row kind, percentage points: a month 0.05 (lib/fundsTie TIE_M1, O4); "חצי שנה", a calendar year, LTM, 3Y and
 *  5Y 0.10 (TIE_BP: annual figures). The half year is a 6-month cumulative figure; it takes the annual band (a presentation choice). */
export function rowBand(kind: 'month' | 'half' | 'year' | 'y12' | 'a3' | 'a5'): number {
  return kind === 'month' ? TIE_M1 : TIE_BP / 100;
}
/** half-up (away from zero) to `d` decimals, safe for binary floats: 8.85 → 8.9, −0.745 → −0.75 */
export function roundHalf(v: number, d: number): number {
  const k = 10 ** d;
  return (Math.sign(v) * Math.round(Math.abs(v) * k + 1e-9)) / k;
}
/** Indexes of the values inside the band of the row's highest (gap < band; the highest included). `dec`: compare the values as
 *  displayed (rounded half-up to `dec` decimals). Nulls are never in the lead. */
export function rowLead(vals: V[], band: number, dec?: number): number[] {
  const r = vals.map((v) => (v == null ? null : dec == null ? v : roundHalf(v, dec)));
  const s = r.filter((v): v is number => v != null);
  if (!s.length) return [];
  const mx = Math.max(...s);
  return r.flatMap((v, i) => (v != null && mx - v < band - 1e-9 ? [i] : []));
}
/** The cells to mark ("● הגבוה בשורה", section 6.2): `rowLead`, except that nothing is marked when fewer than two values are present or
 *  when every value is inside the band (all tied). Different risk levels: the caller does not mark at all (C5). */
export function rowMarks(vals: V[], band: number, dec?: number): number[] {
  const n = vals.filter((v) => v != null).length, lead = rowLead(vals, band, dec);
  return n < 2 || lead.length === n ? [] : lead;
}

/* ---------- heat ---------- */

/** The heat scale of the cells on screen: the 90th percentile of their absolute values (sorted ascending, the value at
 *  floor(0.9 × count)), so one extreme month does not flatten the rest. 1 when there are no values. */
export function heatScale(vals: V[]): number {
  const a = vals.filter((v): v is number => v != null).map(Math.abs).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.9))] || 1 : 1;
}
/** A cell's fill: direction (teal up, vermilion down: `--heat-up` / `--heat-down`) and opacity 0.07–0.40 by size against the scale.
 *  Zero or missing: no fill. */
export function heatFill(v: V, scale: number): { dir: 'up' | 'down' | null; a: number } {
  if (v == null || v === 0 || !(scale > 0)) return { dir: null, a: 0 };
  return { dir: v > 0 ? 'up' : 'down', a: +(0.07 + 0.33 * Math.min(1, Math.abs(v) / scale)).toFixed(2) };
}
