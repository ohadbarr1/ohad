import type { Per } from './funds';
import { nf, sn } from './format';

/* F2 · the plain-Hebrew sentences of the track comparison (spec 6.1, as amended by 4.0 rows 11–13 and 4.0b row 7).
   Pure functions: the inputs are labels and numbers the page already holds; the output is a string whose figures are wrapped in
   LRI … PDI (U+2066 … U+2069) with U+2212 for minus, the NumText convention (render with <NumText t={…} />).
   Grammar: a company name is feminine as a company (מגדל, הראל, מנורה) but a column is a track (masculine), so no adjective or verb
   ever agrees with a label. Agreement sits on a fixed noun ("המסלול של X ראשון", "המסלולים של X ושל Y") or the label follows a
   colon ("הכי הרבה בשנה האחרונה: מנורה"). Plurals ("כולם", "שניהם") refer to the tracks. The fee sentences live in lib/feeExample.ts
   (lane L1-a). Plain words only (spec 7.1): no LTM/YTD/1M, no "נק׳ אחוז", no "צמודים". */

const LRI = '⁦', PDI = '⁩', EPS = 1e-9;
/** One-month band (approved O4; equals tieBand('m1') in lib/fundsTie.ts once F3 lands). */
export const MONTH_BAND = 0.05;
/** Annual figures, LTM and calendar years: the existing 0.10-point band (lib/fundsTie.ts TIE_BP). */
export const YEAR_BAND = 0.1;

export const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
export const heMonth = (p: number) => HE_MONTHS[(p % 100) - 1];

/** A figure in running text: "⁦+10.3%⁩", "⁦−0.73%⁩" (signed, U+2212, one LTR isolate). `signed: false` for a gap or a share. */
export function fig(v: number, d = 1, o: { signed?: boolean; unit?: string } = {}): string {
  const body = o.signed === false ? nf(v, d) : sn(v, d);
  return `${LRI}${body}${o.unit ?? '%'}${PDI}`;
}

/** "מגדל", "מגדל והראל", "מגדל, הראל ומנורה". A label that does not start with a Hebrew letter takes "ו-". */
export function joinNames(labels: string[], of = false): string {  // of: "של מנורה ושל כלל"
  const w = labels.map((l) => (of ? `של ${l}` : l));
  if (w.length < 2) return w.join('');
  const last = w[w.length - 1], and = /^[א-ת]/.test(last) ? 'ו' : 'ו-';
  return `${w.slice(0, -1).join(', ')} ${and}${last}`;
}

export interface Col { label: string; v: number | null | undefined }
/** v: the value as given (ties are decided on it, as in lib/fundsTie.ts); s: its sign as published, at d decimals (−0.001 reads 0.00) */
interface Val { i: number; label: string; v: number; s: number }
const have = (cols: Col[], d: number): Val[] =>
  cols.flatMap((c, i) => (c.v == null || !Number.isFinite(c.v) ? [] : [{ i, label: c.label, v: c.v, s: Math.sign(Number(c.v.toFixed(d))) }]));
/** members inside the band of the extreme, in column order */
const near = (xs: Val[], ref: number, band: number) => xs.filter((x) => Math.abs(x.v - ref) < band - EPS);
const names = (xs: Val[]) => joinNames(xs.map((x) => x.label));

/* ---------------- the month (or year) row ---------------- */

/** "באוקטובר" for a yyyymm; "ב-2025" for a full calendar year; "מתחילת 2026" for the current, partial one (asof's year, before December). */
export function whenWords(p: number, asof?: number): string {
  if (p > 9999) return `ב${heMonth(p)}`;
  if (asof != null && Math.floor(asof / 100) === p && asof % 100 < 12) return `מתחילת ${p}`;
  return `ב-${p}`;
}

