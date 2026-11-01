import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Fund, FundHist } from './useData';
import type { Prov } from './prov';
import { addMonths, dsOf, fundP, monthIn, monthsBack, ymLabel, type TrackRef } from './market';
import { seriesProv, type CpiSeries } from './macro';
import { nf, sn } from './format';
import { useStored } from './local';

/* The funds module ("חיסכון", wave F1): the shared logic of the hub, the screener, the head-to-head and the track card.
   - Net of fee. The regulator's returns are published before the management fee. The data build (F1 DATA) adds `net` per track,
     an estimate (monthly gross return minus that month's accumulation fee ÷ 12, compounded). Until a file carries it the pages fall
     back: a track's own history gives a client-side estimate the same way (labelled "נטו, אומדן"); a table with no history shows
     gross, labelled "ברוטו". Net and gross are never ranked together.
   - Real. CPI-deflated with the CBS monthly changes in macro/macro.json, or the build's `real` / `realn` when present.
   - Every new field is optional: the pages work on today's files. */

export type Per = 'm1' | 'ytd' | 'y12' | 'a3' | 'a5';
export const PERIODS: [Per, string][] = [['m1', '1M'], ['ytd', 'YTD'], ['y12', 'LTM'], ['a3', '3Y'], ['a5', '5Y']];
export const PER_LABEL: Record<Per, string> = { m1: 'תשואה חודשית', ytd: 'תשואה YTD', y12: 'תשואה LTM', a3: 'תשואה שנתית ממוצעת, 3 שנים', a5: 'תשואה שנתית ממוצעת, 5 שנים' };
export const PER_COL: Partial<Record<Per, string>> = { m1: 'MONTHLY_YIELD', ytd: 'YEAR_TO_DATE_YIELD', a3: 'AVG_ANNUAL_YIELD_TRAILING_3YRS', a5: 'AVG_ANNUAL_YIELD_TRAILING_5YRS' };
/** months behind a window ending in `asof` */
export const perMonths = (per: Per, asof: number) => (per === 'm1' ? 1 : per === 'ytd' ? asof % 100 : per === 'y12' ? 12 : per === 'a3' ? 36 : 60);
export const annual = (per: Per) => per === 'a3' || per === 'a5';

export type Basis = 'net' | 'gross';
type PerSet = Partial<Record<Per | 'y3' | 'y5', number | null>>;
/** the official taxonomy (data.gov.il transfer_bank), when the build joined it */
export interface Tx { type?: string | null; spec?: string | null; sub?: string | null; src?: 'tb' | 'name'; dis?: boolean; tb?: number | string | null }
/** a track with the optional fields of the F1 data contract */
export interface FundX extends Fund {
  net?: PerSet | null; real?: PerSet | null; realn?: PerSet | null;
  /** percentile in the category, 100 = best (gross / net), and the peers counted per window */
  pr?: PerSet | null; pn?: PerSet | null; prn?: PerSet | null; pnn?: PerSet | null;
  pr1?: PerSet | null; pn1?: PerSet | null; fee1?: number | null;
  alpha?: number | null; act?: number | null; act_p?: number | null; end_ap?: number | null; nd?: number | null; nd12?: number | null; pid?: number | string | null; mgr_id?: number | string | null;
  tx?: Tx | null; gone?: boolean; end?: number; end_assets?: number | null;
  /** W2: the last eight published quarters of the actuarial balance, [yyyymm, %] oldest first (pension only) */
  act_h?: [number, number][] | null;
}
export interface FundsFile { asof: number; source: string; funds: FundX[]; net_method?: string; real_method?: string; cpi_asof?: number; closed_n?: number }
export interface HistX extends FundHist { yn?: (number | null)[]; act?: (number | null)[]; nd?: (number | null)[]; cat?: (string | null)[] }
export interface CatX { p: number[]; y: number[]; n: number[]; ys?: number[]; ns?: number[]; yn?: (number | null)[] }

