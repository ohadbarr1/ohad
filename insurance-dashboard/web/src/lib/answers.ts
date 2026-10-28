/** S1 / S2 / S6 · the Question Index, the Finding Engine and the Answer Ladder on the page. The data contract is pipeline/answer_core.py:
 *  an answer body is `answer(...)` (figures with provenance, sentences that reference them by token `{id}`) or `nodata(why)`; the index
 *  row is what pipeline/build_answers.py writes; a finding row is a body plus its detector, materiality and surprise (two published
 *  components, never one combined score). This file is pure (no React, no browser): the page renders the segments, the unit test
 *  (tests/answers.unit.ts) runs the same functions in node. */
import type { ProvJ } from './fragility';
import { DS_LABEL, type RegDs } from './sources';
import { startsWord, terms } from './hebrew';

export type Basis = 'actual' | 'target' | 'forward' | 'estimate';
export const BASIS_HE: Record<Basis, string> = { actual: 'בפועל', target: 'יעד', forward: 'צפי', estimate: 'אומדן' };
/** one sourced number (answer_core.fig) */
export interface Fig { l: string; v: number | null; u: string; t: string; b: Basis; asof: string; prov: ProvJ; c?: string }
export interface ExSeries { name: string; type: 'bar' | 'line'; data: (number | null)[]; id?: string }
/** the exhibit rung (answer_core.exhibit): a chart (cat / hbar / line) or a table (rows, first row the header) */
export interface Exhibit { kind: 'cat' | 'hbar' | 'line' | 'table'; title: string; unit: string; cats: string[]; series: ExSeries[]; foot: string[]; span?: string; credit?: string; rows?: (string | number | null)[][] }
/** the falsifier (answer_core.changes_if), evaluated at build */
export interface Chg { text: string; fig: string; op: '<' | '<=' | '>' | '>='; v: number; st: 'holds' | 'tripped'; thr: string }
export interface Link { l: string; to: string }
export interface OkBody { st: 'ok'; figs: Record<string, Fig>; corr: string; email: string; ex: Exhibit | null; chg: Chg | null; vk: string; links: Link[]; rel: string[]; asof?: string; note?: string; mix?: Basis[]; h?: string }
export interface NoBody { st: 'nodata'; why: string }
export type Body = OkBody | NoBody;
/** an answered question as answers/<topic>.json carries it */
export type Answer = Body & { id: string; q: string; chairs: string[]; topic: string; cos: string[] };
export interface IndexRow { id: string; q: string; chairs: string[]; topic: string; cos: string[]; st: 'ok' | 'nodata'; corr: string | null; why: string | null; asof: string | null; chg: 'holds' | 'tripped' | null; h: string | null }
export interface IndexFile { v: 1; chairs: Record<string, string>; topics: Record<string, string>; bases: Record<string, string>; n: number; ok: number; rows: IndexRow[] }
export interface TopicFile { v: 1; topic: string; label: string; rows: Answer[] }
/** one published component of a finding's rank: materiality (u "m": ₪ millions a year at stake) or surprise (u "sd": standard deviations
 *  against the stated reference distribution), each with its value, unit, display text and reason */
export interface Comp { v: number | null; u: string; t: string; why: string }
export type Finding = Body & { id: string; det: string; c?: string | null; seg?: string | null; mat: Comp; sur: Comp; top?: boolean | number; q?: string };
export interface FindingsFile { v: 1; asof: string | Record<string, string>; params?: Record<string, unknown>; dets: Record<string, { he: string; rule: string }>; order_rule: string; rows: Finding[]; skipped?: { id: string; det: string; c?: string | null; why: string }[] }

export const RUNGS = ['corr', 'email', 'ex'] as const;
export type Rung = (typeof RUNGS)[number];
export const RUNG_HE: Record<Rung, string> = { corr: 'מסדרון', email: 'מייל', ex: 'מוצג' };
export const CHG_HE: Record<Chg['st'], string> = { holds: 'התשובה עומדת', tripped: 'הסף נחצה: התשובה משתנה' };
export const isOk = (b: Body | null | undefined): b is OkBody => !!b && b.st === 'ok';

