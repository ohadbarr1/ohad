/* lane OW: the ownership files (pipeline/build_ownership.py) and the helpers both ownership pages share */
import type { Prov } from '../lib/prov';
import { nf, pubLabel } from '../lib/format';

export type HolderType = 'controlling' | 'interested' | 'institutional' | 'officer' | 'treasury';
export type Channel = 'nostro' | 'participating' | 'mm' | 'pension' | 'gemel' | 'mutual' | 'etf' | 'funds' | 'other';

export interface CellPart { name: string | null; channel: Channel | null; cap: number | null; date?: string | null; funds?: number; nis_m?: number }
export interface Cell { h: string; c: string; pct: number | null; basis: 'ip' | 'funds'; self: boolean; date: string | null; src: string; parts: CellPart[] }
export interface IndexRow {
  id: string; entity: string; listed: boolean; asof: string | null; parent_note: string | null;
  controlling: number | null; institutional: number | null; public: number | null; interested: number | null;
  top: { name: string; cap: number | null; type: HolderType } | null; funds_pct: number | null; funds_month: string | null; quarters: number; last_q: string | null;
}
export interface OwnIndex {
  built: string; source: string; disclaimers: { ip: string; funds: string; terms: string }; names: Record<string, string>;
  companies: IndexRow[]; matrix: { rows: string[]; cols: string[]; cells: Cell[] };
}
export interface Holder {
  name: string; group: string | null; self: boolean; type: HolderType; channel: Channel | null; security: string; main: boolean;
  balance: number | null; cap: number | null; vote: number | null; date: string | null; remark: string | null;
}
export interface SeriesPart { name: string; cap: number | null; vote: number | null; type: string; channel: Channel }
export interface Series { key: string; name: string | null; group: string | null; self: boolean; type: HolderType; pts: (number | null)[]; parts: Record<string, SeriesPart[]>; last: number | null }
export interface Report { q: string; asof: string | null; rid: number; url: string; file: string | null; published: string | null; controlling: number | null; total: number | null; public: number | null }
export interface Change { key: string; name: string | null; group: string | null; from: number | null; to: number | null; d: number | null }
export interface FundMgr { manager: string | null; group: string | null; funds: number; qty: number; pct: number; nis_m: number }
export interface OwnCompany {
  id: string; name: string; entity: string; maya_id: number; security: number | null; parent_note: string | null; listed: boolean; maya_url: string; indices: string[]; retrieved: string;
  split: { interested: number | null; institutional: number | null; public: number | null; controlling: number | null; asof: string | null; controlling_asof: string | null; src: string };
  holders: Holder[]; holders_src: string;
  funds: { month: string | null; issued: number; n: number; total_pct: number; by_manager: FundMgr[]; src: string; api: string; retrieved: string; unmapped: number } | null;
  history: { quarters: string[]; reports: Report[]; series: Series[]; changes: Change[]; form: string };
}

export const TYPE_HE: Record<HolderType, string> = { controlling: 'בעל שליטה', interested: 'בעל עניין', institutional: 'מוסדי', officer: 'נושא משרה', treasury: 'החברה עצמה' };
export const CHANNEL_HE: Record<Channel, string> = {
  nostro: 'נוסטרו', participating: 'משתתפות ברווחים', mm: 'עושה שוק', pension: 'פנסיה', gemel: 'גמל', mutual: 'קרנות נאמנות', etf: 'קרנות סל', funds: 'קרנות נאמנות וסל', other: 'אחר',
};
/** "2026Q3" -> "Q3'26" */
export const qLabel = (q: string) => `${q.slice(4)}'${q.slice(2, 4)}`;
/** "2026-07-31" -> "07/26" (a monthly fund report) */
export const monthLabel = (d: string | null | undefined) => (d && d.length >= 7 ? `${d.slice(5, 7)}/${d.slice(2, 4)}` : '');
export const pctTxt = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${nf(v, d)}%`);

/** a holder's name: a group by its registry name, anyone else as filed */
export const nameOf = (names: Record<string, string>, s: { group: string | null; name: string | null }) => (s.group ? names[s.group] ?? s.group : s.name ?? '');

export const ipProv = (c: OwnCompany, h: Holder, what: 'cap' | 'vote' = 'cap'): Prov => ({
  k: 'report', title: `${h.name} · ${what === 'cap' ? '% מההון' : '% מההצבעה'}`, value: pctTxt(h[what]), url: c.maya_url, pg: null,
  doc: `בעלי עניין, ${c.entity}`, period: h.date ? `יתרה ליום ${pubLabel(h.date)}` : undefined, srcType: 'MAYA · דף החברה באתר הבורסה (בעלי עניין)',
  note: [h.security && `נייר: ${h.security}`, h.remark].filter(Boolean).join(' · ') || undefined,
});

export const reportProv = (title: string, value: string, r: Report, entity: string, note?: string): Prov => ({
  k: 'report', title, value, url: r.file ?? r.url, pg: null, doc: `ת077 · מצבת החזקות בעלי עניין, ${entity}`, period: `${qLabel(r.q)} · פורסם ${pubLabel(r.published)}`,
  srcType: `דיווח מיידי במאיה, אסמכתא ${r.rid}`, note,
});

export const cellProv = (names: Record<string, string>, x: Cell, entity: string): Prov => x.basis === 'ip'
  ? { k: 'report', title: `${names[x.h] ?? x.h} ב${names[x.c] ?? x.c}`, value: pctTxt(x.pct), url: x.src, pg: null, doc: `בעלי עניין, ${entity}`,
      period: x.date ? `יתרות עד ${pubLabel(x.date)}` : undefined, srcType: 'MAYA · דף החברה באתר הבורסה (בעלי עניין)',
      note: x.parts.map((p) => `${p.name} ${pctTxt(p.cap)}`).join(' · ') }
  : { k: 'calc', title: `${names[x.h] ?? x.h} ב${names[x.c] ?? x.c} · קרנות נאמנות וסל`, value: pctTxt(x.pct, 2), formula: 'יחידות המוחזקות בקרנות המנהל ÷ הון מונפק ונפרע × 100',
      inputs: x.parts.map((p) => ({ label: `${p.name ?? 'מנהל'} · ${p.funds ?? 0} קרנות`, v: pctTxt(p.cap, 3) })),
      note: `החזקות קרנות לפי הדוח החודשי ${monthLabel(x.date)} (MAYA). גמל, פנסיה ונוסטרו מתחת לסף בעל עניין אינם מדווחים לפי חברה.` };
