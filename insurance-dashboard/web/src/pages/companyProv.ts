import type { CompanyStore } from '../lib/company';
import type { Prov } from '../lib/prov';
import { periodLabel } from '../lib/format';
import type { IfrsData, IfrsFact } from '../lib/types';

type Report = Extract<Prov, { k: 'report' }>;
type Calc = Extract<Prov, { k: 'calc' }>;

/** The file a figure was read from, without a page: its own report when the fact names one, otherwise the entity's single source file. */
export const bareUrl = (store: CompanyStore, entity: string, u?: number | null, own = false): string | null =>
  (u != null ? store.d.urls?.[u] : null) ?? (own && u == null ? null : store.d.sources.find((x) => x.entity === entity)?.url) ?? null;

export const fileOf = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() ?? url);
/** Name of the document: the source list names the latest report; an earlier report is named by its file. */
export const docOf = (store: CompanyStore, entity: string, url: string | null): string | undefined =>
  url ? store.d.sources.find((x) => x.url === url)?.doc ?? fileOf(url) : store.d.sources.find((x) => x.entity === entity)?.doc;

/** A figure printed in a filed report. */
export function printed(store: CompanyStore, mi: number, pi: number, o: { value: string; unit: string; entity: string; period?: string; title?: string; ownOnly?: boolean; note?: string }): Prov {
  const f = store.byMetric.get(mi)?.get(pi), m = store.d.metrics[mi];
  const title = o.title ?? (m.dim ? `${m.label} · ${m.dim}` : m.label);
  if (!f) return { k: 'none', title, why: 'אין נתון מודפס לתקופה זו בדוח' };
  const url = bareUrl(store, o.entity, f.u, o.ownOnly);
  return { k: 'report', title, value: o.value, unit: o.unit, url, pg: f.page, doc: docOf(store, o.entity, url), period: o.period ?? store.plabel(pi), der: f.der, old: f.old, turned: f.turned, note: o.note };
}

export const calc = (title: string, value: string, formula: string, inputs: Calc['inputs'], unit?: string, note?: string): Prov => ({ k: 'calc', title, value, unit, formula, inputs, note });
export const none = (title: string, value: string, why: string): Prov => ({ k: 'none', title, why: `${value ? value + ' · ' : ''}${why}` });
export const report = (r: Omit<Report, 'k'>): Prov => ({ k: 'report', ...r });

/* ---------- figures extracted from the IFRS 17 / solvency disclosures ---------- */
const YTD: Record<string, string> = { '03-31': 'Q', '06-30': 'H', '09-30': '9M', '12-31': 'FY' };
export const repName = (p: string): string => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
/** The period a fact covers, named like every period on the site: a quarter, the cumulative window, a year or a balance date. */
export const factPeriod = (f: IfrsFact): string => periodLabel(f.w === 'q' ? 'Q' : f.w === 'ytd' ? YTD[f.d.slice(5)] ?? 'Q' : f.w === 'fy' ? 'FY' : 'I', f.d);
export const factUrl = (f: IfrsFact, d: IfrsData, p: string): string | null => (f.u !== undefined ? f.u : d.files.find((x) => x.company === f.c && x.period === p)?.url ?? null);

/** A fact the extraction read from a filed report (or its investor presentation): page, document and how it was read. */
export function ifrsProv(f: IfrsFact, d: IfrsData, p: string, o: { title: string; value: string; unit: string; period?: string; note?: string }): Prov {
  const how = f.src === 'chart' ? 'נקרא מגרף' : f.src === 'text' ? 'נקרא מטקסט הדוח' : '';
  const pres = f.u !== undefined;
  return { k: 'report', title: o.title, value: o.value, unit: o.unit, url: factUrl(f, d, p), pg: f.pg, doc: `${pres ? 'מצגת' : 'דוח'} ${repName(p)}`, period: o.period ?? factPeriod(f), note: [o.note, how].filter(Boolean).join(' · ') || undefined };
}
