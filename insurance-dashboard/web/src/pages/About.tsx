import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { CONTACT } from '../lib/contact';
import '../styles/about.css';

/** /about (Wave 0, red team 01.11.26): who the site is for, where the numbers come from, what it is not. Savers and agents asked "who is behind this, and is it selling me something?" */
export function About() {
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

      <section id="contact">
        <h2>תיקונים ויצירת קשר</h2>
        {CONTACT
          ? <p>מצאתם טעות, מספר שלא תואם למקור או קישור שבור? כתבו ל-{/^https?:/.test(CONTACT) ? <a href={CONTACT} target="_blank" rel="noopener noreferrer">{CONTACT}</a> : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>}. תיקון שמתקבל נרשם בעמוד שבו הופיע המספר, עם התאריך.</p>
          : <p>מצאתם טעות, מספר שלא תואם למקור או קישור שבור? ערוץ תיקונים ייפתח בקרוב. עד אז: כל מספר באתר נפתח למקור שלו, ובכל שאלה ב-<Link to="/questions">אינדקס השאלות</Link> מוצגת חתימת הגרסה, ומה השתנה מהגרסה הקודמת.</p>}
      </section>

      <section>
        <h2>מה האתר לא</h2>
        <ul>
          <li><b>לא ייעוץ השקעות ולא שיווק פנסיוני.</b> המידע עובדתי ומשווה. הוא לא מתחשב במצב האישי שלכם. לפני החלטה על ניוד או מסלול, כדאי להתייעץ עם בעל רישיון.</li>
          <li><b>ביצועי עבר אינם מבטיחים ביצועים בעתיד.</b> לכן ההשוואה מוצגת כברירת מחדל על 5 שנים, והפרש קטן מ-0.1% בשנה מוצג כתיקו.</li>
          <li><b>לא מוכר מוצרים ולא מעביר פרטים.</b> אין באתר טופס הצטרפות או ״השאירו פרטים״. מה שאתם שומרים (מעקב, השאלות שלי) נשמר בדפדפן שלכם בלבד.</li>
        </ul>
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
    </article>
  );
}
