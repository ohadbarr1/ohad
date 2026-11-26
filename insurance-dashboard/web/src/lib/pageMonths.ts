/* Rollout F2 (spec 18.3, 18.5): the numbers of the five rollout pages (fund card, screener, /my, savings hub, fees tool). Pure, typed,
   node-tested (scripts/page-months-test.mjs on the live data of 10/26). No page computes a return, a place, an average or a fee on its
   own: they come from here, from lib/compareMonths.ts (rows, summaries) and lib/feeExample.ts (`feeCost`).
   - Returns are GROSS (owner 26.11.26): the published monthly return (`funds/<k>.json` `y`, `funds/months/<slug>.json` `tracks`) and
     the published windows of funds.json (`m1`, `ytd`, `y12`, `a3`, `a5`). No basis argument anywhere.
   - The type's monthly RETURN average is the site's asset-weighted figure: `funds/cat.json` `y` (the regulator's members that month,
     `n` of them), copied as `avg[]` into `funds/months/<slug>.json`. It is NEVER recomputed here as a mean of member tracks (coordinator
     decision 26.11.26, from lane L1-d: a simple mean reads −1.01% against the card's −1.03% for pension general in 10/26). When only
     member histories are loaded (the fallback of the type-month sheet), the average still comes from cat.json.
   - The type's yearly FEE average (`typeFeeAvg`) is a simple mean of the like-for-like tracks' yearly cost (spec 18.2 #5).
   - Ranking: `placeGroups` (18.5), anchored groups and standard competition places, one function for every page. Self-managed tracks
     (`selfDirected`), old-generation policies and tracks with no figure are never ranked. */
import { catKey, selfDirected, type CatX, type FundX, type HistX, type Per } from './funds';
import { tieBand, TIE_M1 } from './fundsTie';
import { addMonths } from './market';
import { cum, halfYear, monthRows, periodRow, rowBand, yearRows, type MonthRow, type YearRow } from './compareMonths';
import { feeCost, feeLow, FEE_TIE, type FeeBase } from './feeExample';
import { AGE_DEFAULT, BALANCE_EX, COEF_DEFAULT, exampleMonthly, GROWTH_DEFAULT, INFL_DEFAULT, project, RET_FALLBACK, RETIRE_AGE, type Plan } from './retire';

type V = number | null;
const EPS = 1e-9;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/* ======================= 18.5 · the shared ranking ======================= */

/** One track's place. `place`: the 1-based position of its group's first track (1, 1, 1, 4, 4); `lo`–`hi`: the group's span (for
 *  "באמצע (5–6 מתוך 13)"); `n`: how many were ranked; `shared`: the group has more than one track; `chip`: shared, and not every ranked
 *  track is shared (the "כמעט שווים" chip; when everyone shares, the sentence and the closing note carry it). Unranked: nulls. */
export interface Place { place: number | null; lo: number | null; hi: number | null; n: number; shared: boolean; chip: boolean }

/** Indexes of `values` best first (descending), ties in input order, values without a figure last (input order). */
export function placeOrder(values: (number | null | undefined)[]): number[] {
  const ix = values.map((_, i) => i);
  return ix.sort((a, b) => {
    const x = values[a], y = values[b];
    if (!num(x) && !num(y)) return a - b;
    if (!num(x)) return 1;
    if (!num(y)) return -1;
    return y - x || a - b;
  });
}

/**
 * The places of `values`, IN INPUT ORDER (one entry per value). Sort descending; a track joins the current group while
 * `first − value < band` (the group's FIRST value, never chained through a neighbour); a group's place is the 1-based position of its
 * first track and the next group continues by position. Band: `tieBand(per, asof)` of lib/fundsTie (0.05 a month, 0.10 on 12 months,
 * 3 and 5 years, pro rata on the year to date). Null / non-finite values are not ranked (place null). Callers pass null for
 * self-managed tracks and old-generation policies (see `rankable`).
 */
export function placeGroups(values: (number | null | undefined)[], band: number): Place[] {
  const order = placeOrder(values).filter((i) => num(values[i]));
  const n = order.length, out: Place[] = values.map(() => ({ place: null, lo: null, hi: null, n, shared: false, chip: false }));
  const groups: number[][] = [];
  let first = NaN;
  for (const i of order) {
    const v = values[i] as number;
    if (!groups.length || !(first - v < band - EPS)) { groups.push([i]); first = v; }
    else groups[groups.length - 1].push(i);
  }
  let pos = 1;
  const all = n > 0 && groups.every((g) => g.length > 1);
  for (const g of groups) {
    for (const i of g) out[i] = { place: pos, lo: pos, hi: pos + g.length - 1, n, shared: g.length > 1, chip: g.length > 1 && !all };
    pos += g.length;
  }
  return out;
}

