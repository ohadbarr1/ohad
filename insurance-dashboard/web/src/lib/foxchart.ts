import type { EChartsCoreOption } from 'echarts/core';
import { CHART_FONT, chartBase, palette } from './theme';
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
  /** a line filled down to the axis (with `stack`, a stacked area) */
  area?: boolean;
  opacity?: number;
  /** a bar drawn over the previous bar series instead of beside it */
  overlay?: boolean;
  /** the series in focus is drawn heavier; `dim` pushes a series back as context */
  lead?: boolean;
  dim?: boolean;
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
  /** legend above the plot; on by default when there is more than one series */
  legend?: boolean;
  /** many points on the x axis (monthly data): no point markers, labels thinned instead of rotated */
  dense?: boolean;
  /** the value axis need not start at zero (indices, ratios) */
  scale?: boolean;
  /** add the sum of the plotted series to the tooltip */
  total?: boolean;
  /** rotate the category labels by this many degrees (long names) */
  rotate?: number;
  /** keep every column, including leading and trailing ones with no data */
  full?: boolean;
}

const LRM = '‎';
export const fmtNum = (v: number, dec?: number): string => `${LRM}${nf(v, dec ?? (Math.abs(v) >= 100 ? 0 : 1))}`;

export function foxOption(spec: FoxSpec): EChartsCoreOption {
  const b = chartBase();
  // only the span in which something is plotted
  const has = spec.x.map((_, i) => spec.series.some((s) => s.data[i] != null));
  const lo = spec.full ? 0 : Math.max(0, has.indexOf(true)), hi = spec.full ? spec.x.length : has.lastIndexOf(true) + 1, x = spec.x.slice(lo, hi);
  const amounts = spec.series.some((s) => !s.pct), rates = spec.series.some((s) => s.pct);
  const second = amounts && rates, pctAxis = second ? 1 : 0;
  const stacked = spec.series.some((s) => s.stack);
  const showLabels = spec.labels ?? (!spec.dense && !stacked && spec.series.length <= 2 && x.length <= 14);
  const legend = spec.legend ?? spec.series.length > 1;
  const rot = spec.rotate ?? (!spec.dense && x.length > 14 ? 45 : 0);
  const texts: ((v: number | null) => string)[] = [];
  const series: Record<string, unknown>[] = spec.series.map((s) => {
    const kind = s.kind ?? (s.pct ? 'line' : 'bar'), dec = s.dec ?? (s.pct ? 1 : undefined);
    const text = (v: number | null) => (v == null ? '–' : `${s.cap && Math.abs(v) >= s.cap ? (v > 0 ? 'מעל ' : 'מתחת ל-') : ''}${fmtNum(v, dec)}${s.pct ? '%' : ''}`);
    texts.push(text);
    return {
      name: s.name, type: kind, yAxisIndex: s.pct ? pctAxis : 0, stack: s.stack && !s.pct && (kind === 'bar' || s.area) ? 'total' : undefined,
      data: s.data.slice(lo, hi).map((v, i) => (v == null ? null : s.faded?.[lo + i] ? { value: v, itemStyle: { opacity: 0.5 } } : v)),
      barMaxWidth: 46, barGap: s.overlay ? '-100%' : undefined, symbol: spec.dense ? 'none' : undefined, symbolSize: s.dashed ? 5 : 6, connectNulls: !!spec.dense, z: s.lead ? 9 : kind === 'line' ? 5 : 2,
      itemStyle: { color: s.color, opacity: s.dim ? 0.28 : s.opacity }, areaStyle: s.area ? { opacity: s.stack ? 0.85 : 0.18 } : undefined,
      lineStyle: { color: s.color, width: s.lead ? 3.4 : s.area && s.stack ? 1 : s.dashed ? 1.8 : 2.4, type: s.dashed ? 'dashed' : 'solid', opacity: s.dim ? 0.28 : 1 }, emphasis: { focus: 'series' },
      tooltip: { valueFormatter: text },
      label: { show: showLabels && !s.dashed, position: 'top', color: b.mu, fontSize: 11, formatter: (p: { value: number | null }) => (p.value == null ? '' : fmtNum(p.value, dec)) },
    };
  });
  const allLines = series.every((q) => q.type === 'line');
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
    grid: { left: 8, right: second ? 8 : 14, top: legend ? 58 : 34, bottom: 6, containLabel: true },
    legend: legend ? { top: 0, type: 'scroll', textStyle: { color: b.mu, fontSize: 11.5 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' } : undefined,
    tooltip: { trigger: 'axis', axisPointer: { type: allLines ? 'line' : 'shadow' }, confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 },
      // one tooltip everywhere: the period, each series with its figure, the sum where the parts add up, and the unit
      formatter: (ps: { axisValueLabel: string; marker: string; seriesName: string; seriesIndex: number; value: number | null | { value: number } }[]) => {
        let sum = 0;
        const rows = ps.map((q) => { const v = q.value != null && typeof q.value === 'object' ? q.value.value : q.value; if (v == null) return ''; sum += v; return `${q.marker} ${q.seriesName}: <b>${texts[q.seriesIndex]?.(v) ?? fmtNum(v)}</b><br>`; }).join('');
        return `<b>${ps[0]?.axisValueLabel ?? ''}</b><br>${rows}${spec.total ? `סך הכול: <b>${fmtNum(sum)}</b><br>` : ''}<span style="opacity:.65;font-size:11px">${amounts ? spec.unit : '%'}</span>`;
      } },
    xAxis: { type: 'category', data: x, boundaryGap: !allLines, axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false }, axisLabel: { color: b.mu, fontSize: spec.dense ? 11 : 12, rotate: rot, hideOverlap: true, interval: rot && !spec.dense ? 0 : undefined } },
    yAxis: [{ ...axis(amounts ? spec.unit : '%', !amounts, true), scale: !!spec.scale }, ...(second ? [axis('%', true, false)] : [])],
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

/* ---------- peers: one group of bars per company ---------- */
export interface PeerSeries { name: string; data: (number | null)[]; color?: string; /** 0..1, earlier periods drawn lighter */ strength?: number }
export interface PeerSpec {
  cats: string[];
  /** a short figure under each name (a growth rate, a total); a leading + or − sets its colour */
  sub?: (string | null)[];
  /** index of the company in focus: its bars take the accent colour */
  lead?: number;
  series: PeerSeries[];
  dec?: number;
  pct?: boolean;
  /** stacked shares (a mix) instead of side-by-side bars */
  stack?: boolean;
  /** draw the value axis; without it the last series carries value labels */
  axis?: boolean;
  /** negative bars in the "down" colour */
  signed?: boolean;
  max?: number;
}
export function foxPeers(spec: PeerSpec): EChartsCoreOption {
  const b = chartBase(), narrow = typeof window !== 'undefined' && window.innerWidth < 760;
  const rot = spec.cats.length > 8, dec = spec.dec ?? 1, last = spec.series.length - 1;
  const neutral = cssNeutral();
  const text = (v: number | null) => (v == null ? '–' : `${fmtNum(v, dec)}${spec.pct ? '%' : ''}`);
  if (narrow) {
    // a phone cannot carry thirteen rotated names: companies run down the page, one bar each (the latest period), the figure at the end of the bar
    const shown = spec.stack ? spec.series : spec.series.slice(-1);
    return {
      animationDuration: 650, animationEasing: 'cubicOut', textStyle: { fontFamily: CHART_FONT, color: b.fg },
      grid: { left: 4, right: spec.stack ? 8 : 44, top: spec.stack ? 30 : 6, bottom: 2, containLabel: true },
      legend: spec.stack ? { top: 0, type: 'scroll', textStyle: { color: b.mu, fontSize: 11.5 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' } : undefined,
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: text },
      yAxis: { type: 'category', inverse: true, data: spec.cats, axisTick: { show: false }, axisLine: { show: false },
        axisLabel: { color: b.fg, fontSize: 11.5, interval: 0, formatter: (v: string, i: number) => { const e = spec.sub?.[i]; return e ? `${v} {${e.startsWith('−') || e.startsWith('-') ? 'd' : 'u'}|${LRM}${e}}` : v; },
          rich: { u: { color: b.up, fontSize: 10.5, padding: [0, 6, 0, 6] }, d: { color: b.down, fontSize: 10.5, padding: [0, 6, 0, 6] } } } },
      xAxis: { type: 'value', show: false, max: spec.max },
      series: shown.map((s) => ({
        name: s.name, type: 'bar', stack: spec.stack ? 'mix' : undefined, barCategoryGap: '26%', itemStyle: { color: s.color ?? neutral },
        data: s.data.map((v, i) => (v == null ? null : { value: v, itemStyle: { color: spec.stack ? s.color ?? neutral : i === spec.lead ? b.accent : spec.signed && v < 0 ? b.down : s.color ?? neutral, borderRadius: spec.stack ? 0 : 2 } })),
        label: spec.stack ? { show: true, color: '#fff', fontSize: 10, formatter: (p: { value: number }) => (p.value >= 12 ? `${nf(p.value, 0)}%` : '') }
          : { show: true, position: 'right', color: b.fg, fontSize: 11, formatter: (p: { value: number | null }) => (p.value == null ? '' : text(p.value)) },
      })),
    };
  }
  return {
    animationDuration: 650, animationEasing: 'cubicOut', textStyle: { fontFamily: CHART_FONT, color: b.fg },
    grid: { left: 4, right: 4, top: spec.series.length > 1 ? 30 : 12, bottom: 4, containLabel: true },
    legend: spec.series.length > 1 ? { top: 0, type: 'scroll', textStyle: { color: b.mu, fontSize: 11.5 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' } : undefined,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: text },
    xAxis: { type: 'category', data: spec.cats, axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } },
      axisLabel: { color: b.fg, fontSize: 11.5, interval: 0, hideOverlap: false, rotate: rot ? 50 : 0,
        formatter: (v: string, i: number) => { const e = spec.sub?.[i]; return e ? (rot ? `${v}  ${LRM}${e}` : `${v}\n{${e.startsWith('−') || e.startsWith('-') ? 'd' : 'u'}|${LRM}${e}}`) : v; },
        rich: { u: { color: b.up, fontSize: 10.5, padding: [3, 0, 0, 0] }, d: { color: b.down, fontSize: 10.5, padding: [3, 0, 0, 0] } } } },
    yAxis: { type: 'value', show: !!spec.axis, max: spec.max, axisLabel: { color: b.mu, fontSize: 10.5, formatter: (v: number) => `${fmtNum(v, 0)}${spec.pct ? '%' : ''}` }, splitLine: { lineStyle: { color: b.ln, opacity: 0.5 } } },
    series: spec.series.map((s, k) => {
      const base = s.color ?? neutral, op = s.strength ?? 1;
      return {
        name: s.name, type: 'bar', stack: spec.stack ? 'mix' : undefined, barGap: '8%', barCategoryGap: spec.stack ? '30%' : '18%', itemStyle: { color: base, opacity: spec.stack ? 0.92 : op },
        data: s.data.map((v, i) => (v == null ? null : { value: v, itemStyle: { color: spec.stack ? base : i === spec.lead ? b.accent : spec.signed && v < 0 ? b.down : base, opacity: spec.stack ? 0.92 : op, borderRadius: spec.stack ? 0 : v < 0 ? [0, 0, 2, 2] : [2, 2, 0, 0] } })),
        label: spec.stack
          ? { show: !narrow, color: '#fff', fontSize: 10, formatter: (p: { value: number }) => (p.value >= 9 ? `${nf(p.value, 0)}%` : '') }
          : { show: k === last && !narrow, position: 'top', color: b.fg, fontSize: 10.5, formatter: (p: { value: number | null }) => (p.value == null ? '' : fmtNum(p.value, dec)) },
      };
    }),
  };
}
function cssNeutral(): string { return palette()[7]; }
