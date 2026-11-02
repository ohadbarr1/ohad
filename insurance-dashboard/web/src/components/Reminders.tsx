import { useEffect, useState } from 'react';
import { calLinks, monthHe, newMonths, type AlertsFile } from '../lib/news';
import { load, useLoad } from '../lib/useData';
import { pubLabel } from '../lib/format';
import '../styles/alerts.css';

/* W8 feeds: how a reader hears about a change on a site with no server and no email. Three pull channels: an RSS / Atom reader, a calendar
   subscription, and a notification on this device only (shown by the service worker when the reader opens fox and a new regulator month
   arrived since the last visit). Nothing leaves the browser: the last month seen and the on/off switch live in localStorage. */

const K_ON = 'fox.notify.v1', K_YM = 'fox.notify.ym';
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
const canNotify = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
const isIos = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => typeof window !== 'undefined' && (matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
let checked = false;

/** On a visit: if the reader turned notifications on and a new regulator month landed since the last visit, show one notification.
 *  The first visit after turning it on only records the month. Runs once per page load. */
export async function checkNewMonth(): Promise<void> {
  if (checked || !canNotify() || get(K_ON) !== '1' || Notification.permission !== 'granted') return;
  checked = true;
  const A = await load<AlertsFile>('alerts.json').catch(() => null);
  if (!A?.reg) return;
  const last = get(K_YM), n = newMonths(last ? Number(last) : null, A.reg);
  put(K_YM, String(A.reg.ym));
  if (!n) return;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  const title = 'fox · חודש חדש של הרשות';
  const body = `נתוני ${monthHe(A.reg.ym)} של גמל-נט, פנסיה-נט וביטוח-נט נקלטו ב-fox ב-${pubLabel(A.reg.d)}.`;
  const opts: NotificationOptions = { body, tag: 'fox-regmonth', lang: 'he', dir: 'rtl', icon: '/icons/icon-192.png', data: { url: '/feed?t=regmonth' } };
  try { if (reg) await reg.showNotification(title, opts); else new Notification(title, opts); } catch { /* the platform refused: nothing to show */ }
}

/** Mount once in the shell (Layout) so the check runs on every visit, whatever the page. Renders nothing. */
export function MonthNotifier() {
  useEffect(() => { void checkNewMonth(); }, []);
  return null;
}

export function NotifyToggle() {
  const [perm, setPerm] = useState<NotificationPermission | 'none'>(() => (canNotify() ? Notification.permission : 'none'));
  const [on, setOn] = useState(() => get(K_ON) === '1');
  const [note, setNote] = useState<string | null>(null);
  if (perm === 'none') {
    return <p className="rm-note">הדפדפן הזה לא תומך בהתראות{isIos() && !standalone() ? '. באייפון ובאייפד: שיתוף ← "הוספה למסך הבית", ואז לפתוח את fox מהמסך הבית' : ''}.</p>;
  }
  const enable = async () => {
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p !== 'granted') { setNote('ההתראות לא אושרו. אפשר לשנות בהגדרות האתר בדפדפן.'); return; }
    put(K_ON, '1'); setOn(true);
    const A = await load<AlertsFile>('alerts.json').catch(() => null);
    if (A?.reg) put(K_YM, String(A.reg.ym));
    setNote(A?.reg ? `פעיל. החודש האחרון שנקלט: ${monthHe(A.reg.ym)}. התראה תופיע בביקור הבא אחרי שחודש חדש יגיע.` : 'פעיל.');
  };
  const disable = () => { put(K_ON, null); put(K_YM, null); setOn(false); setNote('כבוי.'); };
  return (
    <div className="rm-notify">
      {perm === 'denied' ? <p className="rm-note">ההתראות חסומות לאתר הזה בדפדפן. אפשר לשחרר אותן בהגדרות האתר.</p>
        : on && perm === 'granted'
          ? <button type="button" className="btn" onClick={disable}>כיבוי ההתראה במכשיר הזה</button>
          : <button type="button" className="btn" onClick={() => void enable()}>התראה על חודש חדש, במכשיר הזה</button>}
      <span className="rm-note" role="status">{note ?? 'רק כש-fox פתוח או מותקן כאפליקציה, ורק במכשיר הזה.'}</span>
    </div>
  );
}

/** calendar.json, the part this file reads: each company's own calendar (pipeline/build_calendar.py) */
export interface CalIndex { companies: { id: string; name: string; ics?: string }[]; ics?: { all: string; reminders: string; regmonth?: { d: string; basis: { asof: number; fetched: string } } | null; annual?: { d: string; src: string } } }

/** Links a reader copies into a feed reader or a calendar app. */
export function Cal({ path, label }: { path: string; label: string }) {
  const host = typeof location !== 'undefined' && location.host ? location.host : undefined, l = calLinks(path, host);
  return <li><b>{label}</b>: <a href={l.webcal}>הוספה ליומן</a> · <a href={path} download>הורדת קובץ ICS</a></li>;
}

/** The compact block for /my, /clients and the Pro home: RSS, calendar subscriptions and (optional) a notification on this device.
 *  `co`: a company page or a client's insurer adds its own feed and calendar. `door` picks the defaults (saver: reminders first). */
export function Reminders({ door = 'saver', co, coName }: { door?: 'saver' | 'agent' | 'pro'; co?: string; coName?: string }) {
  useEffect(() => { void checkNewMonth(); }, []);
  const { data: A } = useLoad<AlertsFile>('alerts.json');
  const { data: C } = useLoad<CalIndex>(co ? 'calendar.json' : null);
  const coFeed = co ? A?.feeds.find((f) => f.c === co) : undefined;
  const coCal = co ? C?.companies.find((x) => x.id === co)?.ics : undefined;
  const name = coName ?? coFeed?.t;
  return (
    <section className="panel rm" aria-labelledby="rm-h">
      <div className="hd"><h2 id="rm-h">עדכונים ותזכורות</h2></div>
      <p className="rm-honest">אין כאן אימייל ואין חשבון: fox לא שולחת הודעות. שלוש דרכים לדעת שמשהו השתנה, כולן מהמכשיר שלכם.</p>
      <ul className="rm-list">
        <li>
          <b>קורא RSS</b>: <a href="/feed/months.xml" type="application/rss+xml">חודש חדש של הרשות</a>
          {' · '}<a href="/feed/funds.xml" type="application/rss+xml">שינויים בדמי ניהול</a>
          {door !== 'saver' && <>{' · '}<a href="/feed.xml" type="application/rss+xml">כל השינויים</a></>}
          {coFeed && <>{' · '}<a href={coFeed.p} type="application/rss+xml">{name}</a></>}
        </li>
        <Cal path="/data/cal/reminders.ics" label="יומן: דוח שנתי (עד 31 במרץ) וחודש חדש של הרשות (אומדן)" />
        {door !== 'saver' && <Cal path="/data/calendar.ics" label="יומן: הדוחות הצפויים של כל החברות (אומדן)" />}
        {coCal && <Cal path={coCal} label={`יומן: הדוחות הבאים של ${name ?? co} (אומדן)`} />}
      </ul>
      <NotifyToggle />
    </section>
  );
}
