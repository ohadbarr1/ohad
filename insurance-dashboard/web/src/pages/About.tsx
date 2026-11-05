import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { Empty } from '../components/ui';
import { CONTACT, OWNER_NAME, contactHref, disclosure } from '../lib/contact';
import { ANALYTICS_CODE } from '../lib/track';
import { useLoad } from '../lib/useData';
import '../styles/about.css';
import { Subscriptions } from '../components/Subscriptions';  // W8 feeds: RSS and calendar subscriptions

/** one entry of web/public/data/corrections.json (schema `corrections`): the date as shown (dd.mm.yy), the page, the field, before / after */
interface Correction { id: string; date: string; route: string; field: string; before: string; after: string; note: string; source: string | null }

/** the corrections channel as a link (an address or a URL), or null while the owner has not set one */
function ContactLink() {
  const href = contactHref();
  if (!href) return null;
  return href.startsWith('mailto:') ? <a className="sv-u" href={href}>{CONTACT}</a> : <a className="sv-u" href={href} target="_blank" rel="noopener noreferrer">{CONTACT}</a>;
}

/** /about (Wave 0, red team 01.11.26): who the site is for, where the numbers come from, what it is not. Savers and agents asked "who is behind this, and is it selling me something?"
 *  F3 (fox 3.0, phase 0): the owner and the conflict-of-interest disclosure (shown once lib/contact OWNER_NAME is set), the corrections
 *  channel and log (#corrections); F2: what is measured (#measured). */
export function About() {
  const disc = disclosure();
  return (
    <article className="about">
      <header className="about-hd">
        <Logo size={44} />
        <div>
          <h1>על fox</h1>
          <p className="muted">אתר חינמי לנתוני חיסכון ארוך טווח בישראל: קופות גמל, השתלמות, פנסיה ופוליסות, והחברות שמנהלות אותן.</p>
        </div>
      </header>

      <section>
        <h2>מאיפה המספרים</h2>
        <ul>
          <li>תשואות, דמי ניהול, נכסים ותזרימים של מסלולים: <b>רשות שוק ההון</b>, מאגרי גמל-נט, פנסיה-נט וביטוח-נט ב-<a href="https://data.gov.il" target="_blank" rel="noopener noreferrer">data.gov.il</a>.</li>
          <li>נתוני החברות: הדוחות הכספיים, הדוחות התקופתיים והמצגות שפורסמו במערכת <a href="https://maya.tase.co.il" target="_blank" rel="noopener noreferrer">מאי״ה</a>.</li>
          <li>כל מספר באתר נפתח למקור שלו: הרשומה ברשות, או העמוד בדוח. נתון מחושב מציג את החישוב ואת הקלטים.</li>
          <li>איך כל מדד מחושב, מה כל מונח אומר ומתי הנתונים מתעדכנים: <Link to="/methodology">מתודולוגיה</Link>.</li>
        </ul>
      </section>

      <section>
        <h2>מה זה ״נטו, אומדן״</h2>
        <p>הרשות מפרסמת תשואות <b>לפני</b> דמי ניהול. fox מוריד מהן את דמי הניהול מצבירה <b>הממוצעים בפועל</b> של המסלול, חודש אחר חודש. לכן זה אומדן: דמי הניהול שאתם משלמים יכולים להיות נמוכים או גבוהים מהממוצע, ודמי ניהול מהפקדה לא נכללים בחישוב. <Link to="/methodology#net">החישוב המלא</Link>.</p>
      </section>

      {disc && (
        <section id="owner" className="about-owner">
          <h2>מי עומד מאחורי fox</h2>
          <p><b>{OWNER_NAME}</b>. {CONTACT && <>ליצירת קשר: <ContactLink />.</>}</p>
          <p className="about-disc" role="note"><span className="chip est">גילוי נאות</span> {disc}</p>
        </section>
      )}

      <Corrections />

      <section>
        <h2>מה האתר לא</h2>
        <ul>
          <li><b>לא ייעוץ השקעות ולא שיווק פנסיוני.</b> המידע עובדתי ומשווה. הוא לא מתחשב במצב האישי שלכם. לפני החלטה על ניוד או מסלול, כדאי להתייעץ עם בעל רישיון.</li>
          <li><b>ביצועי עבר אינם מבטיחים ביצועים בעתיד.</b> לכן ההשוואה מוצגת כברירת מחדל על 5 שנים, והפרש קטן מ-0.1% בשנה מוצג כתיקו.</li>
          <li><b>לא מוכר מוצרים ולא מעביר פרטים.</b> אין באתר טופס הצטרפות או ״השאירו פרטים״. מה שאתם שומרים (מעקב, השאלות שלי) נשמר בדפדפן שלכם בלבד.</li>
        </ul>
      </section>

      <section id="measured">
        <h2>מה נמדד</h2>
        {ANALYTICS_CODE
          ? <p>מונים מצרפיים בלבד: כמה פעמים נפתח כל עמוד, וכמה פעמים בוצעו פעולות עבודה (ייבוא מהמסלקה, הפקת מסמך הנמקה, העתקת מכתב, הורדת Excel, פתיחת עמוד יום הדוח). נשלחים רק שם העמוד, בלי פרמטרים, ושם הפעולה. <b>בלי עוגיות, בלי מזהה משתמש ובלי שום נתון שהזנתם או ייבאתם:</b> סכומים, שמות, מספרי זהות, קבצים והמוצרים שלכם לא יוצאים מהדפדפן. הספירה ב-<a className="sv-u" href="https://www.goatcounter.com" target="_blank" rel="noopener noreferrer">GoatCounter</a>, כלי קוד פתוח בלי פרסום. דפדפן עם Do Not Track או Global Privacy Control לא נספר.</p>
          : <p>כרגע האתר לא מודד שימוש: אין עוגיות, אין מונים ואין סקריפט של צד שלישי. אם תופעל מדידה, היא תהיה מונים מצרפיים בלבד (כמה פעמים נפתח עמוד או בוצעה פעולה), בלי עוגיות ובלי שום נתון שהזנתם, וזה ייכתב כאן.</p>}
      </section>

      <section>
        <h2>מאיפה להתחיל</h2>
        <div className="about-go">
          <Link className="chip" to="/funds/screen">מצאו את המסלול שלכם</Link>
          <Link className="chip" to="/funds/tools/fees">כמה עולים דמי הניהול</Link>
          <Link className="chip" to="/funds/default">קרנות ברירת המחדל</Link>
          <Link className="chip" to="/funds/compare">השוואת מסלולים</Link>
        </div>
      </section>
      <Subscriptions />
    </article>
  );
}