/** true when any ranked value shares its place (then the board closes with `tieNote(per)` of lib/pageWords) */
export const anyShared = (pl: Place[]) => pl.some((p) => p.shared);

/* ======================= members of a type ======================= */

/** old-generation managers' insurance (1990–2003): promises the return does not show; never ranked, no place, no compare button */
export const oldGeneration = (f: Pick<FundX, 'prod'>) => /^ביטוחי מנהלים (1990|1992)/.test(f.prod);
/** may this track be ranked against its type? (not self-managed / IRA, not an old-generation policy) */
export const rankable = (f: Pick<FundX, 'name' | 'prod'>) => !selfDirected(f) && !oldGeneration(f);
/** Like-for-like (18.2 #2): the type's tracks without the self-managed and IRA ones (`selfDirected`). Used by every fee comparison, the
 *  cheapest, the fee average and every ranking. */
export const likeForLike = <T extends Pick<FundX, 'name'>>(members: T[]): T[] => members.filter((f) => !selfDirected(f));
/** the self-managed members, listed after the fee board under "בניהול אישי · לא בהשוואה" */
export const selfManaged = <T extends Pick<FundX, 'name'>>(members: T[]): T[] => members.filter((f) => selfDirected(f));

/** The tracks of a type as the pages list them (mockup `members`): same product and track, open to the public (`closed` false; set
 *  `closed: true` to include sectoral funds), still reporting (no `gone`), with assets. Self-managed tracks are included (flagged). */
export function typeMembers<T extends FundX>(funds: T[], key: string, o: { closed?: boolean } = {}): T[] {
  return funds.filter((f) => catKey(f) === key && (o.closed || !f.closed) && !f.gone && (f.assets ?? 0) > 0);
}

/* ======================= month values: funds/months file, or member histories ======================= */

/** `funds/months/<slug>.json` (pipeline P1, lane L1-d; slug = funds/stats/index.json's, via lib/fundsTime `slugOf`). Gross. */
export interface TypeMonthsFile {
  v: 1; cat: string; prod: string; track: string; slug: string; asof: number;
  /** 24 × yyyymm, oldest first */
  months: number[];
  /** per track key: 24 × the published monthly return, or null */
  tracks: Record<string, (number | null)[]>;
  /** 24 × the type's average (cat.json `y`, asset-weighted), or null */
  avg?: (number | null)[];
  /** 24 × members that month */
  n: number[];
  method?: string; src?: string;
}
/** One month of a type: every member's return, the type's average (asset-weighted, cat.json) and its member count. */
export interface TypeMonth { p: number; vals: Record<string, V>; avg: V; avgN: number | null }

const catAt = (c: CatX | null | undefined, p: number): { avg: V; n: number | null } => {
  const i = c ? c.p.indexOf(p) : -1;
  return i < 0 ? { avg: null, n: null } : { avg: num(c!.y[i]) ? c!.y[i] : null, n: num(c!.n[i]) ? c!.n[i] : null };
};
/** A month from the months file; null when `p` is not in it (older than 24 months, or a missing file: fall back to histories). The
 *  average is the file's `avg` (= cat.json `y`); `cat` is used only when the file carries no `avg`. */
export function typeMonthFromFile(file: TypeMonthsFile | null | undefined, p: number, cat?: CatX | null): TypeMonth | null {
  if (!file) return null;
  const i = file.months.indexOf(p);
  if (i < 0) return null;
  const vals: Record<string, V> = {};
  for (const [k, s] of Object.entries(file.tracks)) vals[k] = num(s[i]) ? s[i] : null;
  const fa = file.avg?.[i], c = catAt(cat, p);
  return { p, vals, avg: num(fa) ? fa : c.avg, avgN: num(file.n?.[i]) ? file.n[i] : c.n };
}
/** The fallback: a month from the members' own histories (`funds/<k>.json`); the average from cat.json, never a mean of the members. */
export function typeMonthFromHists(hists: Record<string, Pick<HistX, 'p' | 'y'> | null | undefined>, keys: string[], p: number, cat?: CatX | null): TypeMonth {
  const vals: Record<string, V> = {};
  for (const k of keys) vals[k] = monthValue(hists[k], p);
  const c = catAt(cat, p);
  return { p, vals, avg: c.avg, avgN: c.n };
}
/** a track's published return in month `p` (null when not published) */
export function monthValue(h: Pick<HistX, 'p' | 'y'> | null | undefined, p: number): V {
  if (!h) return null;
  const i = h.p.indexOf(p);
  return i < 0 ? null : num(h.y[i]) ? (h.y[i] as number) : null;
}

