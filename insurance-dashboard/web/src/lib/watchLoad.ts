/** S10 on the page: watch.json and the browser's private half (what it follows, when it last looked). The pure library is lib/watch.ts.
 *  Storage keys (lib/local.ts, prefix fox:): 'watch' = the subscriptions, 'watch.seen' = the build date of the last look at /watch,
 *  'meetings' = the S3 meeting registry (read only here). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { load } from './useData';
import { readStored, useStored, writeStored } from './local';
import { NO_SUBS, newsCount, normSubs, readMeetings, subCount, toggleSub, type Meeting, type SubKind, type Subs, type WatchFile } from './watch';

export const WATCH = 'watch.json';
export const SUBS_KEY = 'watch';
export const SEEN_KEY = 'watch.seen';
export const MEETINGS_KEY = 'meetings';

/** watch.json, or nothing: a build without it shows the page's empty state and fetches no file (no 404) */
export function useWatch(enabled = true): { data: WatchFile | null; done: boolean } {
  const [st, set] = useState<{ data: WatchFile | null; done: boolean }>({ data: null, done: false });
  useEffect(() => {
    if (!enabled) { set({ data: null, done: true }); return; }
    if (!__HAS_WATCH__) { set({ data: null, done: true }); return; }
    let live = true;
    load<WatchFile>(WATCH).then((d) => live && set({ data: d && Array.isArray(d.changes) ? d : null, done: true }), () => live && set({ data: null, done: true }));
    return () => { live = false; };
  }, [enabled]);
  return st;
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const todayIso = today;

/** what this browser follows, and a toggle. The first follow starts the clock: "since your last look" begins today */
export function useSubs(): [Subs, (k: SubKind, id: string) => void, (s: Subs) => void] {
  const [raw, setRaw] = useStored<unknown>(SUBS_KEY, NO_SUBS);
  const subs = useMemo(() => normSubs(raw), [raw]);
  const toggle = useCallback((k: SubKind, id: string) => {
    if (readStored<string | null>(SEEN_KEY, null) == null) writeStored(SEEN_KEY, today());
    setRaw(toggleSub(normSubs(readStored<unknown>(SUBS_KEY, NO_SUBS)), k, id));
  }, [setRaw]);
  const replace = useCallback((s: Subs) => setRaw(normSubs(s)), [setRaw]);
  return [subs, toggle, replace];
}

export const useSeen = () => useStored<string | null>(SEEN_KEY, null);

/** the S3 meeting registry, if another module wrote one (any other shape reads as none) */
export function useMeetings(): Meeting[] {
  const [raw] = useStored<unknown>(MEETINGS_KEY, []);
  return useMemo(() => readMeetings(raw), [raw]);
}

/** the count on the nav badge and the home line: followed changes that tell, since the last look. Loads watch.json only when something is followed */
export function useWatchNews(): number {
  const [subs] = useSubs();
  const [seen] = useSeen();
  const on = subCount(subs) > 0;
  const { data } = useWatch(on);
  return on ? newsCount(data, subs, seen) : 0;
}
