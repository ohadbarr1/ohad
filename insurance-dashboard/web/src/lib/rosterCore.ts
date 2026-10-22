/** Pure arithmetic of roster changes (no React; tested by web/scripts/roster-test.mjs). Roster changes behind an aggregate's change (W5-14).
 *  1. Peer set: a median, average or share compares two periods over different companies (one missing in a period, a new reporter).
 *  2. Regulator files: a group's assets grew because fund ids entered its part of the files (roster.json, pipeline/build_roster.py). */

export interface RosterDiff { in: string[]; out: string[]; same: string[] }
/** Companies with a figure in the later period but not the earlier one (in), the reverse (out), and those in both. Null when equal,
 *  or when either period has no company (there is no earlier aggregate to compare with: nothing changed, the series starts). */
export function rosterDiff(now: string[], before: string[]): RosterDiff | null {
  if (!now.length || !before.length) return null;
  const a = new Set(now), b = new Set(before);
  const inn = now.filter((x) => !b.has(x)), out = before.filter((x) => !a.has(x));
  return inn.length || out.length ? { in: inn, out, same: now.filter((x) => b.has(x)) } : null;
}
/** One line for a tooltip: "נכנסו: א, ב · יצאו: ג" */
export function rosterText(d: RosterDiff, name: (id: string) => string): string {
  return [d.in.length ? `נכנסו: ${d.in.map(name).join(', ')}` : '', d.out.length ? `יצאו: ${d.out.map(name).join(', ')}` : ''].filter(Boolean).join(' · ');
}

export const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
export const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/* ---------- regulator files ---------- */
type Sparse = Record<string, number>;
interface Series { a: number[]; in3: Sparse; nin3: Sparse; out3: Sparse; in12: Sparse; nin12: Sparse; out12: Sparse }
export interface RosterFile { built: string; source: string; months: number[]; groups: string[]; series: Record<string, Series>; ev: [number, string, string, number, number, number][] }

const FAMS: Record<string, string[]> = { all: ['pension', 'gemel', 'insurance'], pension: ['pension'], gemel: ['gemel'], insurance: ['insurance'], pg: ['pension', 'gemel'] };
export interface FundRoster { a0: number; a1: number; inA: number; nIn: number; outA: number; net: number; lfl: number | null; fresh: boolean; names: string[]; m0: number; m1: number }
/** Funds that entered a group's part of the files in the window (m1 − w, m1], net of what closed ids held. Null when immaterial:
 *  the net entry is under 1% of the group's assets at m1 and the group did not start reporting the set inside the window. */
export function fundRoster(r: RosterFile, group: string, set: string, m1: number, w: 3 | 12): FundRoster | null {
  const g = r.groups.indexOf(group), i = r.months.indexOf(m1);
  if (g < 0 || i < w) return null;
  let a0 = 0, a1 = 0, inA = 0, nIn = 0, outA = 0;
  for (const f of FAMS[set] ?? FAMS.all) {
    const s = r.series[`${g}|${f}`];
    if (!s) continue;
    a0 += s.a[i - w]; a1 += s.a[i];
    inA += s[`in${w}`][i] ?? 0; nIn += s[`nin${w}`][i] ?? 0; outA += s[`out${w}`][i] ?? 0;
  }
  const net = Math.max(0, inA - outA), fresh = a0 <= 0 && a1 > 0;
  if (!nIn || (!fresh && net < 0.01 * a1)) return null;
  const fams = new Set(FAMS[set] ?? FAMS.all), m0 = r.months[i - w];
  const names = r.ev.filter(([gi, f, , em]) => gi === g && fams.has(f) && em > m0 && em <= m1).sort((x, y) => y[5] - x[5]).map((e) => e[2]);
  return { a0, a1, inA, nIn, outA, net, lfl: a0 > 0 ? ((a1 - net) / a0 - 1) * 100 : null, fresh, names, m0, m1 };
}
/** The regulator month that closes a peer-table period: 2026Q2 → 202606, 2025FY → 202512, 2026H1 → 202606 */
export function monthOf(p: string): number {
  const y = Number(p.slice(0, 4)), t = p.slice(4);
  return y * 100 + (t === 'FY' || t === 'H2' ? 12 : t === 'H1' ? 6 : Number(t.slice(1)) * 3);
}
