/** The sentences of the peers board (phase 6, spec 3.4, 4, 13.1–13.2, 14.1): pure, node-tested (scripts/p6-words-test.mjs).
 *  Output: PARTS, not strings, so that every figure inside a sentence renders through `Sourced` from the same call that computed it
 *  (14.3 rule 1). A figure part is one left-to-right unit with its label ("−46.0% YoY", "ROE LTM 23.9%": N4); render it in a `dir="ltr"`
 *  isolate (`<bdi dir="ltr">` or `<span dir="ltr" class="n">`). `wordsText` gives the reader's text with LRI … PDI around each unit
 *  (lib/pageWords convention) for titles, aria labels and tests. Gender-neutral constructions only; period words Q3'26 / YoY / QoQ / LTM. */
import { nf } from './format';
import { basisText, fmtRead, shOf, type BMetric, type BoardOut, type BoardRow, type CsmBasis, CSM_BASIS_HE, type ReportStatus } from './peerBoard';
import { dlab, isChg, perLabel, qlab, readLabel, type QRead } from './quarters';

/** what a figure part points at; the page maps it to its `Sourced` call. Board: a row's value, the median; company: see companyWords */
export type FigRef =
  | { k: 'row'; e: string }
  | { k: 'med' }
  | { k: 'grid'; e: string; q: string }
  | { k: 'co'; f: 'np' | 'npy' | 'npq' | 'roe' | 'top' };
export type Tone = 'pos' | 'neg' | null;
export type WPart =
  /** plain text */
  | { k: 't'; s: string }
  /** bold: a company's name, the report's quarter */
  | { k: 'b'; s: string }
  /** the basis of a change, "(Q3'26 מול Q2'26)": styled as the basis line */
  | { k: 'basis'; s: string }
  /** a short tag ("אומדן") */
  | { k: 'tag'; s: string }
  /** one LTR unit: `pre` + the figure `s` + `post`; `ref` = tappable to its source; `sup` = a median's n */
  | NPart;
/** a figure part: one LTR unit */
export interface NPart { k: 'n'; s: string; ref?: FigRef; tone?: Tone; pre?: string; post?: string; sup?: number }

const LRI = '⁦', PDI = '⁩';
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const supOf = (n: number) => String(n).split('').map((d) => SUP[Number(d)]).join('');
/** the reader's text: units in LRI … PDI; `sup`: the median's n as superscript digits */
export function wordsText(parts: WPart[], o: { sup?: boolean; iso?: boolean } = {}): string {
  const iso = o.iso ?? true;
  return parts.map((p) => (p.k === 'n' ? `${iso ? LRI : ''}${p.pre ?? ''}${p.s}${o.sup && p.sup != null ? supOf(p.sup) : ''}${p.post ?? ''}${iso ? PDI : ''}` : p.k === 'tag' ? ` (${p.s})` : p.s)).join('');
}
/** pos / neg by sign; a figure that rounds to zero is neutral */
export const toneOf = (v: number | null | undefined, eps = 1e-9): Tone => (v == null || !Number.isFinite(v) || Math.abs(v) < eps ? null : v > 0 ? 'pos' : 'neg');
const T = (s: string): WPart => ({ k: 't', s }), B = (s: string): WPart => ({ k: 'b', s });
const num = (s: string | number): WPart => ({ k: 'n', s: String(s) });

/* ---------- direction words ---------- */
/** the two ends of a board: "הזולה / היקרה" for a multiple (lower is better), "הנמוכה / הגבוהה" for any other lower-is-better metric,
 *  "הגבוהה / הנמוכה" otherwise ("מהזול" never appears on a non-multiple: tester B13) */
