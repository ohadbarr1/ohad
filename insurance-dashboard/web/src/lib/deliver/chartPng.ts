/* S4 · an exhibit as a picture (Word, print, preview): the chart book's own option (bookChart.bookOption, polished like every chart of
   the site), drawn off screen in the light house theme whatever theme the reader has, on white, at print resolution. Browser only. */
import type { Doc } from '../doc';
import type { Png } from './docx';
import { exSpec } from './notes';

export interface Pic extends Png { url: string }
const CSS_W = 760, CSS_H = 380, RATIO = 3;

function bytesOf(url: string): Uint8Array {
  const b = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** every chart exhibit of the doc, by block index (tables stay tables) */
export async function exhibitPics(doc: Doc): Promise<Record<number, Pic>> {
  const idx = doc.blocks.map((b, i) => (b.k === 'exhibit' && b.ex.kind !== 'table' && b.ex.series?.length ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return {};
  const [{ echarts }, { bookOption }, { polish }] = await Promise.all([import('../echarts'), import('../bookChart'), import('../foxchart')]);
  try { await document.fonts?.ready; } catch { /* fonts are a nicety */ }
  const root = document.documentElement, was = root.getAttribute('data-theme');
  const out: Record<number, Pic> = {};
  for (const i of idx) {
    const b = doc.blocks[i];
    if (b.k !== 'exhibit') continue;
    // the colours are read from the theme's tokens: draw in the light theme, then put the reader's back
    if (was !== 'phoenix') root.setAttribute('data-theme', 'phoenix');
    let opt;
    try { opt = polish(bookOption(exSpec(b.ex))) as Record<string, unknown>; } finally { if (was == null) root.removeAttribute('data-theme'); else if (was !== 'phoenix') root.setAttribute('data-theme', was); }
    const div = document.createElement('div');
    const chart = echarts.init(div, undefined, { renderer: 'canvas', width: CSS_W, height: CSS_H, devicePixelRatio: RATIO });
    try {
      chart.setOption({ ...opt, animation: false, backgroundColor: '#ffffff', tooltip: { show: false } });
      const url = chart.getDataURL({ type: 'png', pixelRatio: RATIO, backgroundColor: '#ffffff' });
      out[i] = { url, data: bytesOf(url), w: CSS_W * RATIO, h: CSS_H * RATIO };
    } catch { /* a chart that cannot be drawn goes out as its data table */ } finally { chart.dispose(); }
  }
  return out;
}
