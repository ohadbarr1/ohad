import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'fox:';
const EVENT = 'fox:stored';

function read<T>(key: string, init: T): T {
  try { const raw = localStorage.getItem(PREFIX + key); return raw == null ? init : (JSON.parse(raw) as T); } catch { return init; }
}

/** A value kept in this browser's storage and shared between the components that use the same key. Per device: nothing is sent anywhere. */
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
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
  }, [key]);
  return [value, set];
}

/** Companies the user follows. */
export function useWatchlist(): { has: (id: string) => boolean; toggle: (id: string) => void; ids: string[] } {
  const [ids, set] = useStored<string[]>('watch', []);
  return { ids, has: (id) => ids.includes(id), toggle: (id) => set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]) };
}
