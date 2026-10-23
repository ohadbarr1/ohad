import { NoteMark } from '../components/NoteMark';  // lane F
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, IncChip, Loading, Panel, Seg } from '../components/ui';
import { CompanyStore, shiftYear } from '../lib/company';
import { foxOption } from '../lib/foxchart';
import { byPeriodDesc, cls, dateLabel, nf, pct, periodLabel, pubLabel } from '../lib/format';
import { chartBase, palette } from '../lib/theme';
import { useCompanyDocs, useCompanyStore, useIfrsData, useIfrsFactsOf, useLoad, useRegistry } from '../lib/useData';
import type { DocEntry, IfrsData, IfrsFact } from '../lib/types';
import { tag, type Reports, type RF } from '../lib/csm';
import { CSM_BASIS_HE, resolveCsm, type CsmClose } from '../lib/csmResolve';
import { Sourced } from '../components/Source';
import { useSource, type Prov } from '../lib/prov';
import { bareUrl, calc, docOf, factPeriod, report } from './companyProv';
import { useWindowParam, type Win } from '../lib/period';
import { usePhone } from '../lib/useMedia';
import { ContextBar, Sheet } from '../components/Sheet';
import '../styles/reportday.css';

const PL = 'X.רווח_והפסד', BS = 'X.מאזן', OCI = 'X.רווח_כולל';
const QE = ['03-31', '06-30', '09-30', '12-31'];
export const YTD: Record<string, string> = { '03-31': 'Q', '06-30': 'H', '09-30': '9M', '12-31': 'FY' };

/** Quarter ends: shift by `k` quarters; a report is named like the extracted IFRS files ("2026Q2", "2025FY"). */
export function qShift(end: string, k: number): string { const n = Number(end.slice(0, 4)) * 4 + QE.indexOf(end.slice(5)) + k; return `${Math.floor(n / 4)}-${QE[n % 4]}`; }
export const keyOf = (end: string): string => `${end.slice(0, 4)}${end.endsWith('12-31') ? 'FY' : `Q${QE.indexOf(end.slice(5)) + 1}`}`;
export const endOf = (p: string): string => `${p.slice(0, 4)}-${p.endsWith('FY') ? '12-31' : QE[Number(p.slice(5)) - 1]}`;
const repName = (p: string): string => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);

type Unit = 'k' | 'm' | 'nis' | 'pct';
/** One printed (or derived) figure with the page it opens. Statement figures are NIS thousands, extracted IFRS facts NIS millions. */
export interface Fig { v: number; unit: Unit; href: string | null; page: number | null; der?: boolean; std?: '17' | '4'; late?: string; tip?: string;
  /** bare address and name of the document, the period the figure covers when it is not the column's, and what a computed figure is made of */
  url?: string | null; doc?: string; period?: string; calc?: { formula: string; parts: { label: string; fig: Fig }[] } }

