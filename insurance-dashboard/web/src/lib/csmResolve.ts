import type { IfrsData } from './types';
import type { Prov } from './prov';
import { factProv, periodName, type Line, type Reports, type RF } from './csm';
import { nf } from './format';

/* "The CSM" of a company at a balance date: one rule, shared by the peer table (pipeline/csm_resolve.py writes the same rule into the
   registry), the CSM ledger, the company page and the valuation pages, so one company and date shows one figure everywhere.

   CSM closing = net of reinsurance, group level. Savings-policy future profit (Phoenix prints it as a "פוליסות השקעה" row of its CSM table)
   is not CSM: build_ifrs.py renames those rows future_profit_*, and a group total that still includes them (inc = 1) is never taken.
   Fallbacks, in order, each labelled on screen:
     1 group · net               printed
     2 life and health · net     one combined printed line
     3 life + health · net       the two segment lines added (flag 1)
     3b group · net, proven      a group line printed without a stated basis that equals life + health gross less their reinsurance CSM in
                                 the same report, within 1 (Phoenix 30.09.25: 8,766); basis net, labelled as proven, the four lines kept as `proof`
     3c group · net, derived     group gross less group reinsurance CSM, both printed in the same report (flag 1)
     3d life + health · net, derived   each segment gross less its reinsurance CSM, same report (flag 1)
     4 group · gross             printed
     5 group · basis not stated  printed
     6 life and health · gross / not stated, printed combined line
     7 life + health · gross / not stated, added (flag 1), both on one basis
     8 life only (net, then net derived from gross less reinsurance, then gross / not stated): a filer that prints CSM for life alone
   The net basis outranks the group scope: life plus health net is the group net figure (P&C carries no CSM in these groups), while a gross
   figure is not comparable with the net figures of the other insurers.
   Within a tier one figure per report (the date's own report and every later report that reprints it): a closing row outranks the opening
   row of a later window, a table row a chart label, a chart label printed to the unit a rounded (NIS 0.1bn) or prose figure, then the lower
   page. Across reports the restatement rule (pipeline/restate_rule.py): the latest print when it restated the first beyond rounding and
   plausibly (same sign, within 10%), flag 8, the first print kept (rst, rfrom), the restated figure from the report that first printed it;
   a reprint within rounding keeps the first print. A rounded or prose figure never outranks an exact one on the same basis. A balance at
   1 January is the 31 December balance of the year before. */

export type CsmScope = 'group' | 'life_health' | 'lh' | 'life';
export interface CsmClose {
  /** the balance, NIS millions */ v: number; b: 'net' | 'gross' | 'na'; scope: CsmScope;
  /** "נטו · קבוצה" */ label: string; /** the report period the figure was read from */ rp: string; own: boolean;
  /** 1 derived (a sum, a difference, or a printed total less the savings-policy row) · 4 sign turned · 8 restated by a later report ·
      16 read from a chart or text · 64 comparative column of a later report */
  flags: number; line: Line;
  /** the first print of a restated figure, and the report that printed it */ rst?: number; rfrom?: string;
  /** tiers 3c, 3d, 8b: net computed as gross less reinsurance; line.fs alternates gross, reinsurance (per segment) */ less?: boolean;
  /** tier 3b: life gross, life reinsurance, health gross, health reinsurance of the same report */
  proof?: RF[];
}

const ALIAS: Record<string, string[]> = {
  group: ['group'], life: ['life', 'life insurance and long-term savings'], health: ['health', 'health insurance'],
  life_health: ['life_health', 'life+health', 'life_and_health', 'life and health segments', 'life_health_combined'],
};
type TB = 'net' | 'gross' | 'na' | 'proven' | 'less';
const TIERS: [CsmScope, TB[], boolean][] = [
  ['group', ['net'], false], ['life_health', ['net'], false], ['lh', ['net'], true], ['group', ['proven'], false],
  ['group', ['less'], false], ['lh', ['less'], true],
  ['group', ['gross'], false], ['group', ['na'], false],
  ['life_health', ['gross', 'na'], false], ['lh', ['gross', 'na'], true],
  ['life', ['net'], false], ['life', ['less'], false], ['life', ['gross', 'na'], false],
];
export const CSM_SCOPE_HE: Record<CsmScope, string> = { group: 'קבוצה', life_health: 'חיים ובריאות', lh: 'חיים ועוד בריאות', life: 'חיים וחיסכון' };
export const CSM_BASIS_HE: Record<string, string> = { net: 'נטו', gross: 'ברוטו', na: 'בסיס לא צוין' };
const PROVEN_HE = ' (ברוטו פחות ביטוח משנה באותו דוח)';  // tier 3b: the report printed no basis; 3c, 3d, 8b: net computed from the two lines

