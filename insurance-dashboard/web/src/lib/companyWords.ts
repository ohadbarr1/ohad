/** The sentences of the company overview (phase 6, spec 5.3, 5.5, 13.1 M13, 14.1 N4): pure, node-tested (scripts/p6-words-test.mjs).
 *  Parts as in lib/peerWords (`WPart`, `wordsText`): each figure is one LTR unit with its label ("−46.0% YoY", "ROE LTM 23.9%"),
 *  tappable through its `ref` ({ k: 'co', f }) to the source the page computed it from (ReportDay's resolvers, lib/kpi).
 *  Numbers: millions without a decimal ("462"), ratios one decimal, changes signed with one decimal; the printed value stays in the source. */
import { nf, sn } from './format';
import { toneOf, type WPart } from './peerWords';
import { chgPct, dlab, qBack, qlab } from './quarters';

const T = (s: string): WPart => ({ k: 't', s }), B = (s: string): WPart => ({ k: 'b', s });

export type CoWin = 'q' | '9m' | 'ltm';
export interface CoWordsIn {
  /** the report's quarter ("2026Q3") */
  q: string;
  /** the window of the report sheet; default the quarter */
  win?: CoWin;
  /** net profit to shareholders of the window, ₪ millions */
  np: number | null;
  /** the same window a year earlier */
  npY?: number | null;
  /** the previous quarter (the quarter window only) */
  npQ?: number | null;
  /** ROE LTM, % */
  roe?: number | null;
  /** the first item of changes/<id>.json for the same report: label, difference, comparison ("YoY" / "QoQ"); `u` 'pp' = points */
  top?: { l: string; d: number; cmp: string; u?: string } | null;
}
/** the window's label: "Q3'26", "9M'26", "LTM Q3'26" */
export const winLabel = (q: string, win: CoWin = 'q') => (win === '9m' ? `9M'${q.slice(2, 4)}` : win === 'ltm' ? `LTM ${qlab(q)}` : qlab(q));
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
/** one change of net profit: a percent on two profits; from or to a loss (or a zero base), the absolute change in ₪ millions */
function npChg(np: number, base: number | null | undefined, cmp: 'YoY' | 'QoQ', f: 'npy' | 'npq'): WPart[] {
  if (!fin(base)) return [];
  if (np > 0 && base > 0) { const c = chgPct(np, base).v!; return [T(', '), { k: 'n', s: `${sn(c, 1)}%`, post: ` ${cmp}`, ref: { k: 'co', f }, tone: toneOf(c) }]; }
  const d = np - base;
  return [T(', '), { k: 'n', s: sn(d, 0), ref: { k: 'co', f }, tone: toneOf(d) }, T(` מיליוני ש"ח ${cmp}`)];
}
/**
 * companyWords (5.3, M13 comma joins, N4 units):
 * "**Q3'26**: רווח נקי 462 מיליוני ש"ח, −46.0% YoY, −56.7% QoQ. ROE LTM 23.9%. השינוי המהותי ביותר: רווח תפעולי לפני מסים על ההכנסה, −613 YoY."
 * - a part whose figure is missing is dropped with its connector; a loss: "הפסד של {|np|} מיליוני ש"ח"; a percent change from or to a loss
 *   becomes the absolute change ("+180 מיליוני ש"ח YoY")
 * - no top change: the sentence ends after ROE; windows 9M / LTM lead with their label and carry YoY only
 * - no net profit at all: null (the page shows its own blocks)
 */
