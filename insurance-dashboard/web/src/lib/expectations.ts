/* A3 · the Expectations Decoder: types and formats for web/public/data/expectations/<id>.json and index.json (built by
   pipeline/build_expectations.py, gate `expectations`). The solving is done in the pipeline, on the 22.10.26 manual price and the default
   assumptions (ASSUME0 + the BoI 10Y); the page renders the file. Every figure carries its provenance as a ProvJ (drivers.ts toProv). */
import { fmt, type ProvJ } from './drivers';

export type LeverKey = 'aum' | 'fee' | 'ci' | 'csm' | 'roe';
export interface EFig { v: number | null; prov: ProvJ; unit?: string; est?: boolean }
export interface EHist { what: string; n: number; min: number; med: number; max: number; pct: number | null; unit: string; dir: 'up' | 'down'; prov: ProvJ; max_at?: string; first?: string; last?: string }
export interface ERef { he: string; v: number; prov: ProvJ; unit?: string; lo?: number; hi?: number; aum_lo?: number; aum_hi?: number; aum_now?: number }
export interface EJoint { he: string; k: number; n: number; first: string | null; last: string | null; when: string[] }
export interface ELever {
  /** nonbinding: the lever cannot move the price (segment under 15% of pre-tax profit, no solution in range, or more than 2× the
      company's own historical maximum); `mech` keeps the mechanical solution for the provenance sheet only */
  k: LeverKey; he: string; unit: string; status: 'ok' | 'beyond' | 'below' | 'nonbinding'; solved?: 'ok' | 'beyond' | 'below'; reason?: string; why?: 'share' | 'range'; share?: number | null; mech?: EFig;
  trail: EFig; req: EFig | null; bound?: number; roe28?: number; req_d?: number; check?: { value: number; err: number };
  hist: EHist | null; ref?: ERef[]; joint?: EJoint | null; path?: { p: string; roe: number; np: number }[];
}
export interface ETarget { m: string; he: string; v: number | null; lo: number | null; hi: number | null; unit: 'pct' | 'm'; prov: ProvJ }
export interface EMeta { built: string | null; v: 1; price_date: string; price_label: string; horizon: string; periods: string[]; n_hist: number; win_months: number; tol_pct: number; method: string }
export interface ECompanyOk {
  id: string; name: string; kind: 'insurance_group' | 'fund_house'; status: 'ok'; flag?: string; meta: EMeta;
  price: { date: string; label: string; px: EFig; mcap: EFig; shares: EFig };
  base: {
    q: string; ltm: string[]; end: string; pb: EFig; equity: EFig; div_after: EFig; np_ltm: EFig; adj: EFig | null; eq_ltm: EFig | null; np_norm: EFig; roe_ltm: EFig;
    tax: EFig; attr: EFig; payout: EFig; ke: EFig; g: EFig; rf: EFig; value: EFig; gap: EFig; path: { p: string; np: number; roe: number; b: number }[];
    savings: { he: string; aum: EFig; fy: EFig; ci: EFig; op: EFig; rev: EFig } | null; csm: { csm: EFig; rr: EFig } | null;
  };
  levers: ELever[]; roe: ELever; targets: Partial<Record<'roe' | 'profit' | 'aum', ETarget>>;
  rank: { max: number | null; parts: { k: LeverKey; pct: number | null }[]; key: number[] }; verdict: string; gaps: string[];
}
export interface ECompanyNa { id: string; name: string; kind: string; status: 'na'; why: string; meta: EMeta }
export type ECompany = ECompanyOk | ECompanyNa;
export interface EPart { k: LeverKey; he: string; unit: string; status: 'ok' | 'beyond' | 'below' | 'nonbinding'; req: number | null; bound: number | null; trail: number; pct: number | null; reason?: string }
export const NONBINDING = 'לא מנוף מכריע';
export interface EIndexRow { id: string; name: string; kind: string; status: 'ok' | 'na'; rank?: number; pb?: number; gap?: number; max?: number | null; key?: number[]; verdict?: string; parts?: EPart[]; why?: string; flag?: string }
export interface EIndex { meta: EMeta; companies: EIndexRow[] }

