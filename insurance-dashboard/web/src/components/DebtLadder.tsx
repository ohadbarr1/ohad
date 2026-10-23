import type { EChartsCoreOption } from 'echarts/core';
import { Chart } from './Chart';
import { chartBase, CHART_FONT } from '../lib/theme';
import { fmtNum } from '../lib/foxchart';

/* The debt ladder: what falls due in each repayment year of a liabilities schedule (MAYA form ת126).
   One x category per repayment year. Two modes:
     stack    one issuer or group: principal parts stacked (by debt type or by linkage), gross interest on top, hatched
     compare  several groups side by side: one bar per group in its identity colour, principal solid and interest hatched on it
   One y axis (NIS millions), thin bars, a tooltip with every part, its sum and the unit; the table view lives with the caller. */

const TOTAL = 'סך הכול';

export interface LadderPart {
  name: string;
  /** one value per x category, NIS millions */
  data: (number | null)[];
  color: string;
  /** interest is drawn hatched on top of its principal */
  interest?: boolean;
  /** compare mode: the group (stack id) this part belongs to; parts of one group stack on one bar */
  group?: string;
}

export function DebtLadder({ x, parts, label, height = 300, mode = 'stack', source, onPoint, unit = 'מיליוני ש"ח' }: {
  x: string[]; parts: LadderPart[]; label: string; height?: number; mode?: 'stack' | 'compare'; source?: string; unit?: string;
  onPoint?: (part: number, x: number) => void;
}) {
  const build = (): EChartsCoreOption => {
    const b = chartBase();
    const narrow = typeof window !== 'undefined' && window.innerWidth < 760;
    const groups = [...new Set(parts.map((p) => p.group ?? 'all'))];
    const series = parts.map((p) => {
      const stack = mode === 'compare' ? p.group ?? p.name : 'all';
      return {
        name: p.name, type: 'bar', stack, barMaxWidth: mode === 'compare' ? 22 : 54, barGap: '12%', barCategoryGap: mode === 'compare' ? '22%' : '38%',
        data: p.data.map((v) => (v == null || v === 0 ? null : v)),
        itemStyle: {
          color: p.color, opacity: p.interest ? 0.55 : 0.95, borderColor: p.interest ? p.color : undefined, borderWidth: p.interest ? 1 : 0,
          decal: p.interest ? { symbol: 'rect', symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: Math.PI / 4, color: 'rgba(255,255,255,0.55)' } : undefined,
        },
        emphasis: { focus: 'series' },
      };
    });
    // the total of each stack, printed above it (stack mode only, and only where the bar has room)
    if (mode === 'stack' && !narrow) {
      const tot = x.map((_, i) => parts.reduce((s, p) => s + (p.data[i] ?? 0), 0));
      series.push({ name: TOTAL, type: 'scatter', data: tot.map((v) => (v ? v : null)), symbolSize: 0, silent: true, tooltip: { show: false }, z: 10,
        label: { show: true, position: 'top', distance: 4, color: b.fg, fontSize: 11, fontWeight: 500, formatter: (q: { value: number }) => fmtNum(q.value) } } as unknown as (typeof series)[number]);
    }
    const legendNames = mode === 'compare' ? [...new Set(parts.filter((p) => !p.interest).map((p) => p.name))] : parts.map((p) => p.name);
    return {
      animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg },
      grid: { left: 8, right: 12, top: narrow ? 34 + 21 * Math.ceil(legendNames.length / 2) : 52, bottom: 6, containLabel: true },
      legend: { top: 0, type: narrow ? 'plain' : 'scroll', data: legendNames, textStyle: { color: b.mu, fontSize: 11.5 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 },
        formatter: (ps: { axisValueLabel: string; marker: string; seriesName: string; seriesIndex: number; value: number | null }[]) => {
          const rows: string[] = [];
          for (const g of groups) {
            const mine = ps.filter((q) => q.seriesName !== TOTAL && q.value != null && (parts[q.seriesIndex]?.group ?? 'all') === g);
            if (!mine.length) continue;
            const sum = mine.reduce((s, q) => s + (q.value ?? 0), 0);
            if (mode === 'compare') rows.push(`<b>${g}</b>: ${mine.map((q) => `${parts[q.seriesIndex].interest ? 'ריבית' : 'קרן'} ${fmtNum(q.value!)}`).join(' · ')} · <b>${fmtNum(sum)}</b>`);
            else { mine.forEach((q) => rows.push(`${q.marker} ${q.seriesName}: <b>${fmtNum(q.value!)}</b>`)); rows.push(`סך הכול: <b>${fmtNum(sum)}</b>`); }
          }
          return `<b>${ps[0]?.axisValueLabel ?? ''}</b><br>${rows.join('<br>')}<br><span style="opacity:.65;font-size:11px">${unit}</span>`;
        },
      },
      xAxis: { type: 'category', data: x, axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false }, axisLabel: { color: b.mu, fontSize: 12, interval: 0 } },
      yAxis: { type: 'value', name: unit, nameTextStyle: { color: b.mu, fontSize: 11, align: 'left' }, axisLabel: { color: b.mu, fontSize: 11, formatter: (v: number) => fmtNum(v, 0) },
        splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
      series,
    };
  };
  return <Chart build={build} deps={[x.join(), parts.map((p) => `${p.name}:${p.data.join(',')}`).join('|'), mode]} height={height} label={label} source={source}
    onPoint={onPoint ? (si, di, name) => { if (name !== TOTAL) onPoint(si, di); } : undefined} />;
}
