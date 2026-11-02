import { Cal, NotifyToggle, type CalIndex } from './Reminders';
import { monthHe, type AlertsFile } from '../lib/news';
import { useLoad } from '../lib/useData';
import { pubLabel } from '../lib/format';
import '../styles/alerts.css';

/** "מינויים": every feed and calendar fox publishes, for /about or /methodology. Pull only: fox has no server, sends no email and keeps
 *  no list of readers; a feed reader or a calendar app fetches the files, a notification is shown by this browser only. */
export function Subscriptions() {
  const { data: A } = useLoad<AlertsFile>('alerts.json');
  const { data: C } = useLoad<CalIndex>('calendar.json');
  const main = A?.feeds.filter((f) => f.k !== 'co') ?? [], cos = A?.feeds.filter((f) => f.k === 'co') ?? [];
  return (
    <section className="panel rm subs" id="subscriptions" aria-labelledby="subs-h">
      <div className="hd"><h2 id="subs-h">מינויים</h2></div>
      <p className="rm-honest">fox לא שולחת אימייל ולא שומרת רשימת מנויים. כל מינוי כאן הוא קובץ סטטי שהתוכנה שלכם מושכת: קורא RSS או Atom, או אפליקציית יומן. הקבצים נבנים מחדש עם הנתונים, וכל פריט נושא את המספר, המקור שלו ואת היום שבו התקבל ב-fox.</p>
      <h3>RSS · Atom</h3>
      <ul className="rm-list">
        {main.map((f) => <li key={f.p}><b>{f.t}</b> (<span className="num">{f.n}</span>): <a href={f.p} type="application/rss+xml">RSS</a> · <a href={f.a} type="application/atom+xml">Atom</a></li>)}
        {cos.length > 0 && <li><b>לפי חברה</b>: {cos.map((f, i) => <span key={f.p}>{i ? ' · ' : ''}<a href={f.p} type="application/rss+xml">{f.t}</a></span>)}</li>}
      </ul>
      <p className="rm-note">כתובת המינוי היא הקישור עצמו (למשל <span className="num" dir="ltr">https://fox-research-il.web.app/feed.xml</span>). תאריך הפריט הוא היום שבו fox קלטה את השינוי; פריטים מלפני {A ? pubLabel(A.since) : '…'} נושאים את התאריך של האירוע עצמו.</p>
      <h3>יומן</h3>
      <ul className="rm-list">
        <Cal path="/data/cal/reminders.ics" label="תזכורות לחוסך" />
        <Cal path="/data/calendar.ics" label="הדוח הבא של כל חברה" />
        {C?.companies.filter((c) => c.ics).length ? <li><b>לפי חברה</b>: {C.companies.filter((c) => c.ics).map((c, i) => <span key={c.id}>{i ? ' · ' : ''}<a href={`webcal://${location.host}${c.ics}`}>{c.name}</a></span>)}</li> : null}
      </ul>
      <p className="rm-note">
        מועדי הדוחות הם אומדן מהרקורד של כל חברה, לא מועד סטטוטורי.
        {C?.ics?.regmonth ? <> חודש חדש של הרשות: אומדן, כי הרשות לא מפרסמת לוח זמנים; החודש האחרון, {monthHe(C.ics.regmonth.basis.asof)}, נקלט ב-{pubLabel(C.ics.regmonth.basis.fetched)}.</> : null}
        {' '}הדוח השנתי לעמית מגיע עד 31 במרץ, על השנה הקודמת (<a href="https://www.kolzchut.org.il/he/%D7%93%D7%95%D7%97%D7%95%D7%AA_%D7%A8%D7%91%D7%A2%D7%95%D7%A0%D7%99%D7%99%D7%9D_%D7%95%D7%A9%D7%A0%D7%AA%D7%99%D7%99%D7%9D_%D7%A9%D7%9C_%D7%A7%D7%A8%D7%9F_%D7%94%D7%A4%D7%A0%D7%A1%D7%99%D7%94" target="_blank" rel="noreferrer">כל זכות</a>).
      </p>
      <h3>התראה במכשיר הזה</h3>
      <NotifyToggle />
    </section>
  );
}
