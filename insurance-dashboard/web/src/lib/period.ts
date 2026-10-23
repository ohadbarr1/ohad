import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The report a company page shows, kept in the address (?p=2026Q2): it follows the reader from tab to tab and survives a shared link. */
export function usePeriodParam(): [string, (p: string) => void] {
  const [sp, setSp] = useSearchParams();
  const p = sp.get('p') ?? '';
  const set = useCallback((v: string) => setSp((q) => { const n = new URLSearchParams(q); if (v) n.set('p', v); else n.delete('p'); return n; }, { replace: true }), [setSp]);
  return [p, set];
}

/** The window a flow is read over: the quarter alone, the year to date (H1, 9M, FY), or the trailing twelve months. */
export type Win = 'q' | 'ytd' | 'ltm';
const WINS: Win[] = ['q', 'ytd', 'ltm'];
/** The window, kept in the address next to the report (?w=ytd); '' until the reader picks one, so each page can open on its own default. */
export function useWindowParam(): [Win | '', (w: Win | '') => void] {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('w') ?? '', w = (WINS as string[]).includes(raw) ? (raw as Win) : '';
  const set = useCallback((v: Win | '') => setSp((q) => { const n = new URLSearchParams(q); if (v) n.set('w', v); else n.delete('w'); return n; }, { replace: true }), [setSp]);
  return [w, set];
}

/** The report and window of an address, as a query string to carry into another company tab ('' when neither is set). */
export function keepPeriod(search: string): string {
  const q = new URLSearchParams(search), n = new URLSearchParams();
  for (const k of ['p', 'w']) { const v = q.get(k); if (v) n.set(k, v); }
  const s = n.toString();
  return s ? `?${s}` : '';
}
