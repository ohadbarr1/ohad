/* P3 (fox 3.0 phase 1): the monthly flows letter (pipeline/build_flows_letter.py): flows/letters/<yyyymm>.json (current version),
   <yyyymm>.v<n>.json (a superseded version, frozen), index.json (every letter and its feed event). The provenance of a figure: a cell
   opens the tracks behind it (lib/flows.ts cellProv on the month file), a sum across products opens each product's cell. */
import type { Prov } from './prov';
import { nf } from './format';
import { cellProv, ym, type Field, type FlowsIndex, type FlowsMonth, type FlowsProd, type MRow } from './flows';

export const LETTERS = 'flows/letters';
export const letterIndexPath = `${LETTERS}/index.json`;
export const letterPath = (p: number, v?: number) => `${LETTERS}/${p}${v ? `.v${v}` : ''}.json`;

export type LF = 'a' | 'tr' | 'comp' | 'dt' | 'cl' | 'mig' | 'org' | 'net' | 'dep' | 'wd';
export interface LGroup extends Partial<Record<LF, number | null>> { grp: string; rk: number | null; since?: number }
export interface LSide { grp: string; comp: number; tr: number | null; since?: number }
export interface LProd { id: string; label: string; tot: Partial<Record<LF, number | null>>; groups: LGroup[]; top: LSide | null; low: LSide | null }
export interface LAcross { grp: string; tr: number; comp: number; dt: number; cl: number; mig: number; org: number; net: number; in: { comp: [string, number][]; tr: [string, number][] } }
export interface LUnderRow { k: string; name: string; grp: string; cat: string; a: number; r5: number; med: number; pct: number; gap: number; cost: number; nd12: number; c12: number; mig: 0 | 1 }
export interface LUnder { asof: number; n: number; a: number; cost: number; fl: number; icost: number; n_rk: number; n_cat: number; bq: number; win: number; src: string; past: string; top: LUnderRow[];
  yoy?: { p: number; n: number; cost: number; fl: number } }
export interface LBody {
  p: number; received: string | null; src: string; src_short: string; headline: string[]; winner: LAcross; loser: LAcross | null; across: LAcross[];
  total: { tr: number; comp: number; dt: number; cl: number; mig: number; org: number; net: number; a: number; in: Record<'tr' | 'comp' | 'dt' | 'cl' | 'mig', [string, number][]> };
  prods: LProd[]; tenders: { label: string; from: number; to: number; winners: string[] }[]; under: LUnder | null;
  defs: { fox: { k: string; he: string; def: string }[]; compare: string[] }; method: Record<string, string>; coverage: Record<string, string>;
  figs: Record<string, [string, number | null]>;
}
export interface LVersion { ver: number; built: string; hash: string; changes: { k: string; l: string; a: number | null; b: number | null }[] }
export interface Letter { v: number; p: number; ver: number; built: string; hash: string; permalink: string; versions: LVersion[]; body: LBody }
export interface LetterIndex { v: number; latest: number; letters: { p: number; ver: number; built: string; first: string; hash: string; h: string }[]; events: unknown[] }

/** "2026-11-05" -> "05.11.26" */
export const dmy = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : '–');
export const sgn = (v: number | null | undefined, d = 0) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), d)}`);
/** the field names, in Hebrew (build_flows_letter.FIG_HE) */
export const FIG_HE: Record<string, string> = { tr: 'ניוד נטו', comp: 'ניוד תחרותי', dt: 'לקרנות ברירת מחדל', cl: 'סגירת מסלולים', mig: 'נדידה פנימית', org: 'צבירה אורגנית', net: 'צבירה נטו' };

/** the month's cell of one product as a one-month FlowsProd, so lib/flows.ts cellProv opens it (and its tracks, from the month file) */
export function prodOf(b: LBody, id: string): FlowsProd | null {
  const x = b.prods.find((q) => q.id === id);
  if (!x) return null;
  const S = (o: object) => Object.fromEntries(Object.entries(o as Record<string, number | null>).filter(([k]) => k !== 'grp' && k !== 'since').map(([k, v]) => [k, [v ?? null]]));
  return { v: 1, id, label: x.label, asof: b.p, flows: true, months: [b.p], groups: Object.fromEntries(x.groups.map((g) => [g.grp, S(g)])), tot: S(x.tot) };
}

export class LetterSrc {
  constructor(readonly L: Letter, readonly month: FlowsMonth | null, readonly name: (k: string) => string) {}
  get b() { return this.L.body; }
  /** a cell: group (or 'tot') x product x field, opening its tracks */
  cell(pid: string, grp: string, f: Field, value: number | null): Prov {
    const prod = prodOf(this.b, pid);
    if (!prod) return { k: 'none', title: `${pid} · ${grp}`, why: 'המוצר אינו במכתב' };
    const M = this.month && this.month.p === this.b.p ? this.month : null;
    const rows: MRow[] | null = M ? (M.g[pid]?.[grp] ?? (grp === 'tot' ? Object.values(M.g[pid] ?? {}).flat() : [])) : null;
    const idx = { method: this.b.method } as unknown as FlowsIndex;
    return cellProv({ idx, prod, grp, p: this.b.p, f, value, rows, name: this.name });
  }
  /** a group's sum across the products of the letter: each product's cell */
  across(r: LAcross, f: 'comp' | 'tr' | 'dt' | 'cl' | 'mig' | 'org' | 'net'): Prov {
    const parts = this.b.prods.map((x) => [x, x.groups.find((g) => g.grp === r.grp)] as const).filter(([, g]) => g && g[f] != null);
    return { k: 'calc', title: `${FIG_HE[f] ?? f} · ${r.grp} · כל מוצרי הגמל והפנסיה · ${ym(this.b.p)}`, value: sgn(r[f], 1), unit: 'מיליוני ש"ח',
      formula: `סכום התאים של הקבוצה בכל מוצר שהרשות מפרסמת לו תזרימים. ${this.b.method[f] ?? ''}`,
      inputs: parts.map(([x, g]) => ({ label: x.label, v: nf(g![f]!, 1), src: () => this.cell(x.id, r.grp, f as Field, g![f]!) })) };
  }
  /** the industry total of a field: each product's total */
  total(f: 'comp' | 'tr' | 'dt' | 'cl' | 'mig'): Prov {
    return { k: 'calc', title: `${FIG_HE[f]} · כל הגופים · כל מוצרי הגמל והפנסיה · ${ym(this.b.p)}`, value: sgn(this.b.total[f], 1), unit: 'מיליוני ש"ח',
      formula: `סכום סך המוצר בכל מוצר. ${this.b.method[f] ?? ''}`,
      inputs: this.b.total.in[f].map(([pid, v]) => ({ label: this.b.prods.find((x) => x.id === pid)?.label ?? pid, v: nf(v, 1), src: () => this.cell(pid, 'tot', f as Field, v) })) };
  }
}

/** the citation line: fox's name, the letter, the version and its build day, the source, the permalink */
export const citeOf = (L: Letter, ver: number, built: string) => ({
  text: `fox, מכתב התזרימים ${ym(L.p)}, גרסה ${ver} (${dmy(built)}), על בסיס נתוני רשות שוק ההון (גמל-נט, פנסיה-נט).`,
  url: `fox-research-il.web.app/flows/letter/${L.p}?v=${ver}`,
});
