/** The unified metric registry (peers/registry.json, built by pipeline/build_registry.py) and the value engine on top of it:
 *  any metric × any company × Q / H / FY / LTM, with every figure's provenance. Derived figures (H from quarters, LTM, Q4 from FY)
 *  are computed only where the metric is additive (a flow); balances are read at the period end; rates are never summed. */
import { useEffect, useMemo, useState } from 'react';
import { nf, sn } from './format';
import { KPI_CONCEPTS } from './kpi';
import type { Prov } from './prov';
import { load, useLoad } from './useData';

export type Unit = 'm' | 'bn' | 'pct' | 'nis' | 'x';
export type Kind = 'f' | 's' | 'r';
export type Freq = 'Q' | 'H' | 'FY' | 'LTM';
export interface MetricDef { id: string; l: string; g: string; src: string; u: Unit; k: Kind; f: string; n: number; r: [string, string]; e: number[]; nt?: number; br?: { p: string; m: string; nt: string }[]; std?: string }
export interface Entity { id: string; n: string; sh?: string; k: 'ins' | 'fund'; mg?: string | null }
export interface PeerSet { id: string; n: string; ids: string[]; own?: boolean }
export interface Registry { asof: string; entities: Entity[]; sets: PeerSet[]; groups: [string, string][]; src: Record<string, string>; metrics: MetricDef[]; notes: string[]; reg: { p0: number; groups: string[] } }
/** period, value, page, url index, flags, aux (MAYA report id for XBRL, regulator month index) */
export type Cell = [string, number, number | null, number | null, number, number?];
interface MetricFile { u: string[]; e: Record<string, { c: Cell[]; l?: string; b?: string; sid?: string }> }

export const F_DER = 1, F_OLD = 2, F_TURN = 4, F_RE = 8, F_CHART = 16, F_FIXED = 32, F_CMP = 64;
export const UNIT_HE: Record<Unit, string> = { m: 'מיליוני ש"ח', bn: 'מיליארדי ש"ח', pct: '%', nis: 'ש"ח', x: '×' };
export const FREQS: [Freq, string][] = [['Q', 'Q'], ['H', 'H'], ['FY', 'FY'], ['LTM', 'LTM']];
const BASIS_HE: Record<string, string> = { net: 'בשייר', gross: 'ברוטו', reinsurance: 'ביטוח משנה' };

export const usePeerRegistry = () => useLoad<Registry>('peers/registry.json');

/* ---------- periods ---------- */
const Y = (p: string) => Number(p.slice(0, 4));
/** the period on the axis of a frequency that contains a quarter key (2026Q2 → H1 2026, FY 2026) */
export function axisOf(freq: Freq, q: string): string {
  if (freq === 'Q' || freq === 'LTM') return q;
  if (freq === 'FY') return `${Y(q)}FY`;
  return `${Y(q)}${Number(q.slice(5)) <= 2 ? 'H1' : 'H2'}`;
}
/** k steps back on the axis of a frequency */
export function back(freq: Freq, p: string, k: number): string {
  if (freq === 'FY') return `${Y(p) - k}FY`;
  if (freq === 'H') { const n = Y(p) * 2 + (p.endsWith('H2') ? 1 : 0) - k; return `${Math.floor(n / 2)}H${(n % 2) + 1}`; }
  const n = Y(p) * 4 + Number(p.slice(5)) - 1 - k;
  return `${Math.floor(n / 4)}Q${(n % 4) + 1}`;
}
/** the same period one year earlier */
export const yearAgo = (freq: Freq, p: string) => back(freq, p, freq === 'FY' ? 1 : freq === 'H' ? 2 : 4);
/** steps per year on the axis */
export const perYear = (freq: Freq) => (freq === 'FY' ? 1 : freq === 'H' ? 2 : 4);
export function plab(freq: Freq, p: string): string {
  const y = p.slice(2, 4);
  if (freq === 'FY' || p.endsWith('FY')) return `FY'${y}`;
  if (freq === 'H' || /H\d$/.test(p)) return `${p.slice(4)}'${y}`;
  return `${freq === 'LTM' ? 'LTM ' : ''}Q${p.slice(5)}'${y}`;
}
const cellLab = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
/** sort key for raw period keys */
export const pord = (p: string) => Y(p) * 10 + ({ Q1: 1, Q2: 2, H1: 2.5, Q3: 3, Q4: 4, H2: 4.5, FY: 4.8 } as Record<string, number>)[p.slice(4)];

