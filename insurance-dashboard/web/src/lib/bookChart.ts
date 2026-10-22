import type { EChartsCoreOption } from 'echarts/core';
import { CHART_FONT, chartBase, palette } from './theme';
import { idColor } from './identity';
import { fmtNum } from './foxchart';
import { idOfName, type BookSeries, type ChartSpec } from './book';

/** Colour of a series in the current theme: its company's identity colour, else the colour it had on its page, else the palette. */
const LIGHT = ['#2B54B8', '#D4451F', '#5B67D6', '#00978A', '#9A5A2C', '#8A4FC2', '#B07A0A', '#B03A76', '#2E86D1', '#C7337A', '#6E8B00'];
const DARK = ['#6A8EE7', '#E26940', '#8289DA', '#00AA98', '#C77F3F', '#A579DB', '#BA8900', '#D4689E', '#439AD6', '#E15C97', '#85A000'];
/** a colour captured in one theme, carried to the current one: palette slots and the accent follow the theme */
export function themed(c: string): string {
  const k = Math.max(LIGHT.indexOf(c.toUpperCase()), DARK.indexOf(c.toUpperCase()));
  if (k >= 0) return palette()[k];
  if (['#FF4E31', '#F59A4B'].includes(c.toUpperCase())) return chartBase().accent;
  return c;
}
export function seriesColor(s: BookSeries, i: number): string {
  if (s.id) return idColor(s.id);
  return s.color ? themed(s.color) : palette()[i % 11];
}
/** a point coloured on its own (a bar per company): the company's identity colour in the current theme, else the captured colour */
const pointColor = (spec: ChartSpec, s: BookSeries, k: number, base: string): string => {
  const id = idOfName(spec.cats[k] ?? '');
  const pc = s.pointColors?.[k];
  return id ? idColor(id) : pc ? themed(pc) : base;
};

/** The spec drawn again as a live chart, in the house style of the site (one value axis per unit, thin marks, legend for ≥2 series). */
export function bookOption(spec: ChartSpec): EChartsCoreOption {
  const b = chartBase(), shown = spec.series.filter((s) => !s.hidden);
  const legend = shown.length > 1 && shown.some((s) => s.name) && spec.kind !== 'pie' && !(spec.kind === 'scatter' && spec.series.every((s) => (s.xy?.length ?? 0) <= 1 || s.type === 'line'));
  const base = { animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg } };
  const tip = { confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 } };
  const leg = legend ? { top: 0, type: 'scroll', textStyle: { color: b.mu, fontSize: 11.5 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect', data: shown.map((s) => s.name) } : undefined;
  if (spec.kind === 'pie') {
    const s = spec.series[0];
    return { ...base, tooltip: { ...tip, trigger: 'item', valueFormatter: (v: number) => fmtNum(v) },
      series: [{ type: 'pie', radius: ['38%', '68%'], label: { color: b.fg, fontSize: 11 }, data: spec.cats.map((c, k) => ({ name: c, value: s.data[k], itemStyle: { color: s.pointColors?.[k] ?? palette()[k % 11] } })) }] };
  }
  if (spec.kind === 'scatter') {
    return { ...base, legend: leg, tooltip: { ...tip, trigger: 'item', formatter: (p: { seriesName: string; data: [number, number, string?] }) => `${p.data[2] ?? p.seriesName}<br>${spec.xName ?? ''}: <b>${fmtNum(p.data[0])}</b><br>${spec.yName ?? ''}: <b>${fmtNum(p.data[1])}</b>` },
      grid: { left: 8, right: 18, top: legend ? 40 : 24, bottom: 8, containLabel: true },
      xAxis: { type: 'value', name: spec.xName, nameLocation: 'middle', nameGap: 26, scale: true, axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
      yAxis: { type: 'value', name: spec.yName, scale: true, nameTextStyle: { color: b.mu, fontSize: 11, align: 'left' }, axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
      series: spec.series.map((s, i) => s.type === 'line' ? { name: s.name, type: 'line', symbol: 'none', silent: true, lineStyle: { color: seriesColor(s, i), width: 1, type: s.dashed ? 'dashed' : 'solid' }, data: s.xy ?? [] } : ({ name: s.name, type: 'scatter', symbolSize: 11, itemStyle: { color: seriesColor(s, i) }, data: s.xy ?? [],
        label: { show: true, position: 'right', color: b.mu, fontSize: 10.5, formatter: (p: { data: [number, number, string?] }) => p.data[2] ?? '' } })) };
  }
  const horiz = spec.kind === 'hbar';
  const second = spec.series.some((s) => s.axis === 1 && !s.hidden);
  const allLines = shown.every((s) => s.type !== 'bar');
  const valAxis = (name: string, grid: boolean) => ({ type: 'value', name, nameTextStyle: { color: b.mu, fontSize: 11, align: horiz ? 'center' : 'left' }, axisLabel: { color: b.mu, fontSize: 11 },
    splitLine: grid ? { lineStyle: { color: b.ln, type: 'dashed' } } : { show: false }, scale: allLines && !spec.series.some((s) => s.stack) });
  const catAxis = { type: 'category', data: spec.cats, inverse: horiz, boundaryGap: !allLines, axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } },
    axisLabel: { color: horiz ? b.fg : b.mu, fontSize: horiz ? 11.5 : 12, hideOverlap: !horiz, interval: horiz ? 0 : undefined, rotate: !horiz && spec.cats.length > 14 ? 45 : 0 } };
  const vals = [{ ...valAxis(spec.unit, true), min: spec.vmin }, ...(second ? [valAxis(spec.unit2 ?? '%', false)] : [])];
  return {
    ...base, legend: leg,
    tooltip: { ...tip, trigger: 'axis', axisPointer: { type: allLines ? 'line' : 'shadow' },
      formatter: (ps: { axisValueLabel: string; marker: string; seriesName: string; seriesIndex: number; value: number | null }[]) =>
        `<b>${ps[0]?.axisValueLabel ?? ''}</b><br>${ps.filter((q) => !spec.series[q.seriesIndex]?.hidden && q.value != null).map((q) => `${q.marker} ${q.seriesName}: <b>${fmtNum(q.value as number)}</b>`).join('<br>')}${spec.unit ? `<br><span style="opacity:.65;font-size:11px">${spec.unit}</span>` : ''}` },
    grid: { left: 8, right: 14, top: legend ? 52 : 30, bottom: 6, containLabel: true },
    xAxis: horiz ? vals : catAxis, yAxis: horiz ? catAxis : vals,
    series: spec.series.map((s, i) => {
      const c = seriesColor(s, i), line = s.type !== 'bar';
      return {
        name: s.name, type: line ? 'line' : 'bar', stack: s.stack, [horiz ? 'xAxisIndex' : 'yAxisIndex']: s.axis === 1 && second ? 1 : 0,
        silent: !!s.hidden, barMaxWidth: 46, symbolSize: 6, connectNulls: false,
        itemStyle: { color: s.hidden ? 'transparent' : c },
        lineStyle: { color: c, width: 2.4, type: s.dashed ? 'dashed' : 'solid' },
        areaStyle: s.type === 'area' ? { opacity: s.stack ? 0.85 : 0.18 } : undefined,
        data: s.data.map((v, k) => (v == null ? null : s.pointColors && !s.hidden ? { value: v, itemStyle: { color: pointColor(spec, s, k, c) } } : v)),
        emphasis: { focus: s.hidden ? 'none' : 'series' },
      };
    }),
  };
}
