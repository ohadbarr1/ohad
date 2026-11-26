/* The compare pack (funds plan #22): the head-to-head as a workbook an analyst can audit. One sheet per track with the published
   monthly gross return, the published accumulation fee (shown beside it, never subtracted: owner 26.11.26), the growth index and the
   fall from the peak as formulas; a summary whose every statistic is a formula over those sheets; the months side by side; a sources sheet.
   Unbranded: the reader's own material (no site name in the cells or the file properties). Pure: returns the sheets; lib/xlsx writes them. */
import type { XCell, XSheet } from './xlsx';

export interface PackTrack {
  k: string; name: string; mgr: string; grp?: string; prod: string; track: string;
  p: number[]; y: (number | null)[];
  /** the accumulation fee of each month (% a year), gaps already filled with the last fee published */
  fee: (number | null)[];
  /** months whose fee was filled */
  filled?: number;
  feeNow?: number | null; depfee?: number | null; assets?: number | null; gone?: boolean; end?: number;
}
/** a fee series with its gaps filled: a month with no fee takes the last one published (before the first, the first); `filled` counts them */
export function fillFee(fee: (number | null)[]): { fee: (number | null)[]; filled: number } {
  const first = fee.find((x) => x != null) ?? null;
  let last: number | null = null, filled = 0;
  return { fee: fee.map((x) => { if (x != null) { last = x; return x; } filled++; return last ?? first; }), filled };
}
const ym = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
const H = (v: string): XCell => ({ v, head: true });
/** the sheet name lib/xlsx will write (same sanitising), unique among `used` */
export function sheetName(raw: string, used: Set<string>): string {
  let n = raw.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
  for (let k = 2; used.has(n.toLowerCase()); k++) n = `${n.slice(0, 28)} ${k}`;
  used.add(n.toLowerCase());
  return n;
}
const ref = (sheet: string, cell: string) => `'${sheet.replace(/'/g, "''")}'!${cell}`;
const r4 = (v: number) => +v.toFixed(6);

/** what the summary computes for one track from its sheet (cached values mirror the formulas) */
interface Built { sheet: string; last: number; n: number; ixG: number[]; ddG: number[] }

function trackSheet(t: PackTrack, name: string): { sh: XSheet; b: Built } {
  const rows: XCell[][] = [[H('חודש'), H('תשואה ברוטו, %'), H('ד"נ מצבירה, % שנתי'), H('מדד (100 בבסיס)'), H('מתחת לשיא, %')]];
  const ixG: number[] = [], ddG: number[] = [];
  let pg = 100, peakG = 100;
  t.p.forEach((p, i) => {
    const r = i + 2, g = t.y[i], fe = t.fee[i];
    pg = g == null ? pg : pg * (1 + g / 100);
    peakG = Math.max(peakG, pg);
    ixG.push(pg); ddG.push((pg / peakG - 1) * 100);
    const prevD = r === 2 ? '100' : `D${r - 1}`;
    rows.push([ym(p), g == null ? null : { v: g, fmt: 'n2' }, fe == null ? null : { v: fe, fmt: 'n2' },
      { v: r4(pg), f: `IF(B${r}="",${prevD},${prevD}*(1+B${r}/100))`, fmt: 'n2' },
      { v: r4((pg / peakG - 1) * 100), f: `(D${r}/MAX(100,MAX(D$2:D${r}))-1)*100`, fmt: 'n2' }]);
  });
  const sh: XSheet = { name, rows, freeze: { rows: 1, cols: 1 }, widths: [9, 12, 12, 13, 12] };
  return { sh, b: { sheet: name, last: t.p.length + 1, n: t.p.length, ixG, ddG } };
}

