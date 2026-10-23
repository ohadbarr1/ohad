/** Identity never rests on hue alone (colour-vision deficiency, dark theme): on a chart of companies over time every line gets its own
 *  marker shape and its name printed at its end, in its colour. Works on any option built by foxOption (or by hand). */
import type { EChartsCoreOption } from 'echarts/core';

const MARKS = ['circle', 'rect', 'triangle', 'diamond', 'emptyCircle', 'roundRect', 'emptyTriangle', 'pin', 'emptyDiamond', 'arrow', 'emptyRect'];
type Loose = Record<string, unknown>;

export function identify(option: EChartsCoreOption, { ends = true, marks = true }: { ends?: boolean; marks?: boolean } = {}): EChartsCoreOption {
  const o = option as Loose;
  const lines = ((o.series as Loose[] | undefined) ?? []).filter((s) => s.type === 'line');
  let longest = 0;
  lines.forEach((s, i) => {
    const color = ((s.lineStyle as Loose | undefined)?.color ?? (s.itemStyle as Loose | undefined)?.color ?? s.color) as string | undefined;
    if (marks) { s.symbol = MARKS[i % MARKS.length]; s.showSymbol = true; s.symbolSize = 7; }
    if (ends) {
      const name = String(s.name ?? '');
      longest = Math.max(longest, name.length);
      s.endLabel = { show: true, formatter: '{a}', color, fontSize: 11, fontWeight: 600, distance: 6 };
      s.labelLayout = { moveOverlap: 'shiftY' };
    }
  });
  if (ends && lines.length) {
    const g = (Array.isArray(o.grid) ? o.grid[0] : o.grid) as Loose | undefined;
    // room for the longest name at the right edge (about 6.5 px a Hebrew letter at 11 px)
    if (g) g.right = Math.max(Number(g.right ?? 14), Math.round(longest * 6.5) + 14);
  }
  return option;
}
