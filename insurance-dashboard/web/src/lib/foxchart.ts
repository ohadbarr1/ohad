import type { EChartsCoreOption } from 'echarts/core';
import { CHART_FONT, chartBase } from './theme';
import { nf } from './format';

/* One chart engine for the site.
   `foxOption` draws a time series from a small series model (bars and lines, stacking, a second axis for rates, a marked break, units).
   `polish` is applied by the Chart component to every chart, so number formats, tooltips and axis type are the same everywhere,
   whether or not the chart was built from the series model. */

export interface FoxSeries {
  name: string;
  data: (number | null)[];
  color: string;
  kind?: 'bar' | 'line';
  /** a rate: drawn on the percent axis and formatted with % */
  pct?: boolean;
  stack?: boolean;
  dashed?: boolean;
  /** points drawn lighter, e.g. figures reported under the previous standard */
  faded?: boolean[];
  dec?: number;
  /** the series is held within ±cap; a point at the cap is labelled as beyond it */
  cap?: number;
}
export interface FoxSpec {
  x: string[];
  series: FoxSeries[];
  /** unit of the amount axis, printed above it */
  unit: string;
  /** index of the first column after a break (a change of accounting standard); a dashed line is drawn before it */
  breakAt?: number;
  breakLabel?: string;
  /** value labels above the marks; on by default for one or two unstacked series over a short span */
  labels?: boolean;
}

const LRM = '‎';
export const fmtNum = (v: number, dec?: number): string => `${LRM}${nf(v, dec ?? (Math.abs(v) >= 100 ? 0 : 1))}`;

export function foxOption(spec: FoxSpec): EChartsCoreOption {
  const b = chartBase();
  // only the span in which something is plotted
  const has = spec.x.map((_, i) => spec.series.some((s) => s.data[i] != null));
  const lo = Math.max(0, has.indexOf(true)), hi = has.lastIndexOf(true) + 1, x = spec.x.slice(lo, hi);
  const amounts = spec.series.some((s) => !s.pct), rates = spec.series.some((s) => s.pct);
  const second = amounts && rates, pctAxis = second ? 1 : 0;
  const stacked = spec.series.some((s) => s.stack);
  const showLabels = spec.labels ?? (!stacked && spec.series.length <= 2 && x.length <= 14);
  const series: Record<string, unknown>[] = spec.series.map((s) => {
    const kind = s.kind ?? (s.pct ? 'line' : 'bar'), dec = s.dec ?? (s.pct ? 1 : undefined);
    const text = (v: number | null) => (v == null ? '–' : `${s.cap && Math.abs(v) >= s.cap ? (v > 0 ? 'מעל ' : 'מתחת ל-') : ''}${fmtNum(v, dec)}${s.pct ? '%' : ''}`);
    return {
      name: s.name, type: kind, yAxisIndex: s.pct ? pctAxis : 0, stack: s.stack && kind === 'bar' && !s.pct ? 'total' : undefined,
      data: s.data.slice(lo, hi).map((v, i) => (v == null ? null : s.faded?.[lo + i] ? { value: v, itemStyle: { opacity: 0.5 } } : v)),
      barMaxWidth: 46, symbolSize: s.dashed ? 5 : 6, connectNulls: false, z: kind === 'line' ? 5 : 2,
      itemStyle: { color: s.color }, lineStyle: { color: s.color, width: s.dashed ? 2 : 2.5, type: s.dashed ? 'dashed' : 'solid' },
      tooltip: { valueFormatter: text },
      label: { show: showLabels && !s.dashed, position: 'top', color: b.mu, fontSize: 11, formatter: (p: { value: number | null }) => (p.value == null ? '' : fmtNum(p.value, dec)) },
    };
  });
  const brk = spec.breakAt != null ? spec.breakAt - lo : -1;
  if (brk > 0 && brk < x.length && series[0]) {
    series[0].markLine = { silent: true, symbol: 'none', lineStyle: { color: b.mu, type: 'dashed', width: 1 }, label: { formatter: spec.breakLabel ?? '', color: b.mu, fontSize: 11, position: 'insideEndTop' }, data: [{ xAxis: brk - 0.5 }] };
  }
  const axis = (name: string, pct: boolean, grid: boolean) => ({
    type: 'value', name, nameTextStyle: { color: b.mu, fontSize: 11, align: 'left' }, axisLabel: { color: b.mu, fontSize: 11, formatter: (v: number) => `${fmtNum(v, 0)}${pct ? '%' : ''}` },
    splitLine: grid ? { lineStyle: { color: b.ln, type: 'dashed' } } : { show: false },
  });
  return {
    animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg },
    grid: { left: 56, right: second ? 56 : 14, top: 34, bottom: x.length > 14 ? 44 : 30 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 } },
    xAxis: { type: 'category', data: x, axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false }, axisLabel: { color: b.mu, fontSize: 12, rotate: x.length > 14 ? 45 : 0 } },
    yAxis: [axis(amounts ? spec.unit : '%', !amounts, true), ...(second ? [axis('%', true, false)] : [])],
    series,
  };
}

type Loose = Record<string, unknown>;
const list = (v: unknown): Loose[] => (Array.isArray(v) ? (v as Loose[]) : v && typeof v === 'object' ? [v as Loose] : []);

/** House defaults for any chart option: the site typeface, a tooltip that stays inside the chart and prints numbers the way tables do,
    value axes with thousands separators that keep their sign in right-to-left text. Explicit settings of a chart always win. */
export function polish(option: EChartsCoreOption): EChartsCoreOption {
  const o = option as Loose, b = chartBase();
  o.textStyle = { fontFamily: CHART_FONT, color: b.fg, ...(o.textStyle as Loose | undefined) };
  list(o.tooltip).forEach((t) => {
    if (t.confine === undefined) t.confine = true;
    if (t.backgroundColor === undefined) { t.backgroundColor = b.panel; t.borderColor = b.ln; t.textStyle = { color: b.fg, fontSize: 12, ...(t.textStyle as Loose | undefined) }; }
    if (t.valueFormatter === undefined && t.formatter === undefined) t.valueFormatter = (v: unknown) => (typeof v === 'number' ? fmtNum(v) : v == null ? '–' : String(v));
  });
  [...list(o.xAxis), ...list(o.yAxis)].forEach((a) => {
    if (a.type !== 'value') return;
    const lab = (a.axisLabel ??= {}) as Loose;
    if (lab.formatter === undefined) lab.formatter = (v: number) => fmtNum(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0);
  });
  return option;
}
