/* S4 · the shared core of every renderer (pure: no React, no browser; tests/deliver.unit.ts runs it in node).
   A Doc's numbers are figures (lib/answers.ts Fig) referenced from Rich text by token. Here: the runs of a Rich text (text, editable
   placeholder, figure), the doc-wide numbering of figures in order of first quotation, each figure's note built from its provenance
   (the same leaf documents the email's source line names: lib/answers.ts cites), the documents behind the whole doc, and the check
   that refuses a doc with an unsourced figure. No site name anywhere: a link that points at the site is dropped. */
import { BASIS_HE, basisTag, cites, mergeCites, segments, type Cite, type Exhibit, type Fig, type LtsCite } from '../answers';
import type { Block, Doc, DocKind, Rich } from '../doc';
import { pdfPage } from '../sources';
import type { ChartSpec } from '../book';

export const KIND_HE: Record<DocKind, string> = { onepager: 'עמוד אחד', memo: 'מזכר', board: 'נייר לדירקטוריון', talking: 'נקודות לשיחה', exhibits: 'חבילת מוצגים', email: 'סיכום למייל' };
export const KINDS = Object.keys(KIND_HE) as DocKind[];
export type Format = 'pptx' | 'docx' | 'pdf' | 'txt';
export const FORMAT_HE: Record<Format, string> = { pptx: 'PowerPoint', docx: 'Word', pdf: 'PDF', txt: 'טקסט' };

