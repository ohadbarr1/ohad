/** The peers board's shared data, the comps tables' column model, and the board workbook (spec p6 §3.2 lens טבלה, §13.1 F2 / F4 / F8,
 *  §14.1 N10, §14.3 rules 1–5; tester round 3 P1). One column model feeds the table lens and the workbook, so a figure in a table and the
 *  same figure in Excel are the same call. Every figure is read through lib/peerBoard (`boardRows` on `carriedVal`, `readVal`, `bizVal`,
 *  `spotVal`); nothing here computes a multiple, an LTM or a change of its own: the workbook's multiples are formulas over the very inputs
 *  `spotVal` divides, and each formula cell stores its computed value as well (previews that do not recalculate show it). */
import { nf, pubLabel } from '../../lib/format';
import type { Prov } from '../../lib/prov';
import { type Book, type Registry } from '../../lib/registry';
import { mayaReport } from '../../lib/sources';
import type { TasePrice } from '../../lib/valuation';
import { qBack, qlab, readLabel, type QRead } from '../../lib/quarters';
import {
  aggMultiple, basisShort, basisText, BBY, bizVal, boardRows, closeAt, defRead, fmtB, fmtRead, MBY, pairRead, readVal, TAX, unitB, unitRead,
  type BMetric, type BoardCtx, type BoardOut, type BVal, type Kind, type MedianOf, type MktFile, type ReportStatus, type Stat,
} from '../../lib/peerBoard';

/** What the board's shell (PeersBoard.tsx, lane P6-2a) hands every lens and the Excel button. */
export interface BoardData {
  reg: Registry; book: Book;
  /** the set, in set order */
  ents: string[];
  /** by market value, largest first (the tables' and charts' order) */
  order: string[];
  /** metricsFor(kinds): the shipped table metrics of the set */
  ms: BMetric[];
  /** the shipped cells (metric × company at the LTM axis quarter) and their stats; used where a column has no board reading */
  cells: Map<string, Map<string, BVal>>;
  stats: Map<string, Stat>;
  focus: string;
  kindOf: (e: string) => Kind;
  major: Kind;
  /** the LTM axis quarter of the filings, and of the regulator's monthly files */
  p: string; pOps: string;
  mk: MktFile | null;
  px: Record<string, TasePrice | null>;
  /** the latest close ("2026-11-25") */
  pxAsof: string;
  setName: string;
  status: ReportStatus;
  /** the board's quarter: status.bq, or status.cq when base=common */
  q: string;
  base: 'latest' | 'common';
  /** the board's metric and its resolved reading */
  bm: string; rd: QRead;
  put: (k: string, v: string | null) => void;
  get: (k: string) => string | null;
}

export const ctxOf = (d: BoardData): BoardCtx => ({ book: d.book, ents: d.ents, q: d.q, qReg: d.pOps || d.q, px: d.px, mk: d.mk, status: d.status, kindOf: d.kindOf });

/* ======================= the column model (table lens + workbook) ======================= */
export type Sec = 'mkt' | 'biz' | 'sav' | 'ins';
export const SEC_TITLE: Record<Sec, string> = { mkt: 'המניה · מכפילים ותשואה', biz: 'העסק · רווחיות, צמיחה והון', sav: 'הפעילות · חיסכון ארוך טווח: נכסים, הפקדות, משיכות וניוד', ins: 'הפעילות · ביטוח: הכנסות, צמיחה ומרווח לפי מגזר' };
export const SEC_SHEET: Record<Sec, string> = { mkt: 'המניה', biz: 'העסק', sav: 'חיסכון', ins: 'ביטוח' };