/**
 * The newest row of the grid, in words (spec 6.1 rows 1–4). `p`: yyyymm for a month row, yyyy for a year row.
 * "באוקטובר כולם ירדו: הראל ומנורה הכי פחות, מגדל הכי הרבה." · "בספטמבר כולם עלו: הראל הכי הרבה, מגדל ומנורה הכי פחות." ·
 * "ביולי חלק עלו וחלק ירדו. הכי גבוה: מגדל, הכי נמוך: הראל." · "באוקטובר כולם ירדו, כמעט באותה מידה."
 * Two tracks read "שניהם" / "פחות, יותר" / "עלה המסלול של X וירד המסלול של Y". Signs are read on the two published decimals; ties on the
 * values as given, with the band (lib/fundsTie.ts isTie).
 * Returns '' when fewer than two tracks have a value.
 */
export function rowWords(p: number, cols: Col[], o: { band?: number; asof?: number } = {}): string {
  const xs = have(cols, 2);
  if (xs.length < 2) return '';
  const band = o.band ?? (p > 9999 ? MONTH_BAND : YEAR_BAND), when = whenWords(p, o.asof), two = xs.length === 2;
  const up = xs.filter((x) => x.s > 0).length, down = xs.filter((x) => x.s < 0).length, n = xs.length;
  const hi = Math.max(...xs.map((x) => x.v)), lo = Math.min(...xs.map((x) => x.v));
  const tops = near(xs, hi, band), lows = near(xs, lo, band).filter((x) => !tops.includes(x));  // a middle value inside both bands goes with the top
  const allTie = tops.length === n;
  if (up === n || down === n) {
    const all = two ? (up === n ? 'שניהם עלו' : 'שניהם ירדו') : up === n ? 'כולם עלו' : 'כולם ירדו';
    if (allTie) return `${when} ${all}, כמעט באותה מידה.`;
    const [more, less] = two ? ['יותר', 'פחות'] : ['הכי הרבה', 'הכי פחות'];
    // the highest of a falling row fell least; of a rising row rose most
    return up === n
      ? `${when} ${all}: ${names(tops)} ${more}, ${names(lows)} ${less}.`
      : `${when} ${all}: ${names(tops)} ${less}, ${names(lows)} ${more}.`;
  }
  if (allTie) return `${when} ${two ? 'שניהם' : 'כולם'} כמעט ללא שינוי.`;  // within the band and on both sides of zero: all close to 0
  if (two) {
    const a = xs[0].v >= xs[1].v ? xs[0] : xs[1], z = a === xs[0] ? xs[1] : xs[0];
    if (z.s < 0 && a.s > 0) return `${when} עלה המסלול של ${a.label} וירד המסלול של ${z.label}.`;
    return a.s > 0
      ? `${when} עלה המסלול של ${a.label}, והמסלול של ${z.label} לא השתנה.`
      : `${when} ירד המסלול של ${z.label}, והמסלול של ${a.label} לא השתנה.`;
  }
  const mix = up && down ? 'חלק עלו וחלק ירדו' : up ? 'חלק עלו וחלק לא השתנו' : 'חלק ירדו וחלק לא השתנו';
  return `${when} ${mix}. הכי גבוה: ${names(tops)}, הכי נמוך: ${names(lows)}.`;
}

/**
 * The last-year clause after the month sentence (4.0 row 12): "הכי הרבה בשנה האחרונה: הראל, ⁦+10.3%⁩." ·
 * tie of all: "בשנה האחרונה הם כמעט שווים." · all negative: "בשנה האחרונה כולם ירדו. הכי פחות: X, ⁦−1.2%⁩." Band 0.10.
 */
export function lastYearWords(cols: Col[], band = YEAR_BAND): string {
  const xs = have(cols, 1);
  if (xs.length < 2) return '';
  const hi = Math.max(...xs.map((x) => x.v)), tops = near(xs, hi, band);
  if (tops.length === xs.length) return `בשנה האחרונה ${xs.length === 2 ? 'שניהם' : 'הם'} כמעט שווים.`;
  if (Number(hi.toFixed(1)) < 0) return `בשנה האחרונה ${xs.length === 2 ? 'שניהם' : 'כולם'} ירדו. הכי פחות: ${names(tops)}, ${fig(hi)}.`;
  return `הכי הרבה בשנה האחרונה: ${names(tops)}, ${fig(hi)}.`;
}

