import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { load, useFunds, useLoad } from './useData';
import { useStored } from './local';
import { useCurve } from './macro';
import { catKey, netSeries, selfDirected, type Basis, type FundX, type HistX } from './funds';
import { NO_WATCH, rfFromCurve, normGlide, normPersist, normWatch, slugOf, watchBadge, type RankFile, type StatsFile, type StatsIndex, type WSnap, type WatchStore } from './fundsTime';
import { EXPLAIN } from '../components/Explain';

/* F2 TIME: the loaders of the precomputed files (absent until the DATA build ships them: every hook returns null then, never an error the
   page must show), the category's members and their histories for the browser's own computation, the BoI rate, and the watchlist. */

/** a file that may not be published yet: null while loading or when absent */
function useOptional<T>(path: string | null): { data: T | null; missing: boolean } {
  const r = useLoad<T>(path);
  return { data: r.data, missing: !!path && !!r.error };
}
export const useStatsIndex = () => useOptional<StatsIndex>('funds/stats/index.json');
/** the precomputed files of a category (cat.json key), through the published index */
export function useCatFiles(cat: string | null, want: { stats?: boolean; rank?: boolean } = { stats: true, rank: true }) {
  const idx = useStatsIndex();
  const row = cat ? slugOf(idx.data, cat) : null;
  const stats = useOptional<StatsFile>(row && want.stats && row.stats !== false ? `funds/stats/${row.slug}.json` : null);
  const rank = useOptional<RankFile>(row && want.rank && row.rank !== false ? `funds/rank/${row.slug}.json` : null);
  const settled = idx.missing || (!!idx.data && (!row || ((!want.stats || row.stats === false || stats.data || stats.missing) && (!want.rank || row.rank === false || rank.data || rank.missing))));
  return { idx: idx.data, row, stats: stats.data, rank: rank.data, settled: !!settled };
}
export function usePersist() { const r = useOptional<unknown>('funds/persist.json'); return { data: useMemo(() => (r.data ? normPersist(r.data) : null), [r.data]), missing: r.missing }; }
export function useGlide() { const r = useOptional<unknown>('funds/glide.json'); return { data: useMemo(() => (r.data ? normGlide(r.data) : null), [r.data]), missing: r.missing }; }

/** closed tracks (funds/closed.json), for the questions that are historical (survivorship): loaded only when asked */
export function useClosed(enabled: boolean): FundX[] | null {
  const r = useLoad<{ funds: FundX[] }>(enabled ? 'funds/closed.json' : null);
  return useMemo(() => (r.data ? (r.data.funds ?? []).map((f) => ({ ...f, gone: true })) : r.error ? [] : null), [r.data, r.error]);
}

/** the members of a category: the tracks open to everyone (no self-directed; branch funds, קופות ענפיות, only with `branch`) and the closed ones */
export function membersOf(fs: FundX[], closed: FundX[] | null, cat: string, branch = false): FundX[] {
  const ok = (f: FundX) => catKey(f) === cat && (branch || !f.closed) && !selfDirected(f);
  const live = fs.filter(ok), ks = new Set(live.map((f) => f.k));
  return [...live, ...(closed ?? []).filter((f) => ok(f) && !ks.has(f.k))];
}
/** include the branch funds (קופות ענפיות, closed to the public): `br=1` in the URL; off by default, as in the F1 ranking */
export function useBranch(): [boolean, (v: boolean) => void] {
  const [sp, setSp] = useSearchParams();
  const on = sp.get('br') === '1';
  const set = useCallback((v: boolean) => { const n = new URLSearchParams(sp); if (v) n.set('br', '1'); else n.delete('br'); setSp(n, { replace: true }); }, [sp, setSp]);
  return [on, set];
}

