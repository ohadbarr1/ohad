/* Rollout L2-b (spec 4, 16.1 4a–4e, 18.5): the screener's own pure helpers, on top of lib/pageMonths. Node-tested by
   scripts/screen-test.mjs on the live data of 10/26 (gross, as published).
   - `screenBoard`: one board of a type for one measure. Ranked rows by `placeGroups` (the one ranking of the rollout pages: anchored
     groups, standard competition places 1, 1, 3); tracks with no figure, old-generation policies and closed (gone) tracks close the board
     unranked; self-managed / IRA tracks are listed apart (`self`), never ranked (18.5, coordinator decision 2). A measure where lower is
     better (fees, volatility) ranks ascending.
   - `windowAvg`: the type's average over the period from cat.json (asset-weighted, the regulator's members that month): the month itself,
     the year to date and 12 months compounded, 3 and 5 years compounded and annualised. Never a mean of the members (coordinator
     decision 1).
   - `screenDefault`: where the screener opens without an address: the saver on the type of the first saved product (pension first, the
     compareKeys rule), else pension · general; the agent on pension · up to 50; Pro on hishtalmut · general (spec 4.2). */
import { placeGroups, placeOrder, oldGeneration, type Place } from '../../lib/pageMonths';
import { selfDirected, type CatX, type FundX, type Per } from '../../lib/funds';
import { cum } from '../../lib/compareMonths';
import { addMonths } from '../../lib/market';

type V = number | null;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export type RowKind = 'ranked' | 'none' | 'old' | 'gone' | 'self';
export interface BoardRow { f: FundX; v: V; pl: Place | null; kind: RowKind }
export interface Board {
  /** ranked rows best first, then the unranked ones (no figure, old generation, gone) */
  rows: BoardRow[];
  /** self-managed / IRA tracks, best figure first (asc measures: lowest first), no place */
  self: BoardRow[];
  /** how many were ranked */
  n: number;
  /** any place shared (the board then closes with the tie note) */
  shared: boolean;
}

/** May a track get a place? (not closed, not self-managed / IRA, not an old-generation policy) */
export const rankableHere = (f: Pick<FundX, 'name' | 'prod' | 'gone'>) => !f.gone && !selfDirected(f) && !oldGeneration(f);

/**
 * The board of one type for one measure. `val`: the figure of a track (the period's return, or another measure); `band`: the tie band
 * (lib/fundsTie `tieBand(per, asof)` for a return; a tiny band for other measures, so only equal figures share); `asc`: lower is better.
 */
export function screenBoard(members: FundX[], val: (f: FundX) => V, band: number, o: { asc?: boolean } = {}): Board {
  const sign = o.asc ? -1 : 1;
  const raw = members.map((f) => { const v = val(f); return num(v) ? v : null; });
  const vals = members.map((f, i) => (rankableHere(f) && raw[i] != null ? sign * (raw[i] as number) : null));
  const pl = placeGroups(vals, band);
  const rows: BoardRow[] = [], rest: BoardRow[] = [], gone: BoardRow[] = [], self: BoardRow[] = [];
  for (const i of placeOrder(vals)) {
    const f = members[i];
    if (pl[i].place != null) rows.push({ f, v: raw[i], pl: pl[i], kind: 'ranked' });
    else if (f.gone) gone.push({ f, v: raw[i], pl: null, kind: 'gone' });
    else if (selfDirected(f)) self.push({ f, v: raw[i], pl: null, kind: 'self' });
    else rest.push({ f, v: raw[i], pl: null, kind: oldGeneration(f) ? 'old' : 'none' });
  }
  // the unranked: figures first (best first), then "אין עדיין"
  const byFig = (a: BoardRow, b: BoardRow) => (a.v == null || b.v == null ? (a.v == null ? (b.v == null ? 0 : 1) : -1) : sign * (b.v - a.v));
  rest.sort(byFig); self.sort(byFig); gone.sort(byFig);
  return { rows: [...rows, ...rest, ...gone], self, n: rows.length, shared: rows.some((r) => r.pl!.shared) };
}

