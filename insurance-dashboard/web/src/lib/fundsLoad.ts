/* Loaders the funds tools share: the closed tracks (funds/closed.json), many track histories at once (a category's members), and the
   optional F2 files (funds/default.json, funds/trackers.json), which may not be published yet: absence is a state, not an error. */
import { useEffect, useState } from 'react';
import { load } from './useData';
import type { FundX, HistX } from './funds';

/** closed tracks, flagged `gone` (null while loading; [] when the file is missing) */
export function useClosed(): FundX[] | null {
  const [v, setV] = useState<FundX[] | null>(null);
  useEffect(() => { let on = true; load<{ funds: FundX[] }>('funds/closed.json').then((d) => on && setV((d.funds ?? []).map((f) => ({ ...f, gone: true }))), () => on && setV([])); return () => { on = false; }; }, []);
  return v;
}

/** An optional data file: `undefined` while loading, `null` when it is not published (or does not parse). */
export function useOptional<T>(path: string): T | null | undefined {
  const [v, setV] = useState<T | null | undefined>(undefined);
  useEffect(() => { let on = true; load<T>(path).then((d) => on && setV(d), () => on && setV(null)); return () => { on = false; }; }, [path]);
  return v;
}

const cache = new Map<string, HistX>();
/** Histories of many tracks, fetched a few at a time. Returns what has arrived, the keys that failed, and how many are pending. */
export function useHists(keys: string[]): { hist: Record<string, HistX>; failed: string[]; pending: number } {
  const [hist, setHist] = useState<Record<string, HistX>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const sig = keys.join(',');
  useEffect(() => {
    let on = true;
    const want = keys.filter((k) => !cache.has(k));
    setHist(Object.fromEntries(keys.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)!])));
    setFailed([]);
    let i = 0;
    const next = async (): Promise<void> => {
      while (on && i < want.length) {
        const k = want[i++];
        try { const h = await load<HistX>(`funds/${k}.json`); cache.set(k, h); if (on) setHist((c) => ({ ...c, [k]: h })); }
        catch { if (on) setFailed((c) => [...c, k]); }
      }
    };
    void Promise.all(Array.from({ length: Math.min(8, want.length) }, next));
    return () => { on = false; };
  }, [sig]);  // eslint-disable-line react-hooks/exhaustive-deps
  const got = keys.filter((k) => hist[k]).length;
  return { hist, failed, pending: Math.max(0, keys.length - got - failed.length) };
}

/** a number from the address, or the default */
export const numQ = (v: string | null, d: number, lo = -Infinity, hi = Infinity) => { const x = v == null || v === '' ? NaN : Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
/** yyyymm ↔ the value of an <input type="month"> */
export const toMonthInput = (p: number) => `${Math.floor(p / 100)}-${String(p % 100).padStart(2, '0')}`;
export const fromMonthInput = (s: string) => (/^\d{4}-\d{2}$/.test(s) ? Number(s.slice(0, 4)) * 100 + Number(s.slice(5, 7)) : null);
