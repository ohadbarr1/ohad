import type { Prov } from '../lib/prov';
import { nf, pubLabel } from '../lib/format';

/* Data files of /assets (pipeline/build_assets.py): the quarterly single-asset lists each institutional body publishes on its
   own website (CMA circular 2015-9-14). NIS millions in the files. */

export type ClassKey = 'equity' | 'etf' | 'mutual' | 'gov' | 'designated' | 'corp' | 'corp_u' | 'loans' | 'pe' | 'equity_u' | 'realestate' | 'deposits' | 'cash' | 'deriv' | 'other';
export type Status = 'ok' | 'partial' | 'blocked' | 'js_only' | 'not_found';
export interface Src { product: string; url: string | null; file: string | null; page: string | null; retrieved: string | null; sha256: string | null; entity?: string; audience?: string }
export interface QStats {
  total: number; cls: Partial<Record<ClassKey, number>>; sheets: Record<string, number>;
  illiq: number; illiq_pct: number | null; abroad_pct: number | null; fx_pct: number | null; ta35: number; ta35_pct: number | null;
  commit: number; credit: number;
  fam: Record<string, { total: number; illiq_pct: number | null; tracks: number; cls: Partial<Record<ClassKey, number>> }>;
  src: Src[]; val: { ok: boolean; warnings: number; rows: number; total_diff_pct: number };
}
export interface Issuer { key: string; name: string; v: number; pct: number | null; illiq_pct: number | null; cls: ClassKey; sector: string }
export interface Holding { sec: string; name: string; issuer: string; cls: ClassKey; v: number; pct: number | null; venue: string }
export interface Ta35Meta { url: string; retrieved: string; members: number; matched: number; securities: number }
export interface AssetsManager {
  id: string; name: string; entity: string; company_id: string; status: Status; note: string; products: string[]; quarters: string[]; latest: string;
  unit: string; series: Record<string, QStats>; top_issuers: Issuer[]; top_holdings: Holding[]; ta35: Ta35Meta | Record<string, never>;
  calc: Record<string, string>; built: string;
}
export interface IndexManager { id: string; name: string; status: Status; products: string[]; quarters: string[]; latest: string | null; total: number | null;
  illiq_pct: number | null; ta35_pct: number | null; abroad_pct: number | null; note: string }
export interface AssetsIndex {
  built: string; asof: string | null; asof_label: string | null; unit: string; disclaimer: string; products: Record<string, string>;
  classes: { key: ClassKey; label: string; illiquid: boolean }[]; managers: IndexManager[]; probed: string | null; user_agent: string | null; ta35: Ta35Meta | Record<string, never>;
}
export interface Pair { a: string; b: string; qa: string; qb: string; sec: number; iss: number; shared: { key: string; name: string; pct_a: number; pct_b: number }[] }
export interface Overlap { built: string; managers: string[]; pairs: Pair[]; calc: { sec: string; iss: string } }

/** display groups for the stacked charts: 15 CMA classes fold into 10, illiquid ones adjacent */
export const GROUPS: { key: string; label: string; of: ClassKey[]; c: string; illiq?: boolean }[] = [
  { key: 'eq', label: 'מניות סחירות', of: ['equity'], c: '--s1' },
  { key: 'fund', label: 'קרנות סל ונאמנות', of: ['etf', 'mutual'], c: '--s9' },
  { key: 'gov', label: 'אג"ח ממשלתי', of: ['gov'], c: '--s4' },
  { key: 'des', label: 'אג"ח מיועדות', of: ['designated'], c: '--s11' },
  { key: 'corp', label: 'אג"ח קונצרני סחיר', of: ['corp'], c: '--s3' },
  { key: 'credit', label: 'אשראי לא סחיר והלוואות', of: ['corp_u', 'loans'], c: '--s2', illiq: true },
  { key: 'pe', label: 'קרנות השקעה ומניות לא סחירות', of: ['pe', 'equity_u'], c: '--s8', illiq: true },
  { key: 're', label: 'מקרקעין ופיקדונות', of: ['realestate', 'deposits'], c: '--s5', illiq: true },
  { key: 'cash', label: 'מזומנים', of: ['cash'], c: '--s7' },
  { key: 'oth', label: 'נגזרים ואחר', of: ['deriv', 'other'], c: '--neutral' },
];
export const groupOf = (k: ClassKey) => GROUPS.find((g) => g.of.includes(k))!;
export const groupSum = (cls: Partial<Record<ClassKey, number>>, g: (typeof GROUPS)[number]) => g.of.reduce((s, k) => s + (cls[k] ?? 0), 0);

export const STATUS_HE: Record<Status, string> = { ok: 'נקרא', partial: 'חלקי', blocked: 'חסום לגישה אוטומטית', js_only: 'נטען בדפדפן בלבד', not_found: 'לא נמצא באתר' };
export const STATUS_SHORT: Record<Status, string> = { ok: 'נקרא', partial: 'חלקי', blocked: 'חסום', js_only: 'דפדפן בלבד', not_found: 'לא נמצא' };
export const PRODUCT_HE: Record<string, string> = { gm: 'גמל והשתלמות', pn: 'פנסיה', in: 'ביטוח משתתף', ca: 'מבטיח תשואה' };
export const UNIT = 'מיליוני ש"ח';

/** 2026Q2 -> Q2'26 */
export const ql = (q: string | null | undefined) => (q ? `Q${q[5]}'${q.slice(2, 4)}` : '');
export const bn = (m: number | null | undefined) => (m == null ? '–' : nf(m / 1000, m >= 100000 ? 0 : 1));
export const pc = (v: number | null | undefined, d = 1) => (v == null ? '–' : `${nf(v, d)}%`);

/** one source file of a quarter, as a report source */
export const fileProv = (m: { name: string; entity?: string }, q: string, s: Src): Prov => ({
  k: 'report', title: `${s.file ?? 'רשימת נכסים'} · ${PRODUCT_HE[s.product] ?? s.product}`, value: ql(q), url: s.url, pg: null,
  doc: `${s.entity || m.entity || m.name}, רשימת נכסים ברמת הנכס הבודד, ${ql(q)}`, period: ql(q), srcType: 'רשימת נכסים רבעונית (אתר הגוף המוסדי)',
  note: `${s.audience ? `קובץ ${s.audience} · ` : ''}נשלף ${pubLabel(s.retrieved)}${s.page ? ` · מעמוד ${s.page}` : ''}${s.sha256 ? ` · sha256 ${s.sha256.slice(0, 12)}` : ''}`,
});

/** a figure computed from a quarter's files */
export const calcProv = (m: AssetsManager, q: string, title: string, value: string, formula: string, unit = UNIT): Prov => ({
  k: 'calc', title: `${m.name} · ${title} · ${ql(q)}`, value, unit, formula,
  inputs: (m.series[q]?.src ?? []).map((s) => ({ label: `${PRODUCT_HE[s.product] ?? s.product}: ${s.file ?? ''}`, v: `נשלף ${pubLabel(s.retrieved)}`, src: () => fileProv(m, q, s) })),
});
