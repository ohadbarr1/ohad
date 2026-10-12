import type { IfrsData, IfrsFact } from './types';

/* The CSM lens shared by the industry page and the company component: one movement table ("bridge") per company, date and window,
   read from the facts of a single report, and the ratios built on it. Nothing here estimates: a line is either printed, or a sum or
   difference of printed lines that says so through its flags. */

/** A fact tagged with the report it was read from, so its page link opens the right PDF. */
export type RF = IfrsFact & { rp: string };
export type Win = 'q' | 'ytd' | 'fy';
export type ScopeId = 'group' | 'life_health' | 'lh' | 'life' | 'health';
export interface Line { v: number; fs: RF[]; /** life plus health, added here */ sum?: boolean; /** rows of one table added up */ n?: number }
export interface Step { k: string; m: string; label: string; line: Line }
export interface Bridge {
  end: string; w: Win; scope: ScopeId; b: string; /** how complete the table is; used to choose between candidates */ score: number;
  open: Line | null; /** the opening is the closing balance printed for the previous date */ openPrev: boolean;
  close: Line | null; steps: Step[]; /** closing less opening less every printed movement */ gap: number | null;
  /** built here as a difference of two cumulative tables (Q4 = FY less 9M) */ der?: boolean;
  /** read from a later report that reprints the period */ cmp?: boolean;
}

export const tag = (fs: IfrsFact[], rp: string): RF[] => fs.map((f) => ({ ...f, rp }));
export const hrefOf = (f: RF, d: IfrsData): string | null => {
  const u = f.u !== undefined ? f.u : d.files.find((x) => x.company === f.c && x.period === f.rp)?.url;
  return u && f.pg != null ? `${u}#page=${f.pg}` : null;
};
export const endOf = (p: string) => `${p.slice(0, 4)}-${({ Q1: '03-31', Q2: '06-30', Q3: '09-30', Q4: '12-31', FY: '12-31' } as Record<string, string>)[p.slice(4)]}`;
/** The balance date a window opens on: the previous quarter end, or the previous year end. */
export const startOf = (end: string, w: Win) => {
  const y = Number(end.slice(0, 4)), md = end.slice(5);
  return w === 'q' && md !== '03-31' ? `${y}-${({ '06-30': '03-31', '09-30': '06-30', '12-31': '09-30' } as Record<string, string>)[md]}` : `${y - 1}-12-31`;
};
export const monthsOf = (end: string, w: Win) => (w === 'q' ? 3 : w === 'fy' ? 12 : Number(end.slice(5, 7)));
export const periodName = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
export const prevQuarter = (p: string) => { const y = Number(p.slice(0, 4)), q = p.endsWith('FY') ? 4 : Number(p.slice(5)); return q === 1 ? `${y - 1}FY` : `${y}Q${q - 1}`; };

export const BASIS: Record<string, string> = { net: 'נטו', gross: 'ברוטו', reinsurance: 'ביטוח משנה', na: 'לא צוין' };
export const SCOPE_HE: Record<ScopeId, string> = { group: 'קבוצה', life_health: 'חיים ובריאות', lh: 'חיים ועוד בריאות', life: 'חיים וחיסכון', health: 'בריאות' };
/** The movements of the table, in the order they are read. Rows a filer adds under its own name (`csm_other:…`) are slotted in before the release. */
export const STEPS: [string, string, string][] = [
  ['nb', 'csm_new_business', 'עסק חדש'], ['int', 'csm_interest_accretion', 'צבירת ריבית'], ['est', 'csm_changes_in_estimates', 'שינויי אומדן'],
  ['econ', 'csm_economic_interest_and_other_effects', 'ריבית והשפעות כלכליות אחרות'], ['exp', 'csm_experience_adjustments', 'סטיות ניסיון'],
  ['fx', 'csm_fx_and_other', 'הפרשי שער ואחר'], ['spec', 'csm_special_events', 'אירועים מיוחדים'], ['rel', 'csm_release', 'שחרור לרווח'],
];
const CORE = ['nb', 'int', 'est', 'rel'];
const PARTS: Record<ScopeId, string[]> = { group: ['group'], life_health: ['life_health'], lh: ['life', 'health'], life: ['life'], health: ['health'] };
const usable = (f: RF) => f.m.startsWith('csm') && !f.tr && !f.model && !f.bk && !f.m.startsWith('csm_subtotal') && f.m !== 'csm_expected_release';
const isQ1 = (end: string) => end.endsWith('03-31');