export const catKey = (f: Pick<Fund, 'prod' | 'track'>) => `${f.prod} | ${f.track}`;
export const refOf = (f: Pick<Fund, 'fam' | 'id' | 'name'>): TrackRef => ({ ds: dsOf(f.fam), id: f.id, name: f.name });
export const pc = (v: number | null | undefined, d = 2) => (v == null ? '–' : sn(v, d) + '%');
export const ym = ymLabel;
export const NET_F = 'תשואה חודשית ברוטו (MONTHLY_YIELD) פחות דמי הניהול מצבירה של אותו חודש (AVG_ANNUAL_MANAGEMENT_FEE) חלקי 12, בריבית דריבית על חודשי החלון; 3Y ו-5Y: שנתי';
export const NET_NOTE = 'אומדן: דמי הניהול הם הממוצע בפועל של המסלול, ודמי ניהול שמשלם חוסך מסוים שונים. דמי ניהול מהפקדה פועלים על ההפקדות ואינם נכללים';
export const NET_LABEL = 'נטו, אומדן';
export const GROSS_LABEL = 'ברוטו';

/* ---------- basis, real and the compare tray: one preference for the whole section ---------- */

/** Net or gross for the section: the URL (`b=gross|net`) when present, else the stored choice (net by default). */
export function useBasis(): [Basis, (b: Basis) => void] {
  const [sp, setSp] = useSearchParams();
  const [stored, setStored] = useStored<Basis>('funds:basis', 'net');
  // `net=1` / `net=0` (the links of the standing questions) mean the same as b=net / b=gross
  const u = sp.get('b') ?? (sp.get('net') === '1' ? 'net' : sp.get('net') === '0' ? 'gross' : null);
  const b: Basis = u === 'gross' || u === 'net' ? u : stored;
  const set = useCallback((x: Basis) => { setStored(x); if (sp.has('b') || sp.has('net')) { const n = new URLSearchParams(sp); n.delete('net'); n.set('b', x); setSp(n, { replace: true }); } }, [sp, setSp, setStored]);
  return [b, set];
}
/** Real (CPI-deflated) or nominal: the URL (`real=1`) or the stored choice (nominal by default). */
export function useReal(): [boolean, (r: boolean) => void] {
  const [sp, setSp] = useSearchParams();
  const [stored, setStored] = useStored<boolean>('funds:real', false);
  const u = sp.get('real');
  const r = u === '1' ? true : u === '0' ? false : stored;
  const set = useCallback((x: boolean) => { setStored(x); if (sp.has('real')) { const n = new URLSearchParams(sp); n.set('real', x ? '1' : '0'); setSp(n, { replace: true }); } }, [sp, setSp, setStored]);
  return [r, set];
}

const TRAY = 'fox:cmp', TRAY_EVENT = 'fox:cmp';
export const TRAY_MAX = 8;  // W1-agent: up to eight tracks (was four)
const readTray = (): string[] => { try { const v = JSON.parse(sessionStorage.getItem(TRAY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, TRAY_MAX) : []; } catch { return []; } };
/** The compare tray: up to TRAY_MAX tracks, kept for this tab (sessionStorage) while the reader moves between pages. */
export function useTray(): { keys: string[]; has: (k: string) => boolean; toggle: (k: string) => void; set: (ks: string[]) => void; clear: () => void } {
  const [keys, setKeys] = useState<string[]>(readTray);
  useEffect(() => { const on = () => setKeys(readTray()); addEventListener(TRAY_EVENT, on); return () => removeEventListener(TRAY_EVENT, on); }, []);
  const set = useCallback((ks: string[]) => { const v = [...new Set(ks)].slice(-TRAY_MAX); try { sessionStorage.setItem(TRAY, JSON.stringify(v)); } catch { /* blocked */ } setKeys(v); dispatchEvent(new Event(TRAY_EVENT)); }, []);
  return { keys, has: (k) => keys.includes(k), toggle: (k) => set(keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k]), set, clear: () => set([]) };
}

/* ---------- the value a page shows: net or gross, nominal or real ---------- */

