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

/** A sheet whose effect was torn down while its history entry is still on top: the entry goes (history.back()) only after the current
 *  commit, so a sheet that opens in the same commit adopts it instead of pushing another one. That is React StrictMode's dev re-run of
 *  the effect (a deep-linked ?sheet= stayed open in production but was closed in dev: the cleanup's back() popped the re-run's entry),
 *  and one sheet replacing another (the fee sheet's "איך מחשבים?" opens the why sheet over the same entry). */
let handoff: { timer: ReturnType<typeof setTimeout>; base: string | null; idx: unknown; last: Location | null } | null = null;

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
  const baseIdx = useRef<unknown>(null);         // its router index (a replace over the sheet's entry keeps it; a push adds one)
  const last = useRef<Location | null>(null);    // the last address the sheet's pickers set while it was open
  const locRef = useRef(loc); locRef.current = loc;
  // a location with another key than the page's entry is one the sheet's entry now holds (back on the page's entry the key is base again)
  useLayoutEffect(() => { if (open && base.current != null && loc.key !== base.current) last.current = loc; }, [open, loc]);
  useEffect(() => {
    if (!open) return;
    closing.current = false;
    if (handoff) {
      // the entry of a sheet torn down in this commit is still on top: adopt it, with the page's entry under it and what was written there
      clearTimeout(handoff.timer);
      base.current = handoff.base; baseIdx.current = handoff.idx; last.current = handoff.last;
      if (base.current != null && locRef.current.key !== base.current) last.current = locRef.current;
      handoff = null;
    } else {
      base.current = locRef.current.key; baseIdx.current = history.state?.idx; last.current = null;
      history.pushState({ ...(history.state ?? {}), sheet: true }, '');
    }
    // back on the page's entry: carry the sheet's choices down to it
    const carry = () => {
      const t = last.current; last.current = null; base.current = null;
      if (t) navRef.current({ pathname: t.pathname, search: t.search, hash: t.hash }, { replace: true, state: t.state });
    };
    const pop = () => { closing.current = true; carry(); close.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') history.back(); };
    // capture phase: before the router's own popstate listener. That one re-renders the page in the microtask checkpoint that follows
    // it, and a sheet the popped address no longer names (the why sheet opened over the fee sheet) was unmounted with its listener
    // before it could close: the page's entry still said sheet=fee and the fee sheet came back
    addEventListener('popstate', pop, true); addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('popstate', pop, true); removeEventListener('keydown', key);
      document.body.style.overflow = '';
      if (closing.current) return;
      // our entry was already popped (Back), and the page re-rendered before our listener ran (Chrome runs the router's listener first
      // even against a capturing one): we are on the page's own entry, so close as `pop` would have
      const now = history.state as { sheet?: boolean; key?: string } | null;
      if (base.current != null && now?.key === base.current && !now?.sheet) { closing.current = true; carry(); close.current(); return; }
      // closed by the page itself: drop the history entry the sheet added (its `sheet` flag; or an address written over it with replace,
      // which drops the flag: another key than the page's entry at the page's index, a push would have added one) and carry the choices
      // down once back. Deferred past this commit: a sheet opening in it adopts the entry instead (the handoff above)
      const st = history.state as { sheet?: boolean; key?: string; idx?: unknown } | null;
      const ours = !!st?.sheet || (last.current != null && st?.key === last.current.key) || (base.current != null && st?.key != null && st.key !== base.current && st.idx === baseIdx.current);
      if (!ours) { last.current = null; base.current = null; return; }
      const h = { base: base.current, idx: baseIdx.current, last: last.current, timer: 0 as unknown as ReturnType<typeof setTimeout> };
      h.timer = setTimeout(() => {
        if (handoff === h) handoff = null;
        const t = h.last;
        const down = () => { if (t) navRef.current({ pathname: t.pathname, search: t.search, hash: t.hash }, { replace: true, state: t.state }); };
        addEventListener('popstate', down, { once: true });
        history.back();
      }, 0);
      handoff = h;
    };
  }, [open]);
}

/** Close the open sheet from a button inside it, then act on the page (the picker's "להשוואה", the track sheet's "הסרה"): go back over the
 *  sheet's history entry first, and run `then` once back on the page's entry, after the sheet's own close has cleared its state. A write
 *  made before the back (setKeys, then history.back()) raced it: the new keys swap the page's layout and remount the sheet, and the late
 *  popstate landed on the page's entry without them (the empty compare screen bounced back to ?sheet=picker). */
export function backThen(then: () => void): void {
  addEventListener('popstate', () => then(), { once: true });
  history.back();
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
