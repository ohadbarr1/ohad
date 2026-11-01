import { Link, NavLink } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { Icon } from '../components/Icon';
import '../styles/fundsTools.css';

/* /funds/tools (wave F2, TOOLS): the calculators and trackers of the "חיסכון" section, one door. Every tool runs in the reader's
   browser over the published files: nothing typed here leaves the page (the state lives in the address, so a link reproduces it). */

export const TOOLS: [string, string, string, string][] = [
  ['/funds/tools/hindsight', 'scenarios', 'מה היה לי', 'ההפקדות שלך דרך כל מסלול בקטגוריה: איפה היית היום, מול החציון, הטוב והחלש'],
  ['/funds/tools/fees', 'sliders', 'דמי ניהול לאורך קריירה', 'כמה עולים דמי ניהול מהפקדה ומצבירה עד הפרישה, בשקלים ובקצבה'],
  ['/funds/default', 'shield', 'קרנות ברירת מחדל', 'מכרזי רשות שוק ההון: הזוכות, המחיר, ומה קרה לכסף לפני ואחרי'],
  ['/funds/trackers', 'compare', 'מעבדת עוקבי המדד', 'אותו מדד בעטיפות שונות: הפער בין המסלולים הוא מחיר העטיפה'],
  ['/funds/compare', 'download', 'חבילת השוואה ל-Excel', 'מתוך ההשוואה: תשואות חודשיות נטו וברוטו, סטטיסטיקות בנוסחאות חיות'],
];

/** the tools as a row of links under the section's tabs */
export function ToolLinks() {
  return (
    <nav className="ftools-nav" aria-label="כלים">
      {TOOLS.slice(0, 4).map(([to, , t]) => <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{t}</NavLink>)}
    </nav>
  );
}

export function FundsTools() {
  return (
    <>
      <FundsHead sub="כלים: מחשבונים ומעקבים על הנתונים שהרשות מפרסמת. החישוב רץ בדפדפן; שום נתון שמוקלד לא נשלח" />
      <nav className="ftiles" aria-label="כלי החיסכון">
        {TOOLS.map(([to, icon, t, d]) => (
          <Link key={to} to={to} className="ftile"><span className="icotile lg"><Icon name={icon} /></span><b>{t}</b><span>{d}</span></Link>
        ))}
      </nav>
      <div className="fnote">כל מספר נפתח למקורו: נתון שפורסם מוביל לרשומה ברשות שוק ההון, ונתון מחושב מציג את הנוסחה, את הקלטים ואת ההנחות. אין כאן המלצה: תוצאות עבר אינן מבטיחות תוצאות בעתיד.</div>
    </>
  );
}
