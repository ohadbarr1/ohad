import type { Prov } from './prov';
import { pdfPage, mayaReport, DS_LABEL } from './sources';

/* Provenance for exports. A chart on the site knows the source of each point only through its `onPoint` handler, which opens the
   source sheet. To export a chart with its sources, the handler is run once per point while the sheet is "captured": `open` hands the
   Prov to the sink here instead of showing it. The SourceProvider asks `captured(p)` first (one line in components/Source.tsx). */

let sink: ((p: Prov) => void) | null = null;
/** true when an export is collecting sources: the provider must not open the sheet */
export function captured(p: Prov): boolean { if (!sink) return false; sink(p); return true; }

/** Runs `fn` with every `open(prov)` collected instead of shown. Synchronous handlers only (all chart handlers are). */
export function collect(fn: () => void): Prov[] {
  const out: Prov[] = [];
  const prev = sink;
  sink = (p) => out.push(p);
  try { fn(); } catch { /* a handler that fails on a point gives no source for it */ } finally { sink = prev; }
  return out;
}

/** One source line of an export: a document page, a regulator file, a computation or a plain text credit. */
export interface SrcRef {
  kind: 'report' | 'xbrl' | 'reg' | 'fund' | 'calc' | 'price' | 'text';
  /** what the figure is ("רווח נקי · Q2'26") */
  label: string;
  /** the document ("דוח Q2'26"), the file or the dataset */
  doc?: string;
  page?: number | null;
  /** the link that opens the source (PDF at the page, MAYA report, data.gov.il) */
  url?: string | null;
  /** the bare document URL, used to group pages of one document */
  file?: string | null;
  period?: string;
  /** derived figures: how they are computed */
  formula?: string;
  value?: string;
  unit?: string;
  /** estimate (אומדן) */
  est?: boolean;
}

const REG_DATA = 'https://data.gov.il/dataset';

/** A Prov as source lines. A computed figure gives its formula and, one level down, the printed figures it uses. */
export function refsOf(p: Prov, depth = 0): SrcRef[] {
  switch (p.k) {
    case 'report': return [{ kind: 'report', label: p.title, doc: p.doc ?? p.srcType, page: p.pg, url: p.url ? pdfPage(p.url, p.pg) : null, file: p.url, period: p.period, value: p.value, unit: p.unit }];
    case 'xbrl': return [{ kind: 'xbrl', label: p.title, doc: `דיווח XBRL במאיה${p.period ? ` · ${p.period}` : ''}`, url: p.rid ? mayaReport(p.rid) : null, file: p.rid ? mayaReport(p.rid) : null, period: p.period, value: p.value, unit: p.unit }];
    case 'fund': return [{ kind: 'fund', label: p.title, doc: `רשות שוק ההון · ${DS_LABEL[p.ds]} · קופה ${p.id}`, url: REG_DATA, file: `reg:${p.ds}`, period: String(p.period), value: p.value, unit: p.unit }];
    case 'reg': return [{ kind: 'reg', label: 'נתוני קופות (גמל-נט, פנסיה-נט, ביטוח-נט)', doc: 'רשות שוק ההון · data.gov.il', url: REG_DATA, file: 'reg:all' }];
    case 'price': return [{ kind: 'price', label: p.title, doc: `${p.vendor} · ${p.ticker}`, period: p.date, value: p.value }];
    case 'calc': {
      const own: SrcRef = { kind: 'calc', label: p.title, formula: p.formula, value: p.value, unit: p.unit, est: p.est };
      if (depth >= 2) return [own];
      const under = p.inputs.flatMap((i) => { if (!i.src) return []; try { return refsOf(i.src(), depth + 1); } catch { return []; } });
      return [own, ...under];
    }
    default: return [];
  }
}

/** Distinct sources, documents first, in the order met. */
export function uniqRefs(rs: SrcRef[]): SrcRef[] {
  const seen = new Set<string>(), out: SrcRef[] = [];
  for (const r of rs) {
    const k = r.kind === 'calc' ? `calc|${r.formula}` : r.kind === 'reg' ? 'reg' : `${r.kind}|${r.file ?? r.doc}|${r.page ?? ''}|${r.kind === 'text' ? r.label : ''}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  const rank = (r: SrcRef) => (r.kind === 'report' ? 0 : r.kind === 'xbrl' ? 1 : r.kind === 'reg' || r.kind === 'fund' ? 2 : r.kind === 'text' ? 3 : r.kind === 'calc' ? 4 : 5);
  return out.map((r, i) => [r, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);
}

/** One document with the pages a chart uses: "דוח Q2'26, עמ׳ 52, 54" */
export interface DocCite { doc: string; pages: number[]; url: string | null; kind: SrcRef['kind'] }
export function citeDocs(rs: SrcRef[]): { docs: DocCite[]; formulas: string[]; texts: string[] } {
  const by = new Map<string, DocCite>(), formulas: string[] = [], texts: string[] = [];
  for (const r of rs) {
    if (r.kind === 'calc') { if (r.formula && !formulas.includes(r.formula)) formulas.push(r.formula); continue; }
    if (r.kind === 'text') { if (!texts.includes(r.label)) texts.push(r.label); continue; }
    const key = `${r.kind}|${r.file ?? r.doc ?? r.label}`;
    let d = by.get(key);
    if (!d) { d = { doc: r.doc ?? r.label, pages: [], url: r.file && /^https?:/.test(r.file) ? r.file : r.url ?? null, kind: r.kind }; by.set(key, d); }
    if (r.page && !d.pages.includes(r.page)) d.pages.push(r.page);
  }
  const docs = [...by.values()];
  docs.forEach((d) => d.pages.sort((a, b) => a - b));
  return { docs, formulas, texts };
}

/** "עמ׳ 52, 54–56" */
export function pagesText(ps: number[]): string {
  if (!ps.length) return '';
  const runs: string[] = [];
  for (let i = 0; i < ps.length;) {
    let j = i; while (j + 1 < ps.length && ps[j + 1] === ps[j] + 1) j++;
    runs.push(j > i + 1 ? `${ps[i]}–${ps[j]}` : j === i + 1 ? `${ps[i]}, ${ps[j]}` : `${ps[i]}`);
    i = j + 1;
  }
  return `${ps.length > 1 ? 'עמ׳' : 'עמ׳'} ${runs.join(', ')}`;
}

/** The whole citation as one line, for a picture or a footnote */
export function citeLine(rs: SrcRef[], max = 6): string {
  const { docs, formulas, texts } = citeDocs(rs);
  const parts = docs.slice(0, max).map((d) => `${d.doc}${d.pages.length ? `, ${pagesText(d.pages)}` : ''}`);
  if (docs.length > max) parts.push(`ועוד ${docs.length - max} מסמכים`);
  parts.push(...texts);
  if (formulas.length) parts.push(`מחושב: ${formulas[0]}${formulas.length > 1 ? ` ועוד ${formulas.length - 1}` : ''}`);
  return parts.join(' · ');
}