export interface RV { v: number | null; b: Basis; est: boolean }
/** does the file carry net returns at all (else every table runs gross, labelled) */
export const hasNet = (fs: FundX[]) => fs.some((f) => f.net && Object.values(f.net).some((v) => v != null));
/** The return of a window on the effective basis. With net asked and published for the file, a track without a net figure for the
 *  window gets null (not its gross: the two are never ranked together). */
export function retOf(f: FundX, per: Per, basis: Basis): RV {
  if (basis === 'net') return { v: f.net?.[per] ?? null, b: 'net', est: true };
  return { v: f[per], b: 'gross', est: false };
}

/** CPI: the product of (1 + monthly change) over the n months that end in `asof` (yyyymm), or null when the series does not cover them. */
export function cpiFactor(cpi: CpiSeries | undefined, asof: number, n: number): { f: number; months: { m: string; mom: number }[] } | null {
  if (!cpi) return null;
  const at = new Map(cpi.points.filter((p) => p.mom != null).map((p) => [p.m, p.mom as number]));
  const months = monthsBack(asof, n).map((p) => { const m = `${Math.floor(p / 100)}-${String(p % 100).padStart(2, '0')}`; return { m, mom: at.get(m) }; });
  if (months.some((x) => x.mom == null)) return null;
  return { f: months.reduce((t, x) => t * (1 + x.mom! / 100), 1), months: months as { m: string; mom: number }[] };
}
/** a nominal return of a window made real: cumulative windows divide, annualised ones divide the compounded total and annualise back */
export function toReal(nom: number | null, per: Per, asof: number, cpi: CpiSeries | undefined): number | null {
  if (nom == null) return null;
  const n = perMonths(per, asof), c = cpiFactor(cpi, asof, n);
  if (!c) return null;
  if (!annual(per)) return ((1 + nom / 100) / c.f - 1) * 100;
  const yrs = n / 12;
  return (((1 + nom / 100) ** yrs / c.f) ** (1 / yrs) - 1) * 100;
}
/** real on the basis: the build's figure (`real` gross, `realn` net) when present, else deflated here */
export function realOf(f: FundX, per: Per, basis: Basis, asof: number, cpi: CpiSeries | undefined): { v: number | null; pub: boolean } {
  const pub = (basis === 'net' ? f.realn : f.real)?.[per];
  if (pub != null) return { v: pub, pub: true };
  return { v: toReal(retOf(f, per, basis).v, per, asof, cpi), pub: false };
}

/* ---------- sources ---------- */

