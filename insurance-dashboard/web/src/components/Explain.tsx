import { useEffect, useId, useRef, useState } from 'react';

/* Plain-language layer (funds plan #28): one line of "מה זה אומר" per metric, behind a small "?" that opens on tap or hover.
   No figures in the text: it explains, the sourced number sits next to it. */
export const EXPLAIN: Record<string, [string, string]> = {
  gross: ['ברוטו', 'התשואה כפי שהרשות מפרסמת אותה: לפני ניכוי דמי ניהול. כך מדווחים כל הגופים.'],
  net: ['נטו, אומדן', 'התשואה אחרי דמי הניהול מצבירה: מכל תשואה חודשית מנוכים דמי הניהול הממוצעים של המסלול באותו חודש חלקי 12. דמי הניהול שאתם משלמים בפועל יכולים להיות שונים.'],
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

/** The "?" next to a metric: tap or hover opens one line; Escape or a tap elsewhere closes it. */
export function Tip({ k }: { k: keyof typeof EXPLAIN | string }) {
  const e = EXPLAIN[k];
  const [open, setOpen] = useState(false);
  const id = useId(), ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (ev: PointerEvent) => { if (!ref.current?.contains(ev.target as Node)) setOpen(false); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    addEventListener('pointerdown', off, true); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', off, true); removeEventListener('keydown', key); };
  }, [open]);
  if (!e) return null;
  return (
    // hover opens it only for a real mouse: on a phone the tap's emulated mouseenter opened it and the click then closed it again (the
    // iPhone red team, 02.11.26: aria-expanded stayed false), and iOS may skip the click when hover changes the page
    <span className="tip" ref={ref} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}>
      <button type="button" className="tip-b" aria-label={`מה זה ${e[0]}`} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={(ev) => { ev.stopPropagation(); setOpen((o) => !o); }}>?</button>
      {open && <span className="tip-p" role="tooltip" id={id}><b>{e[0]}</b> {e[1]}</span>}
    </span>
  );
}
