/* The fact table with vintage (pipeline/build_facts.py → data/facts/<id>.json, docs/FACTS.md).
   One row per (line instance, period, vintage): every figure of a company workbook with every report that printed it.
   A vintage policy picks one row per cell: 'latest' (the figure the site shows), 'original' (the first print) or 'asof:YYYY-MM-DD'
   (the latest print published by that day; a derived quarter is recomputed within that vintage). Files load per company, on demand. */
import { useEffect, useState } from 'react';
import { load } from './useData';
import { periodLabel, pubLabel } from './format';
import { readerHref } from './search';

/** row flags (build_facts.py) */
export const FL = { DER: 1, IFRS4: 2, TURNED: 4, RESTATED: 8, CUR: 16, FIRST: 32, ODD: 64, CMP: 128 } as const;
export type Policy = 'latest' | 'original' | `asof:${string}`;
type In = number | (number | null)[];

export interface FactsFile {
  v: number; company: string; name: string; workbook: string;
  periods: [string, string][];
  vint: { rid: (number | null)[]; per: (string | null)[]; pub: (string | null)[]; u: (number | null)[] };
  urls: string[]; sheets: string[];
  lines: { id: string[]; mi: number[]; sh: number[]; ent: string[]; std: ('17' | '4' | '')[]; dim: string[]; label: string[]; u: string[]; o: (-1 | 0 | 1)[]; n: number[] };
  rows: { p: number[]; t: number[]; v: number[]; pg: (number | null)[]; f: number[] };
  der: [number, 'FY-9M' | 'FY-H1', In, In][];
  alt?: [number, number][];
}
export interface TaxonomyFile {
  v: number; stmt: Record<string, string>; block: Record<string, string>; cols: string[];
  /** id → [label, stmt, block, tier, unit, nature, tadd, sadd, std, bridge [to, kind] | null, companies] */
  lines: Record<string, [string, string, string, 'core' | 'shared' | 'own', string, string, 0 | 1, 0 | 1, string, [string | null, string] | null, number]>;
}
export interface Vintage { i: number; rid: number | null; per: string | null; pub: string | null; url: string | null }
export interface Line { i: number; id: string; mi: number; sheet: string; ent: string; std: '17' | '4' | ''; dim: string; label: string; unit: string; o: -1 | 0 | 1; start: number; end: number }
export interface Fact {
  /** row index in the file (-1 for a figure computed here: a derived quarter of an as-of vintage) */
  k: number; line: Line; p: number; t: number; v: number; pg: number | null; f: number;
  der?: { op: 'FY-9M' | 'FY-H1'; a: Fact | number | null; b: Fact | number | null };
}

/** half of each print's rounding step plus half the finer one (the rule of build_workbook.py and build_restatements.py) */
function step(v: number, unit: string): number {
  if (unit === 'nis') return 0.01;
  if (unit === 'pct') return Math.round(v * 10) === v * 10 ? 0.1 : 0.01;
  if (unit === 'shares') return v % 1000 === 0 ? 1000 : 1;
  return v % 1000 === 0 ? 1000 : 1;
}
export function sameFigure(a: number, b: number, unit: string): boolean {
  const sa = step(a, unit), sb = step(b, unit), tol = 0.5 * (sa + sb) + 0.5 * Math.min(sa, sb);
  return Math.abs(a - b) <= tol;
}

export class Facts {
  readonly lines: Line[] = [];
  readonly vint: Vintage[];
  readonly byMi = new Map<number, Line>();
  readonly byId = new Map<string, Line[]>();
  private readonly derOf = new Map<number, [string, In, In]>();
  private readonly altOf = new Map<number, number[]>();
  private readonly periodIdx = new Map<string, number>();

  constructor(readonly d: FactsFile) {
    const L = d.lines;
    let start = 0;
    L.id.forEach((id, i) => {
      const line: Line = { i, id, mi: L.mi[i], sheet: d.sheets[L.sh[i]], ent: L.ent[i], std: L.std[i], dim: L.dim[i], label: L.label[i], unit: L.u[i], o: L.o[i], start, end: start + L.n[i] };
      start += L.n[i];
      this.lines.push(line);
      this.byMi.set(line.mi, line);
      const arr = this.byId.get(id) ?? []; arr.push(line); this.byId.set(id, arr);
    });
    this.vint = d.vint.rid.map((rid, i) => ({ i, rid, per: d.vint.per[i], pub: d.vint.pub[i], url: d.vint.u[i] != null ? d.urls[d.vint.u[i]!] : null }));
    d.der.forEach(([k, op, a, b]) => this.derOf.set(k, [op, a, b]));
    (d.alt ?? []).forEach(([k, pg]) => { const a = this.altOf.get(k) ?? []; a.push(pg); this.altOf.set(k, a); });
    d.periods.forEach(([t, e], i) => this.periodIdx.set(`${t}${e}`, i));
  }