/** The published (gross) return of a window: a regulator column, or LTM compounded from the 12 monthly returns. */
export function grossProv(f: FundX, per: Per, asof: number): Prov {
  const r = refOf(f);
  if (per === 'y12') return { k: 'calc', title: `תשואה LTM · ${f.name}`, value: pc(f.y12), formula: '(1 + r₁) × … × (1 + r₁₂) − 1 על 12 התשואות החודשיות האחרונות (MONTHLY_YIELD)', inputs: monthsBack(asof, 12).map((p) => monthIn(r, 'y', p)) };
  return fundP(r, asof, PER_COL[per]!, PER_LABEL[per], pc(f[per]));
}
/** A net figure: the method, then the months of gross return and fee behind it (values from the track's history when loaded). */
export function netProv(f: FundX, per: Per, asof: number, v: number | null, method?: string): Prov {
  const r = refOf(f), ms = monthsBack(asof, perMonths(per, asof));
  return { k: 'calc', est: true, title: `${PER_LABEL[per]}, ${NET_LABEL} · ${f.name}`, value: pc(v), formula: method || NET_F, note: NET_NOTE,
    inputs: [{ label: `${PER_LABEL[per]}, ברוטו`, v: pc(f[per]), src: () => grossProv(f, per, asof) }, ...ms.flatMap((p) => [monthIn(r, 'y', p), monthIn(r, 'fee', p)])] };
}
/** CPI over the window as a figure with its source */
export function cpiProv(cpi: CpiSeries, asof: number, n: number): Extract<Prov, { k: 'calc' }> | null {
  const c = cpiFactor(cpi, asof, n);
  if (!c) return null;
  return { k: 'calc', title: `מדד המחירים לצרכן, ${n} חודשים עד ${ym(asof)}`, value: pc((c.f - 1) * 100), formula: 'מכפלת (1 + השינוי החודשי שפרסמה הלמ"ס) על חודשי החלון. השינוי החודשי מפורסם מעוגל ל-0.1%',
    inputs: c.months.map((x) => ({ label: `${x.m.slice(5)}/${x.m.slice(2, 4)}`, v: pc(x.mom, 1), src: () => seriesProv(cpi, pc(x.mom, 1), `${x.m.slice(5)}/${x.m.slice(2, 4)}`) })) };
}
export function realProv(f: FundX, per: Per, basis: Basis, asof: number, cpi: CpiSeries | undefined, method?: string): Prov {
  const r = realOf(f, per, basis, asof, cpi), nom = retOf(f, per, basis).v, n = perMonths(per, asof);
  const nomSrc = () => (basis === 'net' ? netProv(f, per, asof, nom) : grossProv(f, per, asof));
  const cp = cpi ? cpiProv(cpi, asof, n) : null;
  return { k: 'calc', est: basis === 'net', title: `${PER_LABEL[per]}, ריאלי${basis === 'net' ? ', נטו' : ''} · ${f.name}`, value: pc(r.v),
    formula: r.pub ? (method || 'מחושב בבניית הנתונים: התשואה הנומינלית מנוכה במדד המחירים לצרכן של חודשי החלון') : annual(per) ? '((1 + שנתי נומינלי) בחזקת השנים ÷ מדד החלון) בחזקת 1 ÷ השנים, פחות 1' : '(1 + תשואה נומינלית) ÷ (1 + שינוי המדד בחלון) − 1',
    inputs: [{ label: `נומינלי${basis === 'net' ? ', נטו' : ''}`, v: pc(nom), src: nomSrc }, ...(cp ? [{ label: `מדד המחירים, ${n} חודשים`, v: cp.value, src: () => cp }] : [])] };
}
/** the figure a page shows for a window, with its source: net, gross or real */
export function shownProv(f: FundX, per: Per, basis: Basis, real: boolean, asof: number, cpi: CpiSeries | undefined, file?: FundsFile): Prov {
  if (real) return realProv(f, per, basis, asof, cpi, file?.real_method);
  return basis === 'net' ? netProv(f, per, asof, retOf(f, per, 'net').v, file?.net_method) : grossProv(f, per, asof);
}

/* ---------- histories: net series, statistics, rolling, drawdown, win-rate ---------- */

/** Monthly net returns of a track: the build's `yn` when present, else gross minus that month's fee ÷ 12. A month with no fee
 *  published takes the last fee before it (or, before the first one, the first fee published); `filled` counts those months. */
