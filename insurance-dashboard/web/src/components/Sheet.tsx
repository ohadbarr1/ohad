import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A bottom sheet for a phone: the page's pickers in one place, out of the way of the figures.
 *  Back (the button or the phone's gesture) closes it, as does Escape or a tap on the dimmed page. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const closing = useRef(false);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return;
    closing.current = false;
    history.pushState({ ...(history.state ?? {}), sheet: true }, '');
    const pop = () => { closing.current = true; close.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') history.back(); };
    addEventListener('popstate', pop); addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('popstate', pop); removeEventListener('keydown', key);
      document.body.style.overflow = '';
      if (!closing.current && history.state?.sheet) history.back();  // closed by the page itself: drop the history entry it added
    };
  }, [open]);
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
