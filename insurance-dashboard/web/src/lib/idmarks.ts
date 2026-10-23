/** Identity never rests on hue alone (colour-vision deficiency, dark theme): on a chart of companies over time every line gets its own
 *  marker shape and its name printed at its end, in its colour. End names that would collide are pushed apart vertically; for that the
 *  value axis gets explicit round bounds, so pixel positions are known before ECharts draws. Works on any option built by foxOption. */
import type { EChartsCoreOption } from 'echarts/core';

const MARKS = ['circle', 'rect', 'triangle', 'diamond', 'emptyCircle', 'roundRect', 'emptyTriangle', 'pin', 'emptyDiamond', 'arrow', 'emptyRect'];
type Loose = Record<string, unknown>;
const val = (d: unknown): number | null => (d == null ? null : typeof d === 'number' ? d : typeof d === 'object' && d && 'value' in d ? ((d as { value: number | null }).value ?? null) : null);
/** round axis bounds around [lo, hi]: about five steps of 1, 2 or 5 × 10^k */
function nice(lo: number, hi: number): [number, number, number] {
  const span = hi - lo || Math.abs(hi) || 1, raw = span / 5, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step, step];
}

export function identify(option: EChartsCoreOption, { height, ends = true, marks = true }: { height: number; ends?: boolean; marks?: boolean }): EChartsCoreOption {
  const o = option as Loose;
  const lines = ((o.series as Loose[] | undefined) ?? []).filter((s) => s.type === 'line');
  if (!lines.length) return option;
  let longest = 0;
  lines.forEach((s, i) => {
    const color = ((s.lineStyle as Loose | undefined)?.color ?? (s.itemStyle as Loose | undefined)?.color ?? s.color) as string | undefined;
    if (marks) { s.symbol = MARKS[i % MARKS.length]; s.showSymbol = true; s.symbolSize = 7; }
    if (ends) {
      longest = Math.max(longest, String(s.name ?? '').length);
      s.endLabel = { show: true, formatter: '{a}', color, fontSize: 11, fontWeight: 600, distance: 6 };
    }
  });
  if (!ends) return option;
  const g = (Array.isArray(o.grid) ? o.grid[0] : o.grid) as Loose | undefined;
  // room for the longest name at the right edge (about 6.5 px a Hebrew letter at 11 px)
  if (g) g.right = Math.max(Number(g.right ?? 14), Math.round(longest * 6.5) + 14);
  // de-collide the names at the last period: explicit bounds on the value axis, then a vertical push
  const ys = (Array.isArray(o.yAxis) ? o.yAxis : [o.yAxis]) as Loose[];
  if (ys.length !== 1 || !ys[0] || lines.some((s) => Number(s.yAxisIndex ?? 0) !== 0)) return option;
  const all = lines.flatMap((s) => ((s.data as unknown[]) ?? []).map(val)).filter((v): v is number => v != null);
  if (!all.length) return option;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (!ys[0].scale) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const [min, max, step] = nice(lo, hi);
  ys[0].min = min; ys[0].max = max; ys[0].interval = step;
  const top = Number(g?.top ?? 34), plotH = height - top - Number(g?.bottom ?? 6) - 20;
  const yOf = (v: number) => top + ((max - v) / (max - min || 1)) * plotH;
  const lastIdx = lines.map((s) => { const d = (s.data as unknown[]) ?? []; for (let i = d.length - 1; i >= 0; i--) if (val(d[i]) != null) return i; return -1; });
  const end = Math.max(...lastIdx);
  const at = lines.map((s, i) => ({ s, y: lastIdx[i] === end ? yOf(val((s.data as unknown[])[end])!) : NaN })).filter((x) => !Number.isNaN(x.y)).sort((a, b) => a.y - b.y);
  const gap = 13, pos = at.map((x) => x.y);
  for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + gap);
  const floor = top + plotH + 8;
  if (pos.length && pos[pos.length - 1] > floor) { pos[pos.length - 1] = floor; for (let i = pos.length - 2; i >= 0; i--) pos[i] = Math.min(pos[i], pos[i + 1] - gap); }
  at.forEach((x, i) => { const dy = Math.round(pos[i] - x.y); if (dy) (x.s.endLabel as Loose).offset = [0, dy]; });
  return option;
}
