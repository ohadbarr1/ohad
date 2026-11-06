/* Wave 11 "under": the shekel cost of a bottom-quartile track that still receives money (pipeline/build_under.py → under.json,
   under/m/<yyyymm>.json). The arithmetic the page and the saver's line run on the files: rows, the generated headline line, the saver's
   rule, and the provenance of every figure (a calc Prov whose inputs open the regulator's record of the track). Pure: no React, no DOM;
   tests/under.unit.ts pins it against the published files. Units: NIS millions; returns and gaps percent per year; months yyyymm. */
import type { Prov } from './prov';
import type { RegDs } from './sources';
import { MINUS, WJ, nf, sn } from './format';

export const UNDER_PATH = 'under.json';
export const underMonthPath = (p: number) => `under/m/${p}.json`;

export interface UnderSeries { n: number[]; a: number[]; cost: number[]; icost: number[]; fl: number[]; n_bq: number[]; a_bq: number[]; cost_bq: number[]; n_rk: number[]; n_cat: number[] }
export interface UnderFile {
  v: number; asof: number; src: string; from: number; win: number; band_bp: number; bq: number; saver_bp: number;
  method: Record<'what' | 'past' | 'why5' | 'net' | 'cat' | 'pct' | 'med' | 'gap' | 'cost' | 'icost' | 'flow' | 'mig' | 'head' | 'series' | 'not', string>;
  months: number[]; series: UnderSeries; byp: Record<string, number[]>; prods: Record<string, string>; flow_prods: string[];
  cov: string[][]; cov_from: Record<string, number | null>; full_from: number | null;
  cols: string[]; rows: unknown[][]; head_n: number;
}
export interface UnderRow {
  k: string; name: string; grp: string; cat: string; pid: string | null; a: number; r5: number; med: number; n: number; pct: number; gap: number; cost: number;
  nd12: number | null; org12: number | null; ext12: number | null; c12: number | null; mig: 0 | 1; gfl12: number | null; icost: number | null; head: 0 | 1;
}
export interface UnderMonth { v: number; p: number; cols: string[]; cats: Record<string, [number, number]>; rows: unknown[][] }
export interface UnderMRow { k: string; a: number; r5: number; pct: number; gap: number; cost: number; nd12: number; c12: number; mig: 0 | 1; gfl12: number | null; icost: number | null }

const zip = <T,>(cols: string[], r: unknown[]) => Object.fromEntries(cols.map((c, i) => [c, r[i]])) as T;
export const rowsOf = (U: UnderFile): UnderRow[] => U.rows.map((r) => zip<UnderRow>(U.cols, r));
export const monthRows = (M: UnderMonth): UnderMRow[] => M.rows.map((r) => zip<UnderMRow>(M.cols, r));
export const headRows = (rows: UnderRow[]) => rows.filter((r) => r.head).sort((a, b) => b.cost - a.cost);

/** 202609 → 09/26 */
export const ym = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
export const addM = (p: number, d: number) => { const t = Math.floor(p / 100) * 12 + (p % 100 - 1) + d; return Math.floor(t / 12) * 100 + (t % 12) + 1; };
/** NIS millions as words: "₪1.6 מיליארד" from 1,000, else "₪908 מיליון" */
/** ₪ millions / billions in text: the sign first and glued to ₪ ("−₪630", never "₪−630"), the figure isolated (LRI … PDI) so it keeps
 *  its order in Hebrew text and NumText renders it as one unbreakable piece */
export const ilsM = (m: number) => {
  const big = Math.abs(m) >= 1000, t = nf(Math.abs(big ? m / 1000 : m), big ? 1 : 0), neg = m < 0 && /[1-9]/.test(t);
  return `\u2066${neg ? `${MINUS}${WJ}` : ''}₪${t}\u2069 ${big ? 'מיליארד' : 'מיליון'}`;
};
export const bp = (pp: number) => Math.round(pp * 100);

