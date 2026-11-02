/* W9 saver · "רגעים" (life moments): the five moments in a saver's year that are not "am I overpaying", each a page under
   /my/moment/<id> (pages/Moments.tsx), plus the default-fund lookup (`default`). This module is the registry and the search words only,
   kept light because the omnibox (lib/searchOmni) imports it; the pages' text and sources live in lib/momentsContent, the arithmetic in
   lib/momentsCalc. Pure (no React), node-testable (tests/moments.unit.ts). Descriptive, never advice. */
import { normalize, stems, terms } from './hebrew';

export type MomentId = 'job' | 'hishtalmut' | 'raise' | 'sixty' | 'switch' | 'default';
export interface MomentMeta {
  id: MomentId;
  /** the chip on /my (two or three words) */
  chip: string;
  /** the page's title, in the saver's own words */
  title: string;
  /** what the search result says under the title */
  meta: string;
  /** a query word that names the moment (one is needed) */
  strong: string[];
  /** words that may come with it ("עבודה" in "עזבתי עבודה") */
  weak: string[];
}

/** the order of the chip row on /my: the five moments (the default-fund page is reached from `job` and from search) */
export const CHIP_IDS: MomentId[] = ['job', 'hishtalmut', 'raise', 'sixty', 'switch'];

export const MOMENTS: Record<MomentId, MomentMeta> = {
  job: { id: 'job', chip: 'עזבתי עבודה', title: 'עזבתי עבודה או החלפתי עבודה', meta: 'הכיסוי הביטוחי, ההשתלמות, הפיצויים וטופס 161, והקרן אצל המעסיק החדש',
    strong: ['עזבתי', 'עזבת', 'עזיבה', 'עזיבת', 'עוזב', 'עוזבת', 'לעזוב', 'פיטורים', 'פיטורין', 'פוטרתי', 'פוטרה', 'פיטרו', 'מפוטר', 'התפטרתי', 'התפטרות', 'להתפטר', 'החלפתי', 'החלפת', 'מחליף', 'מחליפה', 'עבודה', 'עבודתי', 'פיצויים', 'פיצויי', '161', 'ריסק', 'חלת', 'אבטלה'],
    weak: ['מעבר', 'עובר', 'עוברת', 'מקום', 'מעסיק', 'המעסיק', 'חדש', 'חדשה', 'כספי', 'משיכת', 'משיכה', 'למשוך', 'טופס', 'פרישה', 'הסדר', 'כיסוי', 'ביטוח'] },
  hishtalmut: { id: 'hishtalmut', chip: 'משיכת השתלמות', title: 'למשוך את קרן ההשתלמות?', meta: 'מתי הכסף נזיל, מה המס, ומה עולה המשיכה בשקלים',
    strong: ['משיכת', 'משיכה', 'למשוך', 'מושך', 'מושכת', 'משכתי', 'נזיל', 'נזילה', 'נזילות', 'נזילים', 'פדיון'],
    weak: ['השתלמות', 'קרן', 'הקרן', 'כסף', 'הכסף', 'כספי', 'אפשר', 'שנים', 'לימודים'] },
  raise: { id: 'raise', chip: 'העלאה', title: 'קיבלתי העלאה בשכר', meta: 'כמה ההפקדה אמורה להיות עכשיו, ובדיקה מול ההפקדות שלך',
    strong: ['העלאה', 'העלאת', 'העלו', 'הועלה', 'תוספת', 'קידום'],
    weak: ['שכר', 'משכורת', 'בשכר', 'קיבלתי', 'הפקדה', 'הפקדות', 'ההפקדה'] },
  sixty: { id: 'sixty', chip: 'גיל 60', title: 'מתקרבים ל-60', meta: 'מסלולי הגיל, קצבה או סכום חד-פעמי, המקדם, פרישה ב-62/65/67 וקיבוע זכויות',
    strong: ['פרישה', 'פרישת', 'לפרוש', 'פורש', 'פורשת', 'קצבה', 'היוון', 'קיבוע', 'מקדם', 'גיל'],
    weak: ['מתקרב', 'מתקרבת', 'מתקרבים', 'זכויות', 'מוקדמת', 'חודשית', 'המרה', 'ההמרה', 'בגיל'] },
  switch: { id: 'switch', chip: 'ניוד', title: 'מישהו מציע לי לעבור קרן', meta: 'המסלול שלך מול המוצע, באותה קטגוריה, ומה קורה בניוד',
    strong: ['ניוד', 'לנייד', 'מנייד', 'ניידתי', 'לעבור', 'מעבר', 'הציעו', 'מציע', 'מציעה', 'מציעים', 'הצעה', 'העברה', 'להעביר'],
    weak: ['קרן', 'קופה', 'קופת', 'אחרת', 'חבר', 'אמר', 'סוכן', 'הסוכן', 'גמל', 'פנסיה', 'השתלמות', 'בין', 'קרנות'] },
  default: { id: 'default', chip: 'קרן ברירת המחדל', title: 'קרן ברירת המחדל שלך לפי ספרת ת"ז', meta: 'הקרן שהמנגנון משבץ אליה, מחיר המכרז, והפער מול דמי הניהול שלך',
    strong: ['ברירת', 'מחדל', 'ספרת', 'ספרה', 'זהות', 'תז', 'נבחרת', 'נבחרות'],
    weak: ['קרן', 'קרנות', 'ביקורת', 'לפי', 'תעודת', 'פנסיה', 'אחרונה'] },
};
export const momentPath = (id: MomentId) => `/my/moment/${id}`;
export const isMomentId = (x: unknown): x is MomentId => typeof x === 'string' && Object.prototype.hasOwnProperty.call(MOMENTS, x);

