import type { FundHist } from './useData';
import { sn } from './format';

export const CRISES: { key: string; label: string; base: number; to: number }[] = [
  { key: 'gfc', label: 'משבר 2008', base: 200712, to: 200906 },
  { key: 'covid', label: 'קורונה 2020', base: 202001, to: 202012 },
  { key: 'rates', label: 'ריבית 2022', base: 202112, to: 202212 },
  { key: 'war', label: 'מלחמה 10/23', base: 202309, to: 202403 },
];
export const CRISIS_FORMULA = 'מדד = מכפלת (1 + תשואה חודשית) מסוף חודש הבסיס. ירידה = השפל בחלון ÷ המדד בבסיס, פחות 1. התאוששות = חודשים מהשפל עד שהמדד חוזר לרמת הבסיס';
export interface Crisis { dd: number; trough: number; rec: number | null; months: number[] }
const next = (p: number) => (p % 100 === 12 ? (Math.floor(p / 100) + 1) * 100 + 1 : p + 1);
/** drawdown from the base month to the trough inside the window, and months from the trough until the base level is regained */
export function crisis(s: { p: number[]; y: (number | null)[] }, base: number, to: number): Crisis | null {
  const at = new Map(s.p.map((p, i) => [p, s.y[i]]));
  if (!s.p.includes(base) && !(s.p[0] < base)) return null;
  let idx = 1, low = 1, trough = base, p = next(base);
  const months: number[] = [];
  for (; p <= to; p = next(p)) { const r = at.get(p); if (r == null) return null; months.push(p); idx *= 1 + r / 100; if (idx < low) { low = idx; trough = p; } }
  if (trough === base) return { dd: 0, trough, rec: 0, months };
  // recovery: carry on from the trough
  idx = 1; let q = next(base), rec: number | null = null, k = 0;
  for (; at.has(q); q = next(q)) { const r = at.get(q); if (r == null) break; idx *= 1 + r / 100; if (q > trough) { k++; if (idx >= 1) { rec = k; break; } } if (q > trough) months.push(q); }
  return { dd: (low - 1) * 100, trough, rec, months: [...new Set(months)].sort((a, b) => a - b) };
}
export const ddText = (c: Crisis | null) => (c == null ? '–' : `${sn(c.dd, 1)}%`);
export type { FundHist };
