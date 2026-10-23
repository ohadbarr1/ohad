import { useCallback, useEffect, useState } from 'react';
import { SYNC_ENABLED } from './syncConfig';

export const PREFIX = 'fox:';
export const EVENT = 'fox:stored';

function read<T>(key: string, init: T): T {
  try { const raw = localStorage.getItem(PREFIX + key); return raw == null ? init : (JSON.parse(raw) as T); } catch { return init; }
}
const announce = (key: string) => window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));

/** A value kept in this browser's storage and shared between the components that use the same key. Local first: when the reader
 *  signs in (lib/auth, behind SYNC_ENABLED) the same keys follow them to their other devices; until then nothing is sent anywhere. */
export function useStored<T>(key: string, init: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, init));
  useEffect(() => {
    setValue(read(key, init));
    const sync = (e: Event) => { if ((e as CustomEvent<string>).detail === key) setValue(read(key, init)); };
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback((next: T) => {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(next)); } catch { /* storage may be blocked */ }
    setValue(next);
    announce(key);
  }, [key]);
  return [value, set];
}

/** Companies the user follows. */
export function useWatchlist(): { has: (id: string) => boolean; toggle: (id: string) => void; ids: string[] } {
  const [ids, set] = useStored<string[]>('watch', []);
  return { ids, has: (id) => ids.includes(id), toggle: (id) => set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]) };
}

/* ---------- outside a component: "שלי", notes, sync ---------- */

/** The value under a key, or `init`. */
export const readStored = <T,>(key: string, init: T): T => read(key, init);

/** Writes (or, with undefined, removes) a key and tells every component that shows it. */
export function writeStored(key: string, value: unknown): void {
  try { if (value === undefined) localStorage.removeItem(PREFIX + key); else localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage may be blocked */ }
  announce(key);
}

/** Every stored key (without the prefix), optionally only those starting with `start`. */
export function storedKeys(start = ''): string[] {
  const out: string[] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX + start)) out.push(k.slice(PREFIX.length)); } } catch { /* storage may be blocked */ }
  return out.sort();
}

/** Re-renders when any stored key (optionally: one starting with `start`) changes, here, in another tab, or from another device. */
export function useStoreTick(start = ''): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = (e: Event) => { const k = (e as CustomEvent<string>).detail; if (typeof k !== 'string' || k.startsWith(start)) setN((x) => x + 1); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [start]);
  return n;
}

if (typeof window !== 'undefined') {
  // another tab wrote a key: the components here show it too
  window.addEventListener('storage', (e) => { if (e.key?.startsWith(PREFIX)) announce(e.key.slice(PREFIX.length)); });
  // a reader who signed in on this device: the sync layer resumes after the first paint (never before it, never for anyone else)
  if (SYNC_ENABLED) {
    let on = false;
    try { on = localStorage.getItem('foxsync:on') === '1'; } catch { /* storage may be blocked */ }
    if (on) {
      const go = () => { void import('./auth').then((a) => a.resume()); };
      if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 5000 }); else setTimeout(go, 2500);
    }
  }
}
