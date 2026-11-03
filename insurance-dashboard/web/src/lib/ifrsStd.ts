import { useLoad } from './useData';
import { nf } from './format';
import type { Prov } from './prov';

/* The standardised IFRS 17 layer (pipeline/build_ifrs_std.py): one grid of metrics x quarters x segments x portfolios for the seven
   insurers, from the Capital Market Authority's portfolio-group note. A cell is [value, page, report id, flags?, parts | other print?]. */

/** [v, page, report, flags?, extra?]: flags 1 derived (extra = the printed parts), 2 restated (extra = the other print), 4 chart or text, 8 sign turned */
export type Cell = [number, number | null, number | null, number?, unknown?];
export type Series = Record<string, Cell>;
export type MetricId = 'insurance_revenue' | 'insurance_service_expenses' | 'isr_before_reinsurance' | 'reinsurance_result' | 'insurance_service_result' | 'losses_onerous'
  | 'csm' | 'ra' | 'be' | 'lrc_excl_lc' | 'loss_component' | 'lic';
export interface RollForward { c: string; rp: string; seg: string; b: string; w: string; d: string; k: string | null; how: string; ok: boolean; diff: number; partial?: number; chart?: number;
  open: [number, number, number]; close: [number, number, number]; rows: [string, string, number, number | null, number, number, string | null][] }
export interface Runoff { seg: string; b: string; asof: string; printed: [string, number, number, number, [number, number]][]; std: (string | number | null | unknown[])[][] }
export interface StdMeta {
  built: string; unit: string; source: string; files: string; quarters: string[]; insurers: string[]; segs: Record<string, string>;
  metrics: Record<MetricId, { he: string; kind: 'flow' | 'stock' }>; ports: Record<string, string>; port_seg: Record<string, string>; rf_he: Record<string, string>;
  flags: Record<string, string>; reasons: string[]; no_2023: string; model_note: string;
}
export interface StdIndustry extends StdMeta {
  coverage: Record<string, Record<string, Record<string, number | string | null>>>;
  nulls: Record<string, Record<string, Partial<Record<MetricId, Record<string, number | string>>>>>;
  recon: { checked: number; ok: number; breaks: Partial<RollForward>[]; partial: Partial<RollForward>[] };
  runoff: Record<string, Record<string, Runoff>>;
  models: Record<string, { seg: string; port: string | null; ph: string; model: string; pg: number; r: number; l: string; rp: string }[]>;
  rf: Record<string, Record<string, RollForward>>;
  table: Record<string, Record<'lh' | 'pc' | 'vfa' | 'gmm_paa', Partial<Record<MetricId, Series>>>>;
  onerous: Record<string, Record<string, { loss_component: Series; losses_onerous: Series }>>;
}
export interface StdCompany {
  built: string; unit: string; source: string; meta: StdMeta; quarters: string[];
  company: string; segs: Record<string, Record<MetricId, Series>>; nulls: Record<string, Partial<Record<MetricId, Record<string, number | string>>>>;
  ports: Record<string, Partial<Record<MetricId, Series>>>; port_he: Record<string, string[]>; model_view: Record<string, Partial<Record<MetricId, Series>>>;
  rfs: RollForward[]; runoff: Record<string, Runoff>; models: StdIndustry['models'][string];
}

export const useStdIndustry = () => useLoad<StdIndustry>('ifrs17/industry.json');
export const useStdCompany = (id: string | null) => useLoad<StdCompany>(id ? `ifrs17/${id}.json` : null);

/** The PDF of a MAYA filing from its report id (the site's own file layout: rpdf/<thousand range>/P<id>-00.pdf). */
export function mayaUrl(rid: number | null | undefined): string | null {
  if (!rid) return null;
  const lo = Math.floor((rid - 1) / 1000) * 1000 + 1;
  return `https://mayafiles.tase.co.il/rpdf/${lo}-${lo + 999}/P${rid}-00.pdf`;
}
export const pageHref = (rid: number | null | undefined, pg: number | null | undefined) => { const u = mayaUrl(rid); return u && pg ? `${u}#page=${pg}` : u; };

/** "2026Q2" -> "Q2'26" */
export const qShort = (k: string) => `Q${k.slice(-1)}'${k.slice(2, 4)}`;
export const amt = (v: number | null | undefined) => (v == null ? '–' : nf(v, Math.abs(v) < 100 ? 1 : 0));

/** The source sheet of one cell: the printed page, or the arithmetic over printed figures with each input opening its own page. */
export function cellProv(c: Cell, title: string, unit = 'מיליוני ש"ח'): Prov {
  const fl = c[3] ?? 0;
  if (fl & 1 && Array.isArray(c[4])) {
    const parts = c[4] as unknown[][];
    return { k: 'calc', title, value: amt(c[0]), unit, formula: parts.length === 2 && parts[1][0] === -1 ? 'מצטבר התקופה פחות מצטבר הרבעון הקודם' : 'סכום הרכיבים שהודפסו',
      inputs: parts.map((p) => {
        const [sgn, v, pg, r, lbl] = typeof p[0] === 'number' ? p as [number, number, number, number, string?] : [1, p[1], p[2], p[3], p[0]] as [number, number, number, number, string];
        return { label: `${sgn < 0 ? '− ' : ''}${lbl ?? (sgn < 0 ? 'מצטבר קודם' : 'מצטבר')}`, v: amt(v as number), src: () => ({ k: 'report', title: `${title} · ${lbl ?? ''}`, value: amt(v as number), unit, url: mayaUrl(r as number), pg: pg as number }) as Prov };
      }) };
  }
  const re = fl & 2 && Array.isArray(c[4]) ? c[4] as [number, number, number] : null;
  return { k: 'report', title, value: amt(c[0]), unit, url: mayaUrl(c[2]), pg: c[1], srcType: fl & 4 ? 'chart' : undefined,
    turned: !!(fl & 8), note: [fl & 4 ? 'נקרא מגרף או מטקסט בדוח' : '', fl & 16 ? 'הכשרה מציגה את הבריאות בתוך מגזר החיים' : ''].filter(Boolean).join(' · ') || undefined,
    restated: re ? { first: `${amt(c[0])}`, last: `${amt(re[0])}`, firstHref: pageHref(c[2], c[1]) ?? undefined, lastHref: pageHref(re[2], re[1]) ?? undefined, in: 'דוח אחר' } : undefined };
}

/** The reason a cell is empty. */
export const whyOf = (meta: StdMeta, w: number | string | undefined) => (w == null ? 'לא הודפס בחתך הזה' : typeof w === 'number' ? meta.reasons[w] ?? '' : w);
