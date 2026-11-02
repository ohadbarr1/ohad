/* W4 · agent door: the client document's figures as data, pure (no React). One row per track (`SnapRow`, lib/clients) built from
   funds.json, the track's history and the decision files; the same rows are frozen into a client folder when it is saved, so a
   reopened folder and its PDF show what the client was shown. The document's table is transposed (metrics down the side, the tracks
   across) and split into pages of at most four tracks, so every column fits an A4 portrait page. The bottom line is written here too,
   in the words of lib/compareSummary: within one category only, never a place or a winner. */
import { nf, sn } from './format';
import { netSeries, selfDirected, stats, ym, type FundX, type HistX } from './funds';
import type { DefaultFile } from './fundsTools';
import { defaultNow, isPension, periodText } from './pensionPack';
import { companyOf, isOldGen, svcOf, type DecisionFile } from './decision';
import { CROSS_HE, LEAD_HE, OLD_HE, compareSummary, type CmpIn, type Lead } from './compareSummary';
import { TIE_NOTE } from './fundsTie';
import type { Snap, SnapRow } from './clients';
import { catKey } from './funds';

export interface DocCtx { net: boolean; asof: number; hist?: HistX | null; dfile?: DefaultFile | null; dec?: DecisionFile | null }

/** the published fee's range over the last 36 months of a history (null without one) */
export function feeRange(h: HistX | null | undefined, n = 36): [number, number] | null {
  const xs = (h?.fee ?? []).slice(-n).filter((x): x is number => x != null && Number.isFinite(x));
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

/** one track's row of the document, as shown today */
export function docRow(f: FundX, c: DocCtx): SnapRow {
  const ret = (p: 'y12' | 'a3' | 'a5') => (c.net ? f.net?.[p] ?? null : f[p] ?? null);
  const y = c.hist ? (c.net ? netSeries(c.hist).y : c.hist.y) : null;
  const s = y ? stats(y, 60) : null;
  const pen = isPension(f), old = isOldGen(f);
  const d = pen && c.dfile !== undefined ? defaultNow(f.k, c.dfile, c.asof) : null;
  const sv = pen && c.dec !== undefined ? svcOf(c.dec, f.grp, 'pension') : null;
  return {
    k: f.k, name: f.name, prod: f.prod, track: f.track, id: f.id ?? null, mgr: f.mgr ?? '', grp: f.grp, pen, old,
    y12: ret('y12'), a3: ret('a3'), a5: ret('a5'), a3g: f.a3 ?? null, fee: f.fee ?? null, depfee: f.depfee ?? null,
    sharpe: f.sd != null && f.sd > 0 && !selfDirected(f) ? f.sharpe ?? null : null, sd: f.sd ?? null,
    mdd: s && s.months >= 60 ? s.dd : null, st: f.st ?? null, act: pen ? f.act ?? null : null, act_p: pen ? f.act_p ?? null : null,
    dflt: !pen || c.dfile === undefined ? undefined : d ? { t: periodText(d.t), depfee: d.depfee, fee: d.fee } : null,
    svc: !pen || c.dec === undefined ? undefined : sv ? { total: sv.total, rank: sv.rank, of: sv.of } : null,
    clm: !pen || c.dec === undefined ? undefined : companyOf(c.dec, f.grp)?.claims?.disability.approved ?? null,
    feeRange: old ? feeRange(c.hist) : null,
  };
}

/** a left-to-right run inside a Hebrew cell, isolated so its order holds (LRI … PDI) */
const LTR = (x: string) => `\u2066${x}\u2069`;
const pct = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${nf(v, d)}%`);
const spct = (v: number | null | undefined, d = 1) => (v == null ? '–' : `${sn(v, d)}%`);

/** a cell of the document: the figure and a second, smaller line */
export interface DocCell { t: string; q?: string }
export interface DocMetric { key: string; label: string; fn: number; pen?: boolean; cell: (r: SnapRow, asof: number) => DocCell }
/** the metrics, top to bottom, with the note each one cites (the numbers match the notes list of the document) */
export const DOC_METRICS: DocMetric[] = [
  { key: 'y12', label: 'LTM', fn: 1, cell: (r) => ({ t: spct(r.y12) }) },
  { key: 'a3', label: '3Y, שנתי', fn: 1, cell: (r) => ({ t: spct(r.a3) }) },
  { key: 'a5', label: '5Y, שנתי', fn: 1, cell: (r) => ({ t: spct(r.a5) }) },
  { key: 'fee', label: 'ד"נ מצבירה', fn: 2, cell: (r) => (r.old ? { t: pct(r.fee), q: r.feeRange && r.feeRange[0] !== r.feeRange[1] ? `משתנים: ${LTR(`${pct(r.feeRange[0])}–${pct(r.feeRange[1])}`)} ב-36 ח׳` : 'משתנים (השתתפות ברווחים)' } : { t: pct(r.fee) }) },
  { key: 'depfee', label: 'ד"נ מהפקדה', fn: 2, cell: (r) => ({ t: pct(r.depfee) }) },
  { key: 'sharpe', label: 'שארפ (הרשות)', fn: 3, cell: (r) => ({ t: r.sharpe == null ? '–' : nf(r.sharpe, 2) }) },
  { key: 'sd', label: 'סטיית תקן (הרשות)', fn: 3, cell: (r) => ({ t: r.sd == null ? '–' : nf(r.sd, 2) }) },
  { key: 'mdd', label: 'ירידה מרבית, 60 ח׳', fn: 4, cell: (r) => ({ t: spct(r.mdd) }) },
  { key: 'st', label: 'חשיפה למניות', fn: 5, cell: (r) => ({ t: r.st == null ? '–' : `${nf(r.st, 0)}%` }) },
  { key: 'act', label: 'איזון אקטוארי', fn: 6, pen: true, cell: (r, asof) => (!r.pen ? { t: '–' } : r.act == null ? { t: 'לא דווח' } : { t: spct(r.act, 2), q: ym(r.act_p ?? asof) }) },
  { key: 'dflt', label: 'קרן ברירת מחדל', fn: 7, pen: true, cell: (r) => (!r.pen ? { t: '–' } : r.dflt ? { t: `כן · ${LTR(r.dflt.t)}`, q: LTR(`${pct(r.dflt.depfee)} / ${pct(r.dflt.fee)}`) } : r.dflt === null ? { t: 'לא' } : { t: '–' }) },
  { key: 'svc', label: 'מדד השירות 2025', fn: 8, pen: true, cell: (r) => (!r.pen ? { t: '–' } : r.svc ? { t: String(r.svc.total), q: `מקום ${r.svc.rank} מתוך ${r.svc.of}` } : r.svc === null ? { t: 'לא במדד' } : { t: '–' }) },
  { key: 'clm', label: 'תביעות נכות שאושרו', fn: 9, pen: true, cell: (r) => (!r.pen ? { t: '–' } : r.clm != null ? { t: `${nf(r.clm, 1)}%`, q: 'דיווח החברה' } : r.clm === null ? { t: 'לא פורסם' } : { t: '–' }) },
];
/** the metrics a set of rows shows (the pension rows only when a pension track is in it) */
export const metricsOf = (rows: Pick<SnapRow, 'pen'>[]) => DOC_METRICS.filter((m) => !m.pen || rows.some((r) => r.pen));

/** the tracks in pages of at most `per`, as even as they come (5 → 3 + 2, 8 → 4 + 4) */
export function pagesOf<T>(xs: T[], per = 4): T[][] {
  if (!xs.length) return [];
  const n = Math.ceil(xs.length / per), size = Math.ceil(xs.length / n);
  return Array.from({ length: n }, (_, i) => xs.slice(i * size, (i + 1) * size)).filter((p) => p.length);
}

/** the input of the bottom line from document rows */
export const cmpOf = (r: SnapRow): CmpIn => ({ k: r.k, name: r.name, prod: r.prod, track: r.track, cat: catKey(r), fee: r.fee, depfee: r.depfee, r5: r.a5, sharpe: r.sharpe, st: r.st, old: r.old });

/** The bottom line in sentences: per category with two tracks or more, the lowest fees, the highest 5Y (tie band) and the highest
 *  Sharpe among the tracks chosen; across categories, a sentence that says why nothing is compared; old-generation policies, kept out. */
export function bottomLines(rows: SnapRow[], net: boolean): string[] {
  const sum = compareSummary(rows.map(cmpOf));
  const nameOf = (k: string) => rows.find((r) => r.k === k)?.name ?? k;
  const lbl = net ? 'נטו, אומדן' : 'ברוטו';
  const miss = (n: number) => (n === 1 ? 'למסלול אחד אין נתון' : `ל-${n} מסלולים אין נתון`);
  const line = (l: Lead | null, what: string, v: string, extra = '') => (!l ? null
    : l.all ? `${what}: אין הבדל בין ${l.of} המסלולים (${v}).`
    : `${what}: ${l.ks.map(nameOf).join(' ו')}${l.ks.length > 1 ? ' (צמודים)' : ''}, ${v}${extra}${l.missing.length ? `; ${miss(l.missing.length)}` : ''}.`);
  const out: string[] = [];
  if (sum.old) out.push(`${OLD_HE}.`);
  if (sum.cross) {
    const st = sum.stRange ? ` החשיפה למניות של המסלולים: ${nf(sum.stRange[0], 0)}%–${nf(sum.stRange[1], 0)}%.` : '';
    out.push(`${CROSS_HE}.${st}`);
  }
  for (const c of sum.cats) {
    const pre = sum.cross || sum.cats.length > 1 ? `באותה קטגוריה (${c.label}): ` : '';
    const ls = [
      line(c.fee, LEAD_HE.fee, pct(c.fee?.v)),
      line(c.depfee, LEAD_HE.depfee, pct(c.depfee?.v)),
      line(c.r5, `${LEAD_HE.r5} (${lbl})`, spct(c.r5?.v), c.r5?.gap != null ? `; הפער מהתשואה הבאה: ${nf(c.r5.gap * 100, 0)} נ"ב לשנה` : ''),
      line(c.sharpe, LEAD_HE.sharpe, c.sharpe ? nf(c.sharpe.v, 2) : '–'),
    ].filter((x): x is string => !!x);
    ls.forEach((t) => out.push(pre + t));
  }
  if (!sum.cats.length && !sum.cross && !sum.old) out.push('אין שני מסלולים עם נתון להשוואה.');
  return out;
}
/** the caption under the bottom line */
export const BOTTOM_CAP = `תיאור עובדתי של נתוני העבר, לא המלצה ולא תחזית. השוואה רק בין מסלולים מאותה קטגוריה (אותו מוצר ואותו מסלול השקעה). ${TIE_NOTE}.`;

/** the folder's snapshot: the rows and the bottom line as shown, the day they were saved and the data month */
export const snapOf = (rows: SnapRow[], bottom: string[], at: string, asof: number, b: 'net' | 'gross'): Snap => ({ at, asof, b, rows: rows.map((r) => ({ ...r })), bottom: [...bottom] });

/** what changed for one track between the snapshot and today: every document figure whose text differs */
export function snapDiff(then: SnapRow, now: SnapRow, asof: number): { label: string; then: string; now: string }[] {
  return DOC_METRICS.filter((m) => !m.pen || then.pen).map((m) => ({ label: m.label, then: m.cell(then, asof).t, now: m.cell(now, asof).t })).filter((x) => x.then !== x.now);
}
/** a source's address as a short title on paper: the host and the file's name, decoded (never a %-encoded string) */
export function shortUrl(u: string): string {
  try { const x = new URL(u); const f = decodeURIComponent(x.pathname.split('/').filter(Boolean).pop() ?? ''); return `${x.hostname.replace(/^www\./, '')}${f ? ` › ${f.length > 48 ? f.slice(0, 46) + '…' : f}` : ''}`; } catch { return u; }
}
/** "02.11.2026" */
export const dmyIso = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
