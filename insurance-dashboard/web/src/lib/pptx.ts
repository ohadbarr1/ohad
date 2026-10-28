import type PptxGenJS from 'pptxgenjs';
import type { ChartSpec, BookSeries } from './book';
import { idOfName } from './book';
import { citeDocs, pagesText, type SrcRef } from './exportProv';
import { idCss } from './identity';
import { pubLabel } from './format';
import { pdfPage } from './sources';

/* Native PowerPoint export of the chart book: every chart is a real PowerPoint chart (its data editable in PowerPoint), not a picture.
   16:9, one chart per slide, the title as the takeaway, unit and period span beneath it, a source footnote with the filing pages
   (each document a link to its page), the fox mark and the page number; a cover and a sources slide. pptxgenjs is loaded only here,
   only when a reader exports. */

export type DeckTheme = 'phoenix' | 'dark';
interface Tone { bg: string; ink: string; muted: string; faint: string; line: string; accent: string; accentText: string; cover: string; coverInk: string; panel: string }
const TONES: Record<DeckTheme, Tone> = {
  // the site's tokens: navy ink, ember accent (phoenix); obsidian with a warm accent (dark)
  phoenix: { bg: 'FFFFFF', ink: '111C3F', muted: '4F5668', faint: '687086', line: 'D3D7DF', accent: 'FF4E31', accentText: 'C2391C', cover: '111C3F', coverInk: 'FFFFFF', panel: 'F1F2F6' },
  dark: { bg: '161310', ink: 'F7F4F0', muted: 'BDB4A9', faint: '9E968C', line: '3D3631', accent: 'F59A4B', accentText: 'F7AE6E', cover: '0E0C0A', coverInk: 'F7F4F0', panel: '221E1A' },
};
const FONT = 'Arial';  // installed with every copy of PowerPoint and Keynote and carries Hebrew; a web font would be substituted on the reader's machine
const W = 13.333, H = 7.5, M = 0.5;
const HE = { lang: 'he-IL', rtlMode: true } as const;