export function endWords(m: BMetric): [string, string] {
  if (m.better === 'lo') return m.type === 'spot' ? ['הזולה', 'היקרה'] : ['הנמוכה', 'הגבוהה'];
  return ['הגבוהה', 'הנמוכה'];
}
/** what place 1 is: "הזולה" / "הנמוכה" / "הגבוהה" */
export const firstWord = (m: BMetric) => endWords(m)[0];
/** a place that stands alone carries its direction (M16): "מקום 6 מ-6, 1 = הזולה" */
export const placeText = (place: number, n: number, m: BMetric) => `מקום ${place} מ-${n}, 1 = ${firstWord(m)}`;

/* ---------- the board's sentence (3.4) ---------- */
/** `{what}`: the short name, plus the reading when it is not the metric's obvious one ("רווח נקי Q3'26", "CSM QoQ"), plus the basis of a change */
export function whatParts(m: BMetric, rd: QRead, q: string): WPart[] {
  if (isChg(rd)) return [T(`${shOf(m)} ${readLabel(rd, q)} `), { k: 'basis', s: `(${basisText(m, rd, q)})` }];
  const named = m.type === 'flow' || m.fr || m.type === 'ret';
  return [T(`${shOf(m)}${named ? ` ${readLabel(rd, q)}` : ''}`)];
}
const has = (r: BoardRow) => r.v != null && Number.isFinite(r.v);
/** a board figure in a sentence: tappable to its row's source, toned when it is a change or a return */
function rowFig(b: BoardOut, r: BoardRow): NPart {
  return { k: 'n', s: fmtRead(b.m, b.rd, r.v!), ref: { k: 'row', e: r.e }, tone: isChg(b.rd) || b.m.u === 'pctx' ? toneOf(r.v) : null };
}
/** the median as a figure with its n */
export const medFig = (b: BoardOut): NPart => ({ k: 'n', s: fmtRead(b.m, b.rd, b.med.v!), ref: { k: 'med' }, tone: isChg(b.rd) || b.m.u === 'pctx' ? toneOf(b.med.v) : null, sup: b.med.n });
/**
 * peersWords (3.4): "P/(B+CSM): הזולה **מגדל**, 0.85x; היקרה **הפניקס**, 2.15x. חציון 1.50x."
 * - fewer than two ranked companies with a figure: "אין מספיק חברות עם {sh} להשוואה."
 * - the focus in the middle: "… **{focus}**: {v}, מקום {place} מתוך {n}."; the focus at either end: the first two sentences only
 * - the focus has not reported (a quarter-named reading): "… **{focus}** טרם דיווחה {Q}."; no figure: "… ל**{focus}** אין נתון."
 * - a quarter-named reading with companies set aside: "… בדירוג: {n} שדיווחו {Q}."
 */
export function peersWords(b: BoardOut, focus: string | null | undefined, name: (e: string) => string): WPart[] {
  const { m, rd, q } = b, ok = b.rows.filter((r) => !r.out && has(r));
  if (ok.length < 2 || b.med.v == null) return [T(`אין מספיק חברות עם ${shOf(m)} להשוואה.`)];
  const [w1, w2] = endWords(m), top = ok[0], bot = ok[ok.length - 1], f = focus ? b.rows.find((r) => r.e === focus) : undefined;
  const out: WPart[] = [...whatParts(m, rd, q), T(`: ${w1} `), B(name(top.e)), T(', '), rowFig(b, top), T(`; ${w2} `), B(name(bot.e)), T(', '), rowFig(b, bot), T('. חציון '), medFig(b), T('.')];
  if (f && !f.out && has(f) && f !== top && f !== bot && f.place != null) out.push(T(' '), B(name(f.e)), T(': '), rowFig(b, f), T(', מקום '), num(f.place), T(' מתוך '), num(b.n), T('.'));
  else if (f && f.out) out.push(T(' '), B(name(f.e)), T(` טרם דיווחה ${qlab(q)}.`));
  else if (f && !has(f)) out.push(T(' ל'), B(name(f.e)), T(' אין נתון.'));
  if (b.strict && b.rows.some((r) => r.out)) out.push(T(' בדירוג: '), num(b.n), T(` שדיווחו ${qlab(q)}.`));
  return out;
}