/** One-line banner above the grid when the tracks carry different risk levels (4.0b row 7); `RISK_MORE` is the link to the risk sheet. */
export const RISK_BANNER = 'יותר מניות: עולה ויורד חזק יותר.';
export const RISK_MORE = 'עוד ›';

export interface MonthInsightIn {
  /** yyyymm of the newest row, or yyyy in the years view */
  p: number;
  /** the newest row, one entry per column */
  row: Col[];
  /** last-year return (the published gross y12) per column; appended only under a month row */
  lastYear?: Col[];
  /** the tracks are at different risk levels: the banner replaces the sentence */
  cross?: boolean;
  asof?: number;
  band?: number;
}
/** `#month-insight`: the row sentence plus, under a month row, the last-year clause. P3 at 10/26:
 *  "באוקטובר כולם ירדו: הראל ומנורה הכי פחות, מגדל הכי הרבה. הכי הרבה בשנה האחרונה: הראל, ⁦+10.3%⁩." */
export function monthInsight(i: MonthInsightIn): string {
  if (i.cross) return RISK_BANNER;
  const base = rowWords(i.p, i.row, { band: i.band, asof: i.asof });
  if (!base || i.p <= 9999 || !i.lastYear) return base;
  const ly = lastYearWords(i.lastYear);
  return ly ? `${base} ${ly}` : base;
}

/* ---------------- "לאורך זמן": one period ---------------- */

/** The period as the head of a sentence. m1 needs asof (the data month). */
export function periodWords(per: Per, asof: number): string {
  switch (per) {
    case 'm1': return `ב${heMonth(asof)}`;
    case 'ytd': return `מתחילת ${Math.floor(asof / 100)}`;
    case 'y12': return 'בשנה האחרונה';
    case 'a3': return 'ב-3 השנים האחרונות';
    case 'a5': return 'ב-5 השנים האחרונות';
  }
}
const annual = (per: Per) => (per === 'a3' || per === 'a5' ? ' בשנה' : '');

/**
 * The takeaway of the long view (spec 6.1 rows 7–8, 4.0 row 13), tracks of one risk level. Band: pass tieBand(per, asof)
 * (0.10 on y12/a3/a5; pro rata on ytd; 0.05 on m1).
 * one first: "ב-5 השנים האחרונות המסלול של מנורה ראשון: ⁦+8.9%⁩ בשנה, מול ⁦+8.6%⁩ של מגדל."
 * tie at the top: "ב-3 השנים האחרונות המסלולים של מנורה ושל כלל כמעט שווים בראש (⁦+13.8%⁩, ⁦+13.9%⁩ בשנה)."
 * all tied: "בשנה האחרונה המסלולים כמעט שווים: ההבדל ביניהם קטן מדי כדי לקבוע מי ראשון."
 * all down: "מתחילת 2026 כל המסלולים ירדו. המסלול של X ירד הכי פחות: ⁦−1.2%⁩, מול ⁦−1.5%⁩ של Y."
 */
