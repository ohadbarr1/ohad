export const MINUS = '−';

export function nf(v: number, d = 1): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', MINUS);
}
export function sn(v: number, d = 1): string { return (v > 0 ? '+' : '') + nf(v, d); }
export function pct(v: number | null | undefined, d = 1, signed = false): string {
  if (v == null || Number.isNaN(v)) return '–';
  return (signed ? sn(v, d) : nf(v, d)) + '%';
}
export function cls(v: number | null | undefined): string { return v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }

const MN = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
export function monthLabel(yyyymm: number): string { return `${MN[yyyymm % 100 - 1]} ${Math.floor(yyyymm / 100)}`; }

/** Units for company statements. Source values are NIS thousands unless the metric says otherwise. */
export type Scale = 'k' | 'm' | 'b';
export const SCALES: { id: Scale; label: string; div: number }[] = [
  { id: 'k', label: 'ש"ח · אלפים', div: 1 },
  { id: 'm', label: 'ש"ח · מיליונים', div: 1e3 },
  { id: 'b', label: 'ש"ח · מיליארדים', div: 1e6 },
];
export function scaleValue(v: number, unit: string, scale: Scale): number {
  if (unit !== 'k') return v; // per-share and percentages are never rescaled
  return v / SCALES.find((s) => s.id === scale)!.div;
}
export function fmtCell(v: number | null | undefined, unit: string, scale: Scale): string {
  if (v == null) return '–';
  const x = scaleValue(v, unit, scale);
  if (unit === 'nis') return nf(x, 2);
  if (unit === 'pct') return nf(x, 1) + '%';
  const d = scale === 'k' ? 0 : scale === 'm' ? 1 : 2;
  return nf(x, d);
}

export function periodLabel(type: string, end: string): string {
  const y = end.slice(2, 4), m = Number(end.slice(5, 7));
  if (type === 'FY') return `FY'${y}`;
  if (type === 'H') return m === 6 ? `H1'${y}` : m === 12 ? `H2'${y}` : `6M'${y}`;
  if (type === '9M') return `9M'${y}`;
  if (type === 'Q') return `Q${Math.ceil(m / 3)}'${y}`;
  return `${Number(end.slice(8, 10))} ${MN[m - 1]} '${y}`;
}
export function periodLong(type: string): string {
  return type === 'LTM' ? 'LTM' : type === 'FY' ? 'FY' : type === 'H' ? 'H' : type === '9M' ? '9M' : type === 'Q' ? 'Q' : 'תאריך מאזן';
}

/** A balance or period-end date the way the site names periods: a quarter end is Q4'25, any other date is 15.05.26. */
export function dateLabel(d: string | null | undefined): string {
  if (!d || d.length < 10) return d ?? '';
  const q = { '03-31': 'Q1', '06-30': 'Q2', '09-30': 'Q3', '12-31': 'Q4' }[d.slice(5, 10)];
  return q ? `${q}'${d.slice(2, 4)}` : `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;
}
/** Report periods ("2025Q3", "2025FY") newest first; the annual report sorts as the fourth quarter of its year, after Q3. */
const periodKey = (p: string): string => `${p.slice(0, 4)}${p.endsWith('FY') ? 'Q4' : p.slice(4)}`;
export const byPeriodDesc = (a: string, b: string): number => periodKey(b).localeCompare(periodKey(a));
