/* The attribution engine (module A4): the "why" of every ROE and profit change, precomputed by pipeline/build_attribution.py
   (math: pipeline/attribution.py) into data/attribution/<company>.json and data/attribution/peers_<period>.json.
   Every contribution carries the fact ids it was computed from; each fact is a printed figure (report + page) or a calculation over
   other facts, so a bar opens its inputs down to the page. */
import { nf } from './format';
import type { Prov } from './prov';
import { useLoad } from './useData';

export interface AttrFact { l: string; p: string; v: number; u: string; url?: string | null; pg?: number | null; doc?: string; der?: number; f?: string; of?: string[] }
export interface AttrDriver { k: string; l: string; v: number; f: string; in: string[]; ctx?: string; chg?: string; seg?: number }
export interface Decomp { from: number; to: number; total: number; residual: number; from_latest?: number; unit: string; mode: 'rate' | 'amount'; drivers: AttrDriver[]; sentence: string }
export interface Bridge { id: string; kind: 'qoq' | 'yoy' | 'ltm'; win: 'q' | 'ltm'; a: string; b: string; la: string; lb: string; roe: Decomp; np: Decomp; chk: { a: (string | number)[]; b: (string | number)[] }; notes?: string[] }
export interface AttrFile { v: number; company: string; name: string; kind: 'ins' | 'fund'; last: string; ends: string[]; method: string; roe_def: string; bridges: Bridge[]; gaps: { id: string; why: string }[]; facts: Record<string, AttrFact> }
export interface PeerBridge { id: string; win: 'q' | 'ltm'; a: string; b: string; roe: Decomp; chk: { a: (string | number)[]; b: (string | number)[] } }
export interface PeersFile { v: number; period: string; label: string; method: string; def: string; companies: Record<string, { name: string; kind: 'ins' | 'fund' }>; bridges: PeerBridge[]; gaps: { id: string; why: string }[]; facts: Record<string, AttrFact> }
export interface AttrIndex { v: number; peers: string | null; period: string | null; companies: { id: string; name: string; kind: 'ins' | 'fund'; last: string; n: number }[] }

export const useAttrIndex = (on = true) => useLoad<AttrIndex>(on ? 'attribution/index.json' : null);
export const useAttribution = (id: string | null) => useLoad<AttrFile>(id ? `attribution/${id}.json` : null);
export const usePeersAttr = (file: string | null) => useLoad<PeersFile>(file ? `attribution/${file}` : null);

/** the bar label under the waterfall: short, so ten bars fit a phone */
export const SHORT: Record<string, string> = {
  restate: 'הצגה מחדש', isr: 'שירותי ביטוח', inv: 'השקעות ומימון', fees: 'דמי ניהול', 'fees.yield': 'שיעור דמי ניהול', 'fees.volume': 'היקף נכסים', 'fees.mix': 'תמהיל',
  'fees.other': 'דמי ניהול אחרים', rev_other: 'הכנסות אחרות', cost: 'הוצאות', op: 'רווח תפעולי', other: 'אחר', pbt: 'רווח לפני מס', tax: 'מס', minority: 'מיעוט', equity: 'בסיס הון',
};
export const KIND_HE: Record<Bridge['kind'], string> = { yoy: 'YoY', qoq: 'QoQ', ltm: 'LTM' };

export const ql = (qk: string) => `${qk.slice(4)}'${qk.slice(2, 4)}`;
const dec = (u: string, v: number) => (u === '%' || u === 'נק׳' ? 2 : Math.abs(v) < 10 ? 3 : 1);
export const sgn = (v: number, d = 1) => (v > 0 && Number(v.toFixed(d)) !== 0 ? '+' : '') + nf(v, d);

/** A fact of the table as a source sheet: a printed figure (report, page) or a calculation that lists its inputs. */
export function factProv(F: Record<string, AttrFact>, id: string, depth = 0): Prov {
  const e = F[id];
  if (!e) return { k: 'none', title: id, why: 'הנתון אינו בטבלת המקורות' };
  const value = nf(e.v, dec(e.u, e.v));
  if (!e.of) return { k: 'report', title: e.l, value, unit: e.u, url: e.url ?? null, pg: e.pg ?? null, doc: e.doc, period: e.p, der: !!e.der };
  return { k: 'calc', title: `${e.l} · ${e.p}`, value, unit: e.u, formula: e.f ?? '', inputs: depth > 12 ? [] : e.of.slice(0, 60).map((x) => ({ label: F[x] ? `${F[x].l} · ${F[x].p}` : x, v: F[x] ? `${nf(F[x].v, dec(F[x].u, F[x].v))} ${F[x].u}` : '–', src: () => factProv(F, x, depth + 1) })) };
}

/** One contribution as a calculation over the facts it was computed from. */
export function driverProv(F: Record<string, AttrFact>, d: AttrDriver, title: string, unit: string): Prov {
  return { k: 'calc', title: `${d.l} · ${title}`, value: sgn(d.v, unit === 'נק׳' ? 2 : 1), unit, formula: d.f, note: d.ctx?.replace(/[⁦-⁩]/g, ''),
    inputs: d.in.map((x) => ({ label: F[x] ? `${F[x].l} · ${F[x].p}` : x, v: F[x] ? `${nf(F[x].v, dec(F[x].u, F[x].v))} ${F[x].u}` : '–', src: () => factProv(F, x) })) };
}

/** The bridge as a whole: from + the contributions = to, each line opening its own calculation. */
export function bridgeProv(F: Record<string, AttrFact>, b: Decomp, title: string, fromId: string | null, toId: string | null, la: string, lb: string, method: string): Prov {
  const u = b.unit, d = u === 'נק׳' ? 2 : 1;
  const ends = (id: string | null, label: string, v: number) => ({ label, v: `${nf(v, d)}${u === 'נק׳' ? '%' : ''}`, src: id && F[id] ? () => factProv(F, id) : undefined });
  return { k: 'calc', title, value: `${sgn(b.total, d)} ${u}`, unit: u, formula: `${la} + Σ תרומות = ${lb}. ${method}`,
    note: Math.abs(b.residual) > 1e-6 ? `שארית ${nf(b.residual, 4)}` : 'שארית 0: התרומות מסתכמות בדיוק לשינוי',
    inputs: [ends(fromId, la, b.from), ...b.drivers.map((x) => ({ label: x.l, v: `${sgn(x.v, d)} ${u}`, src: () => driverProv(F, x, title, u) })), ends(toId, lb, b.to)] };
}

/** the fact ids of a ROE / profit endpoint (prefix: "co:" in the peer file) */
export function endId(F: Record<string, AttrFact>, prefix: string, metric: 'roe' | 'np', win: 'q' | 'ltm', qk: string, chk: (string | number)[]): string | null {
  if (metric === 'np') return String(chk[0]);
  const id = `${prefix}roe@${win === 'ltm' ? 'LTM' : ''}${qk}`;
  return F[id] ? id : null;
}

/** "⁦4.4⁩" segments of a generated sentence: the figures, so each can open the bridge */
export function sentenceParts(s: string): { t: string; n: boolean }[] {
  const out: { t: string; n: boolean }[] = [];
  const re = /⁦([^⁩]*)⁩/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) { if (m.index > at) out.push({ t: s.slice(at, m.index), n: false }); out.push({ t: m[1], n: true }); at = m.index + m[0].length; }
  if (at < s.length) out.push({ t: s.slice(at), n: false });
  return out;
}
