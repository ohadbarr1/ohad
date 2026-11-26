/* Rollout F1 (spec 18.3; sentences of 3.4, 4.3, 5.4, 6.3, 7.3 as amended by 16–18 and mockup v4): every generated Hebrew sentence and
   line of the five rollout pages (fund card, screener, /my, savings hub, fees tool). No page builds a Hebrew sentence inline (10.3).
   Pure functions; node-tested (scripts/page-words-test.mjs, figures of 10/26 from the live data, gross).
   - Output convention (lib/compareWords): every figure, range and bracketed figure is ONE LTR isolate, LRI … PDI (U+2066 … U+2069),
     minus is U+2212; render with <NumText t={…} />. A bracketed figure carries its brackets inside the isolate ("⁦(−1.03%)⁩"), otherwise
     the bracket jumps to the line start in RTL (3.4).
   - Returns are gross, as published; nothing here says "נטו", "אחרי דמי ניהול" or "אומדן" beside a return (18.1).
   - Rounding: half-up (lib/compareMonths roundHalf): a month two decimals, a window one decimal; ₪ with thousands separators.
   - Grammar (parent §7): a label is a track ("המסלול של X" / "X ראשון"); "הממוצע ב<סוג>" names the type ("הממוצע בפנסיה כללי"); copy
     is gender-neutral; no "move", "cheaper for you" or "you would save". */
import { annual, GROSS_CORNER, GROSS_STAMP, type Per } from './funds';
import { tieBand } from './fundsTie';
import { heMonth, joinNames, whenWords, NEAR_EQUAL, ONE_MONTH_NOTE, OLD_POLICY_LINE } from './compareWords';
import { roundHalf } from './compareMonths';
import { MINUS, monthLabel, nf, sn } from './format';
import { BALANCE_EX } from './retire';

const LRI = '⁦', PDI = '⁩', EPS = 1e-9;
type N = number | null | undefined;
const has = (v: N): v is number => typeof v === 'number' && Number.isFinite(v);
export { NEAR_EQUAL, ONE_MONTH_NOTE };

/* ======================= figures ======================= */

/** "⁦1.44%⁩": the size, no sign (after a verb: "ירד 1.44%") */
export const pctAbs = (v: number, d = 2) => `${LRI}${nf(roundHalf(Math.abs(v), d), d)}%${PDI}`;
/** "⁦+9.0%⁩", "⁦−0.72%⁩" */
export const pctSigned = (v: number, d = 1) => `${LRI}${sn(roundHalf(v, d), d)}%${PDI}`;
/** "⁦(−1.03%)⁩": one isolate with its brackets */
export const pctBracket = (v: number, d = 2) => `${LRI}(${sn(roundHalf(v, d), d)}%)${PDI}`;
/** "⁦1,170⁩" (₪ amounts in running text, after "כ-" or before "ש״ח") */
export const ilsNum = (v: number) => `${LRI}${Math.round(v).toLocaleString('en-US')}${PDI}`;
/** "⁦₪1,170⁩" (in a line or a cell) */
export const ilsSym = (v: number) => `${LRI}₪${Math.round(v).toLocaleString('en-US')}${PDI}`;
/** a count or an age: "⁦5⁩" */
export const numIso = (v: number | string) => `${LRI}${v}${PDI}`;
/** the sign a reader sees at `d` decimals: 1, −1 or 0 */
const shownSign = (v: number, d: number) => Math.sign(roundHalf(v, d));

/* ======================= names: products, types, months, periods ======================= */

const PROD_SHORT: Record<string, string> = { 'פנסיה מקיפה': 'פנסיה', 'פנסיה כללית': 'פנסיה כללית', 'השתלמות': 'השתלמות', 'גמל להשקעה': 'גמל להשקעה', 'גמל': 'קופת גמל', 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)': 'פוליסות' };
/** the product in the hub's chips and in sentences: "פנסיה", "השתלמות", "גמל להשקעה", "קופת גמל", "פוליסות", "ביטוח מנהלים ישן" */
export function prodLabel(prod: string): string {
  if (/^ביטוחי מנהלים (1990|1992)/.test(prod)) return 'ביטוח מנהלים ישן';
  return PROD_SHORT[prod] ?? prod;
}
const TYPE_SHORT: Record<string, string> = { 'עוקב מדד S&P 500': 'S&P 500', 'אשראי ואג"ח': 'אג״ח', 'עוקב מדדי מניות': 'מדדי מניות', 'מקבלי קצבה': 'קצבה', 'עד 50': 'עד גיל 50', '50-60': 'גיל 50 עד 60', '60 ומעלה': 'מגיל 60' };
/** a track type's label (16.1 #8a: no dash to flip): "עד גיל 50", "גיל 50 עד 60", "מגיל 60", "S&P 500", "אג״ח", "מדדי מניות"; else as is */
export const typeLabel = (track: string) => TYPE_SHORT[track] ?? track;
/** a type named in a sentence or a head: "פנסיה כללי", "השתלמות כללי", "גמל להשקעה כללי" (key = cat.json key "<prod> | <track>") */
export function typeName(key: string): string {
  const [p, t] = key.split(' | ');
  return `${prodLabel(p)} ${typeLabel(t ?? '')}`.trim();
}
/** "באוקטובר" */
export const inMonth = (p: number) => `ב${heMonth(p)}`;
/** "אוקטובר 2026" */
export const monthYear = (p: number) => `${heMonth(p)} ${Math.floor(p / 100)}`;
/** The saver's period words as the head of a sentence (16.1 4c): "באוקטובר", "מתחילת 2026", "ב-12 החודשים האחרונים",
 *  "ב-3 השנים האחרונות", "ב-5 השנים האחרונות". */
export function perWords(per: Per, asof: number): string {
  switch (per) {
    case 'm1': return inMonth(asof);
    case 'ytd': return `מתחילת ${Math.floor(asof / 100)}`;
    case 'y12': return 'ב-12 החודשים האחרונים';
    case 'a3': return 'ב-3 השנים האחרונות';
    case 'a5': return 'ב-5 השנים האחרונות';
  }
}
const perYr = (per: Per) => (annual(per) ? ' בשנה' : '');

/* ======================= the one wording of the basis (18.1 #2) ======================= */

/** the grid's corner label */
export const CORNER = GROSS_CORNER;
/** the stamp, without the "איך מחשבים?" button the page appends: "רשות שוק ההון · 10/26 · תשואה ברוטו, כפי שמפורסמת · העבר אינו מבטיח עתיד" */
export const stampWords = (asof: number, extra = '') => `רשות שוק ההון · ${numIso(monthLabel(asof))} · ${GROSS_STAMP}${extra} · העבר אינו מבטיח עתיד`;
export const WHY_LINK = 'איך מחשבים?';
export const WHY_TEXT = 'התשואה היא התשואה ברוטו שהרשות מפרסמת, לפני דמי ניהול. דמי הניהול שונים מחוסך לחוסך, ולכן הם מוצגים בנפרד, בשקלים, ולא מנוכים מהתשואה.';
/** a sheet's sub-title suffix: "… · לפני דמי ניהול" */
export const BEFORE_FEES = 'לפני דמי ניהול';