export function longWords(per: Per, cols: Col[], o: { asof: number; band?: number }): string {
  const d = per === 'm1' ? 2 : 1, xs = have(cols, d);
  if (xs.length === 1) return ONE_TRACK;
  if (!xs.length) return '';
  const band = o.band ?? (per === 'm1' ? MONTH_BAND : YEAR_BAND), when = periodWords(per, o.asof), yr = annual(per);
  const rs = [...xs].sort((a, b) => b.v - a.v || a.i - b.i), hi = rs[0].v, two = xs.length === 2;
  const tops = near(xs, hi, band);
  if (tops.length === xs.length)
    return `${when} ${two ? 'שני המסלולים' : 'המסלולים'} כמעט שווים: ההבדל ביניהם קטן מדי כדי לקבוע מי ראשון.`;
  const next = rs.find((x) => !tops.includes(x))!;
  const vals = tops.length === 2 ? `${fig(tops[0].v, d)}, ${fig(tops[1].v, d)}${yr}`
    : `${fig(Math.min(...tops.map((x) => x.v)), d)} עד ${fig(hi, d)}${yr}`;
  if (Number(hi.toFixed(d)) < 0) {
    const all = `${when} ${two ? 'שני המסלולים' : 'כל המסלולים'} ירדו.`;
    return tops.length === 1
      ? `${all} המסלול של ${tops[0].label} ירד ${two ? 'פחות' : 'הכי פחות'}: ${fig(hi, d)}${yr}, מול ${fig(next.v, d)} של ${next.label}.`
      : `${all} המסלולים ${joinNames(tops.map((x) => x.label), true)} ירדו הכי פחות (${vals}).`;
  }
  if (tops.length > 1) return `${when} המסלולים ${joinNames(tops.map((x) => x.label), true)} כמעט שווים בראש (${vals}).`;
  return `${when} המסלול של ${tops[0].label} ראשון: ${fig(hi, d)}${yr}, מול ${fig(next.v, d)} של ${next.label}.`;
}

/** Only one track chosen. Plural address, the site's voice ("הוסיפו", spec 7.4). */
export const ONE_TRACK = 'מסלול אחד נבחר. הוסיפו עוד אחד כדי להשוות.';

/* ---------------- different risk levels (spec 6.1 row 9, 4.8, 4.0b row 7) ---------------- */

export interface RiskCol { label: string; worst: number | null | undefined; worstP?: number | null; equity?: number | null }
const worstFirst = (cols: RiskCol[]) =>
  cols.filter((c): c is RiskCol & { worst: number } => c.worst != null && Number.isFinite(c.worst)).sort((a, b) => a.worst - b.worst);

/** "החודש הכי גרוע ב-5 שנים: מגדל מניות ⁦−5.32%⁩, מגדל כללי ⁦−3.14%⁩." (worst first). '' without data. */
export function worstMonthWords(cols: RiskCol[], withMonth = false): string {
  const w = worstFirst(cols);
  if (!w.length) return '';
  const one = (c: (typeof w)[number]) => `${c.label} ${fig(c.worst, 2)}${withMonth && c.worstP ? ` (${monthShortYear(c.worstP)})` : ''}`;
  return `החודש הכי גרוע ב-5 שנים: ${w.map(one).join(', ')}.`;
}
/** The full sentence of 6.1 row 9: "מסלול עם יותר מניות עולה ויורד חזק יותר. החודש הכי גרוע ב-5 שנים: … לכן כאן לא מסמנים מי הגבוה." */
export function riskWords(cols: RiskCol[]): string {
  const w = worstMonthWords(cols);
  return `מסלול עם יותר מניות עולה ויורד חזק יותר.${w ? ` ${w}` : ''} לכן כאן לא מסמנים מי הגבוה.`;
}
/** The long view's takeaway at different risk levels:
 *  "מסלול עם יותר מניות עולה ויורד חזק יותר (כאן: ⁦51%⁩ מול ⁦73%⁩ מניות). המספרים מוצגים זה לצד זה, בלי ״מקום ראשון״." */
