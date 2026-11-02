import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { useTheme } from '../lib/theme';
import { polish } from '../lib/foxchart';
import { captureSpec, enrich, readBook, routeNow, sameData, sameShape, useBook, type ChartSpec } from '../lib/book';
import { citeLine } from '../lib/exportProv';
import { load } from '../lib/useData';
import { pubLabel } from '../lib/format';
import { SITE_HOST } from '../lib/news';
import '../styles/book.css';

// the library (≈150 KB compressed) arrives with the first chart a page draws, not with the shell
const lib = () => import('../lib/echarts');

type Opt = { xAxis?: { data?: (string | number)[] }[]; series?: { name?: string; data?: (number | null | { value: number | null })[] }[] };
function save(name: string, href: string) { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); }
/** text cut into lines no wider than `max` (by `width`), at most `n` lines, the last one ending "…" when the text runs on */
function wrap(text: string, width: (t: string) => number, max: number, n: number): string[] {
  const out: string[] = []; let cur = '';
  for (const w of text.split(' ')) {
    const t = cur ? `${cur} ${w}` : w;
    if (width(t) <= max || !cur) cur = t; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  if (out.length <= n) return out;
  const keep = out.slice(0, n);
  let last = keep[n - 1];
  while (last && width(`${last} …`) > max) last = last.slice(0, last.lastIndexOf(' ') > 0 ? last.lastIndexOf(' ') : last.length - 1);
  keep[n - 1] = `${last} …`;
  return keep;
}
/** a CSS colour as rgb()/rgba(), resolved by the browser (the theme's tokens are oklch, which SVG editors do not read) */
function toRgb(css: string): string {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const x = cv.getContext('2d', { willReadFrequently: true }); if (!x) return css;
  x.clearRect(0, 0, 1, 1); x.fillStyle = '#000'; x.fillStyle = css; x.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}
/** build date of the site's data (qa.json), stamped on every export */
const dataDate = () => load<{ built?: string }>('qa.json').then((q) => q.built?.slice(0, 10) ?? null, () => null);

/** Thin ECharts wrapper. `build` runs again whenever the theme changes so chart colours follow the CSS tokens.
 *  With `exportName` the chart carries its own export: the picture as PNG and the plotted series as CSV. */
export function Chart({ build, height = 320, deps, label, exportName: named, onPoint, source, asof, bookable = true, tools = true }: { build: () => EChartsCoreOption; height?: number; deps: unknown[]; label: string; exportName?: string;
  /** the period the plotted data runs to ("09/26", "Q2'26"), printed in the exported picture's source bar; without it, the data build date */
  asof?: string;
  /** false: no toolbar under the chart (the caller carries its own exports: the S6 exhibit, which exports without the site's mark) */
  tools?: boolean;
  /** false: no "add to the chart book" action (the book's own cards) */
  bookable?: boolean;
  /** the source line printed under the exported picture ("דוח Q2'26, עמ׳ 75"); without it the picture points to the page on fox */
  source?: string;
  /** a click on a plotted point: lets a chart open the source of the figure it draws */
  onPoint?: (seriesIndex: number, dataIndex: number, seriesName: string) => void }) {
  const exportName = tools ? named ?? (height >= 200 ? `fox-${label.replace(/[\s,]+/g, '-')}` : undefined) : undefined;
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const [ready, setReady] = useState(false);
  const { theme } = useTheme();
  const point = useRef(onPoint); point.current = onPoint;
  const book = useBook();
  const key = `${routeNow()}|${label}`;
  const inBook = bookable && book.has(key);
  const [busy, setBusy] = useState<string | null>(null);
  const [deck, setDeck] = useState<string | null>(null);

  useEffect(() => {
    let live = true, ro: ResizeObserver | null = null;
    void lib().then(({ echarts }) => {
      if (!live || !el.current) return;
      const c = echarts.init(el.current);
      chart.current = c;
      ro = new ResizeObserver(() => c.resize());
      ro.observe(el.current);
      c.on('click', (e) => { if (e.componentType === 'series' && e.seriesIndex != null) point.current?.(e.seriesIndex, e.dataIndex, e.seriesName ?? ''); });
      setReady(true);
    });
    return () => { live = false; ro?.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    // wait one frame so the new theme's CSS variables are applied before we read them
    const id = requestAnimationFrame(() => {
      chart.current?.setOption(polish(build()), true);
      // a chart that is in the book refreshes its copy there when it is drawn with new figures (same series, same periods)
      if (!bookable || !exportName) return;
      const k = `${routeNow()}|${label}`, held = readBook().items.find((x) => x.key === k);
      if (!held || !chart.current) return;
      const now = captureSpec(chart.current, { label, credit: source, onPoint: point.current });
      if (now && sameShape(now, held) && !sameData(now, held)) void enrich(now).then((s) => book.add({ ...s, updated: new Date().toISOString() }));
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, theme, ...deps]);

  // The picture carries its own citation, so it can go straight into an article or a deck: the title on top, and a source bar under the
  // chart with the source (the documents and pages behind the plotted points, else the chart's credit), the data's as-of, the site and
  // the page's address, and the day it was made. The same bar is drawn into the PNG and written into the SVG.
  const stamp = async () => {
    const c = chart.current; if (!c) return null;
    const cs = getComputedStyle(document.body), root = getComputedStyle(document.documentElement);
    const v = (k: string, d: string) => root.getPropertyValue(k).trim() || d;
    const spec = captureSpec(c, { label, credit: source, onPoint: point.current }), cite = spec ? citeLine((await enrich(spec)).sources, 3) : '';
    const dd = await dataDate();
    return {
      bg: cs.backgroundColor, fg: cs.color, mu: v('--muted', cs.color), band: v('--panel-2', v('--line-soft', cs.backgroundColor)), line: v('--line', cs.color), accent: v('--accent', '#FF4E31'),
      src: `מקור: ${cite || source || 'הדוחות של החברות ונתוני רשות שוק ההון, כל מספר מקושר לעמוד המקור'}`.slice(0, 190),
      asof: asof ? `נתונים נכון ל-${asof}` : dd ? `נתונים מעודכנים ל-${pubLabel(dd)}` : '',
      url: `${SITE_HOST}${location.pathname}${location.search}`,
      made: `הופק ${pubLabel(new Date().toISOString())}`,
    };
  };
  const png = async () => {
    const c = chart.current, st = await stamp(); if (!c || !st) return;
    const img = new Image(); img.src = c.getDataURL({ pixelRatio: 2, backgroundColor: st.bg }); await img.decode();
    const pad = 36, head = 84, logo = 96, cv = document.createElement('canvas');
    const W = img.width + pad * 2, m = document.createElement('canvas').getContext('2d');
    if (!m) return;
    // the source wraps to at most three lines within the bar (the mark keeps its corner)
    m.font = '400 21px Heebo, Arial, sans-serif';
    const srcLines = wrap(st.src, (t) => m.measureText(t).width, W - pad * 2 - logo, 3);
    const foot = 30 + srcLines.length * 30 + 40;
    cv.width = W; cv.height = img.height + head + foot;
    const x = cv.getContext('2d'); if (!x) return;
    x.fillStyle = st.bg; x.fillRect(0, 0, cv.width, cv.height);
    x.direction = 'rtl'; x.textAlign = 'right'; x.fillStyle = st.fg; x.font = '700 30px Heebo, Arial, sans-serif';
    x.fillText(label, cv.width - pad, 52);
    x.drawImage(img, pad, head);
    // the source bar: a band with a rule on top, the source, then as-of · the page's address · the day it was made
    const y0 = cv.height - foot + 14;
    x.fillStyle = st.band; x.fillRect(0, y0, cv.width, cv.height - y0);
    x.fillStyle = st.line; x.fillRect(0, y0, cv.width, 2);
    x.fillStyle = st.fg; x.font = '400 21px Heebo, Arial, sans-serif';
    srcLines.forEach((t, i) => x.fillText(t, cv.width - pad, y0 + 34 + i * 30));
    x.font = '400 18px Heebo, Arial, sans-serif'; x.fillStyle = st.mu;
    x.fillText([st.asof, `\u2066${st.url}\u2069`, st.made].filter(Boolean).join(' · '), cv.width - pad, cv.height - 18, W - pad * 2 - logo);
    x.direction = 'ltr'; x.textAlign = 'left'; x.font = '700 26px Heebo, Arial, sans-serif'; x.fillStyle = st.fg; x.fillText('fox', pad, cv.height - 18);
    const fw = x.measureText('fox').width; x.fillStyle = st.accent; x.fillText('.', pad + fw, cv.height - 18);
    save(`${exportName}.png`, cv.toDataURL('image/png'));
  };
  // SVG: the same option drawn by ECharts' SVG renderer (vector, editable in Illustrator / Figma), framed with the title and the source bar
  const svg = async () => {
    const c = chart.current, st = await stamp(); if (!c || !st) return;
    const { echarts } = await lib();
    const w = c.getWidth(), h = c.getHeight();
    const s = echarts.init(null as unknown as HTMLElement, undefined, { renderer: 'svg', ssr: true, width: w, height: h });
    s.setOption({ ...(c.getOption() as object), animation: false } as EChartsCoreOption);
    // ECharts writes the theme's font stack ("Heebo", "Inter") unescaped inside style="…": single quotes keep the file well-formed
    const inner = s.renderToSVGString().replace(/font-family:([^;>]*?);/g, (_m, f: string) => `font-family:${f.replace(/"/g, "'")};`).replace(/^<svg /, `<svg x="${18}" y="${48}" `);
    s.dispose();
    const pad = 18, head = 48, W = w + pad * 2;
    // no text measuring in a file: wrap the source by an average Heebo glyph width (≈0.52 em at 11.5px)
    const srcLines = wrap(st.src, (t) => t.length * 11.5 * 0.52, W - pad * 2 - 48, 3);
    const foot = 22 + srcLines.length * 16 + 22, H = h + head + foot, y0 = H - foot + 6;
    const e = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const T = (y: number, size: number, fill: string, t: string, weight = 400) => `<text x="${W - pad}" y="${y}" direction="rtl" text-anchor="start" font-family="Heebo, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${e(t)}</text>`;
    const out = [`<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
      `<title>${e(label)}</title><desc>${e([st.src, st.asof, st.url, st.made].filter(Boolean).join(' · '))}</desc>`,
      `<rect width="${W}" height="${H}" fill="${st.bg}"/>`, T(30, 16, st.fg, label, 700), inner,
      `<rect x="0" y="${y0}" width="${W}" height="${H - y0}" fill="${st.band}"/><rect x="0" y="${y0}" width="${W}" height="1" fill="${st.line}"/>`,
      ...srcLines.map((t, i) => T(y0 + 20 + i * 16, 11.5, st.fg, t)), T(H - 10, 10, st.mu, [st.asof, st.url, st.made].filter(Boolean).join(' · ')),
      `<text x="${pad}" y="${H - 10}" font-family="Heebo, Arial, sans-serif" font-size="14" font-weight="700" fill="${st.fg}">fox<tspan fill="${st.accent}">.</tspan></text>`,
      `</svg>`].join('\n').replace(/(?:oklch|color-mix|lab|lch)\([^()]*(?:\([^()]*\)[^()]*)*\)/g, toRgb);  // editors (Illustrator, Figma, Word) read rgb, not oklch
    save(`${exportName}.svg`, URL.createObjectURL(new Blob([out], { type: 'image/svg+xml;charset=utf-8' })));
  };
  const csv = () => {
    const o = chart.current?.getOption() as Opt | undefined;
    if (!o) return;
    const xs = o.xAxis?.[0]?.data ?? (o as { yAxis?: { data?: (string | number)[] }[] }).yAxis?.[0]?.data ?? [], ss = o.series ?? [];
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['', ...ss.map((x) => x.name ?? '')], ...xs.map((x, i) => [x, ...ss.map((q) => { const v = q.data?.[i]; return v != null && typeof v === 'object' ? v.value : v; })])];
    save(`${exportName}.csv`, URL.createObjectURL(new Blob(['\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })));
  };
  const link = () => { void navigator.clipboard?.writeText(location.href); };
  const spec = async (): Promise<ChartSpec | null> => { const c = chart.current; if (!c) return null; const s = captureSpec(c, { label, credit: source, onPoint: point.current }); return s ? enrich(s) : null; };
  const addToBook = async () => {
    setBusy('…');
    const s = await spec();
    if (!s) { setBusy('לא נתמך'); setTimeout(() => setBusy(null), 1800); return; }
    book.add(s); setBusy(null);
  };
  const pptx = async () => {
    setDeck('…');
    try {
      const s = await spec();
      if (!s) { setDeck('לא נתמך'); setTimeout(() => setDeck(null), 1800); return; }
      const [{ exportDeck }, dd] = await Promise.all([import('../lib/pptx'), dataDate()]);
      await exportDeck([s], { title: label, theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'phoenix', host: location.host, built: new Date().toISOString(), dataDate: dd ?? undefined });
      setDeck(null);
    } catch { setDeck('שגיאה'); setTimeout(() => setDeck(null), 1800); }
  };
  return (
    <>
      <div ref={el} style={{ width: '100%', height }} role="img" aria-label={label} />
      {exportName && (
        <div className="charttools">
          {bookable && (inBook
            ? <Link className="booked" to="/book" title="הגרף בספר הגרפים">בספר ✓</Link>
            : <button type="button" className="tobook" onClick={() => void addToBook()} title="הוסף לספר הגרפים">{busy ?? '+ לספר'}</button>)}
          <button type="button" onClick={() => void png()} title="תמונה עם כותרת ושורת מקור: מקור, נתונים נכון ל, כתובת העמוד ותאריך">PNG</button>
          <button type="button" onClick={() => void svg()} title="גרף וקטורי עם שורת מקור">SVG</button>
          <button type="button" onClick={() => void pptx()} title="שקף PowerPoint עם גרף עריך ומקורות">{deck ?? 'PPTX'}</button>
          <button type="button" onClick={csv}>CSV</button>
          <button type="button" onClick={link}>העתקת קישור</button>
        </div>
      )}
    </>
  );
}