/* ======================= places (16.1 5b, 18.5) ======================= */

export interface PlaceLike { lo: number | null; hi: number | null; n: number }
/** "מקום 5 מתוך 5" · "מהראשונים (1–3 מתוך 5)" · "מהאחרונים (4–5 מתוך 5)" · "באמצע (5–6 מתוך 13)"; the range is one isolate.
 *  Every ranked track in one group: "כל 5 המסלולים כמעט שווים". '' when not ranked. */
export function placeWords(pl: PlaceLike | null | undefined, tail = ''): string {
  if (!pl || pl.lo == null || pl.hi == null || !pl.n) return '';
  const { lo, hi, n } = pl, of = `מתוך ${numIso(n)}${tail}`;
  if (lo === hi) return `מקום ${numIso(lo)} ${of}`;
  if (lo === 1 && hi === n) return `כל ${numIso(n)} המסלולים כמעט שווים`;
  const r = `${numIso(`${lo}–${hi}`)} ${of}`;
  return lo === 1 ? `מהראשונים (${r})` : hi === n ? `מהאחרונים (${r})` : `באמצע (${r})`;
}
/** "ב-5 השנים האחרונות: מקום 2 מתוך 5" (the card's "במילים פשוטות" row, the hint line) */
export const placeLine = (per: Per, pl: PlaceLike | null | undefined, asof: number) => (placeWords(pl) ? `${perWords(per, asof)}: ${placeWords(pl)}` : '');
/** The closing note of a board where any place is shared (18.5): "מסלולים בהפרש קטן מ-0.05% בחודש חולקים מקום, והמקום הבא ממשיך לפי
 *  הסדר (1, 1, 3)." · 12 months, 3 and 5 years: "0.10% בשנה" · the year to date: its pro-rata band. */
export function tieNote(per: Per, asof?: number): string {
  const band = per === 'm1' ? `${numIso('0.05%')} בחודש` : per === 'ytd' ? numIso(`${(asof != null ? tieBand('ytd', asof) : 0.1).toFixed(2)}%`) : `${numIso('0.10%')} בשנה`;
  return `מסלולים בהפרש קטן מ-${band} חולקים מקום, והמקום הבא ממשיך לפי הסדר (${numIso('1, 1, 3')}).`;
}
export const NONE_YET = 'אין עדיין';

/* ======================= the fund card (3.4, 16.1 #7, 18.6) ======================= */

const moved = (v: number, d = 2) => (shownSign(v, d) > 0 ? `עלה ${pctAbs(v, d)}` : shownSign(v, d) < 0 ? `ירד ${pctAbs(v, d)}` : 'לא זז');
const avgOf = (type?: string | null) => (type ? `הממוצע ב${type}` : 'הממוצע');

export const NO_MONTHLY = 'אין עדיין תשואה חודשית למסלול הזה.';
/** "מסלול חדש: פורסמו 3 חודשים." */
export const newTrackWords = (months: number) => `מסלול חדש: פורסמו ${numIso(months)} חודשים.`;

export interface CardWordsOpts {
  /** the published last-year return (f.y12); omitted under 12 months */
  y12?: N;
  /** the type, named: "פנסיה כללי" (typeName); without it "הממוצע" */
  type?: string | null;
  /** months the track has published: under 12 the sentence drops the year and ends "מסלול חדש: פורסמו N חודשים." */
  months?: number;
}
/**
 * `#month-insight` of the card (18.6): "באוקטובר המסלול ירד 1.44%, יותר מהממוצע בפנסיה כללי (−1.03%). בשנה האחרונה עלה 9.2%."
 * Cases (3.4): fell / rose more or less than the average; opposite signs ("…עלה 0.16%, והממוצע בפנסיה כללי ירד 0.16%"); inside
 * 0.05 ("כמעט כמו הממוצע ב…"); zero ("המסלול לא זז"); no average (the clause dropped); under 12 months; no monthly return at all.
 * `p`: the month of `v` (the track's newest; a track that stopped reporting names its last month).
 */
export function cardWords(p: number, v: N, avg: N, o: CardWordsOpts = {}): string {
  if (!has(v)) return NO_MONTHLY;
  let s = `${inMonth(p)} המסלול ${moved(v)}`;
  const t = avgOf(o.type);
  if (has(avg)) {
    const d = v - avg, sv = shownSign(v, 2), sa = shownSign(avg, 2);
    if (Math.abs(d) < 0.05 - EPS) s += `, כמעט כמו ${t}`;
    else if (sv === 0 || sa === 0 || sv !== sa) s += sa === 0 ? `, ו${t} לא זז` : `, ו${t} ${sa > 0 ? 'עלה' : 'ירד'} ${pctAbs(avg, 2)}`;
    else s += `, ${(v < 0 ? d < 0 : d > 0) ? 'יותר' : 'פחות'} מ${t} ${pctBracket(avg, 2)}`;
  }
  s += '.';
  if (o.months != null && o.months < 12) return `${s} ${newTrackWords(o.months)}`;
  if (has(o.y12)) s += ` בשנה האחרונה ${moved(o.y12, 1)}.`;
  return s;
}
/** above / below / about the type's average, band `band`, `d` decimals: ", מעל הממוצע בפנסיה כללי (⁦+15.9%⁩)" */
function vsClause(v: number, avg: N, type: string | null | undefined, band: number, d: number): string {
  if (!has(avg)) return '';
  if (Math.abs(v - avg) < band - EPS) return `, כמעט כמו ${avgOf(type)}`;
  return `, ${v > avg ? 'מעל הממוצע' : 'מתחת לממוצע'}${type ? ` ב${type}` : ''} ${pctBracket(avg, d)}`;
}
/** The years lens (18.6): "ב-2025 המסלול עלה 15.6%, מתחת לממוצע בפנסיה כללי (⁦+15.9%⁩)." The current year reads "מתחילת 2026"
 *  (pass `asof`). Band 0.10 ("כמעט כמו הממוצע ב…"). */
export function cardYearWords(yr: number, v: N, avg: N, o: { type?: string | null; asof?: number } = {}): string {
  if (!has(v)) return '';
  return `${whenWords(yr, o.asof)} המסלול ${moved(v, 1)}${vsClause(v, avg, o.type, 0.1, 1)}.`;
}
/** The long lens (18.6): "ב-5 השנים האחרונות המסלול עלה 8.8% בשנה בממוצע, כמעט כמו הממוצע בפנסיה כללי. מקום 2 מתוך 5."
 *  `per`: y12 / a3 / a5; band 0.10; the place from pageMonths `placeOf` (omitted when null). */
