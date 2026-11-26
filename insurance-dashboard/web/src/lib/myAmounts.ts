import { useCallback, useEffect, useMemo, useState } from 'react';
import { EVENT, PREFIX, readStored } from './local';
import { MINE_KEY, useActiveProfile, type MyProduct } from './mine';
import { keyFor, type ProfileId } from './household';
import type { FeeBase } from './feeExample';

/* The reader's own amounts (rollout spec §17.2, T-F4): the balance in one product and the monthly deposit into it (the reader and the
   employer together). ONE reader for every shekel figure on the fund card, /my, the product sheet, the fee sheet and the fees tool:
   `useMyAmounts(target)`. No page reads or writes these amounts in storage on its own (a second writer brings back round 2's bug).
   - Where they live: a saved product keeps them in its own record (fox:mine[i].balance / .monthly, lib/mine MyProduct, per household
     profile). A reader with no saved product of that kind keeps them in fox:fees:amounts, an object keyed by product name
     ({ "פנסיה מקיפה": { balance, monthly } }), per profile like every /my key.
   - Which record a page gets (`resolveAmounts`, the rule lives here only):
       card / /my / product sheet   { k }            → the saved product with that track key; a track the reader has not saved: none
                                                       (the card stays "לדוגמה");
       fees tool                    { prod, cat, funds } → the saved product of that product AND type on screen, else the product-kind
                                                       entry of fox:fees:amounts.
     Never crosses products: a product's amounts are used for its own row, for the other tracks of its type on the fees board and for
     the type's average beside it on the card, never for another saved product.
   - Saving: an empty balance clears the product's amounts (back to the example); a zero is a real value (the sheet asks first); an
     empty deposit keeps the example deposit (`depositOwn` false). Storage blocked (private mode): the figures still change for this tab
     (a session overlay) and `set` answers 'blocked' so the sheet can say "לא נשמר". */

export const FEES_AMOUNTS_KEY = 'fees:amounts';
/** at most nine digits (17.2 Input) */
export const AMOUNT_MAX = 999_999_999;

export interface Amounts { balance: number | null; monthly: number | null }
export type KindStore = Record<string, Amounts>;
/** what a page asks for: a saved track (`k`), or the fees tool's product and type (`prod` + `cat`, with funds.json to map saved keys) */
export interface AmountsTarget {
  k?: string | null;
  prod?: string | null;
  cat?: string | null;
  funds?: readonly { k: string; prod: string; track: string }[] | null;
}
export type AmountsWhere = 'mine' | 'kind' | 'none';
export interface Resolved { where: AmountsWhere; k: string | null; prod: string | null; amounts: Amounts }
export type SaveResult = 'saved' | 'cleared' | 'blocked';

export interface MyAmounts extends Amounts {
  /** a balance was typed (0 included) */
  own: boolean;
  /** a monthly deposit was typed (else the product's example deposit applies) */
  depositOwn: boolean;
  /** for lib/feeExample feeCost / feeTable: null = the example (100,000 ₪ and the product's example deposit) */
  base: FeeBase | null;
  where: AmountsWhere;
  /** the saved product's track key when `where` is 'mine' */
  k: string | null;
  /** write the amounts (balance null = clear) */
  set: (a: Amounts) => SaveResult;
  clear: () => SaveResult;
}

/* ---------- pure ---------- */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(AMOUNT_MAX, Math.round(v)) : null);
/** an amounts record from anything stored (the reader's storage can hold anything) */
export const cleanAmounts = (x: unknown): Amounts => {
  const o = (x ?? {}) as Partial<Amounts>;
  const balance = num(o.balance);
  // a deposit without a balance is not kept: the example applies until a balance is typed
  return { balance, monthly: balance == null ? null : num(o.monthly) };
};
const catOf = (f: { prod: string; track: string }) => `${f.prod} | ${f.track}`;

