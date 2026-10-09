import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { useTheme } from '../lib/theme';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

/** Thin ECharts wrapper. `build` runs again whenever the theme changes so chart colours follow the CSS tokens. */
export function Chart({ build, height = 320, deps, label }: { build: () => EChartsCoreOption; height?: number; deps: unknown[]; label: string }) {
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

  return <div ref={el} style={{ width: '100%', height }} role="img" aria-label={label} />;
}
