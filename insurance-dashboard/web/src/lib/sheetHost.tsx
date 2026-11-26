import { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { parseSheet, sheetParam } from '../pages/FundsCompare';
import type { SheetId } from '../pages/compare/contract';
import '../styles/rollout.css';

/* The `?sheet=` state of a page (rollout spec §2.3, T-N1), so the card, the screener, /my, the hub and the fees tool can mount compare's
   sheets (MonthSheet, FeeSheet, TrackSheet, WhySheet, DisplaySheet…) and their own (the type-month sheet, the amounts sheet).
   - The address holds the open sheet: compare's ids through compare's own parseSheet / sheetParam ("month:202610", "fee", "track:p2102",
     "why"…), and a page's own ids as plain strings ("type:202610", "amounts:p2102", "plain"). Written with replace, so a sheet never
     adds a page to the history; the sheet itself (DeeperSheet → useSheetHistory) adds the one entry Back closes, as on compare.
   - Back, the phone's gesture and Escape close a sheet (useSheetHistory), which calls the sheet's onClose = closeSheet.
   - `cmp` is the parsed compare id (null for a page's own id), ready for `{sheet.cmp?.t === 'month' && <MonthSheet … />}`.
   - `toast(text)`: the short notice after a save ("נשמר בדפדפן הזה"), outside React so it outlives the sheet that raised it. */

export interface SheetHost {
  /** the raw ?sheet= value, or null */
  sheet: string | null;
  /** the same, parsed as one of compare's sheets (null when it is a page's own id or none) */
  cmp: SheetId | null;
  /** open a sheet: a compare SheetId (CmpCtx.openSheet-compatible) or a page's own id string */
  openSheet: (s: SheetId | string) => void;
  closeSheet: () => void;
  /** a page's own id with an argument: "type:202610" → ["type", "202610"] */
  own: [string, string] | null;
}

/** write params into the address, read fresh at call time (a sheet may have changed it), always replace (lenses and sheets never push) */
export function useAddressWrite() {
  const nav = useNavigate();
  return useCallback((patch: Record<string, string | null>) => {
    const n = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([k, v]) => (v == null ? n.delete(k) : n.set(k, v)));
    const s = n.toString();
    nav({ search: s ? `?${s}` : '', hash: window.location.hash }, { replace: true, state: window.history.state?.usr });
  }, [nav]);
}

export function useSheetHost(): SheetHost {
  const [sp] = useSearchParams();
  const write = useAddressWrite();
  const sheet = sp.get('sheet');
  const openSheet = useCallback((s: SheetId | string) => write({ sheet: typeof s === 'string' ? s : sheetParam(s) }), [write]);
  const closeSheet = useCallback(() => write({ sheet: null }), [write]);
  return useMemo(() => {
    const cmp = parseSheet(sheet);
    const own: [string, string] | null = sheet && !cmp ? [sheet.split(':')[0], sheet.slice(sheet.indexOf(':') + 1 || sheet.length)] : null;
    return { sheet, cmp, openSheet, closeSheet, own };
  }, [sheet, openSheet, closeSheet]);
}

/* ---------- the short notice ---------- */
let timer: ReturnType<typeof setTimeout> | null = null;
/** A short notice at the bottom of the screen (role=status; read by screen readers), gone after `ms`. One at a time. */
export function toast(text: string, ms = 2600): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('ro-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ro-toast'; el.className = 'ro-toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { el?.classList.remove('on'); timer = null; }, ms);
}
