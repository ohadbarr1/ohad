/* W1 · agent door: the fee benchmark for a negotiation ("the median manager charges X"). Per product, and optionally per category
   (product | track), the distribution of the regulator's AVERAGE ACTUAL fees (AVG_ANNUAL_MANAGEMENT_FEE from accumulation,
   AVG_DEPOSIT_FEE from deposits) as p10 / p25 / median / p75 / p90.
   - Unit 'mgr' (default): one observation per managing group, its tracks' fees weighted by their assets. A group with 20 tracks
     counts once, so the spread is the market's price list, not the big houses' shelf.
   - Unit 'track': one observation per track (the shelf as it is).
   - In: open tracks (not ענפיות), with assets, not personally managed (IRA), with the fee published. Each fee is its own population
     (a track with a deposit fee but no accumulation fee counts in the one it has).
   - Percentiles: linear interpolation between order statistics, Excel PERCENTILE.INC; only with MIN_N observations or more.
   The fees are averages the managers actually charged their members; a saver's own fee can differ (negotiated, default fund).
   Pure (no React). */
import { quantile } from './fundsCalc';

export interface FeeObs { k: string; name: string; grp: string; mgr?: string; prod: string; track: string; fee: number | null; depfee?: number | null; assets: number | null; closed?: boolean; gone?: boolean }
export type FeeUnit = 'mgr' | 'track';
export type FeeKey = 'fee' | 'depfee';
export interface Pcts { n: number; p10: number; p25: number; p50: number; p75: number; p90: number; min: number; max: number }
export interface Obs { id: string; label: string; grp: string; v: number; w: number; tracks: { k: string; name: string; v: number; assets: number }[] }
export interface FeeSide { pcts: Pcts | null; obs: Obs[] }
export interface FeeDist { prod: string; track: string | null; unit: FeeUnit; fee: FeeSide; depfee: FeeSide; nTracks: number; nGroups: number }

export const MIN_N = 5;
export const Q = [0.1, 0.25, 0.5, 0.75, 0.9] as const;
export const FEE_DIST_F = 'אחוזונים בשיטת אינטרפולציה לינארית בין ערכי הסדר (כמו PERCENTILE.INC באקסל): p = x₍ⱼ₎ + (h − j)(x₍ⱼ₊₁₎ − x₍ⱼ₎), h = (n − 1)·q';
const selfDirected = (name: string) => /בניהול אישי|\bIRA\b/.test(name);

/** p10…p90 of a set of values, or null below MIN_N */
export function pcts(xs: number[], min = MIN_N): Pcts | null {
  const s = xs.filter((x) => Number.isFinite(x));
  if (s.length < min) return null;
  const [p10, p25, p50, p75, p90] = Q.map((q) => quantile(s, q)!);
  return { n: s.length, p10, p25, p50, p75, p90, min: Math.min(...s), max: Math.max(...s) };
}
/** assets-weighted mean of the values (equal weights when no track has assets) */
export function wmean(rows: { v: number; w: number }[]): number | null {
  if (!rows.length) return null;
  const W = rows.reduce((t, r) => t + (r.w > 0 ? r.w : 0), 0);
  if (!(W > 0)) return rows.reduce((t, r) => t + r.v, 0) / rows.length;
  return rows.reduce((t, r) => t + r.v * (r.w > 0 ? r.w : 0), 0) / W;
}
/** the tracks a benchmark counts */
export const counted = (f: FeeObs) => !f.closed && !f.gone && (f.assets ?? 0) > 0 && !selfDirected(f.name);

function side(fs: FeeObs[], key: FeeKey, unit: FeeUnit): FeeSide {
  const have = fs.filter((f) => f[key] != null && Number.isFinite(f[key] as number));
  let obs: Obs[];
  if (unit === 'track') obs = have.map((f) => ({ id: f.k, label: f.name, grp: f.grp, v: f[key] as number, w: f.assets ?? 0, tracks: [{ k: f.k, name: f.name, v: f[key] as number, assets: f.assets ?? 0 }] }));
  else {
    const by = new Map<string, FeeObs[]>();
    have.forEach((f) => by.set(f.grp, [...(by.get(f.grp) ?? []), f]));
    obs = [...by].map(([grp, l]) => ({ id: grp, label: grp, grp, v: wmean(l.map((f) => ({ v: f[key] as number, w: f.assets ?? 0 })))!, w: l.reduce((t, f) => t + (f.assets ?? 0), 0),
      tracks: [...l].sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0)).map((f) => ({ k: f.k, name: f.name, v: f[key] as number, assets: f.assets ?? 0 })) }));
  }
  obs.sort((a, b) => a.v - b.v || b.w - a.w);
  return { pcts: pcts(obs.map((o) => o.v)), obs };
}

/** The benchmark of a product (track null: every category of it) on a unit. */
export function feeDist(funds: FeeObs[], prod: string, track: string | null, unit: FeeUnit = 'mgr'): FeeDist {
  const fs = funds.filter((f) => counted(f) && f.prod === prod && (track == null || f.track === track));
  return { prod, track, unit, fee: side(fs, 'fee', unit), depfee: side(fs, 'depfee', unit), nTracks: fs.length, nGroups: new Set(fs.map((f) => f.grp)).size };
}

/** where a fee sits against the benchmark (lower is cheaper): the band between two percentiles */
export type Band = '≤p10' | 'p10–p25' | 'p25–p50' | 'p50–p75' | 'p75–p90' | '>p90';
export function bandOf(v: number, p: Pcts): Band {
  if (v <= p.p10) return '≤p10';
  if (v <= p.p25) return 'p10–p25';
  if (v <= p.p50) return 'p25–p50';
  if (v <= p.p75) return 'p50–p75';
  if (v <= p.p90) return 'p75–p90';
  return '>p90';
}
export const BAND_HE: Record<Band, string> = { '≤p10': 'בעשירון הזול', 'p10–p25': 'זול מהרבעון', 'p25–p50': 'מתחת לחציון', 'p50–p75': 'מעל החציון', 'p75–p90': 'ברבעון היקר', '>p90': 'בעשירון היקר' };

/** The categories of a product worth a benchmark: MIN_N groups or more with an accumulation fee, the largest (by assets) first. */
export function categoriesOf(funds: FeeObs[], prod: string, unit: FeeUnit = 'mgr'): { track: string; assets: number; n: number }[] {
  const by = new Map<string, FeeObs[]>();
  funds.filter((f) => counted(f) && f.prod === prod).forEach((f) => by.set(f.track, [...(by.get(f.track) ?? []), f]));
  return [...by].map(([track, l]) => ({ track, assets: l.reduce((t, f) => t + (f.assets ?? 0), 0), n: unit === 'mgr' ? new Set(l.filter((f) => f.fee != null).map((f) => f.grp)).size : l.filter((f) => f.fee != null).length }))
    .filter((c) => c.n >= MIN_N).sort((a, b) => b.assets - a.assets);
}