export const expectationsPath = (id: string) => `expectations/${id}.json`;
export const EXPECTATIONS_INDEX = 'expectations/index.json';
export const isOkE = (c: ECompany | null | undefined): c is ECompanyOk => !!c && c.status === 'ok';

/** short labels for the ranking's columns */
export const LEVER_SHORT: Record<LeverKey, string> = { aum: 'צמיחת נכסים', fee: 'תשואת דמי ניהול', ci: 'עלות להכנסה', csm: 'שחרור CSM', roe: "ROE FY'28" };
/** what the history of each lever is */
export const LEVER_NOTE: Record<LeverKey, string> = {
  aum: 'פנסיה וגמל, נתוני הרשות: CAGR נדרש עד FY\'28; היסטוריה: חלונות של שנתיים',
  fee: 'פנסיה וגמל, הכנסות מדמי ניהול ÷ נכסים ממוצעים: הרמה הנדרשת ב-FY\'28; היסטוריה: השינוי השנתי בדמי הניהול מהצבירה',
  ci: 'פנסיה וגמל, (שיווק + הנהלה) ÷ הכנסות: הרמה הנדרשת ב-FY\'28; היסטוריה: רבעונים מדווחים',
  csm: 'שחרור CSM לשנה ÷ יתרת CSM; היסטוריה: FY\'25 של כל המבטחות (IFRS 17 מ-2025)',
  roe: 'רווח נקי ÷ הון ממוצע ב-FY\'28 שבו שווי המודל = שווי השוק; היסטוריה: ROE LTM ברבעון',
};

const LRM = '⁦', PDI = '⁩';
const iso = (s: string) => `${LRM}${s}${PDI}`;
/** a lever's value in its own unit (CAGR and rates with one decimal, the fee yield with two) */
export function leverText(k: LeverKey, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return iso(k === 'fee' ? `${fmt(v, 2)}%` : `${fmt(v, 1)}%`);
}
/** the requirement, or what the bound says when the solver could not reach it */
export function reqText(L: Pick<ELever, 'k' | 'status' | 'req' | 'bound'> | EPart): string {
  const v = 'req' in L && L.req && typeof L.req === 'object' ? L.req.v : (L as EPart).req;
  if (L.status === 'nonbinding') return NONBINDING;
  if (L.status === 'ok') return leverText(L.k, v as number);
  if (L.bound == null) return '–';
  if (L.k === 'ci') return L.status === 'beyond' ? 'גם 0% לא מספיק' : `גם ${fmt(L.bound, 0)}% מספיק`;
  return L.status === 'beyond' ? iso(`> ${fmt(L.bound, L.k === 'fee' ? 1 : 0)}%`) : iso(`< ${fmt(L.bound, 0)}%`);
}
export const pctText = (p: number | null | undefined) => (p == null ? '–' : p >= 100 ? 'מעל כל ההיסטוריה' : p <= 0 ? 'מתחת לכל ההיסטוריה' : `אחוזון ${fmt(p, 0)}`);
/** the tone of a percentile: how far outside what the company has done */
export const pctTone = (p: number | null | undefined) => (p == null ? '' : p >= 100 ? 'x4' : p >= 90 ? 'x3' : p >= 75 ? 'x2' : p >= 50 ? 'x1' : 'x0');
/** a management target as text (a point or a range), with its unit */
export function targetText(t: ETarget): string {
  const u = t.unit === 'pct' ? '%' : '';
  const n = (v: number) => (t.unit === 'm' && v >= 10000 ? `${fmt(v / 1000, 0)} מיליארד` : fmt(v, 0));
  return iso(t.v != null ? `${n(t.v)}${u}` : `${n(t.lo!)}–${n(t.hi!)}${u}`);
}
export const dateHe = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;
