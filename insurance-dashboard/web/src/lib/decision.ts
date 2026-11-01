/* W2 · the decision file (web/public/data/funds/decision.json, built by pipeline/build_decision.py; contract `fundsDecision`):
   the regulator's service index 2025 by company and segment, its insurance-product scores, the funds' own claims reports (annex B3
   of the statistical circular, a company self-report), the default coverage of a comprehensive pension fund (the uniform bylaws),
   and the checklist for leaving an old managers'-insurance policy (Kol Zchut, written with the regulator).
   Pure: types, lookups and the Prov of every figure (source, page, quote). No React, no fetch, so the verdict test runs it in node. */
import type { Prov } from './prov';

export type SegKey = 'pension' | 'gemel' | 'life_savings';
export type InsKey = 'disability' | 'life_risk' | 'ltc' | 'health';
export type CompKey = 'sat' | 'compl' | 'phone' | 'funding' | 'digital';
export type InsComp = 'claims' | 'pay' | 'speed' | 'sat' | 'compl' | 'phone' | 'digital';

export interface SvcRow {
  year: number; name?: string; total: number; rank: number; of: number;
  sat?: number; compl?: number; phone?: number; funding?: number; digital?: number;
  claims?: number; pay?: number; speed?: number;
  prev?: number; chg?: number; wait_s?: number; src: string; pg: number; pg_prev?: number; pg_wait?: number;
}
export interface ClaimSide { approved: number | null; rejected: number | null; settled: number | null; cancelled: number | null; closed: (number | null)[]; n_closed?: number; cells?: string }
export interface Claims { year: number; src: string; entity: string; pg?: number; sheet?: string; disability: ClaimSide; survivors: ClaimSide }
export interface DecCompany {
  grp: string; in_funds: boolean; mgr?: Record<string, string>;
  service?: Partial<Record<SegKey, SvcRow>>; ins_service?: Partial<Record<InsKey, SvcRow>>;
  claims?: Claims; claims_missing?: string;
}
export interface DecSource { id: string; kind: 'primary' | 'issuer' | 'consumer'; publisher?: string; title: string; url: string; retrieved: string; page_url?: string; note?: string; format?: string; revision?: number; updated?: string }
export interface Segment { label: string; year: number; prev_year?: number; n: number; weights: Record<string, number>; avg: Record<string, number>; src: string; pg: number; pg_weights?: number; fam?: string }
export interface InsProduct { label: string; year: number; n: number; avg: Record<string, number>; src: string; pg: number }
export interface CoverTrack { n: number; disability_pct: number; survivors_pct: number; note?: string }
export interface CoverRule { id: string; title: string; clause: string; pg: number; pg_to?: number; detail?: string; q?: string; tracks?: CoverTrack[]; opts?: number[]; [k: string]: unknown }
export interface BmItem { id: string; title: string; src: string; src2?: string; pg2?: number; detail: string; q?: string; note?: string; months?: number }
export interface Missing { what: string; grp?: string; reason: string }
export interface DecisionFile {
  v: number; asof: string; method: string; src?: string; sources: DecSource[];
  segments: Partial<Record<SegKey, Segment>>; labels?: Record<string, string>;
  ins_products?: Partial<Record<InsKey, InsProduct>>; ins_scale?: string;
  fund_claims?: { year: number; what?: string; buckets: string[] };
  companies: Record<string, DecCompany>;
  coverage_default: { src: string; rules: CoverRule[] };
  bm_checklist: BmItem[];
  missing: Missing[];
}

