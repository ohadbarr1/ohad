import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'phoenix' | 'dark';
/** Phoenix is the house look; the obsidian look and its light variant stay as choices. */
export const THEMES: [Theme, string][] = [['phoenix', 'בהיר'], ['dark', 'כהה']];
const KEY = 'theme2'; // a new key, so a choice saved before the Phoenix look existed does not hide it
const Ctx = createContext<{ theme: Theme; toggle: () => void; next: Theme }>({ theme: 'phoenix', toggle: () => {}, next: 'dark' });
const after = (t: Theme): Theme => THEMES[(THEMES.findIndex(([x]) => x === t) + 1) % THEMES.length][0];

function initial(): Theme {
  try { const t = localStorage.getItem(KEY); if (t === 'phoenix' || t === 'dark') return t; } catch { /* storage may be blocked */ }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'phoenix';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    // Phoenix has a navy top bar; the dark look shows its page ground (as rgb: browsers do not all read oklch here)
    requestAnimationFrame(() => meta?.setAttribute('content', theme === 'phoenix' ? '#111C3F' : cssColor('--bg')));
  }, [theme]);
  return <Ctx.Provider value={{ theme, next: after(theme), toggle: () => setTheme((t) => { const n = after(t); try { localStorage.setItem(KEY, n); } catch { /* ignore */ } return n; }) }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
let probe: CanvasRenderingContext2D | null = null;
const rgbCache = new Map<string, string>();
/** A CSS colour token as rgb(): the chart library cannot parse oklch(). */
export function cssColor(name: string): string {
  const raw = cssVar(name);
  const hit = rgbCache.get(raw);
  if (hit) return hit;
  probe ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  if (!probe) return raw;
  probe.clearRect(0, 0, 1, 1); probe.fillStyle = raw; probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const out = a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  rgbCache.set(raw, out);
  return out;
}
export function palette(): string[] {
  return ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8', '--s9', '--s10', '--s11'].map(cssColor);
}
export function chartBase() {
  return { fg: cssColor('--fg'), mu: cssColor('--muted'), ln: cssColor('--line'), ln2: cssColor('--line-soft'), panel: cssColor('--panel'), accent: cssColor('--accent'), down: cssColor('--down'), up: cssColor('--up') };
}
/** The tooltip box of every chart: the panel surface, lifted (e-2), rounded like a menu. */
export function tooltipCss(): string {
  return `box-shadow:${cssVar('--shadow')};border-radius:8px;padding:8px 11px;line-height:1.55;`;
}
export const CHART_FONT = '"Heebo", "Inter", sans-serif';