const usable = (f: RF) => (f.m === 'csm_closing' || f.m === 'csm_opening') && f.w === 'instant' && !f.tr && !f.model && !f.bk && f.inc !== 1;
const whole = (f: RF, g: string) => f.g === g && (ALIAS[g] ?? []).includes(String(f.s).toLowerCase());
const chart = (f: RF) => f.src === 'chart' || f.src === 'text';
const valueOf = (f: RF): [number, boolean] => { const v = f.dv ?? f.v; return [Math.abs(v), v < 0 && f.dv == null]; };
/** the balance date of a fact: 01.01.Y is the 31.12.(Y−1) balance */
export const balDate = (f: { d: string }) => { const d = f.d.slice(0, 10); return d.slice(5) === '01-01' ? `${Number(d.slice(0, 4)) - 1}-12-31` : d; };
/** a figure read from prose, or a chart label rounded to NIS 0.1 billion: a reading of the balance, not a print of it */
const coarse = (f: RF) => { if (f.src === 'text') return true; const v = Math.abs(f.dv ?? f.v); return f.src === 'chart' && v >= 1000 && v % 100 === 0; };
const srcRank = (f: RF) => (coarse(f) ? 2 : chart(f) ? 1 : 0);
const pick = (F: RF[], g: string, b: string, date: string): RF | null => {
  const c = F.filter((f) => balDate(f) === date && (f.b || 'na') === b && whole(f, g));
  if (!c.length) return null;
  const key = (f: RF): number[] => [Number(f.m !== 'csm_closing'), srcRank(f), Number(f.dv == null), Number(f.d.slice(5, 10) === '01-01'), f.pg ?? 0];
  return c.sort((x, y) => { const a = key(x), z = key(y); for (let i = 0; i < a.length; i++) if (a[i] !== z[i]) return a[i] - z[i]; return 0; })[0];
};
/** tier 3b: the group line printed without a basis, and the four segment lines that prove it net */
function provenNet(F: RF[], date: string): [RF, RF[]] | null {
  const x = pick(F, 'group', 'na', date);
  if (!x) return null;
  const parts = (['life', 'health'] as const).flatMap((g) => (['gross', 'reinsurance'] as const).map((b) => pick(F, g, b, date)));
  if (parts.some((f) => !f)) return null;
  const [lg, lr, hg, hr] = parts.map((f) => valueOf(f!)[0]);
  return Math.abs(lg - lr + hg - hr - valueOf(x)[0]) <= 1 ? [x, parts as RF[]] : null;
}
const pk = (p: string) => Number(p.slice(0, 4)) * 10 + ({ Q1: 1, Q2: 2, Q3: 3, FY: 4 } as Record<string, number>)[p.slice(4)];
/** 2026-06-30 → 2026Q2; 2025-12-31 → 2025FY */
export const ownPeriod = (date: string) => date.slice(0, 4) + ({ '03-31': 'Q1', '06-30': 'Q2', '09-30': 'Q3', '12-31': 'FY' } as Record<string, string>)[date.slice(5, 10)];
/** every quarter-end balance date the CSM facts print (01.01 read as the 31.12 before it) */
export const csmDates = (F: { m: string; d: string }[]) => [...new Set(F.filter((f) => f.m === 'csm_closing' || f.m === 'csm_opening').map(balDate).filter((d) => /-(03-31|06-30|09-30|12-31)$/.test(d)))].sort();