/** an editable placeholder the author fills (a recommendation, a name): ⟦…⟧, highlighted in every format */
export const PH = /⟦([^⟧]*)⟧/g;
export const ph = (s: string) => `⟦${s}⟧`;
/** a figure text with no Hebrew in it ("1.4×", "−5.5%") is laid out left to right inside the right-to-left line */
export const isLtr = (t: string) => /\d/.test(t) && !/[֐-׿]/.test(t);
const LRM = '‎';
/** the text as it reads in plain text: a left-to-right figure fenced by marks so its sign and unit stay put in a Hebrew line */
export const ltrText = (t: string) => (isLtr(t) ? `${LRM}${t}${LRM}` : t);
/** a link is kept only when it leaves the site (a filing, a regulator file) */
export const safeUrl = (u?: string | null): string | null => (u && /^https?:\/\//.test(u) && !/fox/i.test(u) ? u : null);

export interface Ctx { lts?: LtsCite; names?: Record<string, string> }

export type Run =
  | { k: 't'; s: string }
  | { k: 'ph'; s: string }
  | { k: 'fig'; id: string; f: Fig; n: number; tag: string | null; ltr: boolean }
  | { k: 'miss'; id: string };

/** one figure's note: what it is, its value and basis, its as-of, the computation, the documents and pages */
export interface Note { id: string; n: number; f: Fig; cites: Cite[]; formula: string | null; text: string }

export interface Prepared {
  doc: Doc;
  /** every figure the doc can quote, block figures merged over doc figures */
  figs: Record<string, Fig>;
  /** figure id → its number, in order of first quotation (a figure the text never quotes is numbered after) */
  num: Map<string, number>;
  notes: Note[];
  /** every document behind the doc, pages merged, in order met */
  sources: Cite[];
  /** the resolvers the source documents were named with (printed components, company names) */
  ctx: Ctx;
}

const TOKEN = /\{([a-z][a-z0-9_]*)\}/g;
const richIds = (r?: Rich | null): string[] => (r ? [...r.text.matchAll(TOKEN)].map((m) => m[1]) : []);
/** the Rich texts of a block, in reading order */
export function richOf(b: Block): Rich[] {
  switch (b.k) {
    case 'p': case 'callout': return [b.rich];
    case 'bullets': return b.items;
    case 'point': return [b.line, ...(b.comeback ? [b.comeback] : [])];
    case 'table': return b.rows.flat().filter((c): c is Rich => typeof c !== 'string');
    case 'options': return [...b.items.flatMap((o) => [...o.pro, ...o.con]), ...(b.rec ? [b.rec] : [])];
    default: return [];
  }
}
const blockFigs = (b: Block): Record<string, Fig> => {
  const out: Record<string, Fig> = {};
  richOf(b).forEach((r) => Object.assign(out, r.figs ?? {}));
  if (b.k === 'exhibit') Object.assign(out, b.figs);
  return out;
};

const formulaOf = (f: Fig): string | null => (f.prov && f.prov.k === 'calc' ? f.prov.formula : null);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
export const pagesHe = (ps: number[]) => (ps.length ? `, עמ׳ ${ps.join(', ')}` : '');
export const citeText = (c: Cite) => `${c.doc}${pagesHe(c.pages)}`;
export const citeUrl = (c: Cite): string | null => safeUrl(c.url ? pdfPage(c.url, c.pages[0]) : c.ds ? 'https://data.gov.il' : null);

/** the note of a figure, one line: "label: value (basis), נכון ל-asof. חישוב: … מקור: doc, עמ׳ n." */
export function noteText(f: Fig, cs: Cite[], formula: string | null): string {
  const tag = basisTag(f);
  const head = `${f.l}: ${ltrText(f.t)}${tag ? ` (${tag})` : ''}${f.asof ? `, נכון ל-${f.asof}` : ''}.`;
  const calc = formula ? ` חישוב: ${clip(formula.trim().replace(/\.$/, ''), 240)}.` : '';
  const src = cs.length ? ` מקור: ${cs.map(citeText).join('; ')}.` : '';
  return `${head}${calc}${src}`;
}

/** numbering, notes and sources of a doc */
export function prepare(doc: Doc, ctx: Ctx = {}): Prepared {
  const figs: Record<string, Fig> = { ...doc.figs };
  doc.blocks.forEach((b) => Object.assign(figs, blockFigs(b)));
  const num = new Map<string, number>();
  const see = (id: string) => { if (figs[id] && !num.has(id)) num.set(id, num.size + 1); };
  for (const b of doc.blocks) {
    richOf(b).forEach((r) => richIds(r).forEach(see));
    if (b.k === 'point' && b.fig) see(b.fig);
  }
  Object.keys(doc.figs).forEach(see);
  const notes: Note[] = [...num.entries()].map(([id, n]) => {
    const f = figs[id];
    const cs = mergeCites(cites(f.prov, ctx.lts, ctx.names));
    const formula = formulaOf(f);
    return { id, n, f, cites: cs, formula, text: noteText(f, cs, formula) };
  });
  const exFigs = doc.blocks.flatMap((b) => (b.k === 'exhibit' ? Object.values(b.figs) : []));
  const sources = mergeCites([...notes.map((x) => x.f), ...exFigs].flatMap((f) => cites(f.prov, ctx.lts, ctx.names)));
  return { doc, figs, num, notes, sources, ctx };
}

/** a Rich text as runs: text, placeholders, figures (with their doc number and basis tag) */
export function runs(r: Rich, P: Prepared): Run[] {
  const figs = r.figs ? { ...P.figs, ...r.figs } : P.figs;
  const out: Run[] = [];
  for (const s of segments(r.text, figs)) {
    if (s.k === 'fig') out.push({ k: 'fig', id: s.id, f: s.f, n: P.num.get(s.id) ?? 0, tag: basisTag(s.f), ltr: isLtr(s.f.t) });
    else if (s.k === 'miss') out.push({ k: 'miss', id: s.id });
    else {
      const t = s.s;
      let at = 0;
      for (const m of t.matchAll(PH)) {
        if (m.index! > at) out.push({ k: 't', s: t.slice(at, m.index) });
        out.push({ k: 'ph', s: m[1] });
        at = m.index! + m[0].length;
      }
      if (at < t.length) out.push({ k: 't', s: t.slice(at) });
    }
  }
  return out;
}
/** a Rich text as plain text: every figure its display text and basis; placeholders keep their brackets */
export function plainRich(r: Rich, P: Prepared, opt: { marks?: boolean; nums?: boolean } = {}): string {
  return runs(r, P).map((x) => (x.k === 't' ? x.s : x.k === 'ph' ? ph(x.s) : x.k === 'miss' ? `{${x.id}}`
    : `${opt.marks ? ltrText(x.f.t) : x.f.t}${x.tag ? ` (${x.tag})` : ''}${opt.nums && x.n ? ` [${x.n}]` : ''}`)).join('');
}

/** the source line under an exhibit: its own footnotes stay with it; the documents of the figures it is drawn from, and its credit */
export function exhibitSources(ex: Exhibit, figs: Record<string, Fig>, ctx: Ctx): { cites: Cite[]; formulas: string[]; credit: string | null } {
  const fs = Object.values(figs);
  const cs = mergeCites(fs.flatMap((f) => cites(f.prov, ctx.lts, ctx.names)));
  const formulas = [...new Set(fs.map(formulaOf).filter((x): x is string => !!x))];
  return { cites: cs, formulas, credit: ex.credit ?? null };
}
export const exhibitSourceLine = (ex: Exhibit, figs: Record<string, Fig>, ctx: Ctx, max = 6): string => {
  const s = exhibitSources(ex, figs, ctx);
  const docs = s.cites.slice(0, max).map(citeText);
  if (s.cites.length > max) docs.push(`ועוד ${s.cites.length - max} מסמכים (ברשימת המקורות)`);
  if (s.credit) docs.push(s.credit);
  return docs.length ? `מקורות: ${docs.join('; ')}.` : '';
};

/** an exhibit's data as a table (a chart drawn without its picture, or the data under it): header row, then one row per category */
export function exhibitRows(ex: Exhibit): string[][] {
  if (ex.kind === 'table' && ex.rows && ex.rows.length) return ex.rows.map((r) => r.map((c) => (c == null ? '–' : typeof c === 'number' ? fmtCell(c) : String(c))));
  const head = ['', ...ex.series.map((s) => s.name || ex.unit)];
  return [head, ...ex.cats.map((c, i) => [c, ...ex.series.map((s) => (s.data[i] == null ? '–' : fmtCell(s.data[i] as number)))])];
}
export function fmtCell(v: number): string {
  const a = Math.abs(v), d = a >= 100 ? 0 : a >= 1 ? 1 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
}

/** the bases a doc mixes, when it mixes more than one */
export function basisMix(P: Prepared): string | null {
  const bs = [...new Set(P.notes.map((x) => x.f.b))];
  return bs.length > 1 ? `בסיסים מעורבים: ${bs.map((b) => BASIS_HE[b] ?? b).join(', ')} (כל נתון מסומן)` : null;
}

/** what makes a doc unfit to send: a token with no figure, a figure with no source, the site's name */
export function problems(doc: Doc, ctx: Ctx = {}): string[] {
  const P = prepare(doc, ctx), out: string[] = [];
  for (const b of doc.blocks) for (const r of richOf(b)) for (const x of runs(r, P)) if (x.k === 'miss') out.push(`אין נתון לאסימון {${x.id}}`);
  for (const n of P.notes) if (!n.cites.length && !n.formula) out.push(`לנתון "${n.f.l}" אין מקור`);
  for (const b of doc.blocks) if (b.k === 'exhibit') for (const f of Object.values(b.figs)) if (!cites(f.prov, ctx.lts, ctx.names).length && !formulaOf(f)) out.push(`לנתון "${f.l}" במוצג אין מקור`);
  if (/fox/i.test([doc.title, doc.subtitle ?? '', doc.author].join(' '))) out.push('שם האתר בכותרת או בשם המחבר');
  return out;
}

/** a file name with no site prefix: the title, the date (dd.mm.yy) */
export const docFileName = (doc: Doc, ext: string) => `${(doc.title || 'מסמך').replace(/fox/gi, '').replace(/[\\/:*?"<>|⟦⟧]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80)}-${doc.date}.${ext}`;

/** an exhibit as a chart-book spec (no sources: the slide's foot carries them from the figures' provenance) */
export function exSpec(ex: Exhibit): ChartSpec {
  return { v: 1, id: 'x', key: ex.title, title: ex.title, label: ex.title, route: '', params: {}, kind: ex.kind === 'hbar' ? 'hbar' : 'cat', cats: ex.cats ?? [], unit: ex.unit ?? '', span: ex.span,
    series: (ex.series ?? []).map((s) => ({ name: s.name, type: s.type === 'line' || ex.kind === 'line' ? 'line' : 'bar', data: s.data, id: s.id })), sources: [], credit: ex.credit, added: '', updated: '' } as ChartSpec;
}

/** the doc with every Rich text (and the title) passed through `fn`: the author's name into its placeholder, the preview's edits */
export function mapText(doc: Doc, fn: (s: string) => string): Doc {
  const R = (r: Rich): Rich => ({ ...r, text: fn(r.text) });
  const cell = (c: string | Rich) => (typeof c === 'string' ? fn(c) : R(c));
  const blocks = doc.blocks.map((b): Block => {
    switch (b.k) {
      case 'p': case 'callout': return { ...b, rich: R(b.rich) };
      case 'bullets': return { ...b, items: b.items.map(R) };
      case 'point': return { ...b, line: R(b.line), comeback: b.comeback ? R(b.comeback) : undefined };
      case 'table': return { ...b, rows: b.rows.map((row) => row.map(cell)) };
      case 'options': return { ...b, items: b.items.map((x) => ({ name: fn(x.name), pro: x.pro.map(R), con: x.con.map(R) })), rec: b.rec ? R(b.rec) : undefined };
      default: return b;
    }
  });
  return { ...doc, title: fn(doc.title), subtitle: doc.subtitle != null ? fn(doc.subtitle) : undefined, blocks };
}
/** the placeholders a doc carries, in order, once each */
export function placeholders(doc: Doc): string[] {
  const out = new Set<string>();
  mapText(doc, (s) => { for (const m of s.matchAll(PH)) out.add(m[1]); return s; });
  return [...out];
}
/** fills placeholders: { "להשלמה: הנמענים": "ההנהלה" }; an empty value keeps the placeholder */
export const fillPlaceholders = (doc: Doc, vals: Record<string, string>): Doc => mapText(doc, (s) => s.replace(PH, (m, k: string) => (vals[k]?.trim() ? vals[k].trim() : m)));
export const AUTHOR_PH = 'שם המחבר';
