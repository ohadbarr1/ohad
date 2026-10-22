import { useEffect, useRef, useState } from 'react';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { useTheme } from '../lib/theme';
import { polish } from '../lib/foxchart';

// the library (≈150 KB compressed) arrives with the first chart a page draws, not with the shell
const lib = () => import('../lib/echarts');

type Opt = { xAxis?: { data?: (string | number)[] }[]; series?: { name?: string; data?: (number | null | { value: number | null })[] }[] };
function save(name: string, href: string) { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); }

/** Thin ECharts wrapper. `build` runs again whenever the theme changes so chart colours follow the CSS tokens.
 *  With `exportName` the chart carries its own export: the picture as PNG and the plotted series as CSV. */
export function Chart({ build, height = 320, deps, label, exportName: named, onPoint, source }: { build: () => EChartsCoreOption; height?: number; deps: unknown[]; label: string; exportName?: string;
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
    const id = requestAnimationFrame(() => chart.current?.setOption(polish(build()), true));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, theme, ...deps]);

  // the picture carries its title and its source, so it can go straight into a deck
  const png = async () => {
    const c = chart.current; if (!c) return;
    const cs = getComputedStyle(document.body), bg = cs.backgroundColor, fg = cs.color, mu = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || fg;
    const img = new Image(); img.src = c.getDataURL({ pixelRatio: 2, backgroundColor: bg }); await img.decode();
    const pad = 36, head = 84, foot = 60, cv = document.createElement('canvas');
    cv.width = img.width + pad * 2; cv.height = img.height + head + foot;
    const x = cv.getContext('2d'); if (!x) return;
    x.fillStyle = bg; x.fillRect(0, 0, cv.width, cv.height);
    x.direction = 'rtl'; x.textAlign = 'right'; x.fillStyle = fg; x.font = '700 30px Heebo, Arial, sans-serif';
    x.fillText(label, cv.width - pad, 52);
    x.drawImage(img, pad, head);
    x.font = '400 21px Heebo, Arial, sans-serif'; x.fillStyle = mu;
    x.fillText(`מקור: ${source ?? 'הדוחות של החברות ונתוני רשות שוק ההון, כל מספר מקושר לעמוד המקור'} · ${location.host}${location.pathname}`, cv.width - pad, cv.height - 24);
    x.direction = 'ltr'; x.textAlign = 'left'; x.font = '700 24px Heebo, Arial, sans-serif'; x.fillStyle = fg; x.fillText('fox.', pad, cv.height - 24);
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
  return (
    <>
      <div ref={el} style={{ width: '100%', height }} role="img" aria-label={label} />
      {exportName && <div className="charttools"><button type="button" onClick={() => void png()}>PNG</button><button type="button" onClick={csv}>CSV</button><button type="button" onClick={link}>העתקת קישור</button></div>}
    </>
  );
}
