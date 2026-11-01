/* S4 · the Word document, written as Office Open XML by hand (JSZip, already shipped with the deck exporter: no new dependency).
   Right to left throughout: bidi paragraphs and sections, right-to-left runs, tables with their first column on the right (bidiVisual);
   a left-to-right figure ("1.4×", "−5.5%") is its own run fenced by direction marks so its sign and unit stay put. Every figure's first
   quotation carries a real Word footnote with its provenance (what it is, value, basis, as-of, the computation, the documents and
   pages); target / forward / estimate ride next to the number. Exhibits are pictures (the chart engine's PNG) with their footnotes and
   source line, or the data as a Word table when no picture is given (node, tests). Placeholders ⟦…⟧ are highlighted for the author.
   Metadata: the title and the author set in this browser, nothing else (no application name, no site). */
import type { Block, Doc, Rich } from '../doc';
import { BASIS_HE } from '../answers';
import { basisMix, citeText, citeUrl, exhibitRows, exhibitSourceLine, isLtr, prepare, runs, type Ctx, type Prepared } from './notes';

export interface Png { data: Uint8Array; w: number; h: number }
export interface DocxOpt { ctx?: Ctx; images?: Record<number, Png>; kindLabel?: string; created?: string }

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LRM = '‎';
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NAVY = '111C3F', MUTED = '4F5668', LINE = 'D3D7DF', PANEL = 'F1F2F6', EMBER = 'C2391C';
const TEXT_W = 11906 - 2 * 1134;  // A4 width less the margins, in twentieths of a point

interface RunOpt { b?: boolean; i?: boolean; color?: string; sz?: number; hl?: boolean; ltr?: boolean; style?: string; sup?: boolean }
/** a run, its properties in schema order */
function r(text: string, o: RunOpt = {}): string {
  const pr = [o.style ? `<w:rStyle w:val="${o.style}"/>` : '', o.b ? '<w:b/><w:bCs/>' : '', o.i ? '<w:i/><w:iCs/>' : '', o.color ? `<w:color w:val="${o.color}"/>` : '',
    o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : '', o.hl ? '<w:highlight w:val="yellow"/>' : '', o.sup ? '<w:vertAlign w:val="superscript"/>' : '', o.ltr ? '' : '<w:rtl/>'].join('');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
}
interface ParOpt { style?: string; keepNext?: boolean; jc?: 'center' | 'both'; numId?: number; spaceAfter?: number; pageBreakBefore?: boolean; shade?: string; box?: string }
/** a paragraph, right to left, its properties in schema order */
function p(body: string, o: ParOpt = {}): string {
  const bd = o.box ? `<w:pBdr>${['top', 'left', 'bottom', 'right'].map((s) => `<w:${s} w:val="single" w:sz="6" w:space="4" w:color="${o.box}"/>`).join('')}</w:pBdr>` : '';
  const pr = [o.style ? `<w:pStyle w:val="${o.style}"/>` : '', o.keepNext ? '<w:keepNext/>' : '', o.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    o.numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${o.numId}"/></w:numPr>` : '', bd, o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : '',
    '<w:bidi/>', o.spaceAfter != null ? `<w:spacing w:after="${o.spaceAfter}"/>` : '', o.jc ? `<w:jc w:val="${o.jc}"/>` : ''].join('');
  return `<w:p><w:pPr>${pr}</w:pPr>${body}</w:p>`;
}