export function cardLongWords(per: 'y12' | 'a3' | 'a5', v: N, avg: N, o: { asof: number; type?: string | null; place?: PlaceLike | null }): string {
  if (!has(v)) return '';
  const pw = placeWords(o.place);
  return `${perWords(per, o.asof)} המסלול ${moved(v, 1)}${annual(per) ? ' בשנה בממוצע' : ''}${vsClause(v, avg, o.type, 0.1, 1)}.${pw ? ` ${pw}.` : ''}`;
}
/** the hint line under the grid (3.2 #5): "הקשה על מספר פותחת את החודש · ב-5 השנים האחרונות: מקום 2 מתוך 5" */
export const cardHint = (per: Per | null, pl: PlaceLike | null | undefined, asof: number) => {
  const l = per ? placeLine(per, pl, asof) : '';
  return `הקשה על מספר פותחת את החודש${l ? ` · ${l}` : ''}`;
};
/** the average column's head: "הממוצע" over "פנסיה כללי · 5 ›" */
export const AVG_HEAD = 'הממוצע';
export const avgHeadSub = (type: string, n: number) => `${type} · ${numIso(n)} ›`;
/** `#who-best` (16.1 1b): "מי היה ראשון באוקטובר מבין 5 המסלולים? ›" (the "›" is the row's own glyph) */
export const cardWhoBest = (p: number, n: number) => `מי היה ראשון ${inMonth(p)} מבין ${numIso(n)} המסלולים?`;
/** `#cmp-cta`: "להשוות מול מנורה וכלל ›" */
export const cmpCta = (labels: string[]) => `להשוות מול ${joinNames(labels)} ›`;
/** the fee row's sub-label (16.1 2c, 17.1 1c): "בשנה, לדוגמה ›" / "בשנה, שלך ›" */
export const FEE_ROW = 'דמי ניהול';
export const feeRowSub = (own: boolean) => (own ? 'בשנה, שלך ›' : 'בשנה, לדוגמה ›');
/** the three rows under the grid (3.2 #7) */
export const CARD_ROWS = {
  plain: { title: 'במילים פשוטות', sub: 'מקום, דמי ניהול, ברירת מחדל, שירות' },
  mine: { title: 'זה המסלול שלי', sub: 'לשמור ולעקוב מדי חודש' },
  pro: { title: 'פרטים מקצועיים', sub: 'סיכון, משברים, חשיפות, תזרים וייצוא' },
} as const;
/** the head's worded actions (16.1 8c) and the watch toast */
export const ACT_COMPARE = 'השוואה', ACT_WATCH = 'מעקב', WATCH_TOAST = 'נוסף למעקב ★';

/* card edge cases (3.5) */
export const SELF_MANAGED_GUARD = 'מסלול בניהול אישי: כל חוסך בוחר את ההשקעות בעצמו, ולכן אין למסלול תשואה אחת.';
export const NO_MONTHLY_GUARD = 'למסלול הזה עדיין לא פורסמה תשואה חודשית.';
/** compare's OLD_POLICY_LINE, first sentence only (3.5) */
export const OLD_POLICY_GUARD = OLD_POLICY_LINE.split('. ')[0] + '.';
export const NO_FEE_TRACK = 'דמי הניהול לא מתפרסמים למסלול הזה';
export const SECTORAL = 'קופה ענפית או מפעלית';
export const STOPPED_TAG = 'נסגר';
export const NOT_FOUND = 'המסלול לא נמצא או אינו פעיל';

/* the month sheet of the track (16.1 1a) */
export const MONTH_SHEET_SUB = `כמה עשה המסלול בחודש הזה · ${BEFORE_FEES}`;
/** "המסלול מתחת לממוצע בפנסיה כללי, ב-0.41%." ("כמעט כמו הממוצע ב…" inside 0.05, without the gap). Build review B1: one vocabulary
 *  with the card's sentence ("הממוצע ב<סוג>"), and no member count here: the average is the regulator's asset-weighted figure over
 *  every member, so a count beside it would be a second number for the type (P2-1). */
export function monthSheetVs(v: N, avg: N, type: string): string {
  if (!has(v) || !has(avg)) return '';
  const d = v - avg, near = Math.abs(d) < 0.05 - EPS;
  const rel = near ? 'כמעט כמו הממוצע' : d > 0 ? 'מעל הממוצע' : 'מתחת לממוצע';
  return `המסלול ${rel} ב${type}${near ? '' : `, ב-${pctAbs(d, 2)}`}.`;
}
/** the month sheet's link to the type-month sheet: "כל 5 המסלולים באוקטובר" */
export const allTracksIn = (n: number, p: number) => `כל ${numIso(n)} המסלולים ${inMonth(p)}`;

/* the type-month sheet (16.1 1a, 16.2 T-C7) */
/** "אוקטובר 2026 · פנסיה כללי" */
export const typeMonthTitle = (p: number, type: string) => `${monthYear(p)} · ${type}`;
/** the self-managed remainder of a type (build review B1, P2-1): "ועוד 7 בניהול אישי"; '' when there are none */
export const selfMore = (n: number) => (n > 0 ? `ועוד ${numIso(n)} בניהול אישי` : '');
/** "כל 5 המסלולים מהסוג הזה · לפני דמי ניהול"; with self-managed tracks "כל 13 המסלולים מהסוג הזה, ועוד 7 בניהול אישי · לפני דמי ניהול" */
export const typeMonthSub = (n: number, self = 0) => `כל ${numIso(n)} המסלולים מהסוג הזה${self > 0 ? `, ${selfMore(self)}` : ''} · ${BEFORE_FEES}`;
export const TO_SCREEN = 'לכל המסלולים מהסוג הזה ›';

/* the fee sheet (2c, 17.1 1c) */
export const FEE_SHEET_TITLE = 'דמי ניהול, בשקלים';
/** sub-title: "לדוגמה, על סכום אחד לכולם", or the reader's base ("על הסכומים שלך") */
export const feeSheetSub = (own: boolean, base: string) => (own ? base : 'לדוגמה, על סכום אחד לכולם');
/** "מהחיסכון: 100,000 × 0.14%" */
export const feeFromBalance = (balance: number, fee: number) => `מהחיסכון: ${ilsNum(balance)} × ${pctAbs(fee, 2)}`;
/** "מההפקדות: 12 × 2,220 × 1.56%" */
export const feeFromDeposits = (monthly: number, depfee: number) => `מההפקדות: ${numIso(12)} × ${ilsNum(monthly)} × ${pctAbs(depfee, 2)}`;
export const FEE_TOTAL_YEAR = 'סך הכול בשנה, בערך';
export const FEE_SHEET_NOTE = 'אלה דמי הניהול הממוצעים במסלול, לא מה שחוסך מסוים משלם. הסכום שלך כתוב בדוח השנתי.';
/** build review B2 (P3-a): the fee sheet's closing note when the reader's own fee prices it (myFeeCost ownFee) */
export const FEE_SHEET_NOTE_OWN = 'לפי דמי הניהול שהזנת מהדוח השנתי.';
export const FEE_SHEET_CALC = 'לחשב על הסכומים שלי';
export const FEE_SHEET_TO_TOOL = 'כל המסלולים מהסוג הזה, לפי מחיר ›';

/* ======================= the screener (4.3, 16.1 4b, 18.6) ======================= */

