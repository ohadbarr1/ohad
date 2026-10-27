/** The delta feed (module M2): feed.json (pipeline/build_feed.py), its figures as Prov, and the formatting the page and the home block share. */
import { MINUS, nf, pubLabel } from './format';
import type { Prov } from './prov';
import type { MetricKey, Win } from './market';
import type { RegDs } from './sources';
import { useLoad } from './useData';

export type FeedType = 'filing' | 'restate' | 'regmonth' | 'flow' | 'target' | 'solv' | 'fee' | 'est';
export type FeedUnit = 'm' | 'bn' | 'pct' | 'pp' | 'dm' | 'dbn' | 'dpct' | 'n';
export type FeedSrc =
  | { k: 'pg'; rid: number; pg: number | null; der?: 1 | 2 }
  | { k: 'reg'; metric: MetricKey; ym: number; pi: number; w: Win; set: string; g: number }
  | { k: 'fund'; ds: RegDs; id: number; ym: number; col: string }
  | { k: 'calc'; fx: string; in: FeedFig[] }
  | { k: 'count'; fx: string };
export interface FeedFig { v: number; u: FeedUnit; s: FeedSrc; l?: string }
export interface FeedRow { l: string; ab?: string[]; a: FeedFig; b?: FeedFig; d?: FeedFig; dp?: FeedFig; rng?: 1; note?: string }
export interface FeedEvent {
  id: string; t: FeedType; d: string; dk: 'pub' | 'fetched' | 'month'; c: string; per: string; h: string; to: string;
  src: { k: 'doc'; rid: number; pg?: number | null } | { k: 'reg'; ym: number } | { k: 'fund'; ds: RegDs; id: number; ym: number };
  rows?: FeedRow[]; refs?: string[]; st?: 'met' | 'partial' | 'missed';
}
export interface FeedFile {
  v: number; built: string; from: string; files: string; source: string;
  types: Record<FeedType, { he: string; n: number; slot?: 1 }>;
  rules: Record<string, number>;
  cos: Record<string, string>; groups: string[];
  /** rid -> [company, type, period, publication date, path under `files`, pages] */
  docs: Record<string, [string, string, string, string, string, number | null]>;
  events: FeedEvent[];
}
export const useFeed = (enabled = true) => useLoad<FeedFile>(enabled ? 'feed.json' : null);

export const FEED_TYPES: FeedType[] = ['filing', 'restate', 'solv', 'target', 'regmonth', 'flow', 'fee', 'est'];
/** short labels for chips and filters */
export const TYPE_SHORT: Record<FeedType, string> = { filing: 'דוח', restate: 'הצגה מחדש', regmonth: 'חודש רשות', flow: 'צבירה נטו', target: 'יעד', solv: 'כושר פירעון', fee: 'דמי ניהול', est: 'אומדנים' };
export const DK_HE: Record<FeedEvent['dk'], string> = { pub: 'פרסום', fetched: 'התקבל מהרשות', month: 'חודש נתונים' };
const DOC_HE: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'דוח כושר פירעון' };
const DS_HE: Record<string, string> = { gemel: 'גמל-נט', pensia: 'פנסיה-נט', insurance: 'ביטוח-נט' };
export const UNIT_HE: Partial<Record<FeedUnit, string>> = { m: 'מיליוני ש"ח', dm: 'מיליוני ש"ח', bn: 'מיליארד ש"ח', dbn: 'מיליארד ש"ח', pct: '%', dpct: '%', pp: 'נק׳ אחוז' };

const ym = (x: number) => `${String(x % 100).padStart(2, '0')}/${String(Math.floor(x / 100)).slice(2)}`;
export const ymLabel = ym;
const per = (p: string) => (!p ? '' : p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : /^\d{4}Q\d$/.test(p) ? `${p.slice(4)}'${p.slice(2, 4)}` : p);
const plus = (v: number, d: number) => (Number(v.toFixed(d)) > 0 ? '+' : '');

