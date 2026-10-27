/* A8 · the Regulatory Impact Simulator: types of web/public/data/regulation/impact.json (pipeline/build_regulation.py) and the provenance the
   page opens for every figure. The arithmetic is drivers.ts propagate(), applied by the builder to one product at a time with a {flow, fee}
   shock; tests/regulation.unit.ts re-propagates every product shock and must match the file. Pure functions, no React. */
import { fmt, fmtS, toProv, type LtsResolver, type ProvJ } from './drivers';
import type { Prov } from './prov';

export const BANDS = ['low', 'central', 'high'] as const;
export type Band = (typeof BANDS)[number];
export type BandV = Record<Band, number>;
export const BAND_HE: Record<Band, string> = { low: 'נמוך', central: 'מרכזי', high: 'גבוה' };
export type Status = 'proposal' | 'consultation' | 'approved' | 'in_force';
export const STATUS_HE: Record<Status, string> = { proposal: 'הצעה', consultation: 'בהתייעצות', approved: 'אושר', in_force: 'בתוקף' };
export type IType = 'fee' | 'default' | 'substitution' | 'solvency' | 'transparency' | 'cost';
export const TYPE_HE: Record<IType, string> = {
  fee: 'דמי ניהול', default: 'ברירת מחדל', substitution: 'תחליף מוצרים', solvency: 'הון ויציבות', transparency: 'שקיפות וגילוי', cost: 'עלויות',
};
export const SEG_HE: Record<string, string> = { pen: 'פנסיה', gem: 'גמל והשתלמות', ic: 'פוליסות חיסכון (חוזי השקעה)' };

export interface RegSource { url: string; title: string; doc: string; pg: number | null; retrieved: string }
export interface RegDate { k: string; d: string; he: string; src: number }
export interface Param { k: string; he: string; unit: string; src: 'source' | 'assumption' | 'regulator'; why?: string; low?: number; central?: number; high?: number;
  split?: Record<string, number>; srcIdx?: number; p?: Record<Band, ProvJ> }
export interface Basis { label: string; v: BandV; unit: string; est: boolean; p?: ProvJ; pb?: Record<Band, ProvJ>; param?: string }
export interface ProdImpact { s: 'pen' | 'gem' | 'ic'; shock: Record<Band, { flow: number; fee: number }>; d: Record<Band, { dA: number; dRev: number; dVar: number; dOp: number }>;
  basis: Basis[]; net_flow?: BandV }
export interface Impact { c: string; d: BandV; net: BandV; aum: BandV; rev: BandV; pct_np: BandV | null; products: ProdImpact[]; flags: string[] }
export interface Initiative {
  id: string; title: string; short: string; regulator: string; type: IType; status: Status; w: number;
  dates: RegDate[]; next: RegDate | null; facts: { he: string; src: number }[]; sources: RegSource[];
  model: { kind: 'fee' | 'default' | 'substitution' | 'none'; he: string; products: string[]; params: Param[]; why?: string };
  impacts: Impact[]; total: BandV | null;
}
export interface MgrIn { v: number; period?: string; p: ProvJ }
export interface Manager { name: string; kind: 'insurance_group' | 'fund_house'; tax: number; np: MgrIn | null;
  products: Record<string, { he: string; A: MgrIn; fy: MgrIn; vc: { v: number; q: string; p: ProvJ } | null }> }
export interface Exposure { c: string; d: BandV; net: BandV; by: { id: string; w: number }[]; pct_np: BandV | null }
export interface RegFile {
  meta: { built: string; retrieved: string; base: { q: string; end: string; ltm: string[] }; units: string; bands: Band[]; weights: Record<Status, number>; weights_why: string;
    ltm_months: [number, number]; at: number; excluded: { c: string; name: string; why: string }[]; method: string };
  managers: Record<string, Manager>; initiatives: Initiative[]; exposure: Exposure[];
}
export const REG_PATH = 'regulation/impact.json';

const MM = 'מיליוני ש"ח';
/** the date as the site writes it: 2026-07 → 07.2026, 2024-09-19 → 19.09.2024, 2026 → 2026 */
export const dlab = (d: string) => { const [y, m, dd] = d.split('-'); return dd ? `${dd}.${m}.${y}` : m ? `${m}.${y}` : y; };

/** the provenance of a source document (the regulator's own PDF, the page, the retrieval date) */
export function srcProv(ini: Initiative, i: number, title: string, value: string, unit = ''): Prov {
  const s = ini.sources[i];
  return { k: 'report', title: `${ini.short} · ${title}`, value, unit, url: s.url, pg: s.pg, doc: s.doc, period: s.doc.split(', ').pop(), srcType: 'regulator', note: `${s.title} · נשלף ${dlab(s.retrieved)}` };
}