export const NO_PERIOD_FIGURE = 'אין מסלולים עם תשואה לתקופה הזאת.';
export interface Named { label: string; v: N }
/**
 * `#takeaway` of the screener (18.6). Rows in any order (sorted here, best first); the band is the site's (`tieBand(per, asof)`).
 * "ב-5 השנים האחרונות מנורה ראשון: ⁦+9.0%⁩ בשנה. הפער בין הראשון לאחרון: ⁦0.7%⁩ בשנה." ·
 * "באוקטובר הראל גילעד, הראל מנוף ומנורה כמעט שווים בראש. הפער בין הראשון לאחרון: ⁦0.73%⁩." ·
 * more than three at the top: "… 4 מסלולים כמעט שווים בראש. …" · all inside: "באוקטובר כל 5 המסלולים כמעט שווים." ·
 * one track: "ב-12 החודשים האחרונים: הראל, ⁦+8.3%⁩." · none: "אין מסלולים עם תשואה לתקופה הזאת."
 * Pass only ranked rows (pageMonths `scoreRows(...).filter(r => r.ranked)`).
 */
export function screenWords(per: Per, rows: Named[], asof: number, band = tieBand(per, asof)): string {
  const r = rows.filter((x): x is { label: string; v: number } => has(x.v)).sort((a, b) => b.v - a.v);
  if (!r.length) return NO_PERIOD_FIGURE;
  const d = per === 'm1' ? 2 : 1, when = perWords(per, asof), yr = perYr(per);
  if (r.length === 1) return `${when}: ${r[0].label}, ${pctSigned(r[0].v, d)}.`;
  const top = r.filter((x) => r[0].v - x.v < band - EPS), gap = r[0].v - r[r.length - 1].v;
  if (top.length === r.length) return `${when} כל ${numIso(r.length)} המסלולים כמעט שווים.`;
  const head = top.length > 3 ? `${numIso(top.length)} מסלולים כמעט שווים בראש` : top.length > 1 ? `${joinNames(top.map((x) => x.label))} כמעט שווים בראש` : `${top[0].label} ראשון: ${pctSigned(top[0].v, d)}${yr}`;
  return `${when} ${head}. הפער בין הראשון לאחרון: ${pctAbs(gap, d)}${yr}.`;
}
/** the head's second line: "5 מסלולים מהסוג הזה · 10/26"; `n` = ranked for the period on screen (pageMonths `typeCount`), and the
 *  self-managed remainder when there is one: "13 מסלולים מהסוג הזה, ועוד 7 בניהול אישי · 10/26" */
export const screenHead = (n: number, asof: number, self = 0) => `${numIso(n)} מסלולים מהסוג הזה${self > 0 ? `, ${selfMore(self)}` : ''} · ${numIso(monthLabel(asof))}`;
export interface SubFund { m1?: N; y12?: N; fee?: N; depfee?: N; act?: N; st?: N; sharpe?: N; pr?: Partial<Record<Per, N>> | null }
const dash = (v: N, f: (x: number) => string) => (has(v) ? f(v) : numIso('–'));
/**
 * The quiet line under a board row (4.2 #6, 16.1 4b): saver "ב-12 חודשים: ⁦+10.3%⁩" (on the 12-month view: "באוקטובר: ⁦−0.73%⁩");
 * agent "ד״נ 0.14% · מהפקדה 1.56% · איזון −0.05%" (no actuarial balance: "מניות 51%"); Pro "אחוזון 75 · ד״נ 0.14% · שארפ 1.28 · מניות 51%".
 */
export function screenSub(door: 'saver' | 'agent' | 'pro', f: SubFund, per: Per, asof: number): string {
  if (door === 'saver') return per === 'y12' ? `${inMonth(asof)}: ${dash(f.m1, (v) => pctSigned(v, 2))}` : `ב-12 חודשים: ${dash(f.y12, (v) => pctSigned(v, 1))}`;
  const fee = `ד״נ ${dash(f.fee, (v) => pctAbs(v, 2))}`, st = `מניות ${numIso(`${nf(roundHalf(f.st ?? 0, 0), 0)}%`)}`;
  if (door === 'agent') return `${fee}${has(f.depfee) ? ` · מהפקדה ${pctAbs(f.depfee, 2)}` : ''}${has(f.act) ? ` · איזון ${pctSigned(f.act, 2)}` : ` · ${st}`}`;
  const pr = f.pr?.[per];
  return `אחוזון ${numIso(has(pr) ? String(pr) : '–')} · ${fee} · שארפ ${dash(f.sharpe, (v) => numIso(nf(roundHalf(v, 2), 2)))} · ${st}`;
}
/** the board's closing average line: saver "ממוצע פנסיה כללי · בשנה, בממוצע"; agent and Pro "ממוצע הקטגוריה" */
export const screenBench = (door: 'saver' | 'agent' | 'pro', type: string, per: Per) => `${door === 'saver' ? `ממוצע ${type}` : 'ממוצע הקטגוריה'}${annual(per) ? ' · בשנה, בממוצע' : ''}`;
/** `#to-hub` (17.1 3a) */
export const TO_HUB = 'החודש בחיסכון: מה קרה בכל סוג מסלול';
export const EMPTY_FILTER = 'אין מסלולים בסינון הזה', CLEAR_FILTER = 'ניקוי הסינון';
export const TO_CARD = 'לכרטיס המסלול ›', ADD_COMPARE = '＋ להשוואה', IN_COMPARE = '✓ בהשוואה';

/* ======================= /my (5.4, 16.1 5b/5e, 17.1 1b, 18.2 +) ======================= */

export const MY_NO_MONTHLY = 'אין עדיין תשואה חודשית למוצרים שלך.';
const count = (n: number) => (n === 1 ? 'אחד' : n === 2 ? 'שניים' : numIso(n));
/**
 * `#takeaway` of /my (18.6): "באוקטובר שניים מהמסלולים שלך ירדו ואחד כמעט לא זז. בשנה האחרונה כולם עלו: בין ⁦+8.9%⁩ ל-⁦+9.2%⁩."
 * `items`: per product, `m` = the month's return (its newest month), `y` = the published last year. A move inside the month's band
 * (0.05) reads "כמעט לא זז"; counts are words and agree in number. One product: "באוקטובר המסלול שלך ירד 1.44%. בשנה האחרונה הוא
 * עלה 9.2%." Never adds products together, never states a shekel gain (5.4). `who`: another household profile ("בן/בת הזוג") →
 * "המסלולים של בן/בת הזוג".
 */
