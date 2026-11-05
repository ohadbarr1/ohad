/* F2 measurement (fox 3.0, phase 0): cookieless, aggregate counters through GoatCounter. OFF until the owner sets ANALYTICS_CODE.

   OWNER FILLS THIS IN: ANALYTICS_CODE = the GoatCounter site code (the `fox` of https://fox.goatcounter.com). Empty = nothing is sent,
   no request is made, and /about says that nothing is measured.

   What leaves the browser, and nothing else (owner decision 05.11.26: aggregate counters only, no cookies, no personal data):
     page views   the route's path only: no query string, no hash, no title, no referrer, no screen size; a path segment that could be a
                  personal value (7+ digits in a row, an @, longer than 40 characters) is replaced by ":x"
     events       a fixed event name from the list below, as a GoatCounter event path ("event/<name>"): never a balance, a name, an ID, a
                  file, a fund the reader holds, or any other value from the page
   GoatCounter's own script (count.js) is NOT loaded: it would also send the query string, the title, the referrer and the screen size.
   The counter is called directly (its documented /count endpoint), so this file is the whole list of what is sent. No cookie and no
   local storage is used; Do Not Track and Global Privacy Control are honoured; local hosts and automated browsers send nothing. */

export const ANALYTICS_CODE = '';

/** the work events counted (plan F2): a saver or agent finished the clearing-house import; an agent printed the הנמקה document; a
 *  saver copied the letter or message; an Excel workbook was downloaded; a company's report-day page was opened; a checkup finished */
export type TrackEvent = 'import_done' | 'hanmaka_pdf' | 'letter_copied' | 'xlsx_dl' | 'report_day_view' | 'checkup_done';
const EVENTS: readonly TrackEvent[] = ['import_done', 'hanmaka_pdf', 'letter_copied', 'xlsx_dl', 'report_day_view', 'checkup_done'];

/** the counter endpoint, or null when measurement is off (no code, a code that is not a plain subdomain label) */
export const endpoint = (code: string = ANALYTICS_CODE): string | null => (/^[a-z0-9][a-z0-9-]{0,62}$/i.test(code) ? `https://${code.toLowerCase()}.goatcounter.com/count` : null);

/** the path as counted: pathname only, with any segment that could carry a personal value replaced */
export function safePath(pathname: string): string {
  const segs = pathname.split('/').map((s) => { let d = s; try { d = decodeURIComponent(s); } catch { /* keep as is */ } return /\d{7,}|@/.test(d) || d.length > 40 ? ':x' : s; });
  const p = segs.join('/') || '/';
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/** the request URL for one hit: only `p` (the path), `e` (an event or not) and a cache breaker */
export const hitUrl = (base: string, path: string, event: boolean): string => `${base}?p=${encodeURIComponent(path)}&e=${event}&rnd=${Math.random().toString(36).slice(2, 8)}`;

function allowed(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; webdriver?: boolean };
  if (nav.webdriver || nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return false;
  const h = location.hostname;
  return !(h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost') || h.endsWith('.test'));
}

function send(path: string, event: boolean): void {
  const base = endpoint();
  if (!base || !allowed()) return;
  const url = hitUrl(base, path, event);
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
  } catch { /* fall through to the image */ }
  try { const i = new Image(); i.referrerPolicy = 'no-referrer'; i.src = url; } catch { /* measurement never breaks a page */ }
}

/** count one work event (a no-op while ANALYTICS_CODE is empty). Takes the event name only: nothing else can be passed. */
export function track(event: TrackEvent): void {
  if (!EVENTS.includes(event)) return;
  send(`event/${event}`, true);
}

let started = false, last = '', timer: ReturnType<typeof setTimeout> | undefined;
/** count page views: the first path, then every change of path (a changed query string alone is not a new view). Called once from
 *  main.tsx; a no-op while ANALYTICS_CODE is empty. A redirect within 400 ms counts once, on the path it lands on. */
export function startPageViews(): void {
  if (started || !endpoint() || !allowed()) return;
  started = true;
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { const p = safePath(location.pathname); if (p !== last) { last = p; send(p, false); } }, 400);
  };
  for (const k of ['pushState', 'replaceState'] as const) {
    const orig = history[k].bind(history);
    history[k] = (...args: Parameters<History['pushState']>) => { const r = orig(...args); check(); return r; };
  }
  addEventListener('popstate', check);
  check();
}