/** The record a page gets (§17.2 key rule). */
export function resolveAmounts(t: AmountsTarget, mine: readonly MyProduct[] | null | undefined, kind: KindStore | null | undefined): Resolved {
  const list = Array.isArray(mine) ? mine.filter((m) => m && typeof m.k === 'string') : [];
  const fromMine = (m: MyProduct): Resolved => ({ where: 'mine', k: m.k, prod: t.prod ?? null, amounts: cleanAmounts(m) });
  if (t.k) {
    const m = list.find((x) => x.k === t.k);
    if (m) return fromMine(m);
    if (!t.cat) return { where: 'none', k: null, prod: t.prod ?? null, amounts: { balance: null, monthly: null } };
  }
  if (t.cat && t.funds) {
    const byK = new Map(t.funds.map((f) => [f.k, f]));
    const m = list.find((x) => { const f = byK.get(x.k); return !!f && catOf(f) === t.cat; });
    if (m) return fromMine(m);
  }
  const prod = t.prod ?? (t.cat ? t.cat.split(' | ')[0] : null);
  if (!prod) return { where: 'none', k: null, prod: null, amounts: { balance: null, monthly: null } };
  const store = kind && typeof kind === 'object' ? kind : {};
  return { where: 'kind', k: null, prod, amounts: cleanAmounts(store[prod]) };
}

/** the saved list with one product's amounts written (balance null: both removed) */
export function withMineAmounts(mine: readonly MyProduct[], k: string, a: Amounts): MyProduct[] {
  const c = cleanAmounts(a);
  return mine.map((m) => {
    if (m.k !== k) return m;
    const { balance: _b, monthly: _m, ...rest } = m;
    return c.balance == null ? { ...rest } as MyProduct : { ...rest, balance: c.balance, monthly: c.monthly } as MyProduct;
  });
}
/** the product-kind store with one product's amounts written (balance null: the entry removed) */
export function withKindAmounts(kind: KindStore | null | undefined, prod: string, a: Amounts): KindStore {
  const c = cleanAmounts(a), out: KindStore = { ...(kind && typeof kind === 'object' ? kind : {}) };
  if (c.balance == null) delete out[prod]; else out[prod] = c;
  return out;
}
/** the FeeBase of lib/feeExample: null on the example; else the balance and the deposit (null: the product's example deposit) */
export const amountsBase = (a: Amounts): FeeBase | null => (a.balance == null ? null : { balance: a.balance, monthly: a.monthly });

/* ---------- storage, with a session overlay when the browser blocks it ---------- */

const overlay = new Map<string, unknown>();
const announce = (key: string) => window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
const readKey = <T,>(key: string, init: T): T => (overlay.has(key) ? (overlay.get(key) as T) : readStored<T>(key, init));
/** write one key; false when the browser refused (the value is kept for this tab only) */
function writeKey(key: string, value: unknown): boolean {
  let ok = true;
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); overlay.delete(key); } catch { ok = false; overlay.set(key, value); }
  announce(key);
  return ok;
}
const keysOf = (pid: ProfileId) => ({ mine: keyFor(MINE_KEY, pid), kind: keyFor(FEES_AMOUNTS_KEY, pid) });

/** Write a resolved record's amounts (outside React too: the import flow, tests). */
export function saveAmounts(pid: ProfileId, r: Pick<Resolved, 'where' | 'k' | 'prod'>, a: Amounts): SaveResult {
  const ks = keysOf(pid), clear = cleanAmounts(a).balance == null;
  let ok: boolean;
  if (r.where === 'mine' && r.k) ok = writeKey(ks.mine, withMineAmounts(readKey<MyProduct[]>(ks.mine, []), r.k, a));
  else if (r.prod) ok = writeKey(ks.kind, withKindAmounts(readKey<KindStore>(ks.kind, {}), r.prod, a));
  else return 'blocked';
  return !ok ? 'blocked' : clear ? 'cleared' : 'saved';
}

/** The one reader of the reader's own amounts (§17.2). */
export function useMyAmounts(target: AmountsTarget): MyAmounts {
  const pid = useActiveProfile();
  const ks = keysOf(pid);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = (e: Event) => { const k = (e as CustomEvent<string>).detail; if (k === ks.mine || k === ks.kind) setTick((n) => n + 1); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [ks.mine, ks.kind]);
  const fundsSig = target.funds ? target.funds.length : 0;
  const r = useMemo(
    () => resolveAmounts(target, readKey<MyProduct[]>(ks.mine, []), readKey<KindStore>(ks.kind, {})),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, ks.mine, ks.kind, target.k, target.prod, target.cat, fundsSig],
  );
  const set = useCallback((a: Amounts) => saveAmounts(pid, r, a), [pid, r]);
  const clear = useCallback(() => saveAmounts(pid, r, { balance: null, monthly: null }), [pid, r]);
  const { balance, monthly } = r.amounts;
  return { balance, monthly, own: balance != null, depositOwn: balance != null && monthly != null, base: amountsBase(r.amounts), where: r.where, k: r.k, set, clear };
}