export interface TCell {
  e: string; v: number | null; val: BVal;
  /** the quarter the figure is of (a carried company: its own last quarter); null for a close-dated market figure */
  q: string | null;
  /** carried (13.2 rule 1): starred and counted */
  stale: boolean;
  /** a quarter-named reading the company has not reported (13.2 rule 2): shown muted, not counted */
  out: boolean;
  /** a half-year / annual figure: its period key */
  per: string | null;
}
export interface TCol {
  /** the shipped column's metric (its name, direction and unit as the table always printed them) */
  m: BMetric;
  /** the board metric and reading it is read through; null: the shipped cell (no board reading for this column) */
  bm: BMetric | null; rd: QRead | null;
  /** the head's second line: the unit, or the change's basis ("LTM מול LTM", "מול Q3'25") */
  sub: string;
  /** the quarter of the column (the regulator's for its metrics) */
  q: string;
  cells: Map<string, TCell>;
  med: MedianOf;
  avg: number | null;
  fmt: (v: number) => string;
}
export const isChgRd = (rd: QRead | null) => rd === 'yoy' || rd === 'qoq' || rd === 'ltmy';

/** the board reading a shipped table column is: its own default reading; a change column (npy, csmy, …) = its base metric's paired YoY;
 *  a return window = total return at that window; null = no board reading (read from the shipped cell) */
export function readingOf(d: BoardData, m: BMetric): { bm: BMetric; rd: QRead } | null {
  if (m.type === 'ret' && (m.key === 'r3' || m.key === 'rytd' || m.key === 'r12')) { const tr = BBY.get('tr'); return tr ? { bm: tr, rd: m.key as QRead } : null; }
  // a flow filed by halves (gross premiums): boardRows builds its LTM from halves (FY + H1 − H1 a year back), as the shipped cell did
  if (m.reads?.length && !m.of) return { bm: m, rd: defRead(m) };
  if (m.of) {
    const b = BBY.get(m.of), rd = b ? pairRead(b) : null;
    // the base must apply to the set's companies (AUM YoY of insurers has its own token, the base AUM is a fund-house metric)
    if (b && rd && (b.spot || b.tok?.[d.major])) return { bm: b, rd };
  }
  return null;
}

const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
/** one column: its cells for every company of the set, the median with its n over the counted cells, the mean */
export function colOf(d: BoardData, m: BMetric, cache?: Map<string, BoardOut>): TCol {
  const r = readingOf(d, m), cx = ctxOf(d);
  const cells = new Map<string, TCell>();
  let q = m.ax === 'reg' ? d.pOps || d.q : d.q;
  if (r) {
    const k = `${r.bm.key}|${r.rd}`;
    let b = cache?.get(k);
    if (!b) { b = boardRows(cx, r.bm, r.rd); cache?.set(k, b); }
    q = b.q;
    b.rows.forEach((x) => cells.set(x.e, { e: x.e, v: finite(x.v) ? x.v : null, val: x.val, q: x.q, stale: x.stale, out: x.out, per: x.per }));
    const parts = b.med.parts.map((p) => p.v);
    const f = (v: number) => fmtRead(r.bm, r.rd, v);
    return { m, bm: r.bm, rd: r.rd, sub: isChgRd(r.rd) ? basisShort(r.bm, r.rd, q) : subOf(m), q, cells, med: b.med, avg: parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : null, fmt: f };
  }
  // no board reading: the shipped cell, as the table always read it (bizVal at the LTM axis; a stale cell is an earlier period, starred)
  d.ents.forEach((e) => {
    const x = d.cells.get(m.key)?.get(e) ?? bizVal(d.book, m, e, d.kindOf(e), q, d.ents);
    cells.set(e, { e, v: finite(x.v) ? x.v : null, val: x, q: x.p && /Q\d$/.test(x.p) ? x.p : null, stale: !!x.stale, out: false, per: m.freq ? x.p ?? null : null });
  });
  const parts = [...cells.values()].filter((c) => finite(c.v)).map((c) => ({ e: c.e, v: c.v!, stale: c.stale, q: c.q }));
  const vs = parts.map((p) => p.v).sort((a, b) => a - b);
  const med = vs.length ? (vs.length % 2 ? vs[(vs.length - 1) / 2] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2) : null;
  return { m, bm: null, rd: null, sub: subOf(m), q, cells, med: { v: med, n: parts.length, parts }, avg: vs.length ? vs.reduce((s, x) => s + x, 0) / vs.length : null, fmt: (v) => fmtB(m, v) };
}
function subOf(m: BMetric): string {
  return `${unitB(m)}${m.freq === 'FY' ? ' · FY' : m.freq === 'H' ? ' · H/FY' : m.type === 'flow' || (m.type === 'ratio' && m.reads?.[0] === 'ltm') ? ' · LTM' : m.type === 'ret' ? '' : ''}`;
}

