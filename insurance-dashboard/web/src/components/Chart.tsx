import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { useTheme } from '../lib/theme';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

type Opt = { xAxis?: { data?: (string | number)[] }[]; series?: { name?: string; data?: (number | null | { value: number | null })[] }[] };
function save(name: string, href: string) { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); }

/** Thin ECharts wrapper. `build` runs again whenever the theme changes so chart colours follow the CSS tokens.
 *  With `exportName` the chart carries its own export: the picture as PNG and the plotted series as CSV. */
export function Chart({ build, height = 320, deps, label, exportName }: { build: () => EChartsCoreOption; height?: number; deps: unknown[]; label: string; exportName?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current);
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    // wait one frame so the new theme's CSS variables are applied before we read them
    const id = requestAnimationFrame(() => chart.current?.setOption(build(), true));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, ...deps]);

  const png = () => { const c = chart.current; if (c) save(`${exportName}.png`, c.getDataURL({ pixelRatio: 2, backgroundColor: getComputedStyle(document.body).backgroundColor })); };
  const csv = () => {
    const o = chart.current?.getOption() as Opt | undefined;
    if (!o) return;
    const xs = o.xAxis?.[0]?.data ?? [], ss = o.series ?? [];
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['', ...ss.map((x) => x.name ?? '')], ...xs.map((x, i) => [x, ...ss.map((q) => { const v = q.data?.[i]; return v != null && typeof v === 'object' ? v.value : v; })])];
    save(`${exportName}.csv`, URL.createObjectURL(new Blob(['\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })));
  };
  const link = () => { void navigator.clipboard?.writeText(location.href); };
  return (
    <>
      <div ref={el} style={{ width: '100%', height }} role="img" aria-label={label} />
      {exportName && <div className="charttools"><button type="button" onClick={png}>PNG</button><button type="button" onClick={csv}>CSV</button><button type="button" onClick={link}>העתקת קישור</button></div>}
    </>
  );
}
