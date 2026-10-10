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
  if (type === 'H') return m === 6 ? `H1'${y}` : `6M'${y}`;
  if (type === '9M') return `9M'${y}`;
  if (type === 'Q') return `Q${Math.ceil(m / 3)}'${y}`;
  return `${Number(end.slice(8, 10))} ${MN[m - 1]} '${y}`;
}
export function periodLong(type: string): string {
  return type === 'FY' ? 'FY' : type === 'H' ? 'H1' : type === '9M' ? '9M' : type === 'Q' ? 'Q' : 'תאריך מאזן';
}