/** One printed line of one segment: the row of the segment itself (or of its only sub-heading), the tied-out copy first; movements printed as several rows of one table are added. */
function pickLine(F: RF[], g: string, b: string, m: string, d: string, w: Win | null): Line | null {
  // the first quarter is printed once: its quarter and year-to-date columns are the same figure
  const ws = w == null ? ['instant'] : isQ1(d) && w !== 'fy' ? [w, w === 'q' ? 'ytd' : 'q'] : [w];
  for (const win of ws) {
    const c = F.filter((f) => f.g === g && f.b === b && f.m === m && f.d === d && f.w === win);
    const own = c.some((f) => f.s === g) ? c.filter((f) => f.s === g) : new Set(c.map((f) => f.s)).size === 1 ? c : [];
    if (!own.length) continue;
    const rank = (f: RF) => Number(f.inc === 1) * 8 + Number(f.dv == null) * 4 + Number(f.src === 'chart' || f.src === 'text') * 2;
    const p = [...own].sort((x, y) => rank(x) - rank(y) || (x.pg ?? 0) - (y.pg ?? 0))[0];
    if (w == null) return { v: p.dv ?? p.v, fs: [p] };
    const parts = p.dv != null ? own.filter((x) => x !== p && x.dv != null && x.pg === p.pg && x.l !== p.l) : [];
    const one = p.dv ?? (m === 'csm_release' ? -Math.abs(p.v) : p.v);
    return { v: one + parts.reduce((t, x) => t + x.dv!, 0), fs: [p, ...parts], n: parts.length + 1 };
  }
  return null;
}

/** Bases a company prints a closing CSM on at a date, for any segment. */
export const basesAt = (F: RF[], end: string) => ['net', 'gross', 'na', 'reinsurance'].filter((b) => F.some((f) => usable(f) && f.b === b && f.m === 'csm_closing' && f.d === end));

interface Opt { pref?: string; scope?: ScopeId; basis?: string; /** facts of the previous report, searched only for the opening balance */ prev?: RF[] }

/** The movement table of one company for a window ending at `end`. Without a forced scope the group line is taken when printed,
    then the combined life and health line, then life plus health added on one basis; a company that prints CSM for life only is shown as such. */
export function bridge(all: RF[], end: string, w: Win, o: Opt = {}): Bridge | null {
  const F = all.filter(usable), start = startOf(end, w);
  const others = (gs: string[], b: string) => [...new Set(F.filter((f) => gs.includes(f.g) && f.b === b && f.d === end && f.m.startsWith('csm_other:') && !f.m.startsWith('csm_other:Balance') && (f.w === w || (isQ1(end) && w !== 'fy' && f.w !== 'instant'))).map((f) => f.m))];
  const build = (scope: ScopeId, b: string) => {
    const gs = PARTS[scope];
    const get = (src: RF[], m: string, d: string, win: Win | null, both: boolean): Line | null => {
      const ls = gs.map((g) => pickLine(src, g, b, m, d, win));
      if (gs.length === 1) return ls[0];
      const have = ls.filter((l): l is Line => !!l);
      // balances and the four core movements need both segments; a row a filer adds to one segment's table only is taken as printed
      if (have.length === 0 || (both && have.length < gs.length)) return null;
      return { v: have.reduce((t, l) => t + l.v, 0), fs: have.flatMap((l) => l.fs), sum: true, n: Math.max(...have.map((l) => l.n ?? 1)) };
    };
    const close = get(F, 'csm_closing', end, null, true);
    let open = get(F, 'csm_opening', start, null, true), openPrev = false;
    if (!open) { open = get(F, 'csm_closing', start, null, true) ?? (o.prev ? get(o.prev.filter(usable), 'csm_closing', start, null, true) : null); openPrev = !!open; }
    const defs: [string, string, string][] = [...STEPS.slice(0, -1), ...others(gs, b).map((m): [string, string, string] => [m, m, m.slice(10)]), STEPS[STEPS.length - 1]];
    const steps = defs.map(([k, m, label]) => ({ k, m, label, line: get(F, m, end, w, CORE.includes(k)) })).filter((s): s is Step => !!s.line);
    const has = (k: string) => steps.some((s) => s.k === k);
    const tier = close && has('nb') && has('rel') ? 3 : close && has('rel') ? 2 : close ? 1 : has('rel') ? 0.5 : 0;
    const score = tier * 10 + Number(!!open) + Number(has('int') || has('econ')) + Number(has('est'));
    const gap = open && close && steps.length ? close.v - open.v - steps.reduce((t, s) => t + s.line.v, 0) : null;
    return { tier, score, br: { end, w, scope, b, score, open, openPrev, close, steps, gap } as Bridge };
  };
  const lifeOnly = !F.some((f) => f.g === 'health') && !F.some((f) => f.g === 'group') && !F.some((f) => f.g === 'life_health');
  const scopes: ScopeId[] = o.scope ? [o.scope] : lifeOnly ? ['life'] : ['group', 'life_health', 'lh'];
  const pref = o.pref ?? 'net';
  const bases = o.basis ? [o.basis] : [pref, ...['net', 'gross', 'na'].filter((b) => b !== pref)];
  const cands = bases.flatMap((b) => scopes.map((s) => build(s, b))).filter((c) => c.tier > 0);
  if (!cands.length) return null;
  // the basis asked for wins when it carries a closing balance and a release; otherwise the fullest table the report prints
  const mine = cands.filter((c) => c.br.b === bases[0] && c.tier >= 2).sort((x, y) => y.score - x.score)[0];
  return (mine ?? [...cands].sort((x, y) => y.score - x.score)[0]).br;
}