/* ---------- the focus lede (lens חברה, the company sheet) ---------- */
/** the band inside which ROE is "at the median" (2.3: 0.2 points) */
export const ROE_TIE = 0.2;
/**
 * focusWords (3.4): the shipped lede, its words unchanged, plus the tie branch (tester B9):
 * "**הפניקס** נסחרת ב-P/B של 3.10x מול חציון 2.49x (פרמיה של 25%), עם ROE של 24.0% מול חציון 23.9%. התשואה להון בגובה החציון."
 * Without a listed share or a figure: "ל**{name}** אין מניה נסחרת או שחסר נתון; מוצגים נתוני העסק והפעילות בלבד."
 * `pb`: the board of P/B ('now'); `roe`: the board of ROE ('ltm').
 */
export function focusWords(e: string, pb: BoardOut, roe: BoardOut, name: (e: string) => string): WPart[] {
  const p = pb.rows.find((r) => r.e === e), r = roe.rows.find((x) => x.e === e);
  if (!p || !r || !has(p) || !has(r) || pb.med.v == null || roe.med.v == null)
    return [T('ל'), B(name(e)), T(' אין מניה נסחרת או שחסר נתון; מוצגים נתוני העסק והפעילות בלבד.')];
  const pbx = p.v!, pbm = pb.med.v, rx = r.v!, rm = roe.med.v, prem = (pbx / pbm - 1) * 100;
  const side = Math.abs(rx - rm) < ROE_TIE ? 'התשואה להון בגובה החציון.'
    : rx > rm === pbx > pbm ? 'המכפיל והתשואה להון באותו צד של החציון.' : rx > rm ? 'תשואה להון מעל החציון במכפיל מתחתיו.' : 'מכפיל מעל החציון בתשואה להון מתחתיו.';
  return [B(name(e)), T(' נסחרת ב-P/B של '), { ...rowFig(pb, p), tone: null }, T(' מול חציון '), { ...medFig(pb), tone: null }, T(` (${prem >= 0 ? 'פרמיה' : 'דיסקאונט'} של `), num(`${nf(Math.abs(prem), 0)}%`),
    T('), עם ROE של '), { ...rowFig(roe, r), tone: null }, T(' מול חציון '), { ...medFig(roe), tone: null }, T(`. ${side}`)];
}

/* ---------- the partial-quarter line, tags, the median line (13.2) ---------- */
/**
 * The line `#guard` (13.2 rule 4). base 'latest': "**3 מתוך 7** דיווחו Q3'26. כלל, מנורה, הכשרה, איילון: לפי Q2'26, מסומנות ונספרות.
 * רבעון בודד, YoY ו-QoQ של הרבעון: רק מי שדיווח." · action "הכול על Q2'26 ›". More than four waiting: "5 חברות: לפי …" (names in the
 * context sheet). base 'common': "מוצג על בסיס **Q2'26**, הרבעון האחרון שכל 7 החברות דיווחו." · action "חזרה ל-Q3'26 ›".
 * null when every company has reported.
 */