/** the four tables' metrics, as shipped (the operating tables only where some company has a figure) */
export function secMetrics(d: BoardData): Record<Sec, BMetric[]> {
  const any = (m: BMetric) => d.ents.some((e) => finite(d.cells.get(m.key)?.get(e)?.v));
  return {
    mkt: d.ms.filter((m) => m.sec === 'mkt'),
    biz: d.ms.filter((m) => m.sec === 'biz'),
    sav: d.ms.filter((m) => m.grp === 'sav' && !m.hide && any(m)),
    ins: d.ms.filter((m) => m.grp === 'ins' && any(m)),
  };
}
const BAL = new Set(['oaum', 'open', 'ogem', 'opol']);
/** the total / weighted row: the set's own multiple (Σ market value ÷ Σ denominators) on the stock table; on the operating tables the sum of
 *  an amount, only when every company's figure is of one period (a carried figure is not summed with reported ones; an asset balance by
 *  product is the exception: a group without the product holds none) */
export function aggOf(sec: Sec, col: TCol, cols: TCol[], rows: string[]): number | null {
  if (sec === 'mkt') {
    const mc = cols.find((c) => c.m.key === 'mcap'); if (!mc) return null;
    const v = (c: TCol, e: string) => c.cells.get(e)?.v ?? null, mcs = rows.map((e) => v(mc, e));
    if (col.m.key === 'mcap') { const xs = mcs.filter(finite); return xs.length ? xs.reduce((s, x) => s + x, 0) : null; }
    if (col.m.key === 'pe' || col.m.key === 'pb' || col.m.key === 'pbc') return aggMultiple(mcs, rows.map((e, i) => { const x = v(col, e), m = mcs[i]; return finite(x) && x > 0 && finite(m) ? m / x : null; }));
    return null;
  }
  if (sec === 'biz' || isChgRd(col.rd) || (col.m.u !== 'bn' && col.m.u !== 'm')) return null;
  const cs = rows.map((e) => col.cells.get(e)), xs = cs.map((c) => c?.v ?? null).filter(finite);
  if (!xs.length) return null;
  if (BAL.has(col.m.key) || (xs.length === rows.length && !cs.some((c) => c?.stale))) return xs.reduce((s, x) => s + x, 0);
  return null;
}

/* ======================= sources: the document behind a figure ======================= */
/** kind, period or basis, formula, components, document, link */
export function provRow(p: Prov, mk: MktFile | null, e: string): [string, string, string, string, string, string] {
  const url = linkOf(p, mk, e, 0);
  switch (p.k) {
    case 'report': return ['דוח', p.period ?? '', '', p.note ?? '', [p.doc, p.pg ? `עמ׳ ${p.pg}` : ''].filter(Boolean).join(', '), url];
    case 'xbrl': return ['XBRL', p.period, '', p.concept, `${p.company} · MAYA`, url];
    case 'calc': {
      const comps = p.inputs.map((i) => `${i.label}: ${i.v}`).join(' ; ');
      const doc = p.inputs.map((i) => { const s = i.src?.(); return s ? docOf(s) : ''; }).find(Boolean) ?? '';
      return [p.est ? 'מחושב · אומדן' : 'מחושב', p.note ?? '', p.formula, comps, doc, url];
    }
    case 'price': return ['TASE', pubLabel(p.date), '', `${p.ticker} · ${p.vendor}`, 'הבורסה לניירות ערך', url];
    case 'reg': return ['רשות שוק ההון', '', '', '', 'גמל-נט, פנסיה-נט, ביטוח-נט', url];
    case 'none': return ['–', '', '', p.why, '', ''];
    default: return [p.k, '', '', '', '', url];
  }
}
function docOf(p: Prov): string {
  if (p.k === 'report') return [p.doc, p.pg ? `עמ׳ ${p.pg}` : ''].filter(Boolean).join(', ');
  if (p.k === 'xbrl') return `${p.company} · MAYA`;
  if (p.k === 'price') return 'הבורסה לניירות ערך';
  if (p.k === 'calc') return p.inputs.map((i) => { const s = i.src?.(); return s ? docOf(s) : ''; }).find(Boolean) ?? '';
  return '';
}
function linkOf(p: Prov, mk: MktFile | null, e: string, depth: number): string {
  if (p.k === 'report') return p.url ? (p.pg ? `${p.url}#page=${p.pg}` : p.url) : '';
  if (p.k === 'xbrl') return p.rid ? mayaReport(p.rid) : '';
  if (p.k === 'price') return mk?.ents[e]?.url ?? '';
  if (p.k === 'calc' && depth < 3) { for (const i of p.inputs) { const s = i.src?.(); const u = s ? linkOf(s, mk, e, depth + 1) : ''; if (u) return u; } }
  return '';
}