  get company(): string { return this.d.company; }
  period(p: number): [string, string] { return this.d.periods[p]; }
  periodIndex(type: string, end: string): number { return this.periodIdx.get(`${type}${end}`) ?? -1; }
  plabel(p: number): string { const [t, e] = this.d.periods[p]; return periodLabel(t, e); }
  /** the day a vintage counts from: its publication date; for the one report without a known date, the end of the period it reports
   *  (earlier than the true publication, so an as-of view may show that report a few weeks early) */
  vdate(t: number): string { const x = this.vint[t]; return x.pub ?? (x.per ? perEnd(x.per) : '9999-12-31'); }
  vlabel(t: number): string {
    const x = this.vint[t];
    const per = x.per ? (x.per.endsWith('FY') ? `FY'${x.per.slice(2, 4)}` : `${x.per.slice(4)}'${x.per.slice(2, 4)}`) : 'דוח';
    return x.pub ? `${per} · ${pubLabel(x.pub)}` : per;
  }

  private row(k: number, line: Line): Fact {
    const R = this.d.rows;
    const f: Fact = { k, line, p: R.p[k], t: R.t[k], v: R.v[k], pg: R.pg[k], f: R.f[k] };
    const der = this.derOf.get(k);
    if (der) {
      const at = (x: In): Fact | number | null => (typeof x === 'number' ? this.row(x, line) : x[0]);
      f.der = { op: der[0] as 'FY-9M' | 'FY-H1', a: at(der[1]), b: at(der[2]) };
    }
    return f;
  }
  /** every row of a line, in period then vintage order */
  rowsOf(line: Line): Fact[] { const out: Fact[] = []; for (let k = line.start; k < line.end; k++) out.push(this.row(k, line)); return out; }
  /** every print of one cell, oldest report first (rows that are not plausibly the same line are left out unless asked) */
  prints(line: Line, p: number, withOdd = false): Fact[] {
    return this.rowsOf(line).filter((r) => r.p === p && (withOdd || !(r.f & FL.ODD)));
  }
  /** other pages of the same report that print the same figure */
  altPages(k: number): number[] { return this.altOf.get(k) ?? []; }