export function myWords(p: number, items: { m: N; y: N }[], o: { who?: string | null } = {}): string {
  const a = items.filter((x): x is { m: number; y: N } => has(x.m));
  const of = o.who ? `של ${o.who}` : 'שלך';
  if (!a.length) return o.who ? `אין עדיין תשואה חודשית למוצרים ${of}.` : MY_NO_MONTHLY;
  const flat = (v: number) => Math.abs(v) < 0.05 - EPS;
  const when = inMonth(p);
  if (a.length === 1) {
    const x = a[0];
    return `${when} המסלול ${of} ${flat(x.m) ? 'כמעט לא זז' : moved(x.m)}.${has(x.y) ? ` בשנה האחרונה הוא ${moved(x.y, 1)}.` : ''}`;
  }
  const up = a.filter((x) => !flat(x.m) && x.m > 0).length, dn = a.filter((x) => !flat(x.m) && x.m < 0).length, fl = a.length - up - dn;
  const all = a.length === 2 ? 'שני' : `כל ${numIso(a.length)}`;
  let s: string;
  if (dn === a.length) s = `${when} ${all} המסלולים ${of} ירדו.`;
  else if (up === a.length) s = `${when} ${all} המסלולים ${of} עלו.`;
  else if (fl === a.length) s = `${when} ${all} המסלולים ${of} כמעט לא זזו.`;
  else {
    const parts = ([[dn, 'ירד', 'ירדו'], [up, 'עלה', 'עלו'], [fl, 'כמעט לא זז', 'כמעט לא זזו']] as [number, string, string][])
      .filter((x) => x[0]).map(([n, one, many], i) => `${i ? (n > 2 ? 'ו-' : 'ו') : ''}${count(n)}${i ? '' : ` מהמסלולים ${of}`} ${n === 1 ? one : many}`);
    s = `${when} ${parts.join(' ')}.`;
  }
  const ys = a.map((x) => x.y).filter(has);
  if (ys.length === a.length) {
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const lr = roundHalf(lo, 1), hr = roundHalf(hi, 1), both = a.length === 2 ? 'שניהם' : 'כולם';
    // build review B1 (novice #1): the same figure for everyone reads as one figure, not "בין +9.2% ל-+9.2%"
    if (lr === hr) s += lr === 0 ? ` בשנה האחרונה ${both} כמעט לא זזו.` : ` בשנה האחרונה ${both} ${lr > 0 ? 'עלו' : 'ירדו'} ${pctAbs(lo, 1)}.`;
    else s += lr > 0 ? ` בשנה האחרונה כולם עלו: בין ${pctSigned(lo, 1)} ל-${pctSigned(hi, 1)}.` : hr < 0 ? ' בשנה האחרונה כולם ירדו.' : ' בשנה האחרונה חלק עלו וחלק ירדו.';
  }
  return s;
}
/** The line under the month squares (16.1 5e, 18.6): "באוקטובר: מתחת לממוצע בפנסיה כללי (⁦−1.03%⁩)"; inside 0.05 "כמו הממוצע". */
export function vsAvgParts(p: number, v: N, avg: N, type: string): { when: string; rel: string; rest: string } | null {
  if (!has(v) || !has(avg)) return null;
  const rel = Math.abs(v - avg) < 0.05 - EPS ? 'כמו הממוצע' : v > avg ? 'מעל הממוצע' : 'מתחת לממוצע';
  return { when: `${inMonth(p)}:`, rel, rest: `ב${type} ${pctBracket(avg, 2)}` };
}
export function vsAvgWords(p: number, v: N, avg: N, type: string): string {
  const x = vsAvgParts(p, v, avg, type);
  return x ? `${x.when} ${x.rel} ${x.rest}` : '';
}
/** "בשנה האחרונה: ⁦+9.2%⁩ · מקום 5 מתוך 5" (16.1 5b) */
export const FULL_YEAR_TAIL = ' שיש להם שנה מלאה';
/** Build review B2 (novice B2 #3): `typeN` = the tracks of the type the card, the hub and the screener count on the month; when fewer
 *  are ranked over 12 months (a track younger than a year), the count says why: "באמצע (5–6 מתוך 12 שיש להם שנה מלאה)". */
export const myYearLine = (y12: N, pl?: PlaceLike | null, typeN?: number | null) => {
  const pw = placeWords(pl, pl && typeN && pl.n < typeN ? FULL_YEAR_TAIL : '');
  return has(y12) ? `בשנה האחרונה: ${pctSigned(y12, 1)}${pw ? ` · ${pw}` : ''}` : '';
};
/** a product's fee line (5.2, 17.1): text "דמי ניהול ⁦₪560⁩ בשנה" and its tag: "לדוגמה", or the base ("על הסכומים שלך") */
export const myFeeLine = (cost: N, own: boolean, base: string) => ({ text: `דמי ניהול ${has(cost) ? ilsSym(cost) : numIso('–')} בשנה`, tag: own ? base : 'לדוגמה' });
const allProducts = (n: number) => (n === 1 ? 'המוצר' : n === 2 ? 'שני המוצרים' : `כל ${numIso(n)} המוצרים`);
/** `#fee-sum` (5.2, 17.1 1b, 18.6): "דמי ניהול, לדוגמה: כ-1,710 ש״ח בשנה על כל 3 המוצרים" (all on the example) ·
 *  "דמי ניהול: כ-2,320 ש״ח בשנה על כל 3 המוצרים" + "כולל 2 מוצרים על דוגמה של 100,000 ש״ח" · all typed: no second line. */
export function myFeeSum(items: { cost: N; own: boolean }[]): { text: string; sub: string } {
  const tot = items.reduce((t, x) => t + (has(x.cost) ? x.cost : 0), 0), ex = items.filter((x) => !x.own).length, n = items.length;
  const text = `דמי ניהול${ex === n ? ', לדוגמה' : ''}: כ-${ilsNum(tot)} ש״ח בשנה על ${allProducts(n)}`;
  const sub = !ex ? '' : ex === n ? `על חיסכון של ${ilsNum(BALANCE_EX)} ש״ח בכל מוצר, לפי הממוצע במסלול` : `כולל ${ex === 1 ? 'מוצר אחד' : `${numIso(ex)} מוצרים`} על דוגמה של ${ilsNum(BALANCE_EX)} ש״ח`;
  return { text, sub };
}
/** the fee breakdown sheet (16.1 5d, 17.1 1b) */
export const MY_FEES_TITLE = 'דמי ניהול בשנה, לפי מוצר';
export function myFeesSub(items: { own: boolean }[]): string {
  const ex = items.filter((x) => !x.own).length;
  return ex === items.length ? `לדוגמה: חיסכון של ${ilsNum(BALANCE_EX)} ש״ח בכל מוצר` : ex ? `${ex === 1 ? 'מוצר אחד' : `${numIso(ex)} מוצרים`} עדיין על דוגמה` : 'על הסכומים שלך';
}
export const myFeesRowTag = (own: boolean) => (own ? 'על הסכומים שלך · לשנות ›' : 'לדוגמה · להזין את שלי ›');
export const MY_FEES_TOTAL = 'סך הכול, בערך';
export const MY_FEES_NOTE = 'לפי דמי הניהול הממוצעים בכל מסלול. מה שמשלמים בפועל כתוב בדוח השנתי.';
/** `#todo-amt`: "כדי לראות את המספר שלך במיטב · השתלמות כללי: להזין כמה יש בו וכמה מפקידים" (`deposits` false: without the deposit) */
export const todoAmounts = (label: string, deposits = true) => `כדי לראות את המספר שלך ב${label}: להזין כמה יש בו${deposits ? ' וכמה מפקידים' : ''}`;
/** the card's full label on /my and in sheets: "מגדל · פנסיה כללי" */
export const fullLabel = (grp: string, key: string) => `${grp} · ${typeName(key)}`;
export const MY_TITLE = 'המוצרים שלי', ME_BTN = 'הפרטים שלי', MY_COMPARE = 'השוואה ›';
export const MY_EMPTY_LINE = 'מה יש לך? בוחרים מוצר, חברה ומסלול. שלוש הקשות.';
export const MY_IMPORT = 'או: לייבא הכול מהדוח של המסלקה הפנסיונית';
export const MY_EXAMPLE = 'כך זה ייראה', MY_EXAMPLE_TAG = 'דוגמה · לא המוצר שלך';
export const MY_PRIVACY = 'הכול נשמר רק בדפדפן הזה, בלי הרשמה. מידע תיאורי, לא ייעוץ.';
export const MY_GONE = 'המוצר כבר לא מתפרסם';
export const MY_CHIPS = ['＋ מוצר נוסף', 'ייבוא מהמסלקה', 'הבדיקה השנתית'] as const;
export const ACTION_EXAMPLE = 'כדי לראות את המספרים שלך: להזין יתרה ודמי ניהול מהדוח השנתי';
/** The retirement gap in the product sheet (5.2): "בדוגמה (חיסכון 100,000 ש״ח, גיל 38): כ-10,700 ש״ח יותר בגיל הפרישה" until the
 *  reader typed a balance; then "יהיו לך כ-10,700 ש״ח יותר בגיל הפרישה". */
