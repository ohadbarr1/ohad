/* The answer contract. Every number leaves the server as a Fact: value, unit, period, entity, and either a `source` (document id, page,
   a link to the page in the fox reader) or a `calc` (formula + inputs, each with its own source). The provenance is the site's own
   (`Prov` from lib/prov.ts, built by the same engines that draw the page), converted here into plain JSON. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prov } from '../../web/src/lib/prov';
import { ridOf } from '../../web/src/lib/search';
import { matches, normalize, terms } from '../../web/src/lib/hebrew';
import { companyNames, parse as parseQuery } from '../../web/src/lib/searchOmni';
import { ckanResourcePage, DS_LABEL, mayaReport, resourceOf, type RegDs } from '../../web/src/lib/sources';
import { METRIC_BY_KEY, WIN_LABEL, addMonths, monthsBack, type Market } from '../../web/src/lib/market';
import type { RegistryCompany } from '../../web/src/lib/types';
import { SITE } from './data';
import { corpus, market, registry } from './site';

export interface Source {
  kind: 'filing' | 'xbrl' | 'regulator' | 'regulator_track';
  title?: string;
  /** MAYA report id: the document id of the fox reader */
  doc_id?: number | null;
  page?: number | null;
  /** the page in the fox reader (https://fox-research-il.web.app/doc/<id>?page=N); the filed PDF itself when the reader does not hold the document */
  url: string | null;
  pdf?: string | null;
  in_reader?: boolean;
  doc?: string;
  period?: string;
  note?: string;
  flags?: string[];
  /** regulator: dataset, months, the published resource */
  dataset?: string; months?: string[]; group?: string; products?: string; column?: string; fund_id?: number;
  restated?: { first: string; last: string; first_url?: string | null; last_url?: string | null; in: string };
}
export interface CalcInput { label: string; display: string; value: number | null; source?: Source | null; calc?: Calc | null; missing?: string }
export interface Calc { formula: string; inputs: CalcInput[]; estimate?: boolean; note?: string }
export interface Fact {
  entity: string; entity_he: string; metric: string; label: string; period: string;
  value: number | null; unit: string; display: string;
  source: Source | null; calc: Calc | null;
  /** why a value is missing */
  missing?: string;
  flags?: string[];
  /** the page of the site that shows this figure */
  view: string;
}

/* ---------- links ---------- */
export const siteUrl = (path: string) => `${SITE}${path.startsWith('/') ? '' : '/'}${path}`;
export async function docLink(rid: number | null | undefined, page: number | null | undefined, pdf?: string | null): Promise<Pick<Source, 'doc_id' | 'page' | 'url' | 'pdf' | 'in_reader'>> {
  const c = await corpus().catch(() => null);
  const inReader = rid != null && !!c?.byId.has(rid);
  const url = inReader ? siteUrl(`/doc/${rid}${page ? `?page=${page}` : ''}`) : pdf ? (page ? `${pdf.split('#')[0]}#page=${page}` : pdf) : rid != null ? mayaReport(rid) : null;
  return { doc_id: rid ?? null, page: page ?? null, url, pdf: pdf ? pdf.split('#')[0] : rid != null && c?.byId.get(rid) ? c.byId.get(rid)!.url : null, in_reader: inReader };
}

/* ---------- numbers as the site prints them ---------- */
/** "1,234.5" · "−12.3%" · "+1.3 נק׳" → the number (the display string is the site's own formatting of that number) */
export function parseShown(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = /[−\-+]?\d[\d,]*(?:\.\d+)?/.exec(s.replace(/⁦|⁩|‎|‏/g, ''));
  if (!m) return null;
  const v = Number(m[0].replace(/,/g, '').replace('−', '-'));
  return Number.isFinite(v) ? v : null;
}
export const round = (v: number | null, d = 4) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/* ---------- provenance: the site's Prov as JSON ---------- */
const DS_OF_SET: Record<string, RegDs[]> = { all: ['pensia', 'gemel', 'insurance'], 'fam:pension': ['pensia'], 'fam:gemel': ['gemel'], 'fam:insurance': ['insurance'] };
const ym = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;

