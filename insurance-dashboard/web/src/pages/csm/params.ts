import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** A picker held in the URL next to `?view=`, so every state of the ledger is a link. The default value is left out of the URL. */
export function useParam<T extends string>(key: string, def: T, allowed?: readonly T[]): [T, (v: T) => void] {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get(key) as T | null;
  const v = raw != null && (!allowed || allowed.includes(raw)) ? raw : def;
  const set = useCallback((x: T) => setSp((prev) => { const n = new URLSearchParams(prev); if (x === def) n.delete(key); else n.set(key, x); return n; }, { replace: true }), [key, def, setSp]);
  return [v, set];
}