/* ======================= ranked boards (screener, hub sheets and leaders, card type-month sheet) ======================= */

/** One board row: the track, its figure, its place (null: unranked, listed last as "אין עדיין"). */
export interface ScoreRow { k: string; f: FundX; v: V; ranked: boolean; pl: Place }
export interface ScoreOpts {
  /** the data month (funds.json asof): sets the band (`tieBand`) */
  asof: number;
  /** m1 only: a month other than `asof`; its values come from `month` (a `TypeMonth`), else the track's `m1` is used for `asof` */
  p?: number;
  month?: TypeMonth | null;
  /** override the band (default `tieBand(per, asof)`) */
  band?: number;
}
/**
 * The ranked board of a type for one window (spec 16.2 F2, 18.5): rows best first, ranked rows by `placeGroups`, unranked rows
 * (no figure, self-managed, old generation) last in input order. `per`: m1 / ytd / y12 / a3 / a5 (gross, funds.json); for a given
 * month (`o.p` with `o.month`) the month's values. One function for the screener, the hub's type-month sheet and leaders and the card's
 * type-month sheet, so the places agree everywhere.
 */
export function scoreRows(members: FundX[], per: Per, o: ScoreOpts): ScoreRow[] {
  const p = o.p ?? o.asof, band = o.band ?? tieBand(per, o.asof);
  const raw = members.map((f) => {
    if (per === 'm1' && o.month && o.month.p === p) return o.month.vals[f.k] ?? null;
    if (per === 'm1' && p !== o.asof) return null;
    const v = f[per];
    return num(v) ? v : null;
  });
  const vals = members.map((f, i) => (rankable(f) ? raw[i] : null));
  const pl = placeGroups(vals, band);
  const rows = members.map((f, i) => ({ k: f.k, f, v: raw[i], ranked: pl[i].place != null, pl: pl[i] }));
  return placeOrder(vals).map((i) => rows[i]);
}

/** The place of one track in its type for a window (null when it is not ranked or fewer than two are). */
export function placeOf(f: FundX, members: FundX[], per: Per, asof: number): Place | null {
  const r = scoreRows(members, per, { asof }).find((x) => x.k === f.k);
  return r && r.pl.place != null && r.pl.n > 1 ? r.pl : null;
}
/** The card's hint line and long view: the place on the longest window that exists, 5Y, then 3Y, then the last year (spec 3.2 #5);
 *  null for an old-generation policy or when fewer than two tracks are ranked. */
export function longestPlace(f: FundX, members: FundX[], asof: number): { per: 'a5' | 'a3' | 'y12'; pl: Place } | null {
  if (oldGeneration(f)) return null;
  for (const per of ['a5', 'a3', 'y12'] as const) { const pl = placeOf(f, members, per, asof); if (pl) return { per, pl }; }
  return null;
}

/** The hub's "ראשונים ואחרונים" board of a type (17.1 2c): first, the reader's own track (when it is neither), last. */
export interface LeaderRow { row: ScoreRow; role: 'first' | 'mine' | 'last'; mine: boolean }
export function leaderRows(scored: ScoreRow[], mineKeys: string[] = []): LeaderRow[] {
  const r = scored.filter((x) => x.ranked);
  if (!r.length) return [];
  const a = r[0], b = r[r.length - 1], me = r.find((x) => mineKeys.includes(x.k));
  const out: LeaderRow[] = [{ row: a, role: 'first', mine: mineKeys.includes(a.k) }];
  if (me && me !== a && me !== b) out.push({ row: me, role: 'mine', mine: true });
  if (b !== a) out.push({ row: b, role: 'last', mine: mineKeys.includes(b.k) });
  return out;
}
/** first − last of the ranked figures (the hub's "שינויים" card: the gap inside a type in a month); null with fewer than two */
export function rankedSpread(scored: ScoreRow[]): V {
  const r = scored.filter((x) => x.ranked && num(x.v)).map((x) => x.v as number);
  return r.length < 2 ? null : Math.max(...r) - Math.min(...r);
}

