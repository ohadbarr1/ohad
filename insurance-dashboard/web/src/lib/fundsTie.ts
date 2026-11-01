import type { Per } from './funds';

/* Tie band for the funds section's ranks and "leader / laggard" labels (W0 hygiene). Two tracks closer than the band share a place:
   no "מוביל" or "מאסף" is crowned on an edge inside it, and a rank reads as a range ("2–3").
   Convention: 10bp annualized ≈ below typical tracking noise between same-category tracks; a presentation convention, not a
   statistical test. */
export const TIE_BP = 10;
/** default window of every ranking in the section: 5Y annualised net (explicit URL params still win) */
export const DEFAULT_PER: Per = 'a5';
const EPS = 1e-9;

/** The band in percentage points on a window: 0.10 on annualised windows and LTM; pro rata on the shorter cumulative ones. */
export function tieBand(per: Per, asof: number): number {
  const pp = TIE_BP / 100;
  if (per === 'm1') return pp / 12;
  if (per === 'ytd') return (pp * Math.max(1, asof % 100)) / 12;
  return pp;
}
/** a and b are a tie: their gap is inside the band */
export const isTie = (a: number, b: number, band: number) => Math.abs(a - b) < band - EPS;

export interface TieRank { lo: number; hi: number; n: number }
/** Shared rank of each track among `peers` (higher is better): lo = 1 + peers ahead by the band or more; hi = peers not behind by
 *  the band or more, the track included. lo === hi: a clean place. Tracks with no value are not ranked. */
export function tieRanks<T extends { k: string }>(peers: T[], val: (f: T) => number | null, band: number): Map<string, TieRank> {
  const r = peers.map((f) => ({ k: f.k, v: val(f) })).filter((x): x is { k: string; v: number } => x.v != null);
  const n = r.length, out = new Map<string, TieRank>();
  r.forEach((x) => {
    const ahead = r.filter((y) => y.v - x.v >= band - EPS).length, behind = r.filter((y) => x.v - y.v >= band - EPS).length;
    out.set(x.k, { lo: ahead + 1, hi: n - behind, n });
  });
  return out;
}
/** "3" or "2–3" */
export const rankText = (r: Pick<TieRank, 'lo' | 'hi'>) => (r.lo === r.hi ? String(r.lo) : `${r.lo}–${r.hi}`);

/** The head and the tail of a list sorted best first: every row inside the band of the first, and of the last. A head of one is a
 *  leader; more than one, a tie at the top. `all`: the whole list is one tie. */
export function edges<R>(rows: R[], v: (r: R) => number, band: number): { top: R[]; low: R[]; all: boolean } {
  if (!rows.length) return { top: [], low: [], all: false };
  const a = v(rows[0]), z = v(rows[rows.length - 1]);
  const top = rows.filter((r) => isTie(a, v(r), band)), low = rows.filter((r) => isTie(z, v(r), band));
  return { top, low, all: top.length === rows.length };
}

export const TIE_F = `מסלולים בפער של פחות מ-${(TIE_BP / 100).toFixed(2)} נ"א לשנה חולקים מקום (בחלון קצר משנה: יחסית לאורכו). מוסכמת הצגה, לא מבחן סטטיסטי`;
export const TIE_NOTE = `צמודים ומקום משותף (למשל 2–3): פער של פחות מ-${(TIE_BP / 100).toFixed(2)} נ"א לשנה; מוסכמת הצגה, לא מבחן סטטיסטי`;
