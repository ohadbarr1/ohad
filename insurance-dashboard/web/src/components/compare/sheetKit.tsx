/* Track compare, the sheets' shared kit (lane L2-b): the data a sheet loads for its `keys`, the columns' labels and colours, and the
   provenance of every figure a sheet shows (repo convention: a figure is a <Sourced> that opens where it came from).
   - Labels and colours: a private copy of lane L2-a's `pages/compare/tracks.ts` (trackLabels, trackColor) so the sheets build on their
     own; after the merge, this file re-exports that module instead (one import line).
   - Data: funds.json, funds/cat.json and the histories of the keys (lib/fundsLoad useHists: cached, shared with the page). */
import type { ReactNode } from 'react';
import { useFundCats, useFunds, type Fund } from '../../lib/useData';
import { useHists } from '../../lib/fundsLoad';
import { catKey, netMonthIn, netSeries, pc, refOf, shownProv, type Basis, type CatX, type FundX, type FundsFile, type HistX, type Per } from '../../lib/funds';
import { fundP, addMonths } from '../../lib/market';
import { cum } from '../../lib/compareMonths';
import { nf, sn } from '../../lib/format';
import type { Prov } from '../../lib/prov';
import { Sourced } from '../Source';
import '../../styles/compare-sheets.css';

/* ---------- labels and colours (copy of pages/compare/tracks.ts, lane L2-a) ---------- */
export const SHORT_GRP: Record<string, string> = { 'מנורה מבטחים': 'מנורה', 'אלטשולר שחם': 'אלטשולר' };
export const shortGrp = (grp: string) => SHORT_GRP[grp] ?? grp;
type LF = Pick<Fund, 'k' | 'name' | 'grp' | 'prod' | 'track'>;
const STOP = new Set(['-', '–', 'קרן', 'קופת', 'גמל', 'פנסיה', 'מקיפה', 'השתלמות', 'להשקעה', 'מסלול', 'של', 'ביטוח', 'מנהלים', 'פוליסות', 'חיסכון', 'כללי', 'אישית', 'מקפת']);
function distinct(f: LF): string | null {
  const drop = new Set([...f.grp.split(/\s+/), ...f.prod.split(/\s+/), ...f.track.split(/\s+/)]);
  const w = f.name.replace(/[()"]/g, ' ').split(/\s+/).filter((x) => x && !drop.has(x) && !STOP.has(x) && !/^\d+$/.test(x));
  return w.length ? w.slice(0, 2).join(' ') : null;
}
export function trackLabels(funds: (LF | null | undefined)[]): string[] {
  const cat = (f: LF) => `${f.prod} | ${f.track}`;
  return funds.map((f) => {
    if (!f) return '';
    const g = shortGrp(f.grp), same = funds.filter((x): x is LF => !!x && x.grp === f.grp);
    if (same.length < 2) return g;
    if (new Set(same.map(cat)).size > 1 && same.filter((x) => cat(x) === cat(f)).length < 2) return `${g} ${f.track}`;
    const d = distinct(f), others = same.filter((x) => x !== f && cat(x) === cat(f)).map(distinct);
    return d && !others.includes(d) ? `${g} ${d}` : `${g} ${f.k.replace(/^\D+/, '')}`;
  });
}
export const TRACK_VARS = ['--s1', '--s2', '--s4', '--s6', '--s7', '--s8', '--s9', '--s11'];
export const trackColor = (i: number) => `var(${TRACK_VARS[i % TRACK_VARS.length]})`;

/* ---------- data ---------- */
export interface Col { k: string; i: number; f: FundX; h: HistX | null; label: string; color: string }
export interface CmpData {
  file: FundsFile | null; asof: number | null; cats: Record<string, CatX> | null;
  cols: Col[];                         // the keys found in funds.json, column order kept
  cat: CatX | null; ck: string | null; // the category, when every column is in one (else no average and no ranking)
  pending: number; error: string | null;
}
export function useCmpData(keys: string[], enabled = true): CmpData {
  const { data, error } = useFunds(enabled);
  const file = (data as FundsFile | null) ?? null;
  const cats = (useFundCats(enabled).data as Record<string, CatX> | null) ?? null;
  const { hist, pending } = useHists(enabled ? keys : []);
  const fs = keys.map((k) => file?.funds.find((f) => f.k === k) ?? null);
  const labels = trackLabels(fs);
  const cols = keys.flatMap((k, i) => (fs[i] ? [{ k, i, f: fs[i]!, h: hist[k] ?? null, label: labels[i], color: trackColor(i) }] : []));
  const cks = new Set(cols.map((c) => catKey(c.f)));
  const ck = cks.size === 1 ? [...cks][0] : null;
  return { file, asof: file?.asof ?? null, cats, cols, cat: ck && cats ? cats[ck] ?? null : null, ck, pending, error };
}

/* ---------- values ---------- */
/** a track's monthly return in a month on a basis (net: the build's yn, else the client estimate) */
export function monthVal(h: HistX | null, p: number, basis: Basis): number | null {
  if (!h) return null;
  const i = h.p.indexOf(p);
  if (i < 0) return null;
  return basis === 'gross' ? h.y[i] ?? null : netSeries(h).y[i] ?? null;
}
const catSer = (c: CatX, basis: Basis) => (basis === 'gross' ? c.y : c.yn ?? []);
export function catMonth(c: CatX | null, p: number, basis: Basis): number | null {
  if (!c) return null;
  const i = c.p.indexOf(p);
  return i < 0 ? null : catSer(c, basis)[i] ?? null;
}
const backMonths = (asof: number, n: number) => Array.from({ length: n }, (_, i) => addMonths(asof, -i));
const perN = (per: Per, asof: number) => (per === 'm1' ? 1 : per === 'ytd' ? asof % 100 : per === 'y12' ? 12 : per === 'a3' ? 36 : 60);
/** the category average over a window ending at asof: compounded monthly averages, annualised for 3Y/5Y; null when a month is missing */
export function catWin(c: CatX | null, per: Per, asof: number, basis: Basis): number | null {
  if (!c) return null;
  if (per === 'm1') return catMonth(c, asof, basis);  // one month: the published average itself (no compounding round-off: matches the month sheet)
  const n = perN(per, asof), v = cum(backMonths(asof, n).map((m) => catMonth(c, m, basis)));
  return v == null ? null : per === 'a3' || per === 'a5' ? ((1 + v / 100) ** (12 / n) - 1) * 100 : v;
}

/** the 5-year extremes of a track's monthly series (newest 60 months up to asof): worst and best month, and the deepest fall from a peak
 *  with the month of its low */
export function extremes(h: HistX | null, basis: Basis, asof: number) {
  if (!h || !asof) return null;
  const y = basis === 'gross' ? h.y : netSeries(h).y, from = addMonths(asof, -59);
  const xs = h.p.flatMap((p, i) => (p >= from && p <= asof && y[i] != null ? [{ p, v: y[i]! }] : []));
  if (xs.length < 12) return null;
  const worst = xs.reduce((a, b) => (b.v < a.v ? b : a)), best = xs.reduce((a, b) => (b.v > a.v ? b : a));
  let idx = 1, peak = 1, dd = 0, low = xs[0].p, peakP = xs[0].p, ddPeak = xs[0].p;
  for (const x of xs) { idx *= 1 + x.v / 100; if (idx > peak) { peak = idx; peakP = x.p; } const d = idx / peak - 1; if (d < dd) { dd = d; low = x.p; ddPeak = peakP; } }
  return { worst, best, dd: dd * 100, low, ddPeak, from: xs[0].p, n: xs.length };
}

/* ---------- provenance ---------- */
const BASIS_HE = (b: Basis) => (b === 'net' ? 'אחרי דמי ניהול (אומדן)' : 'לפני דמי ניהול');
/** a track's monthly return: the regulator's figure (gross) or the net estimate with its inputs */
export function monthProv(f: FundX, h: HistX | null, p: number, basis: Basis): Prov {
  const r = refOf(f);
  if (basis === 'net' && h) return netMonthIn(r, h, p, netSeries(h)).src();
  return fundP(r, p, 'MONTHLY_YIELD', 'תשואה חודשית', pc(monthVal(h, p, 'gross')));
}
const CAT_F = (ck: string, basis: Basis) => `ממוצע משוקלל בנכסים של התשואה החודשית של כל המסלולים שהיו בסוג "${ck}" באותו חודש (כולל מסלולים שנסגרו מאז), מחושב בבניית הנתונים מקבצי רשות שוק ההון (funds/cat.json)${basis === 'net' ? '. אחרי דמי ניהול: כל מסלול פחות דמי הניהול מצבירה של אותו חודש ÷ 12 (אומדן)' : ''}`;
const ymL = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
/** the category's average in one month */
export function catMonthProv(ck: string, c: CatX, p: number, basis: Basis): Prov {
  const v = catMonth(c, p, basis), i = c.p.indexOf(p), n = i < 0 ? null : (basis === "net" ? (c as CatX & { nn?: number[] }).nn?.[i] ?? c.n[i] : c.n[i]);
  return { k: 'calc', est: basis === 'net', title: `ממוצע הסוג · ${ck} · ${ymL(p)} · ${BASIS_HE(basis)}`, value: pc(v), formula: CAT_F(ck, basis), inputs: n == null ? [] : [{ label: 'מסלולים בממוצע באותו חודש', v: String(n) }] };
}
/** the category's average over a window */
export function catWinProv(ck: string, c: CatX, per: Per, asof: number, basis: Basis): Prov {
  const n = perN(per, asof), v = catWin(c, per, asof, basis);
  return { k: 'calc', est: basis === 'net', title: `ממוצע הסוג · ${ck} · ${n} חודשים עד ${ymL(asof)}${per === 'a3' || per === 'a5' ? ', בשנה' : ''}`, value: pc(v, per === 'm1' ? 2 : 1),
    formula: `(1 + ממוצע חודש₁) × … × (1 + ממוצע חודש${n === 1 ? '₁' : `₍${n}₎`}) − 1${per === 'a3' || per === 'a5' ? ', בחזקת 12 ÷ מספר החודשים (שנתי)' : ''}. ממוצע חודש: ${CAT_F(ck, basis)}`,
    inputs: backMonths(asof, n).reverse().map((m) => ({ label: `ממוצע הסוג · ${ymL(m)}`, v: pc(catMonth(c, m, basis)), src: () => catMonthProv(ck, c, m, basis) })) };
}
/** a published window of a track (net or gross) */
export const winProv = (f: FundX, per: Per, basis: Basis, asof: number, file?: FundsFile | null) => shownProv(f, per, basis, false, asof, undefined, file ?? undefined);

/* ---------- figures ---------- */
const MINUS = '−';
/** "+1.2%" / "−0.73%" with U+2212 */
export const sgn = (v: number, d: number, unit = '%') => `${sn(v, d).replace('-', MINUS)}${unit}`;
/** a signed figure that opens its source; "–" when missing */
export function Fig({ v, d = 2, src, className = '', unit = '%', tone = true }: { v: number | null | undefined; d?: number; src?: () => Prov; className?: string; unit?: string; tone?: boolean }) {
  if (v == null || !Number.isFinite(v)) return <span className={`n ${className}`.trim()}>–</span>;
  const cls = `n ${tone ? (Number(v.toFixed(d)) > 0 ? 'pos' : Number(v.toFixed(d)) < 0 ? 'neg' : '') : ''} ${className}`.replace(/\s+/g, ' ').trim();
  const t = sgn(v, d, unit);
  return src ? <Sourced src={src} className={cls}>{t}</Sourced> : <bdi dir="ltr" className={cls}>{t}</bdi>;
}
/** an unsigned figure (a fee, a share) that opens its source */
export function Plain({ v, d = 2, unit = '%', src, className = '' }: { v: number | null | undefined; d?: number; unit?: string; src?: () => Prov; className?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className={`n ${className}`.trim()}>–</span>;
  const t = `${nf(v, d)}${unit}`;
  return src ? <Sourced src={src} className={`n ${className}`.trim()}>{t}</Sourced> : <bdi dir="ltr" className={`n ${className}`.trim()}>{t}</bdi>;
}
/** the plain bullets of a sheet ("facts") */
export const Facts = ({ items, id }: { items: ReactNode[]; id?: string }) => (
  <ul className="cs-facts" id={id}>{items.filter(Boolean).map((x, i) => <li key={i}><span>{x}</span></li>)}</ul>
);
