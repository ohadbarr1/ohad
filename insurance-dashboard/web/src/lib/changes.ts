/** Report Day changes (lane P1): changes/<company>.json and changes/index.json, built by pipeline/build_changes.py (the rule is there). */
import type { Prov } from './prov';
import { nf } from './format';
import { useLoad } from './useData';

export const FILES = 'https://mayafiles.tase.co.il/';
export interface ChgSrc { k: 'pg' | 'calc' | 'xbrl'; rid?: number | null; pg?: number; der?: 1; fx?: string; in?: ChgFig[]; key?: string | null; p?: string | null }
export interface ChgFig { l?: string; v: number; u: 'm' | 'pct' | 'pp' | 'dm' | 'dpct'; s: ChgSrc }
export interface ChgItem {
  k: string; l: string; g: 'pl' | 'bs' | 'ifrs' | 'ratio' | 'xbrl'; cmp: 'YoY' | 'QoQ' | 'LTM' | 'prev'; la: string; lb: string; pl: string;
  a: ChgFig; b: ChgFig; d: ChgFig; dp?: ChgFig; rest?: ChgFig; z: number | null; sc: number; gd: -1 | 0 | 1;
  alt?: 1; der?: 1; tx?: 1; why?: { t: string; s: ChgSrc };
}
export interface ChgReport { p: string; end: string; st: 'verified' | 'unverified'; rid: number | null; pub: string | null; pages: number | null; eq: ChgFig | null; cand: number; n: number; items: ChgItem[] }
/** docs: report id -> [type, period, publication day, path under FILES, pages] */
export interface Changes { v: number; c: string; name: string; kind: 'ins' | 'fund'; rule: string; docs: Record<string, [string, string, string, string, number | null]>; reports: ChgReport[] }
export interface ChangesIndex { v: number; built: string; rule: string; co: Record<string, { name: string; p: string; pub: string | null; n: number; st: string; rid: number | null; top: string | null; ps: string[] }> }

export const useChanges = (id: string | null) => useLoad<Changes>(id ? `changes/${id}.json` : null);
export const useChangesIndex = () => useLoad<ChangesIndex>('changes/index.json');

const DOC_HE: Record<string, string> = { quarterly: 'דוח רבעוני', annual: 'דוח שנתי' };
export const repName = (p: string): string => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
const UNIT: Record<ChgFig['u'], string> = { m: 'מיליוני ש"ח', dm: 'מיליוני ש"ח', pct: '%', pp: 'נק׳', dpct: '%' };

/** the text a figure shows: NIS m with one decimal (the Report Day table), a ratio with one decimal and %, a change signed */
export function figText(f: ChgFig): string {
  const sign = (f.u === 'dm' || f.u === 'pp' || f.u === 'dpct') && Number(f.v.toFixed(1)) > 0 ? '+' : '';
  return sign + nf(f.v, 1) + (f.u === 'pct' || f.u === 'dpct' ? '%' : f.u === 'pp' ? ' נק׳' : '');
}
export const docUrl = (d: Changes, rid: number | null | undefined): string | null => {
  const x = rid != null ? d.docs[String(rid)] : undefined;
  return x ? FILES + x[3] : null;
};
export const docName = (d: Changes, rid: number | null | undefined): string | undefined => {
  const x = rid != null ? d.docs[String(rid)] : undefined;
  return x ? `${DOC_HE[x[0]] ?? 'דוח'} ${repName(x[1])}` : undefined;
};

/** where a figure of a change comes from: the page it is printed on, or the calculation with its inputs (each opening its own page) */
export function chgProv(d: Changes, f: ChgFig, title: string, period: string, note?: string, stock = false): Prov {
  const s = f.s;
  if (s.k === 'calc') return { k: 'calc', title: `${title} · ${period}`, value: figText(f), unit: UNIT[f.u], formula: s.fx ?? '',
    inputs: (s.in ?? []).map((x) => ({ label: x.l ?? '', v: figText(x), src: () => chgProv(d, x, title, x.l ?? period, undefined, stock) })), note };
  if (s.k === 'xbrl') return { k: 'xbrl', title, value: figText(f), unit: UNIT[f.u], company: d.c, period, rid: s.rid ?? null, concept: s.key ?? '', status: 'unverified', note: 'תיוג XBRL של הדוח; טרם הושווה למספר המודפס' };
  return { k: 'report', title, value: figText(f), unit: UNIT[f.u], url: docUrl(d, s.rid), pg: s.pg ?? null, doc: docName(d, s.rid), period, der: s.der ? (stock ? 'stock' : true) : undefined, note };
}
