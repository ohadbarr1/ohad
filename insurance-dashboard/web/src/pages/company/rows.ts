/** The company overview's numbers (phase 6, spec 5.2–5.5, 13.1 F6, 14.3): the seven rows of "עיקרי הדוח" (value, YoY, QoQ, LTM, place,
 *  eight quarters), the quarters grid, the sentence's inputs and the peers strip. Pure: every figure is read through lib/peerBoard
 *  (`readVal`, `bizVal`, `boardRows`) on the peer files, so a number opens the same source as on the board, and a change is the board's
 *  change with its basis. Node-tested in scripts/company-p6-test.mjs on the committed data. No stock data here (14.3 rule 6). */
import { nf, sn } from '../../lib/format';
import type { Prov } from '../../lib/prov';
import { BBY, boardRows, bizVal, defRead, fmtRead, needIds, readVal, type BMetric, type BoardCtx, type BoardOut, type BVal, type Kind, type ReportStatus } from '../../lib/peerBoard';
import { chgPct, chgPts, perLabel, qBack, qlab, type QRead } from '../../lib/quarters';
import type { Book } from '../../lib/registry';

export type CoKey = 'np' | 'comp' | 'isr' | 'csm' | 'eq' | 'roe' | 'sr' | 'rev' | 'nm' | 'aum';
/** the columns of the company table: the quarter's value, its YoY and QoQ, the LTM figure */
export type What = 'v' | 'yoy' | 'qoq' | 'ltm';

const F5: QRead[] = ['ltm', 'ltmy', 'q', 'yoy', 'qoq'];
/** lines the board does not carry: comprehensive income and the insurance service result (insurers), revenue (fund houses) */
const LOCAL: Record<string, BMetric> = {
  comp: { key: 'comp', l: 'רווח כולל לבעלי המניות', sh: 'רווח כולל', u: 'm', dec: 0, better: null, sec: 'biz', tok: { ins: 'ifrs:comprehensive_income_attributable' }, type: 'flow', reads: F5 },
  isr: { key: 'isr', l: 'רווח משירותי ביטוח', sh: 'רווח משירותי ביטוח', u: 'm', dec: 0, better: null, sec: 'biz', tok: { ins: 'ifrs:insurance_service_result' }, type: 'flow', reads: F5 },
  rev: { key: 'rev', l: 'הכנסות', sh: 'הכנסות', u: 'm', dec: 0, better: null, sec: 'biz', tok: { fund: 'xbrl:revenue' }, type: 'flow', reads: F5 },
};
export interface CoRowDef { k: CoKey; l: string; m: BMetric;
  /** the board metric the row's place is read on (null: the board has no such metric) */
  board: BMetric | null }
const def = (k: CoKey, l: string): CoRowDef => {
  const m = LOCAL[k] ?? BBY.get(k)!;
  return { k, l, m, board: LOCAL[k] ? null : BBY.get(k) ?? null };
};
/** 5.2 item 6 + 13.1 F6: insurers seven rows (the solvency row last), fund houses six */
export const INS_ROWS: CoRowDef[] = [def('np', 'רווח נקי'), def('comp', 'רווח כולל'), def('isr', 'רווח משירותי ביטוח'), def('csm', 'CSM'), def('eq', 'הון לבעלי המניות'), def('roe', 'ROE, LTM'), def('sr', 'כושר פירעון')];
export const FUND_ROWS: CoRowDef[] = [def('np', 'רווח נקי'), def('rev', 'הכנסות'), def('nm', 'שולי רווח'), def('aum', 'נכסים מנוהלים, מיליארדים'), def('eq', 'הון'), def('roe', 'ROE, LTM')];
export const rowsFor = (kind: Kind) => (kind === 'fund' ? FUND_ROWS : INS_ROWS);
/** the quarters grid's columns (spec 5.2 lens רבעונים: רווח נקי, שירותי ביטוח, רווח כולל, CSM, הון) */
export const gridKeys = (kind: Kind): CoKey[] => (kind === 'fund' ? ['np', 'rev', 'nm', 'aum', 'eq'] : ['np', 'isr', 'comp', 'csm', 'eq']);
export const rowDef = (kind: Kind, k: CoKey): CoRowDef => rowsFor(kind).find((r) => r.k === k) ?? def(k, (LOCAL[k] ?? BBY.get(k)!).sh);
/** the peers strip (5.4, 9.4 rule 5): business and operations metrics only, never a price or a multiple */
export const STRIP: Record<Kind, string[]> = { ins: ['np', 'roe', 'isrm', 'csm', 'csmeq', 'eq', 'sr', 'oshare', 'onetr'], fund: ['np', 'roe', 'nm', 'aum', 'aumy', 'eq', 'oshare', 'onetr', 'ofee'] };