async function regSource(p: Extract<Prov, { k: 'reg' }>, m: Market): Promise<Source> {
  const def = METRIC_BY_KEY[p.metric], period = m.P[p.pi];
  const n = p.w === 'm' ? 1 : p.w === 'ltm' ? 12 : p.w === 'q' ? 3 : period % 100;
  const months = def?.win ? monthsBack(period, n) : [period];
  const set = m.sets.find((s) => s.id === p.set);
  const dss = DS_OF_SET[p.set] ?? (set ? [...new Set([...set.has].map((i) => m.d.products[i].family))].map((f) => (f === 'gemel' ? 'gemel' : f === 'insurance' ? 'insurance' : 'pensia') as RegDs) : []);
  const res = dss.map((ds) => { const r = resourceOf(m.d.meta.resources?.[ds], period); const pkg = m.d.meta.packages?.[ds]; return r && pkg ? ckanResourcePage(pkg, r.id) : null; }).filter(Boolean) as string[];
  return {
    kind: 'regulator', title: `${def?.label ?? p.metric}${def?.win ? ` · ${WIN_LABEL[p.w]}` : ''}`, dataset: dss.map((d) => DS_LABEL[d]).join(' + '), months: months.map(ym),
    group: p.g < 0 ? 'כלל השוק' : m.d.groups[p.g], products: set?.label, url: res[0] ?? null,
    note: `קובצי המסלולים החודשיים של הרשות (data.gov.il), נשלף ${m.d.meta.fetched ?? m.d.meta.generated}${res.length > 1 ? ` · קבצים: ${res.join(' ')}` : ''}`,
  };
}

/** How deep a calculation opens its inputs: `brief` keeps tables small, `full` opens every input down to its page. Set per tool call. */
const detail = new AsyncLocalStorage<number>();
export const withDetail = <T>(d: 'brief' | 'full' | undefined, brief: number, f: () => Promise<T>) => detail.run(d === 'full' ? 4 : brief, f);
/** a narrower depth inside a call (a whole-segment table), unless the caller asked for full detail */
export const narrower = <T>(depth: number, f: () => Promise<T>) => ((detail.getStore() ?? 2) >= 4 ? f() : detail.run(Math.min(depth, detail.getStore() ?? 2), f));
/** The site's provenance of one figure as a source or a calculation. Calculations open their inputs to `depth` levels. */
export async function provOut(p: Prov, depth = detail.getStore() ?? 2): Promise<{ source: Source | null; calc: Calc | null; missing?: string }> {
  switch (p.k) {
    case 'report': {
      const rid = ridOf(p.url);
      const link = await docLink(rid, p.pg, p.url);
      const flags = [p.der ? 'נגזר' : '', p.old ? 'IFRS 4' : '', p.turned ? 'סימן הופך' : ''].filter(Boolean);
      return { calc: null, source: { kind: 'filing', title: p.title, ...link, doc: p.doc, period: p.period, note: p.note || undefined, flags: flags.length ? flags : undefined,
        restated: p.restated ? { first: p.restated.first, last: p.restated.last, first_url: p.restated.firstHref ? siteUrl(p.restated.firstHref) : null, last_url: p.restated.lastHref ? siteUrl(p.restated.lastHref) : null, in: p.restated.in } : undefined } };
    }
    case 'xbrl': {
      const link = await docLink(p.rid, null, null);
      return { calc: null, source: { kind: 'xbrl', title: p.title, ...link, url: link.url ?? (p.rid ? mayaReport(p.rid) : null), doc: `${p.company} · XBRL ${p.concept}`, period: p.period, note: [p.status, p.note, 'תג XBRL: אין עמוד מודפס; הקישור פותח את הדוח'].filter(Boolean).join(' · ') } };
    }
    case 'reg': return { calc: null, source: await regSource(p, await market()) };
    case 'fund': {
      const m = await market();
      const r = resourceOf(m.d.meta.resources?.[p.ds], p.period), pkg = m.d.meta.packages?.[p.ds];
      return { calc: null, source: { kind: 'regulator_track', title: p.title, dataset: DS_LABEL[p.ds], fund_id: p.id, months: [ym(p.period)], column: p.col, url: r && pkg ? ckanResourcePage(pkg, r.id) : null, note: p.note } };
    }
    case 'calc': {
      const inputs: CalcInput[] = [];
      for (const x of p.inputs.slice(0, 40)) {
        const inner = x.src && depth > 0 ? await provOut(x.src(), depth - 1) : null;
        inputs.push({ label: x.label, display: x.v, value: parseShown(x.v), source: inner?.source ?? null, calc: inner?.calc ?? null, missing: inner?.missing });
      }
      return { source: null, calc: { formula: p.formula, inputs, estimate: p.est || undefined, note: p.note } };
    }
    case 'price': return { source: null, calc: null, missing: 'מחיר שוק: אינו חלק מהנתונים שהשרת מחזיר' };
    case 'none': return { source: null, calc: null, missing: p.why };
  }
}