/** the track's record at the regulator: g / p / i + id */
export function refOfK(k: string, name: string): { ds: RegDs; id: number; name: string } {
  const ds: RegDs = k[0] === 'g' ? 'gemel' : k[0] === 'p' ? 'pensia' : 'insurance';
  return { ds, id: Number(k.slice(1)), name };
}
const fundP = (k: string, name: string, p: number, col: string, label: string, value: string, unit?: string, note?: string): Prov =>
  ({ k: 'fund', title: `${label} · ${name}`, value, unit, ...refOfK(k, name), period: p, col, note });

/* ---------------- provenance ---------------- */
/** 5Y annualised net of one track: the compounded monthly net returns, or (the latest month) the figure of the track card */
export function r5Prov(U: UnderFile, r: Pick<UnderRow, 'k' | 'name' | 'r5'>, p = U.asof): Prov {
  const from = addM(p, -(U.win - 1));
  return { k: 'calc', est: true, title: `תשואה שנתית ממוצעת, 5 שנים, נטו (אומדן) · ${r.name}`, value: `${nf(r.r5, 2)}%`, formula: U.method.net,
    inputs: [
      { label: 'חלון', v: `${ym(from)}–${ym(p)} (${U.win} חודשים)` },
      { label: `תשואה שנתית ממוצעת 5 שנים, ברוטו, כפי שפורסמה · ${ym(p)}`, v: 'ברשומה', src: () => fundP(r.k, r.name, p, 'AVG_ANNUAL_YIELD_TRAILING_5YRS', 'תשואה שנתית ממוצעת 5 שנים, ברוטו', 'ברשומה', '%') },
      { label: `דמי ניהול מצבירה, ממוצע בפועל · ${ym(p)}`, v: 'ברשומה', src: () => fundP(r.k, r.name, p, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', 'ברשומה', '%') },
    ], note: U.method.past };
}
/** the category median: every ranked track of the category in the latest month */
export function medProv(U: UnderFile, cat: string, rows: UnderRow[]): Prov {
  const xs = rows.filter((r) => r.cat === cat).sort((a, b) => b.r5 - a.r5), med = xs[0]?.med ?? null;
  return { k: 'calc', est: true, title: `חציון הקטגוריה · ${cat} · 5 שנים, נטו`, value: med == null ? '–' : `${nf(med, 2)}%`, formula: U.method.med,
    inputs: xs.map((r) => ({ label: r.name, v: `${nf(r.r5, 2)}%`, src: () => r5Prov(U, r) })), note: `${U.method.cat}. ${xs.length} מסלולים` };
}
export function pctProv(U: UnderFile, r: UnderRow): Prov {
  return { k: 'calc', title: `אחוזון בקטגוריה, 5 שנים נטו · ${r.name}`, value: String(r.pct), formula: U.method.pct,
    inputs: [{ label: 'תשואה 5 שנים, נטו', v: `${nf(r.r5, 2)}%`, src: () => r5Prov(U, r) }, { label: `מסלולים מדורגים ב-${r.cat}`, v: String(r.n) }] };
}
export function gapProv(U: UnderFile, r: UnderRow, rows: UnderRow[]): Prov {
  const raw = r.med - r.r5;
  return { k: 'calc', est: true, title: `פער מחציון הקטגוריה · ${r.name}`, value: `${nf(r.gap, 2)} נ"א לשנה`, formula: U.method.gap,
    inputs: [{ label: `חציון ${r.cat}`, v: `${nf(r.med, 2)}%`, src: () => medProv(U, r.cat, rows) }, { label: 'תשואת המסלול, 5 שנים נטו', v: `${nf(r.r5, 2)}%`, src: () => r5Prov(U, r) },
      { label: 'חציון פחות המסלול', v: `${sn(raw, 2)} נ"א` }, { label: 'פס השוויון', v: `${nf(U.band_bp / 100, 2)} נ"א` }], note: U.method.past };
}
export function aumProv(U: UnderFile, r: Pick<UnderRow, 'k' | 'name' | 'a'>, p = U.asof): Prov { return fundP(r.k, r.name, p, 'TOTAL_ASSETS', 'נכסים', nf(r.a, 1), 'מיליוני ש"ח'); }
export function costProv(U: UnderFile, r: UnderRow, rows: UnderRow[]): Prov {
  return { k: 'calc', est: true, title: `עלות הפער בשנה · ${r.name}`, value: nf(r.cost, 1), unit: 'מיליוני ש"ח לשנה', formula: U.method.cost,
    inputs: [{ label: `נכסים · ${ym(U.asof)}`, v: nf(r.a, 1), src: () => aumProv(U, r) }, { label: 'פער מהחציון, נ"א לשנה', v: nf(r.gap, 2), src: () => gapProv(U, r, rows) }],
    note: `${U.method.past}. ${U.method.not}` };
}
export function flowProv(U: UnderFile, r: UnderRow): Prov {
  const from = addM(U.asof, -11);
  return { k: 'calc', est: true, title: `צבירה נטו 12M בלי נדידה פנימית · ${r.name}`, value: r.c12 == null ? '–' : nf(r.c12, 1), unit: 'מיליוני ש"ח', formula: U.method.flow,
    inputs: [
      { label: `צבירה נטו כפי שפורסמה, ${ym(from)}–${ym(U.asof)} (Σ NET_MONTHLY_DEPOSITS)`, v: r.nd12 == null ? '–' : nf(r.nd12, 1), src: () => fundP(r.k, r.name, U.asof, 'NET_MONTHLY_DEPOSITS', 'צבירה נטו', 'ברשומה', 'מיליוני ש"ח', 'חודש אחרון בחלון; כל 12 החודשים ברשומה') },
      { label: 'הפקדות פחות משיכות, 12M', v: r.org12 == null ? '–' : nf(r.org12, 1) },
      { label: 'ניוד חיצוני משוער, 12M', v: r.ext12 == null ? '–' : nf(r.ext12, 1) },
      ...(r.nd12 != null && r.ext12 != null && r.org12 != null ? [{ label: 'מזה נדידה פנימית משוערת (פורסם פחות חיצוני)', v: nf(r.nd12 - r.org12 - r.ext12, 1) }] : []),
    ], note: r.mig ? U.method.mig : undefined };
}
export function gflProv(U: UnderFile, r: UnderRow): Prov {
  return { k: 'calc', title: `צבירה תחרותית 12M של ${r.grp} ב${U.prods[r.pid ?? ''] ?? 'מוצר'}`, value: r.gfl12 == null ? '–' : nf(r.gfl12, 1), unit: 'מיליוני ש"ח',
    formula: 'Σ (צבירה אורגנית + ניוד תחרותי) של הקבוצה במוצר ב-12 החודשים (flows/<prod>.json org + comp; /flows)', inputs: [{ label: 'סימון נדידה', v: 'כן' }], note: U.method.mig };
}
export function icostProv(U: UnderFile, r: UnderRow, rows: UnderRow[]): Prov {
  return { k: 'calc', est: true, title: `עלות הפער על הכסף החדש · ${r.name}`, value: r.icost == null ? '–' : nf(r.icost, 1), unit: 'מיליוני ש"ח לשנה', formula: U.method.icost,
    inputs: [{ label: 'צבירה נטו 12M בלי נדידה פנימית', v: r.c12 == null ? '–' : nf(r.c12, 1), src: () => flowProv(U, r) }, { label: 'פער מהחציון, נ"א לשנה', v: nf(r.gap, 2), src: () => gapProv(U, r, rows) }],
    note: U.method.past };
}
/** a point of the series: the headline rows of that month (under/m/<p>.json) */
export function pointProv(U: UnderFile, M: UnderMonth, name: (k: string) => string, what: 'cost' | 'icost' | 'a' | 'fl' = 'cost'): Prov {
  const j = U.months.indexOf(M.p), rs = monthRows(M), key = what === 'fl' ? 'c12' : what;
  const lab = { cost: 'עלות הפער בשנה', icost: 'עלות הפער על הכסף החדש', a: 'נכסים', fl: 'צבירה נטו 12M בלי נדידה פנימית' }[what];
  const v = j >= 0 ? U.series[what][j] : null;
  return { k: 'calc', est: what !== 'a', title: `${lab} · מסלולי הרשימה · ${ym(M.p)}`, value: v == null ? '–' : nf(v, 1), unit: 'מיליוני ש"ח',
    formula: `סכום ${rs.length} מסלולי הרשימה באותו חודש. ${U.method.head}`,
    inputs: rs.map((r) => ({ label: `${name(r.k)} · אחוזון ${r.pct} · פער ${nf(r.gap, 2)} נ"א`, v: nf((r as unknown as Record<string, number | null>)[key] ?? 0, 1),
      src: what === 'a' ? () => aumProv(U, { k: r.k, name: name(r.k), a: r.a }, M.p) : undefined })),
    note: `${U.method.series}. ${U.method.past}` };
}

/* ---------------- the generated headline line ---------------- */
/** one factual sentence from the table: count, assets, the 12M inflow, the cost, the largest row. Null when the list is empty. */
export function headline(U: UnderFile, rows: UnderRow[]): string | null {
  const h = headRows(rows);
  if (!h.length) return null;
  const j = U.months.length - 1, S = U.series, top = h[0];
  const prev = j >= 12 ? S.cost[j - 12] : null;
  const yoy = prev != null && U.cov[j - 12]?.length === U.cov[j]?.length ? ` (לפני שנה: ${ilsM(prev)})` : '';
  return `${ym(U.asof)}: ${h.length} מסלולים ברבעון התחתון של הקטגוריה שלהם (5 שנים, נטו) עדיין קיבלו כסף: ${ilsM(S.fl[j])} נטו ב-12 החודשים, בלי נדידה פנימית. `
    + `הם מנהלים ${ilsM(S.a[j])}; הפער שלהם מחציון הקטגוריה שווה כ-${ilsM(S.cost[j])} בשנה${yoy}. `
    + `הגדול: ${top.name}, ${nf(top.gap, 2)} נ"א לשנה מתחת לחציון, כ-${ilsM(top.cost)} בשנה.`;
}

/* ---------------- the saver's line ---------------- */
export interface SaverUnder { r: UnderRow; gap: number; ils: number; base: number; own: boolean }
/** one line only when the track is in the bottom quartile (5Y net) AND its gap is at least `saver_bp`; ₪ on her balance when entered,
 *  else on ₪100,000 */
export function saverUnder(U: UnderFile | null | undefined, k: string, balance?: number | null): SaverUnder | null {
  if (!U) return null;
  const i = U.cols.indexOf('k'), raw = U.rows.find((x) => x[i] === k);
  if (!raw) return null;
  const r = zip<UnderRow>(U.cols, raw);
  if (!(r.pct <= U.bq) || !(r.gap >= U.saver_bp / 100 - 1e-9)) return null;
  const own = balance != null && Number.isFinite(balance) && balance > 0, base = own ? balance! : 100000;
  return { r, gap: r.gap, ils: (base * r.gap) / 100, base, own };
}
export function saverProv(U: UnderFile, s: SaverUnder, rows: UnderRow[] | null): Prov {
  const rs = rows ?? [s.r];
  return { k: 'calc', est: true, title: `פער מחציון הקטגוריה בשקלים · ${s.r.name}`, value: `${Math.round(s.ils).toLocaleString('en-US')} ש"ח לשנה`,
    formula: `${s.own ? 'היתרה שלך' : '100,000 ש"ח'} × הפער ÷ 100. ${U.method.gap}`,
    inputs: [{ label: s.own ? 'היתרה שלך' : 'יתרה לדוגמה', v: `${Math.round(s.base).toLocaleString('en-US')} ש"ח` }, { label: 'פער מהחציון, נ"א לשנה', v: nf(s.gap, 2), src: () => gapProv(U, s.r, rs) },
      { label: 'אחוזון בקטגוריה', v: String(s.r.pct), src: () => pctProv(U, s.r) }],
    note: `${U.method.past}. ${U.method.not}` };
}
