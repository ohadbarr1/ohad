/** feebook.json (pipeline/build_feebook.py, wave 11): the fee-book embedded value per manager x product, and the one formula the page
 *  recomputes with the reader's assumptions (evBook mirrors build_feebook.ev_book; web/scripts/feebook-test.mjs checks the parity). */
import { useLoad } from './useData';

export type FbSeg = 'pen' | 'gem';
export interface FbOut { wd: number; tro: number; avg: number; n: number; from: number; to: number; rate: number | null }
export interface FbRow {
  g: number; c: string; p: string; fid: string; seg: FbSeg; aum: number; pi: number; skip?: string;
  fee?: number; fee_cov?: number; fee_first?: number | null; fee_n?: number; trend?: number | null; eros?: number; floor?: number | null;
  out?: FbOut | null; surv?: number | null; ci?: number | null; ci_ga?: number | null; why?: string | null; ev?: number | null; ev_aum?: number | null; pv_fees?: number | null;
}
/** `sf` (fb1.1): the service fee to the controlling company, inside `ga` (Meitav only; see build_feebook SERVICE_FEE) */
export interface FbCostOk { q: string[]; fees: number; sm: number; ga: number; ci: number; ci_ga: number; sf?: number; parts: { q: string; fees: number; sm: number; ga: number; sf?: number }[] }
export type FbCost = FbCostOk | { why: string };
export interface FbCsm {
  date: string; v: number; basis: string; period: string; url: string | null; ym: number; pi: number | null; a_ins: number; csm_aum: number | null;
  parts: { l: string; s: string; v: number; pg: number }[]; life: { l: string; s: string; b: string; v: number; pg: number; csm_aum: number | null } | null;
}
export interface FbMgr {
  g: number; c: string; name: string; lts: string | null; aum: number; aum_v: number | null; ev: number | null; ev_aum: number | null; n: number; n_v: number;
  costs: Record<FbSeg, FbCost>; grid: number[][] | null; csm?: FbCsm;
}
export interface FbFloor { fee: number; depfee: number | null; tender: string; from: string; to: string; src: string | null; src_title: string | null; verified: boolean | null }
export interface FeeBookData {
  meta: { method: string; asof: number; fetched: string; last_rep: string; draft: boolean; src: string; cost_quarters: string[] };
  assume: { disc: number; growth: number; horizon: number; win: number; min_aum: number; trend_cap: number; floor: FbFloor | null; grid_r: number[]; grid_s: number[] };
  managers: FbMgr[]; rows: FbRow[];
}
export const useFeeBook = () => useLoad<FeeBookData>('feebook.json');
export const costOk = (c: FbCost | undefined): c is FbCostOk => !!c && 'ci' in c;

/** PV of the book's net fee stream, NIS m: Σ_{t=1..H} AUM × [S × (1 + g)]^(t−1) × fee_t / 100 × (1 − ci) / (1 + r)^t,
 *  fee_t = max(floor_eff, fee + eros × (t − 1)), floor_eff = min(fee, floor) (0 when no floor). The same loop as build_feebook.ev_book. */
export function evBook(aum: number | null | undefined, fee: number | null | undefined, eros: number, floor: number | null | undefined, surv: number | null | undefined,
  ci: number | null | undefined, disc: number, growth: number, horizon: number): number | null {
  if (ci == null || surv == null || fee == null || aum == null) return null;
  const fl = floor != null ? Math.max(0, Math.min(fee, floor)) : 0, k = 1 + disc / 100;
  let bal = aum, pv = 0;
  for (let t = 1; t <= horizon; t++) {
    const f = Math.max(fl, fee + eros * (t - 1));
    pv += bal * f / 100 * (1 - ci) / k ** t;
    bal *= surv * (1 + growth / 100);
  }
  return pv;
}

/** the reader's assumptions (the base case = the file's `assume`, costs on all segment costs, no rising fee, floor on, no survival shift) */
export interface FbAssume { disc: number; growth: number; horizon: number; basis: 'all' | 'ga'; up: boolean; floor: boolean; ds: number }
export const baseAssume = (d: FeeBookData): FbAssume => ({ disc: d.assume.disc, growth: d.assume.growth, horizon: d.assume.horizon, basis: 'all', up: false, floor: true, ds: 0 });
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** a row's inputs under the assumptions */
export function rowIn(x: FbRow, a: FbAssume) {
  const ci = a.basis === 'ga' ? x.ci_ga ?? null : x.ci ?? null;
  const eros = a.up ? x.trend ?? 0 : Math.min(0, x.trend ?? 0);
  const floor = a.floor ? x.floor ?? null : null;
  const surv = x.surv == null ? null : clamp01(x.surv + a.ds / 100);
  return { ci, eros, floor, surv };
}
export function rowEv(x: FbRow, a: FbAssume, over?: { disc?: number; ds?: number }): number | null {
  if (x.skip) return null;
  const i = rowIn(x, { ...a, ds: over?.ds ?? a.ds });
  return evBook(x.aum, x.fee, i.eros, i.floor, i.surv, i.ci, over?.disc ?? a.disc, a.growth, a.horizon);
}
/** a manager's total: the sum over its valued products (null when none is valued) */
export function mgrEv(rows: FbRow[], a: FbAssume, over?: { disc?: number; ds?: number }): { ev: number | null; aum: number } {
  let ev = 0, aum = 0, n = 0;
  for (const x of rows) { const v = rowEv(x, a, over); if (v != null) { ev += v; aum += x.aum; n++; } }
  return { ev: n ? ev : null, aum };
}