interface Cand { v: number; turned: boolean; fs: RF[]; proof?: RF[]; b: TB; rp: string; own: boolean }
function candidate(F: RF[], scope: CsmScope, b: TB, sum: boolean, date: string): Omit<Cand, 'b' | 'rp' | 'own'> | null {
  if (b === 'less') {
    const parts = (sum ? ['life', 'health'] : [scope]).map((g) => { const gr = pick(F, g, 'gross', date), re = pick(F, g, 'reinsurance', date); return gr && re ? [gr, re] : null; });
    if (parts.some((x) => !x)) return null;
    const fs = parts.flat() as RF[];
    return { v: parts.reduce((s, x) => s + valueOf(x![0])[0] - valueOf(x![1])[0], 0), turned: false, fs };
  }
  if (b === 'proven') { const pr = provenNet(F, date); if (!pr) return null; const [v, turned] = valueOf(pr[0]); return { v, turned, fs: [pr[0]], proof: pr[1] }; }
  if (sum) {
    const a = pick(F, 'life', b, date), h = pick(F, 'health', b, date);
    if (!a || !h) return null;
    const [va, ta] = valueOf(a), [vh, th] = valueOf(h);
    return { v: va + vh, turned: ta || th, fs: [a, h] };
  }
  const x = pick(F, scope, b, date);
  if (!x) return null;
  const [v, turned] = valueOf(x);
  return { v, turned, fs: [x] };
}
const TOL = 0.5, BAND = 0.1;
const restated = (a: number, b: number) => Math.abs(a - b) > TOL;
const plausible = (a: number, b: number) => !restated(a, b) || (!!a && !!b && a * b > 0 && Math.abs(b / a - 1) <= BAND);
/** pipeline/restate_rule.pick: [chosen, first] */
function restatePick(cs: Cand[]): [Cand, Cand] {
  const w = (c: Cand) => pk(c.rp), order = (a: Cand, b: Cand) => w(a) - w(b) || Number(!a.own) - Number(!b.own);
  const first = [...cs].sort(order)[0];
  const top = Math.max(...cs.map(w)), last = cs.find((c) => w(c) === top)!;
  if (last === first || !restated(first.v, last.v) || !plausible(first.v, last.v)) return [first, first];
  return [cs.filter((c) => w(c) > w(first) && !restated(c.v, last.v)).sort(order)[0], first];
}

function out(scope: CsmScope, sum: boolean, cs: Cand[]): CsmClose {
  const [c, first] = restatePick(cs), re = c !== first && restated(first.v, c.v), less = c.b === 'less';
  const flags = (sum || less || c.fs.some((f) => f.cl === 1) ? 1 : 0) | (c.turned ? 4 : 0) | (re ? 8 : 0) | (c.fs.some(chart) ? 16 : 0) | (!c.own ? 64 : 0);
  const line: Line = sum || less ? { v: c.v, fs: c.fs, sum: true } : { v: c.v, fs: c.fs }, bb = c.b === 'proven' || less ? 'net' : (c.b as 'gross' | 'na' | 'net');
  return { v: Math.round(c.v * 1000) / 1000, b: bb, scope, label: `${CSM_BASIS_HE[bb]}${c.proof || less ? PROVEN_HE : ''} · ${CSM_SCOPE_HE[scope]}`, rp: c.rp, own: c.own, flags, line,
    ...(c.proof ? { proof: c.proof } : {}), ...(re ? { rst: Math.round(first.v * 1000) / 1000, rfrom: first.rp } : {}), ...(less ? { less: true } : {}) };
}

/** The CSM of one company at a balance date, from its reports (any order). */
export function resolveCsm(rs: Reports, date: string): CsmClose | null {
  const own = ownPeriod(date);
  if (!own) return null;
  const all = rs.flatMap((r) => r.F);
  const lifeOnly = !all.some((f) => f.m.startsWith('csm') && (f.g === 'health' || f.g === 'group' || f.g === 'life_health'));
  const pool = rs.map((r) => ({ p: r.p, F: r.F.filter(usable) })).filter((r) => r.p === own || pk(r.p) > pk(own));
  let held: { scope: CsmScope; sum: boolean; cs: Cand[]; b: string } | null = null;  // a tier read only from prose or rounded charts
  for (const [scope, bases, sum] of TIERS) {
    if (scope === 'life' && !lifeOnly) continue;
    const cs: Cand[] = [];
    for (const r of pool) {
      for (const b of bases) { const x = candidate(r.F, scope, b, sum, date); if (x) { cs.push({ ...x, b, rp: r.p, own: r.p === own }); break; } }
    }
    if (!cs.length) continue;
    const firm = cs.filter((c) => !c.fs.some(coarse)), tb = ['net', 'proven', 'less'].includes(cs[0].b) ? 'net' : cs[0].b;
    if (held && held.b !== tb) break;  // the net figure, even read from prose, outranks a printed gross one: the basis keeps the series comparable
    if (!firm.length) { held = held ?? { scope, sum, cs, b: tb }; continue; }
    return out(scope, sum, firm);
  }
  return held ? out(held.scope, held.sum, held.cs) : null;
}

