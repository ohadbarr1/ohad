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
     4 group · gross             printed
     5 group · basis not stated  printed
     6 life and health · gross / not stated, printed combined line
     7 life + health · gross / not stated, added (flag 1), both on one basis
     8 life only (net, then gross / not stated): a filer that prints CSM for life alone
   The net basis outranks the group scope: life plus health net is the group net figure (P&C carries no CSM in these groups), while a gross
   figure is not comparable with the net figures of the other insurers. Within a tier the period's own report wins, then later reports
   that reprint the date (newest first); in a report a closing row outranks the opening row of a later window, a table row outranks a figure
   read from a chart or text, then the lower page. */

export type CsmScope = 'group' | 'life_health' | 'lh' | 'life';
export interface CsmClose {
  /** the balance, NIS millions */ v: number; b: 'net' | 'gross' | 'na'; scope: CsmScope;
  /** "נטו · קבוצה" */ label: string; /** the report period the figure was read from */ rp: string; own: boolean;
  /** 1 derived (a sum, or a printed total less the savings-policy row) · 4 sign turned · 16 read from a chart or text · 64 comparative column of a later report */
  flags: number; line: Line;
}

const ALIAS: Record<string, string[]> = {
  group: ['group'], life: ['life', 'life insurance and long-term savings'], health: ['health', 'health insurance'],
  life_health: ['life_health', 'life+health', 'life_and_health', 'life and health segments', 'life_health_combined'],
};
const TIERS: [CsmScope, ('net' | 'gross' | 'na')[], boolean][] = [
  ['group', ['net'], false], ['life_health', ['net'], false], ['lh', ['net'], true],
  ['group', ['gross'], false], ['group', ['na'], false],
  ['life_health', ['gross', 'na'], false], ['lh', ['gross', 'na'], true],
  ['life', ['net'], false], ['life', ['gross', 'na'], false],
];
export const CSM_SCOPE_HE: Record<CsmScope, string> = { group: 'קבוצה', life_health: 'חיים ובריאות', lh: 'חיים ועוד בריאות', life: 'חיים וחיסכון' };
export const CSM_BASIS_HE: Record<string, string> = { net: 'נטו', gross: 'ברוטו', na: 'בסיס לא צוין' };

const usable = (f: RF) => (f.m === 'csm_closing' || f.m === 'csm_opening') && f.w === 'instant' && !f.tr && !f.model && !f.bk && f.inc !== 1;
const whole = (f: RF, g: string) => f.g === g && (ALIAS[g] ?? []).includes(String(f.s).toLowerCase());
const chart = (f: RF) => f.src === 'chart' || f.src === 'text';
const valueOf = (f: RF): [number, boolean] => { const v = f.dv ?? f.v; return [Math.abs(v), v < 0 && f.dv == null]; };
const pick = (F: RF[], g: string, b: string, date: string): RF | null => {
  const c = F.filter((f) => f.d.slice(0, 10) === date && (f.b || 'na') === b && whole(f, g));
  if (!c.length) return null;
  const key = (f: RF): number[] => [Number(f.m !== 'csm_closing'), Number(chart(f)), Number(f.dv == null), f.pg ?? 0];
  return c.sort((x, y) => { const a = key(x), z = key(y); for (let i = 0; i < a.length; i++) if (a[i] !== z[i]) return a[i] - z[i]; return 0; })[0];
};
const pk = (p: string) => Number(p.slice(0, 4)) * 10 + ({ Q1: 1, Q2: 2, Q3: 3, FY: 4 } as Record<string, number>)[p.slice(4)];
/** 2026-06-30 → 2026Q2; 2025-12-31 → 2025FY */
export const ownPeriod = (date: string) => date.slice(0, 4) + ({ '03-31': 'Q1', '06-30': 'Q2', '09-30': 'Q3', '12-31': 'FY' } as Record<string, string>)[date.slice(5, 10)];

/** The CSM of one company at a balance date, from its reports (any order). */
export function resolveCsm(rs: Reports, date: string): CsmClose | null {
  const own = ownPeriod(date);
  if (!own) return null;
  const all = rs.flatMap((r) => r.F);
  const lifeOnly = !all.some((f) => f.m.startsWith('csm') && (f.g === 'health' || f.g === 'group' || f.g === 'life_health'));
  const pool = rs.map((r) => ({ p: r.p, F: r.F.filter(usable) }));
  const order = [...pool.filter((r) => r.p === own), ...pool.filter((r) => r.p !== own && pk(r.p) > pk(own)).sort((a, b) => pk(b.p) - pk(a.p))];
  for (const [scope, bases, sum] of TIERS) {
    if (scope === 'life' && !lifeOnly) continue;
    for (const r of order) {
      for (const b of bases) {
        let fs: RF[], v: number, turned: boolean;
        if (sum) {
          const a = pick(r.F, 'life', b, date), h = pick(r.F, 'health', b, date);
          if (!a || !h) continue;
          const [va, ta] = valueOf(a), [vh, th] = valueOf(h);
          fs = [a, h]; v = va + vh; turned = ta || th;
        } else {
          const x = pick(r.F, scope, b, date);
          if (!x) continue;
          [v, turned] = valueOf(x); fs = [x];
        }
        const flags = (sum || fs.some((f) => f.cl === 1) ? 1 : 0) | (turned ? 4 : 0) | (fs.some(chart) ? 16 : 0) | (r.p !== own ? 64 : 0);
        const line: Line = sum ? { v, fs, sum: true } : { v, fs };
        return { v: Math.round(v * 1000) / 1000, b, scope, label: `${CSM_BASIS_HE[b]} · ${CSM_SCOPE_HE[scope]}`, rp: r.p, own: r.p === own, flags, line };
      }
    }
  }
  return null;
}

/** The CSM of a report period (2026Q2, 2025FY): its balance date. */
export const resolveCsmAt = (rs: Reports, p: string) => resolveCsm(rs, `${p.slice(0, 4)}-${({ Q1: '03-31', Q2: '06-30', Q3: '09-30', Q4: '12-31', FY: '12-31' } as Record<string, string>)[p.slice(4)]}`);

const amt = (v: number) => nf(v, Math.abs(v) < 100 ? 1 : 0);
/** The source sheet of a resolved CSM: the printed row (with its basis and scope), or the two segment rows it adds up. */
export function csmProv(c: CsmClose, d: IfrsData, title: string): Prov {
  const t = `${title} · ${c.label}`;
  const why = [c.flags & 64 ? `כפי שהודפס בדוח ${periodName(c.rp)}` : '', c.scope !== 'group' ? `החברה אינה מדפיסה CSM נטו לקבוצה; נבחר: ${c.label}` : c.b !== 'net' ? `החברה אינה מדפיסה CSM נטו לתאריך; נבחר: ${c.label}` : ''].filter(Boolean).join(' · ');
  if (!c.line.sum) { const p = factProv(c.line.fs[0], d, t, amt(c.v)); return p.k === 'report' ? { ...p, note: [p.note, why].filter(Boolean).join(' · ') } : p; }
  return { k: 'calc', title: t, value: amt(c.v), unit: 'מיליוני ש"ח', formula: `חיים ועוד בריאות, ${CSM_BASIS_HE[c.b]}${why ? ` · ${why}` : ''}`,
    inputs: c.line.fs.map((f) => ({ label: f.g === 'life' ? 'חיים וחיסכון' : 'בריאות', v: amt(Math.abs(f.dv ?? f.v)), src: () => factProv(f, d, `${t} · ${f.g === 'life' ? 'חיים וחיסכון' : 'בריאות'}`) })) };
}