/* ---------- entities ---------- */
export interface Ent { id: string; he: string; en: string; kind: 'insurance_group' | 'fund_house' | 'market_group'; group: string | null; c?: RegistryCompany }
const MARKET_IDS: Record<string, string> = {};
export async function entities(): Promise<Ent[]> {
  const [reg, m] = await Promise.all([registry(), market()]);
  const out: Ent[] = reg.map((c) => ({ id: c.id, he: c.name_he, en: c.name_en, kind: c.kind, group: c.market_group, c }));
  for (const g of m.d.groups) if (!out.some((e) => e.group === g)) { const id = MARKET_IDS[g] ?? `group:${g}`; out.push({ id, he: g, en: g, kind: 'market_group', group: g }); }
  return out;
}
/** A company or market group from an id, a Hebrew or English name, or a name behind prefix letters ("בהראל"). */
export async function entity(q: string): Promise<Ent> {
  const all = await entities();
  const s = q.trim();
  const direct = all.find((e) => e.id === s || e.he === s || e.en.toLowerCase() === s.toLowerCase() || e.group === s);
  if (direct) return direct;
  const reg = await registry();
  const hit = parseQuery(s, companyNames(reg)).company;
  if (hit) return all.find((e) => e.id === hit.id)!;
  const n = terms(s);
  const g = all.find((e) => e.kind === 'market_group' && terms(e.he).every((w, i) => n[i] && matches(n[i], w)));
  if (g) return g;
  throw new Error(`לא זוהתה חברה: "${q}". אפשרויות: ${all.map((e) => `${e.id} (${e.he})`).join(', ')}`);
}

/* ---------- periods ---------- */
export interface Per { kind: 'Q' | 'FY' | 'H' | 'M' | 'LTM' | 'latest'; key: string; label: string }
const qLabel = (k: string) => (k.endsWith('FY') ? `FY'${k.slice(2, 4)}` : `${k.slice(4)}'${k.slice(2, 4)}`);
/** Q2'26 · 2026Q2 · FY'25 · 2025FY · H1'26 · 9M'25 · LTM Q2'26 · 08/26 · 2026-08 · latest */
export function period(raw: string | undefined | null): Per {
  const s = (raw ?? '').trim().replace(/[׳’`]/g, "'");
  if (!s || /^(latest|אחרון|האחרון)$/i.test(s)) return { kind: 'latest', key: '', label: 'אחרון' };
  let m: RegExpExecArray | null;
  if ((m = /^(\d{2})\/(\d{2}|\d{4})$/.exec(s))) { const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]); const k = String(y * 100 + Number(m[1])); return { kind: 'M', key: k, label: `${m[1]}/${String(y).slice(2)}` }; }
  if ((m = /^(\d{4})-?(\d{2})$/.exec(s)) && Number(m[2]) <= 12) { const k = `${m[1]}${m[2]}`; return { kind: 'M', key: k, label: `${m[2]}/${m[1].slice(2)}` }; }
  const ltm = /^ltm\b\s*/i.test(s);
  const body = s.replace(/^ltm\b\s*/i, '');
  const y4 = (y: string) => (y.length === 2 ? `20${y}` : y);
  if ((m = /^(q[1-4]|fy|h[12]|9m)\s*'?\s*(\d{2}|\d{4})$/i.exec(body)) || (m = /^(\d{4})\s*(q[1-4]|fy|h[12])$/i.exec(body))) {
    const [k, y] = /^\d{4}$/.test(m[1]) ? [m[2].toUpperCase(), m[1]] : [m[1].toUpperCase(), y4(m[2])];
    if (ltm) { const q = k === 'FY' ? `${y}Q4` : k === 'H1' ? `${y}Q2` : k === 'H2' ? `${y}Q4` : k === '9M' ? `${y}Q3` : `${y}${k}`; return { kind: 'LTM', key: q, label: `LTM ${qLabel(q.replace('Q4', 'FY'))}`.replace(`LTM FY'`, `LTM Q4'`) }; }
    if (k === 'FY') return { kind: 'FY', key: `${y}FY`, label: `FY'${y.slice(2)}` };
    if (k === 'H1' || k === 'H2') return { kind: 'H', key: `${y}${k}`, label: `${k}'${y.slice(2)}` };
    if (k === '9M') return { kind: 'Q', key: `${y}Q3`, label: `9M'${y.slice(2)}` };
    return { kind: 'Q', key: `${y}${k}`, label: `${k}'${y.slice(2)}` };
  }
  if (ltm) return { kind: 'LTM', key: '', label: 'LTM' };
  throw new Error(`תקופה לא מוכרת: "${raw}". דוגמאות: Q2'26, FY'25, H1'26, LTM Q2'26, 08/26, latest`);
}
/** a quarter key on the registry's axis: 2025FY → 2025Q4 */
export const qkey = (k: string) => (k.endsWith('FY') ? `${k.slice(0, 4)}Q4` : k);
export const reportKey = (k: string) => (k.endsWith('Q4') ? `${k.slice(0, 4)}FY` : k);
export { addMonths, normalize, qLabel, ym };