export const DECISION_PATH = 'funds/decision.json';
export const COMP_KEYS: CompKey[] = ['sat', 'compl', 'phone', 'funding', 'digital'];
export const INS_KEYS: InsComp[] = ['claims', 'pay', 'speed', 'sat', 'compl', 'phone', 'digital'];
export const COMP_HE: Record<CompKey | InsComp | 'wait_s', string> = {
  sat: 'שביעות רצון והמלצה', compl: 'תלונות ציבור', phone: 'מענה טלפוני', funding: 'שיוך כספים (פנדינג)', digital: 'שירות דיגיטלי',
  claims: 'תשלום תביעות', pay: 'שיעור תשלום (ציון)', speed: 'מהירות טיפול (ציון)', wait_s: 'המתנה לנציג, שניות',
};
export const SEG_HE: Record<SegKey, string> = { pension: 'קרנות פנסיה', gemel: 'קופות גמל', life_savings: 'ביטוח מנהלים ופוליסות חיסכון' };
export const INS_HE: Record<InsKey, string> = { disability: 'אובדן כושר עבודה', life_risk: 'ריסק חיים', ltc: 'סיעוד פרט', health: 'בריאות' };
export const SELF_REPORT = 'דיווח החברה';
export const BUCKETS_DEFAULT = ['עד 30 יום', '31-60 יום', '61-120 יום', '121-180 יום', '181 יום ומעלה'];
/** "before 2012" vs "before 2013": the cutoff for a guaranteed annuity coefficient, as Kol Zchut gives it in two places */
export const BM_CUTOFF = 'לפני 2013 (ובמקום אחר באותו מקור: לפני 2012)';