/** The workbook: summary, one sheet per track, the months side by side, sources. */
export function comparePack(ts: PackTrack[], asof: number, src = 'הרשות לשוק ההון, ביטוח וחיסכון: גמל-נט, פנסיה-נט, ביטוח-נט (data.gov.il)'): XSheet[] {
  const used = new Set<string>(['סיכום', 'חודשי', 'מקורות']);
  const built = ts.map((t, i) => trackSheet(t, sheetName(`${i + 1} ${t.name}`, used)));
  type Stat = { label: string; band?: boolean; cell: (t: PackTrack, b: Built) => XCell };
  const span = (b: Built, m: number, ix: 'D', arr: number[], annual: boolean): XCell => {
    const lastR = b.last, baseR = lastR - m;  // the row before the window; row 1 = the base (100)
    if (baseR < 1) return '–';
    const baseV = baseR === 1 ? 100 : arr[baseR - 2], lastV = arr[lastR - 2];
    const baseF = baseR === 1 ? '100' : ref(b.sheet, `${ix}${baseR}`), lastF = ref(b.sheet, `${ix}${lastR}`);
    const v = annual ? ((lastV / baseV) ** (12 / m) - 1) * 100 : (lastV / baseV - 1) * 100;
    return { v: r4(v), f: annual ? `((${lastF}/${baseF})^(12/${m})-1)*100` : `(${lastF}/${baseF}-1)*100`, fmt: 'n2' };
  };
  const vol = (b: Built, c: 'B', vals: (number | null)[], m: number): XCell => {
    const from = Math.max(2, b.last - m + 1), xs = vals.slice(from - 2).filter((x): x is number => x != null);
    if (xs.length < 3) return '–';
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length, sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1));
    return { v: r4(sd * Math.sqrt(12)), f: `STDEV(${ref(b.sheet, `${c}${from}:${c}${b.last}`)})*SQRT(12)`, fmt: 'n2' };
  };
  const ext = (b: Built, c: string, vals: (number | null)[], fn: 'MIN' | 'MAX'): XCell => {
    const xs = vals.filter((x): x is number => x != null);
    if (!xs.length) return '–';
    return { v: r4(fn === 'MIN' ? Math.min(...xs) : Math.max(...xs)), f: `${fn}(${ref(b.sheet, `${c}2:${c}${b.last}`)})`, fmt: 'n2' };
  };
  const gross = (t: PackTrack) => t.y;
  const STATS: Stat[] = [
    { label: 'מוצר', cell: (t) => t.prod }, { label: 'מסלול', cell: (t) => t.track }, { label: 'מנהל', cell: (t) => t.mgr },
    { label: 'מצב', cell: (t) => (t.gone ? `נסגר${t.end ? ' ' + ym(t.end) : ''}` : 'פעיל') },
    { label: 'חודש ראשון', cell: (t) => (t.p.length ? ym(t.p[0]) : '–') }, { label: 'חודש אחרון', cell: (t) => (t.p.length ? ym(t.p[t.p.length - 1]) : '–') },
    { label: 'חודשים עם תשואה', cell: (t, b) => ({ v: t.y.filter((x) => x != null).length, f: `COUNT(${ref(b.sheet, `B2:B${b.last}`)})`, fmt: 'n0' }) },
    { label: 'תשואה ברוטו: כפי שפורסמה, לפני דמי ניהול', band: true, cell: () => null },
    { label: 'תשואה מצטברת, כל התקופה %', cell: (_t, b) => span(b, b.n, 'D', b.ixG, false) },
    { label: 'שנתי, כל התקופה %', cell: (_t, b) => span(b, b.n, 'D', b.ixG, true) },
    { label: 'LTM %', cell: (_t, b) => span(b, 12, 'D', b.ixG, false) },
    { label: '3Y שנתי %', cell: (_t, b) => span(b, 36, 'D', b.ixG, true) },
    { label: '5Y שנתי %', cell: (_t, b) => span(b, 60, 'D', b.ixG, true) },
    { label: '10Y שנתי %', cell: (_t, b) => span(b, 120, 'D', b.ixG, true) },
    { label: 'תנודתיות שנתית, 36 חודשים %', cell: (t, b) => vol(b, 'B', gross(t), 36) },
    { label: 'ירידה מרבית, כל התקופה %', cell: (_t, b) => ext(b, 'E', b.ddG, 'MIN') },
    { label: 'החודש הטוב %', cell: (t, b) => ext(b, 'B', gross(t), 'MAX') },
    { label: 'החודש הרע %', cell: (t, b) => ext(b, 'B', gross(t), 'MIN') },
    { label: 'עלות', band: true, cell: () => null },
    { label: 'ד"נ מצבירה, חודש אחרון % שנתי', cell: (t, b) => { const v = t.fee[t.fee.length - 1]; return v == null ? '–' : { v, f: ref(b.sheet, `C${b.last}`), fmt: 'n2' }; } },
    { label: 'ד"נ מהפקדה, אחרון %', cell: (t) => (t.depfee == null ? '–' : { v: t.depfee, fmt: 'n2' }) },
    { label: 'נכסים, מיליוני ש"ח', cell: (t) => (t.assets == null ? '–' : { v: t.assets, fmt: 'n0' }) },
  ];
  const summary: XSheet = { name: 'סיכום', freeze: { rows: 1, cols: 1 }, widths: [34, ...ts.map(() => 22)],
    rows: [[H('מדד'), ...ts.map((t) => H(t.name))], ...STATS.map((s) => (s.band ? [{ v: s.label, band: true }, ...ts.map(() => ({ v: '', band: true }))] : [s.label, ...ts.map((t, i) => s.cell(t, built[i].b))]))] };

  // the months side by side
  const months = [...new Set(ts.flatMap((t) => t.p))].sort((a, b) => a - b);
  const side: XSheet = { name: 'חודשי', freeze: { rows: 1, cols: 1 }, widths: [9, ...ts.map(() => 16)],
    rows: [[H('חודש'), ...ts.map((t) => H(`${t.name} · ברוטו %`))],
      ...months.map((p) => [ym(p), ...ts.map((t, i): XCell => { const j = t.p.indexOf(p); const g = j < 0 ? null : t.y[j];
        return g == null ? null : { v: g, f: ref(built[i].b.sheet, `B${j + 2}`), fmt: 'n2' }; })])] };

  const sources: XSheet = { name: 'מקורות', widths: [120], rows: [
    [{ v: 'מקורות ושיטה', bold: true }],
    [`מקור: ${src}. נתונים עד ${ym(asof)}.`],
    ['תשואה ברוטו: MONTHLY_YIELD, תשואה חודשית נומינלית לפני דמי ניהול, כפי שפורסמה.'],
    ['דמי ניהול מצבירה: AVG_ANNUAL_MANAGEMENT_FEE, % שנתי, ממוצע בפועל של המסלול. חודש בלי דמי ניהול שפורסמו: האחרון שפורסם לפניו (או הראשון שפורסם, לפני הפרסום הראשון).'],
    ['כל התשואות ברוטו, כפי שפורסמו, לפני דמי ניהול. דמי הניהול שמשלם כל חוסך שונים ונקבעים מול הגוף המנהל, ולכן אינם מנוכים מהתשואה; הם מוצגים בעמודה נפרדת.'],
    ['מדד: 100 בבסיס, כל חודש מוכפל ב-(1 + תשואה ÷ 100); חודש בלי תשואה משאיר את המדד במקומו. מתחת לשיא = המדד ÷ השיא שלפניו − 1.'],
    ['שנתי = (מדד סוף ÷ מדד בסיס) בחזקת 12 ÷ מספר החודשים, פחות 1. תנודתיות = סטיית התקן של התשואות החודשיות × שורש 12.'],
    ['כל הנוסחאות חיות: שינוי תשואה בגיליון מסלול מעדכן את הסיכום. תשואות עבר אינן מבטיחות תשואות בעתיד.'],
    ...ts.filter((t) => t.filled).map((t) => [`${t.name}: ${t.filled} חודשים עם דמי ניהול שהושלמו מהחודש הקודם שפורסם.`]),
  ] };
  return [summary, ...built.map((x) => x.sh), side, sources];
}
