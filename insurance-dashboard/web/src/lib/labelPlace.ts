/** Label placement for small scatter charts (≤ 20 points): each label goes to the first spot around its point that covers no other
 *  point, no label already placed and stays inside the chart; if none is free, the spot that covers least. Pixel space, so the
 *  caller passes the plot geometry; ECharts gets a label position relative to the symbol's box. */
export interface PlacePt { id: string; x: number; y: number; r: number; text: string; first?: boolean }
export interface Placed { position: [number, number]; align: 'center' | 'left' | 'right'; verticalAlign: 'middle' }
type Box = [number, number, number, number];  // x0 y0 x1 y1

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** `w`, `h`: the chart's size in px; `charW`: px per character at the label's font size */
export function placeLabels(pts: PlacePt[], w: number, h: number, charW = 6.4, lineH = 14): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const dots: Box[] = pts.map((p) => [p.x - p.r - 1, p.y - p.r - 1, p.x + p.r + 1, p.y + p.r + 1]);
  const taken: Box[] = [];
  const order = [...pts].sort((a, b) => Number(!!b.first) - Number(!!a.first) || a.y - b.y);
  order.forEach((p) => {
    const lw = p.text.length * charW + 6, g = 4;
    // centre offsets: above, below, right, left, the four diagonals, then further above / below
    const C: [number, number][] = [
      [0, -(p.r + g + lineH / 2)], [0, p.r + g + lineH / 2], [p.r + g + lw / 2, 0], [-(p.r + g + lw / 2), 0],
      [p.r + lw / 2, -(p.r + lineH / 2)], [-(p.r + lw / 2), -(p.r + lineH / 2)], [p.r + lw / 2, p.r + lineH / 2], [-(p.r + lw / 2), p.r + lineH / 2],
      [0, -(p.r + g + lineH * 1.6)], [0, p.r + g + lineH * 1.6],
    ];
    let best: { c: [number, number]; cost: number; box: Box } | null = null;
    for (const c of C) {
      const cx = p.x + c[0], cy = p.y + c[1], box: Box = [cx - lw / 2, cy - lineH / 2, cx + lw / 2, cy + lineH / 2];
      const outside = (box[0] < 0 ? -box[0] : 0) + (box[2] > w ? box[2] - w : 0) + (box[1] < 0 ? -box[1] : 0) + (box[3] > h ? box[3] - h : 0);
      const cost = outside * 40 + dots.reduce((s, d) => s + overlap(box, d) * 3, 0) + taken.reduce((s, t) => s + overlap(box, t) * 2, 0);
      if (!best || cost < best.cost - 0.5) best = { c, cost, box };
      if (cost === 0) break;
    }
    taken.push(best!.box);
    // ECharts: an array position is relative to the top-left of the symbol's box (2r × 2r)
    out.set(p.id, { position: [p.r + best!.c[0], p.r + best!.c[1]], align: 'center', verticalAlign: 'middle' });
  });
  return out;
}
