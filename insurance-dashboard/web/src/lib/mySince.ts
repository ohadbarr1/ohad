/* W3 · "מה השתנה מאז הביקור הקודם" on /my: per product, against a snapshot this browser kept on the last visit.
   Pure: no React, no storage (the page keeps the snapshot under fox:my:seen, in this browser only). Descriptive, never advice.

   Rules:
   - The clock is the data's month (funds.json `asof`), not the calendar: nothing fires until the regulator publishes a new month.
   - Two snapshots are kept: `cur` (the month last seen) and `prev` (the one before). On a new month the old `cur` becomes the baseline
     and stays the baseline for the whole month, so the changes do not vanish on a reload; a product added this month has no baseline yet.
   - Place: the shared place on the card's window (5Y net, lib/verdict + the 10bp tie band of lib/fundsTie). Compared only on the same
     window and basis. A move of the range is reported; a quarter crossing is called out ("ירד לרבע התחתון", "עלה לרבע העליון", and
     the way out of each), on the card's own quarter rule (verdict.placeTone).
   - Fees: the track's average actually paid (AVG_ANNUAL_MANAGEMENT_FEE / AVG_DEPOSIT_FEE), from accumulation and from deposits; a
     change of 0.01pp or more (the published precision) is reported. The reader's own fees are theirs and do not move with the data.
   - The latest month: the track's return in the new data month (net when the file carries net), with the category's median that month. */
import type { Per } from './funds';
import { median } from './fundsCalc';
import { placeTone, type Tone, type VFund, type Verdict } from './verdict';

export interface SnapP { per: Per | null; basis: 'net' | 'gross' | null; lo: number | null; hi: number | null; n: number | null; tone: Tone | null; fee: number | null; depfee: number | null; m1: number | null }
export interface MySnap { v: 1; asof: number; at: string; p: Record<string, SnapP> }
export interface MySeen { cur: MySnap | null; prev: MySnap | null }
export const SEEN_KEY = 'my:seen';
export const EMPTY_SEEN: MySeen = { cur: null, prev: null };

/** the month's return of a track on the card's basis */
export const m1Of = (f: VFund & { m1?: number | null }, basis: 'net' | 'gross') => (basis === 'net' ? f.net?.m1 ?? null : f.m1 ?? null);

/** what the card shows today, as a snapshot */
export function snapOf(f: VFund & { m1?: number | null }, v: Verdict): SnapP {
  const r = v.ret, basis = r?.basis ?? (f.net ? 'net' : 'gross');
  return { per: r?.per ?? null, basis, lo: r?.rank?.lo ?? null, hi: r?.rank?.hi ?? null, n: r?.rank?.n ?? null, tone: r?.rank ? placeTone(r.rank) : null, fee: f.fee, depfee: f.depfee, m1: m1Of(f, basis) };
}

/** a well-formed stored value, or empty (the store is the reader's: anything can be there) */
export function normSeen(x: unknown): MySeen {
  const ok = (s: unknown): MySnap | null => { const o = s as MySnap; return o && typeof o === 'object' && typeof o.asof === 'number' && o.p && typeof o.p === 'object' ? { v: 1, asof: o.asof, at: typeof o.at === 'string' ? o.at : '', p: o.p } : null; };
  const o = (x ?? {}) as MySeen;
  return { cur: ok(o.cur), prev: ok(o.prev) };
}

/** the snapshot to compare today's data against: the last month seen before this one, or none */
export function baselineOf(seen: MySeen, asof: number): MySnap | null {
  if (seen.cur && seen.cur.asof < asof) return seen.cur;
  if (seen.cur && seen.cur.asof === asof && seen.prev && seen.prev.asof < asof) return seen.prev;
  return null;
}

