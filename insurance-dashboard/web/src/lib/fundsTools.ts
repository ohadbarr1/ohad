/* The funds tools (wave F2, TOOLS): the data contracts the pages read and the client-side fallbacks, pure (no React).
   - funds/default.json (F2 DATA, contract 4): the default-fund tenders, winners and prices, each row sourced to a gov.il URL.
   - funds/trackers.json (F2 DATA, contract 5): index trackers grouped by index, the gap to the group's median gross = the wrapper's cost.
     Until the file is published the page builds the same groups from funds.json (tracks whose regulator track name starts "עוקב"),
     labelled as such. */
import { median } from './fundsCalc';

/* ---------- default funds (קרנות ברירת מחדל) ---------- */
/** a winner: `grp` is funds.json's group when the manager still exists as one (else the historical name, and no `k`). In a tender
 *  where winners bid different prices (2018) the price is per winner: read the winner's fee first, then the tender's. */
export interface Winner { grp: string; fund?: string; k?: string[]; ks?: string[]; src?: string; verified?: boolean; fee?: number | null; depfee?: number | null }
export interface Tender {
  id: string; label?: string;
  /** ISO dates: the period in force */
  from: string; to: string;
  /** the price won: % of each deposit, % of assets a year */
  depfee: number | null; fee: number | null;
  /** the price holds for this many years from joining */
  fee_years?: number;
  src: string; src_title?: string; verified: boolean; note?: string;
  winners: Winner[];
  /** how new members are allocated among the winners (2024: by the ID check digit) */
  alloc?: string;
  /** alternative price pairs the tender allows (2024: the conversion table) */
  fee_alt?: { fee: number; depfee: number }[];
}
/** before vs after a tender, per manager (F2 DATA): ₪m deposits / net deposits summed over the window, share = % of all
 *  comprehensive-pension deposits, ret = asset-weighted net annualised % */
export interface DfWin { from: number; to: number; a0?: number | null; a1?: number | null; dep?: number | null; nd?: number | null; share?: number | null; ret?: number | null }
export interface DfRow { tender: string; grp: string; sel: boolean; ks?: string[]; pre?: DfWin; post?: DfWin }
export interface Cap { depfee: number; fee: number; src: string; verified: boolean; note?: string }
export interface DefaultFile { v?: number; asof?: number; method?: string; tenders: Tender[]; caps?: { pension?: Cap; gemel?: Cap }; funds?: DfRow[] }
/** a winner's price: its own when the tender priced winners apart, else the tender's */
export const priceOf = (t: Tender, w?: Winner) => ({ fee: w?.fee ?? t.fee, depfee: w?.depfee ?? t.depfee });
export const isoYm = (d: string) => Number(d.slice(0, 4)) * 100 + Number(d.slice(5, 7));
/** the tenders newest first, keeping only rows that carry the required fields */
export function tendersOf(d: DefaultFile | null | undefined): Tender[] {
  return (d?.tenders ?? []).filter((t) => t && typeof t.id === 'string' && /^\d{4}-\d\d/.test(t.from ?? '') && /^\d{4}-\d\d/.test(t.to ?? '') && Array.isArray(t.winners))
    .sort((a, b) => b.from.localeCompare(a.from));
}
/** the tender in force in month `p` (yyyymm), or the latest one */
export function tenderAt(ts: Tender[], p: number): Tender | null {
  return ts.find((t) => isoYm(t.from) <= p && p <= isoYm(t.to)) ?? ts[0] ?? null;
}