/** histories of many tracks, fetched as they are asked for (each file once): { k → history }, and how many are still on their way */
export function useHists(keys: string[]): { h: Record<string, HistX>; pending: number } {
  const [h, setH] = useState<Record<string, HistX>>({});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const key = keys.join(',');
  useEffect(() => {
    let live = true;
    keys.filter((k) => !h[k] && !failed.has(k)).forEach((k) => load<HistX>(`funds/${k}.json`).then((x) => live && setH((c) => ({ ...c, [k]: x })), () => live && setFailed((c) => new Set(c).add(k))));
    return () => { live = false; };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return { h, pending: keys.filter((k) => !h[k] && !failed.has(k)).length };
}
/** a history's monthly returns on the basis (net: the build's `yn`, else gross minus each month's fee ÷ 12) */
export const yOf = (h: HistX, b: Basis) => (b === 'net' ? netSeries(h).y : h.y);

/** the monthly risk-free rate the build uses (BoI 1-year nominal zero-coupon, macro/boi_curve.json), carried forward to `asof` */
export function useRf(asof: number | null | undefined) {
  const c = useCurve().data;
  return useMemo(() => (c && asof ? rfFromCurve(c, asof) : null), [c, asof]);
}

/** The category of a page: `cat` in the URL ("השתלמות | כללי"), else the default. */
export function useCat(def = 'השתלמות | כללי'): [string, (c: string) => void] {
  const [sp, setSp] = useSearchParams();
  const c = sp.get('cat') || def;
  const set = useCallback((x: string) => { const n = new URLSearchParams(sp); n.set('cat', x); setSp(n, { replace: true }); }, [sp, setSp]);
  return [c, set];
}

/* ---------- the watchlist ---------- */
export const WATCH_KEY = 'funds:watch';
export function useWatch(): [WatchStore, (w: WatchStore) => void] {
  const [raw, set] = useStored<unknown>(WATCH_KEY, NO_WATCH);
  const w = useMemo(() => normWatch(raw), [raw]);
  return [w, set as (w: WatchStore) => void];
}
/** what the reader sees of a track now, on the basis: the month's return, its LTM percentile and peers, its 3Y percentile, its fee */
export function snapOf(f: FundX, asof: number, basis: Basis): WSnap {
  const net = basis === 'net';
  return { asof, b: basis, m1: net ? f.net?.m1 ?? null : f.m1, pct: (net ? f.pn : f.pr)?.y12 ?? null, pctN: (net ? f.pnn : f.prn)?.y12 ?? null, pct3: (net ? f.pn : f.pr)?.a3 ?? null, fee: f.fee };
}
/** The badge on the section tab: watched tracks with a regulator month newer than the last look. The month comes from the small stats
 *  index; on the funds pages (which hold funds.json anyway) from funds.json when the index is not published. */
export function useWatchBadge(): number {
  const [w] = useWatch();
  const loc = useLocation();
  const has = w.items.length > 0;
  const idx = useLoad<StatsIndex>(has ? 'funds/stats/index.json' : null);
  const onFunds = has && /^\/funds/.test(loc.pathname) && !!idx.error;
  const f = useFunds(onFunds);
  return watchBadge(w, idx.data?.asof ?? f.data?.asof);
}

/* ---------- plain-language lines for the new metrics (the "?" next to them) ---------- */
Object.assign(EXPLAIN, {
  sortino: ['סורטינו', 'כמו שארפ, אבל רק התנודות כלפי מטה נחשבות סיכון. גבוה יותר: יותר תשואה לכל יחידת ירידה.'],
  beta: ['בטא מול הקטגוריה', 'כמה המסלול זז כשממוצע הקטגוריה זז באחוז אחד. מעל 1: חד יותר מהקטגוריה; מתחת ל-1: מתון יותר.'],
  te: ['סטיית מעקב', 'עד כמה התשואות החודשיות של המסלול מתרחקות מממוצע הקטגוריה. גבוהה: מסלול שהולך בדרך משלו.'],
  upcap: ['לכידת עליות', 'בחודשים שהקטגוריה עלתה, כמה מהעלייה המסלול השיג (100 = כמו הקטגוריה).'],
  downcap: ['לכידת ירידות', 'בחודשים שהקטגוריה ירדה, כמה מהירידה המסלול ספג (100 = כמו הקטגוריה; פחות מ-100: נפל פחות).'],
  ddcur: ['מתחת לשיא', 'כמה רחוק המסלול היום מהשיא הגבוה שלו, ומכמה חודשים.'],
  rec: ['התאוששות', 'כמה חודשים לקח לחזור לשיא אחרי הירידה הגדולה בחלון.'],
  rank: ['אחוזון לאורך זמן', 'בכל חודש: כמה מהמסלולים באותה קטגוריה השיגו פחות בחלון שהסתיים באותו חודש. 100 הוא הגבוה; הרצועות הן הרבעונים.'],
  persist: ['התמדה', 'מהמסלולים שהיו ברבע העליון בחלון אחד, כמה נשארו ברבע העליון בחלון הבא. מטבע היה נותן 25%.'],
  quilt: ['טבלת שנים', 'כל עמודה היא שנה, ממוינת מהגבוה לנמוך. הצבע הוא המנהל, כך רואים אם מנהל נשאר למעלה או קופץ.'],
  glide: ['מסלולי גיל', 'עד 50, 50–60 ו-60 ומעלה: ככל שהגיל עולה המסלול אמור להחזיק פחות מניות. כאן רואים כמה בפועל.'],
  map: ['מפת סיכון ותשואה', 'כל נקודה היא מסלול: לימין יותר סיכון, למעלה יותר תשואה. גודל הנקודה הוא הנכסים.'],
});