  /** the figure of one cell under a vintage policy; null when the policy has no figure (not yet published as of that day) */
  cell(line: Line, p: number, policy: Policy = 'latest'): Fact | null {
    const rows = this.prints(line, p);
    if (!rows.length) return null;
    if (policy === 'latest') return rows.find((r) => r.f & FL.CUR) ?? null;
    if (policy === 'original') return rows.find((r) => r.f & FL.FIRST) ?? rows.find((r) => r.f & FL.CUR) ?? null;
    const day = policy.slice(5);
    const cur = rows.find((r) => r.f & FL.CUR);
    if (cur?.der) {  // a derived quarter: the year less the part, both as known on that day
      const [t, e] = this.d.periods[p];
      const part = cur.der.op === 'FY-9M' ? '9M' : 'H';
      const yi = this.periodIndex('FY', e), pi = this.periodIndex(part, `${e.slice(0, 4)}-${part === '9M' ? '09-30' : '06-30'}`);
      const fy = yi >= 0 ? this.cell(line, yi, policy) : null, pt = pi >= 0 ? this.cell(line, pi, policy) : null;
      if (!fy || !pt) return null;
      void t;
      return { k: -1, line, p, t: Math.max(fy.t, pt.t), v: Math.round((fy.v - pt.v) * 1000) / 1000, pg: fy.pg, f: FL.DER | (fy.f & (FL.IFRS4 | FL.TURNED)), der: { op: cur.der.op, a: fy, b: pt } };
    }
    const known = rows.filter((r) => !r.der && this.vdate(r.t) <= day);
    return known.length ? known[known.length - 1] : null;
  }
  /** all cells of a line under a policy: period index → fact */
  cells(line: Line, policy: Policy = 'latest'): Map<number, Fact> {
    const out = new Map<number, Fact>();
    const ps = new Set<number>();
    for (let k = line.start; k < line.end; k++) ps.add(this.d.rows.p[k]);
    ps.forEach((p) => { const c = this.cell(line, p, policy); if (c) out.set(p, c); });
    return out;
  }
  /** first print against the current figure, when they differ beyond rounding (a change of sign alone is presentation, not counted) */
  diff(line: Line, p: number): { first: Fact; cur: Fact } | null {
    const first = this.cell(line, p, 'original'), cur = this.cell(line, p, 'latest');
    if (!first || !cur || first.k === cur.k || first.k < 0) return null;
    if (sameFigure(first.v, cur.v, line.unit) || sameFigure(-first.v, cur.v, line.unit)) return null;
    return { first, cur };
  }
  /** the lines of one taxonomy id (several when the id runs through IFRS 4 and IFRS 17 blocks or several sheets) */
  line(id: string, opts: { std?: '17' | '4'; sheet?: string; dim?: string } = {}): Line | null {
    return (this.byId.get(id) ?? []).find((l) => (!opts.std || l.std === opts.std || !l.std) && (!opts.sheet || l.sheet === opts.sheet) && (opts.dim == null || l.dim === opts.dim)) ?? null;
  }
  /** the figures of a taxonomy line id: one per period of the window, oldest first */
  series(id: string, window: string, policy: Policy = 'latest', opts: { std?: '17' | '4'; sheet?: string; dim?: string } = {}): { p: number; label: string; fact: Fact }[] {
    const line = this.line(id, opts);
    if (!line) return [];
    return [...this.cells(line, policy)].filter(([p]) => this.d.periods[p][0] === window).sort((a, b) => a[0] - b[0]).map(([p, fact]) => ({ p, label: this.plabel(p), fact }));
  }
  /** the filed PDF at the page of a figure */
  pdf(f: Fact, page = f.pg): string | null { const u = this.vint[f.t]?.url; return u ? (page ? `${u}#page=${page}` : u) : null; }
  /** the in-app reader at the page (MAYA filings only) */
  reader(f: Fact, page = f.pg): string | null { const rid = this.vint[f.t]?.rid; return rid ? readerHref(rid, page) : null; }
}

const perEnd = (per: string): string => `${per.slice(0, 4)}-${per.endsWith('FY') ? '12-31' : ({ Q1: '03-31', Q2: '06-30', Q3: '09-30' } as Record<string, string>)[per.slice(4)] ?? '12-31'}`;

export function parsePolicy(s: string | null | undefined): Policy {
  if (s === 'o' || s === 'original') return 'original';
  if (s && /^asof:\d{4}-\d{2}-\d{2}$/.test(s)) return s as Policy;
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return `asof:${s}`;
  return 'latest';
}
/** the URL form of a policy (?vin=): '' for latest, 'o' for original, the date for as-of */
export const policyParam = (p: Policy): string => (p === 'latest' ? '' : p === 'original' ? 'o' : p.slice(5));
export const policyLabel = (p: Policy): string => (p === 'latest' ? 'מעודכן' : p === 'original' ? 'כפי שדווח לראשונה' : `נכון ל-${pubLabel(p.slice(5))}`);

const cache = new Map<string, Promise<Facts>>();
/** the fact table of one company (memoised; the file is fetched the first time it is asked for) */
export function loadFacts(id: string): Promise<Facts> {
  if (!cache.has(id)) cache.set(id, load<FactsFile>(`facts/${id}.json`).then((d) => new Facts(d)));
  return cache.get(id)!;
}
export const loadTaxonomy = () => load<TaxonomyFile>('facts/taxonomy.json');

/** the fact table of a company, loaded only while `enabled` (the toggle or a diff marker asked for it) */
export function useFacts(id: string | null, enabled = true): { facts: Facts | null; error: string | null } {
  const [s, set] = useState<{ facts: Facts | null; error: string | null }>({ facts: null, error: null });
  useEffect(() => {
    if (!id || !enabled) return;
    let live = true;
    loadFacts(id).then((facts) => live && set({ facts, error: null }), (e: Error) => live && set({ facts: null, error: e.message }));
    return () => { live = false; };
  }, [id, enabled]);
  return id && enabled ? s : { facts: null, error: null };
}
export function useTaxonomy(enabled = true): TaxonomyFile | null {
  const [t, set] = useState<TaxonomyFile | null>(null);
  useEffect(() => { if (enabled) loadTaxonomy().then(set, () => set(null)); }, [enabled]);
  return t;
}