/* ---------- formatting ---------- */
export function fmtV(u: Unit, v: number): string {
  const a = Math.abs(v);
  switch (u) {
    case 'm': return nf(v, a < 100 ? 1 : 0);
    case 'bn': return nf(v, a < 10 ? 2 : 1);
    case 'pct': return nf(v, a < 0.1 && a > 0 ? 3 : a < 1 ? 2 : 1) + '%';
    case 'nis': return nf(v, 2);
    case 'x': return nf(v, 2) + '×';
  }
}
export const fmtChg = (pts: boolean, v: number) => (pts ? `${sn(v, 1)} נק׳` : `${sn(v, 1)}%`);

/* ---------- the engine ---------- */
export interface Val { v: number | null; prov: () => Prov; fl: number; why?: string; href?: string }
const none = (title: string, why: string): Val => ({ v: null, fl: 0, why, prov: () => ({ k: 'none', title, why }) });
const SET_ID: Record<string, string> = { all: 'all', pension: 'fam:pension', gemel: 'fam:gemel', insurance: 'fam:insurance' };
type LtsProv = { entity?: string; urls: Record<string, string | null>; parts: [string, number | null, string, number, string, string, string][]; facts: Record<string, [string, number[]]> };
const ltsProv = new Map<string, LtsProv | null | false>();
/** the managing companies' printed components behind LTS figures: fetched when an LTS column is on screen */
export function warmLts(sids: string[]) {
  sids.forEach((c) => { if (ltsProv.has(c)) return; ltsProv.set(c, null); void load<LtsProv>(`lts_prov/${c}.json`).then((j) => ltsProv.set(c, j), () => ltsProv.set(c, false)); });
}

export class Book {
  private idx = new Map<string, Map<string, Cell>>();
  readonly byId: Map<string, MetricDef>;
  readonly ent: Map<string, Entity>;
  constructor(readonly reg: Registry, readonly files: Map<string, MetricFile>) {
    this.byId = new Map(reg.metrics.map((m) => [m.id, m]));
    this.ent = new Map(reg.entities.map((e) => [e.id, e]));
  }
  name = (id: string) => this.ent.get(id)?.n ?? id;
  short = (id: string) => this.ent.get(id)?.sh ?? this.ent.get(id)?.n ?? id;
  has(mid: string) { const m = this.byId.get(mid); return !!m && this.files.has(m.f); }
  meta(mid: string, ent: string) { const m = this.byId.get(mid); return m ? this.files.get(m.f)?.e[ent] : undefined; }
  raw(mid: string, ent: string, p: string): Cell | undefined {
    const m = this.byId.get(mid);
    if (!m) return undefined;
    const k = `${m.f}|${ent}`;
    let ix = this.idx.get(k);
    if (!ix) { ix = new Map((this.files.get(m.f)?.e[ent]?.c ?? []).map((c) => [c[0], c])); if (this.files.has(m.f)) this.idx.set(k, ix); }
    return ix.get(p);
  }
  /** every raw period key of a metric, oldest first */
  periods(mid: string): string[] {
    const m = this.byId.get(mid), f = m && this.files.get(m.f);
    if (!f) return [];
    return [...new Set(Object.values(f.e).flatMap((e) => e.c.map((c) => c[0])))].sort((a, b) => pord(a) - pord(b));
  }
  /** the latest period on a frequency's axis for which any of `ents` has a value */
  latest(mid: string, freq: Freq, ents: string[]): string | null {
    const ps = this.periods(mid).filter((p) => /Q\d$/.test(p) || (freq === 'FY' && p.endsWith('FY')) || (freq === 'H' && /H\d$/.test(p)));
    for (let i = ps.length - 1; i >= 0; i--) {
      const ax = freq === 'FY' && !ps[i].endsWith('FY') ? (ps[i].endsWith('Q4') ? `${Y(ps[i])}FY` : null) : freq === 'H' && /Q\d$/.test(ps[i]) ? (/Q[24]$/.test(ps[i]) ? axisOf('H', ps[i]) : null) : ps[i];
      if (ax && ents.some((e) => this.get(mid, e, freq, ax).v != null)) return ax;
    }
    return null;
  }

