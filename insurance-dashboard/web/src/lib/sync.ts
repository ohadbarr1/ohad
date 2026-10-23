/* The sync engine: the reader's stored keys (lib/local, prefix fox:) mirrored to one remote store per user, last write wins per key,
   with an offline queue. Pure: it talks to a LocalStore and a SyncAdapter, so the same code runs against localStorage + Firestore in
   the browser and against two in-memory "devices" in the test (tests/sync.test.ts).

   Per key the engine keeps a stamp {t: ms, d: device, h: hash of the text}. A key whose text no longer matches its hash was written
   here since (by useStored or by a raw localStorage writer such as the recent-pages list): it is stamped now and queued. A remote
   entry wins when its stamp is newer (t, then device id as the tie-break). Removal is an entry with v = null (a tombstone), so it
   travels like any other write. The first time two devices meet, list-valued keys (watchlist, saved views, peer sets) are united
   instead of one side replacing the other. */

export interface Entry { v: string | null; t: number; d: string }
export type Entries = Record<string, Entry>;

export interface SyncAdapter {
  /** every entry the user has */
  pull(): Promise<Entries>;
  /** writes entries; the store keeps the newer stamp per key and refuses an older one (Firestore: the rules). Resolves with the keys
   *  it refused; rejects when the store cannot be reached (offline), which leaves everything queued. */
  push(entries: Entries): Promise<string[]>;
}

export interface Stamp { t: number; d: string; h: number; s?: 1 }
export interface LocalStore {
  /** keys present locally (no prefix), those not to be synced already left out */
  keys(): string[];
  get(key: string): string | null;
  /** writes the raw text (null: removes) and tells the page */
  set(key: string, v: string | null): void;
  loadState(): { stamps: Record<string, Stamp>; queue: string[] };
  saveState(s: { stamps: Record<string, Stamp>; queue: string[] }): void;
}

export interface SyncStatus { state: 'idle' | 'syncing' | 'offline' | 'error'; last: number | null; queued: number; error?: string }