export function riskLongWords(equity: (number | null | undefined)[]): string {
  const st = equity.filter((v): v is number => v != null && Number.isFinite(v));
  const here = st.length >= 2 ? ` (כאן: ${fig(Math.min(...st), 0, { signed: false })} מול ${fig(Math.max(...st), 0, { signed: false })} מניות)` : '';
  return `מסלול עם יותר מניות עולה ויורד חזק יותר${here}. המספרים מוצגים זה לצד זה, בלי ״מקום ראשון״.`;
}
/** Title and sub-title of the "עוד ›" sheet. */
export const RISK_NOTE_TITLE = 'למה אין כאן ״מי הגבוה״?';
export const RISK_NOTE_SUB = 'המסלולים שבחרת ברמות סיכון שונות';
/** The three bullets of the "עוד ›" sheet (mockup v3), worst month with its month. */
export function riskNoteFacts(cols: RiskCol[]): string[] {
  const w = worstMonthWords(cols, true);
  return [
    'מסלול עם יותר מניות עולה חזק יותר בחודשים טובים ויורד חזק יותר בחודשים רעים.',
    ...(w ? [w] : []),
    'לכן המספרים מוצגים זה לצד זה, בלי לסמן מי הגבוה. ההבדל ביניהם נובע בעיקר מכמות המניות, לא מאיכות הניהול.',
  ];
}

/** Other guard lines (spec 6.3, 10A.2 C5). The "עוד ›" link is a separate element. */
export const PRODUCTS_LINE = 'מוצרים שונים: כללי המס והמשיכה שונים.';
export const OLD_POLICY_LINE = 'פוליסה ישנה (1990–2003): יש בה הבטחות שלא רואים בתשואה. לא משווים אותה כאן למסלולים חדשים.';

/** Row and column labels of the risk lenses (4.0 row 11). */
export const WORST_MONTH = 'החודש הכי גרוע';
export const BEST_MONTH = 'החודש הכי טוב';
export const MAX_DROP = 'הירידה הכי גדולה לפני שחזר לעלות';
export const NEAR_EQUAL = 'כמעט שווים';

/* ---------------- the month sheet (4.4, 4.0 row 13) ---------------- */

const SHORT_M = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
/** "ספט׳ 22" */
export const monthShortYear = (p: number) => `${SHORT_M[(p % 100) - 1]} ${String(Math.floor(p / 100) % 100).padStart(2, '0')}`;
/** Sheet title: "אוקטובר 2026" for a month, "2026 (עד אוקטובר)" for the partial year, "שנת 2025" for a full one. */
export function sheetTitle(p: number, asof?: number): string {
  if (p > 9999) return `${heMonth(p)} ${Math.floor(p / 100)}`;
  if (asof != null && Math.floor(asof / 100) === p && asof % 100 < 12) return `${p} (עד ${heMonth(asof)})`;
  return `שנת ${p}`;
}

/** "הפער בין הגבוה לנמוך: ⁦0.72%⁩." (the gap is written in "%", not in points: 4.0 row 13) */
export function gapWords(vals: (number | null | undefined)[], d = 2): string {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x)).map((x) => Number(x.toFixed(d)));
  if (v.length < 2) return '';
  return `הפער בין הגבוה לנמוך: ${fig(Math.max(...v) - Math.min(...v), d, { signed: false })}.`;
}
/** "הממוצע של כל 5 המסלולים מהסוג הזה: ⁦−1.05%⁩. 2 מתוך 3 שבחרת מעליו." `n`: tracks in the category that month (cat.json). */
export function avgWords(avg: number | null | undefined, n: number | null | undefined, vals: (number | null | undefined)[], d = 2): string {
  if (avg == null || !Number.isFinite(avg)) return '';
  const a = avg, v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  const who = n && n > 1 ? `של כל ${n} המסלולים מהסוג הזה` : 'של המסלולים מהסוג הזה';
  const k = v.filter((x) => x > a).length;
  const above = !v.length ? '' : k === 0 ? ' אף מסלול שבחרת לא מעליו.' : k === v.length ? (v.length === 2 ? ' שני המסלולים שבחרת מעליו.' : ` כל ${v.length} שבחרת מעליו.`) : ` ${k} מתוך ${v.length} שבחרת מעליו.`;
  return `הממוצע ${who}: ${fig(a, d)}.${above}`;
}
export const ONE_MONTH_NOTE = 'חודש אחד לא אומר הרבה. כדי להחליט מסתכלים על 3 עד 5 שנים.';