/* ---------- tokens ---------- */
const TOKEN = /\{([a-z][a-z0-9_]*)\}/g;
export type Seg = { k: 'text'; s: string } | { k: 'fig'; id: string; f: Fig } | { k: 'thr'; s: string } | { k: 'miss'; id: string };
/** a sentence as runs of text and figures; `{thr}` is a falsifier's threshold; a token with no figure stays visible as missing */
export function segments(text: string, figs: Record<string, Fig>, thr?: string): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > at) out.push({ k: 'text', s: text.slice(at, m.index) });
    const id = m[1];
    if (id === 'thr' && thr != null) out.push({ k: 'thr', s: thr });
    else if (figs[id]) out.push({ k: 'fig', id, f: figs[id] });
    else out.push({ k: 'miss', id });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ k: 'text', s: text.slice(at) });
  return out;
}
/** the basis label a non-actual figure carries next to its number (target, forward and estimate are never shown bare) */
export const basisTag = (f: Fig): string | null => (f.b && f.b !== 'actual' ? BASIS_HE[f.b] ?? f.b : null);
/** the sentence as plain text: every figure its display text (plus its basis when it is not actual) */
export function plain(text: string, figs: Record<string, Fig>, thr?: string): string {
  return segments(text, figs, thr).map((s) => (s.k === 'text' ? s.s : s.k === 'thr' ? s.s : s.k === 'fig' ? s.f.t + (basisTag(s.f) ? ` (${basisTag(s.f)})` : '') : `{${s.id}}`)).join('');
}
/** the figure ids a sentence quotes, in order, once each */
export const figIds = (text: string): string[] => [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]).filter((x) => x !== 'thr'))];

/* ---------- sources ---------- */
/** one source document of a figure, as the email's source line names it */
export interface Cite { key: string; doc: string; pages: number[]; url?: string | null; /** regulator files: the datasets (merged into one entry) */ ds?: RegDs[] }
const SET_DS: Record<string, RegDs[]> = { 'fam:gemel': ['gemel'], 'p:hishtalmut': ['gemel'], 'fam:pension': ['pensia'], 'fam:insurance': ['insurance'], 'all-ins': ['pensia', 'gemel'] };
const DS_ORDER: RegDs[] = ['pensia', 'gemel', 'insurance'];
const regDoc = (ds: RegDs[]) => `רשות שוק ההון, ${DS_ORDER.filter((d) => ds.includes(d)).map((d) => DS_LABEL[d]).join(', ')} (data.gov.il)`;
/** a resolver for the printed segment components of a managing company (`lts` nodes): the page passes the Savings Lens resolver */
export type LtsCite = (j: Extract<ProvJ, { k: 'lts' }>) => Cite[] | null;

/** the leaf documents behind a provenance node: printed figures, regulator files, fund tracks; a computation with no sourced input
 *  is named by its formula */
export function cites(p: ProvJ | undefined | null, lts?: LtsCite, names?: Record<string, string>, depth = 0): Cite[] {
  if (!p || depth > 6) return [];
  switch (p.k) {
    case 'report': return [{ key: `r|${p.url ?? p.doc ?? p.title}`, doc: [p.doc ?? p.srcType ?? 'דוח', p.period].filter(Boolean).join(' '), pages: p.pg ? [p.pg] : [], url: p.url }];
    case 'xbrl': return [{ key: `x|${p.rid ?? p.company}|${p.period}`, doc: `דיווח XBRL במאיה · ${names?.[p.company] ?? p.company} · ${p.period}`, pages: [] }];
    case 'reg': { const ds = SET_DS[p.set] ?? ['pensia', 'gemel', 'insurance']; return [{ key: 'g|reg', doc: regDoc(ds), pages: [], ds }]; }
    case 'fund': return [{ key: `f|${p.ds}|${p.id}`, doc: `רשות שוק ההון, ${DS_LABEL[p.ds] ?? p.ds}, קופה ${p.id}`, pages: [] }];
    case 'price': return [{ key: `p|${p.vendor}|${p.ticker}`, doc: `${p.vendor} · ${p.ticker} · ${p.date}`, pages: [] }];
    case 'lts': {
      const got = lts?.(p);
      if (got && got.length) return got;
      return [{ key: `l|${p.c}|${p.period}`, doc: `דוחות ${names?.[p.c] ?? p.c}, רכיבי מגזר מודפסים, ${p.period.replace(/^Q(\d)-\d\d(\d\d)$/, "Q$1'$2")}`, pages: [] }];
    }
    case 'calc': {
      const under = p.inputs.flatMap((i) => cites(i.p, lts, names, depth + 1));
      return under.length ? under : [{ key: `c|${p.formula}`, doc: `חישוב: ${p.formula}`, pages: [] }];
    }
    default: return [];
  }
}
/** distinct documents, their pages merged and sorted, in the order met */
export function mergeCites(cs: Cite[]): Cite[] {
  const by = new Map<string, Cite>();
  for (const c of cs) {
    const x = by.get(c.key);
    if (!x) { by.set(c.key, { ...c, pages: [...c.pages], ds: c.ds ? [...c.ds] : undefined }); continue; }
    c.pages.forEach((p) => { if (!x.pages.includes(p)) x.pages.push(p); });
    if (c.ds && x.ds) { c.ds.forEach((d) => { if (!x.ds!.includes(d)) x.ds!.push(d); }); x.doc = regDoc(x.ds); }
  }
  const out = [...by.values()];
  out.forEach((c) => c.pages.sort((a, b) => a - b));
  return out;
}
const pagesText = (ps: number[]) => (ps.length ? `, עמ׳ ${ps.join(', ')}` : '');
/** the source line of the figures a text quotes: "מקורות: A; B, עמ׳ 12, 14." */
export function sourceLine(figs: Record<string, Fig>, ids: string[], lts?: LtsCite, names?: Record<string, string>): string {
  const cs = mergeCites(ids.flatMap((id) => cites(figs[id]?.prov, lts, names)));
  return cs.length ? `מקורות: ${cs.map((c) => `${c.doc}${pagesText(c.pages)}`).join('; ')}.` : '';
}