/** every peer-file id the page reads (the rows, the grid, the strip, the status marker); market files are left out on purpose */
export function coNeedIds(book: Book | null, kind: Kind): string[] {
  const ms = [...rowsFor(kind).map((r) => r.m), ...gridKeys(kind).map((k) => rowDef(kind, k).m), ...STRIP[kind].map((k) => BBY.get(k)!).filter(Boolean)];
  return [...needIds(book, ms, false).filter((id) => !id.startsWith('mkt:')), 'ifrs:profit_attributable', 'xbrl:profit', 'reg:assets@all'];
}

/* ---------- one figure ---------- */
export interface CoFig { v: number | null; text: string; prov: () => Prov; why?: string; tone?: boolean;
  /** the period the figure is of when it is not the column's (a half-year solvency ratio: "2026Q2") */
  p?: string | null; stale?: boolean }
const NA = (title: string, why: string): CoFig => ({ v: null, text: '–', why, prov: () => ({ k: 'none', title, why }) });
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
/** a level as the company table prints it: millions without a decimal, ratios one decimal (solvency whole points) */
export function fmtLevel(m: BMetric, v: number): string {
  if (m.u === 'm') return nf(v, 0);
  if (m.u === 'bn') return nf(v, 1);
  if (m.u === 'pct') return `${nf(v, m.key === 'sr' ? 0 : 1)}%`;
  return fmtRead(m, 'q', v);
}
const fromVal = (m: BMetric, rd: QRead, x: BVal, title: string): CoFig => (fin(x.v)
  ? { v: x.v, text: rd === 'yoy' || rd === 'qoq' || rd === 'ltmy' ? fmtRead(m, rd, x.v) : fmtLevel(m, x.v), prov: x.prov, tone: rd === 'yoy' || rd === 'qoq' || rd === 'ltmy', p: x.p ?? null, stale: !!x.stale }
  : NA(title, x.why ?? 'אין נתון'));
const unitOf = (m: BMetric) => (m.u === 'm' ? 'מיליוני ש"ח' : m.u === 'bn' ? 'מיליארדי ש"ח' : '%');

/** the semi-annual solvency ratio at or before `q` (the board's `bizVal`: up to three quarters back), with its own period */
function srAt(book: Book, m: BMetric, e: string, kind: Kind, q: string, peers: string[]): BVal {
  return bizVal(book, m, e, kind, q, peers);
}
/** A change of an amount that crosses zero has no percent: the difference in millions, both figures as components (5.3). */
function diffFig(m: BMetric, title: string, a: BVal, b: BVal, la: string, lb: string): CoFig {
  const d = chgPts(a.v, b.v)!, text = `${sn(d, 0)} מ׳`;
  return { v: d, text, tone: true, prov: () => ({ k: 'calc', title, value: text, unit: 'מיליוני ש"ח', formula: `${la} פחות ${lb} (אחד הנתונים אינו חיובי: הפרש, לא אחוז)`,
    inputs: [{ label: la, v: fmtLevel(m, a.v!), src: a.prov }, { label: lb, v: fmtLevel(m, b.v!), src: b.prov }] }) };
}

