import type { ChartSpec } from './book';
import { citeDocs, pagesText } from './exportProv';
import { pubLabel } from './format';
import { pdfPage } from './sources';
import { downloadXlsxAsync, type XCell, type XSheet } from './xlsx';

/** The book as a workbook: one sheet per chart with the plotted figures (series × periods), and a sheet of sources. */
export async function exportBookXlsx(items: ChartSpec[], title: string, host: string) {
  const built = new Date().toISOString();
  const head = (v: string): XCell => ({ v, head: true });
  const sheets: XSheet[] = items.map((s, i) => {
    const rows: XCell[][] = [
      [{ v: s.title || s.label, bold: true }],
      [{ v: [s.title !== s.label ? s.label : '', s.unit, s.span, `${host}${s.route}`].filter(Boolean).join(' · '), muted: true }],
    ];
    if (s.kind === 'scatter') {
      rows.push([head('סדרה'), head('נקודה'), head(s.xName || 'X'), head(s.yName || 'Y')]);
      s.series.forEach((x) => (x.xy ?? []).forEach((p) => rows.push([x.name, p[2] ?? '', { v: p[0], fmt: 'n2' }, { v: p[1], fmt: 'n2' }])));
    } else {
      rows.push([head(''), ...s.cats.map(head)]);
      s.series.filter((x) => !x.hidden).forEach((x) => rows.push([x.name || s.label, ...x.data.map((v): XCell => (v == null ? null : { v, fmt: Math.abs(v) < 100 && !Number.isInteger(v) ? 'n2' : 'n1' }))]));
    }
    if (s.note) rows.push([], [{ v: s.note, italic: true }]);
    return { name: `${i + 1} ${s.title || s.label}`.slice(0, 31), rows, widths: [30, ...s.cats.map(() => 11)], freeze: { rows: 3, cols: 1 } };
  });
  const src: XCell[][] = [[{ v: `${title} · מקורות`, bold: true }], [{ v: `נתונים ${pubLabel(items[0]?.dataDate ?? built)} · הופק ${pubLabel(built)} · ${host}`, muted: true }],
    [head('גיליון'), head('גרף'), head('מקור'), head('עמודים'), head('קישור')]];
  items.forEach((s, i) => {
    const { docs, formulas, texts } = citeDocs(s.sources);
    docs.forEach((d) => { const u = d.url ? (d.kind === 'report' ? pdfPage(d.url, d.pages[0]) : d.url) : null; src.push([String(i + 1), s.title || s.label, d.doc, d.pages.length ? pagesText(d.pages) : '', u ? { v: u, link: u } : '']); });
    texts.forEach((t) => src.push([String(i + 1), s.title || s.label, t, '', '']));
    formulas.forEach((f) => src.push([String(i + 1), s.title || s.label, { v: `מחושב באתר: ${f}`, italic: true }, '', '']));
  });
  await downloadXlsxAsync(`fox-${title.replace(/\s+/g, '-')}-${pubLabel(built)}`, [...sheets, { name: 'מקורות', rows: src, widths: [8, 36, 44, 18, 70], freeze: { rows: 3, cols: 0 } }], { title });
}