/** words that may stand in any query about a moment ("מה קורה כש…"); they never name one */
const STOP = ['מה', 'איך', 'אני', 'שלי', 'שלו', 'שלה', 'את', 'של', 'על', 'עם', 'אחרי', 'לפני', 'מתי', 'קורה', 'קורים', 'עושים', 'לעשות', 'צריך', 'כדאי', 'לי', 'יש', 'אם', 'או', 'גם', 'כל', 'זה'].map(normalize);
const norm = (ws: string[]) => ws.flatMap((w) => terms(w));
const KEYS = Object.values(MOMENTS).map((m) => ({ id: m.id, strong: norm(m.strong), weak: norm(m.weak) }));

/** a query word against a key: the key starts with it (type-ahead, three letters at least), or it is the key with an ending
 *  ("פיצויימ" ← "פיצוי"), directly or behind prefix letters ("בפרישה") */
function hit(w: string, k: string): boolean {
  for (const f of [w, ...stems(w)]) {
    if (f === k) return true;
    if (f.length >= 3 && k.startsWith(f)) return true;
    if (k.length >= 4 && f.startsWith(k)) return true;
  }
  return false;
}
/** a number the word index drops (two digits): "גיל 60", "פרישה ב-67", and "161ד" */
const AGE_NUM = /(^|[^\d])(5\d|6\d)(?!\d)/;

export interface MomentHit { id: MomentId; score: number }
/** The moments a query names: every word is the moment's (strong or weak) or a stop word, and one at least is strong. Best first.
 *  Score 98 and up, so a moment leads the saver's list over the tools (95) and the saver pages (93). */
export function momentHits(q: string): MomentHit[] {
  const raw = normalize(q);
  const ws = terms(raw).filter((w) => !STOP.includes(w));
  const age = AGE_NUM.test(raw), d161 = /161\s*ד/.test(raw);
  const out: MomentHit[] = [];
  for (const k of KEYS) {
    let strong = 0, ok = true;
    for (const w of ws) {
      if (w === '161' && d161) { if (k.id === 'sixty') strong++; else ok = false; continue; }
      if (k.strong.some((s) => hit(w, s))) strong++;
      else if (!k.weak.some((s) => hit(w, s))) { ok = false; break; }
    }
    if (ok && age && k.id === 'sixty') strong++;
    if (ok && strong > 0) out.push({ id: k.id, score: 98 + Math.min(strong, 9) / 10 + (ws.length ? strong / ws.length / 100 : 0) });
  }
  return out.sort((a, b) => b.score - a.score);
}