/** One cell of the company table: row `r` of company `e` at quarter `q` (5.2, 13.1 F6). */
export function coCell(book: Book, r: CoRowDef, e: string, kind: Kind, q: string, what: What, peers: string[]): CoFig {
  const m = r.m, title = `${r.l} · ${book.name(e)}`;
  if (r.k === 'sr') {
    // solvency is published for halves and years: the latest at or before the quarter, tagged with its period; a change against the same
    // half a year earlier, in points; no QoQ
    const a = srAt(book, m, e, kind, q, peers);
    if (!fin(a.v)) return NA(title, a.why ?? 'אין נתון');
    if (what === 'v') return { v: a.v, text: fmtLevel(m, a.v), prov: a.prov, p: a.p ?? null, stale: !!a.stale };
    if (what === 'qoq') return NA(title, 'מתפרסם פעמיים בשנה: אין שינוי רבעוני');
    if (what === 'ltm') return NA(title, 'יחס לסוף תקופה: אין LTM');
    const p0 = qBack(a.p!, 4), b = srAt(book, m, e, kind, p0, peers);
    if (!fin(b.v) || b.p !== p0) return NA(title, `אין יחס ל-${perLabel(p0)}`);
    const d = chgPts(a.v, b.v)!, text = `${sn(d, 1)} נק׳`, la = perLabel(a.p!), lb = perLabel(p0);
    return { v: d, text, tone: true, prov: () => ({ k: 'calc', title: `${r.l} YoY · ${book.name(e)}`, value: text, unit: 'נקודות', formula: `${la} פחות ${lb}, בנקודות`,
      inputs: [{ label: `${r.l}, ${la}`, v: fmtLevel(m, a.v!), src: a.prov }, { label: `${r.l}, ${lb}`, v: fmtLevel(m, b.v!), src: b.prov }], note: 'ללא הוראות מעבר' }) };
  }
  const flow = m.type === 'flow' || !!m.fr;
  if (what === 'ltm') {
    if (!flow) return NA(title, m.type === 'bal' ? 'יתרה לסוף הרבעון: אין LTM' : r.k === 'roe' ? 'הנתון עצמו LTM' : 'אין LTM');
    return fromVal(m, 'ltm', readVal(book, m, e, kind, q, 'ltm', peers), title);
  }
  if (what === 'v') return fromVal(m, r.k === 'roe' ? 'ltm' : 'q', readVal(book, m, e, kind, q, r.k === 'roe' ? 'ltm' : 'q', peers), title);
  const x = readVal(book, m, e, kind, q, what, peers);
  if (!fin(x.v) && /בסיס שלילי/.test(x.why ?? '') && m.u === 'm') {
    // a flow from or to a loss: the absolute change in millions (5.3), never a percent
    const q0 = qBack(q, what === 'yoy' ? 4 : 1), a = readVal(book, m, e, kind, q, 'q', peers), b = readVal(book, m, e, kind, q0, 'q', peers);
    if (fin(a.v) && fin(b.v)) return diffFig(m, `${r.l} ${what === 'yoy' ? 'YoY' : 'QoQ'} · ${book.name(e)}`, a, b, qlab(q), qlab(q0));
  }
  return fromVal(m, what, x, title);
}

/** eight quarters of a row, newest last (the spark line and the row sheet) */
export function coSeries(book: Book, r: CoRowDef, e: string, kind: Kind, q: string, peers: string[], n = 8): { q: string; v: CoFig; yoy: CoFig }[] {
  return Array.from({ length: n }, (_, i) => qBack(q, n - 1 - i)).map((x) => {
    if (r.k === 'sr') { const a = srAt(book, r.m, e, kind, x, peers); const on = fin(a.v) && a.p === x; return { q: x, v: on ? { v: a.v, text: fmtLevel(r.m, a.v!), prov: a.prov, p: x } : NA(r.l, 'לא פורסם לרבעון זה'), yoy: on ? coCell(book, r, e, kind, x, 'yoy', peers) : NA(r.l, '–') }; }
    return { q: x, v: coCell(book, r, e, kind, x, 'v', peers), yoy: coCell(book, r, e, kind, x, 'yoy', peers) };
  });
}

