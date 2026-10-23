/* The site's own engines, loaded once per process over the published JSON. Every number a tool returns is computed by these
   classes and functions, imported from web/src: the same code that draws the page. */
import { load } from '../../web/src/lib/useData';
import { CompanyKpi } from '../../web/src/lib/kpi';
import { CompanyStore } from '../../web/src/lib/company';
import { Market } from '../../web/src/lib/market';
import { Book, type Registry } from '../../web/src/lib/registry';
import { csmFactsPath, reportsOf as csmReportsOf, type CapCo, type CsmSummary, type FactsFile } from '../../web/src/lib/csmData';
import type { Reports } from '../../web/src/lib/csm';
import type { LensData } from '../../web/src/lib/lens';
import { loadCorpus, type Corpus } from '../../web/src/lib/search';
import type { IfrsData, KpiData, MarketData, RegistryCompany } from '../../web/src/lib/types';

const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, f: () => Promise<T>): Promise<T> {
  if (!memo.has(key)) { const p = f(); memo.set(key, p); p.catch(() => memo.delete(key)); }
  return memo.get(key) as Promise<T>;
}

export const registry = () => once('reg', () => load<RegistryCompany[]>('companies/index.json'));
export const kpiData = () => once('kpi', () => load<KpiData>('kpi.json'));
export async function kpiOf(id: string): Promise<CompanyKpi | null> {
  const d = await kpiData();
  const c = d.companies[id];
  // prices are never loaded: the server is fundamentals only
  return c ? once(`kpi:${id}`, async () => new CompanyKpi(id, c, null)) : null;
}
export const storeOf = (id: string) => once(`store:${id}`, async () => new CompanyStore(await load(`companies/${id}.json`)));
export const market = () => once('market', async () => new Market(await load<MarketData>('market.json')));
export const ifrsIndex = () => once('ifrs', () => load<IfrsData>('ifrs.json'));

/* ---------- the CSM ledger: csm/summary.json + csm/facts/<id>.json ---------- */
export const csmSummary = () => once('csm', () => load<CsmSummary>('csm/summary.json'));
export const csmFile = (id: string) => once(`csmf:${id}`, () => load<FactsFile>(csmFactsPath(id)));
export async function csmReports(id: string): Promise<{ rs: Reports; d: IfrsData } | null> {
  const s = await csmSummary();
  if (!s.companies.includes(id)) return null;
  const f = await csmFile(id);
  return { rs: csmReportsOf(f), d: { unit: 'NIS millions', files: f.files } };
}

/* ---------- the peer registry: peers/registry.json + one file per metric, loaded as asked ---------- */
export const peerRegistry = () => once('peers', () => load<Registry>('peers/registry.json'));
type MetricFile = ConstructorParameters<typeof Book>[1] extends Map<string, infer F> ? F : never;
const files = new Map<string, MetricFile>();
/** The engine with the files of `mids` (and their formula inputs) loaded. The map is shared, so one Book serves every call. */
export async function bookFor(mids: string[]): Promise<Book> {
  const reg = await peerRegistry();
  const by = new Map(reg.metrics.map((m) => [m.id, m.f]));
  const need = [...new Set(mids.map((id) => by.get(id)).filter((f): f is string => !!f))].filter((f) => !files.has(f));
  await Promise.all(need.map(async (f) => { files.set(f, await load<MetricFile>(`peers/m/${f}.json`)); }));
  return new Book(reg, files);
}

/** csm/capital.json: solvency, equity, profit and dividends per insurer (the capital view of the CSM ledger) */
export const capital = () => once('cap', () => load<{ built: string; source: string; companies: Record<string, CapCo> }>('csm/capital.json'));
export const lens = () => once('lens', () => load<LensData>('lens.json'));
export const corpus = (): Promise<Corpus> => once('corpus', () => loadCorpus());
export const searchPool = () => once('pool', async () => {
  const [ent, rows] = await Promise.all([load<{ groups: string[]; funds: [string, string][] }>('search/entities.json'), load<[string, string, string, number][]>('search/rows.json')]);
  return { ent, rows };
});

/** Lets a loader the site fires and forgets (warmRep, warmLts) land before its result is read. */
export const settle = (ms = 15) => new Promise((r) => setTimeout(r, ms));
