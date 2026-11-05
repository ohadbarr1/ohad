import { Link, NavLink } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { Icon } from '../components/Icon';
import '../styles/fundsTools.css';

/* /funds/tools (wave F2, TOOLS; phase 0, 05.11.26: a list, not an interstitial): the calculators and trackers of the "חיסכון" section,
   each with the question it answers. Every tool runs in the reader's browser over the published files: nothing typed here leaves the page
   (the state lives in the address, so a link reproduces it). */

/** [address, icon, name, the question it answers, what it shows] */
export const TOOLS: [string, string, string, string, string][] = [
  ['/funds/default', 'shield', 'קרנות ברירת מחדל', 'האם הקרן שלי היא אחת הנבחרות, ובאיזה מחיר?', 'מכרזי רשות שוק ההון: הזוכות, דמי הניהול שנקבעו, ומה קרה לכסף לפני ואחרי'],
  ['/funds/bm', 'statement', 'ביטוחי מנהלים ישנים', 'מה אני מפסיד אם אעזוב פוליסה ישנה?', 'מקדם מובטח, חיתום, ותק וכספים הוניים: מה בודקים לפני שעוזבים'],  // W2
  ['/funds/tools/fees', 'sliders', 'דמי ניהול לאורך קריירה', 'כמה יעלו לי דמי הניהול עד הפרישה?', 'מהפקדה ומצבירה, בשקלים ובקצבה החודשית, על המסלול שלך או על כל מסלול'],
  ['/funds/trackers', 'compare', 'עוקבי מדד', 'כמה עולה אותו מדד בעטיפות שונות?', 'S&P 500 ומדדים אחרים בגמל, בהשתלמות ובפוליסות: הפער בין המסלולים הוא מחיר העטיפה'],
  ['/funds/glide', 'savings', 'מסלולי גיל', 'כמה מניות יש באמת במסלול לפי הגיל שלי?', 'עד 50, 50–60, 60 ומעלה: החשיפה למניות בפועל בכל גוף, ומה הפער בין המדרגות'],
];

/** the tools as a row of links under the section's tabs */
export function ToolLinks() {
  return (
    <nav className="ftools-nav" aria-label="כלים">
      {TOOLS.map(([to, , t]) => <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{t}</NavLink>)}
    </nav>
  );
}

export function FundsTools() {
  return (
    <>
      <FundsHead sub={<><span className="num">{TOOLS.length}</span> כלים על הנתונים שהרשות מפרסמת · החישוב רץ בדפדפן; שום נתון שמוקלד לא נשלח</>} />
      <ul className="ftiles ftools-list" aria-label="כלי החיסכון">
        {TOOLS.map(([to, icon, t, q, d]) => (
          <li key={to}><Link to={to} className="ftile"><span className="icotile lg"><Icon name={icon} /></span><b>{t}</b><span className="ftile-q">{q}</span><span>{d}</span></Link></li>
        ))}
      </ul>
      <div className="fnote">כל מספר נפתח למקורו: נתון שפורסם מוביל לרשומה ברשות שוק ההון, ונתון מחושב מציג את הנוסחה, את הקלטים ואת ההנחות. אין כאן המלצה: תוצאות עבר אינן מבטיחות תוצאות בעתיד. חבילת ההשוואה ל-Excel נמצאת ב<Link className="sv-u" to="/funds/compare">השוואת מסלולים</Link>.</div>
    </>
  );
}