/* ======================= the card: the track against its type ======================= */

/** The card's months lens (spec 3.2 #4): newest first, the track and the type's average (cat.json, asset-weighted) per month;
 *  "חצי שנה" compounded, "שנה אחרונה" = the published `y12` against the type's 12 months compounded. `months`: how many months the track
 *  has published (for "מסלול חדש: פורסמו N חודשים." under 12 and "–" in the summaries under 6). */
export interface TrackVsType {
  rows: { p: number; v: V; avg: V; avgN: number | null }[];
  half: { v: V; avg: V };
  y12: { v: V; avg: V };
  months: number;
  /** newest published month of the track (null: no monthly return at all) */
  newest: number | null;
}
/** published months of a history */
export const monthsOnFile = (h: Pick<HistX, 'y'> | null | undefined) => (h ? h.y.filter(num).length : 0);
const newestOf = (h: Pick<HistX, 'p' | 'y'> | null | undefined): number | null => {
  if (!h) return null;
  for (let i = h.p.length - 1; i >= 0; i--) if (num(h.y[i])) return h.p[i];
  return null;
};
/**
 * `h`: the track's history; `f`: its funds.json row (for the published `y12`); `cat`: the type's cat.json entry, or null to drop the
 * average column (a type with fewer than three members, `hasTypeAvg`). `n`: 6 or 12 rows. The rows end at the track's newest month
 * (a track that stopped reporting shows its last month, 3.5).
 */
export function trackVsType(h: HistX | null | undefined, f: FundX | null | undefined, cat: CatX | null | undefined, n: number): TrackVsType {
  const newest = newestOf(h), months = monthsOnFile(h);
  if (!h || newest == null) return { rows: [], half: { v: null, avg: null }, y12: { v: null, avg: null }, months: 0, newest: null };
  const o = { cat: cat ?? null, asof: newest };
  const rows = monthRows([h], 'gross', n, o).map((r: MonthRow) => ({ p: r.p, v: r.vals[0], avg: r.avg, avgN: r.avgN })).filter((r) => r.v != null);
  const hf = halfYear([h], 'gross', o), ly = periodRow([f ?? null], 'gross', 'y12', o);
  return { rows, half: { v: hf.vals[0], avg: cat ? hf.avg : null }, y12: { v: months >= 12 ? ly.vals[0] : null, avg: cat ? ly.avg : null }, months, newest };
}
/** The card's years lens (3.2 lenses "שנים"): calendar years newest first (the current one "עד אוק׳"), and the footer "3 שנים, בשנה" /
 *  "5 שנים, בשנה" (published `a3` / `a5` against the type's months compounded and annualised). */
export interface TrackYears { rows: { yr: number; part: boolean; last: number; v: V; avg: V }[]; a3: { v: V; avg: V }; a5: { v: V; avg: V } }
export function trackYears(h: HistX | null | undefined, f: FundX | null | undefined, cat: CatX | null | undefined, n: number): TrackYears {
  const newest = newestOf(h);
  if (!h || newest == null) return { rows: [], a3: { v: null, avg: null }, a5: { v: null, avg: null } };
  const o = { cat: cat ?? null, asof: newest };
  const rows = yearRows([h], 'gross', n, o).map((r: YearRow) => ({ yr: r.yr, part: r.part, last: r.last, v: r.vals[0], avg: r.avg }));
  const a3 = periodRow([f ?? null], 'gross', 'a3', o), a5 = periodRow([f ?? null], 'gross', 'a5', o);
  return { rows, a3: { v: a3.vals[0], avg: cat ? a3.avg : null }, a5: { v: a5.vals[0], avg: cat ? a5.avg : null } };
}
/** The type's average over a window (the long view's tiles and sentence): cat.json months compounded, annualised for 3Y and 5Y. */
export function typeWindowAvg(cat: CatX | null | undefined, per: 'y12' | 'a3' | 'a5', asof: number): V {
  return cat ? periodRow([], 'gross', per, { cat, asof }).avg : null;
}
/** the average column shows only for a type of three tracks or more (3.5) */
export const hasTypeAvg = (members: unknown[]) => members.length >= 3;
/** bands of the card's sentences: a month 0.05, a year / window 0.10 (lib/compareMonths rowBand) */
export const MONTH_BAND = rowBand('month');
export const YEAR_BAND = rowBand('year');