/** One company's extracted reports, oldest first. */
export type Reports = { p: string; F: RF[] }[];
/** The fullest table printed for a date across the company's reports: the report of the period itself first, then later reports that reprint it as a comparative column. */
export function best(rs: Reports, own: string, end: string, w: Win, o: Opt = {}): Bridge | null {
  const pool = rs.flatMap((r) => r.F);
  const order = [...rs.filter((r) => r.p === own), ...rs.filter((r) => r.p !== own)];
  // a table on the basis asked for, with a closing balance and a release, outranks a fuller table on another basis
  const want = o.basis ?? o.pref ?? 'net', key = (b: Bridge) => b.score + (b.b === want && b.score >= 20 ? 100 : 0);
  let top: Bridge | null = null;
  for (const r of order) { const b = bridge(r.F, end, w, { ...o, prev: pool }); if (b && (!top || key(b) > key(top))) top = r.p === own ? b : { ...b, cmp: true }; }
  return top;
}

/** A single quarter. Printed where a report has a quarter table; otherwise the difference of two year-to-date tables on the same scope and basis
    (the fourth quarter is always FY less nine months), and flagged as derived. */
export function quarter(rs: Reports, p: string, o: Opt = {}): Bridge | null {
  const end = endOf(p), annual = p.endsWith('FY'), before = prevQuarter(p);
  const q = annual ? null : best(rs, p, end, 'q', o);
  if (q && (q.steps.length > 0 || p.endsWith('Q1'))) return q;
  const tot = best(rs, p, end, annual ? 'fy' : 'ytd', o);
  const sub = tot ? best(rs, before, endOf(before), 'ytd', { ...o, scope: tot.scope, basis: tot.b }) : null;
  // no second table to subtract: the balance stands, the movements of the quarter are left empty
  // a table that still carries the savings-policy column is never netted against another: the difference would mix what is CSM with what is not
  const inc = (b: Bridge) => factsOf(b).some((f) => f.inc === 1);
  if (!tot || !sub || !tot.steps.length || inc(tot) || inc(sub) || CORE.some((k) => tot.steps.some((s) => s.k === k) && !sub.steps.some((s) => s.k === k))) return q ?? (tot ? { ...tot, w: 'q', open: null, openPrev: false, steps: [], gap: null } : null);
  const steps: Step[] = tot.steps.map((s) => { const x = sub.steps.find((t) => t.k === s.k); return { ...s, line: { v: s.line.v - (x?.line.v ?? 0), fs: [...s.line.fs, ...(x?.line.fs ?? [])], sum: s.line.sum, n: s.line.n } }; });
  const open = sub.close, close = tot.close;
  const gap = open && close && steps.length ? close.v - open.v - steps.reduce((t, s) => t + s.line.v, 0) : null;
  return { end, w: 'q', scope: tot.scope, b: tot.b, score: tot.score, open, openPrev: true, close, steps, gap, der: true, cmp: tot.cmp || sub.cmp || undefined };
}

