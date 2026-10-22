/** A small XLSX writer: real numbers with number formats, bold rows, frozen panes, right-to-left sheets and per-cell hyperlinks.
 *  No dependency: the workbook is a zip of a few XML parts, stored without compression. Loaded only when a reader exports. */
export type XCell = string | number | null | undefined | { v: string | number | null; link?: string; bold?: boolean; fmt?: 'n0' | 'n1' | 'n2' | 'pct1'; italic?: boolean };
export interface XSheet { name: string; rows: XCell[][]; widths?: number[]; freeze?: { rows: number; cols: number } }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i: number): string => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
// style ids: 0 plain, 1 bold, 2 n0, 3 n1, 4 n2, 5 bold n0, 6 bold n1, 7 bold n2, 8 italic n1, 9 pct1, 10 link (blue, underlined) n1
function styleOf(c: Exclude<XCell, string | number | null | undefined>): number {
  if (typeof c.v !== 'number') return c.bold ? 1 : 0;
  if (c.fmt === 'pct1') return 9;
  const f = c.fmt ?? 'n1';
  if (c.bold) return { n0: 5, n1: 6, n2: 7 }[f as 'n0' | 'n1' | 'n2'] ?? 6;
  if (c.italic) return 8;
  if (c.link) return 10;
  return { n0: 2, n1: 3, n2: 4 }[f as 'n0' | 'n1' | 'n2'] ?? 3;
}

function sheetXml(sh: XSheet, links: { ref: string; id: string }[]): string {
  const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
    if (c == null || c === '') return '';
    const ref = `${col(ci)}${ri + 1}`;
    const o = typeof c === 'object' ? c : { v: c };
    if (o.v == null) return '';
    if ('link' in o && o.link) links.push({ ref, id: `rId${links.length + 1}` });
    const s = typeof c === 'object' ? styleOf(c) : typeof c === 'number' ? 3 : 0;
    return typeof o.v === 'number' ? `<c r="${ref}" s="${s}"><v>${o.v}</v></c>` : `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(o.v))}</t></is></c>`;
  }).join('')}</row>`).join('');
  const fr = sh.freeze, pane = fr && (fr.rows || fr.cols) ? `<pane ${fr.cols ? `xSplit="${fr.cols}" ` : ''}${fr.rows ? `ySplit="${fr.rows}" ` : ''}topLeftCell="${col(fr.cols)}${fr.rows + 1}" activePane="bottomRight" state="frozen"/>` : '';
  const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const hl = links.length ? `<hyperlinks>${links.map((l) => `<hyperlink ref="${l.ref}" r:id="${l.id}"/>`).join('')}</hyperlinks>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView rightToLeft="1" workbookViewId="0">${pane}</sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData>${hl}</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.0;[Red]-#,##0.0"/><numFmt numFmtId="166" formatCode="#,##0.00"/><numFmt numFmtId="167" formatCode="0.0&quot;%&quot;"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><i/><sz val="11"/><color rgb="FF6B7280"/><name val="Arial"/></font><font><u/><sz val="11"/><color rgb="FF2F3B8C"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="11"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" applyNumberFormat="1" applyFont="1"/><xf numFmtId="165" fontId="1" applyNumberFormat="1" applyFont="1"/><xf numFmtId="166" fontId="1" applyNumberFormat="1" applyFont="1"/><xf numFmtId="165" fontId="2" applyNumberFormat="1" applyFont="1"/><xf numFmtId="167" applyNumberFormat="1"/><xf numFmtId="165" fontId="3" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// ---- zip, stored ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: [string, string][]): Blob {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name), d = enc.encode(text), crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    parts.push(new Uint8Array(h.buffer), n, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, n.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), n);
    off += 30 + n.length + d.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)] as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function xlsxBlob(sheets: XSheet[]): Blob {
  const files: [string, string][] = [];
  const names = sheets.map((s, i) => esc((s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)));
  files.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`]);
  files.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
  files.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`]);
  files.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
  files.push(['xl/styles.xml', STYLES]);
  sheets.forEach((sh, i) => {
    const links: { ref: string; id: string }[] = [];
    const xml = sheetXml(sh, links);
    files.push([`xl/worksheets/sheet${i + 1}.xml`, xml]);
    if (links.length) {
      const urls: string[] = [];
      sh.rows.forEach((r) => r.forEach((c) => { if (c && typeof c === 'object' && c.link && c.v != null) urls.push(c.link); }));
      files.push([`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((l, k) => `<Relationship Id="${l.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(urls[k])}" TargetMode="External"/>`).join('')}</Relationships>`]);
    }
  });
  return zip(files);
}

export function downloadXlsx(name: string, sheets: XSheet[]): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(xlsxBlob(sheets)); a.download = name.endsWith('.xlsx') ? name : `${name}.xlsx`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
