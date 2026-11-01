/* The funds module, wave F2 "time" (funds plan #10 map, #11 rank over time, #12 persistence view, #13 quilt, #15 glide paths, #23 watchlist,
   and the risk panel). Pure: no React, no browser; tests/fundsTime.unit.ts runs it in node.

   Data contracts (written by the F2 DATA build, read here; every field optional where the pages can fall back):
   - funds/stats/index.json  {v, asof, cats: [{slug, cat, prod, track, n, rank}]}: the slug of a category is never re-derived here.
   - funds/stats/<slug>.json {v, cat, label, prod, asof, rf: {src, method}, tracks: [StatsRow], cat_median}: 36 months ending at asof.
   - funds/rank/<slug>.json  {v, cat, label, prod, asof, months, metric, basis, tracks, n, sets: [{metric, basis, tracks, n}]}.
   - funds/persist.json      quartile transition matrices per product and window, pooled over start months (normPersist reads it).
   - funds/glide.json        age tracks per manager (normGlide reads it; the page also stands on funds.json alone).
   Until a file is published the pages compute the same figures in the browser from the published monthly histories, with the same
   formulas as below (riskStats mirrors the build's definitions), and say so. */

export type Basis = 'net' | 'gross';
export type RankMetric = 'y12' | 'a3';

/* ---------- small month arithmetic (yyyymm) ---------- */
export const addM = (p: number, d: number) => { const t = Math.floor(p / 100) * 12 + (p % 100 - 1) + d; return Math.floor(t / 12) * 100 + (t % 12) + 1; };
export const backM = (p: number, n: number) => Array.from({ length: n }, (_, i) => addM(p, i - n + 1));
export const ymL = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
const fsum = (xs: number[]) => { let s = 0, c = 0; for (const x of xs) { const y = x - c, t = s + y; c = t - s - y; s = t; } return s; };
const mean = (xs: number[]) => fsum(xs) / xs.length;
export const sdev = (xs: number[]) => { if (xs.length < 2) return NaN; const m = mean(xs); return Math.sqrt(fsum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1)); };
export const median = (xs: number[]): number | null => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

