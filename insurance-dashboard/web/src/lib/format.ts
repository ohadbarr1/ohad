export const MINUS = '−';

/* ---- one formatter for every figure on the site (lane 2H) ----
   fmt(value, unit, opts) is the only place a number becomes text. The helpers below (nf, sn, pct, fmtCell) are thin aliases kept
   for the pages that call them. Units:
     n       a plain number, 1 decimal                       12.3
     int     a count, no decimals                            1,251
     m       NIS millions: 1 decimal under 100, else none   87.4 · 1,203
     bn      NIS billions, 1 decimal                         412.6
     k       NIS thousands as stored, rescaled by opts.scale (statements)
     nis     NIS per share, 2 decimals                       4.27
     shares  a share count, never rescaled                   251,330,120
     pct     percent, 1 decimal                              14.2%
     pp      percentage points, signed                       +1.3 נק׳
     x       a multiple, 2 decimals                          1.42×
   opts: d (decimals), signed (+ on positives), dash (shown for null, default "–"), scale (unit "k" only), bare (no suffix). */
export type Unit = 'n' | 'int' | 'm' | 'bn' | 'k' | 'nis' | 'shares' | 'pct' | 'pp' | 'x';
export interface FmtOpts { d?: number; signed?: boolean; dash?: string; scale?: Scale; bare?: boolean }

/** Decimals a unit shows by default. */
export function decimals(v: number, unit: Unit, scale: Scale = 'k'): number {
  switch (unit) {
    case 'int': case 'shares': return 0;
    case 'm': return Math.abs(v) < 100 ? 1 : 0;
    case 'k': return scale === 'k' ? 0 : scale === 'm' ? 1 : 2;
    case 'nis': case 'x': return 2;
    default: return 1;
  }
}

export function fmt(v: number | null | undefined, unit: Unit = 'n', o: FmtOpts = {}): string {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v)) return o.dash ?? '–';
  const x = unit === 'k' ? scaleValue(v, 'k', o.scale ?? 'k') : v;
  const d = o.d ?? decimals(x, unit, o.scale);
  const body = (o.signed || unit === 'pp') ? sn(x, d) : nf(x, d);
  if (o.bare) return body;
  return unit === 'pct' ? `${body}%` : unit === 'pp' ? `${body} נק׳` : unit === 'x' ? `${body}×` : body;
}

/** The xlsx number format closest to how a unit is shown on screen. */
export function xlsxFmt(unit: Unit | undefined, d?: number): 'n0' | 'n1' | 'n2' | 'pct1' {
  if (unit === 'pct') return 'pct1';
  const k = d ?? (unit === 'int' || unit === 'shares' || unit === 'm' ? 0 : unit === 'nis' || unit === 'x' ? 2 : 1);
  return k <= 0 ? 'n0' : k === 1 ? 'n1' : 'n2';
}

export function nf(v: number, d = 1): string {
  const t = v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return /^-[0.]+$/.test(t) ? t.slice(1) : t.replace('-', MINUS);  // a figure that rounds to zero carries no sign
}
export function sn(v: number, d = 1): string { return (v > 0 && Number(v.toFixed(d)) !== 0 ? '+' : '') + nf(v, d); }
export function pct(v: number | null | undefined, d = 1, signed = false): string { return fmt(v, 'pct', { d, signed }); }
export function cls(v: number | null | undefined): string { return v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }

const MN = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
/** A month of regulator data: 08/26. */
export function monthLabel(yyyymm: number): string { return `${String(yyyymm % 100).padStart(2, '0')}/${String(Math.floor(yyyymm / 100)).slice(2)}`; }
/** The day a document was published or a price was taken: 27.08.26. Never an ISO date on screen. */
export function pubLabel(d: string | null | undefined): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : d;
}

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
  // statement units: 'k' NIS thousands (rescaled), 'nis' per share, 'shares' a count, 'pct' a ratio
  if (unit === 'nis' || unit === 'shares' || unit === 'pct' || unit === 'k') return fmt(v, unit, { scale });
  return fmt(v, 'n', { d: decimals(0, 'k', scale) });  // any other unit is never rescaled; its decimals follow the chosen scale
}

export function periodLabel(type: string, end: string): string {
  const y = end.slice(2, 4), m = Number(end.slice(5, 7));
  if (type === 'FY') return `FY'${y}`;
  if (type === 'H') return m === 6 ? `H1'${y}` : m === 12 ? `H2'${y}` : `6M'${y}`;
  if (type === '9M') return `9M'${y}`;
  if (type === 'Q') return `Q${Math.ceil(m / 3)}'${y}`;
  // a balance date at a quarter end is named like the quarter (Q2'26), the way every other period on the site is
  if (m % 3 === 0 && Number(end.slice(8, 10)) >= 30) return `Q${m / 3}'${y}`;
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