export const retireGapWords = (gap: number, own: boolean, ex: { balance?: number; age: number }) =>
  own ? `יהיו לך כ-${ilsNum(gap)} ש״ח יותר בגיל הפרישה` : `בדוגמה (חיסכון ${ilsNum(ex.balance ?? BALANCE_EX)} ש״ח, גיל ${numIso(ex.age)}): כ-${ilsNum(gap)} ש״ח יותר בגיל הפרישה`;

/* ======================= the savings hub (6.3, 16.1 3d, 17.1 2a–2d, 18.6) ======================= */

export interface HubCol { label: string; v: N }
/**
 * `#month-insight` of the hub. With the reader's type (`mineI`, first column; 17.1 2a, sign-free range):
 * "באוקטובר מסלולי פנסיה כללי (הסוג שלך) ירדו 1.03% בממוצע. בסוגים האחרים: ירידה בין 0.95% ל-1.76%." · "… בסוגים האחרים: עלייה בין … ל-…"
 * · mixed "… בסוגים האחרים חלק עלו וחלק ירדו." · one other "… מניות: ירידה של 1.76%."
 * Without (6.3): "באוקטובר כל סוגי המסלולים בפנסיה ירדו: גיל 50 עד 60 הכי פחות (⁦−0.95%⁩), מניות הכי הרבה (⁦−1.76%⁩)." · all rose ·
 * mixed "באוקטובר בהשתלמות חלק עלו וחלק ירדו: S&P 500 (⁦+2.42%⁩), מניות (⁦−1.05%⁩)." · all inside 0.05 "…, כמעט באותה מידה."
 * `cols[i].label`: the type's label (typeLabel); `prod`: the product (prodLabel is applied here).
 */
export function hubWords(p: number, prod: string, cols: HubCol[], mineI?: number | null): string {
  const a = cols.filter((c): c is { label: string; v: number } => has(c.v));
  if (!a.length) return '';
  const name = prodLabel(prod), when = inMonth(p), sg = (v: number) => shownSign(v, 2);
  const me = mineI != null ? cols[mineI] : null;
  if (me && has(me.v)) {
    const o = cols.filter((c, i): c is { label: string; v: number } => i !== mineI && has(c.v));
    const dir = sg(me.v) > 0 ? 'עלו' : sg(me.v) < 0 ? 'ירדו' : 'לא זזו';
    let s = `${when} מסלולי ${name} ${me.label} (הסוג שלך) ${dir}${sg(me.v) ? ` ${pctAbs(me.v, 2)}` : ''} בממוצע.`;
    if (o.length) {
      const vs = o.map((c) => c.v), mn = Math.min(...vs.map(Math.abs)), mx = Math.max(...vs.map(Math.abs));
      const allDn = vs.every((v) => sg(v) < 0), allUp = vs.every((v) => sg(v) > 0);
      s += allDn ? (o.length === 1 ? ` ${o[0].label}: ירידה של ${pctAbs(mx, 2)}.` : ` בסוגים האחרים: ירידה בין ${pctAbs(mn, 2)} ל-${pctAbs(mx, 2)}.`)
        : allUp ? (o.length === 1 ? ` ${o[0].label}: עלייה של ${pctAbs(mx, 2)}.` : ` בסוגים האחרים: עלייה בין ${pctAbs(mn, 2)} ל-${pctAbs(mx, 2)}.`)
          : ' בסוגים האחרים חלק עלו וחלק ירדו.';
    }
    return s;
  }
  const hi = a.reduce((x, y) => (y.v > x.v ? y : x)), lo = a.reduce((x, y) => (y.v < x.v ? y : x)), up = a.filter((c) => sg(c.v) > 0).length, dn = a.filter((c) => sg(c.v) < 0).length;
  const head = dn === a.length ? `${when} כל סוגי המסלולים ב${name} ירדו` : up === a.length ? `${when} כל סוגי המסלולים ב${name} עלו` : `${when} ב${name} חלק עלו וחלק ירדו`;
  if (hi.v - lo.v < 0.05 - EPS) return `${head}, כמעט באותה מידה.`;
  if (dn === a.length) return `${head}: ${hi.label} הכי פחות ${pctBracket(hi.v)}, ${lo.label} הכי הרבה ${pctBracket(lo.v)}.`;
  if (up === a.length) return `${head}: ${hi.label} הכי הרבה ${pctBracket(hi.v)}, ${lo.label} הכי פחות ${pctBracket(lo.v)}.`;
  return `${head}: ${hi.label} ${pctBracket(hi.v)}, ${lo.label} ${pctBracket(lo.v)}.`;
}
/** the head: "החודש בחיסכון" over "אוקטובר 2026 · ממוצע של כל סוג מסלול" */
export const HUB_TITLE = 'החודש בחיסכון';
export const hubSub = (asof: number) => `${monthYear(asof)} · ממוצע של כל סוג מסלול`;
/** a column head's second line: "5 מסלולים" (the reader's type: the count alone, beside "שלי") */
export const hubColSub = (n: number, mine: boolean) => (mine ? numIso(n) : `${numIso(n)} מסלולים`);
export const HUB_RISK_GUARD = 'סוגים שונים = רמות סיכון שונות. לכן לא מסמנים מי הגבוה.';
/** "מי היה ראשון באוקטובר בפנסיה כללי?" */
export const hubWhoBest = (p: number, type: string) => `מי היה ראשון ${inMonth(p)} ב${type}?`;
/** the lens names (6.2 #3) */
export const hubLenses = (door: 'saver' | 'agent' | 'pro'): [string, string][] => [['month', 'החודש'], ['lead', door === 'saver' ? 'ראשונים ואחרונים' : 'מובילים ומאספים'], ['chg', 'שינויים'], ['tools', 'עוד']];
/** "ראשונים ואחרונים" */
export const hubLeadIntro = (p: number) => `${inMonth(p)}, בכל סוג: מי היה ראשון ומי אחרון.`;
export const leaderLabel = (role: 'first' | 'mine' | 'last', mine: boolean) => (role === 'mine' ? 'המסלול שלך' : `${role === 'first' ? 'ראשון' : 'אחרון'}${mine ? ' · המסלול שלך' : ''}`);
/** a leaders board's head line: "5 מסלולים · ממוצע ⁦−1.03%⁩" */
export const leadHeadSub = (n: number, avg: N) => `${numIso(n)} מסלולים${has(avg) ? ` · ממוצע ${pctSigned(avg, 2)}` : ''}`;
/** "שינויים" (17.1 2d, 18.6): "באוקטובר בפנסיה כללי (הסוג שלך): בין המסלול הראשון לאחרון היה פער של 0.73%." */
export const hubSpreadWords = (p: number, type: string, gap: number, mine: boolean) => `${inMonth(p)} ב${type}${mine ? ' (הסוג שלך)' : ''}: בין המסלול הראשון לאחרון היה פער של ${pctAbs(gap, 2)}.`;
export const hubSpreadHead = (p: number) => `הפער בין הראשון לאחרון, ${inMonth(p)}`;
export const hubSpreadItemSub = (n: number) => `· ${numIso(n)} מסלולים`;
export const NO_MOVERS = 'אין מסלול שהאחוזון שלו השתנה החודש.';
export const noFeeChanges = (n: number) => `דמי הניהול מצבירה לא השתנו החודש ב-${numIso(n)} המסלולים שנבדקו.`;

