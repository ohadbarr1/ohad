import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} });

function initial(): Theme {
  try { const t = localStorage.getItem('theme'); if (t === 'dark' || t === 'light') return t; } catch { /* storage may be blocked */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
  }, [theme]);
  return <Ctx.Provider value={{ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }}>{children}</Ctx.Provider>;
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
  return { fg: cssColor('--fg'), mu: cssColor('--muted'), ln: cssColor('--line'), panel: cssColor('--panel'), accent: cssColor('--accent'), down: cssColor('--down'), up: cssColor('--up') };
}
export const CHART_FONT = '"Heebo", "Inter", sans-serif';
