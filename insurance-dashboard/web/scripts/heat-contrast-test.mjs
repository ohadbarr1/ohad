// F8: the heat fills of the compare grid keep the cell text readable. Reads --heat-up / --heat-down, --panel and --fg from src/styles.css
// (light :root and dark :root[data-theme="dark"]), lays each fill over --panel at the grid's opacity range (7%–40%) and checks the ink
// colour on it against WCAG AA (4.5:1). Also checks the two stay apart for deuteranopia and protanopia (simulated, Machado 2009; OKLab distance).
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const block = (sel) => { const i = css.indexOf(sel + ' {'); if (i < 0) throw new Error(`no block ${sel}`); return css.slice(i, css.indexOf('\n}', i)); };
const tok = (b, name) => { const m = b.match(new RegExp(`--${name}:\\s*([^;]+);`)); if (!m) throw new Error(`no --${name}`); return m[1].trim(); };

// colour parsing: #rrggbb, an "r g b" triplet, oklch(L C H)
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function oklch(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, bb].map((x) => Math.min(1, Math.max(0, gam(x))) * 255);
}
function rgb(v) {
  if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  const o = v.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/); if (o) return oklch(+o[1], +o[2], +o[3]);
  const t = v.split(/\s+/).map(Number); if (t.length === 3 && t.every((x) => x >= 0 && x <= 255)) return t;
  throw new Error(`cannot parse ${v}`);
}
const lum = (c) => { const [r, g, b] = c.map((x) => lin(x / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
// colour-vision simulation, severity 1.0 (Machado, Oliveira, Fernandes 2009), in linear RGB
const CVD = { deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]], protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]] };
const sim = (c, M) => { const l = c.map((x) => lin(x / 255)); return M.map((r) => gam(Math.min(1, Math.max(0, r[0] * l[0] + r[1] * l[1] + r[2] * l[2]))) * 255); };
// OKLab distance ×100 (about 2 is a just-noticeable difference)
const oklab = (c) => { const [r, g, b] = c.map((x) => lin(x / 255)); const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
const dE = (a, b) => 100 * Math.hypot(...oklab(a).map((x, i) => x - oklab(b)[i]));

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fail++; };
for (const [theme, sel] of [['light', ':root'], ['dark', ':root[data-theme="dark"]']]) {
  const b = block(sel), panel = rgb(tok(b, 'panel')), fg = rgb(tok(b, 'fg'));
  const up = rgb(tok(b, 'heat-up')), down = rgb(tok(b, 'heat-down'));
  for (const [name, c] of [['up', up], ['down', down]]) {
    const worst = Math.min(...[0.07, 0.15, 0.25, 0.33, 0.4].map((a) => ratio(fg, over(c, panel, a))));
    ok(worst >= 4.5, `${theme} heat-${name}: ink on the fill, worst over 7–40% = ${worst.toFixed(2)}:1 (AA 4.5)`);
  }
  for (const [cvd, M] of Object.entries(CVD)) {
    const full = dE(sim(up, M), sim(down, M)), at40 = dE(sim(over(up, panel, 0.4), M), sim(over(down, panel, 0.4), M));
    ok(full >= 10 && at40 >= 4, `${theme} ${cvd}: up and down stay apart, OKLab ΔE ${full.toFixed(1)} as bars, ${at40.toFixed(1)} as the strongest fill (min 10 / 4; the sign is written anyway)`);
  }
}
if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log('heat contrast: all passed');