  private unit(m: MetricDef) { return UNIT_HE[m.u]; }
  /** the source of one stored figure */
  private cellProv(m: MetricDef, ent: string, c: Cell, title: string): Prov {
    const f = this.files.get(m.f)!, meta = f.e[ent], value = fmtV(m.u, c[1]), period = cellLab(c[0]);
    if (m.src === 'reg') {
      const [key, set] = m.id.slice(4).split('@'), g = this.reg.reg.groups.indexOf(this.ent.get(ent)?.mg ?? '');
      const w = m.k === 'f' ? (/Q\d$/.test(c[0]) ? 'q' : 'ytd') : 'm';
      if (g < 0 || c[5] == null) return { k: 'none', title, why: 'הקבוצה אינה בקובצי הרגולטור' };
      return { k: 'reg', metric: key as Extract<Prov, { k: 'reg' }>['metric'], pi: c[5], w, set: SET_ID[set] ?? 'all', g };
    }
    if (m.src === 'xbrl' && c[2] == null) {
      const key = m.id.slice(5);
      return { k: 'xbrl', title, value: `${value} ${this.unit(m)}`, company: this.name(ent), period, rid: c[5] ?? null, concept: KPI_CONCEPTS[key] ?? key, status: c[4] & F_FIXED ? 'תוקן מול הדוח' : undefined };
    }
    if (m.src === 'lts') {
      const sid = meta?.sid ?? ent, pr = ltsProv.get(sid), key = ltsKey(m, c[0]), fct = pr ? pr.facts[`${m.id.slice(4)}|${key}`] : undefined;
      if (!pr || !fct) return { k: 'none', title, why: pr === undefined || pr === null ? 'רכיבי החישוב נטענים, נסו שוב בעוד רגע' : 'לנתון זה לא נרשם מקור מפורט' };
      return { k: 'calc', title, value, unit: this.unit(m), formula: fct[0], note: pr.entity ?? 'דוחות החברה המנהלת',
        inputs: fct[1].slice(0, 40).map((i: number) => { const [file, pg, label, val, u, date, win] = pr.parts[i], url = pr.urls[file] ?? null, show = nf(val, Math.abs(val) < 100 ? 2 : 0);
          return { label: `${label} · ${date}${win && win !== 'instant' ? ` · ${win}` : ''}`, v: `${show} ${u.replace(/NIS thousands?/, 'אלפי ש"ח').replace('NIS millions', 'מיליוני ש"ח')}`,
            src: file ? () => ({ k: 'report', title: label, value: show, unit: u, url, pg, doc: `${file.startsWith('ic:') ? 'דוח חברת הביטוח' : pr.entity ?? this.name(ent)}, ${file.replace('ic:', '')}`, period: date }) as Prov : undefined }; }) };
    }
    const notes = [meta?.l ? `שורה בדוח: ${meta.l}` : '', meta?.b && BASIS_HE[meta.b] ? BASIS_HE[meta.b] : '', c[4] & F_CMP ? 'מעמודת ההשוואה בדוח מאוחר יותר (עשוי להיות מוצג מחדש)' : '', c[4] & F_RE ? 'הוצג מחדש' : '', c[4] & F_CHART ? 'נקרא מגרף או מטקסט בדוח' : '', typeof c[5] === 'string' ? c[5] : ''];
    return { k: 'report', title, value, unit: this.unit(m), url: c[3] != null ? f.u[c[3]] : null, pg: c[2], doc: this.name(ent), period, note: notes.filter(Boolean).join(' · ') || undefined,
      der: c[4] & F_DER ? true : undefined, old: c[4] & F_OLD ? true : undefined, turned: c[4] & F_TURN ? true : undefined };
  }
  private stored(m: MetricDef, ent: string, p: string, title: string): Val | null {
    const c = this.raw(m.id, ent, p);
    if (!c) return null;
    const u = c[3] != null && m.src !== 'reg' && m.src !== 'lts' ? this.files.get(m.f)!.u[c[3]] : null;
    return { v: c[1], fl: c[4], prov: () => this.cellProv(m, ent, c, title), href: u ? (c[2] ? `${u}#page=${c[2]}` : u) : undefined };
  }
  private sum(m: MetricDef, title: string, formula: string, parts: [string, Val][]): Val {
    if (parts.some(([, x]) => x.v == null)) return none(title, `חסר רכיב: ${parts.filter(([, x]) => x.v == null).map(([l]) => l).join(', ')}`);
    if (mixed(parts)) return none(title, 'הרכיבים חוצים את המעבר מ-IFRS 4 ל-IFRS 17: סכום של שני תקנים אינו מוצג');
    const v = parts.reduce((s, [, x]) => s + x.v!, 0);
    const fl = parts.reduce((s, [, x]) => s | x.fl, 0) | F_DER;
    return { v, fl, prov: () => ({ k: 'calc', title, value: fmtV(m.u, v), unit: this.unit(m), formula, inputs: parts.map(([l, x]) => ({ label: l, v: fmtV(m.u, x.v!), src: x.prov })) }) };
  }
  /** a single quarter */
  private quarter(m: MetricDef, ent: string, q: string, title: string): Val {
    const s = this.stored(m, ent, q, title);
    if (s || m.k !== 'f') return s ?? none(title, 'אין נתון לרבעון זה');
    const y = Y(q), n = Number(q.slice(5)), L = (x: string) => cellLab(x);
    const st = (p: string) => this.stored(m, ent, p, `${m.l} · ${this.name(ent)} · ${L(p)}`);
    if (n === 4) {
      const fy = st(`${y}FY`), h2 = st(`${y}H2`), q3 = st(`${y}Q3`);
      if (h2 && q3) return this.diff(m, title, `Q4 = H2 − Q3`, [[`H2'${String(y).slice(2)}`, h2], [`Q3'${String(y).slice(2)}`, q3]]);
      const qs = [1, 2, 3].map((k) => st(`${y}Q${k}`));
      if (fy && qs.every(Boolean)) return this.diff(m, title, `Q4 = FY − Q1 − Q2 − Q3`, [[`FY'${String(y).slice(2)}`, fy], ...qs.map((x, k) => [`Q${k + 1}'${String(y).slice(2)}`, x!] as [string, Val])]);
    }
    if (n === 2) { const h1 = st(`${y}H1`), q1 = st(`${y}Q1`); if (h1 && q1) return this.diff(m, title, 'Q2 = H1 − Q1', [[`H1'${String(y).slice(2)}`, h1], [`Q1'${String(y).slice(2)}`, q1]]); }
    return none(title, 'אין נתון לרבעון זה');
  }
  private diff(m: MetricDef, title: string, formula: string, parts: [string, Val][]): Val {
    if (mixed(parts)) return none(title, 'הרכיבים חוצים את המעבר מ-IFRS 4 ל-IFRS 17');
    const v = parts[0][1].v! - parts.slice(1).reduce((s, [, x]) => s + x.v!, 0), fl = parts.reduce((s, [, x]) => s | x.fl, 0) | F_DER;
    return { v, fl, prov: () => ({ k: 'calc', title, value: fmtV(m.u, v), unit: this.unit(m), formula, inputs: parts.map(([l, x]) => ({ label: l, v: fmtV(m.u, x.v!), src: x.prov })) }) };
  }
  /** a metric's value for a company on a frequency's axis */
  get(mid: string, ent: string, freq: Freq, p: string): Val {
    const m = this.byId.get(mid);
    const title = `${m?.l ?? mid} · ${this.name(ent)} · ${plab(freq, p)}`;
    if (!m) return none(title, 'מדד לא מוכר');
    if (!this.files.has(m.f)) return none(title, 'הנתונים נטענים');
    const y = Y(p), yy = String(y).slice(2);
    if (freq === 'Q') return this.quarter(m, ent, p, title);
    if (freq === 'LTM') {
      if (m.k === 's') return this.quarter(m, ent, p, title);
      if (p.endsWith('Q4')) { const fy = this.stored(m, ent, `${y}FY`, title); if (fy) return fy; }
      if (m.k === 'r') return none(title, 'יחס אינו מצטבר: LTM מוצג רק בסוף שנה, מהדוח השנתי');
      const qs = [3, 2, 1, 0].map((k) => back('Q', p, k));
      return this.sum(m, title, 'LTM = סכום ארבעת הרבעונים האחרונים', qs.map((q) => [cellLab(q), this.quarter(m, ent, q, `${m.l} · ${this.name(ent)} · ${cellLab(q)}`)]));
    }
    if (freq === 'FY') {
      if (m.k === 's') return this.quarter(m, ent, `${y}Q4`, title);
      const fy = this.stored(m, ent, `${y}FY`, title);
      if (fy || m.k === 'r') return fy ?? none(title, 'אין נתון שנתי');
      const h1 = this.stored(m, ent, `${y}H1`, title), h2 = this.stored(m, ent, `${y}H2`, title);
      if (h1 && h2) return this.sum(m, title, `FY = H1 + H2`, [[`H1'${yy}`, h1], [`H2'${yy}`, h2]]);
      return this.sum(m, title, 'FY = סכום ארבעת הרבעונים', [1, 2, 3, 4].map((k) => [`Q${k}'${yy}`, this.quarter(m, ent, `${y}Q${k}`, `${m.l} · ${this.name(ent)} · Q${k}'${yy}`)]));
    }
    // half years
    const h = p.endsWith('H1') ? 1 : 2;
    if (m.k === 's') return this.quarter(m, ent, `${y}Q${h * 2}`, title);
    const st = this.stored(m, ent, p, title);
    if (st || m.k === 'r') return st ?? none(title, 'אין נתון לחציון');
    if (h === 2) { const fy = this.stored(m, ent, `${y}FY`, title), h1 = this.get(mid, ent, 'H', `${y}H1`); if (fy && h1.v != null) return this.diff(m, title, 'H2 = FY − H1', [[`FY'${yy}`, fy], [`H1'${yy}`, h1]]); }
    const a = h * 2 - 1, b = h * 2;
    return this.sum(m, title, `H${h} = Q${a} + Q${b}`, [a, b].map((k) => [`Q${k}'${yy}`, this.quarter(m, ent, `${y}Q${k}`, `${m.l} · ${this.name(ent)} · Q${k}'${yy}`)]));
  }
  /** a definition break of the metric between two axis periods (regulator break, or IFRS 4 against IFRS 17 figures) */
  breakBetween(mid: string, freq: Freq, a: Val, b: Val, pa: string, pb: string): string | null {
    const m = this.byId.get(mid);
    if (!m) return null;
    if (((a.fl ^ b.fl) & F_OLD) !== 0) return 'IFRS 4 מול IFRS 17: הגדרה שונה משני צדי המעבר';
    const lo = pord(pa < pb ? pa : pb), hi = pord(pa < pb ? pb : pa);
    const br = m.br?.find((x) => pord(x.p) > lo && pord(x.p) <= hi + (freq === 'FY' ? 0.9 : 0));
    return br ? `${br.nt} · ${br.m}` : null;
  }
}
/** some parts reported under IFRS 4 and some under IFRS 17 */
const mixed = (parts: [string, Val][]) => { const o = parts.filter(([, x]) => x.fl & F_OLD).length; return o > 0 && o < parts.length; };
function ltsKey(m: MetricDef, p: string): string {
  const y = p.slice(0, 4);
  if (p.endsWith('FY')) return `FY${y}`;
  if (p.endsWith('H1')) return `H1-${y}`;
  return m.k === 's' ? `${y}-${String(Number(p.slice(5)) * 3).padStart(2, '0')}` : `${p.slice(4)}-${y}`;
}

/** Loads the metric files a view needs (each a few KB) and returns the engine over what has arrived. */
export function useBook(reg: Registry | null, mids: string[]): { book: Book | null; pending: number } {
  const [files, setFiles] = useState<Map<string, MetricFile>>(new Map());
  const need = useMemo(() => {
    if (!reg) return [] as string[];
    const by = new Map(reg.metrics.map((m) => [m.id, m.f]));
    return [...new Set(mids.map((id) => by.get(id)).filter((f): f is string => !!f))].sort();
  }, [reg, mids.join('|')]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    need.filter((f) => !files.has(f)).forEach((f) => load<MetricFile>(`peers/m/${f}.json`).then((d) => live && setFiles((cur) => (cur.has(f) ? cur : new Map(cur).set(f, d))), () => {}));
    return () => { live = false; };
  }, [need.join('|')]);  // eslint-disable-line react-hooks/exhaustive-deps
  const book = useMemo(() => (reg ? new Book(reg, files) : null), [reg, files]);
  return { book, pending: need.filter((f) => !files.has(f)).length };
}