/** #corrections: how to report an error, and the log of every correction made (corrections.json, kept by hand, newest first) */
function Corrections() {
  const { data, error } = useLoad<{ entries: Correction[] }>('corrections.json');
  const log = data?.entries ?? [];
  return (
    <section id="corrections" className="about-corr">
      <span id="contact" />
      <h2>תיקונים</h2>
      {CONTACT
        ? <p>מצאתם טעות, מספר שלא תואם למקור או קישור שבור? כתבו ל-<ContactLink />, עם הכתובת של העמוד והמספר. תיקון שמתקבל נרשם ביומן שלמטה: מה היה, מה תוקן, מתי ולפי איזה מקור.</p>
        : <p>מצאתם טעות, מספר שלא תואם למקור או קישור שבור? ערוץ תיקונים ייפתח בקרוב. עד אז: כל מספר באתר נפתח למקור שלו, ובכל שאלה ב-<Link className="sv-u" to="/questions">אינדקס השאלות</Link> מוצגת חתימת הגרסה ומה השתנה מהגרסה הקודמת.</p>}
      <h3 className="about-h3">יומן תיקונים</h3>
      {error ? <p className="about-note">היומן לא נטען כרגע ({error}).</p>
        : !data ? <p className="about-note" role="status">טוען את היומן…</p>
        : !log.length ? <Empty icon="check" title="עוד לא נרשם תיקון">כל תיקון למספר שפורסם יירשם כאן: התאריך, העמוד, הערך לפני ואחרי, הסיבה והמקור. היומן לא נמחק ולא נערך בדיעבד.</Empty>
        : <ol className="corr-log">{log.map((c) => (
            <li key={c.id} id={`c-${c.id}`}>
              <div className="corr-hd"><span className="num">{c.date}</span><Link className="sv-u" to={c.route}>{c.route}</Link><span className="corr-f">{c.field}</span></div>
              <div className="corr-ba"><span className="corr-b" aria-label="לפני"><s>{c.before}</s></span><span aria-hidden="true">←</span><span className="corr-a" aria-label="אחרי"><b>{c.after}</b></span></div>
              {(c.note || c.source) && <p>{c.note}{c.source && <> · {/^https?:\/\//.test(c.source) ? <a className="sv-u" href={c.source} target="_blank" rel="noopener noreferrer">המקור</a> : c.source}</>}</p>}
            </li>))}</ol>}
    </section>
  );
}