/* ======================= the fees tool (7.3, 16.1 2b/2d, 17.1 1f, 18.2 #2/#3/#5, 18.6) ======================= */

/** The three wordings of the reader's base (17.1 1f, 17.2; 18.2 #3): nothing typed "על דוגמה של 100,000 ש״ח" · balance only, in a type
 *  with deposits "על היתרה שלך והפקדה לדוגמה" · both typed "על הסכומים שלך" · a type where no track charges a deposit fee (or a product
 *  with no deposits) "על היתרה שלך". `deposits`: prodHasDeposit(prod) && (career lens || typeHasDepositFee(members)) of lib/pageMonths. */
export function amountsBase(a: { own: boolean; depositOwn: boolean; deposits: boolean }): string {
  if (!a.own) return `על דוגמה של ${ilsNum(BALANCE_EX)} ש״ח`;
  if (!a.deposits) return 'על היתרה שלך';
  return a.depositOwn ? 'על הסכומים שלך' : 'על היתרה שלך והפקדה לדוגמה';
}
export const NO_FEES = 'אין דמי ניהול מפורסמים למסלולים האלה.';
export interface FeesWordsOpts {
  mode: 'yr' | 'career';
  /** the reader typed amounts for this product (`useMyAmounts(...).own`) */
  own: boolean;
  /** amountsBase(...) */
  base: string;
  /** "עד הפרישה": the age, and whether it is the reader's (else ", לדוגמה") */
  age?: number; ageOwn?: boolean; retire?: number;
}
/**
 * `#takeaway` of the fees tool (16.1 2b, 18.6), mine first. `rows`: the like-for-like board (pageMonths `feeBoard(...).rows`), with
 * labels; `mineK`: the reader's track on the board, or null.
 * "המסלול שלך (מגדל): כ-560 ש״ח בשנה, על דוגמה של 100,000 ש״ח. האחרים: 540 עד 610." ·
 * own amounts: "המסלול שלך (מגדל): כ-1,170 ש״ח בשנה, על הסכומים שלך. הזול מהסוג הזה: 1,150." ("הוא הזול מהסוג הזה." when it is) ·
 * no own track: "על דוגמה של 100,000 ש״ח: בין 540 ל-610 ש״ח בשנה." ("כמעט זהה בכל המסלולים, כ-550" under 20 ₪) ·
 * until retirement: "מגיל 50 עד 67: המסלול שלך (מגדל): כ-24,400 ש״ח דמי ניהול עד הפרישה, בשקלי היום, על הסכומים שלך. הזול מהסוג הזה: 24,100."
 * ("מגיל 38 עד 67, לדוגמה: …" on the example's age) · no fee: "אין דמי ניהול מפורסמים למסלולים האלה."
 */
export function feesWords(rows: { k: string; label: string; v: N }[], mineK: string | null | undefined, o: FeesWordsOpts): string {
  const r = rows.filter((x): x is { k: string; label: string; v: number } => has(x.v));
  if (!r.length) return NO_FEES;
  const yr = o.mode === 'yr', me = mineK ? r.find((x) => x.k === mineK) : undefined, oth = r.filter((x) => x !== me);
  const unit = yr ? 'ש״ח בשנה' : 'ש״ח דמי ניהול עד הפרישה, בשקלי היום';
  const pre = yr ? '' : `מגיל ${numIso(o.age ?? 38)} עד ${numIso(o.retire ?? 67)}${o.ageOwn ? '' : ', לדוגמה'}: `;
  if (!me) {
    const lo = Math.min(...oth.map((x) => x.v)), hi = Math.max(...oth.map((x) => x.v));
    return `${pre}${o.base}: ${hi - lo < (yr ? 20 : 1000) ? `כמעט זהה בכל המסלולים, כ-${ilsNum(lo)}` : `בין ${ilsNum(lo)} ל-${ilsNum(hi)}`} ${unit}.`;
  }
  const cheapest = Math.min(...r.map((x) => x.v));
  const tail = !oth.length ? '' : o.own ? (me.v <= cheapest ? ' הוא הזול מהסוג הזה.' : ` הזול מהסוג הזה: ${ilsNum(cheapest)}.`)
    : ` האחרים: ${ilsNum(Math.min(...oth.map((x) => x.v)))} עד ${ilsNum(Math.max(...oth.map((x) => x.v)))}.`;
  return `${pre}המסלול שלך (${me.label}): כ-${ilsNum(me.v)} ${unit}, ${o.base}.${tail}`;
}
export const FEES_TITLE = 'דמי ניהול, בשקלים', FEES_SUB = 'כמה זה עולה, מסלול מול מסלול';
export const feesLenses = (door: 'saver' | 'agent' | 'pro'): [string, string][] => [['rank', 'בשנה'], ['career', 'עד הפרישה'], ...(door === 'saver' ? [] : [['sens', 'רגישות'], ['ret', 'בפרישה']] as [string, string][])];
/** "הסכומים שלי" / "הסכומים שלי ✓" */
export const amountsBtn = (own: boolean) => (own ? 'הסכומים שלי ✓' : 'הסכומים שלי');
/** a board row's quiet line: "0.14% מהחיסכון · 1.56% מכל הפקדה" (no deposit fee: the first part only) */
export const feeSub = (fee: N, depfee: N) => `${has(fee) ? pctAbs(fee, 2) : numIso('–')} מהחיסכון${has(depfee) && depfee > 0 ? ` · ${pctAbs(depfee, 2)} מכל הפקדה` : ''}`;
export const TAG_CHEAPEST = 'הכי זול', TAG_LOW = 'מהזולים';
/** "בשנה" / "עד גיל 67" */
export const feesUnit = (mode: 'yr' | 'career', retire = 67) => (mode === 'yr' ? 'בשנה' : `עד גיל ${numIso(retire)}`);
/** the board's head: "12 מסלולי השתלמות כללי, מהזול ליקר" */
export const feesBoardHead = (n: number, type: string) => `${numIso(n)} מסלולי ${type}, מהזול ליקר`;
/** the closing line (18.2 #5): "ממוצע 5 המסלולים · בשנה" (the figure: pageMonths `typeFeeAvg`) */
export const feesAvgLabel = (n: number, mode: 'yr' | 'career', retire = 67) => `ממוצע ${numIso(n)} המסלולים · ${feesUnit(mode, retire)}`;
/** the pinned own row (18.2 #2): "המסלול שלך" over "6 מתוך 12, מהזול ליקר" */
export const FEES_MINE_HEAD = 'המסלול שלך';
export const feesMinePos = (i: number, n: number) => `${numIso(i + 1)} מתוך ${numIso(n)}, מהזול ליקר`;
/** the self-managed group under the board (18.2 #2) */
export const SELF_HEAD = 'בניהול אישי · לא בהשוואה';
export const selfCount = (n: number) => `${numIso(n)} מסלולים`;
export const SELF_LINE = 'במסלול בניהול אישי החוסך בוחר את ההשקעות בעצמו. זה מוצר אחר, ולכן הוא לא נכלל ב״הכי זול״ ובממוצע.';
/** `#calc-mine` */
export const calcMine = (own: boolean, deposits: boolean) => (own ? 'לשנות את הסכומים שלי' : `לחשב על הסכומים שלי: כמה יש לי${deposits ? ', כמה מפקידים' : ''}`);
/** The stamp under the board (7.2 #7, 17.1 1f), without the "ההנחות ›" button:
 *  "דוגמה: חיסכון 100,000 ש״ח, הפקדה 2,220 ש״ח בחודש · דמי הניהול הממוצעים בכל מסלול (רשות שוק ההון, 10/26), לא מה שחוסך מסוים משלם · אומדן"
 *  own amounts: "הסכומים שלך: חיסכון 420,000 ש״ח, הפקדה 3,100 ש״ח בחודש · …"; career adds ", גיל 50 עד 67, תשואה 4%, בשקלי היום". */