/** a figure the way the feed shows it: amounts in NIS m (one decimal below 1,000), NIS bn (two decimals), ratios in %, changes signed */
export function fmtFig(f: Pick<FeedFig, 'v' | 'u'>): string {
  const { v, u } = f;
  switch (u) {
    case 'pct': return `${nf(v, Math.abs(v) < 5 ? 2 : 1)}%`;
    case 'dpct': return `${plus(v, 1)}${nf(v, 1)}%`;
    case 'pp': return `${plus(v, 2)}${nf(v, 2)}`;
    case 'bn': return nf(v, 2);
    case 'dbn': return `${plus(v, 2)}${nf(v, 2)}`;
    case 'm': return nf(v, Math.abs(v) < 1000 ? 1 : 0);
    case 'dm': return `${plus(v, 1)}${nf(v, Math.abs(v) < 1000 ? 1 : 0)}`;
    default: return nf(v, 0);
  }
}
export const signedUnit = (u: FeedUnit) => u === 'dm' || u === 'dbn' || u === 'dpct' || u === 'pp';
export const toneOf = (f: FeedFig) => (!signedUnit(f.u) ? '' : f.v > 0 ? 'pos' : f.v < 0 ? 'neg' : '');

/** the date column: a publication day, the day fox received the regulator's file, or the data month (its release day is not kept) */
export const whenLabel = (e: FeedEvent) => (e.dk === 'month' ? ym(Number(e.per)) : pubLabel(e.d));

export function docName(F: FeedFile, rid: number): string {
  const d = F.docs[String(rid)];
  if (!d) return `דוח ${rid}`;
  return `${F.cos[d[0]] ?? d[0]}, ${DOC_HE[d[1]] ?? 'דוח'}${d[2] ? ` ${per(d[2])}` : ''}`;
}
export const docUrl = (F: FeedFile, rid: number) => { const d = F.docs[String(rid)]; return d ? F.files + d[4] : null; };

/** The source of one figure, built when it is opened (never on render). `title` names the line, the company and the period. */
export function figProv(F: FeedFile, f: FeedFig, title: string): Prov {
  const value = fmtFig(f), unit = UNIT_HE[f.u];
  const s = f.s;
  switch (s.k) {
    case 'pg': {
      const d = F.docs[String(s.rid)];
      return { k: 'report', title, value, unit, url: docUrl(F, s.rid), pg: s.pg, doc: docName(F, s.rid), period: d?.[2] ? per(d[2]) : undefined, srcType: d ? DOC_HE[d[1]] : undefined,
        der: s.der === 1 ? true : s.der === 2 ? 'stock' : undefined, note: 'הערך כפי שהאתר מציג אותו היום: ההדפסה האחרונה של הנתון, בעמוד שבו הודפס' };
    }
    case 'reg': return { k: 'reg', metric: s.metric, pi: s.pi, w: s.w, set: s.set, g: s.g };
    case 'fund': return { k: 'fund', title, value, unit, ds: s.ds, id: s.id, period: s.ym, col: s.col, note: `${DS_HE[s.ds] ?? s.ds} · ${ym(s.ym)}` };
    case 'calc': return { k: 'calc', title, value, unit, formula: s.fx, inputs: s.in.map((x) => ({ label: x.l ?? '', v: fmtFig(x), src: () => figProv(F, x, `${x.l ?? ''} · ${title}`) })) };
    case 'count': return { k: 'calc', title, value, formula: s.fx, inputs: [] };
  }
}

/** one line of provenance for an event's own document or month (the event header's source link) */
export function eventSource(F: FeedFile, e: FeedEvent): { text: string; href: string | null } {
  const s = e.src;
  if (s.k === 'doc') { const u = docUrl(F, s.rid); return { text: docName(F, s.rid) + (s.pg ? ` · עמ׳ ${s.pg}` : ''), href: u ? u + (s.pg ? `#page=${s.pg}` : '') : null }; }
  if (s.k === 'reg') return { text: `רשות שוק ההון · ${ym(s.ym)}`, href: null };
  return { text: `${DS_HE[s.ds] ?? s.ds} · קופה ${s.id} · ${ym(s.ym)}`, href: null };
}

/** the plain-text cells of a row, for the spreadsheet export */
export const rowText = (r: FeedRow) => [r.l, fmtFig(r.a), r.b ? fmtFig(r.b) : '', r.d ? fmtFig(r.d) : '', r.dp ? fmtFig(r.dp) : ''];
export { MINUS };