function basisProv(ini: Initiative, b: Basis, band: Band, lts: LtsResolver): (() => Prov) | undefined {
  const j = b.pb?.[band] ?? b.p ?? (b.param ? ini.model.params.find((q) => q.k === b.param)?.p?.[band] : undefined);
  return j ? () => toProv(j, lts) : undefined;
}
const val = (v: number, unit: string) => `${fmt(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;

/** one product of one manager at one band: the A1 arithmetic with every input opening its source */
export function prodProv(ini: Initiative, m: Manager, x: ProdImpact, band: Band, lts: LtsResolver): Prov {
  const mp = m.products[x.s], d = x.d[band], sh = x.shock[band];
  const inputs: { label: string; v: string; src?: () => Prov }[] = [
    { label: `נכסים ממוצעים${mp.A.period ? ` · ${mp.A.period}` : ''}`, v: `${fmt(mp.A.v / 1000, 2)} מיליארד`, src: () => toProv(mp.A.p, lts) },
    { label: `תשואת דמי ניהול${mp.fy.period ? ` · ${mp.fy.period}` : ''}`, v: `${fmt(mp.fy.v, 3)}%`, src: () => toProv(mp.fy.p, lts) },
    ...x.basis.map((b) => ({ label: `${b.label}${b.est ? ' (הנחה)' : ''}`, v: val(b.v[band], b.unit), src: basisProv(ini, b, band, lts) })),
    { label: 'זעזוע A1: צבירה, % מהנכסים בשנה', v: fmtS(sh.flow, 3) },
    { label: 'זעזוע A1: שחיקת דמי ניהול, נ״ב', v: fmtS(sh.fee, 3) },
  ];
  if (mp.vc) inputs.push({ label: `הוצאה משתנה לכל מיליארד ש״ח (${mp.vc.q})`, v: fmt(mp.vc.v, 2), src: () => toProv(mp.vc!.p, lts) });
  return { k: 'calc', title: `${ini.short} · ${m.name} · ${SEG_HE[x.s]} · תרחיש ${BAND_HE[band]}`, value: `${fmtS(d.dOp, 2)} ${MM}`, unit: 'לשנה, לפני מס', est: true,
    formula: `ΔAUM = AUM × ${fmt(sh.flow, 3)}% = ${fmtS(d.dA, 1)}; Δהכנסות = (AUM + ΔAUM) × (fy − ${fmt(sh.fee / 100, 4)}%) − AUM × fy = ${fmtS(d.dRev, 2)}; Δהוצאה משתנה = ${fmtS(d.dVar, 2)}; Δרווח לפני מס = ${fmtS(d.dOp, 2)} (drivers.ts propagate)`,
    inputs };
}

/** a manager's impact of one initiative at one band (pre-tax, or after tax with `net`) */
export function impactProv(ini: Initiative, m: Manager, x: Impact, band: Band, lts: LtsResolver, net = false): Prov {
  const pre: Prov = { k: 'calc', title: `${ini.short} · ${m.name} · תרחיש ${BAND_HE[band]}`, value: `${fmtS(x.d[band], 1)} ${MM}`, unit: 'לשנה, לפני מס', est: true,
    formula: 'Σ Δרווח לפני מס לכל מוצר', inputs: x.products.map((p) => ({ label: SEG_HE[p.s], v: fmtS(p.d[band].dOp, 2), src: () => prodProv(ini, m, p, band, lts) })) };
  if (!net) return pre;
  return { k: 'calc', title: `${ini.short} · ${m.name} · תרחיש ${BAND_HE[band]} · אחרי מס`, value: `${fmtS(x.net[band], 1)} ${MM}`, unit: 'לשנה', est: true,
    formula: 'Δרווח לפני מס × (1 − שיעור המס)', inputs: [{ label: 'Δרווח לפני מס', v: fmtS(x.d[band], 2), src: () => pre }, { label: 'שיעור מס (קובץ המנגנונים)', v: `${fmt(m.tax, 2)}%` }] };
}

/** the share of LTM net profit (after tax) */
export function pctProv(title: string, m: Manager, net: number, pct: number, netSrc: () => Prov, lts: LtsResolver): Prov {
  return { k: 'calc', title: `${title} · ${m.name} · % מהרווח הנקי LTM`, value: `${fmtS(pct, 2)}%`, est: true, formula: 'Δרווח אחרי מס ÷ רווח נקי LTM × 100',
    inputs: [{ label: 'Δרווח אחרי מס', v: fmtS(net, 2), src: netSrc }, { label: `רווח נקי LTM${m.np?.period ? ` · ${m.np.period}` : ''}`, v: fmt(m.np?.v, 0), src: m.np ? () => toProv(m.np!.p, lts) : undefined }] };
}

/** the exposure to the whole pipeline: Σ weight × impact, every weight and every term visible */
export function exposureProv(f: RegFile, e: Exposure, band: Band, lts: LtsResolver, net = false): Prov {
  const m = f.managers[e.c];
  const by = new Map(f.initiatives.map((i) => [i.id, i] as const));
  return { k: 'calc', title: `חשיפה לצנרת כולה · ${m.name} · תרחיש ${BAND_HE[band]}${net ? ' · אחרי מס' : ''}`, value: `${fmtS((net ? e.net : e.d)[band], 1)} ${MM}`, unit: net ? 'לשנה' : 'לשנה, לפני מס', est: true,
    formula: 'Σ משקל השלב × השפעת היוזמה. המשקלות הם הנחה: ' + (Object.entries(f.meta.weights) as [Status, number][]).map(([k, w]) => `${STATUS_HE[k]} ${fmt(w, 2)}`).join(' · '),
    inputs: e.by.map((t) => { const ini = by.get(t.id)!, x = ini.impacts.find((y) => y.c === e.c)!;
      return { label: `${ini.short} · ${STATUS_HE[ini.status]} · משקל ${fmt(t.w, 2)}`, v: `${fmt(t.w, 2)} × ${fmtS((net ? x.net : x.d)[band], 2)}`, src: () => impactProv(ini, m, x, band, lts, net) }; }) };
}