/* ======================= the hub: track types × months ======================= */

export interface TypeCol { key: string; track: string; members: number; catN: number | null; mine: boolean; assets: number }
export interface TypeGrid { cols: TypeCol[]; rows: { p: number; vals: V[] }[]; half: V[]; y12: V[] }
/** The hub's "החודש" lens (6.2 #4, 16.1 3c, 17.1 2b): the product's types with three or more open tracks, "מקבלי קצבה" left out,
 *  largest by assets first, four at most; the reader's type of that product (`mineKey`) first. Values are the type's average
 *  (cat.json `y`, asset-weighted), `n` months newest first; "חצי שנה" and "שנה אחרונה" compounded from the same series. */
export function typeGrid(funds: FundX[], cats: Record<string, CatX>, prod: string, o: { asof: number; n?: number; mineKey?: string | null; max?: number }): TypeGrid {
  const n = o.n ?? 6, max = o.max ?? 4, by = new Map<string, FundX[]>();
  for (const f of funds) if (f.prod === prod && !f.closed && !f.gone && (f.assets ?? 0) > 0) by.set(catKey(f), [...(by.get(catKey(f)) ?? []), f]);
  const ok = [...by.entries()].filter(([k, m]) => m.length >= 3 && cats[k] && !/מקבלי קצבה/.test(k))
    .map(([k, m]) => ({ key: k, track: m[0].track, members: m.length, catN: catAt(cats[k], o.asof).n, mine: k === o.mineKey, assets: m.reduce((t, f) => t + (f.assets ?? 0), 0) }))
    .sort((a, b) => b.assets - a.assets);
  let cols = ok.slice(0, max);
  const me = ok.find((c) => c.mine);
  if (me) cols = [me, ...cols.filter((c) => c !== me)].slice(0, max);
  const back = (k: number) => Array.from({ length: k }, (_, i) => addMonths(o.asof, -i));
  const rows = back(n).map((p) => ({ p, vals: cols.map((c) => catAt(cats[c.key], p).avg) }));
  const win = (c: TypeCol, k: number) => cum(back(k).map((p) => catAt(cats[c.key], p).avg));
  return { cols, rows, half: cols.map((c) => win(c, 6)), y12: cols.map((c) => win(c, 12)) };
}

/* ======================= fees: like-for-like, the board, the average ======================= */

/** The reader's amounts for one product (lib/myAmounts `useMyAmounts`): a balance and a monthly deposit (null: the example deposit).
 *  Null: the example for everyone (100,000 ₪ and the product's example deposit). Structurally lib/feeExample `FeeBase`. */
export type Amounts = FeeBase | null | undefined;
/** Does any like-for-like track of the type charge a deposit fee? Without one the amounts sheet has one field and the wording has no
 *  deposit (18.2 #3), except on the "עד הפרישה" lens. */
export const typeHasDepositFee = (members: Pick<FundX, 'name' | 'depfee'>[]) => likeForLike(members).some((f) => (f.depfee ?? 0) > 0);
/** Does the product have an example deposit (pension, hishtalmut)? */
export const prodHasDeposit = (prod: string) => exampleMonthly(prod).v > 0;
/** The "עד הפרישה" assumptions (the fees tool's saver defaults; lib/retire): age 38 unless the reader's, retirement 67, a 4% gross return,
 *  2% inflation, deposits rising 2% a year, coefficient 200. Balance and deposit: the reader's amounts, else the example. */
export interface CareerAssume { age?: number; retire?: number; ret?: number; infl?: number; growth?: number; coef?: number }
export function careerPlan(prod: string, a: Amounts, c: CareerAssume = {}): Plan {
  return { age: c.age ?? AGE_DEFAULT, retire: c.retire ?? RETIRE_AGE, balance: a?.balance ?? BALANCE_EX, monthly: a?.monthly ?? exampleMonthly(prod).v,
    growth: c.growth ?? GROWTH_DEFAULT, ret: c.ret ?? RET_FALLBACK, infl: c.infl ?? INFL_DEFAULT, coef: c.coef ?? COEF_DEFAULT };
}
/** Total fees until retirement in today's ₪ for one track (`project(...).feesReal`), rounded to 100 ₪; null without a published fee or
 *  past the retirement age. */