/** the email rung as text to paste: the paragraph, the basis note when bases mix, the as-of, the sources. No site name, no link. */
export function emailText(b: OkBody, opt: { lts?: LtsCite; names?: Record<string, string>; head?: string } = {}): string {
  const ids = figIds(b.email);
  const parts = [opt.head ? opt.head.trim() : '', plain(b.email, b.figs).trim()];
  const meta = [b.asof ? `נכון ל-${b.asof}` : '', b.mix && b.mix.length > 1 ? `בסיסים: ${b.mix.map((x) => BASIS_HE[x] ?? x).join(', ')}` : ''].filter(Boolean).join(' · ');
  const src = sourceLine(b.figs, ids, opt.lts, opt.names);
  return [...parts.filter(Boolean), [meta, src].filter(Boolean).join('\n')].filter(Boolean).join('\n\n');
}

/* ---------- the index ---------- */
/** the falsifier's state as words, with the figure it watches */
export const chgLine = (b: OkBody): string | null => (b.chg ? plain(b.chg.text, b.figs, b.chg.thr) : null);
/** a finding's two published components, never combined: "מהותיות X · הפתעה Y" */
export const compLine = (f: Finding): string => `מהותיות ${f.mat?.t ?? '–'} · הפתעה ${f.sur?.t ?? '–'}`;
/** findings in the order the file gives (its order_rule), the top ones first */
export const topFirst = (rows: Finding[]): Finding[] => rows.map((r, i) => [r, i] as const).sort((a, b) => Number(!!b[0].top) - Number(!!a[0].top) || a[1] - b[1]).map(([r]) => r);

/** the fast text filter over the Hebrew questions: every query word starts a word of the question, its answer, its id or a company
 *  name (also behind prefix letters: "בגמל" finds "גמל"). 0 = no match; higher = better (a match in the question beats one in the answer) */
export function qScore(row: { id: string; q: string; corr?: string | null; cos?: string[] }, query: string, names?: Record<string, string>): number {
  const qs = terms(query);
  if (!qs.length) return 1;
  if (/^[qQ]-?\d{1,3}$/.test(query.trim())) return row.id.toLowerCase().replace('-', '').startsWith(query.trim().toLowerCase().replace('-', '')) ? 9 : 0;
  const qw = terms(row.q), cw = terms(row.corr ?? ''), nw = terms((row.cos ?? []).map((c) => names?.[c] ?? c).join(' '));
  let s = 0;
  for (const w of qs) {
    const a = startsWord(qw, w), b = startsWord(nw, w), c = startsWord(cw, w);
    if (!a && !b && !c) return 0;
    s += a ? 2 + a : b ? 2 + b : c;
  }
  return s / qs.length;
}