const n1 = (v: number | null | undefined, d = 1) => (v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pc1 = (v: number | null | undefined) => (v == null ? '–' : `${n1(v)}%`);
export const sgn = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');
const dateHe = (iso?: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

/** the segment of the service index that covers a product family (pensia-net, gemel-net, bituach-net) */
export function segOf(f: { fam?: string; prod?: string }): SegKey | null {
  if (f.fam === 'pensia' || /^פנסיה/.test(f.prod ?? '')) return 'pension';
  if (f.fam === 'gemel') return 'gemel';
  if (f.fam === 'insurance' || /ביטוח|פוליסות/.test(f.prod ?? '')) return 'life_savings';
  return null;
}
export const srcOf = (d: Pick<DecisionFile, 'sources'> | null | undefined, id: string) => d?.sources.find((s) => s.id === id) ?? null;
export const companyOf = (d: Pick<DecisionFile, 'companies'> | null | undefined, grp: string) => d?.companies[grp] ?? null;
export const svcOf = (d: Pick<DecisionFile, 'companies'> | null | undefined, grp: string, seg: SegKey) => companyOf(d, grp)?.service?.[seg] ?? null;
export const rankHe = (r: Pick<SvcRow, 'rank' | 'of'>) => `${r.rank} מתוך ${r.of}`;

/** why a company's claims report is not shown: the file's own reason, or the generic one */
export function claimsWhy(d: Pick<DecisionFile, 'companies' | 'missing'> | null | undefined, grp: string): string {
  const c = companyOf(d, grp);
  return c?.claims_missing ?? d?.missing.find((m) => m.what === 'fund_claims' && m.grp === grp)?.reason ?? 'לא נמצא דוח תביעות (נספח ב3) של החברה ל-2025';
}

/* ---------- sources ---------- */
const repP = (s: DecSource | null, title: string, value: string, pg: number | null, note?: string, srcType?: string): Prov =>
  s ? { k: 'report', title, value, url: s.url, pg, doc: s.publisher && !s.title.includes(s.publisher) ? `${s.publisher}: ${s.title}` : s.title, note: note || undefined, srcType }
    : { k: 'none', title, why: 'המקור לא נמצא בקובץ' };

/** the service index of a company in a segment: the total, its rank, a component, the previous year or the wait */
export function svcProv(d: DecisionFile, grp: string, seg: SegKey, what: 'total' | 'rank' | 'prev' | 'wait_s' | CompKey = 'total'): Prov {
  const r = svcOf(d, grp, seg), g = d.segments[seg];
  if (!r || !g) return { k: 'none', title: `מדד השירות · ${grp}`, why: 'החברה אינה במדד השירות של הרשות במוצר הזה' };
  const s = srcOf(d, r.src), who = r.name ?? grp;
  const w = Object.entries(g.weights).map(([k, v]) => `${COMP_HE[k as CompKey] ?? k} ${v}%`).join(', ');
  const base = `מדד השירות של רשות שוק ההון לשנת ${r.year}, ${g.label}, ברמת החברה המנהלת (כל קרנותיה במוצר). ציון 0-100 לכל רכיב; המדד = סכום הרכיבים במשקולות: ${w} (עמ' ${g.pg_weights ?? g.pg}). דירוג: מקום לפי המדד בתוך המוצר`;
  if (what === 'prev') return repP(s, `מדד השירות ${g.prev_year ?? r.year - 1} · ${g.label} · ${who}`, n1(r.prev, 0), r.pg_prev ?? r.pg, `${base}. השינוי מול השנה הקודמת: ${r.chg == null ? '–' : sgn(r.chg)} נקודות.`);
  if (what === 'wait_s') return repP(s, `זמן המתנה ממוצע לנציג · ${g.label} · ${who}`, `${n1(r.wait_s, 0)} שניות`, r.pg_wait ?? r.pg, `${d.labels?.wait_s ?? 'זמן המתנה ממוצע לנציג'}; אינו רכיב במדד.`);
  if (what === 'total' || what === 'rank') return repP(s, `מדד השירות ${r.year} · ${g.label} · ${who}`, what === 'rank' ? `מקום ${rankHe(r)}` : `${n1(r.total, 0)} (מקום ${rankHe(r)})`, r.pg, `${base}. ממוצע המוצר: ${n1(g.avg.total, 0)}.`);
  const v = r[what];
  return repP(s, `${d.labels?.[what] ?? COMP_HE[what]} · מדד השירות ${r.year} · ${g.label} · ${who}`, n1(v, 0), r.pg, `${base}. משקל הרכיב: ${g.weights[what] ?? '–'}%. ממוצע המוצר ברכיב: ${n1(g.avg[what], 0)}.`);
}

/** the regulator's score of an insurance product (claims paid, speed …): scores 0-100, not rates */
export function insProv(d: DecisionFile, grp: string, p: InsKey, what: 'total' | InsComp = 'total'): Prov {
  const r = companyOf(d, grp)?.ins_service?.[p], g = d.ins_products?.[p];
  if (!r || !g) return { k: 'none', title: `מדד השירות · ${grp}`, why: 'החברה אינה במדד במוצר הזה' };
  const s = srcOf(d, r.src), who = r.name ?? grp;
  const note = `מדד השירות של רשות שוק ההון לשנת ${r.year}, ${g.label}. ${d.ins_scale ?? 'ציונים 0-100 שהרשות מחשבת, לא שיעורים'}. ממוצע המוצר: ${n1(g.avg[what], 0)}.`;
  return repP(s, `${what === 'total' ? 'מדד השירות' : COMP_HE[what]} · ${g.label} · ${who}`, what === 'total' ? `${n1(r.total, 0)} (מקום ${rankHe(r)})` : n1(r[what], 0), r.pg, note);
}

/** the segment's average (the regulator's own figure, not a site mean) */
export function avgProv(d: DecisionFile, seg: SegKey, what: 'total' | CompKey = 'total'): Prov {
  const g = d.segments[seg];
  if (!g) return { k: 'none', title: 'ממוצע', why: 'אין נתון' };
  return repP(srcOf(d, g.src), `ממוצע המוצר · ${what === 'total' ? 'מדד השירות' : COMP_HE[what]} ${g.year} · ${g.label}`, n1(g.avg[what], 0), g.pg, 'הממוצע כפי שהרשות פרסמה.');
}

export type ClaimWhat = 'approved' | 'rejected' | 'settled' | 'cancelled' | `closed${0 | 1 | 2 | 3 | 4}`;
const SIDE_HE = { disability: 'נכות', survivors: 'שאירים' } as const;
const WHAT_HE: Record<string, string> = { approved: 'אושרו (שולמו ושולמו חלקית)', rejected: 'נדחו', settled: 'פשרה', cancelled: 'בוטלו' };
/** a figure of a company's own claims report */
export function claimProv(d: DecisionFile, grp: string, side: 'disability' | 'survivors', what: ClaimWhat): Prov {
  const c = companyOf(d, grp)?.claims;
  if (!c) return { k: 'none', title: `תביעות · ${grp}`, why: claimsWhy(d, grp) };
  const s = srcOf(d, c.src), x = c[side];
  const bi = what.startsWith('closed') ? Number(what.slice(6)) : -1;
  const bl = (d.fund_claims?.buckets ?? BUCKETS_DEFAULT)[bi];
  const v = bi >= 0 ? x.closed[bi] : x[what as 'approved'];
  const where = [c.sheet ? `גיליון "${c.sheet}"` : null, x.cells ? `תאים ${x.cells}` : null].filter(Boolean).join(', ');
  return repP(s, `תביעות ${SIDE_HE[side]} ${c.year}: ${bi >= 0 ? `נסגרו ${bl}` : WHAT_HE[what]} · ${c.entity}`, pc1(v), c.pg ?? null,
    `${SELF_REPORT}: ${d.fund_claims?.what ?? 'נספח ב3 לחוזר איסוף מידע סטטיסטי'}${where ? ` (${where})` : ''}${x.n_closed != null ? `. מספר התביעות שנסגרו: ${x.n_closed}` : ''}. לא נבדק על ידי הרשות.`, SELF_REPORT);
}

/** a rule of the default coverage, with its clause, page and the quoted words */
export function coverProv(d: DecisionFile, r: CoverRule): Prov {
  const s = srcOf(d, d.coverage_default.src);
  return repP(s, `${r.title} · תקנון, סעיף ${r.clause}`, r.detail ?? r.title, r.pg, `${r.q ? `"${r.q}…" ` : ''}${s?.note ? `התקנון האחיד של קרן מקיפה, כפי שנקרא בתקנון אחד (${s.publisher ?? ''}); בקרן אחרת יש לבדוק את התקנון שלה.` : ''}`.trim(), 'תקנון');
}

/** an item of the managers'-insurance checklist, with its source (and the bylaws' clause where it adds one) */
export function bmProv(d: DecisionFile, it: BmItem, second = false): Prov {
  const s = srcOf(d, second && it.src2 ? it.src2 : it.src);
  if (second && it.src2) return repP(s, `${it.title} · תקנון`, it.title, it.pg2 ?? null, 'התקנון האחיד של קרן מקיפה, כפי שנקרא בתקנון אחד.', 'תקנון');
  return repP(s, `${it.title} · ${s?.title ?? ''}`, it.title, null, `${it.q ? `"${it.q}…" ` : ''}${s?.publisher ?? ''}${s?.revision ? `, גרסה ${s.revision}` : ''}${s?.updated ? `, עודכן ${dateHe(s.updated)}` : ''}; נקרא ${dateHe(s?.retrieved)}.${it.note ? ` ${it.note}` : ''}`, s?.kind === 'consumer' ? 'כל זכות' : undefined);
}

/* ---------- managers' insurance (bituach-net) ---------- */
/** old generations of bituach-net: policies sold 1990-2003 (managers' insurance only) */
export const isOldBm = (prod: string) => /^ביטוחי מנהלים (1990|1992)/.test(prod);
/** a bituach-net product that is, or may be, managers' insurance (the 2004+ pool also holds pure savings policies) */
export const bmKind = (prod: string): 'old' | 'new' | null => (isOldBm(prod) ? 'old' : /ביטוחי מנהלים/.test(prod) ? 'new' : null);
export const BM_HREF = '/funds/bm';

/* ---------- compact cells (the compare table, the print document, the screener) ---------- */
export interface Cell { v: number | null; t: string; src?: () => Prov; txt?: boolean }
/** the pension service index of a track's company: "81 · 4/9" */
export function svcCell(d: DecisionFile | null | undefined, f: { grp: string; fam?: string; prod?: string }): Cell {
  if (d === undefined) return { v: null, t: '…' };
  const seg = segOf(f);
  if (!d || !seg) return { v: null, t: '–' };
  const r = svcOf(d, f.grp, seg);
  if (!r) return { v: null, t: 'לא במדד', src: () => svcProv(d, f.grp, seg), txt: true };
  return { v: r.total, t: `${r.total} · מקום ${r.rank}/${r.of}`, src: () => svcProv(d, f.grp, seg), txt: true };
}
/** disability claims approved, the company's own report */
export function clmCell(d: DecisionFile | null | undefined, grp: string): Cell {
  if (d === undefined) return { v: null, t: '…' };
  if (!d) return { v: null, t: '–' };
  const c = companyOf(d, grp)?.claims;
  if (!c) return { v: null, t: 'לא פורסם', src: () => claimProv(d, grp, 'disability', 'approved'), txt: true };
  const x = c.disability;
  return { v: x.approved, t: `${pc1(x.approved)}${x.n_closed != null ? ` (${x.n_closed} תביעות)` : ''}`, src: () => claimProv(d, grp, 'disability', 'approved'), txt: true };
}
