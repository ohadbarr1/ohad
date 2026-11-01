/** S3 on the page: the published files a brief reads (all public and neutral) and the private registry (this browser only). */
import { useEffect, useMemo, useState } from 'react';
import { load, useLoad } from './useData';
import { useFeed } from './feed';
import { useFragility } from './fragilityLoad';
import { useAnswerIndex, useFindings, useNames } from './answersLoad';
import { useStored } from './local';
import { cleanMeeting, localToday, type BriefData, type CalFile, type Meeting, type WatchFile } from './brief';

/** the registry, kept in this browser only (localStorage 'meetings'); a malformed entry is dropped on read */
export function useMeetings(): [Meeting[], (next: Meeting[]) => void] {
  const [raw, set] = useStored<unknown>('meetings', []);
  const list = useMemo(() => (Array.isArray(raw) ? raw.map(cleanMeeting).filter((m): m is Meeting => !!m) : []), [raw]);
  return [list, set as (next: Meeting[]) => void];
}

/** watch.json (S10), or nothing: a build without it asks for no file */
function useWatch(enabled: boolean): { data: WatchFile | null; done: boolean } {
  const [st, set] = useState<{ data: WatchFile | null; done: boolean }>({ data: null, done: !enabled });
  useEffect(() => {
    if (!enabled) return;
    if (!__HAS_WATCH__) { set({ data: null, done: true }); return; }
    let live = true;
    load<WatchFile>('watch.json').then((d) => live && set({ data: d && Array.isArray(d.changes) ? d : null, done: true }), () => live && set({ data: null, done: true }));
    return () => { live = false; };
  }, [enabled]);
  return st;
}

/** every input of a brief; `ready` once each file has arrived or failed (a failed file is a section that says so, not a broken page) */
export function useBriefData(enabled = true): { data: BriefData; ready: boolean } {
  const I = useAnswerIndex(enabled), Fd = useFindings(enabled), feed = useFeed(enabled), frag = useFragility(enabled);
  const cal = useLoad<CalFile>(enabled ? 'calendar.json' : null), W = useWatch(enabled);
  const names = useNames();
  const done = (x: { data: unknown; error: string | null }) => !!x.data || !!x.error;
  const ready = done(I) && Fd.done && done(feed) && done(frag) && done(cal) && W.done;
  const today = useMemo(localToday, []);
  const data = useMemo<BriefData>(() => ({ today, index: I.data, findings: Fd.data, feed: feed.data, frag: frag.data, cal: cal.data, watch: W.data, names }),
    [today, I.data, Fd.data, feed.data, frag.data, cal.data, W.data, names]);
  return { data, ready };
}
