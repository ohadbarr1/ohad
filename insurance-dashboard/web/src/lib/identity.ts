/** Identity colours: one fixed hue per company, the same on every chart, legend, table dot and chip (ws4 Appendix A §Identity).
 *  Insurers sit in a warm-to-neutral family, fund houses in a cool one. The dark theme raises lightness by 0.15.
 *  The company in focus keeps its colour (focus is an ember outline + weight, never a colour swap). */
const L_C_H: Record<string, [number, number, number, number?]> = {
  // insurers
  phoenix: [0.60, 0.20, 38], harel: [0.55, 0.16, 25], migdal: [0.52, 0.14, 300], clal: [0.55, 0.14, 250], menora: [0.60, 0.12, 85],
  hachshara: [0.55, 0.10, 190], ayalon: [0.50, 0.14, 340], idi: [0.62, 0.08, 60],
  // fund houses
  meitav: [0.50, 0.15, 265], altshuler: [0.58, 0.15, 150], more: [0.55, 0.13, 215], analyst: [0.52, 0.12, 320], yelin: [0.60, 0.13, 110],
  infinity: [0.55, 0.10, 230], globalnet: [0.60, 0.06, 60], ibi: [0.48, 0.12, 285], more_gemel: [0.55, 0.13, 215, 0.6],
};
/** ids used by other sources for the same company */
const ALIAS: Record<string, string> = { direct: 'idi' };
const dark = () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';

/** The colour as CSS (oklch), for inline styles: `style={{ background: idCss('harel') }}`. Unknown ids get the neutral token. */
export function idCss(id: string, theme: 'phoenix' | 'dark' = dark() ? 'dark' : 'phoenix'): string {
  const v = L_C_H[ALIAS[id] ?? id];
  if (!v) return 'var(--neutral)';
  const [l, c, h, a] = v, L = Math.min(0.9, theme === 'dark' ? l + 0.15 : l);
  return `oklch(${L.toFixed(3)} ${c} ${h}${a != null ? ` / ${a}` : ''})`;
}

let probe: CanvasRenderingContext2D | null = null;
const cache = new Map<string, string>();
/** The colour as rgb(), for ECharts (which cannot parse oklch). Follows the current theme. */
export function idColor(id: string): string {
  const css = idCss(id);
  if (css.startsWith('var(')) { const n = getComputedStyle(document.documentElement).getPropertyValue('--neutral').trim(); return toRgb(n || '#7A7F8C'); }
  return toRgb(css);
}
function toRgb(css: string): string {
  const hit = cache.get(css);
  if (hit) return hit;
  probe ??= typeof document === 'undefined' ? null : Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  if (!probe) return css;
  probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = css; probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const out = a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  cache.set(css, out);
  return out;
}
/** true when the id has an identity colour */
export const hasIdentity = (id: string) => (ALIAS[id] ?? id) in L_C_H;

/** regulator group names (market.json `groups`, registry `market_group`) → registry id */
export const GROUP_ID: Record<string, string> = {
  'הפניקס': 'phoenix', 'הראל': 'harel', 'מגדל': 'migdal', 'כלל': 'clal', 'מנורה מבטחים': 'menora', 'הכשרה': 'hachshara', 'איילון': 'ayalon', 'ביטוח ישיר': 'idi',
  'מיטב': 'meitav', 'אלטשולר שחם': 'altshuler', 'מור': 'more', 'אנליסט': 'analyst', 'ילין לפידות': 'yelin', 'אינפיניטי': 'infinity', 'גלובלנט': 'globalnet',
};
/** identity colour (rgb) of a regulator group; groups without a company ("קרנות ענפיות ואחרות") get the neutral token */
export const idColorOfGroup = (group: string): string => idColor(GROUP_ID[group] ?? '');