export function netSeries(h: HistX): { y: (number | null)[]; pub: boolean; filled: number; fee: (number | null)[] } {
  if (h.yn && h.yn.length === h.p.length) return { y: h.yn, pub: true, filled: 0, fee: h.fee };
  const first = h.fee.find((x) => x != null) ?? null;
  let last: number | null = null, filled = 0;
  const fee = h.fee.map((x) => { if (x != null) { last = x; return x; } filled++; return last ?? first; });
  return { y: h.y.map((r, i) => (r == null || fee[i] == null ? null : r - fee[i]! / 12)), pub: false, filled, fee };
}
export const NET_EST_F = 'תשואה חודשית ברוטו (MONTHLY_YIELD) פחות דמי ניהול מצבירה של אותו חודש ÷ 12. חודש בלי דמי ניהול שפורסמו: דמי הניהול האחרונים לפניו';
/** a month of net return as an input row */
export function netMonthIn(f: TrackRef, h: HistX, p: number, ns: ReturnType<typeof netSeries>) {
  const i = h.p.indexOf(p), v = i < 0 ? null : ns.y[i];
  return { label: `תשואה חודשית נטו · ${ym(p)}`, v: pc(v), src: (): Prov => ({ k: 'calc', est: true, title: `תשואה חודשית, ${NET_LABEL} · ${f.name} · ${ym(p)}`, value: pc(v), formula: ns.pub ? 'מחושב בבניית הנתונים: ' + NET_EST_F : NET_EST_F, note: NET_NOTE,
    inputs: [monthIn(f, 'y', p, i < 0 ? null : h.y[i]), { label: `דמי ניהול מצבירה · ${ym(p)}${i >= 0 && h.fee[i] == null ? ' (הקודם שפורסם)' : ''}`, v: i < 0 || ns.fee[i] == null ? '–' : nf(ns.fee[i]!, 2) + '%', src: () => fundP(f, p, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', i < 0 || h.fee[i] == null ? '–' : nf(h.fee[i]!, 2) + '%') }] }) };
}

/** the return of a window from a monthly series ending in `asof` (annualised for 3Y/5Y); null when a month is missing */
export function winRet(h: { p: number[] }, y: (number | null)[], per: Per, asof: number): number | null {
  const ms = monthsBack(asof, perMonths(per, asof));
  let f = 1;
  for (const p of ms) { const i = h.p.indexOf(p); const r = i < 0 ? null : y[i]; if (r == null) return null; f *= 1 + r / 100; }
  return ((annual(per) ? f ** (12 / ms.length) : f) - 1) * 100;
}

export interface Stats { ret: number; ann: number; vol: number; dd: number; best: number; worst: number; months: number }
/** Compounded return, annualised volatility and the deepest fall over the last `n` monthly returns. */
export function stats(y: (number | null)[], n: number): Stats | null {
  const s = y.slice(-n).filter((x): x is number => x != null);
  if (s.length < Math.min(n, 3)) return null;
  let idx = 1, peak = 1, dd = 0;
  s.forEach((r) => { idx *= 1 + r / 100; peak = Math.max(peak, idx); dd = Math.min(dd, idx / peak - 1); });
  const mean = s.reduce((t, r) => t + r, 0) / s.length;
  const sd = Math.sqrt(s.reduce((t, r) => t + (r - mean) ** 2, 0) / Math.max(1, s.length - 1));
  return { ret: (idx - 1) * 100, ann: (idx ** (12 / s.length) - 1) * 100, vol: sd * Math.sqrt(12), dd: dd * 100, best: Math.max(...s), worst: Math.min(...s), months: s.length };
}
/** values of a monthly series on an axis of months */
export const onAxis = (axis: number[], p: number[], y: (number | null)[]) => { const at = new Map(p.map((x, i) => [x, y[i]])); return axis.map((x) => at.get(x) ?? null); };
/** growth of `base` over an axis: the first month is the base (end of that month), each later month compounds its return */
export function growth(axis: number[], y: (number | null)[], base = 100): (number | null)[] {
  let idx = base, broken = false;
  return axis.map((_, i) => { if (i === 0) return base; const r = y[i]; if (r == null || broken) { broken = true; return null; } idx *= 1 + r / 100; return +idx.toFixed(2); });
}
/** rolling n-month return ending at each month (annualised when n > 12); null until n months are in */
export function rolling(y: (number | null)[], n: number): (number | null)[] {
  return y.map((_, i) => {
    if (i + 1 < n) return null;
    let f = 1;
    for (let j = i - n + 1; j <= i; j++) { const r = y[j]; if (r == null) return null; f *= 1 + r / 100; }
    return +(((n > 12 ? f ** (12 / n) : f) - 1) * 100).toFixed(3);
  });
}
/** underwater: the fall from the running peak of the compounded index, % (0 at a new high) */
export function underwater(y: (number | null)[]): (number | null)[] {
  let idx = 1, peak = 1;
  return y.map((r) => { if (r == null) return null; idx *= 1 + r / 100; peak = Math.max(peak, idx); return +((idx / peak - 1) * 100).toFixed(2); });
}
/** In how many of the rolling n-month windows (both with every month published) A's compounded return beat B's. */
export function winRate(a: (number | null)[], b: (number | null)[], n: number): { won: number; of: number; first: number | null; last: number | null } {
  const ra = rolling(a, n), rb = rolling(b, n);
  let won = 0, of = 0, first: number | null = null, last: number | null = null;
  ra.forEach((x, i) => { const y = rb[i]; if (x == null || y == null) return; of++; if (x > y) won++; if (first == null) first = i; last = i; });
  return { won, of, first, last };
}
/** compounded calendar-year returns of a series; `n` = months published in the year */
export function byYear(p: number[], y: (number | null)[]): Map<number, { r: number; n: number; ps: number[] }> {
  const m = new Map<number, { f: number; n: number; ps: number[] }>();
  p.forEach((x, i) => { const r = y[i]; if (r == null) return; const yr = Math.floor(x / 100), e = m.get(yr) ?? { f: 1, n: 0, ps: [] }; e.f *= 1 + r / 100; e.n++; e.ps.push(x); m.set(yr, e); });
  return new Map([...m].map(([k, e]) => [k, { r: (e.f - 1) * 100, n: e.n, ps: e.ps }]));
}

/* ---------- ranks and percentiles ---------- */

/** Ordinal rank and percentile of each track among `peers` on a value (higher is better). Percentile: the share of the other
 *  ranked tracks with a lower value, 100 = best. Tracks with no value are not ranked. */
export function rankAll<T extends { k: string }>(peers: T[], val: (f: T) => number | null): Map<string, { rank: number; n: number; pct: number | null }> {
  const r = peers.map((f) => ({ k: f.k, v: val(f) })).filter((x): x is { k: string; v: number } => x.v != null).sort((a, b) => b.v - a.v);
  const n = r.length, out = new Map<string, { rank: number; n: number; pct: number | null }>();
  r.forEach((x) => { const above = r.filter((y) => y.v > x.v).length, below = r.filter((y) => y.v < x.v).length, ties = n - above - below - 1;
    out.set(x.k, { rank: above + 1, n, pct: n >= PCT_MIN ? Math.round((below + ties / 2) / (n - 1) * 100) : null }); });
  return out;
}
export const PCT_MIN = 5;
export const PCT_F = 'אחוזון = (מסלולים אחרים בקטגוריה עם תשואה נמוכה יותר בחלון + חצי מהשווים) ÷ (מספר המדורגים − 1) × 100, מעוגל. 100 = הגבוה בקטגוריה. רק בקטגוריה של 5 מדורגים לפחות';
export function pctProv(f: FundX, per: Per, basis: Basis, r: { rank: number; n: number; pct: number | null }, src: () => Prov, pub = false): Prov {
  return { k: 'calc', title: `אחוזון בקטגוריה · ${PER_LABEL[per]}${basis === 'net' ? ', נטו' : ''} · ${f.name}`, value: r.pct == null ? '–' : nf(r.pct, 0), formula: pub ? 'מחושב בבניית הנתונים. ' + PCT_F : PCT_F,
    inputs: [{ label: PER_LABEL[per], v: '', src }, { label: 'מקום', v: `${r.rank} מתוך ${r.n}` }, { label: 'מסלולים מדורגים', v: nf(r.n, 0) }] };
}

/* ---------- taxonomy: what a track holds, not only its name ---------- */

export type FamKey = 'equity' | 'general' | 'age' | 'bonds' | 'cash' | 'index' | 'halacha' | 'esg' | 'annuitant' | 'other';
export const FAMS: [FamKey, string][] = [['general', 'כללי ומשולב'], ['equity', 'מניות'], ['age', 'תלוי גיל'], ['index', 'עוקבי מדד'], ['bonds', 'אג"ח ואשראי'], ['cash', 'כספי'], ['halacha', 'הלכה'], ['esg', 'קיימות'], ['annuitant', 'מקבלי קצבה'], ['other', 'אחר']];
export const FAM_LABEL = Object.fromEntries(FAMS) as Record<FamKey, string>;
/** the family of a regulator track name (the 25 names of the data): a pattern on the name, labelled as such */
export function famOf(track: string): FamKey {
  if (/^עוקב/.test(track)) return 'index';
  if (/^(עד 50|50-60|60 ומעלה)$/.test(track)) return 'age';
  if (/מקבלי קצבה/.test(track)) return 'annuitant';
  if (/הלכה/.test(track)) return 'halacha';
  if (/קיימות/.test(track)) return 'esg';
  if (/כספי|שקלי/.test(track)) return 'cash';
  if (/^מניות|סיכון גבוה/.test(track)) return 'equity';
  if (/אג"ח|אשראי|ללא מניות|סיכון מועט/.test(track)) return 'bonds';
  if (/כללי|משולב|סיכון בינוני/.test(track)) return 'general';
  return 'other';
}
export const FAM_F = 'משפחה לפי שם המסלול ברשות (כללי, מניות, עד 50…): סיווג לפי שם, לא לפי הרכב';

/** Equity exposure of a category: median and standard deviation over its tracks (n ≥ 5), to flag a track whose label hides its risk. */
export function equitySpread(fs: FundX[]): Map<string, { med: number; sd: number; n: number }> {
  const by = new Map<string, number[]>();
  fs.forEach((f) => { if (f.st != null && f.assets) { const k = catKey(f); by.set(k, [...(by.get(k) ?? []), f.st]); } });
  const out = new Map<string, { med: number; sd: number; n: number }>();
  by.forEach((xs, k) => {
    if (xs.length < 5) return;
    const s = [...xs].sort((a, b) => a - b), n = s.length, med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
    const mean = s.reduce((t, x) => t + x, 0) / n, sd = Math.sqrt(s.reduce((t, x) => t + (x - mean) ** 2, 0) / (n - 1));
    out.set(k, { med, sd, n });
  });
  return out;
}
export const OUTLIER_SD = 1.5;
export function equityOutlier(f: FundX, spread: Map<string, { med: number; sd: number; n: number }>): { z: number; med: number; n: number; sd: number } | null {
  const s = spread.get(catKey(f));
  if (!s || f.st == null || !(s.sd > 0)) return null;
  const z = (f.st - s.med) / s.sd;
  return Math.abs(z) > OUTLIER_SD ? { z, med: s.med, n: s.n, sd: s.sd } : null;
}
export function outlierProv(f: FundX, o: { z: number; med: number; n: number; sd: number }, stSrc: () => Prov): Prov {
  return { k: 'calc', title: `חשיפה למניות מול הקטגוריה · ${f.name}`, value: `${sn(o.z, 1)} ס"ת`, formula: `(חשיפת המסלול למניות − החציון בקטגוריה) ÷ סטיית התקן בקטגוריה. מסומן מעל ${OUTLIER_SD} סטיות תקן`,
    inputs: [{ label: 'חשיפה למניות', v: f.st == null ? '–' : nf(f.st, 1) + '%', src: stSrc }, { label: `חציון ${f.track} (${f.prod})`, v: nf(o.med, 1) + '%' }, { label: 'סטיית תקן בקטגוריה', v: nf(o.sd, 1) }, { label: 'מסלולים', v: nf(o.n, 0) }] };
}

/* ---------- small helpers ---------- */
/** a personally managed track (ניהול אישי / IRA): the saver picks the securities; its published return is not a manager's result (often 0) */
export const selfDirected = (f: Pick<Fund, 'name'>) => /בניהול אישי|\bIRA\b/.test(f.name);
export const SELF_NOTE = 'מסלולים בניהול אישי (IRA) אינם מדורגים: החוסך בוחר את ההשקעות, והתשואה המפורסמת אינה תוצאה של מנהל';
export const prevMonth = (p: number) => addMonths(p, -1);
/** YTD at the end of the previous month, from this month's YTD and monthly return (same year only) */
export const ytdPrev = (f: Pick<Fund, 'ytd' | 'm1'>, asof: number): number | null => (asof % 100 === 1 || f.ytd == null || f.m1 == null ? null : ((1 + f.ytd / 100) / (1 + f.m1 / 100) - 1) * 100);
