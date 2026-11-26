import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './Sheet';

/* Plain-language layer (funds plan #28): one line of "מה זה אומר" per metric, behind a small "?" that opens on tap or hover.
   No figures in the text: it explains, the sourced number sits next to it. */
export const EXPLAIN: Record<string, [string, string]> = {
  gross: ['ברוטו', 'התשואה כפי שהרשות מפרסמת אותה, לפני דמי ניהול; כך מדווחים כל הגופים. האתר לא מנכה דמי ניהול מהתשואה: דמי הניהול שמשלם כל חוסך שונים ונקבעים מול הגוף המנהל. דמי הניהול מוצגים בנפרד.'],
  net: ['ברוטו', 'האתר מציג את התשואה ברוטו, כפי שהרשות מפרסמת, לפני דמי ניהול. דמי הניהול שמשלם כל חוסך שונים ונקבעים מול הגוף המנהל, ולכן אינם מנוכים מהתשואה; הם מוצגים בנפרד.'],
  real: ['ריאלי', 'התשואה אחרי האינפלציה: מנוכה במדד המחירים לצרכן של אותם חודשים. זה מה שהחיסכון הרוויח בכוח קנייה.'],
  fee: ['דמי ניהול מצבירה', 'אחוז שנתי מהיתרה הצבורה שהגוף גובה. זה הממוצע בפועל של כל העמיתים במסלול.'],
  depfee: ['דמי ניהול מהפקדה', 'אחוז מכל הפקדה חודשית. פועל על הכסף שנכנס, לא על התשואה. זה הממוצע בפועל של כל העמיתים במסלול.'],
  pct: ['אחוזון', 'כמה מהמסלולים האחרים באותו מוצר ומסלול השיגו תשואה נמוכה יותר בחלון. 100 הוא הגבוה בקטגוריה.'],
  sharpe: ['שארפ', 'תשואה עודפת על ריבית חסרת סיכון ליחידת תנודתיות, כפי שהרשות מחשבת. גבוה יותר: יותר תשואה לכל יחידת סיכון.'],
  sd: ['סטיית תקן', 'עד כמה התשואות החודשיות מתפזרות סביב הממוצע. גבוהה יותר: מסלול תנודתי יותר.'],
  vol: ['תנודתיות שנתית', 'סטיית התקן של התשואות החודשיות כפול שורש 12.'],
  dd: ['ירידה מרבית', 'הירידה הגדולה ביותר מהשיא לשפל שאחריו בחלון. כמה כואב היה הרגע הגרוע.'],
  rolling: ['תשואה מתגלגלת', 'התשואה בכל חלון של 12 או 36 חודשים שמסתיים בכל חודש. מראה אם ההצלחה עקבית או נשענת על תקופה אחת.'],
  winrate: ['שיעור ניצחון', 'בכמה מכל חלונות 36 החודשים המשותפים מסלול אחד הניב יותר מהאחר.'],
  underwater: ['מתחת לשיא', 'כמה רחוק היה המסלול בכל חודש מהשיא הקודם שלו. אפס: שיא חדש.'],
  growth: ['צמיחה של 100 ש"ח', 'לאן היו מגיעים 100 ש"ח שהושקעו בתחילת החלון, בלי הפקדות נוספות.'],
  equity: ['חשיפה למניות', 'שיעור הנכסים החשופים למניות, כפי שהגוף מדווח. שם המסלול לא תמיד מספר את כל הסיפור.'],
  family: ['משפחת מסלול', 'קיבוץ של שמות המסלולים ברשות לפי מה שהם אמורים להחזיק. הסיווג לפי השם; החשיפה בפועל מוצגת לידו.'],
  outlier: ['תווית מול מציאות', 'החשיפה למניות של המסלול רחוקה מהחציון בקטגוריה ביותר מסטיית תקן וחצי: "כללי" אינו תמיד אותו סיכון.'],
  closed: ['קופות ענפיות', 'קופות של ארגון או מפעל, שאינן פתוחות לכל הציבור. מחוץ לדירוג אלא אם בוחרים לכלול אותן.'],
  alpha: ['אלפא', 'התשואה העודפת על מדד הייחוס, כפי שהרשות מפרסמת.'],
};

/** The "?" next to a metric: tap or hover opens one line; Escape or a tap elsewhere closes it.
 *  On a phone it opens as a bottom sheet (never clipped, readable). On a wide screen the bubble is drawn on the page itself (a portal, fixed)
 *  and clamped to the viewport: inside a scrolling toolbar or a table cell it was cut at the container's edge, and showed empty in WebKit. */
const PHONE = '(max-width: 760px)';
export function Tip({ k }: { k: keyof typeof EXPLAIN | string }) {
  const e = EXPLAIN[k];
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const id = useId(), ref = useRef<HTMLSpanElement>(null), pop = useRef<HTMLSpanElement>(null);
  const close = () => { setOpen(false); setSheet(false); };
  useEffect(() => {
    if (!open || sheet) return;
    const off = (ev: PointerEvent) => { const t = ev.target as Node; if (!ref.current?.contains(t) && !pop.current?.contains(t)) close(); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
    addEventListener('pointerdown', off, true); addEventListener('keydown', key); addEventListener('resize', close); addEventListener('scroll', close, true);
    return () => { removeEventListener('pointerdown', off, true); removeEventListener('keydown', key); removeEventListener('resize', close); removeEventListener('scroll', close, true); };
  }, [open, sheet]);
  // place the bubble under the "?", then pull it inside the viewport (8 px margin), or above it when there is no room below
  useLayoutEffect(() => {
    if (!open || sheet || !ref.current || !pop.current) { setPos(null); return; }
    const a = ref.current.getBoundingClientRect(), w = pop.current.offsetWidth, h = pop.current.offsetHeight, vw = document.documentElement.clientWidth, vh = innerHeight;
    const left = Math.max(8, Math.min(a.left + a.width / 2 - w / 2, vw - w - 8));
    const top = a.bottom + 6 + h > vh - 8 && a.top - 6 - h > 8 ? a.top - 6 - h : a.bottom + 6;
    setPos({ left, top });
  }, [open, sheet]);
  if (!e) return null;
  const toggle = () => {
    if (open) { close(); return; }
    setSheet(matchMedia(PHONE).matches); setOpen(true);
  };
  return (
    // hover opens it only for a real mouse: on a phone the tap's emulated mouseenter opened it and the click then closed it again (the
    // iPhone red team, 02.11.26: aria-expanded stayed false), and iOS may skip the click when hover changes the page
    <span className="tip" ref={ref} onPointerEnter={(ev) => { if (ev.pointerType === 'mouse' && !matchMedia(PHONE).matches) { setSheet(false); setOpen(true); } }} onPointerLeave={(ev) => { if (ev.pointerType === 'mouse' && !sheet) close(); }}>
      <button type="button" className="tip-b" aria-label={`מה זה ${e[0]}`} aria-expanded={open} aria-describedby={open && !sheet ? id : undefined} onClick={(ev) => { ev.stopPropagation(); toggle(); }}>?</button>
      {open && !sheet && createPortal(
        <span className="tip-p" role="tooltip" id={id} ref={pop} style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}><b>{e[0]}</b> {e[1]}</span>,
        document.body)}
      <Sheet open={open && sheet} onClose={close} title={e[0]}><p className="tip-sheet">{e[1]}</p></Sheet>
    </span>
  );
}
