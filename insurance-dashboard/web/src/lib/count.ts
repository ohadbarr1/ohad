/* M1 (approved O8): the track-compare usage counter. Cookieless, no identifier, Do Not Track and Global Privacy Control honoured,
   through the site's EXISTING measurement path (lib/track.ts: GoatCounter's documented /count endpoint, no count.js, no Cloud
   Function, no hosting rewrite). While lib/track ANALYTICS_CODE is empty every call here is a no-op: no request is made.

   What one hit carries, and nothing else: the GoatCounter event path
       event/<name>[/<argument>]/<door>/<family>
   e.g. "event/cmp_lens/long/saver/pension", "event/cmp_picker_done/3-text/agent/hishtalmut", "event/cmp_share/wa/saver/mixed".
   Every part comes from a fixed list below (an unknown value is dropped, never passed through): the event name, the lens id, the
   number of tracks (1–8), the picker's route (guided | text | mine), the share channel, the door, and the product family (the picker's
   tile id, "mixed" for different products, "none" before tracks are chosen). Never a track key, a fund, a balance, a fee or a name:
   which tracks the reader compares or holds never leaves the browser. The day is the counter's own receipt time (nothing is sent for it).

   The compare shell sets the door and the family once (setCountContext); a lens, a sheet or the picker calls count(event, arg). */
import { endpoint, hitUrl } from './track';
import { tileOf } from './pickTiles';
import type { Door } from './door';

export type CmpEvent = 'cmp_open' | 'cmp_lens' | 'cmp_month_sheet' | 'cmp_fee_sheet' | 'cmp_track_sheet' | 'cmp_picker_done' | 'cmp_share';
export type CmpRoute = 'guided' | 'text' | 'mine';
export type CmpChannel = 'wa_page' | 'wa' | 'copy' | 'native';
export interface CmpArg { lens?: string; n?: number; route?: CmpRoute; channel?: CmpChannel }

const EVENTS: readonly CmpEvent[] = ['cmp_open', 'cmp_lens', 'cmp_month_sheet', 'cmp_fee_sheet', 'cmp_track_sheet', 'cmp_picker_done', 'cmp_share'];
const LENSES = ['m6', 'm12', 'y', 'long', 'dec', 'risk'];
const ROUTES: readonly CmpRoute[] = ['guided', 'text', 'mine'];
const CHANNELS: readonly CmpChannel[] = ['wa_page', 'wa', 'copy', 'native'];
const DOORS: readonly Door[] = ['saver', 'agent', 'pro'];
export const FAMILIES = ['pension', 'hishtalmut', 'hash', 'gemel', 'managers', 'policy', 'mixed', 'none'] as const;
export type Family = (typeof FAMILIES)[number];

/** the product family of the tracks on screen: the picker's tile ("pension" … "policy"), "mixed" across tiles, "none" without tracks */
export function familyOf(prods: (string | null | undefined)[]): Family {
  const ids = new Set(prods.filter((p): p is string => !!p).map((p) => tileOf(p)?.id ?? 'none'));
  if (!ids.size) return 'none';
  if (ids.size > 1) return 'mixed';
  const id = [...ids][0];
  return (FAMILIES as readonly string[]).includes(id) ? (id as Family) : 'none';
}

/** the event path of one hit, or null when the event or a required argument is not on the fixed lists */
export function countPath(event: CmpEvent, arg: CmpArg | undefined, door: Door, fam: Family): string | null {
  if (!EVENTS.includes(event) || !DOORS.includes(door) || !(FAMILIES as readonly string[]).includes(fam)) return null;
  let a: string | null = '';
  if (event === 'cmp_lens') a = arg?.lens && LENSES.includes(arg.lens) ? arg.lens : null;
  else if (event === 'cmp_picker_done') {
    const n = arg?.n, r = arg?.route;
    a = n != null && Number.isInteger(n) && n >= 1 && n <= 8 && r && ROUTES.includes(r) ? `${n}-${r}` : null;
  } else if (event === 'cmp_share') a = arg?.channel && CHANNELS.includes(arg.channel) ? arg.channel : null;
  if (a == null) return null;
  return `event/${event}${a ? `/${a}` : ''}/${door}/${fam}`;
}

/* ---------- context and sending ---------- */
let ctx: { door: Door; fam: Family } = { door: 'saver', fam: 'none' };
/** the door and the product family every later hit carries (the compare shell, on each change) */
export function setCountContext(door: Door, fam: Family): void { ctx = { door: DOORS.includes(door) ? door : 'saver', fam }; }

/** the same gate as lib/track (kept in step with it): Do Not Track, Global Privacy Control, an automated browser or a local host → off */
function allowed(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; webdriver?: boolean };
  if (nav.webdriver || nav.doNotTrack === '1' || (window as Window & { doNotTrack?: string }).doNotTrack === '1' || nav.globalPrivacyControl === true) return false;
  const h = location.hostname;
  return !(h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost') || h.endsWith('.test'));
}

/** count one compare event (a no-op while lib/track ANALYTICS_CODE is empty, under Do Not Track, or on a local host) */
export function count(event: CmpEvent, arg?: CmpArg): void {
  const base = endpoint();
  if (!base || !allowed()) return;
  const path = countPath(event, arg, ctx.door, ctx.fam);
  if (!path) return;
  const url = hitUrl(base, path, true);
  try { if (navigator.sendBeacon && navigator.sendBeacon(url)) return; } catch { /* fall through to the image */ }
  try { const i = new Image(); i.referrerPolicy = 'no-referrer'; i.src = url; } catch { /* measurement never breaks a page */ }
}