export function guardWords(st: ReportStatus, base: 'latest' | 'common', name: (e: string) => string): { parts: WPart[]; action: string } | null {
  if (!st.waiting.length) return null;
  if (base === 'common') return { parts: [T('מוצג על בסיס '), B(qlab(st.cq)), T(`, הרבעון האחרון שכל ${st.n} החברות דיווחו.`)], action: `חזרה ל-${qlab(st.bq)} ›` };
  const w = st.waiting, one = w.length === 1, lasts = [...new Set(w.map((e) => st.last[e]))];
  const who = w.length > 4 ? `${w.length} חברות` : w.map(name).join(', ');
  const per = lasts.length === 1 ? `לפי ${qlab(lasts[0])}` : 'לפי הדוח האחרון של כל אחת';
  return { parts: [B(`${st.reported.length} מתוך ${st.n}`), T(` דיווחו ${qlab(st.bq)}. ${who}: ${per}, ${one ? 'מסומנת ונספרת' : 'מסומנות ונספרות'}. רבעון בודד, YoY ו-QoQ של הרבעון: רק מי שדיווח.`)],
    action: `הכול על ${qlab(st.cq)} ›` };
}
/** the sub-head above the set-aside rows of a quarter-named reading */
export const outHead = (q: string) => `לא בדירוג ולא בחציון: הדוח ל-${qlab(q)} טרם פורסם`;
/** a board row's tag (on its own line under the name); `warn` = drawn as a warning */
export function rowTag(r: BoardRow, m: BMetric): { s: string; warn: boolean } | null {
  if (r.out) return { s: `${qlab(r.q)} · טרם דיווחה`, warn: true };
  if (!has(r)) return { s: (m.type === 'spot' || m.type === 'ret') && r.noShare ? 'אין מניה נסחרת' : 'אין נתון', warn: false };
  if (r.stale && r.q) return { s: qlab(r.q), warn: true };
  if (r.per) return { s: perLabel(r.per), warn: false };
  if (r.chip) return { s: 'כמעט שווים', warn: false };
  return null;
}
/** the median legend in the board's head (14.1 G1): "חציון 1.50x · 6 חברות"; a quarter-named reading: "חציון +3.5% · 3 שדיווחו Q3'26";
 *  null when fewer than two companies have a figure (a median on fewer than two is not drawn) */
export function medWords(b: BoardOut): WPart[] | null {
  if (b.med.v == null || b.med.n < 2) return null;
  return [T('חציון '), { ...medFig(b), sup: undefined }, T(` · ${b.med.n} ${b.strict ? `שדיווחו ${qlab(b.q)}` : 'חברות'}`)];
}
/** the stamp's carry note when the set is partial (the free table and series too, T-V5): "* טרם דווח על Q3'26: הנתון המדווח האחרון" */
export const starNote = (q: string) => `* טרם דווח על ${qlab(q)}: הנתון המדווח האחרון, מסומן ונספר בחציון`;

/* ---------- under a multiple's quarters grid: the close rule (14.1) ---------- */
/**
 * "ברשת: שווי השוק בסגירת סוף כל רבעון (Q3'26: 30.09.26) ÷ הנתון המדווח. בלוח: הסגירה האחרונה, 25.11.26. לכן הפניקס: 3.49x ברשת
 * ל-Q3'26, 3.10x בלוח." `qClose`: the quarter-end close date (peerBoard.closeAt); `lastClose`: the board's close (the price files' asof);
 * `grid` / `board`: the focus company's two figures, already formatted.
 */
export function closeRuleWords(o: { q: string; qClose: string; lastClose: string; e: string; name: string; grid: string | null; board: string | null }): WPart[] {
  const out: WPart[] = [T(`ברשת: שווי השוק בסגירת סוף כל רבעון (${qlab(o.q)}: `), num(dlab(o.qClose)), T(') ÷ הנתון המדווח. בלוח: הסגירה האחרונה, '), num(dlab(o.lastClose)), T('.')];
  if (o.grid && o.board) out.push(T(` לכן ${o.name}: `), { k: 'n', s: o.grid, ref: { k: 'grid', e: o.e, q: o.q } }, T(` ברשת ל-${qlab(o.q)}, `), { k: 'n', s: o.board, ref: { k: 'row', e: o.e } }, T(' בלוח.'));
  return out;
}

/* ---------- the CSM basis (14.3 rule 4) ---------- */
/** the line under a grid with a "†" cell: "† ה-CSM של הרבעון הודפס על בסיס אחר (ברוטו) מהבסיס הנוכחי של החברה (נטו); שינוי מול רבעון כזה אינו מחושב." */
export const daggerNote = (cell: CsmBasis, latest: CsmBasis) =>
  `† ה-CSM של הרבעון הודפס על בסיס אחר (${CSM_BASIS_HE[cell]}) מהבסיס הנוכחי של החברה (${CSM_BASIS_HE[latest]}); שינוי מול רבעון כזה אינו מחושב.`;