export function companyWords(c: CoWordsIn): WPart[] | null {
  if (!fin(c.np)) return null;
  const win = c.win ?? 'q', out: WPart[] = [B(winLabel(c.q, win)), T(': ')];
  if (c.np < 0) out.push(T('הפסד של '), { k: 'n', s: nf(Math.abs(c.np), 0), ref: { k: 'co', f: 'np' } }, T(' מיליוני ש"ח'));
  else out.push(T('רווח נקי '), { k: 'n', s: nf(c.np, 0), ref: { k: 'co', f: 'np' } }, T(' מיליוני ש"ח'));
  out.push(...npChg(c.np, c.npY, 'YoY', 'npy'));
  if (win === 'q') out.push(...npChg(c.np, c.npQ, 'QoQ', 'npq'));
  out.push(T('.'));
  if (fin(c.roe)) out.push(T(' '), { k: 'n', pre: 'ROE LTM ', s: `${nf(c.roe, 1)}%`, ref: { k: 'co', f: 'roe' } }, T('.'));
  if (c.top && fin(c.top.d)) {
    const pts = c.top.u === 'pp' || c.top.u === 'pts';
    out.push(T(` השינוי המהותי ביותר: ${c.top.l}, `), { k: 'n', s: pts ? `${sn(c.top.d, 1)} נק׳` : sn(c.top.d, 0), post: ` ${c.top.cmp}`, ref: { k: 'co', f: 'top' }, tone: toneOf(c.top.d) }, T('.'));
  }
  return out;
}

export interface WaitIn {
  /** the quarter the others have reported */
  bq: string;
  /** the quarter on screen (the company's latest) */
  q: string;
  /** its publication date (changes/<id>.json `pub`), "2026-08-19" */
  pub?: string | null;
  /** how many of the set reported `bq`, of how many */
  reported: number; total: number;
  /** the set's noun: "המבטחות" (default) or "בתי ההשקעות" */
  setWord?: string;
  /** calendar.json: the expected publication date and whether the calendar marks it an estimate */
  expected?: { date: string; est?: boolean } | null;
}
/** waitingWords (5.5): "הדוח ל-**Q3'26** טרם פורסם; מוצג Q2'26, שפורסם 19.08.26. 3 מתוך 7 המבטחות כבר דיווחו." + " צפוי 30.11.26 (אומדן)." */
export function waitingWords(w: WaitIn): WPart[] {
  const out: WPart[] = [T('הדוח ל-'), B(qlab(w.bq)), T(` טרם פורסם; מוצג ${qlab(w.q)}`)];
  if (w.pub) out.push(T(', שפורסם '), { k: 'n', s: dlab(w.pub) });
  out.push(T(`. ${w.reported} מתוך ${w.total} ${w.setWord ?? 'המבטחות'} כבר דיווחו.`));
  if (w.expected?.date) { out.push(T(' צפוי '), { k: 'n', s: dlab(w.expected.date) }); if (w.expected.est) out.push({ k: 'tag', s: 'אומדן' }); out.push(T('.')); }
  return out;
}

/** the filer note, first line of the sentence block (a listed holding company filing a held company's figures): "נתוני {filer}, {stake}%" */
export const filerWords = (filer: string, stake?: number | null) => `נתוני ${filer}${stake != null && Number.isFinite(stake) ? `, ${nf(stake, stake % 1 ? 1 : 0)}%` : ''}`;

/** the stamp under the company table (5.2 item 7): "דוחות הראל, Q3'26 · פורסם 23.11.26 · 193 עמ׳ · כפי שהודפס · YoY מול Q3'25, QoQ מול Q2'26 ·
 *  ROE: רווח LTM ÷ הון ממוצע (נגזר)" (the page adds "איך מחשבים?") */
export function companyStamp(o: { name: string; q: string; pub?: string | null; pages?: number | null }): string {
  return [`דוחות ${o.name}, ${qlab(o.q)}`, o.pub ? `פורסם ${dlab(o.pub)}` : '', o.pages ? `${o.pages} עמ׳` : '', 'כפי שהודפס',
    `YoY מול ${qlab(qBack(o.q, 4))}, QoQ מול ${qlab(qBack(o.q, 1))}`, 'ROE: רווח LTM ÷ הון ממוצע (נגזר)'].filter(Boolean).join(' · ');
}
/** the heads of the company table's change columns: "מול Q3'25" / "מול Q2'26" (13.1 F2) */
export const coChgHead = (q: string, cmp: 'yoy' | 'qoq') => `מול ${qlab(qBack(q, cmp === 'yoy' ? 4 : 1))}`;