/** The CSM of a report period (2026Q2, 2025FY): its balance date. */
export const resolveCsmAt = (rs: Reports, p: string) => resolveCsm(rs, `${p.slice(0, 4)}-${({ Q1: '03-31', Q2: '06-30', Q3: '09-30', Q4: '12-31', FY: '12-31' } as Record<string, string>)[p.slice(4)]}`);

const amt = (v: number) => nf(v, Math.abs(v) < 100 ? 1 : 0);
/** The source sheet of a resolved CSM: the printed row (with its basis and scope), or the segment rows it adds up, or the gross and
    reinsurance rows it nets. */
export function csmProv(c: CsmClose, d: IfrsData, title: string): Prov {
  const t = `${title} · ${c.label}`;
  const first = c.rst != null && c.rfrom ? `כפי שהודפס לראשונה (דוח ${periodName(c.rfrom)}): ${amt(c.rst)}` : '';
  const why = [c.flags & 64 ? `כפי שהודפס בדוח ${periodName(c.rp)}` : '', first,
    c.proof ? `הדוח לא ציין בסיס; נטו לפי אותו דוח: חיים ${amt(Math.abs(c.proof[0].v))} ובריאות ${amt(Math.abs(c.proof[2].v))} ברוטו פחות ביטוח משנה ${amt(Math.abs(c.proof[1].v))} ו-${amt(Math.abs(c.proof[3].v))} (עמ׳ ${[...new Set(c.proof.map((f) => f.pg))].join(', ')})` : '',
    c.less ? 'הדוח לא הדפיס CSM נטו לתאריך; חושב: ברוטו פחות ביטוח משנה, שניהם מאותו דוח' : c.scope !== 'group' ? `החברה אינה מדפיסה CSM נטו לקבוצה; נבחר: ${c.label}` : c.b !== 'net' ? `החברה אינה מדפיסה CSM נטו לתאריך; נבחר: ${c.label}` : ''].filter(Boolean).join(' · ');
  if (!c.line.sum) { const p = factProv(c.line.fs[0], d, t, amt(c.v)); return p.k === 'report' ? { ...p, note: [p.note, why].filter(Boolean).join(' · ') } : p; }
  const seg = (f: RF) => (f.g === 'life' ? 'חיים וחיסכון' : f.g === 'health' ? 'בריאות' : 'קבוצה');
  if (c.less) return { k: 'calc', title: t, value: amt(c.v), unit: 'מיליוני ש"ח', formula: `${c.line.fs.length > 2 ? 'חיים ועוד בריאות, כל אחד ' : ''}ברוטו פחות ביטוח משנה${why ? ` · ${why}` : ''}`,
    inputs: c.line.fs.map((f, i) => ({ label: `${seg(f)} · ${i % 2 ? 'ביטוח משנה (−)' : 'ברוטו'}`, v: amt(Math.abs(f.dv ?? f.v)), src: () => factProv(f, d, `${t} · ${seg(f)} · ${i % 2 ? 'ביטוח משנה' : 'ברוטו'}`) })) };
  return { k: 'calc', title: t, value: amt(c.v), unit: 'מיליוני ש"ח', formula: `חיים ועוד בריאות, ${CSM_BASIS_HE[c.b]}${why ? ` · ${why}` : ''}`,
    inputs: c.line.fs.map((f) => ({ label: seg(f), v: amt(Math.abs(f.dv ?? f.v)), src: () => factProv(f, d, `${t} · ${seg(f)}`) })) };
}