/** a CSS colour (oklch, rgb, #hex) as PowerPoint hex, through the browser's own colour parser */
function hexOf(css: string): string {
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return '7A7F8C';
  c.fillStyle = '#7A7F8C'; c.fillStyle = css; c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  return [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
const PALETTE: Record<DeckTheme, string[]> = {
  phoenix: ['2B54B8', 'D4451F', '5B67D6', '00978A', '9A5A2C', '8A4FC2', 'B07A0A', 'B03A76', '2E86D1', 'C7337A', '6E8B00'],
  dark: ['6A8EE7', 'E26940', '8289DA', '00AA98', 'C77F3F', 'A579DB', 'BA8900', 'D4689E', '439AD6', 'E15C97', '85A000'],
};
const HIDDEN = 'FEFEFD';  // a spacer series (waterfall base); its fill is removed after the deck is written
function colorOf(s: BookSeries, i: number, t: DeckTheme): string {
  if (s.hidden) return HIDDEN;
  if (s.id) return hexOf(idCss(s.id, t));
  return s.color ? carry(s.color, t) : PALETTE[t][i % 11];
}
/** a colour captured on screen, in the deck's theme: palette slots and the accent follow the theme, anything else is kept */
function carry(c: string, t: DeckTheme): string {
  const h = c.replace('#', '').toUpperCase();
  const k = Math.max(PALETTE.phoenix.indexOf(h), PALETTE.dark.indexOf(h));
  if (k >= 0) return PALETTE[t][k];
  if (h === 'FF4E31' || h === 'F59A4B') return TONES[t].accent;
  if (h === TONES.phoenix.ink || h === TONES.dark.ink) return TONES[t].ink;
  return h;
}
const decOf = (vals: (number | null)[]): number => { const m = Math.max(0, ...vals.map((v) => Math.abs(v ?? 0))); return m >= 100 ? 0 : m >= 1 ? 1 : 2; };
const fmtCode = (d: number) => (d === 0 ? '#,##0' : d === 1 ? '#,##0.0' : '#,##0.00');

export interface DeckMeta { title: string; theme: DeckTheme; host: string; built: string; dataDate?: string;
  /** false: the user's own material, sent as theirs (S6 exhibits): no fox mark, no site link or author / company, no "fox-" file prefix,
   *  no sources slide (the slide's footnote carries the sources). Default (undefined / true): the chart book's branded deck. */
  brand?: boolean }
/** a spec may carry a table instead of a chart (an S6 exhibit table) and footnotes printed above the source line */
type SlideSpec = ChartSpec & { table?: (string | number | null)[][]; foot?: string[] };

/** The footnote of a slide: documents with their pages (each a link to the first page), credits, the computation; then the stamp. */
function footRuns(spec: ChartSpec, t: Tone, meta: DeckMeta, maxDocs = 5): PptxGenJS.TextProps[] {
  const { docs, formulas, texts } = citeDocs(spec.sources);
  const opt = (o: PptxGenJS.TextPropsOptions = {}): PptxGenJS.TextPropsOptions => ({ fontFace: FONT, fontSize: 8.5, color: t.muted, ...HE, ...o });
  const runs: PptxGenJS.TextProps[] = [{ text: 'מקור: ', options: opt({ bold: true, color: t.ink }) }];
  const parts: PptxGenJS.TextProps[] = [];
  docs.slice(0, maxDocs).forEach((d) => {
    const txt = `${d.doc}${d.pages.length ? `, ${pagesText(d.pages)}` : ''}`;
    parts.push({ text: txt, options: opt(d.url ? { hyperlink: { url: d.kind === 'report' ? pdfPage(d.url, d.pages[0]) : d.url, tooltip: 'פתיחת המקור' }, color: t.muted } : {}) });
  });
  if (docs.length > maxDocs) parts.push({ text: `ועוד ${docs.length - maxDocs} מסמכים (שקף המקורות)`, options: opt() });
  texts.forEach((x) => parts.push({ text: x, options: opt() }));
  if (formulas.length) parts.push({ text: `מחושב באתר: ${formulas[0]}${formulas.length > 1 ? ` (ועוד ${formulas.length - 1})` : ''}`, options: opt({ italic: true }) });
  if (!parts.length) parts.push({ text: 'הדוחות של החברות ונתוני רשות שוק ההון', options: opt() });
  parts.forEach((p, i) => { runs.push(p); if (i < parts.length - 1) runs.push({ text: ' · ', options: opt() }); });
  const foot = (spec as SlideSpec).foot?.filter(Boolean) ?? [];
  if (foot.length) runs.unshift({ text: foot.join(' · '), options: opt({ color: t.ink, breakLine: true }) });
  runs.push({ text: '', options: opt({ breakLine: true }) });
  if (meta.brand === false) {
    runs.push({ text: `נתונים ${pubLabel(spec.dataDate ?? meta.dataDate ?? meta.built)}`, options: opt({ color: t.faint }) });
    return runs;
  }
  const url = `https://${meta.host}${spec.route}`;
  runs.push({ text: `fox · `, options: opt({ color: t.faint, breakLine: false }) });
  runs.push({ text: `${meta.host}${spec.route.split('?')[0]}`, options: opt({ color: t.faint, hyperlink: { url, tooltip: 'הגרף באתר' } }) });
  runs.push({ text: ` · נתונים ${pubLabel(spec.dataDate ?? meta.dataDate ?? meta.built)} · הופק ${pubLabel(meta.built)}`, options: opt({ color: t.faint }) });
  return runs;
}

function chartOpts(spec: ChartSpec, t: Tone, theme: DeckTheme, x: number, y: number, w: number, h: number): PptxGenJS.IChartOpts {
  const shown = spec.series.filter((s) => !s.hidden), all = shown.flatMap((s) => s.data);
  const d = decOf(all), many = spec.cats.length > 14;
  return {
    x, y, w, h,
    chartColors: spec.series.map((s, i) => colorOf(s, i, theme)),
    showLegend: shown.length > 1 && shown.some((s) => !!s.name), legendPos: 't', ...(spec.vmin != null ? { valAxisMinVal: spec.vmin } : {}), legendFontFace: FONT, legendFontSize: 10, legendColor: t.muted,
    catAxisLabelColor: t.muted, catAxisLabelFontFace: FONT, catAxisLabelFontSize: spec.kind === 'hbar' ? 11 : 10, catAxisLineColor: t.line, catAxisLineShow: true,
    catAxisLabelRotate: !many || spec.kind === 'hbar' ? 0 : 315, catGridLine: { style: 'none' },
    valAxisLabelColor: t.muted, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 10, valAxisLineShow: false, valAxisLabelFormatCode: fmtCode(d === 2 ? 1 : d === 1 ? 0 : 0),
    valGridLine: { color: t.line, style: 'dash', size: 0.5 },
    showValue: shown.length <= 2 && !spec.series.some((s) => s.stack) && spec.cats.length <= 14, dataLabelFormatCode: fmtCode(d), dataLabelFontFace: FONT, dataLabelFontSize: 9, dataLabelColor: t.muted,
    dataLabelPosition: spec.kind === 'hbar' ? 'outEnd' : undefined,
    lineSize: 2, lineDataSymbol: spec.cats.length > 16 ? 'none' : 'circle', lineDataSymbolSize: 5,
    plotArea: { fill: { color: t.bg } },
  } as PptxGenJS.IChartOpts;
}

function addChart(pptx: PptxGenJS, slide: PptxGenJS.Slide, spec: ChartSpec, t: Tone, theme: DeckTheme, box: [number, number, number, number]) {
  const [x, y, w, h] = box;
  const C = pptx.ChartType, base = chartOpts(spec, t, theme, x, y, w, h);
  if (spec.kind === 'pie') {
    const s = spec.series[0];
    const colors = spec.cats.map((c, k) => { const id = idOfName(c); return id ? hexOf(idCss(id, theme)) : (s.pointColors?.[k] ? carry(s.pointColors[k]!, theme) : PALETTE[theme][k % 11]); });
    slide.addChart(C.doughnut, [{ name: s.name, labels: spec.cats, values: s.data.map((v) => v ?? 0) }], { ...base, chartColors: colors, holeSize: 55, showLegend: true, legendPos: 'r', showPercent: true, showValue: false, dataLabelColor: 'FFFFFF' } as PptxGenJS.IChartOpts);
    return;
  }
  if (spec.kind === 'scatter') {
    // points only: a reference line (P/B מוצדק) has no per-series stroke in a PowerPoint scatter, so it stays on the site's chart
    const pts = spec.series.flatMap((s, i) => (s.type === 'line' ? [] : (s.xy ?? []).map((p) => ({ i, p }))));
    const data = [{ name: spec.xName ?? 'X', values: pts.map((q) => q.p[0]) },
      ...spec.series.map((s, i) => ({ s, i })).filter(({ s }) => s.type !== 'line').map(({ s, i }) => ({ name: s.name || spec.yName || 'Y', values: pts.map((q) => (q.i === i ? q.p[1] : null)), labels: pts.map((q) => (q.i === i ? q.p[2] ?? '' : '')) }))];
    const sc = spec.series.filter((s) => s.type !== 'line');
    slide.addChart(C.scatter, data as PptxGenJS.OptsChartData[], { ...base, chartColors: sc.map((s) => colorOf(s, spec.series.indexOf(s), theme)), lineSize: 0, lineDataSymbol: 'circle', lineDataSymbolSize: 9, showLegend: sc.some((s) => (s.xy?.length ?? 0) > 1) && sc.length > 1, showValue: false,
      dataLabelFormatScatter: 'custom', showLabel: true, dataLabelPosition: 'r', showValAxisTitle: !!spec.yName, valAxisTitle: spec.yName, valAxisTitleColor: t.muted, valAxisTitleFontSize: 9,
      showCatAxisTitle: !!spec.xName, catAxisTitle: spec.xName, catAxisTitleColor: t.muted, catAxisTitleFontSize: 9, valAxisLabelFormatCode: '#,##0.0', catAxisLabelFormatCode: '#,##0.0' } as PptxGenJS.IChartOpts);
    return;
  }
  const hbar = spec.kind === 'hbar';
  const data = (ss: BookSeries[]) => ss.map((s) => ({ name: s.name || ' ', labels: spec.cats, values: s.data }));
  const stacked = spec.series.some((s) => s.stack);
  const bars = spec.series.filter((s) => s.type === 'bar'), lines = spec.series.filter((s) => s.type === 'line'), areas = spec.series.filter((s) => s.type === 'area');
  const second = spec.series.some((s) => s.axis === 1 && !s.hidden);
  const colorsFor = (ss: BookSeries[]) => ss.map((s) => colorOf(s, spec.series.indexOf(s), theme));
  const barOpts = { barDir: hbar ? 'bar' : 'col', barGrouping: stacked ? 'stacked' : 'clustered', barGapWidthPct: 60, catAxisOrientation: hbar ? 'maxMin' : 'minMax', valAxisOrientation: 'minMax' } as const;
  // one bar series coloured point by point (a bar per company): the companies keep their colours
  if (bars.length === 1 && !lines.length && !areas.length && bars[0].pointColors) {
    const s = bars[0];
    const pc = spec.cats.map((c, k) => { const id = idOfName(c); return id ? hexOf(idCss(id, theme)) : (s.pointColors?.[k] ? carry(s.pointColors[k]!, theme) : colorOf(s, 0, theme)); });
    slide.addChart(C.bar, data([s]), { ...base, ...barOpts, chartColors: pc, showLegend: false } as PptxGenJS.IChartOpts);
    return;
  }
  const kinds = [bars, lines, areas].filter((g) => g.length).length;
  if (kinds === 1 && !second) {
    const type = bars.length ? C.bar : lines.length ? C.line : C.area;
    slide.addChart(type, data(spec.series), { ...base, ...(bars.length ? barOpts : {}), ...(areas.length && stacked ? { barGrouping: 'stacked' } : {}) } as PptxGenJS.IChartOpts);
    return;
  }
  // bars with lines, or a second value axis: one combined chart
  const groups: { type: PptxGenJS.CHART_NAME; ss: BookSeries[]; sec: boolean }[] = [];
  for (const sec of [false, true]) {
    for (const [type, ss] of [[C.bar, bars], [C.area, areas], [C.line, lines]] as [PptxGenJS.CHART_NAME, BookSeries[]][]) {
      const g = ss.filter((s) => (s.axis === 1 && !s.hidden) === sec);
      if (g.length) groups.push({ type, ss: g, sec });
    }
  }
  const types = groups.map((g) => ({ type: g.type, data: data(g.ss), options: { chartColors: colorsFor(g.ss), showValue: g.type === C.bar && !!base.showValue, barGrouping: stacked ? 'stacked' : 'clustered', barDir: hbar ? 'bar' : 'col', secondaryValAxis: g.sec, secondaryCatAxis: g.sec } }));
  const ax = { valAxisLabelColor: t.muted, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 10, valGridLine: { color: t.line, style: 'dash', size: 0.5 } };
  // a combined chart takes its options in the place of the data (pptxgenjs: `addChart(types, options)`)
  slide.addChart(types as unknown as PptxGenJS.IChartMulti[], {
    ...base, ...(second ? { valAxes: [{ ...ax, showValAxisTitle: !!spec.unit, valAxisTitle: spec.unit }, { ...ax, valGridLine: { style: 'none' }, showValAxisTitle: true, valAxisTitle: spec.unit2 ?? '%' }],
      catAxes: [{ catAxisLabelColor: t.muted, catAxisLabelFontFace: FONT, catAxisLabelFontSize: 10 }, { catAxisHidden: true }] } : {}),
  } as unknown as unknown[]);
}

/** a table exhibit: the first row is the header; right to left, the first column drawn rightmost */
function addTable(slide: PptxGenJS.Slide, rows: (string | number | null)[][], t: Tone, box: [number, number, number, number]) {
  const [x, y, w, h] = box, n = Math.max(...rows.map((r) => r.length));
  const cell = (v: string | number | null, head: boolean, first: boolean): PptxGenJS.TableCell => ({ text: v == null ? '–' : typeof v === 'number' ? v.toLocaleString('he-IL') : String(v),
    options: { fontFace: FONT, fontSize: rows.length > 14 ? 9 : 11, color: head ? t.muted : t.ink, bold: head || first, align: first ? 'right' : 'center', valign: 'middle', ...HE, ...(head ? { fill: { color: t.panel } } : {}) } });
  const body = rows.map((r, i) => Array.from({ length: n }, (_, k) => cell(r[k] ?? null, i === 0, k === 0)).reverse());
  const first = Math.min(4.5, w * 0.36), rest = (w - first) / Math.max(1, n - 1);
  slide.addTable(body, { x, y, w, colW: [first, ...Array(n - 1).fill(rest)].reverse() as number[], rowH: Math.min(0.36, h / rows.length), border: { type: 'solid', pt: 0.5, color: t.line }, fill: { color: t.bg }, margin: 0.05 });
}

function frame(slide: PptxGenJS.Slide, t: Tone, n: number, brand = true) {
  // fox mark, top left; page number, bottom left (the deck reads right to left: title and footnote sit on the right)
  if (brand) slide.addText([{ text: 'fox', options: { color: t.ink, bold: true } }, { text: '.', options: { color: t.accent, bold: true } }], { x: M - 0.05, y: 0.28, w: 1.2, h: 0.4, fontFace: FONT, fontSize: 14, align: 'left', margin: 0 });
  slide.addText(String(n), { x: M - 0.05, y: H - 0.48, w: 0.8, h: 0.3, fontFace: FONT, fontSize: 9, color: t.faint, align: 'left', margin: 0 });
}

function chartSlide(pptx: PptxGenJS, spec: ChartSpec, meta: DeckMeta, n: number) {
  const t = TONES[meta.theme], slide = pptx.addSlide();
  slide.background = { color: t.bg };
  frame(slide, t, n, meta.brand !== false);
  slide.addText(spec.title || spec.label, { x: M + 1.3, y: 0.24, w: W - 2 * M - 1.3, h: 0.62, fontFace: FONT, fontSize: 22, bold: true, color: t.ink, align: 'right', valign: 'middle', margin: 0, fit: 'shrink', ...HE });
  const sub = [spec.title !== spec.label ? spec.label : '', spec.kind === 'scatter' ? [spec.xName, spec.yName].filter(Boolean).join(' מול ') : spec.unit, spec.span].filter(Boolean).join(' · ');
  slide.addText(sub || ' ', { x: M, y: 0.86, w: W - 2 * M, h: 0.34, fontFace: FONT, fontSize: 12, color: t.muted, align: 'right', margin: 0, ...HE });
  // the house rule: a thin navy line under the head, ember at its start (the right end, in a right-to-left deck)
  slide.addShape(pptx.ShapeType.rect, { x: M, y: 1.27, w: W - 2 * M, h: 0.012, fill: { color: t.line }, line: { color: t.line, width: 0 } });
  slide.addShape(pptx.ShapeType.rect, { x: W - M - 0.9, y: 1.255, w: 0.9, h: 0.04, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
  const note = spec.note?.trim();
  const top = note ? 1.82 : 1.42;
  if (note) slide.addText(note, { x: M, y: 1.36, w: W - 2 * M, h: 0.42, fontFace: FONT, fontSize: 12, color: t.ink, italic: true, align: 'right', margin: 0, fit: 'shrink', ...HE });
  const table = (spec as SlideSpec).table;
  if (table && table.length > 1) addTable(slide, table, t, [M, top, W - 2 * M, 6.18 - top]);
  else addChart(pptx, slide, spec, t, meta.theme, [M, top, W - 2 * M, 6.18 - top]);
  slide.addShape(pptx.ShapeType.rect, { x: M, y: 6.27, w: W - 2 * M, h: 0.008, fill: { color: t.line }, line: { color: t.line, width: 0 } });
  slide.addText(footRuns(spec, t, meta), { x: M + 0.9, y: 6.32, w: W - 2 * M - 0.9, h: 0.78, align: 'right', valign: 'top', margin: 0, fit: 'shrink', paraSpaceAfter: 2, ...HE });
  if (note) slide.addNotes(note);
}

function coverSlide(pptx: PptxGenJS, items: ChartSpec[], meta: DeckMeta) {
  const t = TONES[meta.theme], slide = pptx.addSlide();
  slide.background = { color: t.cover };
  slide.addText([{ text: 'fox', options: { color: t.coverInk, bold: true } }, { text: '.', options: { color: t.accent, bold: true } }], { x: M, y: 0.4, w: 2, h: 0.6, fontFace: FONT, fontSize: 26, align: 'left', margin: 0 });
  slide.addShape(pptx.ShapeType.rect, { x: W - M - 1.2, y: 2.2, w: 1.2, h: 0.06, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
  slide.addText(meta.title, { x: M, y: 2.4, w: W - 2 * M, h: 1.1, fontFace: FONT, fontSize: 40, bold: true, color: t.coverInk, align: 'right', valign: 'top', margin: 0, fit: 'shrink', ...HE });
  const spans = items.map((s) => s.span).filter(Boolean) as string[];
  slide.addText(`${items.length} גרפים · נתונים ${pubLabel(meta.dataDate ?? meta.built)} · הופק ${pubLabel(meta.built)}${spans.length ? ` · ${spans[0]}` : ''}`, { x: M, y: 3.55, w: W - 2 * M, h: 0.45, fontFace: FONT, fontSize: 16, color: t.coverInk, transparency: 25, align: 'right', margin: 0, ...HE });
  const toc = items.slice(0, 14).map((s, i) => ({ text: `${i + 2}  ${s.title || s.label}`, options: { breakLine: true } }));
  if (items.length > 14) toc.push({ text: `ועוד ${items.length - 14}`, options: { breakLine: true } });
  slide.addText(toc, { x: W / 2 - 0.2, y: 4.35, w: W / 2 - M + 0.2, h: 2.5, fontFace: FONT, fontSize: 11, color: t.coverInk, transparency: 30, align: 'right', valign: 'top', margin: 0, paraSpaceAfter: 3, fit: 'shrink', ...HE });
  slide.addText(`כל מספר מקושר לעמוד שלו בדוח · ${meta.host}`, { x: M, y: H - 0.7, w: W - 2 * M, h: 0.3, fontFace: FONT, fontSize: 10, color: t.coverInk, transparency: 45, align: 'right', margin: 0, ...HE });
}

/** Every document behind the deck, slide by slide, with its pages and a link; derived figures with their formula. Paginated. */
function sourcesSlides(pptx: PptxGenJS, items: ChartSpec[], meta: DeckMeta, first: number, from: number) {
  const t = TONES[meta.theme];
  type Row = { slide: string; chart: string; doc: string; pages: string; url: string | null };
  const rows: Row[] = [];
  items.forEach((s, i) => {
    const { docs, formulas, texts } = citeDocs(s.sources);
    const add = (doc: string, pages: string, url: string | null) => rows.push({ slide: String(first + i), chart: rows.length && rows[rows.length - 1].slide === String(first + i) ? '' : s.title || s.label, doc, pages, url });
    docs.forEach((d) => add(d.doc, d.pages.length ? pagesText(d.pages).replace('עמ׳ ', '') : '–', d.url ? (d.kind === 'report' ? pdfPage(d.url, d.pages[0]) : d.url) : null));
    texts.forEach((x) => add(x, '–', null));
    formulas.forEach((f) => add(`מחושב באתר: ${f}`, '–', null));
    if (!docs.length && !texts.length && !formulas.length) add('לא נרשם מקור לנקודות הגרף', '–', null);
  });
  const per = 16, pages = Math.max(1, Math.ceil(rows.length / per));
  const cell = (text: string, o: PptxGenJS.TableCellProps = {}): PptxGenJS.TableCell => ({ text, options: { fontFace: FONT, fontSize: 9, color: t.ink, align: 'right', valign: 'middle', ...HE, ...o } });
  for (let p = 0; p < pages; p++) {
    const slide = pptx.addSlide();
    slide.background = { color: t.bg };
    frame(slide, t, from + p);
    slide.addText(pages > 1 ? `מקורות (${p + 1}/${pages})` : 'מקורות', { x: M + 1.3, y: 0.24, w: W - 2 * M - 1.3, h: 0.62, fontFace: FONT, fontSize: 22, bold: true, color: t.ink, align: 'right', valign: 'middle', margin: 0, ...HE });
    slide.addText('כל מסמך מקושר לעמוד הראשון שהגרף משתמש בו; הרשימה המלאה של עמודים לכל נקודה נמצאת באתר, במקור של כל נתון', { x: M, y: 0.86, w: W - 2 * M, h: 0.34, fontFace: FONT, fontSize: 11, color: t.muted, align: 'right', margin: 0, ...HE });
    const head = ['שקף', 'גרף', 'מקור', 'עמודים'].map((h) => cell(h, { bold: true, color: t.muted, fill: { color: t.panel } }));
    const body = rows.slice(p * per, (p + 1) * per).map((r) => [
      cell(r.slide, { color: t.muted }), cell(r.chart, { bold: true }),
      cell(r.doc, r.url ? { hyperlink: { url: r.url, tooltip: 'פתיחת המקור' }, color: t.accentText } : {}), cell(r.pages, { color: t.muted }),
    ]);
    // right to left: the first column is drawn rightmost
    slide.addTable([head, ...body].map((r) => [...r].reverse()), { x: M, y: 1.42, w: W - 2 * M, colW: [0.7, 4.0, 6.13, 1.5].reverse() as number[], rowH: 0.3, border: { type: 'solid', pt: 0.5, color: t.line }, fill: { color: t.bg }, margin: 0.05 });
  }
  return pages;
}

/** Remove the fill of spacer series and drop empty points, so PowerPoint draws gaps instead of asking to repair the file. */
async function finish(buf: ArrayBuffer): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buf);
  const charts = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
  await Promise.all(charts.map(async (f) => {
    let x = await zip.file(f)!.async('string');
    x = x.replace(/<c:pt idx="\d+"><c:v><\/c:v><\/c:pt>/g, '');
    x = x.replace(new RegExp(`<a:solidFill>\\s*<a:srgbClr val="${HIDDEN}"\\s*(?:/>|>[\\s\\S]*?</a:srgbClr>)\\s*</a:solidFill>`, 'g'), '<a:noFill/>');
    zip.file(f, x);
  }));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

/** The deck as a file. One spec gives a one-chart deck (no cover); a book gives cover, charts and sources. */
export async function deckBlob(items: ChartSpec[], meta: DeckMeta): Promise<Blob> {
  const { default: Pptx } = await import('pptxgenjs');
  const pptx = new Pptx();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.rtlMode = true;
  const brand = meta.brand !== false;
  if (brand) { pptx.author = 'fox'; pptx.company = 'fox'; }
  pptx.title = meta.title; pptx.subject = brand ? `${meta.host} · ${pubLabel(meta.built)}` : pubLabel(meta.built);
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  const book = items.length > 1;
  let n = 1;
  if (book) { coverSlide(pptx, items, meta); n++; }
  const first = n;
  items.forEach((s) => chartSlide(pptx, s, meta, n++));
  if (brand) sourcesSlides(pptx, items, meta, first, n);
  const buf = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
  return finish(buf);
}

export function saveBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** file name with the period grammar's date: fox-ספר-הגרפים-22.10.26.pptx */
export const fileName = (title: string, ext: string, built: string, brand = true) => `${brand ? 'fox-' : ''}${title.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-')}-${pubLabel(built)}.${ext}`;

export async function exportDeck(items: ChartSpec[], meta: DeckMeta) {
  saveBlob(fileName(meta.title, 'pptx', meta.built, meta.brand !== false), await deckBlob(items, meta));
}

export type { SrcRef };