export interface Ratios { close: number | null; open: number | null; nb: number | null; rel: number | null; nbRel: number | null; csmEq: number | null; relOpen: number | null; intOpen: number | null; estOpen: number | null; chg: number | null; /** interest and estimate changes printed as one row */ joint: boolean }
/** The ratios of one movement table. Release over opening is scaled to twelve months; interest and changes in estimates are for the window as printed. */
export function ratios(b: Bridge | null, equity: number | null): Ratios {
  const s = (k: string) => b?.steps.find((x) => x.k === k)?.line.v ?? null;
  const open = b?.open?.v ?? null, close = b?.close?.v ?? null, nb = s('nb'), r = s('rel'), rel = r == null ? null : Math.abs(r);
  const mo = b ? monthsOf(b.end, b.w) : 12, over = (x: number | null) => (x == null || !open ? null : (x / open) * 100);
  const joint = s('est') == null && s('int') == null && s('econ') != null;
  return {
    close, open, nb, rel, nbRel: nb != null && rel ? (nb / rel) * 100 : null, csmEq: close != null && equity ? close / equity : null,
    relOpen: rel != null && open ? (rel / open) * (12 / mo) * 100 : null, intOpen: over(s('int')), estOpen: over(joint ? s('econ') : s('est')),
    chg: open && close != null ? (close / open - 1) * 100 : null, joint,
  };
}

/** Equity attributable to shareholders at a balance date, as printed in the report. */
export function equityAt(F: RF[], end: string): RF | null {
  return F.filter((f) => f.m === 'equity_attributable' && f.g === 'group' && f.s === 'group' && f.w === 'instant' && f.d === end).sort((a, b) => (a.pg ?? 0) - (b.pg ?? 0))[0] ?? null;
}

/** Every source fact of a table, for the caveats that travel with it. */
export function factsOf(b: Bridge | null): RF[] { return b ? [...(b.open?.fs ?? []), ...(b.close?.fs ?? []), ...b.steps.flatMap((s) => s.line.fs)] : []; }

/* ---------- expected release (run-off) ---------- */
export const BUCKETS = ['עד שנה', '1 עד 2', '2 עד 3', '3 עד 4', '4 עד 5', '5 עד 10', '10 עד 15', 'מעל 15'];
/** Upper edge of each bucket in years; the last one is open-ended. */
export const BUCKET_END = [1, 2, 3, 4, 5, 10, 15, null];
const BK: RegExp[] = [/^up to (1|one) year$/i, /^(1-2 years|from one year to 2 years)$/i, /^(2-3 years|from 2 to 3 years)$/i, /^(3-4 years|from 3 to 4 years)$/i, /^(4-5 years|from 4 to 5 years)$/i, /^(5-10 years|from 5 to 10 years)$/i, /^(10-15 years|from 10 to 15 years)$/i, /^(over|more than) 15 years$/i];
export interface Runoff { scope: ScopeId; b: string; cells: (Line | null)[]; total: number; /** the total row of the table, where printed */ printed: Line | null }
/** The schedule of expected CSM recognition a company prints at a year end, in the eight standard buckets. */
export function runoff(all: RF[], end: string, pref = 'gross', only?: ScopeId): Runoff | null {
  const F = all.filter((f) => f.m === 'csm_expected_release' && f.d === end && !f.tr && !f.model && f.bk);
  const lifeOnly = !F.some((f) => f.g === 'health') && !F.some((f) => f.g === 'group');
  for (const b of [pref, ...['gross', 'net', 'na'].filter((x) => x !== pref)]) {
    for (const scope of (only ? [only] : lifeOnly ? ['life'] : ['group', 'lh']) as ScopeId[]) {
      const at = (test: (bk: string) => boolean): Line | null => {
        const ls = PARTS[scope].map((g) => { const c = F.filter((f) => f.g === g && f.b === b && test(f.bk!)); const own = c.some((f) => f.s === g) ? c.filter((f) => f.s === g) : new Set(c.map((f) => f.s)).size === 1 ? c : []; return own[0] ? { v: own[0].v, fs: [own[0]] } : null; });
        return ls.every(Boolean) ? { v: ls.reduce((t, l) => t + l!.v, 0), fs: ls.flatMap((l) => l!.fs), sum: ls.length > 1 || undefined } : null;
      };
      const cells = BK.map((re) => at((bk) => re.test(bk)));
      if (cells.every(Boolean)) return { scope, b, cells, total: cells.reduce((t, c) => t + c!.v, 0), printed: at((bk) => /total/i.test(bk)) };
    }
  }
  return null;
}