export function feesStamp(o: { own: boolean; base: string; balance: number; monthly: number; deposits: boolean; asof: number; career?: { age: number; retire: number; ret: number } | null }): string {
  const head = o.own ? o.base.replace(/^על /, '') : 'דוגמה';
  const dep = o.deposits && o.monthly > 0 ? `, הפקדה ${ilsNum(o.monthly)} ש״ח בחודש` : '';
  const car = o.career ? `, גיל ${numIso(o.career.age)} עד ${numIso(o.career.retire)}, תשואה ${numIso(`${o.career.ret}%`)}, בשקלי היום` : '';
  return `${head}: חיסכון ${ilsNum(o.balance)} ש״ח${dep}${car} · דמי הניהול הממוצעים בכל מסלול (רשות שוק ההון, ${numIso(monthLabel(o.asof))}), לא מה שחוסך מסוים משלם · אומדן`;
}
export const ASSUME_LINK = 'ההנחות ›';
/* the entry without a saved product (7.2) */
export const FEES_ENTRY_LINE = 'על איזה חיסכון? בוחרים מוצר, ורואים כמה עולה כל מסלול בשנה.';
export const FEES_ENTRY_ADD = 'יש לי מסלול מסוים: להוסיף אותו ל״המוצרים שלי״';
export const FEES_ENTRY_NOTE = 'דמי הניהול הממוצעים בכל מסלול, רשות שוק ההון. לא מה שחוסך מסוים משלם.';
/* "עד הפרישה": the age first (16.1 2d) */
export const AGE_ASK = 'כדי לחשב עד הפרישה צריך גיל. הוא נשמר בדפדפן הזה.';
export const AGE_MINE = 'הגיל שלי:', AGE_OTHER = 'אחר';
export const AGE_CHOICES = [30, 40, 50, 60] as const;
export const ageExample = (age = 38) => `להראות על דוגמה (גיל ${numIso(age)}) ›`;
export const AFTER_RETIRE = 'אחרי גיל הפרישה אין חישוב עד הפרישה';
export const NO_DEP_FEE_TYPE = 'בסוג הזה לא מתפרסמים דמי ניהול מהפקדה';
/** "בפרישה" (agent, Pro): "בפרישה, מגדל מול הזול בקטגוריה (כלל): גיל 38 עד 67, תשואה 4%, מקדם 200." */
export const retTakeaway = (a: string, b: string, c: { age: number; retire: number; ret: number; coef: number }) =>
  `בפרישה, ${a} מול הזול בקטגוריה (${b}): גיל ${numIso(c.age)} עד ${numIso(c.retire)}, תשואה ${numIso(`${c.ret}%`)}, מקדם ${numIso(c.coef)}.`;
/** "רגישות" (agent, Pro) */
export const sensTakeaway = (c: { age: number; retire: number; coef: number }) =>
  `קצבה חודשית בשקלי היום, לפי שילוב של דמי ניהול מהפקדה (שורות) ומצבירה (עמודות). גיל ${numIso(c.age)} עד ${numIso(c.retire)}, מקדם ${numIso(c.coef)}.`;
/** "סך ההפקדות: 1,234,567 ש״ח על פני 348 חודשים." */
export const retDeposits = (dep: number, months: number) => `סך ההפקדות: ${ilsNum(dep)} ש״ח על פני ${numIso(months)} חודשים.`;

/* ======================= the amounts sheet (17.1, 17.2; built by L1-c) ======================= */

/** sub-title: "מגדל · פנסיה כללי · נשמר בדפדפן הזה, לכל מוצר בנפרד" */
export const amountsSub = (label: string) => `${label} · נשמר בדפדפן הזה, לכל מוצר בנפרד`;
export const AMOUNTS_TITLE = 'הסכומים שלי';
export const AMOUNT_BALANCE = 'כמה יש לי היום במוצר הזה', AMOUNT_MONTHLY = 'כמה מפקידים בחודש (אני והמעסיק)', AMOUNT_AGE = 'הגיל שלי';
export const AMOUNTS_NOTE = 'שני המספרים כתובים בדוח השנתי מהחברה. שדה ריק נשאר על הדוגמה.';
export const ZERO_ASK = 'יתרה 0? אם עדיין אין חיסכון במוצר הזה, החישוב יהיה על ההפקדות בלבד.';
export const ZERO_YES = 'כן, 0', ZERO_FIX = 'לתקן', SAVE = 'שמירה', BACK_TO_EXAMPLE = 'חזרה לדוגמה';
export const SAVED_TOAST = 'נשמר בדפדפן הזה';
export const SAVE_BLOCKED_TOAST = 'לא נשמר: הדפדפן חוסם שמירה. המספרים יישארו עד סגירת הלשונית.';

/** minus sign used by every figure here (U+2212), re-exported for tests */
export { MINUS };