class Writer {
  foot: string[] = [];
  rels: string[] = [];
  media: { name: string; data: Uint8Array }[] = [];
  seen = new Set<string>();
  pic = 0;
  constructor(public P: Prepared, public ctx: Ctx) {}
  rel(type: string, target: string, ext = false): string {
    const id = `rId${this.rels.length + 10}`;
    this.rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${x(target)}"${ext ? ' TargetMode="External"' : ''}/>`);
    return id;
  }
  footnote(text: string): string {
    const id = this.foot.length + 1;
    this.foot.push(`<w:footnote w:id="${id}">${p(`<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${r(' ')}${r(text)}`, { style: 'FootnoteText' })}</w:footnote>`);
    return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
  }
  /** a figure: bold, its basis beside it, a footnote with its provenance at its first quotation */
  fig(id: string, base: RunOpt = {}): string {
    const f = this.P.figs[id];
    if (!f) return r('?', { ...base, color: EMBER, b: true });
    const ltr = isLtr(f.t);
    let out = ltr ? r(`${LRM}${f.t}${LRM}`, { ...base, b: true, ltr: true }) : r(f.t, { ...base, b: true });
    if (f.b !== 'actual') out += r(` (${BASIS_HE[f.b]})`, { ...base, b: true, color: '7A5200', sz: 16 });
    if (!this.seen.has(id)) { this.seen.add(id); const n = this.P.notes.find((q) => q.id === id); if (n) out += this.footnote(n.text); }
    return out;
  }
  rich(rt: Rich, base: RunOpt = {}): string {
    return runs(rt, this.P).map((q) => (q.k === 't' ? r(q.s, base) : q.k === 'ph' ? r(`⟦${q.s}⟧`, { ...base, hl: true, b: true }) : q.k === 'miss' ? r('?', { b: true, color: EMBER }) : this.fig(q.id, base))).join('');
  }
  image(png: Png, title: string): string {
    this.pic++;
    const name = `image${this.pic}.png`;
    this.media.push({ name, data: png.data });
    const rid = this.rel('image', `media/${name}`);
    const cx = TEXT_W * 635, cy = Math.round((cx * png.h) / Math.max(1, png.w));
    return p(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${this.pic}" name="${name}" descr="${x(title)}"/>`
      + '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${this.pic}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
      + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>', { jc: 'center', spaceAfter: 60 });
  }
}

/** a table, its first column rightmost; cells are ready paragraphs' run content */
function table(head: string[] | null, rows: string[][], widths?: number[], numeric = false): string {
  const n = Math.max(head?.length ?? 0, ...rows.map((q) => q.length));
  const ws = widths ?? (() => { const first = Math.round(TEXT_W * (n > 2 ? 0.34 : 0.3)); const rest = Math.floor((TEXT_W - first) / Math.max(1, n - 1)); return [first, ...Array(n - 1).fill(rest)]; })();
  const tc = (body: string, i: number, hd: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${ws[i] ?? ws[ws.length - 1]}" w:type="dxa"/>${hd ? `<w:shd w:val="clear" w:color="auto" w:fill="${PANEL}"/>` : ''}</w:tcPr>${p(body || r(''), { style: 'TableText', jc: numeric && i > 0 && !hd ? undefined : undefined })}</w:tc>`;
  const tr = (cells: string[], hd: boolean) => `<w:tr>${hd ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${Array.from({ length: n }, (_, i) => tc(cells[i] ?? '', i, hd)).join('')}</w:tr>`;
  const b = (s: string, c: string, sz = 4) => `<w:${s} w:val="single" w:sz="${sz}" w:space="0" w:color="${c}"/>`;
  return `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="${TEXT_W}" w:type="dxa"/><w:tblBorders>${b('top', NAVY, 8)}${b('bottom', LINE)}${b('insideH', LINE)}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`
    + `<w:tblGrid>${ws.slice(0, n).map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${head ? tr(head, true) : ''}${rows.map((q) => tr(q, false)).join('')}</w:tbl>${p('', { spaceAfter: 60 })}`;
}
const cellText = (s: string, o: RunOpt = {}) => (isLtr(s) ? r(`${LRM}${s}${LRM}`, { ...o, ltr: true }) : r(s, o));

function block(W: Writer, b: Block, i: number, img: Record<number, Png>): string {
  switch (b.k) {
    case 'h': return p(r(b.text), { style: `Heading${b.level}`, keepNext: true });
    case 'p': return p(W.rich(b.rich));
    case 'callout': return p(W.rich(b.rich), { style: 'Callout', shade: b.tone === 'warn' ? 'FFF3EF' : PANEL, box: b.tone === 'warn' ? EMBER : NAVY });
    case 'bullets': return b.items.map((q) => p(W.rich(q), { style: 'ListBullet', numId: 1 })).join('');
    case 'point': {
      const head = b.fig ? p(W.fig(b.fig, { sz: 32, color: NAVY }), { keepNext: true, spaceAfter: 0 }) : '';
      return head + p(W.rich(b.line, { b: true }), { keepNext: !!b.comeback, spaceAfter: b.comeback ? 40 : 160 }) + (b.comeback ? p(r('התשובה: ', { b: true, color: MUTED }) + W.rich(b.comeback, { color: MUTED }), { style: 'Small', spaceAfter: 200 }) : '');
    }
    case 'exhibit': {
      const ex = b.ex, rows = exhibitRows(ex), src = exhibitSourceLine(ex, b.figs, W.ctx);
      const cap = p(r(ex.title, { b: true, sz: 22 }) + ([ex.unit, ex.span].filter(Boolean).length ? r(`  ·  ${[ex.unit, ex.span].filter(Boolean).join(' · ')}`, { color: MUTED, sz: 17 }) : ''), { style: 'Caption', keepNext: true });
      const body = img[i] ? W.image(img[i], ex.title) : table(rows[0].map((h) => cellText(h, { b: true, color: MUTED })), rows.slice(1).map((q) => q.map((c, k) => cellText(c, k === 0 ? { b: true } : {}))), undefined, true);
      const foot = ex.foot.map((f, k) => p(r(`(${k + 1}) ${f}`), { style: 'Small' })).join('');
      return cap + body + foot + (src ? p(r(src), { style: 'Small' }) : '') + (b.note ? p(r(b.note, { i: true })) : '');
    }
    case 'table': {
      const hd = b.head.some(Boolean) ? b.head.map((h) => r(h, { b: true, color: MUTED })) : null;
      const rows = b.rows.map((q) => q.map((c, k) => (typeof c === 'string' ? cellText(c, !hd && k === 0 ? { b: true, color: MUTED } : {}) : W.rich(c))));
      const n = Math.max(...b.rows.map((q) => q.length));
      const ws = !hd && n === 2 ? [Math.round(TEXT_W * 0.18), TEXT_W - Math.round(TEXT_W * 0.18)] : undefined;
      return table(hd, rows, ws) + (b.foot?.length ? p(r(b.foot.join(' · ')), { style: 'Small' }) : '');
    }
    case 'options': {
      const out: string[] = [];
      for (const o of b.items) {
        out.push(p(o.name.split(/(⟦[^⟧]*⟧)/).filter(Boolean).map((s) => (s.startsWith('⟦') ? r(s, { b: true, hl: true }) : r(s, { b: true }))).join(''), { style: 'Heading3', keepNext: true }));
        out.push(p(r('בעד', { b: true, color: MUTED }), { keepNext: true, spaceAfter: 0 }), ...o.pro.map((q) => p(W.rich(q), { style: 'ListBullet', numId: 1 })));
        out.push(p(r('נגד', { b: true, color: MUTED }), { keepNext: true, spaceAfter: 0 }), ...o.con.map((q) => p(W.rich(q), { style: 'ListBullet', numId: 1 })));
      }
      if (b.rec) out.push(p(r('המלצה: ', { b: true }) + W.rich(b.rec), { style: 'Callout', shade: 'FFFBEA', box: 'B07A0A' }));
      return out.join('');
    }
    case 'pagebreak': return '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';
  }
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:color w:val="${NAVY}"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="he-IL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:bidi/></w:pPr><w:rPr><w:rtl/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:bidi/><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:bidi/><w:spacing w:after="60"/></w:pPr><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Byline"><w:name w:val="Byline"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="${NAVY}"/></w:pBdr><w:bidi/><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="687086"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Kind"><w:name w:val="Kind"/><w:basedOn w:val="Normal"/><w:pPr><w:bidi/><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="${EMBER}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="${LINE}"/></w:pBdr><w:bidi/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:bidi/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:bidi/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Callout"><w:name w:val="Callout"/><w:basedOn w:val="Normal"/><w:pPr><w:bidi/><w:spacing w:before="60" w:after="160"/><w:ind w:left="113" w:right="113"/></w:pPr><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="Normal"/><w:pPr><w:bidi/><w:spacing w:after="40"/></w:pPr><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="${NAVY}"/></w:pBdr><w:bidi/><w:spacing w:before="200" w:after="80"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:bidi/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:bidi/><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:bidi/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:color w:val="${EMBER}"/><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F3E8A"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:bidi/><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="687086"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr></w:style>
</w:styles>`;
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:bidi/><w:ind w:left="360" w:hanging="300"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${W_NS}><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><w:themeFontLang w:val="en-US" w:bidi="he-IL"/></w:settings>`;

/** the .docx file as bytes */
export async function docxBytes(doc: Doc, opt: DocxOpt = {}): Promise<Uint8Array> {
  const ctx = opt.ctx ?? {}, P = prepare(doc, ctx), W = new Writer(P, ctx), img = opt.images ?? {};
  const mix = basisMix(P);
  const by = [doc.author, doc.date, doc.asof ? `נתונים נכון ל-${doc.asof}` : '', mix].filter(Boolean).join(' · ');
  const title = doc.title.split(/(⟦[^⟧]*⟧)/).filter(Boolean).map((s) => (s.startsWith('⟦') ? r(s, { hl: true }) : r(s))).join('');
  const parts: string[] = [
    ...(opt.kindLabel ? [p(r(opt.kindLabel), { style: 'Kind' })] : []),
    p(title, { style: 'Title' }), ...(doc.subtitle ? [p(r(doc.subtitle), { style: 'Subtitle' })] : []), p(r(by), { style: 'Byline' }),
    ...doc.blocks.map((b, i) => block(W, b, i, img)),
  ];
  if (doc.assumptions?.length) parts.push(p(r('יומן הנחות'), { style: 'Heading1', keepNext: true }), ...doc.assumptions.map((a) => p(r(a), { style: 'ListBullet', numId: 1 })));
  if (P.sources.length) {
    parts.push(p(r('מקורות'), { style: 'Heading1', keepNext: true }));
    P.sources.forEach((c) => {
      const u = citeUrl(c);
      const body = u ? `<w:hyperlink r:id="${W.rel('hyperlink', u, true)}" w:history="1">${r(citeText(c), { style: 'Hyperlink' })}</w:hyperlink>` : r(citeText(c));
      parts.push(p(body, { style: 'ListBullet', numId: 1 }));
    });
  }
  const footer = W.rel('footer', 'footer1.xml');
  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="${footer}"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/><w:cols w:space="708"/><w:bidi/><w:docGrid w:linePitch="360"/></w:sectPr>`;
  const NS_DOC = `${W_NS} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS_DOC}><w:body>${parts.join('')}${sect}</w:body></w:document>`;
  const sep = (t: string, id: number, el: string) => `<w:footnote w:type="${t}" w:id="${id}"><w:p><w:pPr><w:bidi/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:${el}/></w:r></w:p></w:footnote>`;
  const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ${W_NS}>${sep('separator', -1, 'separator')}${sep('continuationSeparator', 0, 'continuationSeparator')}${W.foot.join('')}</w:footnotes>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${W_NS}>${p(r([doc.author, doc.date].filter(Boolean).join(' · ') + (doc.author || doc.date ? ' · ' : '') + 'עמוד ') + '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>', { style: 'Footer' })}</w:ftr>`;
  const created = opt.created ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(doc.title)}</dc:title><dc:creator>${x(doc.author)}</dc:creator><cp:lastModifiedBy>${x(doc.author)}</cp:lastModifiedBy><dc:language>he-IL</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`;
  const OD = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>`
    + `<Override PartName="/word/document.xml" ContentType="${OD}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${OD}.styles+xml"/><Override PartName="/word/settings.xml" ContentType="${OD}.settings+xml"/>`
    + `<Override PartName="/word/numbering.xml" ContentType="${OD}.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="${OD}.footnotes+xml"/><Override PartName="/word/footer1.xml" ContentType="${OD}.footer+xml"/>`
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R}/settings" Target="settings.xml"/><Relationship Id="rId3" Type="${R}/numbering" Target="numbering.xml"/><Relationship Id="rId4" Type="${R}/footnotes" Target="footnotes.xml"/>${W.rels.join('')}</Relationships>`;
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', types);
  zip.file('_rels/.rels', rootRels);
  zip.file('docProps/core.xml', core);
  zip.file('word/document.xml', document);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/settings.xml', SETTINGS);
  zip.file('word/numbering.xml', NUMBERING);
  zip.file('word/footnotes.xml', footnotes);
  zip.file('word/footer1.xml', footerXml);
  zip.file('word/_rels/document.xml.rels', docRels);
  W.media.forEach((m) => zip.file(`word/media/${m.name}`, m.data));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
