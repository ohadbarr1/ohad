import { EXPLAIN, Tip } from '../Explain';

/* The saver's words (W1): the few terms the saver door shows, in one plain line each, on the site's own "?" (components/Explain). */
Object.assign(EXPLAIN, {
  track: ['מסלול', 'האופן שבו הכסף מושקע בתוך הקופה: כללי, מניות, לפי גיל ועוד. לכל מסלול תשואה ודמי ניהול משלו, ואפשר להחליף מסלול באותה קופה.'],
  y5: ['5Y', 'חמש השנים האחרונות. התשואה מוצגת כממוצע לשנה, כך שאפשר להשוות אותה לתשואה של שנה אחת.'],
  dflt: ['קרן ברירת מחדל', 'קרן פנסיה שהרשות בחרה בהליך תחרותי. עובד שלא בחר קרן בעצמו מצטרף אליה, ודמי הניהול שלו מוגבלים למחיר שנקבע בהליך.'],
  cat: ['קטגוריה', 'כל המסלולים מאותו מוצר ומאותו סוג מסלול (למשל פנסיה מקיפה, מסלול עד גיל 50). רק ביניהם ההשוואה הוגנת.'],
});

const WORDS: [string, string][] = [['net', 'נטו'], ['fee', 'דמי ניהול מצבירה'], ['depfee', 'מהפקדה'], ['track', 'מסלול'], ['y5', '5Y']];
/** "מילים בעמוד": the terms with their "?" */
export function GlossBar() {
  return (
    <p className="sv-gloss"><span className="sv-gloss-l">מילים בעמוד:</span>
      {WORDS.map(([k, w]) => <span key={k} className="sv-gloss-w">{w}<Tip k={k} /></span>)}
    </p>
  );
}