/* ---------- index trackers ---------- */
export type W3 = 'y12' | 'a3' | 'a5';
export const W3S: [W3, string][] = [['y12', 'LTM'], ['a3', '3Y, שנתי'], ['a5', '5Y, שנתי']];
type Per3 = Partial<Record<W3, number | null>>;
export interface TrkTrack { k: string; name: string; grp: string; mgr?: string; prod: string; fee: number | null; depfee?: number | null; assets: number | null; fx?: number | null; g: Per3; nt?: Per3; td: Per3; gone?: boolean }
export interface TrkGroup { id: string; label: string; n: number; med: Per3; med_n?: Per3; tracks: TrkTrack[]; basis_note?: string }
export interface TrackersFile { v?: number; asof: number; method?: string; groups: TrkGroup[] }
/** the minimal track the fallback needs (a funds.json row) */
export interface FundLike { k: string; name: string; grp: string; mgr?: string; prod: string; track: string; fee: number | null; depfee?: number | null; assets: number | null; fx?: number | null;
  y12: number | null; a3: number | null; a5: number | null; net?: Partial<Record<string, number | null>> | null; gone?: boolean }

export const TRK_LABEL: Record<string, string> = { 'עוקב מדד S&P 500': 'S&P 500', 'עוקב מדדי מניות': 'מדדי מניות', 'עוקב מדדים, גמיש': 'מדדים, גמיש', 'עוקב מדדי אג"ח': 'מדדי אג"ח' };
/** the group ids F2 DATA uses in funds/trackers.json, so a link (?g=) means the same group with or without the file */
export const TRK_ID: Record<string, string> = { 'עוקב מדד S&P 500': 'sp500', 'עוקב מדדי מניות': 'eq_idx', 'עוקב מדדים, גמיש': 'flex_idx', 'עוקב מדדי אג"ח': 'bond_idx' };
/** a group holds one index only when its name names one; the others mix indices, so their spread is not only the wrapper */
export const singleIndex = (label: string) => /S&P 500/.test(label);
export const isTracker = (track: string) => /^עוקב/.test(track);
const selfDirected = (name: string) => /בניהול אישי|\bIRA\b/.test(name);

/** The groups from funds.json: every open track with assets whose regulator track name starts "עוקב", grouped by that name.
 *  Median: of the group's published gross return in the window; gap = the track's gross − the median. */
export function trackersFrom(funds: FundLike[], asof: number): TrackersFile {
  const by = new Map<string, FundLike[]>();
  for (const f of funds) if (isTracker(f.track) && f.assets && !selfDirected(f.name)) by.set(f.track, [...(by.get(f.track) ?? []), f]);
  const groups = [...by].map(([track, fs]): TrkGroup => {
    const med: Per3 = {}, med_n: Per3 = {};
    for (const [w] of W3S) {
      med[w] = median(fs.map((f) => f[w]).filter((v): v is number => v != null));
      med_n[w] = median(fs.map((f) => f.net?.[w]).filter((v): v is number => v != null));
    }
    const tracks = fs.map((f): TrkTrack => ({ k: f.k, name: f.name, grp: f.grp, mgr: f.mgr, prod: f.prod, fee: f.fee, depfee: f.depfee ?? null, assets: f.assets, fx: f.fx ?? null,
      g: { y12: f.y12, a3: f.a3, a5: f.a5 }, nt: { y12: f.net?.y12 ?? null, a3: f.net?.a3 ?? null, a5: f.net?.a5 ?? null },
      td: Object.fromEntries(W3S.map(([w]) => [w, f[w] != null && med[w] != null ? f[w]! - med[w]! : null])) as Per3, gone: f.gone }));
    return { id: TRK_ID[track] ?? track, label: TRK_LABEL[track] ?? track.replace(/^עוקב\s*/, ''), n: fs.length, med, med_n, tracks };
  }).sort((a, b) => b.n - a.n);
  return { asof, groups, method: 'funds.json: מסלולים פתוחים עם נכסים ששם המסלול שלהם ברשות מתחיל ב"עוקב", לפי שם המסלול. חציון התשואה ברוטו שפורסמה בחלון; פער = ברוטו של המסלול פחות החציון' };
}

/** least squares slope and intercept of y on x, with n (for a "fee explains the gap" line) */
export function ols(pts: [number, number][]): { a: number; b: number; n: number; r2: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0), syy = pts.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  if (!(sxx > 0)) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, n, r2: syy > 0 ? sxy * sxy / (sxx * syy) : 0 };
}
