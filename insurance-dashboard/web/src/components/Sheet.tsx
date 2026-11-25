import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, type Location } from 'react-router-dom';

/** A bottom sheet for a phone: the page's pickers in one place, out of the way of the figures.
 *  Back (the button or the phone's gesture) closes it, as does Escape or a tap on the dimmed page.
 *  The sheet adds a history entry over the page's own, so Back can close it. A picker in the sheet that writes the address (replace)
 *  writes that entry, and going back to close the sheet would land on the page's entry with the address it had before the sheet opened
 *  (the screener's period reverted to 5Y on "סגירה"). So the sheet keeps the last address set while it was open and, once back on the
 *  page's entry, writes it there (replace): the choices stay, and no extra history entry is left. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useSheetHistory(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="sheetwrap" onClick={(e) => { if (e.target === e.currentTarget) history.back(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-hd"><span className="grip" aria-hidden="true" /><b>{title}</b><button type="button" className="btn" onClick={() => history.back()}>סגירה</button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** The history behaviour of a phone sheet, shared by <Sheet> and <DeeperSheet>: while `open`, one history entry over the page's own, so
 *  Back (the button or the gesture) and Escape close it (call `history.back()` to close from a button or the scrim); the page's
 *  scroll is locked; an address a picker in the sheet wrote is carried down to the page's entry once the sheet closes. */
export function useSheetHistory(open: boolean, onClose: () => void) {
  const closing = useRef(false);
  const close = useRef(onClose); close.current = onClose;
  const loc = useLocation();
  const nav = useNavigate();
  const navRef = useRef(nav); navRef.current = nav;
  const base = useRef<string | null>(null);      // the router key of the page's entry under the sheet
  const last = useRef<Location | null>(null);    // the last address the sheet's pickers set while it was open
  const locRef = useRef(loc); locRef.current = loc;
  // a location with another key than the page's entry is one the sheet's entry now holds (back on the page's entry the key is base again)
  useLayoutEffect(() => { if (open && base.current != null && loc.key !== base.current) last.current = loc; }, [open, loc]);
  useEffect(() => {
    if (!open) return;
    closing.current = false;
    base.current = locRef.current.key; last.current = null;
    history.pushState({ ...(history.state ?? {}), sheet: true }, '');
    // back on the page's entry: carry the sheet's choices down to it
    const carry = () => {
      const t = last.current; last.current = null; base.current = null;
      if (t) navRef.current({ pathname: t.pathname, search: t.search, hash: t.hash }, { replace: true, state: t.state });
    };
    const pop = () => { closing.current = true; carry(); close.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') history.back(); };
    addEventListener('popstate', pop); addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('popstate', pop); removeEventListener('keydown', key);
      document.body.style.overflow = '';
      if (closing.current) return;
      // closed by the page itself: drop the history entry the sheet added (its `sheet` flag, or the key of the address a picker wrote
      // there: a replace drops the flag) and carry the choices down once back
      const ours = history.state?.sheet || (last.current != null && history.state?.key === last.current.key);
      if (ours) { addEventListener('popstate', carry, { once: true }); history.back(); } else { last.current = null; base.current = null; }
    };
  }, [open]);
}

/** The state of a page's pickers in one sticky line on a phone; a tap opens them in a sheet. */
export function ContextBar({ children, onOpen, label = 'שינוי' }: { children: ReactNode; onOpen: () => void; label?: string }) {
  return (
    <div className="ctxbar">
      <button type="button" className="ctxbar-in" onClick={onOpen} aria-haspopup="dialog">
        <span className="ctxbar-txt">{children}</span><span className="ctxbar-go">{label}</span>
      </button>
    </div>
  );
}
