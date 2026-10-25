import { useEffect, useMemo, useRef } from 'react';
import { readStored, useStored, useStoreTick, writeStored } from './local';
import { useLoad } from './useData';

/* "Since you last looked" (lane S2, ws7 gap 4): per company, the day the reader last opened it, kept under `visit.<id>` through the
   stored keys, so the sync layer carries it to the reader's other devices once it is on. The events come from since.json
   (pipeline/build_since.py): filings, restatements, targets, the regulator's month, each with a date and a stable id. */

/** f filing · r restatement · t target · m regulator month */
export type SinceKind = 'f' | 'r' | 't' | 'm';
export type SinceEvent =
  | ['f', string, string, string, string, number, string, number | null]
  | ['r', string, string, string, number, string, number, number]
  | ['t', string, string, string, string, number, number | null, string | null, number]
  | ['m', string, string, number];
export interface SinceData { v: number; built: string; from: string; files: string; source?: string; co: Record<string, SinceEvent[]> }
/** the day of the visit, and the ids of that day's events already there: an event filed later the same day is still new */
export interface Visit { d: string; s: string[] }

export const KEY = (id: string) => `visit.${id}`;
export const useSinceData = () => useLoad<SinceData>('since.json');

/** today in Israel's calendar (the dates of the filings are Israeli dates) */
export function today(): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

/** the events newer than the visit (none before a first visit: nothing is "new" to a reader who never looked) */
export function newSince(events: SinceEvent[] | undefined, v: Visit | null | undefined): SinceEvent[] {
  if (!events || !v?.d) return [];
  return events.filter((e) => e[1] > v.d || (e[1] === v.d && !v.s.includes(e[2])));
}

/** What is new for one company since the reader last opened it. */
export function useSince(id: string | null | undefined): { visit: Visit | null; fresh: SinceEvent[]; data: SinceData | null } {
  const { data } = useSinceData();
  const [visit] = useStored<Visit | null>(KEY(id ?? '_'), null);
  const fresh = useMemo(() => (id && data ? newSince(data.co[id], visit) : []), [id, data, visit]);
  return { visit: id ? visit : null, fresh, data };
}

/** Every company with something new since its own last visit (the home's season strip). */
export function useSinceAll(): { data: SinceData | null; rows: { id: string; visit: Visit; fresh: SinceEvent[] }[] } {
  const { data } = useSinceData();
  const tick = useStoreTick('visit.');
  const rows = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.co).map((id) => { const visit = readStored<Visit | null>(KEY(id), null); return { id, visit: visit!, fresh: newSince(data.co[id], visit) }; })
      .filter((r) => r.fresh.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tick]);
  return { data, rows };
}

/** Records the visit when the reader leaves the company (another company, another page, or the tab closes): the marks shown during
 *  this visit stay, and the next visit starts from today. */
export function useMarkVisit(id: string | null | undefined): void {
  const { data } = useSinceData();
  const ref = useRef(data);
  ref.current = data;
  useEffect(() => {
    if (!id) return;
    const mark = () => {
      const d = today();
      writeStored(KEY(id), { d, s: (ref.current?.co[id] ?? []).filter((e) => e[1] === d).map((e) => e[2]) } satisfies Visit);
    };
    // a remount of the same company (React's development double effect) cancels the pending mark
    clearTimeout(pending.get(id));
    window.addEventListener('pagehide', mark);
    return () => { window.removeEventListener('pagehide', mark); pending.set(id, window.setTimeout(mark, 0)); };
  }, [id]);
}
const pending = new Map<string, number>();

export const KIND_HE: Record<SinceKind, string> = { f: 'מסמך', r: 'הצגה מחדש', t: 'יעד', m: 'נתוני רשות' };