/* ======================= the workbook ======================= */
/** The board's workbook: המניה (inputs; the multiples are formulas over them, the tax assumption in one cell), העסק, חיסכון, ביטוח (each
 *  company's quarter, the level and its paired YoY; =MEDIAN with =COUNT under it, =AVERAGE), רבעונים (12 quarters: quarter-end market value,
 *  equity, CSM, net profit; quarter-end P/B and P/(B+CSM) as formulas over the blocks), מקורות (per value: reading, period or basis, formula,
 *  components, document, a live =HYPERLINK). */
export async function exportBoard(d: BoardData): Promise<void> {
  const { downloadXlsxAsync, hyperlink, colRef } = await import('../../lib/xlsx');
  type XC = import('../../lib/xlsx').XCell;
  type XS = import('../../lib/xlsx').XSheet;
  const { book, order } = d, ent = (e: string) => book.name(e);
  const close = d.pxAsof ? pubLabel(d.pxAsof) : '–';
  const xf = (m: BMetric, rd: QRead | null): 'n0' | 'n1' | 'n2' => (isChgRd(rd) ? (m.u === 'x' ? 'n2' : m.dec >= 2 ? 'n2' : 'n1') : m.u === 'm' ? 'n0' : m.u === 'x' || m.u === 'bn' || m.dec >= 2 ? 'n2' : 'n1');
  const num = (v: number | null | undefined, fmt: 'n0' | 'n1' | 'n2', bold = false): XC => (finite(v) ? { v: +v.toFixed(6), fmt, bold } : null);
  const qOfE = (e: string) => d.status.last[e] ?? null;
  const cache = new Map<string, BoardOut>();
  const sms = secMetrics(d);

  // ---- מקורות: one row per value written to a data sheet
  const src: XC[][] = [['חברה', 'גיליון', 'מדד', 'קריאה', 'ערך', 'תקופה / בסיס', 'סוג מקור', 'נוסחה', 'רכיבים', 'מסמך', 'קישור'].map((v) => ({ v, head: true }))];
  const pushSrc = (sheet: string, e: string, label: string, reading: string, v: number, fmt: 'n0' | 'n1' | 'n2', val: BVal, period: string) => {
    const [kind, per, formula, comps, doc, url] = provRow(val.prov(), d.mk, e);
    src.push([ent(e), sheet, label, reading, { v: +v.toFixed(6), fmt }, (!per || period.includes(per) ? period : !period || per.includes(period) ? per : `${period} · ${per}`), kind, formula, comps, doc, url ? hyperlink(url, doc || 'פתיחת המסמך') : '']);
  };
  const medRows = (cols: number[], r0: number, r1: number, fmts: ('n0' | 'n1' | 'n2')[], meds: (number | null)[], ns: number[], avgs: (number | null)[], lead: number): XC[][] => {
    const L = (c: number) => colRef(c);
    const pad = Array.from({ length: lead }, () => null as XC);
    return [
      [{ v: 'חציון', bold: true }, ...pad.slice(1), ...cols.map((c, i) => (ns[i] ? { f: `MEDIAN(${L(c)}${r0}:${L(c)}${r1})`, v: finite(meds[i]) ? +meds[i]!.toFixed(6) : null, fmt: fmts[i], bold: true }
        : { f: `IF(COUNT(${L(c)}${r0}:${L(c)}${r1})=0,"",MEDIAN(${L(c)}${r0}:${L(c)}${r1}))`, v: '', fmt: fmts[i], bold: true }))],
      [{ v: 'מספר החברות בחציון', muted: true }, ...pad.slice(1), ...cols.map((c, i) => ({ f: `COUNT(${L(c)}${r0}:${L(c)}${r1})`, v: ns[i], fmt: 'n0' as const, muted: true }))],
      [{ v: 'ממוצע', muted: true }, ...pad.slice(1), ...cols.map((c, i) => ({ f: `IF(COUNT(${L(c)}${r0}:${L(c)}${r1})=0,"",AVERAGE(${L(c)}${r0}:${L(c)}${r1}))`, v: finite(avgs[i]) ? +avgs[i]!.toFixed(6) : ns[i] ? null : '', fmt: fmts[i], muted: true }))],
    ];
  };

  // ---- המניה: the inputs, and the multiples as formulas over them (row 5 onwards; the tax assumption in K2)
  const mktSheet = (): XS => {
    const R0 = 5, mc = (e: string) => d.px[e]?.mcap ?? null;
    const fund = (k: string, e: string) => { const m = MBY.get(k); return m ? bizVal(book, m, e, d.kindOf(e), d.q, d.ents) : null; };
    const spot = (k: string) => colOf(d, MBY.get(k)!, cache);
    const has = (k: string) => d.ms.some((m) => m.key === k);
    const cPe = has('pe') ? spot('pe') : null, cPb = has('pb') ? spot('pb') : null, cPbc = has('pbc') ? spot('pbc') : null;
    const extra = sms.mkt.filter((m) => !['mcap', 'pe', 'pb', 'pbc'].includes(m.key)).map((m) => colOf(d, m, cache));
    const head = ['חברה', 'רבעון הנתון המדווח', `שווי שוק, ${close} (מיליוני ש"ח)`, 'רווח נקי לבעלי המניות LTM (מיליוני ש"ח)', 'הון לבעלי המניות (מיליוני ש"ח)', 'CSM, יתרת סגירה (מיליוני ש"ח)', 'P/E (נוסחה)', 'P/B (נוסחה)', 'P/(B+CSM) (נוסחה)', ...extra.map((c) => `${c.m.sh} (${c.m.u === 'pctx' || c.m.u === 'pct' ? '%' : unitB(c.m)})`)];
    const rows: XC[][] = [
      [{ v: 'fox · השוואה ענפית · המניה', bold: true }],
      [`${d.setName} · שווי שוק: סגירה ${close} · נתון מדווח: הדוח האחרון של כל חברה (עמודה B) · CSM נטו ממס בשיעור שבתא K2 (הנחה) · מכפיל של רווח או הון שליליים אינו מוצג`, null, null, null, null, null, null, null, null, { v: 'שיעור המס על CSM', bold: true }, { v: TAX / 100, fmt: 'n2' }],
      [],
      head.map((v) => ({ v, head: true })),
    ];
    const mfmt: ('n0' | 'n1' | 'n2')[] = ['n0', 'n0', 'n0', 'n0', 'n2', 'n2', 'n2', ...extra.map((c) => xf(c.m, c.rd))];
    const colVals: (number | null)[][] = mfmt.map(() => []);
    order.forEach((e, i) => {
      const r = R0 + i, np = fund('np', e), eq = fund('eq', e), cs = has('pbc') ? fund('csm', e) : null, m = mc(e);
      const kq = eq?.p && /Q\d$/.test(eq.p) ? qlab(eq.p) : qlab(qOfE(e));
      // a multiple is written as a formula only where the board shows it (same inputs, same guard: no negative denominator, one quarter)
      const pe = cPe?.cells.get(e), pb = cPb?.cells.get(e), pbc = cPbc?.cells.get(e);
      const okPe = finite(pe?.v) && finite(m) && finite(np?.v) && np!.v! > 0, okPb = finite(pb?.v) && finite(m) && finite(eq?.v) && eq!.v! > 0;
      const okPbc = finite(pbc?.v) && finite(m) && finite(eq?.v) && finite(cs?.v);
      const vPe = okPe ? m! / np!.v! : null, vPb = okPb ? m! / eq!.v! : null, vPbc = okPbc ? m! / (eq!.v! + cs!.v! * (1 - TAX / 100)) : null;
      const inputs = [m, np?.v ?? null, eq?.v ?? null, cs?.v ?? null];
      inputs.forEach((v, k) => colVals[k].push(finite(v) ? v : null));
      [vPe, vPb, vPbc].forEach((v, k) => colVals[4 + k].push(v));
      extra.forEach((c, k) => { const x = c.cells.get(e); colVals[7 + k].push(x && !x.out && finite(x.v) ? x.v : null); });
      if (finite(m) && d.px[e]) pushSrc('המניה', e, 'שווי שוק', `סגירה ${close}`, m, 'n0', { v: m, fl: 0, prov: () => ({ k: 'price', title: 'שווי שוק', value: nf(m, 0), ticker: d.px[e]!.name ?? d.px[e]!.ticker, vendor: d.px[e]!.source, date: d.px[e]!.asof }) }, `סגירה ${close}`);
      ([['רווח נקי LTM', np, 'LTM '], ['הון לבעלי המניות', eq, ''], ['CSM, יתרת סגירה', cs, '']] as [string, BVal | null, string][]).forEach(([l, x, pre]) => { if (x && finite(x.v)) pushSrc('המניה', e, l, x.p ? `${pre}${qlab(x.p)}` : '', x.v, 'n0', x, x.stale ? `נתון מ-${qlab(x.p)} (טרם דווח על ${qlab(d.q)})` : ''); });
      ([['P/E', pe, vPe], ['P/B', pb, vPb], ['P/(B+CSM)', pbc, vPbc]] as [string, TCell | undefined, number | null][]).forEach(([l, x, v]) => { if (x && finite(v)) pushSrc('המניה', e, l, `עכשיו · סגירה ${close}`, v, 'n2', x.val, x.stale ? `נתון מדווח ${qlab(x.q)}` : ''); });
      extra.forEach((c) => { const x = c.cells.get(e); if (x && !x.out && finite(x.v)) pushSrc('המניה', e, c.m.l, c.rd ? readLabel(c.rd, c.q) : '', x.v, xf(c.m, c.rd), x.val, `סגירה ${close}`); });
      rows.push([
        { v: ent(e), bold: e === d.focus }, kq,
        num(m, 'n0'), num(np?.v, 'n0'), num(eq?.v, 'n0'), num(cs?.v, 'n0'),
        okPe ? { f: `C${r}/D${r}`, v: +vPe!.toFixed(6), fmt: 'n2' } : null,
        okPb ? { f: `C${r}/E${r}`, v: +vPb!.toFixed(6), fmt: 'n2' } : null,
        okPbc ? { f: `C${r}/(E${r}+F${r}*(1-$K$2))`, v: +vPbc!.toFixed(6), fmt: 'n2' } : null,
        ...extra.map((c) => { const x = c.cells.get(e); return x && !x.out ? num(x.v, xf(c.m, c.rd)) : null; }),
      ]);
    });
    const r1 = R0 + order.length - 1, cols = mfmt.map((_, i) => i + 2);
    const st = colVals.map((xs) => { const ys = xs.filter(finite).sort((a, b) => a - b); return { n: ys.length, med: ys.length ? (ys.length % 2 ? ys[(ys.length - 1) / 2] : (ys[ys.length / 2 - 1] + ys[ys.length / 2]) / 2) : null, avg: ys.length ? ys.reduce((s, x) => s + x, 0) / ys.length : null }; });
    rows.push(...medRows(cols, R0, r1, mfmt, st.map((s) => s.med), st.map((s) => s.n), st.map((s) => s.avg), 2));
    rows.push([], [{ v: 'P/E = שווי שוק ÷ רווח נקי LTM; P/B = שווי שוק ÷ הון; P/(B+CSM) = שווי שוק ÷ (הון + CSM × (1 − K2)). המכפילים בלוח הם אותן נוסחאות על אותם נתונים (סגירה אחרונה ÷ הדוח האחרון של כל חברה). חציון: רק חברות עם נתון; מספרן בשורה שמתחת.', muted: true }]);
    return { name: 'המניה', rows, freeze: { rows: 4, cols: 1 }, widths: [18, 12, 16, 16, 16, 16, 11, 11, 13, ...extra.map(() => 13)] };
  };

  // ---- העסק, חיסכון, ביטוח: each column of the table lens, the level beside its paired YoY
  const secSheet = (sec: Exclude<Sec, 'mkt'>): XS | null => {
    const cols = sms[sec].map((m) => colOf(d, m, cache));
    if (!cols.length) return null;
    const R0 = 5, name = SEC_SHEET[sec];
    const qs = sec === 'sav' ? qlab(d.pOps || d.q) : qlab(d.q);
    const rows: XC[][] = [
      [{ v: `fox · השוואה ענפית · ${name}`, bold: true }],
      [`${d.setName} · ${sec === 'sav' ? `רשות שוק ההון, ${qs}` : `דוחות החברות, ${qs}`} · חברה שטרם דיווחה: הדוח האחרון שלה (עמודה B), נספרת ברמות ובמכפילים; ב-YoY של הרבעון רק מי שדיווח · YoY ליד LTM: LTM מול LTM; ליד יתרה: סוף רבעון מול סוף רבעון`],
      [],
      [{ v: 'חברה', head: true }, { v: 'רבעון', head: true }, ...cols.map((c) => ({ v: `${c.m.sh} (${c.rd && isChgRd(c.rd) ? `${c.sub}, ${unitRead(c.bm!, c.rd)}` : c.sub})`, head: true }))],
    ];
    const fmts = cols.map((c) => xf(c.m, c.rd));
    order.forEach((e) => {
      rows.push([{ v: ent(e), bold: e === d.focus }, qlab(sec === 'sav' ? d.pOps || d.q : qOfE(e)), ...cols.map((c, i) => {
        const x = c.cells.get(e);
        if (!x || x.out || !finite(x.v)) return null;
        pushSrc(name, e, c.m.l, c.rd ? `${readLabel(c.rd, c.q)}${isChgRd(c.rd) ? ` (${basisText(c.bm!, c.rd, c.q)})` : ''}` : '', x.v, fmts[i], x.val, x.stale ? `נתון מ-${qlab(x.q)} (טרם דווח על ${qlab(c.q)})` : x.per ? x.per : '');
        return num(x.v, fmts[i]);
      })]);
    });
    const r1 = R0 + order.length - 1;
    rows.push(...medRows(cols.map((_, i) => i + 2), R0, r1, fmts, cols.map((c) => c.med.v), cols.map((c) => c.med.n), cols.map((c) => c.avg), 2));
    rows.push([], [{ v: 'תא ריק: אין נתון, או רבעון שהחברה טרם דיווחה (ב-YoY של הרבעון). כל ערך מופיע בגיליון "מקורות" עם הנוסחה, הרכיבים והמסמך.', muted: true }]);
    return { name, rows, freeze: { rows: 4, cols: 1 }, widths: [18, 9, ...cols.map(() => 15)] };
  };

  // ---- רבעונים: 12 quarters as reported; the quarter-end multiples are formulas over the blocks
  const quartersSheet = (): XS => {
    const hq = Array.from({ length: 12 }, (_, i) => qBack(d.q, 11 - i));
    const read = (k: string, rd: QRead) => (e: string, q: string) => { const m = MBY.get(k); if (!m) return null; const x = readVal(book, m, e, d.kindOf(e), q, rd, d.ents); return finite(x.v) ? x : null; };
    const blocks: { key: string; title: string; f: (e: string, q: string) => BVal | null; fmt: 'n0' }[] = [
      { key: 'mc', title: 'שווי שוק בסגירת יום המסחר האחרון ברבעון (מיליוני ש"ח)', f: read('mcap', 'now'), fmt: 'n0' },
      { key: 'eq', title: 'הון לבעלי המניות, סוף רבעון (מיליוני ש"ח)', f: read('eq', 'q'), fmt: 'n0' },
      { key: 'csm', title: 'CSM, יתרת סגירה (מיליוני ש"ח)', f: read('csm', 'q'), fmt: 'n0' },
      { key: 'np', title: 'רווח נקי לבעלי המניות, הרבעון (מיליוני ש"ח)', f: read('np', 'q'), fmt: 'n0' },
    ];
    const rows: XC[][] = [
      [{ v: 'fox · השוואה ענפית · רבעונים', bold: true }],
      [`${d.setName} · 12 רבעונים עד ${qlab(d.q)} · כפי שדווח (תא ריק: לא דווח) · המכפילים בסוף רבעון הם נוסחאות: שווי השוק בסגירת סוף הרבעון ÷ הנתון המדווח לאותו רבעון; שיעור המס על CSM: המניה!K2`],
      [],
    ];
    const at: Record<string, number> = {}, vals: Record<string, (number | null)[][]> = {};
    blocks.forEach((b) => {
      rows.push([{ v: b.title, head: true }, ...hq.map((q) => ({ v: qlab(q), head: true }))]);
      at[b.key] = rows.length + 1;  // the first company's row, 1-based
      vals[b.key] = order.map((e) => hq.map((q) => { const x = b.f(e, q); return x ? x.v : null; }));
      order.forEach((e, i) => {
        rows.push([ent(e), ...hq.map((q, j) => {
          const v = vals[b.key][i][j];
          if (!finite(v)) return null;
          if (j === hq.length - 1) { const x = b.f(e, q)!; pushSrc('רבעונים', e, b.title.replace(/ \(.*/, ''), qlab(q), v, 'n0', x, b.key === 'mc' ? `סגירת ${pubLabel(closeAt(d.mk, e, q) ?? '') || qlab(q)}` : ''); }
          return { v: +v.toFixed(6), fmt: b.fmt };
        })]);
      });
      rows.push([]);
    });
    const L = (j: number) => colRef(j + 1);
    const multBlock = (title: string, f: (i: number, j: number) => { f: string; v: number } | null) => {
      rows.push([{ v: title, head: true }, ...hq.map((q) => ({ v: qlab(q), head: true }))]);
      order.forEach((e, i) => rows.push([ent(e), ...hq.map((_, j) => { const x = f(i, j); return x ? { f: x.f, v: +x.v.toFixed(6), fmt: 'n2' as const } : null; })]));
      rows.push([]);
    };
    multBlock('P/B בסוף רבעון (נוסחה)', (i, j) => {
      const mc = vals.mc[i][j], eq = vals.eq[i][j];
      return finite(mc) && finite(eq) && eq > 0 ? { f: `${L(j)}${at.mc + i}/${L(j)}${at.eq + i}`, v: mc / eq } : null;
    });
    if (d.ms.some((m) => m.key === 'pbc')) multBlock('P/(B+CSM) בסוף רבעון (נוסחה)', (i, j) => {
      const mc = vals.mc[i][j], eq = vals.eq[i][j], cs = vals.csm[i][j];
      return finite(mc) && finite(eq) && finite(cs) && eq > 0 ? { f: `${L(j)}${at.mc + i}/(${L(j)}${at.eq + i}+${L(j)}${at.csm + i}*(1-המניה!$K$2))`, v: mc / (eq + cs * (1 - TAX / 100)) } : null;
    });
    rows.push([{ v: `בלוח: הסגירה האחרונה (${close}) ÷ הדוח האחרון של כל חברה; כאן: הסגירה בסוף כל רבעון ÷ הנתון של אותו רבעון. לכן המכפיל של ${qlab(d.q)} כאן שונה מהמכפיל בלוח.`, muted: true }]);
    return { name: 'רבעונים', rows, freeze: { rows: 0, cols: 1 }, widths: [26, ...hq.map(() => 10)] };
  };

  const sheets: XS[] = [mktSheet(), ...(['biz', 'sav', 'ins'] as const).map(secSheet).filter((s): s is XS => !!s), quartersSheet()];
  sheets.push({ name: 'מקורות', rows: src, freeze: { rows: 1, cols: 1 }, widths: [16, 10, 30, 22, 12, 26, 12, 46, 60, 30, 16] });
  await downloadXlsxAsync(`fox-comps-${d.q}`, sheets, { title: `fox · השוואה ענפית · ${d.setName} · ${qlab(d.q)}` });
}