/* ---------- the board's context and the place among peers ---------- */
/** the board context of the company's set: the quarter is the set's newest reported (`status.bq`), as on the board (5.5 "place") */
export function coCtx(book: Book, ents: string[], status: ReportStatus, kindOf: (e: string) => Kind): BoardCtx {
  const qReg = book.latest('reg:assets@all', 'LTM', ents) ?? status.bq;
  return { book, ents, q: status.bq, qReg, status, kindOf };
}
export interface Place { place: number | null; n: number; star: boolean; text: string }
/** "2/7", "3/7*" (carried: the company has not reported the board's quarter), "–" */
export function placeOf(b: BoardOut, e: string): Place {
  const x = b.rows.find((r) => r.e === e);
  if (!x || x.place == null || x.out) return { place: null, n: b.n, star: false, text: '–' };
  return { place: x.place, n: b.n, star: x.stale, text: `${x.place}/${b.n}${x.stale ? '*' : ''}` };
}
export const coBoard = (c: BoardCtx, m: BMetric): BoardOut => boardRows(c, m, defRead(m));

/* ---------- the quarters grid (lens רבעונים and the desktop panel) ---------- */
export type GridRead = 'q' | 'yoy' | 'qoq' | 'ltm';
/** one cell: `cp` = the seg's reading. LTM on a balance is its quarter-end level (the grid's note says so). */
export function gridCell(book: Book, kind: Kind, k: CoKey, e: string, q: string, cp: GridRead, peers: string[]): CoFig {
  const r = rowDef(kind, k), flow = r.m.type === 'flow' || !!r.m.fr;
  return coCell(book, r, e, kind, q, cp === 'q' ? 'v' : cp === 'ltm' ? (flow ? 'ltm' : 'v') : cp, peers);
}
export const gridNote = (cp: GridRead) => (cp === 'yoy' ? 'כל תא: הרבעון מול הרבעון המקביל לפני שנה' : cp === 'qoq' ? 'כל תא: הרבעון מול הרבעון הקודם'
  : cp === 'ltm' ? 'זרמים: סכום ארבעה רבעונים; יתרות: סוף הרבעון · מיליוני ש"ח' : 'מיליוני ש"ח, כפי שדווח');

/* ---------- the sentence (lib/companyWords) ---------- */
export interface WordsIn { np: CoFig; npY: CoFig; npQ: CoFig; roe: CoFig }
export function wordsIn(book: Book, kind: Kind, e: string, q: string, peers: string[]): WordsIn {
  const np = rowDef(kind, 'np'), roe = rowDef(kind, 'roe');
  return { np: coCell(book, np, e, kind, q, 'v', peers), npY: coCell(book, np, e, kind, qBack(q, 4), 'v', peers), npQ: coCell(book, np, e, kind, qBack(q, 1), 'v', peers), roe: coCell(book, roe, e, kind, q, 'v', peers) };
}
/** the source of a change the sentence prints ("−46.0%" or "+180" in millions): both quarters as components, the headline its text */
export function wordsChgProv(title: string, text: string, a: CoFig, b: CoFig, la: string, lb: string, pct: boolean): Prov {
  return { k: 'calc', title, value: text, unit: pct ? '%' : 'מיליוני ש"ח', formula: pct ? `${la} ÷ ${lb} − 1` : `${la} פחות ${lb} (אחד הנתונים אינו חיובי: הפרש, לא אחוז)`,
    inputs: [{ label: la, v: a.text, src: a.prov }, { label: lb, v: b.text, src: b.prov }] };
}
/** the percent the sentence would print, or null (a loss on either side) */
export const npPct = (a: number | null, b: number | null) => (fin(a) && fin(b) && a > 0 && b > 0 ? chgPct(a, b).v : null);
export { unitOf };
