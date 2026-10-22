import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { useTheme } from '../lib/theme';
import { polish } from '../lib/foxchart';
import { captureSpec, enrich, readBook, routeNow, sameData, sameShape, useBook, type ChartSpec } from '../lib/book';
import { citeLine } from '../lib/exportProv';
import { load } from '../lib/useData';
import { pubLabel } from '../lib/format';
import '../styles/book.css';

// the library (≈150 KB compressed) arrives with the first chart a page draws, not with the shell
const lib = () => import('../lib/echarts');

type Opt = { xAxis?: { data?: (string | number)[] }[]; series?: { name?: string; data?: (number | null | { value: number | null })[] }[] };
function save(name: string, href: string) { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); }
/** build date of the site's data (qa.json), stamped on every export */
const dataDate = () => load<{ built?: string }>('qa.json').then((q) => q.built?.slice(0, 10) ?? null, () => null);

/** Thin ECharts wrapper. `build` runs again whenever the theme changes so chart colours follow the CSS tokens.
 *  With `exportName` the chart carries its own export: the picture as PNG and the plotted series as CSV. */
export function Chart({ build, height = 320, deps, label, exportName: named, onPoint, source, bookable = true }: { build: () => EChartsCoreOption; height?: number; deps: unknown[]; label: string; exportName?: string;
  /** false: no "add to the chart book" action (the book's own cards) */
  bookable?: boolean;
  /** the source line printed under the exported picture ("דוח Q2'26, עמ׳ 75"); without it the picture points to the page on fox */
  source?: string;
  /** a click on a plotted point: lets a chart open the source of the figure it draws */
  onPoint?: (seriesIndex: number, dataIndex: number, seriesName: string) => void }) {
  const exportName = named ?? (height >= 200 ? `fox-${label.replace(/[\s,]+/g, '-')}` : undefined);
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

  // the picture carries its title and its source, so it can go straight into a deck
  const png = async () => {
    const c = chart.current; if (!c) return;
    const cs = getComputedStyle(document.body), bg = cs.backgroundColor, fg = cs.color, mu = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || fg;
    const img = new Image(); img.src = c.getDataURL({ pixelRatio: 2, backgroundColor: bg }); await img.decode();
    const pad = 36, head = 84, foot = 78, cv = document.createElement('canvas');
    cv.width = img.width + pad * 2; cv.height = img.height + head + foot;
    const x = cv.getContext('2d'); if (!x) return;
    x.fillStyle = bg; x.fillRect(0, 0, cv.width, cv.height);
    x.direction = 'rtl'; x.textAlign = 'right'; x.fillStyle = fg; x.font = '700 30px Heebo, Arial, sans-serif';
    x.fillText(label, cv.width - pad, 52);
    x.drawImage(img, pad, head);
    x.font = '400 21px Heebo, Arial, sans-serif'; x.fillStyle = mu;
    // the source line: the documents and pages behind the plotted points, else the chart's credit
    const spec = captureSpec(c, { label, credit: source, onPoint: point.current }), cite = spec ? citeLine((await enrich(spec)).sources, 3) : '';
    const dd = await dataDate();
    x.fillText(`מקור: ${cite || source || 'הדוחות של החברות ונתוני רשות שוק ההון, כל מספר מקושר לעמוד המקור'}`.slice(0, 190), cv.width - pad, cv.height - 30);
    x.font = '400 17px Heebo, Arial, sans-serif';
    x.fillText(`\u2066${location.host}${location.pathname}\u2069 · ${dd ? `נתונים ${pubLabel(dd)} · ` : ''}הופק ${pubLabel(new Date().toISOString())}`, cv.width - pad, cv.height - 8);
    x.direction = 'ltr'; x.textAlign = 'left'; x.font = '700 26px Heebo, Arial, sans-serif'; x.fillStyle = fg; x.fillText('fox', pad, cv.height - 22);
    const fw = x.measureText('fox').width; x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#FF4E31'; x.fillText('.', pad + fw, cv.height - 22);
    save(`${exportName}.png`, cv.toDataURL('image/png'));
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
          <button type="button" onClick={() => void png()}>PNG</button>
          <button type="button" onClick={() => void pptx()} title="שקף PowerPoint עם גרף עריך ומקורות">{deck ?? 'PPTX'}</button>
          <button type="button" onClick={csv}>CSV</button>
          <button type="button" onClick={link}>העתקת קישור</button>
        </div>
      )}
    </>
  );
}