/** a type's monthly average (cat.json `y`) in month `p`, or null */
export function catMonth(c: CatX | null | undefined, p: number): V {
  if (!c) return null;
  const i = c.p.indexOf(p);
  return i < 0 || !num(c.y[i]) ? null : c.y[i];
}
const MONTHS: Record<Per, (asof: number) => number> = { m1: () => 1, ytd: (a) => Math.max(1, a % 100), y12: () => 12, a3: () => 36, a5: () => 60 };
/** The type's average over the period, from cat.json: the month; the year to date and 12 months compounded; 3 and 5 years compounded and
 *  annualised. Null when a month is missing. */
export function windowAvg(c: CatX | null | undefined, per: Per, asof: number): V {
  if (!c) return null;
  const n = MONTHS[per](asof);
  const t = cum(Array.from({ length: n }, (_, i) => catMonth(c, addMonths(asof, -i))));
  if (t == null) return null;
  return n > 12 ? ((1 + t / 100) ** (12 / n) - 1) * 100 : t;
}

export interface ScreenAt { prod: string; track: string }
const isPen = (prod: string) => /^פנסיה/.test(prod);
/** The screener's opening type without an address (spec 4.2 "Defaults"). `own`: the reader's saved tracks, in their order (saver only). */
export function screenDefault(door: 'saver' | 'agent' | 'pro' | null | undefined, own: Pick<FundX, 'prod' | 'track'>[] = []): ScreenAt {
  if (door === 'agent') return { prod: 'פנסיה מקיפה', track: 'עד 50' };
  if (door === 'pro') return { prod: 'השתלמות', track: 'כללי' };
  const lead = own.find((f) => isPen(f.prod)) ?? own[0];
  return lead ? { prod: lead.prod, track: lead.track } : { prod: 'פנסיה מקיפה', track: 'כללי' };
}

/** The measures of "דירוג לפי" (agent and Pro) where lower is better (as the desktop table sorts them) */
export const ASC_MEASURES = new Set(['fee', 'depfee', 'sd']);
/** the band for a non-return measure: only equal figures share a place */
export const EXACT_BAND = 1e-6;

/* ---- the 22 columns of the desktop table and of "דירוג לפי" (moved from pages/FundsScreen.tsx, unchanged) ---- */
export type ColKey = 'pct' | 'm1' | 'ytd' | 'y12' | 'a3' | 'a5' | 'fee' | 'depfee' | 'assets' | 'sharpe' | 'sd' | 'alpha' | 'st' | 'fo' | 'fx' | 'liq' | 'age' | 'top' | 'persist' | 'act' | 'svc' | 'clm';
export const COLS: [ColKey, string][] = [['pct', 'אחוזון'], ['m1', '1M'], ['ytd', 'YTD'], ['y12', 'LTM'], ['a3', '3Y'], ['a5', '5Y'], ['fee', 'ד"נ מצבירה'], ['depfee', 'ד"נ מהפקדה'], ['assets', 'נכסים'], ['sharpe', 'שארפ'], ['sd', 'סטיית תקן'], ['alpha', 'אלפא'], ['st', 'מניות'], ['fo', 'חו"ל'], ['fx', 'מט"ח'], ['liq', 'נזיל'], ['age', 'ותק'], ['top', 'רבע עליון'], ['persist', 'התמדה'], ['act', 'איזון אקטוארי'], ['svc', 'מדד שירות'], ['clm', 'תביעות נכות']];  // act: W1-agent, svc: W2, clm: W6 (the company's own claims report), pension only
export const COL_LABEL = Object.fromEntries(COLS) as Record<ColKey, string>;
export const RET = new Set<ColKey>(['m1', 'ytd', 'y12', 'a3', 'a5']);
export const isColKey = (x: string): x is ColKey => COLS.some(([k]) => k === x);