export function careerFees(f: Pick<FundX, 'prod' | 'fee' | 'depfee'>, a: Amounts, c: CareerAssume = {}): V {
  if (f.fee == null) return null;
  const plan = careerPlan(f.prod, a, c);
  if (plan.age >= plan.retire) return null;
  return Math.round(project(plan, { fee: f.fee, depfee: f.depfee ?? 0 }).feesReal / 100) * 100;
}
export type FeeMode = 'yr' | 'career';
/** a track's figure on the fee board: ₪ a year (`feeCost`, rounded to 10) or ₪ until retirement (rounded to 100) */
export const feeValue = (f: Pick<FundX, 'prod' | 'fee' | 'depfee'>, a: Amounts, mode: FeeMode = 'yr', c: CareerAssume = {}): V =>
  mode === 'yr' ? feeCost(f, true, a ?? null) : careerFees(f, a, c);

/**
 * The type's fee average (18.2 #5): the mean of the like-for-like tracks' cost, rounded to 10 ₪ (a year) or 100 ₪ (until retirement).
 * The card's fee row ("הממוצע") and the fees tool's closing line ("ממוצע N המסלולים") call this one function, on the same amounts.
 * Null when no like-for-like track publishes a fee.
 */
export function typeFeeAvg(members: Pick<FundX, 'name' | 'prod' | 'fee' | 'depfee'>[], a?: Amounts, mode: FeeMode = 'yr', c: CareerAssume = {}): V {
  const v = likeForLike(members).map((f) => feeValue(f, a, mode, c)).filter(num);
  if (!v.length) return null;
  const r = mode === 'yr' ? 10 : 100;
  return Math.round(v.reduce((t, x) => t + x, 0) / v.length / r) * r;
}

export interface FeeRow { k: string; f: FundX; v: number; mine: boolean; cheapest: boolean; low: boolean }
export interface FeeBoard {
  /** like-for-like tracks with a fee, cheapest first */
  rows: FeeRow[];
  /** self-managed tracks with a fee, cheapest first ("בניהול אישי · לא בהשוואה") */
  self: FeeRow[];
  /** tracks with no published fee (listed last, "אין עדיין") */
  none: FundX[];
  /** `typeFeeAvg` of the board */
  avg: V;
  /** cheapest and dearest of the board */
  lo: V; hi: V;
  /** the reader's row index in `rows` (−1: not on the board); `pin`: it is not among the first four, so it is repeated above the
   *  board under "המסלול שלך · N מתוך M, מהזול ליקר" (18.2 #2) */
  mineIdx: number; pin: boolean;
}
/**
 * The fees tool's board (7.2 #5, 18.2 #2). `mineK`: the reader's saved track of this type (or null). `a`: the amounts of the product on
 * screen (one product's, never another's: 17.2). `cheapest`: the row costs exactly the lowest (tag "הכי זול", mockup v4); `low`: within
 * FEE_TIE (20 ₪) of the lowest, measured from the lowest only (`feeLow`, tag "מהזולים"); on the career lens `low` uses 1,000 ₪.
 */
export function feeBoard(members: FundX[], o: { mineK?: string | null; a?: Amounts; mode?: FeeMode; career?: CareerAssume } = {}): FeeBoard {
  const mode = o.mode ?? 'yr', val = (f: FundX) => feeValue(f, o.a, mode, o.career ?? {});
  const mk = (list: FundX[]): FeeRow[] => {
    const xs = list.map((f) => ({ f, v: val(f) })).filter((x): x is { f: FundX; v: number } => num(x.v)).sort((x, y) => x.v - y.v);
    const lowI = new Set(feeLow(xs.map((x) => x.v), mode === 'yr' ? FEE_TIE : 1000)), lo = xs.length ? xs[0].v : NaN;
    return xs.map((x, i) => ({ k: x.f.k, f: x.f, v: x.v, mine: !!o.mineK && x.f.k === o.mineK, cheapest: x.v === lo, low: lowI.has(i) }));
  };
  const lfl = likeForLike(members), rows = mk(lfl), self = mk(selfManaged(members));
  const none = members.filter((f) => !num(val(f)));
  const mineIdx = rows.findIndex((r) => r.mine);
  return { rows, self, none, avg: typeFeeAvg(lfl, o.a, mode, o.career ?? {}), lo: rows.length ? rows[0].v : null, hi: rows.length ? rows[rows.length - 1].v : null, mineIdx, pin: mineIdx >= 4 };
}

/** The month band, re-exported for pages that need it next to `scoreRows` (0.05). */
export const M1_BAND = TIE_M1;