/* ---------- contracts ---------- */
export interface StatsIndexRow { slug: string; cat: string; prod: string; track: string; n: number; stats?: boolean; rank?: boolean }
export interface StatsIndex { v: number; asof: number; cats: StatsIndexRow[] }
export const STAT_KEYS = ['a36', 'vol36', 'dd_max', 'dd_cur', 'dd_len', 'rec_months', 'dd_max_all', 'sharpe36', 'sortino36', 'beta36_vs_cat', 'te36_vs_cat', 'up_cap36', 'down_cap36', 'worst_m', 'best_m', 'pct_pos_m'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatVals = Partial<Record<StatKey, number | null>>;
export interface StatsRow extends StatVals { k: string; name: string; mgr: string; grp?: string; gone?: boolean; n_months: number; basis: Basis; dd_peak?: number | null; dd_trough?: number | null; dd_all_from?: number | null }
export interface StatsFile { v: number; cat: string; label?: string; prod?: string; asof: number; rf?: { src: string; method: string; series?: string; a36?: number; filled?: number[] }; method?: Record<string, string>; tracks: StatsRow[]; cat_median: StatVals & { n?: number } }
export interface RankSet { metric: RankMetric; basis: Basis; tracks: Record<string, (number | null)[]>; n: number[] }
export interface RankFile { v: number; cat: string; label?: string; prod?: string; asof?: number; months: number[]; metric?: RankMetric; basis?: Basis; tracks?: Record<string, (number | null)[]>; n?: number[]; sets?: RankSet[] }

/** the slug of a category (cat.json key "השתלמות | כללי") from the published index: never re-implemented here */
export const slugOf = (idx: StatsIndex | null | undefined, cat: string): StatsIndexRow | null => idx?.cats.find((c) => c.cat === cat) ?? null;

/** a series of a rank file by metric and basis: from `sets`, else the top level when it is that series */
export function pickSet(r: RankFile | null | undefined, metric: RankMetric, basis: Basis): RankSet | null {
  if (!r) return null;
  const s = r.sets?.find((x) => x.metric === metric && x.basis === basis);
  if (s) return s;
  if ((r.metric ?? 'y12') === metric && (r.basis ?? 'net') === basis && r.tracks && r.n) return { metric, basis, tracks: r.tracks, n: r.n };
  return null;
}

/* ---------- the risk statistics (36 months), the same definitions as the build ---------- */
export const RISK_F: Record<StatKey, string> = {
  a36: 'התשואה הממוצעת השנתית בחלון: (1 + r₁) × … × (1 + r₃₆) בחזקת 12 ÷ 36, פחות 1',
  vol36: 'סטיית התקן המדגמית של 36 התשואות החודשיות (n − 1) כפול שורש 12',
  dd_max: 'הירידה העמוקה ביותר מהשיא המצטבר בתוך 36 החודשים (השווי מתחיל ב-1 לפני החודש הראשון)',
  dd_cur: 'הירידה מהשיא המצטבר של החלון בחודש האחרון (0: המסלול בשיא החלון)',
  dd_len: 'מספר החודשים מהשיא עד השפל של הירידה העמוקה בחלון',
  rec_months: 'חודשים מהשפל של הירידה העמוקה בחלון עד שהשווי חזר לשיא שלפניה; ריק: טרם חזר',
  dd_max_all: 'הירידה העמוקה ביותר מהשיא על כל הרצף הרציף של תשואות חודשיות שמסתיים בחודש האחרון',
  sharpe36: 'ממוצע התשואה החודשית העודפת על הריבית חסרת הסיכון ÷ סטיית התקן המדגמית שלה, כפול שורש 12',
  sortino36: 'ממוצע התשואה העודפת ÷ סטיית החסר, כפול שורש 12. סטיית החסר: שורש (Σ min(0, עודפת)² ÷ 36); היעד: הריבית חסרת הסיכון',
  beta36_vs_cat: 'שיפוע OLS של התשואה החודשית על תשואת ממוצע הקטגוריה: השונות המשותפת ÷ שונות הקטגוריה',
  te36_vs_cat: 'סטיית התקן המדגמית של ההפרש החודשי בין המסלול לממוצע הקטגוריה, כפול שורש 12',
  up_cap36: 'הממוצע הגאומטרי של תשואת המסלול בחודשים שבהם ממוצע הקטגוריה עלה ÷ הממוצע הגאומטרי של הקטגוריה באותם חודשים × 100',
  down_cap36: 'הממוצע הגאומטרי של תשואת המסלול בחודשים שבהם ממוצע הקטגוריה ירד ÷ של הקטגוריה באותם חודשים × 100',
  worst_m: 'התשואה החודשית הנמוכה ב-36 החודשים',
  best_m: 'התשואה החודשית הגבוהה ב-36 החודשים',
  pct_pos_m: 'שיעור החודשים עם תשואה חיובית מתוך 36',
};
export const RISK_LABEL: Record<StatKey, string> = {
  a36: 'תשואה שנתית', vol36: 'תנודתיות שנתית', dd_max: 'ירידה מרבית', dd_cur: 'מתחת לשיא היום', dd_len: 'חודשים משיא לשפל', rec_months: 'חודשי התאוששות', dd_max_all: 'ירידה מרבית, כל ההיסטוריה',
  sharpe36: 'שארפ', sortino36: 'סורטינו', beta36_vs_cat: 'בטא מול הקטגוריה', te36_vs_cat: 'סטיית מעקב', up_cap36: 'לכידת עליות', down_cap36: 'לכידת ירידות', worst_m: 'החודש הגרוע', best_m: 'החודש הטוב', pct_pos_m: 'חודשים חיוביים',
};
/** unit of each statistic: % (a return or a share), pp (a percent-point spread), x (a ratio), n (months) */
export const RISK_UNIT: Record<StatKey, '%' | 'x' | 'n'> = {
  a36: '%', dd_max_all: '%', vol36: '%', dd_max: '%', dd_cur: '%', dd_len: 'n', rec_months: 'n', sharpe36: 'x', sortino36: 'x', beta36_vs_cat: 'x', te36_vs_cat: '%', up_cap36: 'x', down_cap36: 'x', worst_m: '%', best_m: '%', pct_pos_m: '%',
};
/** which way is better (for the reader's eye only: no score is built from them) */
export const RISK_UP: Partial<Record<StatKey, boolean>> = { a36: true, dd_max_all: true, vol36: false, dd_max: true, dd_cur: true, sharpe36: true, sortino36: true, up_cap36: true, down_cap36: false, worst_m: true, best_m: true, pct_pos_m: true };

/** BoI annual rate (%) → a monthly rate (%), compounded */
export const rfMonthly = (annual: number) => ((1 + annual / 100) ** (1 / 12) - 1) * 100;

const growthOf = (xs: number[]) => xs.reduce((g, x) => g * (1 + x / 100), 1);
/** Drawdown over a run of monthly returns from wealth 1 (the start counts as a peak): the deepest fall, the fall at the end, months from
 *  the peak to the trough, months from the trough back to that peak (null: not yet), peak and trough as indices (−1 = before the first). */
export function drawdown(xs: number[]): { max: number; cur: number; len: number | null; rec: number | null; peak: number; trough: number } {
  let w = 1, pk = 1, ipk = -1, best = { max: 0, peak: -1, trough: -1, level: 1 };
  xs.forEach((x, i) => { w *= 1 + x / 100; if (w > pk) { pk = w; ipk = i; } const d = (w / pk - 1) * 100; if (d < best.max) best = { max: d, peak: ipk, trough: i, level: pk }; });
  let rec: number | null = null;
  if (best.trough >= 0) { let w2 = 1; for (let i = 0; i < xs.length; i++) { w2 *= 1 + xs[i] / 100; if (i > best.trough && w2 >= best.level) { rec = i - best.trough; break; } } }
  return { max: best.max, cur: (w / pk - 1) * 100, len: best.trough >= 0 ? best.trough - best.peak : null, rec, peak: best.peak, trough: best.trough };
}
/** up (down) capture, %: the geometric mean monthly return of the track over the months the benchmark rose (fell) ÷ the benchmark's × 100 */
export function capture(r: number[], c: number[], up: boolean): number | null {
  const ix = c.map((b, i) => (up ? b > 0 : b < 0) ? i : -1).filter((i) => i >= 0);
  if (!ix.length) return null;
  const rx = growthOf(ix.map((i) => r[i])) ** (1 / ix.length) - 1, rb = growthOf(ix.map((i) => c[i])) ** (1 / ix.length) - 1;
  return rb ? (rx / rb) * 100 : null;
}

/** The 36-month statistics of one track, the build's definitions (pipeline/fund_stats_lib.py). `r`: the window's monthly returns (oldest
 *  first, all published), `c`: the category average on the same months, `rf`: the monthly risk-free rate on the same months, `run`: the
 *  consecutive run of monthly returns ending with the window's last month (for the full-history drawdown). Null where an input is missing. */
export function riskStats(r: number[], c: (number | null)[] | null, rf: (number | null)[] | null, run: number[]): StatVals {
  const n = r.length, out: StatVals = {};
  if (n < 3) return out;
  const dd = drawdown(r);
  out.a36 = (growthOf(r) ** (12 / n) - 1) * 100;
  out.vol36 = sdev(r) * Math.sqrt(12);
  out.dd_max = dd.max; out.dd_cur = dd.cur; out.dd_len = dd.len; out.rec_months = dd.rec;
  out.dd_max_all = run.length ? drawdown(run).max : null;
  out.worst_m = Math.min(...r); out.best_m = Math.max(...r); out.pct_pos_m = (100 * r.filter((x) => x > 0).length) / n;
  if (rf && rf.length === n && rf.every((x) => x != null)) {
    const ex = r.map((x, i) => x - (rf[i] as number)), m = mean(ex), s = sdev(ex);
    out.sharpe36 = s > 0 ? (m / s) * Math.sqrt(12) : null;
    const dn = Math.sqrt(fsum(ex.map((x) => Math.min(0, x) ** 2)) / n);
    out.sortino36 = dn > 0 ? (m / dn) * Math.sqrt(12) : null;
  } else { out.sharpe36 = null; out.sortino36 = null; }
  if (c && c.length === n && c.every((x) => x != null)) {
    const cc = c as number[], mr = mean(r), mc = mean(cc);
    const v = fsum(cc.map((x) => (x - mc) ** 2));
    out.beta36_vs_cat = v > 0 ? fsum(r.map((x, i) => (x - mr) * (cc[i] - mc))) / v : null;
    out.te36_vs_cat = sdev(r.map((x, i) => x - cc[i])) * Math.sqrt(12);
    out.up_cap36 = capture(r, cc, true); out.down_cap36 = capture(r, cc, false);
  } else { out.beta36_vs_cat = null; out.te36_vs_cat = null; out.up_cap36 = null; out.down_cap36 = null; }
  return out;
}

/** a monthly series aligned on months: value at each of `ps` (null where unpublished) */
export const alignOn = (p: number[], y: (number | null)[], ps: number[]) => { const m = new Map(p.map((x, i) => [x, y[i]])); return ps.map((x) => m.get(x) ?? null); };

/** The risk-free rate by month (yyyymm → monthly %), as the build takes it: the BoI 1-year nominal zero-coupon yield (macro/boi_curve.json,
 *  ZCM, monthly average) as (1 + y)^(1/12) − 1, a month without a figure carrying the last one forward to `asof`. */
export function rfFromCurve(curve: { months: string[]; nominal: Record<string, (number | null)[]> } | null | undefined, asof: number): Map<number, number> | null {
  const ys = curve?.nominal?.['1'];
  if (!curve || !ys) return null;
  const out = new Map<number, number>();
  let last: number | null = null, p = Number(curve.months[0]?.replace('-', '') ?? 0);
  const at = new Map(curve.months.map((m, i) => [Number(m.replace('-', '')), ys[i]]));
  if (!p) return null;
  for (; p <= asof; p = addM(p, 1)) { const y = at.get(p); if (y != null) last = y; if (last != null) out.set(p, rfMonthly(last)); }
  return out;
}
/** The statistics of a track from its history, the category average and the monthly risk-free rate, ending at `end`. */
export function riskFromHist(h: { p: number[] }, y: (number | null)[], end: number, cat: { p: number[]; y: (number | null)[] } | null, rf: Map<number, number> | null, n = 36): (StatVals & { months: number[] }) | null {
  const ps = backM(end, n), r = alignOn(h.p, y, ps);
  if (r.some((x) => x == null)) return null;
  const c = cat ? alignOn(cat.p, cat.y, ps) : null;
  // the consecutive run of published months that ends at `end`
  const run: number[] = [];
  for (let p = end, m = new Map(h.p.map((x, i) => [x, y[i]])); m.get(p) != null; p = addM(p, -1)) run.unshift(m.get(p)!);
  return { ...riskStats(r as number[], c, rf ? ps.map((p) => rf.get(p) ?? null) : null, run), months: ps };
}

/** the category median of each statistic over the rows that have it */
export function statMedians(rows: StatVals[]): StatVals {
  const out: StatVals = {};
  STAT_KEYS.forEach((k) => { const xs = rows.map((r) => r[k]).filter((x): x is number => x != null && Number.isFinite(x)); out[k] = median(xs); });
  return out;
}

/* ---------- percentile ranks ---------- */
/** percentile of each value among the others: (lower + ties ÷ 2) ÷ (n − 1) × 100, rounded; null below `min` ranked (the same rule as F1) */
export function percentiles(vals: Map<string, number>, min = 5): Map<string, number | null> {
  const xs = [...vals.values()], n = xs.length, out = new Map<string, number | null>();
  vals.forEach((v, k) => { if (n < min) { out.set(k, null); return; } const below = xs.filter((x) => x < v).length, ties = xs.filter((x) => x === v).length - 1; out.set(k, Math.round(((below + ties / 2) / (n - 1)) * 100)); });
  return out;
}
/** compounded return of the `n` months ending at `end` (annualised above 12 months), as a growth factor − 1; null if a month is missing */
export function windowRet(m: Map<number, number | null>, end: number, n: number): number | null {
  let g = 1;
  for (let i = 0; i < n; i++) { const x = m.get(addM(end, -i)); if (x == null) return null; g *= 1 + x / 100; }
  return (n > 12 ? g ** (12 / n) : g) - 1;
}
/** Percentile rank over time of every member of a category, computed from the members' histories (the browser's fallback for the rank
 *  file): for each month, the members with every month of the window published are ranked. */
export function rankSeries(members: { k: string; p: number[]; y: (number | null)[] }[], months: number[], n: number, min = 5): { tracks: Record<string, (number | null)[]>; n: number[] } {
  const maps = members.map((x) => ({ k: x.k, m: new Map(x.p.map((p, i) => [p, x.y[i]])) }));
  const tracks: Record<string, (number | null)[]> = Object.fromEntries(members.map((x) => [x.k, [] as (number | null)[]]));
  const ns: number[] = [];
  months.forEach((p) => {
    const vals = new Map<string, number>();
    maps.forEach(({ k, m }) => { const v = windowRet(m, p, n); if (v != null) vals.set(k, v); });
    ns.push(vals.size);
    const pc = percentiles(vals, min);
    members.forEach((x) => tracks[x.k].push(pc.get(x.k) ?? null));
  });
  return { tracks, n: ns };
}
export const quartileOf = (pct: number | null | undefined): 1 | 2 | 3 | 4 | null => (pct == null ? null : pct >= 75 ? 1 : pct >= 50 ? 2 : pct >= 25 ? 3 : 4);

/* ---------- the map: one frame per year ---------- */
export interface Frame { k: string; ret: number; vol: number; dd: number; st: number | null; a: number | null; months: number[] }
/** a track at the end of a window of `n` months: annualised return (cumulative for 12 or less), annualised volatility, deepest fall in the
 *  window, its equity exposure and assets in the last month. Null when a month of the window is missing. */
export function frameOf(k: string, h: { p: number[]; st?: (number | null)[]; a?: (number | null)[] }, y: (number | null)[], end: number, n: number): Frame | null {
  const ps = backM(end, n), r = alignOn(h.p, y, ps);
  if (r.some((x) => x == null)) return null;
  let g = 1, pk = 1, dd = 0;
  (r as number[]).forEach((x) => { g *= 1 + x / 100; pk = Math.max(pk, g); dd = Math.min(dd, g / pk - 1); });
  const i = h.p.indexOf(end);
  return { k, ret: ((n > 12 ? g ** (12 / n) : g) - 1) * 100, vol: sdev(r as number[]) * Math.sqrt(12), dd: dd * 100, st: i < 0 ? null : h.st?.[i] ?? null, a: i < 0 ? null : h.a?.[i] ?? null, months: ps };
}
/** the frames of the animation: every December from the first one with `min` tracks, and the latest month */
export function frameMonths(firsts: number[], asof: number, n: number, min = 5): number[] {
  const out: number[] = [];
  for (let y = 1999; y <= Math.floor(asof / 100); y++) {
    const e = y * 100 + 12; if (e >= asof) break;
    const start = addM(e, -n + 1);
    if (firsts.filter((f) => f <= start).length >= min) out.push(e);
  }
  out.push(asof);
  return out;
}
/** The points no other point beats on both axes (less risk and more return): the efficient edge, drawn as a thin line, low risk first. */
export function frontier<T extends { x: number; y: number }>(pts: T[]): T[] {
  const s = [...pts].sort((a, b) => a.x - b.x || b.y - a.y), out: T[] = [];
  let best = -Infinity;
  s.forEach((p) => { if (p.y > best) { out.push(p); best = p.y; } });
  return out;
}

/* ---------- the quilt ---------- */
export interface QuiltCell { k: string; grp: string; r: number; n: number; ps: number[]; gone?: boolean }
/** Calendar-year returns of each member, compounded from its monthly returns; a year counts only with all its months published (the
 *  current year: every month to `asof`, labelled YTD). Each year's cells are sorted best first. */
export function quilt(members: { k: string; grp: string; p: number[]; y: (number | null)[]; gone?: boolean }[], asof: number, years: number[]): Map<number, QuiltCell[]> {
  const out = new Map<number, QuiltCell[]>();
  years.forEach((yr) => {
    const need = yr === Math.floor(asof / 100) ? asof % 100 : 12, cells: QuiltCell[] = [];
    members.forEach((x) => {
      const ps = Array.from({ length: need }, (_, i) => yr * 100 + i + 1), r = alignOn(x.p, x.y, ps);
      if (r.some((v) => v == null)) return;
      const g = (r as number[]).reduce((t, v) => t * (1 + v / 100), 1);
      cells.push({ k: x.k, grp: x.grp, r: (g - 1) * 100, n: need, ps, ...(x.gone ? { gone: true } : {}) });
    });
    out.set(yr, cells.sort((a, b) => b.r - a.r || a.k.localeCompare(b.k)));
  });
  return out;
}

/* ---------- persistence ---------- */
export interface PersistTest { prod: string; win: number; basis: Basis; label: string; first: number | null; last: number | null; nStarts: number | null; cats: number | null;
  /** 4 rows (start quartile 1 = top) × 5 columns (quartile in the next window 1..4, then closed): counts */
  m: number[][];
  /** stayed in the top quartile: of all who started there (closed in the denominator), and of the survivors; the coin is 25% of survivors */
  stay: { k: number; n: number; share: number; coin: number; lo: number | null; hi: number | null };
  surv: { share: number | null; lo: number | null; hi: number | null; n: number | null };
  /** how the interval was made: a block bootstrap over overlapping start months, or Wilson on non-overlapping ones (thin samples) */
  ci: 'boot' | 'wilson' | null; eff: number | null; thin: boolean; rho: number | null; rhoN: number | null; gonePct: number | null; goneQ4Pct: number | null }
export interface PersistData { asof: number | null; method: string | null; note: string | null; src: string | null; tests: PersistTest[] }
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pair = (v: unknown): [number | null, number | null] => (Array.isArray(v) ? [num(v[0]), num(v[1])] : [null, null]);
/** reads funds/persist.json (the F2 DATA contract: rows per product family × window × basis, each with its four quartile rows); a
 *  malformed row is skipped. The family "הכל" pools every product. */
export function normPersist(x: unknown): PersistData {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const list = (Array.isArray(o.rows) ? o.rows : Array.isArray(o.tests) ? o.tests : []) as Record<string, unknown>[];
  const tests: PersistTest[] = [];
  list.forEach((t) => {
    const qs = (Array.isArray(t.rows) ? t.rows : []) as Record<string, unknown>[];
    const m: number[][] = [1, 2, 3, 4].map((q) => { const r = qs.find((z) => num(z.q) === q); const to = Array.isArray(r?.to) ? (r!.to as unknown[]).map((v) => num(v) ?? 0) : []; return to.length === 4 ? [...to, num(r!.gone) ?? 0] : []; });
    if (m.some((r) => r.length !== 5)) return;
    const win = Number(t.win), basis: Basis = t.basis === 'gross' ? 'gross' : 'net';
    if (!(win > 0)) return;
    const thin = t.thin === true, [lo, hi] = pair(t.ci90), [slo, shi] = pair(t.ci90_surv), w = (t.wilson90 ?? {}) as Record<string, unknown>;
    const n = num(t.top) ?? m[0].reduce((a, b) => a + b, 0), k = num(t.stay) ?? m[0][0];
    tests.push({ prod: String(t.fam ?? t.prod ?? ''), win, basis, label: `${win}M → ${win}M הבאים`, first: num(t.from), last: num(t.to), nStarts: num(t.starts), cats: num(t.cats), m,
      stay: { k, n, share: num(t.stay_pct) ?? (n ? (100 * k) / n : 0), coin: num(t.coin) ?? 25, lo, hi },
      surv: thin || slo == null ? { share: num(w.pct) ?? num(t.stay_surv_pct), lo: num(w.lo), hi: num(w.hi), n: num(w.n) } : { share: num(t.stay_surv_pct), lo: slo, hi: shi, n: num(t.top_surv) },
      ci: thin || slo == null ? (num(w.lo) != null ? 'wilson' : null) : 'boot', eff: num(t.eff), thin, rho: num(t.rho), rhoN: num(t.rho_n), gonePct: num(t.gone_pct), goneQ4Pct: num(t.gone_q4_pct) });
  });
  return { asof: num(o.asof), method: typeof o.method === 'string' ? o.method : null, note: typeof o.note === 'string' ? o.note : null, src: typeof o.src === 'string' ? o.src : null, tests };
}
/** the share of a row in each column, % */
export const rowShares = (row: number[]) => { const t = row.reduce((a, b) => a + b, 0); return row.map((v) => (t ? (100 * v) / t : 0)); };
/** Wilson interval of k successes in n (%), z = 1.645 for 90% (the build's level) */
export function wilson(k: number, n: number, z = 1.645): [number, number] | null {
  if (!n) return null;
  const p = k / n, d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [100 * (c - h), 100 * (c + h)];
}
/** the plain verdict, on the survivors (the coin's 25% is of those who were still there to be ranked): above chance when the 90% interval
 *  clears 25%, below when it stays under, else indistinguishable */
export function persistVerdict(t: PersistTest): 'above' | 'below' | 'coin' {
  const { lo, hi } = t.surv;
  if (lo != null && lo > t.stay.coin) return 'above';
  if (hi != null && hi < t.stay.coin) return 'below';
  return 'coin';
}

/* ---------- glide paths ---------- */
export const BANDS = ['עד 50', '50-60', '60 ומעלה'] as const;
export type Band = (typeof BANDS)[number];
type Rets = { y12: number | null; a3: number | null; a5: number | null };
export interface GlideTrack { band: Band; k: string; name?: string; assets: number | null; st: number | null; fo: number | null; net: Rets | null; gross: Rets | null; hist?: { p: number[]; st: (number | null)[] } }
export interface GlideGroup { grp: string; tracks: GlideTrack[]; gap?: { st: number | null; n_y12: number | null; n_a3: number | null; n_a5: number | null } }
export interface GlideData { asof: number | null; method: string | null; months: number[]; prods: { prod: string; groups: GlideGroup[]; med?: Partial<Record<Band, { st: number | null; n: number | null }>>; gapSt: number | null }[] }
const rets = (v: unknown): Rets | null => { if (!v || typeof v !== 'object') return null; const o = v as Record<string, unknown>; return { y12: num(o.y12), a3: num(o.a3), a5: num(o.a5) }; };
/** reads funds/glide.json (the F2 DATA contract: per product, per manager, its tracks keyed by age band, equity history aligned to the
 *  file's months); an unknown band is skipped */
export function normGlide(x: unknown): GlideData {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const months = Array.isArray(o.months) ? (o.months as unknown[]).map((v) => num(v)).filter((v): v is number => v != null) : [];
  const prods = (Array.isArray(o.prods) ? o.prods : []) as Record<string, unknown>[];
  return { asof: num(o.asof), method: typeof o.method === 'string' ? o.method : null, months, prods: prods.map((p) => {
    const groups = ((Array.isArray(p.mgrs) ? p.mgrs : Array.isArray(p.groups) ? p.groups : []) as Record<string, unknown>[]).map((g) => {
      const tr = (g.tracks && typeof g.tracks === 'object' ? g.tracks : {}) as Record<string, Record<string, unknown>>;
      const entries: [string, Record<string, unknown>][] = Array.isArray(tr) ? (tr as Record<string, unknown>[]).map((t) => [String(t.band ?? t.age), t]) : Object.entries(tr);
      const tracks = entries.flatMap(([band, t]) => {
        if (!(BANDS as readonly string[]).includes(band) || typeof t?.k !== 'string') return [];
        const st = Array.isArray(t.st) ? (t.st as unknown[]).map(num) : null;
        return [{ band: band as Band, k: t.k, name: typeof t.name === 'string' ? t.name : undefined, assets: num(t.assets), st: num(t.st_now) ?? (st ? null : num(t.st)), fo: num(t.fo_now),
          net: rets(t.net), gross: rets(t.gross), hist: st && st.length === months.length ? { p: months, st } : undefined }];
      });
      const gp = (g.gap ?? null) as Record<string, unknown> | null;
      return { grp: String(g.grp ?? ''), tracks, gap: gp ? { st: num(gp.st), n_y12: num(gp.n_y12), n_a3: num(gp.n_a3), n_a5: num(gp.n_a5) } : undefined };
    }).filter((g) => g.grp && g.tracks.length);
    const med = (p.med && typeof p.med === 'object' ? p.med : undefined) as GlideData['prods'][number]['med'];
    return { prod: String(p.prod ?? ''), groups, med, gapSt: num((p.gap_med as Record<string, unknown> | undefined)?.st) };
  }).filter((p) => p.prod) };
}
/** the equity step-down of a manager: the first band's equity minus the last band's (percentage points), null without both */
export function stepDown(g: { tracks: { band: Band; st: number | null }[] }): number | null {
  const a = g.tracks.find((t) => t.band === 'עד 50')?.st, c = g.tracks.find((t) => t.band === '60 ומעלה')?.st;
  return a == null || c == null ? null : a - c;
}

/* ---------- the watchlist (browser-only; stored under 'funds:watch') ---------- */
/** what the reader saw of a track at the last look */
export interface WSnap { asof: number; b: Basis; m1: number | null; pct: number | null; pctN: number | null; pct3: number | null; fee: number | null }
export interface WItem { k: string; name: string; at: string; base: WSnap | null }
export interface WatchStore { v: 1; items: WItem[] }
export const NO_WATCH: WatchStore = { v: 1, items: [] };
export const WATCH_MAX = 60;
const snapOk = (s: unknown): WSnap | null => {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>, asof = num(o.asof);
  if (asof == null || asof < 199001 || asof > 210012) return null;
  return { asof, b: o.b === 'gross' ? 'gross' : 'net', m1: num(o.m1), pct: num(o.pct), pctN: num(o.pctN), pct3: num(o.pct3), fee: num(o.fee) };
};
/** any stored or imported value back to a WatchStore: unknown keys dropped, duplicates merged, at most WATCH_MAX tracks */
export function normWatch(x: unknown): WatchStore {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const raw = Array.isArray(o.items) ? o.items : Array.isArray(x) ? (x as unknown[]) : [];
  const seen = new Set<string>(), items: WItem[] = [];
  raw.forEach((it) => {
    const r = (typeof it === 'string' ? { k: it } : it) as Record<string, unknown> | null;
    const k = typeof r?.k === 'string' && /^[gip]\d{1,7}$/.test(r.k) ? r.k : null;
    if (!k || seen.has(k) || items.length >= WATCH_MAX) return;
    seen.add(k);
    items.push({ k, name: typeof r!.name === 'string' ? r!.name.slice(0, 160) : k, at: typeof r!.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r!.at) ? r!.at : '', base: snapOk(r!.base) });
  });
  return { v: 1, items };
}
export const isWatched = (w: WatchStore, k: string) => w.items.some((x) => x.k === k);
export function toggleWatch(w: WatchStore, k: string, name: string, snap: WSnap | null, today: string): WatchStore {
  const n = normWatch(w);
  if (isWatched(n, k)) return { v: 1, items: n.items.filter((x) => x.k !== k) };
  if (n.items.length >= WATCH_MAX) return n;
  return { v: 1, items: [...n.items, { k, name, at: today, base: snap }] };
}
/** imported items join the stored ones (the stored snapshot wins for a track in both) */
export function mergeWatch(a: WatchStore, b: unknown): WatchStore {
  const x = normWatch(a), y = normWatch(b);
  return normWatch({ items: [...x.items, ...y.items.filter((i) => !isWatched(x, i.k))] });
}
/** the look is over: every item's snapshot becomes what is shown now */
export function markSeen(w: WatchStore, now: Map<string, WSnap>, asof?: number): WatchStore {
  // a track with nothing to show now (closed) keeps its last figures but counts as seen in this month, so the badge does not stay up
  return { v: 1, items: normWatch(w).items.map((i) => ({ ...i, base: now.get(i.k) ?? (i.base && asof && asof > i.base.asof ? { ...i.base, asof } : i.base) })) };
}
export interface WDelta {
  k: string; fresh: boolean; months: number;
  dPct: number | null; dFee: number | null;
  /** the quartile on LTM moved by one or more */
  qMove: [number, number] | null;
  /** in the bottom quartile on 3Y */
  bottom3: boolean;
}
const monthsBetween = (a: number, b: number) => (Math.floor(b / 100) - Math.floor(a / 100)) * 12 + (b % 100) - (a % 100);
/** what changed for one track since the last look (a first look: nothing is "new") */
export function deltaOf(item: WItem, now: WSnap | null): WDelta | null {
  if (!now) return null;
  const b = item.base;
  const same = b && b.b === now.b;
  const q0 = same ? quartileOf(b!.pct) : null, q1 = quartileOf(now.pct);
  return {
    k: item.k, fresh: !!b && now.asof > b.asof, months: b ? Math.max(0, monthsBetween(b.asof, now.asof)) : 0,
    dPct: same && b!.pct != null && now.pct != null ? now.pct - b!.pct : null,
    dFee: b && b.fee != null && now.fee != null && Math.abs(now.fee - b.fee) >= 0.005 ? now.fee - b.fee : null,
    qMove: q0 != null && q1 != null && q0 !== q1 ? [q0, q1] : null,
    bottom3: now.pct3 != null && now.pct3 < 25,
  };
}
/** the badge on the section tab: watched tracks with a regulator month newer than the reader's last look */
export const watchBadge = (w: WatchStore, asof: number | null | undefined) => (asof ? normWatch(w).items.filter((i) => i.base && asof > i.base.asof).length : 0);
/** consecutive latest months of negative net flow (deposits − withdrawals + net transfers) */
export function outflowStreak(h: { dep?: (number | null)[]; wd?: (number | null)[]; tr?: (number | null)[] }): number {
  if (!h.dep || !h.wd || !h.tr) return 0;
  let n = 0;
  for (let i = h.dep.length - 1; i >= 0; i--) { const d = h.dep[i], w = h.wd[i], t = h.tr[i]; if (d == null || w == null || t == null) break; if (d - w + t < 0) n++; else break; }
  return n;
}
/** today's fall from the all-time peak of the compounded index (%), and the months since that peak */
export function ddNow(y: (number | null)[]): { dd_cur: number; dd_len: number } {
  let i = 1, pk = 1, len = 0, cur = 0;
  for (const x of y) { if (x == null) continue; i *= 1 + x / 100; if (i >= pk) { pk = i; len = 0; } else len++; cur = i / pk - 1; }
  return { dd_cur: cur * 100, dd_len: len };
}
/** compounded return of the months after `from` up to `to` (both yyyymm), null when one is missing */
export function retBetween(p: number[], y: (number | null)[], from: number, to: number): { r: number; ps: number[] } | null {
  const ps = p.filter((x) => x > from && x <= to);
  if (!ps.length || monthsBetween(from, to) !== ps.length) return null;
  let g = 1;
  for (const x of ps) { const v = y[p.indexOf(x)]; if (v == null) return null; g *= 1 + v / 100; }
  return { r: (g - 1) * 100, ps };
}