/** what to store when the visit ends */
export function nextSeen(seen: MySeen, now: MySnap): MySeen {
  if (!seen.cur || seen.cur.asof < now.asof) return { prev: seen.cur, cur: now };
  if (seen.cur.asof === now.asof) return { prev: seen.prev, cur: { ...now, p: { ...seen.cur.p, ...now.p } } };
  return seen; // the stored month is newer than the data (an old cached file): keep it
}

export type CKind = 'rank' | 'quart' | 'fee' | 'dep' | 'month';
export interface Change { kind: CKind; tone: 'good' | 'bad' | 'info'; text: string }
const r2 = (v: number) => v.toFixed(2);
const pctS = (v: number) => `${v < 0 ? '-' : ''}${Math.abs(v).toFixed(2)}%`;
const rangeT = (lo: number, hi: number) => (lo === hi ? String(lo) : `${lo}–${hi}`);
const WIN: Partial<Record<Per, string>> = { a5: '5Y', a3: '3Y', y12: 'LTM' };

/** The changes of one product between a baseline and today. `catM1`: the category's month returns (for the median). */
export function changesOf(base: SnapP | undefined, cur: SnapP, catM1: number[] = []): Change[] {
  const out: Change[] = [];
  if (!base) return out;
  const same = base.per === cur.per && base.basis === cur.basis;
  if (same && base.lo != null && base.hi != null && cur.lo != null && cur.hi != null && (base.lo !== cur.lo || base.hi !== cur.hi)) {
    const better = (cur.lo + cur.hi) / 2 < (base.lo + base.hi) / 2;
    out.push({ kind: 'rank', tone: better ? 'good' : 'bad', text: `המקום בקטגוריה (${WIN[cur.per!] ?? cur.per}${cur.basis === 'net' ? ' נטו' : ''}): ${rangeT(cur.lo, cur.hi)} מתוך ${cur.n}, ${better ? 'עלה' : 'ירד'} מ-${rangeT(base.lo, base.hi)} מתוך ${base.n}` });
  }
  if (same && base.tone && cur.tone && base.tone !== cur.tone) {
    const t = cur.tone === 'bad' ? { tone: 'bad' as const, text: 'ירד לרבע התחתון של הקטגוריה' }
      : cur.tone === 'good' ? { tone: 'good' as const, text: 'עלה לרבע העליון של הקטגוריה' }
      : base.tone === 'bad' ? { tone: 'good' as const, text: 'יצא מהרבע התחתון של הקטגוריה' } : { tone: 'bad' as const, text: 'יצא מהרבע העליון של הקטגוריה' };
    out.push({ kind: 'quart', ...t });
  }
  if (base.fee != null && cur.fee != null && Math.abs(cur.fee - base.fee) >= 0.005)
    out.push({ kind: 'fee', tone: cur.fee > base.fee ? 'bad' : 'good', text: `דמי הניהול מצבירה במסלול (ממוצע בפועל): ${r2(cur.fee)}%, ${cur.fee > base.fee ? 'עלו' : 'ירדו'} מ-${r2(base.fee)}%` });
  if (base.depfee != null && cur.depfee != null && Math.abs(cur.depfee - base.depfee) >= 0.005)
    out.push({ kind: 'dep', tone: cur.depfee > base.depfee ? 'bad' : 'good', text: `דמי הניהול מהפקדה במסלול (ממוצע בפועל): ${r2(cur.depfee)}%, ${cur.depfee > base.depfee ? 'עלו' : 'ירדו'} מ-${r2(base.depfee)}%` });
  if (cur.m1 != null) {
    const med = median(catM1);
    out.push({ kind: 'month', tone: 'info', text: `התשואה בחודש האחרון${cur.basis === 'net' ? ' (נטו, אומדן)' : ''}: ${pctS(cur.m1)}${med != null ? `; חציון הקטגוריה: ${pctS(med)}` : ''}` });
  }
  return out;
}

/** months between two yyyymm */
export const monthsBetween = (a: number, b: number) => (Math.floor(b / 100) - Math.floor(a / 100)) * 12 + (b % 100) - (a % 100);