/** 32-bit FNV-1a of the text; -1 for "absent" */
export function hash(s: string | null): number {
  if (s == null) return -1;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const newer = (a: { t: number; d: string }, b: { t: number; d: string }) => a.t > b.t || (a.t === b.t && a.d > b.d);

/** the union of two lists, local first; items equal by id, else by name, else by their text */
function unite(local: string, remote: string): string | null {
  try {
    const a = JSON.parse(local) as unknown, b = JSON.parse(remote) as unknown;
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    const id = (x: unknown) => (x && typeof x === 'object' ? ('id' in x ? `id:${String((x as { id: unknown }).id)}` : 'n' in x ? `n:${String((x as { n: unknown }).n)}` : 'p' in x ? `p:${String((x as { p: unknown }).p)}` : JSON.stringify(x)) : JSON.stringify(x));
    const seen = new Set(a.map(id));
    return JSON.stringify([...a, ...b.filter((x) => !seen.has(id(x)))]);
  } catch { return null; }
}

export class SyncEngine {
  private stamps: Record<string, Stamp>;
  private queue: Set<string>;
  private busy: Promise<void> | null = null;
  private listeners = new Set<(s: SyncStatus) => void>();
  status: SyncStatus = { state: 'idle', last: null, queued: 0 };

  constructor(private local: LocalStore, private remote: SyncAdapter, private device: string, private now: () => number = Date.now) {
    const s = local.loadState();
    this.stamps = s.stamps; this.queue = new Set(s.queue);
  }

  onStatus(cb: (s: SyncStatus) => void): () => void { this.listeners.add(cb); cb(this.status); return () => this.listeners.delete(cb); }
  private emit(patch: Partial<SyncStatus>) { this.status = { ...this.status, ...patch, queued: this.queue.size }; this.listeners.forEach((f) => f(this.status)); }
  private save() { this.local.saveState({ stamps: this.stamps, queue: [...this.queue] }); }

  /** stamps what changed here since the last look; returns how many keys it queued */
  scan(only?: string): number {
    let n = 0;
    const keys = only != null ? [only] : [...new Set([...this.local.keys(), ...Object.keys(this.stamps)])];
    for (const k of keys) {
      const v = this.local.get(k), h = hash(v), st = this.stamps[k];
      if (st ? st.h === h : v == null) continue;
      this.stamps[k] = { t: Math.max(this.now(), (st?.t ?? 0) + 1), d: this.device, h, ...(st?.s ? { s: 1 as const } : {}) };
      this.queue.add(k); n++;
    }
    if (n) { this.save(); this.emit({}); }
    return n;
  }

  /** takes in what the remote store holds: newer entries are written here, newer local ones queued */
  merge(remote: Entries): void {
    for (const [k, r] of Object.entries(remote)) {
      const st = this.stamps[k];
      const lv = this.local.get(k);
      if (st && !st.s && lv != null && r.v != null) {
        // first meeting of this key on this device: lists are united, the rest is last write wins
        const u = unite(lv, r.v);
        if (u != null) {
          // the stamp first: writing the value tells the page, and the page's listener must not take it for a local edit
          if (u === r.v) { this.stamps[k] = { t: r.t, d: r.d, h: hash(u), s: 1 }; this.queue.delete(k); this.local.set(k, u); }
          else { this.stamps[k] = { t: Math.max(this.now(), r.t + 1), d: this.device, h: hash(u), s: 1 }; this.queue.add(k); if (u !== lv) this.local.set(k, u); }
          continue;
        }
      }
      if (!st || newer(r, st)) {
        this.stamps[k] = { t: r.t, d: r.d, h: hash(r.v), s: 1 };
        this.queue.delete(k);
        if (lv !== r.v) this.local.set(k, r.v);
      } else if (newer(st, r)) this.queue.add(k);
      else this.stamps[k] = { ...st, s: 1 };
    }
    // keys the remote store has never seen
    for (const k of Object.keys(this.stamps)) if (!(k in remote) && !this.stamps[k].s) this.queue.add(k);
    this.save(); this.emit({});
  }

  /** sends the queue; one run at a time */
  flush(): Promise<void> {
    if (this.busy) return this.busy.then(() => (this.queue.size ? this.flush() : undefined));
    this.busy = this.run().finally(() => { this.busy = null; });
    return this.busy;
  }

  private async run(): Promise<void> {
    this.scan();
    if (!this.queue.size) { this.emit({ state: 'idle' }); return; }
    const keys = [...this.queue], out: Entries = {};
    for (const k of keys) { const st = this.stamps[k]; out[k] = { v: this.local.get(k), t: st.t, d: st.d }; }
    this.emit({ state: 'syncing' });
    let refused: string[];
    try { refused = await this.remote.push(out); } catch (e) { this.emit({ state: 'offline', error: String((e as Error)?.message ?? e) }); return; }
    for (const k of keys) {
      if (refused.includes(k)) continue;
      const st = this.stamps[k];
      if (st && st.t === out[k].t && st.d === out[k].d) { this.stamps[k] = { ...st, s: 1 }; this.queue.delete(k); }
    }
    this.save();
    if (refused.length) {
      // the store holds something newer than what was sent: take it in
      try { const r = await this.remote.pull(); const sub: Entries = {}; refused.forEach((k) => { if (r[k]) sub[k] = r[k]; }); this.merge(sub); } catch { this.emit({ state: 'offline' }); return; }
      const stuck = refused.filter((k) => this.queue.has(k));
      if (stuck.length) { stuck.forEach((k) => this.queue.delete(k)); this.save(); this.emit({ state: 'error', error: `נדחו: ${stuck.join(', ')}` }); return; }
    }
    this.emit({ state: 'idle', last: this.now(), error: undefined });
  }

  /** a full round: look for local changes, take in the remote store, send what is newer here */
  async sync(): Promise<void> {
    this.scan();
    this.emit({ state: 'syncing' });
    let r: Entries;
    try { r = await this.remote.pull(); } catch (e) { this.emit({ state: 'offline', error: String((e as Error)?.message ?? e) }); return; }
    this.merge(r);
    await this.flush();
  }

  /** forget this device's stamps (sign-out): the stored values stay, the next sign-in meets them as new */
  reset(): void { this.stamps = {}; this.queue.clear(); this.save(); this.emit({ state: 'idle', last: null }); }
}

/* ---------- the browser: localStorage as the LocalStore ---------- */
const STATE = 'foxsync:state';

export function browserStore(prefix: string, event: string, skip: (key: string) => boolean): LocalStore {
  return {
    keys() {
      const out: string[] = [];
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix) && !skip(k.slice(prefix.length))) out.push(k.slice(prefix.length)); } } catch { /* blocked */ }
      return out;
    },
    get(k) { if (skip(k)) return null; try { return localStorage.getItem(prefix + k); } catch { return null; } },
    set(k, v) {
      try { if (v == null) localStorage.removeItem(prefix + k); else localStorage.setItem(prefix + k, v); } catch { /* blocked */ }
      window.dispatchEvent(new CustomEvent(event, { detail: k }));
    },
    loadState() { try { const s = JSON.parse(localStorage.getItem(STATE) ?? 'null'); if (s?.stamps) return { stamps: s.stamps, queue: s.queue ?? [] }; } catch { /* fresh */ } return { stamps: {}, queue: [] }; },
    saveState(s) { try { localStorage.setItem(STATE, JSON.stringify(s)); } catch { /* blocked */ } },
  };
}

/** this browser's id (tie-break between two writes in the same millisecond) */
export function deviceId(): string {
  try {
    let d = localStorage.getItem('foxsync:device');
    if (!d) { d = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); localStorage.setItem('foxsync:device', d); }
    return d;
  } catch { return 'nostore'; }
}

/** Runs an engine in the page: local writes go out within seconds, the remote store is read when the page comes back into view,
 *  every minute while it is in view, and when the network returns; a page being hidden sends what is queued. Returns a stop. */
export function runInPage(engine: SyncEngine, event: string, skip: (key: string) => boolean): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; void engine.flush(); }, 1500); };
  const onWrite = (e: Event) => { const k = (e as CustomEvent<string>).detail; if (typeof k === 'string' && !skip(k) && engine.scan(k)) soon(); };
  const onVis = () => { if (document.visibilityState === 'visible') void engine.sync(); else void engine.flush(); };
  const onOnline = () => void engine.sync();
  const tick = setInterval(() => { if (document.visibilityState === 'visible') void engine.sync(); }, 60_000);
  window.addEventListener(event, onWrite);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', onOnline);
  void engine.sync();
  return () => {
    if (timer) clearTimeout(timer);
    clearInterval(tick);
    window.removeEventListener(event, onWrite);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('online', onOnline);
  };
}
