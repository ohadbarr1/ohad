/** A small XLSX writer: real numbers with number formats, live formulas, bold and header rows, frozen panes, right-to-left sheets
 *  and per-cell hyperlinks. No dependency: the workbook is a zip of a few XML parts; `xlsxBlobAsync` deflates it with the browser's
 *  own CompressionStream (a full company workbook is tens of thousands of cells), `xlsxBlob` stores it. Loaded only when a reader exports. */
export type XFmt = 'n0' | 'n1' | 'n2' | 'pct1' | 'pct2' | 'x2';
export type XCell = string | number | null | undefined | {
  v: string | number | null; link?: string; bold?: boolean; fmt?: XFmt; italic?: boolean;
  /** a formula without "=" ("C5-D5"); `v` is its cached value */
  f?: string;
  /** a header cell: white on navy */
  head?: boolean;
  /** a section row: bold on the light panel colour */
  band?: boolean;
  /** muted text (units, notes) */
  muted?: boolean;
};
export interface XSheet { name: string; rows: XCell[][]; widths?: number[]; freeze?: { rows: number; cols: number }; ltr?: boolean;
  /** columns (0-based) hidden by default: source columns a reader can unhide */
  hidden?: number[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const col = (i: number): string => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
export const cellRef = (r: number, c: number) => `${col(c)}${r + 1}`;

// fonts: 0 plain, 1 bold, 2 italic muted, 3 link, 4 bold white, 5 muted, 6 bold link
const FONTS = ['<font><sz val="10"/><name val="Arial"/></font>', '<font><b/><sz val="10"/><name val="Arial"/></font>', '<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Arial"/></font>',
  '<font><u/><sz val="10"/><color rgb="FF2F3B8C"/><name val="Arial"/></font>', '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>', '<font><sz val="9"/><color rgb="FF687086"/><name val="Arial"/></font>',
  '<font><b/><u/><sz val="10"/><color rgb="FF2F3B8C"/><name val="Arial"/></font>'];
// fills: 0 none, 1 gray125 (required), 2 navy, 3 panel
const FILLS = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FF111C3F"/><bgColor indexed="64"/></patternFill></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F2F6"/><bgColor indexed="64"/></patternFill></fill>'];
const NUMFMT: Record<XFmt, number> = { n0: 164, n1: 165, n2: 166, pct1: 167, pct2: 168, x2: 169 };
const NUMFMTS = '<numFmts count="6"><numFmt numFmtId="164" formatCode="#,##0;[Red]-#,##0"/><numFmt numFmtId="165" formatCode="#,##0.0;[Red]-#,##0.0"/><numFmt numFmtId="166" formatCode="#,##0.00;[Red]-#,##0.00"/><numFmt numFmtId="167" formatCode="0.0&quot;%&quot;;[Red]-0.0&quot;%&quot;"/><numFmt numFmtId="168" formatCode="0.00&quot;%&quot;"/><numFmt numFmtId="169" formatCode="0.00&quot;x&quot;"/></numFmts>';

/** cell styles met while writing, deduplicated: font|numFmt|fill → xf index */
class Styles {
  private keys: string[] = ['0|0|0'];
  private idx = new Map<string, number>([['0|0|0', 0]]);
  of(c: XCell): number {
    if (c == null || typeof c === 'string') return 0;
    if (typeof c === 'number') return this.get(0, NUMFMT.n1, 0);
    const isNum = typeof c.v === 'number';
    const font = c.head ? 4 : c.link ? (c.bold ? 6 : 3) : c.bold || c.band ? 1 : c.italic ? 2 : c.muted ? 5 : 0;
    const fill = c.head ? 2 : c.band ? 3 : 0;
    const fmt = isNum ? NUMFMT[c.fmt ?? 'n1'] : 0;
    return this.get(font, fmt, fill);
  }
  private get(font: number, fmt: number, fill: number): number {
    const k = `${font}|${fmt}|${fill}`;
    let i = this.idx.get(k);
    if (i == null) { i = this.keys.length; this.keys.push(k); this.idx.set(k, i); }
    return i;
  }
  xml(): string {
    const xfs = this.keys.map((k) => { const [f, n, l] = k.split('|').map(Number); return `<xf numFmtId="${n}" fontId="${f}" fillId="${l}" borderId="0"${n ? ' applyNumberFormat="1"' : ''}${f ? ' applyFont="1"' : ''}${l ? ' applyFill="1"' : ''}/>`; }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${NUMFMTS}<fonts count="${FONTS.length}">${FONTS.join('')}</fonts><fills count="${FILLS.length}">${FILLS.join('')}</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="${this.keys.length}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

function sheetXml(sh: XSheet, links: { ref: string; id: string; url: string }[], st: Styles): string {
  const parts: string[] = [];
  sh.rows.forEach((r, ri) => {
    const cells: string[] = [];
    r.forEach((c, ci) => {
      if (c == null || c === '') return;
      const ref = `${col(ci)}${ri + 1}`;
      const o = typeof c === 'object' ? c : { v: c };
      if (o.v == null && !('f' in o && o.f)) return;
      if ('link' in o && o.link) links.push({ ref, id: `rId${links.length + 1}`, url: o.link });
      const s = st.of(c);
      if ('f' in o && o.f) cells.push(`<c r="${ref}" s="${s}"><f>${esc(o.f)}</f>${typeof o.v === 'number' ? `<v>${o.v}</v>` : ''}</c>`);
      else if (typeof o.v === 'number') cells.push(`<c r="${ref}" s="${s}"><v>${o.v}</v></c>`);
      else cells.push(`<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(o.v))}</t></is></c>`);
    });
    parts.push(`<row r="${ri + 1}">${cells.join('')}</row>`);
  });
  const fr = sh.freeze, pane = fr && (fr.rows || fr.cols) ? `<pane ${fr.cols ? `xSplit="${fr.cols}" ` : ''}${fr.rows ? `ySplit="${fr.rows}" ` : ''}topLeftCell="${col(fr.cols)}${fr.rows + 1}" activePane="bottomRight" state="frozen"/>` : '';
  const hidden = new Set(sh.hidden ?? []);
  const n = Math.max(sh.widths?.length ?? 0, ...[...hidden].map((h) => h + 1));
  const cols = n ? `<cols>${Array.from({ length: n }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${sh.widths?.[i] ?? 12}" customWidth="1"${hidden.has(i) ? ' hidden="1"' : ''}/>`).join('')}</cols>` : '';
  const hl = links.length ? `<hyperlinks>${links.map((l) => `<hyperlink ref="${l.ref}" r:id="${l.id}"/>`).join('')}</hyperlinks>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView ${sh.ltr ? '' : 'rightToLeft="1" '}workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="13.2"/>${cols}<sheetData>${parts.join('')}</sheetData>${hl}</worksheet>`;
}

function parts(sheets: XSheet[], meta?: { title?: string; author?: string }): [string, string][] {
  const files: [string, string][] = [];
  const used = new Set<string>();
  const names = sheets.map((s, i) => {
    let n = (s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Sheet${i + 1}`;
    for (let k = 2; used.has(n.toLowerCase()); k++) n = `${n.slice(0, 28)} ${k}`;
    used.add(n.toLowerCase());
    return esc(n);
  });
  const st = new Styles();
  const sheetFiles: [string, string][] = [];
  sheets.forEach((sh, i) => {
    const links: { ref: string; id: string; url: string }[] = [];
    sheetFiles.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh, links, st)]);
    if (links.length) sheetFiles.push([`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((l) => `<Relationship Id="${l.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`).join('')}</Relationships>`]);
  });
  files.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`]);
  files.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`]);
  files.push(['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta?.title ?? 'fox')}</dc:title><dc:creator>${esc(meta?.author ?? 'fox')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`]);
  // full calculation on load: every formula is recomputed by Excel; the cached values serve readers that do not calculate
  files.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`]);
  files.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
  files.push(['xl/styles.xml', st.xml()]);
  return [...files, ...sheetFiles];
}

// ---- zip: stored, or deflated by the browser ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function zipOf(files: { name: Uint8Array; data: Uint8Array; raw: number; crc: number; method: 0 | 8 }[]): Blob {
  const out: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, f.method, true); h.setUint32(14, f.crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.raw, true); h.setUint16(26, f.name.length, true);
    out.push(new Uint8Array(h.buffer), f.name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, f.method, true); c.setUint32(16, f.crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.raw, true); c.setUint16(28, f.name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), f.name);
    off += 30 + f.name.length + f.data.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...out, ...central, new Uint8Array(e.buffer)] as BlobPart[], { type: MIME });
}

export function xlsxBlob(sheets: XSheet[], meta?: { title?: string }): Blob {
  const enc = new TextEncoder();
  return zipOf(parts(sheets, meta).map(([n, t]) => { const d = enc.encode(t); return { name: enc.encode(n), data: d, raw: d.length, crc: crc32(d), method: 0 as const }; }));
}

/** The same workbook, deflated: a large workbook shrinks about tenfold. Falls back to stored where CompressionStream is missing. */
export async function xlsxBlobAsync(sheets: XSheet[], meta?: { title?: string }): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return xlsxBlob(sheets, meta);
  const enc = new TextEncoder();
  const files = await Promise.all(parts(sheets, meta).map(async ([n, t]) => {
    const d = enc.encode(t);
    const z = new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return { name: enc.encode(n), data: z, raw: d.length, crc: crc32(d), method: 8 as const };
  }));
  return zipOf(files);
}

function saveAs(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name.endsWith('.xlsx') ? name : `${name}.xlsx`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function downloadXlsx(name: string, sheets: XSheet[]): void { saveAs(name, xlsxBlob(sheets)); }
export async function downloadXlsxAsync(name: string, sheets: XSheet[], meta?: { title?: string }): Promise<void> { saveAs(name, await xlsxBlobAsync(sheets, meta)); }
