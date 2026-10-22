import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The report a company page shows, kept in the address (?p=2026Q2): it follows the reader from tab to tab and survives a shared link. */
export function usePeriodParam(): [string, (p: string) => void] {
  const [sp, setSp] = useSearchParams();
  const p = sp.get('p') ?? '';
  const set = useCallback((v: string) => setSp((q) => { const n = new URLSearchParams(q); if (v) n.set('p', v); else n.delete('p'); return n; }, { replace: true }), [setSp]);
  return [p, set];
}