/** Labels differ between filers in brackets, stray spaces and "(הפסד)": compare without them. */
export const clean = (s: string): string => s.replace(/\(ביאור[^)]*\)/g, ' ').replace(/[()*:]/g, ' ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
/** "to the company's shareholders", in the wordings the filers print: בעלי המניות של החברה, לבעלים של החברה, בעלים של חברת האם, בעלי מניות של החברה האם */
const ATTR = /^ל?בעלי(?:ם| ה?מניות) של (?:ה?חברה(?: ה?אם)?|חברת ה?אם)$/;

interface Line { mi: number; label: string; raw: string; std: '17' | '4'; total: boolean; unit: string; attr: 'net' | 'comp' | null; below: boolean }
/** Value rows of a statement in print order, each tagged with its standard section. An "attributable to shareholders" row belongs to the total above it
    (profit or comprehensive income); `below` marks everything under the bottom line of the P&L (attribution, per share, other comprehensive income). */
export function linesOf(store: CompanyStore, sheet: string): Line[] {
  const out: Line[] = [];
  let seg = -1, lastTotal = '', below = false;
  for (const mi of store.metricsBySheet.get(sheet) ?? []) {
    const m = store.d.metrics[mi], label = clean(m.label);
    if (m.std) { seg++; lastTotal = ''; below = false; continue; }
    if (/כולל|מיוחס|למניה/.test(label) || ATTR.test(label)) below = true;
    // a heading "רווח נקי לתקופה מיוחס ל:" / "רווח כולל מיוחס ל:" / "ייחוס הרווח הכולל:" says which total the attribution rows under it split
    if (m.header && /מיוחס|ייחוס/.test(label) && /רווח|הפסד/.test(label)) lastTotal = label;
    if (m.header) continue;
    out.push({ mi, label, raw: m.label, std: seg > 0 ? '4' : '17', total: !!m.total, unit: m.unit, attr: ATTR.test(label) ? (lastTotal.includes('כולל') ? 'comp' : 'net') : null, below });
    if (m.total && /רווח|הפסד/.test(label)) lastTotal = label;
  }
  return out;
}

/* The headline lines, found by role. `re` is tested on the cleaned label; `attr` picks the shareholders' row under the profit or comprehensive-income total.
   `alt` is used only by a filer that prints no such row at all, and is named on the page. */
interface Role { key: string; label: string; sheets: string[]; flow: boolean; re?: RegExp; attr?: 'net' | 'comp'; alt?: RegExp; altChip?: string; altNote?: string }
export const ROLES: Role[] = [
  { key: 'rev', label: 'הכנסות משירותי ביטוח', sheets: [PL], flow: true, re: /^הכנסות משירותי ביטוח$/ },
  { key: 'isr', label: 'רווח משירותי ביטוח', sheets: [PL], flow: true, re: /^רווח(?: הפסד)? משירותי ביטוח$/ },
  { key: 'inv', label: 'רווח מהשקעות ומימון, נטו', sheets: [PL], flow: true, re: /^רווח(?: הפסד)? מהשקעות ומימון, ?נטו$/ },
  { key: 'pbt', label: 'רווח לפני מס', sheets: [PL], flow: true, re: /^(?:רווח|הפסד)(?: הפסד)? לפני מסים על ה?הכנסה$/ },
  { key: 'net', label: 'רווח נקי לבעלי המניות', sheets: [PL], flow: true, attr: 'net', alt: /^(?:רווח|הפסד)(?: הפסד)?(?: נקי(?: לתקופה)?| לתקופה)$/, altChip: 'שורת רווח לתקופה', altNote: 'אין בדוח שורת ייחוס לבעלי המניות; מוצגת שורת הרווח לתקופה' },
  { key: 'comp', label: 'רווח כולל לבעלי המניות', sheets: [OCI, PL], flow: true, attr: 'comp', alt: /^(?:סך(?: ה?כל)? |סה['"׳״]{1,2}כ )?ה?רווח(?: ה?הפסד)? ה?כולל(?: לתקופה)?$/, altChip: 'שורת סך הרווח הכולל', altNote: 'אין בדוח שורת ייחוס לבעלי המניות; מוצגת שורת סך הרווח הכולל' },
  { key: 'eq', label: 'הון לבעלי המניות', sheets: [BS], flow: false, re: /^סך(?: ה?כל)? ה?הון המיוחס לבעלי(?:ם| ה?מניות) של החברה$/ },
  { key: 'assets', label: 'סך הנכסים', sheets: [BS], flow: false, re: /^(?:סך ה?כל|סה['"׳״]{1,2}כ) ה?נכסים$/ },
];

export interface Resolved { role: Role; rows: Line[]; alt: boolean }
export function resolve(store: CompanyStore, role: Role, forceAlt = false): Resolved {
  const all = role.sheets.flatMap((s) => linesOf(store, s));
  const pick = (f: (l: Line) => boolean) => [...all.filter((l) => l.std === '17' && f(l)), ...all.filter((l) => l.std === '4' && f(l))];
  const rows = forceAlt ? [] : pick((l) => (role.attr ? l.attr === role.attr : role.re!.test(l.label)));
  return rows.length || !role.alt ? { role, rows, alt: false } : { role, rows: pick((l) => role.alt!.test(l.label)), alt: true };
}

type Late = (u: number | null | undefined) => string | undefined;
/** The first of the candidate rows that carries a figure for the period: a line whose wording changed over the years sits in several rows. */
export function figAt(store: CompanyStore, rows: Line[], type: string, end: string, late?: Late): Fig | null {
  const pi = store.periodIndex(type, end);
  if (pi < 0) return null;
  for (const l of rows) {
    const f = store.byMetric.get(l.mi)?.get(pi);
    if (f) { const url = bareUrl(store, 'F', f.u); return { v: f.v, unit: l.unit as Unit, href: store.sourceUrl('F', f.page, f.u), page: f.page, der: f.der, std: f.old ? '4' : l.std, late: late?.(f.u), tip: f.der ? 'נגזר מהנתונים המצטברים (Q4 = FY פחות 9M)' : undefined, url, doc: docOf(store, 'F', url) }; }
  }
  return null;
}
/** Trailing twelve months: the annual figure as printed at a year end, otherwise the sum of four quarters under one standard (derived). */
export function ltmAt(store: CompanyStore, rows: Line[], end: string): Fig | null {
  if (end.endsWith('12-31')) { const fy = figAt(store, rows, 'FY', end); if (fy) return fy; }
  const ends = [0, -1, -2, -3].map((k) => qShift(end, k)), qs = ends.map((e) => figAt(store, rows, 'Q', e));
  if (qs.some((q) => !q) || new Set(qs.map((q) => q!.std)).size > 1) return null;
  const parts = ends.map((e, i) => ({ label: periodLabel('Q', e), fig: qs[i]! }));
  return { v: qs.reduce((s, q) => s + q!.v, 0), unit: qs[0]!.unit, href: qs[0]!.href, page: qs[0]!.page, der: true, std: qs[0]!.std, tip: `נגזר: ${ends.reverse().map((e) => periodLabel('Q', e)).join(' + ')}`,
    calc: { formula: `LTM = ${parts.map((x) => x.label).join(' + ')}`, parts } };
}

export interface HeadRow { key: string; label: string; note?: [string, string]; chips?: string[]; fact?: IfrsFact; cur: Fig | null; yoy: Fig | null; qoq: Fig | null; ltm: Fig | null; ltmPrev: Fig | null }
/** One flow line at a quarter end in a window: the quarter, the cumulative column the report prints (H1, 9M, FY), or the trailing twelve months. */
export function flowAt(store: CompanyStore, rows: Line[], end: string, win: Win, late?: Late): Fig | null {
  return win === 'ltm' ? ltmAt(store, rows, end) : figAt(store, rows, win === 'q' ? 'Q' : YTD[end.slice(5)], end, late);
}
/** The statement half of the headline table. `win` is the quarter alone, the cumulative column the report prints (H1, 9M, FY), or the trailing twelve
    months (then the comparisons are LTM against LTM and the separate LTM column is empty). */
export function headline(store: CompanyStore, end: string, win: Win, late?: Late): { rows: HeadRow[]; missing: string[] } {
  if (win === 'ltm') return headlineLtm(store, end, late);
  const T = win === 'q' ? 'Q' : YTD[end.slice(5)], rows: HeadRow[] = [], missing: string[] = [];
  for (const role of ROLES) {
    let r = resolve(store, role);
    const t = role.flow ? T : 'I';
    let cur = figAt(store, r.rows, t, end, late);
    // attribution rows printed in earlier reports only (the filer stopped printing them): the bottom line of this report, named on the row
    if (!cur && !r.alt && role.alt) { const a = resolve(store, role, true); const c = figAt(store, a.rows, t, end, late); if (c) { r = a; cur = c; } }
    if (!cur) { missing.push(role.label); continue; }
    rows.push({
      key: role.key, label: role.label, note: r.alt ? [role.altChip ?? '', role.altNote ?? ''] : undefined, cur,
      yoy: figAt(store, r.rows, t, shiftYear(end, -1)),
      qoq: !role.flow ? figAt(store, r.rows, 'I', qShift(end, -1)) : T === 'Q' ? figAt(store, r.rows, 'Q', qShift(end, -1)) : null,
      ltm: role.flow ? ltmAt(store, r.rows, end) : null, ltmPrev: role.flow ? ltmAt(store, r.rows, shiftYear(end, -1)) : null,
    });
  }
  return { rows, missing };
}
function headlineLtm(store: CompanyStore, end: string, late?: Late): { rows: HeadRow[]; missing: string[] } {
  const rows: HeadRow[] = [], missing: string[] = [];
  for (const role of ROLES) {
    let r = resolve(store, role);
    const at = (e: string) => (role.flow ? ltmAt(store, r.rows, e) : figAt(store, r.rows, 'I', e, e === end ? late : undefined));
    let cur = at(end);
    if (!cur && !r.alt && role.alt) { const a = resolve(store, role, true); const c = role.flow ? ltmAt(store, a.rows, end) : null; if (c) { r = a; cur = c; } }
    if (!cur) { missing.push(role.label); continue; }
    rows.push({ key: role.key, label: role.label, note: r.alt ? [role.altChip ?? '', role.altNote ?? ''] : undefined, cur, yoy: at(shiftYear(end, -1)), qoq: at(qShift(end, -1)), ltm: null, ltmPrev: null });
  }
  return { rows, missing };
}

export interface Mover { label: string; cur: Fig; prev: Fig; d: number }
/** Lines of the P&L above the bottom line, totals left out, ranked by the change in NIS against the same window a year earlier.
    A plain income or expense line cannot change sign, and when insurance service expenses carry opposite signs in the two periods the two reports
    print expenses with opposite signs: such lines are not ranked (`skipped`), since their difference would be an artefact of presentation. */
export function movers(store: CompanyStore, end: string, win: Win): { up: Mover[]; down: Mover[]; skipped: string[] } {
  const lines = linesOf(store, PL).filter((l) => !l.below && !l.total && l.unit === 'k');
  const rank = (std: '17' | '4'): Mover[] => {
    const groups = new Map<string, Line[]>();
    lines.filter((l) => l.std === std).forEach((l) => groups.set(l.label, [...(groups.get(l.label) ?? []), l]));
    return [...groups.values()].flatMap((rows) => {
      const cur = flowAt(store, rows, end, win), prev = flowAt(store, rows, shiftYear(end, -1), win);
      return cur && prev && cur.std === prev.std ? [{ label: rows[0].raw, cur, prev, d: cur.v - prev.v }] : [];
    });
  };
  const all = rank('17'), list = all.length ? all : rank('4');
  const opp = (m: Mover) => m.cur.v * m.prev.v < 0, plain = (m: Mover) => /^(?:הוצאות|הכנסות) /.test(m.label) && !/נטו|[()]/.test(m.label);
  const flipped = list.some((m) => clean(m.label) === 'הוצאות משירותי ביטוח' && opp(m));
  const bad = (m: Mover) => opp(m) && (flipped || plain(m)), ok = list.filter((m) => !bad(m));
  return { up: ok.filter((m) => m.d > 0).sort((a, b) => b.d - a.d).slice(0, 5), down: ok.filter((m) => m.d < 0).sort((a, b) => a.d - b.d).slice(0, 5), skipped: list.filter(bad).map((m) => m.label) };
}

export interface Restated { sheet: string; std: string; line: string; period: string; unit: Unit; first: Fig; last: Fig; d: number; big: boolean }
/** Figures of earlier periods that the report ending at `end` printed with a different value. `big` is a change of 2% or more of the figure first reported. */
export function restatedBy(store: CompanyStore, end: string): Restated[] {
  const unitOf = new Map(store.d.metrics.map((m) => [`${m.sheet}|${m.label}`, m.unit] as [string, string]));
  return (store.d.restated ?? []).filter((r) => r[11] === end).map(([sheet, std, line, type, pe, v0, p0, u0, v1, p1, u1]) => {
    const unit = (unitOf.get(`${sheet}|${line}`) ?? (/למניה/.test(line) ? 'nis' : 'k')) as Unit;
    const fig = (v: number, page: number | null, u: number | null): Fig => { const url = u != null ? store.d.urls?.[u] ?? null : null; return { v, unit, href: store.sourceUrl('F', page, u), page, url, doc: docOf(store, 'F', url) }; };
    return { sheet, std, line, period: periodLabel(type, pe), unit, first: fig(v0, p0, u0), last: fig(v1, p1, u1), d: v1 - v0, big: v0 === 0 || Math.abs(v1 - v0) / Math.abs(v0) >= 0.02 };
  }).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
}

/** Reports the statements were read from: every quarter end with a quarterly P&L column, newest first. */
export function reportsOf(store: CompanyStore): string[] {
  const ends = new Set<string>();
  for (const mi of store.metricsBySheet.get(PL) ?? []) store.byMetric.get(mi)?.forEach((_, pi) => { const p = store.period(pi); if (p.type === 'Q' && QE.includes(p.end.slice(5))) ends.add(p.end); });
  return [...ends].map(keyOf).sort(byPeriodDesc);
}

/* ---------- extracted IFRS 17 facts: CSM and solvency, only as the report prints them ---------- */
interface Pool { fs: IfrsFact[]; url: string | null; name?: string }
function ifrsAt(pools: Pool[], pred: (f: IfrsFact) => boolean, d: string, unit: Unit): { fig: Fig; f: IfrsFact; n: number } | null {
  for (const p of pools) {
    const hits = p.fs.filter((f) => pred(f) && f.w === 'instant' && f.d === d);
    if (!hits.length) continue;
    const f = hits[0], url = f.u !== undefined ? f.u : p.url;
    return { fig: { v: f.v, unit, href: url && f.pg != null ? `${url}#page=${f.pg}` : null, page: f.pg, url: url ?? null, doc: f.u !== undefined ? `מצגת ${p.name ?? ''}`.trim() : p.name ? `דוח ${p.name}` : undefined, period: factPeriod(f), tip: f.src === 'chart' ? 'נקרא מגרף' : f.src === 'text' ? 'נקרא מטקסט הדוח' : undefined }, f, n: new Set(hits.map((x) => x.v)).size };
  }
  return null;
}
/** A comparative is used only when the report gives one value for it. */
const one = (x: ReturnType<typeof ifrsAt>): Fig | null => (x && x.n === 1 ? x.fig : null);
/** A resolved CSM balance (csmResolve) as a figure of the table: the printed row, or life plus health added. */
function csmFig(c: CsmClose | null, files: IfrsData['files']): Fig | null {
  if (!c) return null;
  const one = (f: RF): Fig => {
    const url = f.u !== undefined ? f.u : files.find((x) => x.company === f.c && x.period === f.rp)?.url ?? null;
    return { v: Math.abs(f.dv ?? f.v), unit: 'm', href: url && f.pg != null ? `${url}#page=${f.pg}` : null, page: f.pg, url, doc: f.u !== undefined ? `מצגת ${repName(f.rp)}` : `דוח ${repName(f.rp)}`, period: factPeriod(f),
      tip: [c.label, f.src === 'chart' ? 'נקרא מגרף' : f.src === 'text' ? 'נקרא מטקסט הדוח' : '', f.cl === 1 ? 'הסכום שהודפס פחות שורת פוליסות ההשקעה' : ''].filter(Boolean).join(' · ') };
  };
  if (!c.line.sum) return { ...one(c.line.fs[0]), v: c.v, der: !!(c.flags & 1) };
  return { v: c.v, unit: 'm', href: null, page: null, der: true, tip: c.label, calc: { formula: `חיים ועוד בריאות, ${CSM_BASIS_HE[c.b]}`, parts: c.line.fs.map((f) => ({ label: f.g === 'life' ? 'חיים וחיסכון' : 'בריאות', fig: one(f) })) } };
}
export function ifrsRows(cur: Pool, prev: Pool | null, end: string, rs: Reports | null, files: IfrsData['files']): HeadRow[] {
  const rows: HeadRow[] = [], both = prev ? [cur, prev] : [cur];
  // CSM: the one rule every page uses (net of reinsurance, group level, never savings-policy future profit; fallbacks labelled)
  const c = rs ? resolveCsm(rs, end) : null;
  if (c) {
    rows.push({ key: 'csm', label: 'CSM, יתרת סגירה', chips: [c.label], fact: c.line.fs.length === 1 ? c.line.fs[0] : undefined, cur: csmFig(c, files),
      yoy: csmFig(resolveCsm(rs!, shiftYear(end, -1)), files), qoq: csmFig(resolveCsm(rs!, qShift(end, -1)), files), ltm: null, ltmPrev: null });
  }
  // solvency is published with a lag: the latest date the report gives, named on the row
  const M = 'solvency_ratio_with_transitional', at = cur.fs.filter((f) => f.m === M && f.w === 'instant' && f.d <= end).map((f) => f.d).sort().pop();
  if (at) {
    const s0 = cur.fs.find((f) => f.m === M && f.w === 'instant' && f.d === at)!.s, is = (f: IfrsFact) => f.m === M && f.s === s0, c = ifrsAt([cur], is, at, 'pct')!;
    rows.push({ key: 'solv', label: 'יחס כושר פירעון, עם הוראות מעבר', chips: [at !== end ? `ליום ${dateLabel(at)}` : '', c.f.src === 'text' ? 'אומדן מהטקסט' : '', c.n > 1 ? `${c.n} ערכים` : ''].filter(Boolean), cur: c.fig,
      yoy: c.n > 1 ? null : one(ifrsAt([cur], is, shiftYear(at, -1), 'pct')), qoq: c.n > 1 || !QE.includes(at.slice(5)) ? null : one(ifrsAt(both, is, qShift(at, -1), 'pct')), ltm: null, ltmPrev: null });
  }
  return rows;
}

/* ---------- figures ---------- */
const scaled = (v: number, unit: Unit): number => (unit === 'k' ? v / 1e3 : v);
const fmt = (v: number, unit: Unit): string => nf(scaled(v, unit), unit === 'nis' ? 2 : 1) + (unit === 'pct' ? '%' : '');
/** signed, without a "−0.0" */
const signed = (x: number, d = 1): string => { const r = Number(x.toFixed(d)) || 0; return (r > 0 ? '+' : '') + nf(r, d); };

const unitTxt = (u: Unit): string => (u === 'pct' ? '%' : u === 'nis' ? 'ש"ח' : 'מיליוני ש"ח');
/** Where a figure of the table comes from: a printed one opens its page; a trailing twelve months lists its four quarters. */
export function figProv(f: Fig, title: string, period: string, note?: string): Prov {
  const value = fmt(f.v, f.unit);
  if (f.calc) return calc(`${title} · ${period}`, value, f.calc.formula, f.calc.parts.map((x) => ({ label: x.label, v: fmt(x.fig.v, x.fig.unit), src: () => figProv(x.fig, title, x.label) })), unitTxt(f.unit));
  return report({ title, value, unit: unitTxt(f.unit), url: f.url ?? null, pg: f.page, doc: f.doc, period: f.period ?? period, der: f.der, old: f.std === '4',
    note: [note, f.late ? `כפי שהודפס מחדש בדוח ${f.late}` : '', f.tip && !f.der ? f.tip : ''].filter(Boolean).join(' · ') || undefined });
}

function V({ f, t, p, note, className = '' }: { f: Fig | null; t: string; p: string; note?: string; className?: string }) {
  if (!f) return <span className="muted">–</span>;
  const c = `num ${f.der ? 'der' : ''} ${f.v < 0 ? 'neg' : ''} ${className}`;
  const tip = [f.tip, f.std === '4' ? 'IFRS 4' : '', f.page != null ? `עמ׳ ${f.page}` : ''].filter(Boolean).join(' · ');
  return <Sourced src={() => figProv(f, t, p, note)} href={f.calc ? null : f.href} title={tip || undefined}><span className={c}>{fmt(f.v, f.unit)}</span></Sourced>;
}
/** A percent only between two positive figures; otherwise the difference in the row's unit. Never a percent from or to a loss, never across standards. */
function Delta({ a, b, t, la, lb }: { a: Fig | null; b: Fig | null; t: string; la: string; lb: string }) {
  if (!a || !b) return null;
  if (a.std && b.std && a.std !== b.std) return <span className="rd-d muted" title="הנתונים נמדדו לפי תקנים שונים (IFRS 17 מול IFRS 4) ואינם בני השוואה">תקן שונה</span>;
  let txt: string, cl: string, title: string | undefined, formula: string, u: string = '%';
  if (a.unit === 'pct') { const x = a.v - b.v; txt = `${signed(x)} נק׳`; cl = cls(Number(x.toFixed(1)) || null); formula = `${la} − ${lb} (נק׳)`; u = 'נק׳'; }
  else if (a.v > 0 && b.v > 0) {
    const x = (a.v / b.v - 1) * 100;
    // beyond a tripling a percentage stops informing: show the multiple
    txt = x > 300 ? `×${nf(a.v / b.v, 1)}` : pct(Number(x.toFixed(1)) || 0, 1, true); cl = cls(Number(x.toFixed(1)) || null); formula = `${la} ÷ ${lb} − 1`;
  } else {
    const x = scaled(a.v - b.v, a.unit), dec = a.unit === 'nis' ? 2 : 1;
    txt = `${signed(x, dec)}${a.unit === 'nis' ? '' : ' מ׳'}`; cl = cls(Number(x.toFixed(dec)) || null); title = a.unit === 'nis' ? 'הפרש בש"ח' : 'הפרש במיליוני ש"ח: אחד הנתונים אינו חיובי'; formula = `${la} − ${lb}`; u = unitTxt(a.unit);
  }
  const src = () => calc(`${t} · ${la} מול ${lb}`, txt, formula, [[a, la], [b, lb]].map(([f, l]) => ({ label: l as string, v: fmt((f as Fig).v, (f as Fig).unit), src: () => figProv(f as Fig, t, l as string) })), u);
  return <Sourced src={src}><span className={`rd-d num ${cl}`} title={title}>{txt}</span></Sourced>;
}
/** A comparison cell: the change, and under it the figure it is measured against (for LTM, the trailing figure itself). */
function Cell({ h, base, a, b, main, t, la, lb, bp }: { h: string; base: Fig | null; a: Fig | null; b: Fig | null; main?: boolean; t: string; la: string; lb: string; bp: string }) {
  return <div className={`rd-c ${main ? 'rd-main' : ''}`} role="cell" data-h={h}>{base ? <><Delta a={a} b={b} t={t} la={la} lb={lb} /><span className="rd-base"><V f={base} t={t} p={bp} /></span></> : <span className="muted">–</span>}</div>;
}

/** Report day: what one report printed, against a year earlier and the previous quarter, and what it restated in earlier periods. Every figure opens its page. */
export function ReportDay({ card }: { card?: ReactNode }) {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const reg = useRegistry();
  const entry = reg.data?.find((c) => c.id === id) ?? null;
  const { store, error } = useCompanyStore(id || null, !!entry?.has_financials);
  const docs = useCompanyDocs(id || null, !!entry);
  const ifrs = useIfrsData();
  // the window is in the address (?w=), shared with the KPI ledger below and the statement tabs
  const [win, setWin] = useWindowParam();
  const phone = usePhone();
  const [pickers, setPickers] = useState(false);
  const [thr, setThr] = useState<'big' | 'all'>('big');
  const { open: openSrc } = useSource();

  const reports = useMemo(() => (store ? reportsOf(store) : []), [store]);
  const P = reports.includes(sp.get('p') ?? '') ? (sp.get('p') as string) : reports[0] ?? '';
  const end = P ? endOf(P) : '', annual = P.endsWith('FY'), first = end.endsWith('03-31');
  // an annual report opens on the year, an interim report on the quarter; a first quarter's year to date is the quarter
  const W: Win = win === 'ltm' ? 'ltm' : first ? 'q' : win || (annual ? 'ytd' : 'q');
  const T = W === 'ytd' ? YTD[end.slice(5)] ?? 'Q' : 'Q', L = W === 'ltm' ? 'LTM ' : '';

  // the filing itself: the Hebrew periodic report of that period, preferring the file the figures were read from
  const doc = useMemo(() => {
    const mine = (docs.data?.docs ?? []).filter((x: DocEntry) => (x.type === 'quarterly' || x.type === 'annual') && !x.en && x.period === P);
    return mine.find((x) => store?.d.urls?.includes(x.url)) ?? mine[0] ?? null;
  }, [docs.data, store, P]);
  // a figure read from a report later than the one on screen is the reprinted value, and says so
  const late = useMemo<Late>(() => {
    const at = new Map((docs.data?.docs ?? []).filter((x) => /^\d{4}(Q[1-3]|FY)$/.test(x.period)).map((x) => [x.url, x.period] as [string, string]));
    return (u) => { const p = u != null ? at.get(store?.d.urls?.[u] ?? '') : undefined; return p && endOf(p) > end ? repName(p) : undefined; };
  }, [docs.data, store, end]);

  const head = useMemo(() => (store && end ? headline(store, end, W, late) : { rows: [], missing: [] }), [store, end, W, late]);
  const moved = useMemo(() => (store && end ? movers(store, end, W) : { up: [], down: [], skipped: [] }), [store, end, W]);
  const rest = useMemo(() => (store && end ? restatedBy(store, end) : []), [store, end]);

  const files = useMemo(() => (ifrs.data?.files ?? []).filter((f) => f.company === id), [ifrs.data, id]);
  const PP = P ? keyOf(qShift(end, -1)) : '';
  const ledger = useLoad<{ files: IfrsData['files']; reports: Record<string, IfrsFact[]> }>(files.length ? `csm/facts/${id}.json` : null);
  const curF = useIfrsFactsOf(id, files.some((f) => f.period === P) ? P : null), prevF = useIfrsFactsOf(id, files.some((f) => f.period === PP) ? PP : null);
  const extra = useMemo(() => {
    if (!curF.data) return [];
    const pool = (fs: IfrsFact[], p: string): Pool => ({ fs: fs.filter((f) => f.c === id && !f.tr && !f.model && !f.bk), url: files.find((f) => f.period === p)?.url ?? null, name: repName(p) });
    const rs: Reports | null = ledger.data ? Object.keys(ledger.data.reports).map((p) => ({ p, F: tag(ledger.data!.reports[p].filter((f) => f.c === id), p) })).filter((r) => r.F.length) : null;
    return ifrsRows(pool(curF.data, P), prevF.data ? pool(prevF.data, PP) : null, end, rs, ledger.data?.files ?? files);
  }, [curF.data, prevF.data, files, id, P, PP, end, ledger.data]);

  if (reg.error) return <ErrorBox what="רשימת החברות" error={reg.error} />;
  if (!reg.data) return <Loading what="חברה" />;
  if (!entry) return <Empty title="החברה לא נמצאה">בדוק את הכתובת או חפש בשורת החיפוש.</Empty>;
  if (error) return <ErrorBox what="נתוני החברה" error={error} />;
  if (!entry.has_financials) return <Empty title="הנתונים מהדוחות טרם חולצו">{entry.docs > 0 && <Link to={`/company/${id}/filings`}>{entry.docs} מסמכי מקור</Link>}</Empty>;
  if (!store) return <Loading what="יום הדוח" />;
  if (!P) return <Empty title="אין דוחות רבעוניים בנתוני החברה" />;

  const rows = [...head.rows, ...extra];
  const curL = L + periodLabel(T, end), yoyL = L + periodLabel(T, shiftYear(end, -1)), qoqL = L + repName(keyOf(qShift(end, -1))).replace('FY', 'Q4');
  const winOpts: [Win, string][] = [['q', periodLabel('Q', end)], ...(!first ? [['ytd', periodLabel(YTD[end.slice(5)], end)] as [Win, string]] : []), ['ltm', 'LTM']];
  const ltmW = W === 'ltm';
  const bySheet = [...new Set(rest.map((r) => r.sheet))].map((s) => ({ s, title: store.d.sheets.find((x) => x.code === s)?.title ?? s, all: rest.filter((r) => r.sheet === s).length, big: rest.filter((r) => r.sheet === s && r.big).length }));
  const nBig = rest.filter((r) => r.big).length, shown = thr === 'big' ? rest.filter((r) => r.big) : rest;
  const restDiff = (r: Restated, txt: string, formula: string, u: string): Prov => calc(`${r.line} · ${r.period} · הוצג מחדש`, txt, formula,
    [{ label: 'כפי שדווח אז', v: fmt(r.first.v, r.unit), src: () => figProv(r.first, r.line, r.period, 'כפי שדווח אז') }, { label: `כפי שהוצג מחדש (${repName(P)})`, v: fmt(r.last.v, r.unit), src: () => figProv(r.last, r.line, r.period, `כפי שהוצג מחדש בדוח ${repName(P)}`) }], u);
  const pick = (p: string) => { const n = new URLSearchParams(sp); n.set('p', p); setSp(n, { replace: true }); };

  // twelve quarters ending at the reported one, which is drawn in the accent colour; lighter marks are derived (Q4) or IFRS 4 figures
  const qEnds = Array.from({ length: 12 }, (_, i) => qShift(end, i - 11));
  const netRows = resolve(store, ROLES[4]).rows, isrRows = resolve(store, ROLES[1]).rows;
  const netQ = qEnds.map((e) => figAt(store, netRows, 'Q', e)), isrQ = qEnds.map((e) => figAt(store, isrRows, 'Q', e));
  const build = () => {
    const pal = palette(), b = chartBase(), soft = (qs: (Fig | null)[]) => qs.map((q) => !!q && (!!q.der || q.std === '4'));
    const o = foxOption({ x: qEnds.map((e) => periodLabel('Q', e)), unit: 'מיליוני ש"ח', full: true, labels: false, series: [
      { name: 'רווח נקי לבעלי המניות', data: netQ.map((q) => (q ? q.v / 1e3 : null)), color: pal[7], faded: soft(netQ) },
      { name: 'רווח משירותי ביטוח', data: isrQ.map((q) => (q ? q.v / 1e3 : null)), color: pal[1], kind: 'line', faded: soft(isrQ) },
    ] }) as { series: { data: (number | null | { value: number; itemStyle?: Record<string, unknown> })[] }[] };
    const d = o.series[0].data, last = d[11];
    if (last != null) d[11] = { value: typeof last === 'object' ? last.value : last, itemStyle: { ...(typeof last === 'object' ? last.itemStyle : {}), color: b.accent } };
    return o;
  };

  return (
    <div className="rd">
      {phone ? (
        <section className="rd-head">
          <ContextBar onOpen={() => setPickers(true)} label="דוח וחלון"><b className="num">{repName(P)}</b> · {W === 'q' ? 'רבעון' : W === 'ytd' ? 'מתחילת השנה' : 'LTM'}{doc && <> · פורסם <span className="num">{pubLabel(doc.date)}</span></>}</ContextBar>
        </section>
      ) : (
        <section className="rd-head">
          <div className="rd-title">
            <h2>{entry.name_he} · <span className="num">{repName(P)}</span></h2>
            <div className="rd-meta">
              {doc ? <span>פורסם <span className="num">{pubLabel(doc.date)}</span></span> : <span className="muted">תאריך הפרסום לא נמצא ברשימת המסמכים</span>}
              {doc && <a className="chip" href={doc.url} target="_blank" rel="noreferrer" title={doc.title}>הדוח המלא (PDF{doc.pages ? <>, <span className="num">{doc.pages}</span> עמ׳</> : null})</a>}
              {rest.length > 0 && <a className="chip est" href="#rd-restated"><span className="num">{rest.length}</span> נתונים הוצגו מחדש{nBig > 0 && <>, <span className="num">{nBig}</span> מהם ב-2% ומעלה</>}</a>}
            </div>
          </div>
          <div className="controls">
            <Field label="דוח"><select value={P} onChange={(e) => pick(e.target.value)}>{reports.map((p) => <option key={p} value={p}>{repName(p)}</option>)}</select></Field>
            <div className="field"><span>חלון</span><Seg label="חלון" value={W} onChange={setWin} options={winOpts} /></div>
          </div>
        </section>
      )}
      {phone && (
        <Sheet open={pickers} onClose={() => setPickers(false)} title="דוח וחלון">
          <div className="rd-pick">
            <div className="field"><span>דוח</span><div className="rd-reps">{reports.slice(0, 12).map((p) => <button key={p} type="button" className={`chip${p === P ? ' on' : ''}`} aria-pressed={p === P} onClick={() => pick(p)}><span className="num">{repName(p)}</span></button>)}</div>
              {reports.length > 12 && <select aria-label="דוח מוקדם יותר" value={reports.slice(0, 12).includes(P) ? '' : P} onChange={(e) => e.target.value && pick(e.target.value)}><option value="">מוקדם יותר…</option>{reports.slice(12).map((p) => <option key={p} value={p}>{repName(p)}</option>)}</select>}</div>
            <div className="field"><span>חלון</span><Seg label="חלון" value={W} onChange={setWin} options={winOpts} /></div>
            <button type="button" className="btn rd-done" onClick={() => history.back()}>הצג</button>
          </div>
        </Sheet>
      )}
      {card}
      {phone && <div className="rd-meta rd-meta-ph">{doc && <a className="chip" href={doc.url} target="_blank" rel="noreferrer" title={doc.title}>הדוח המלא (PDF{doc.pages ? <>, <span className="num">{doc.pages}</span> עמ׳</> : null})</a>}{rest.length > 0 && <a className="chip est" href="#rd-restated"><span className="num">{rest.length}</span> נתונים הוצגו מחדש</a>}</div>}

      <Panel title="עיקרי הדוח" aside={<span className="chip">מיליוני ש"ח · כפי שדווח</span>}>
        {rows.length === 0 ? <Empty title="לא נמצאו שורות ראשיות לתקופה" /> : (
          <div className={`rd-table${ltmW ? ' rd-ltm' : ''}`} role="table" aria-label="עיקרי הדוח">
            <div className="rd-tr rd-th" role="row"><span role="columnheader">שורה</span><span role="columnheader" className="num">{curL}</span><span role="columnheader">YoY · <span className="num">{yoyL}</span></span><span role="columnheader">QoQ · <span className="num">{qoqL}</span></span>{!ltmW && <span role="columnheader">LTM · YoY</span>}</div>
            {rows.map((r) => (
              <div className="rd-tr" role="row" key={r.key}>
                <div className="rd-l" role="rowheader">{r.label}<NoteMark p={curL} m={`rd:${r.key}`} label={r.label} add />
                  {(r.note || r.chips?.length || r.cur?.late || r.fact) && <span className="rd-chips">{r.chips?.map((c) => <span key={c} className="chip est">{c}</span>)}{r.note && <span className="chip est" title={r.note[1]}>{r.note[0]}</span>}{r.cur?.late && <span className="chip est" title={`הנתון כפי שהודפס מחדש בדוח ${r.cur.late}; הנתון המקורי בלוח "הוצג מחדש" של אותו דוח`}>לפי {r.cur.late}</span>}<IncChip f={r.fact} /></span>}
                </div>
                <div className="rd-c rd-cur" role="cell"><V f={r.cur} t={r.label} p={curL} /></div>
                <Cell h={`YoY · ${yoyL}`} base={r.yoy} a={r.cur} b={r.yoy} t={r.label} la={r.cur?.period ?? curL} lb={r.yoy?.period ?? yoyL} bp={yoyL} />
                <Cell h={`QoQ · ${qoqL}`} base={r.qoq} a={r.cur} b={r.qoq} t={r.label} la={r.cur?.period ?? curL} lb={r.qoq?.period ?? qoqL} bp={qoqL} />
                {!ltmW && <Cell h="LTM · YoY" base={r.ltm} a={r.ltm} b={r.ltmPrev} main t={r.label} la={`LTM ${periodLabel('Q', end)}`} lb={`LTM ${periodLabel('Q', shiftYear(end, -1))}`} bp={`LTM ${periodLabel('Q', end)}`} />}
              </div>
            ))}
          </div>
        )}
        <p className="src">אחוז שינוי רק בין שני נתונים חיוביים, אחרת הפרש במיליוני ש"ח · נטוי: נגזר (Q4 = FY פחות 9M; LTM = ארבעה רבעונים) · מספרי השוואה כפי שהודפסו לאחרונה · כל מספר נפתח בעמוד המקור.
          {head.missing.length > 0 && <> לא אותרו בדוח לתקופה זו: {head.missing.join(', ')}.</>}{curF.error && <> נתוני IFRS 17 של הדוח לא נטענו.</>}</p>
      </Panel>

      <Panel title={<>מה זז הכי הרבה · YoY מול <span className="num">{yoyL}</span></>} aside={<span className="chip">שורות רווח והפסד, ללא שורות סיכום · מיליוני ש"ח</span>}>
        {moved.up.length + moved.down.length === 0 ? <Empty title="אין שורות עם נתון בשתי התקופות" /> : (
          <div className="rd-movers">
            {([['עלו', moved.up], ['ירדו', moved.down]] as [string, Mover[]][]).map(([t, list]) => (
              <div key={t}>
                <h3>{t}</h3>
                {list.length === 0 ? <span className="muted">–</span> : list.map((m) => (
                  <div className="rd-mv" key={m.label}>
                    <span className="rd-ml">{m.label}</span>
                    <span className={`rd-md num ${cls(m.d)}`}><Sourced src={() => calc(`${m.label} · ${curL} מול ${yoyL}`, signed(m.d / 1e3), `${curL} − ${yoyL}`, [[m.cur, curL], [m.prev, yoyL]].map(([f, l]) => ({ label: l as string, v: fmt((f as Fig).v, (f as Fig).unit), src: () => figProv(f as Fig, m.label, l as string) })), 'מיליוני ש"ח')}>{signed(m.d / 1e3)}</Sourced></span>
                    <span className="rd-mb"><V f={m.cur} t={m.label} p={curL} /> <span className="muted">מול</span> <V f={m.prev} t={m.label} p={yoyL} /></span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {moved.skipped.length > 0 && <p className="src">לא דורגו, סימן הפוך בין שני הדוחות: {moved.skipped.join(' · ')}.</p>}
      </Panel>

      <section id="rd-restated">
        <Panel title={<>הוצג מחדש בדוח <span className="num">{repName(P)}</span></>} aside={rest.length > 0 && <>
          <Link className="chip" to={`/restatements?season=${P}&co=${id}`}>תיקונים בדוח זה</Link><Link className="chip" to={`/restatements?season=${P}`}>הצגות מחדש בענף · {repName(P)}</Link>
          {bySheet.map((x) => <span key={x.s} className="chip">{x.title} <span className="num">{thr === 'big' ? x.big : x.all}</span></span>)}
          <Seg label="סף מהותיות" value={thr} onChange={setThr} options={[['big', `2% ומעלה (${nBig})`], ['all', `הכול (${rest.length})`]]} />
        </>}>
          {rest.length === 0 ? <Empty title="הדוח לא הציג מחדש נתונים של תקופות קודמות">נבדקו הדוחות הראשיים: רווח והפסד, רווח כולל, מאזן ותזרים מזומנים.</Empty>
            : shown.length === 0 ? <Empty title="אין הצגה מחדש של 2% ומעלה"><button type="button" className="chip" onClick={() => setThr('all')}>הצג את כל {rest.length} הנתונים</button></Empty> : (
              <div className="scroll"><table className="tight rd-rest">
                <thead><tr><th>שורה ותקופה</th><th>כפי שדווח אז</th><th>כפי שהוצג מחדש</th><th>הפרש</th></tr></thead>
                <tbody>{shown.map((r, i) => (
                  <tr key={`${r.sheet}|${r.std}|${r.line}|${r.period}|${i}`}>
                    <td className="lbl">{r.line}<span className="dim"><span className="num">{r.period}</span> · {store.d.sheets.find((x) => x.code === r.sheet)?.title ?? r.sheet} · {r.std}</span></td>
                    <td><V f={r.first} t={r.line} p={r.period} note="כפי שדווח אז" /></td>
                    <td><V f={r.last} t={r.line} p={r.period} note={`כפי שהוצג מחדש בדוח ${repName(P)}`} /></td>
                    <td><Sourced src={() => restDiff(r, signed(scaled(r.d, r.unit), r.unit === 'nis' ? 2 : 1), 'הוצג מחדש − כפי שדווח אז', unitTxt(r.unit))}><span className={`num ${cls(r.d)}`}>{signed(scaled(r.d, r.unit), r.unit === 'nis' ? 2 : 1)}</span></Sourced>{r.first.v > 0 && r.last.v > 0 && <Sourced src={() => restDiff(r, pct(Number(((r.last.v / r.first.v - 1) * 100).toFixed(1)) || 0, 1, true), 'הוצג מחדש ÷ כפי שדווח אז − 1', '%')}><span className={`chg num ${cls(r.d)}`}>{pct(Number(((r.last.v / r.first.v - 1) * 100).toFixed(1)) || 0, 1, true)}</span></Sourced>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          {rest.length > 0 && <p className="src">מיליוני ש"ח (שורות למניה: ש"ח) · שני המספרים נפתחים בעמוד שבו הודפסו.</p>}
        </Panel>
      </section>

      <Panel title="רווח נקי ורווח משירותי ביטוח · 12 רבעונים" aside={<span className="chip">הרבעון המדווח מודגש · בהיר: נגזר (Q4) או IFRS 4</span>}>
        <Chart build={build} height={250} onPoint={(si, di) => { const f = (si === 0 ? netQ : isrQ)[di]; if (f) openSrc(figProv(f, si === 0 ? ROLES[4].label : ROLES[1].label, periodLabel('Q', qEnds[di]))); }} deps={[id, P, store]} label={`רווח נקי ורווח משירותי ביטוח, 12 רבעונים עד ${periodLabel('Q', end)}`} exportName={`fox-${id}-${P}-report-day`} />
      </Panel>
    </div>
  );
}
