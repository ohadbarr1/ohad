import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSheetHistory } from './Sheet';
import '../styles/sheet.css';

/* <DeeperSheet>: the L1/L2 container (spec §3.1, §5.3, F6). Extends <Sheet>: the same history behaviour (useSheetHistory: Back, the
   phone's gesture and Escape close it; a tap on the dimmed page closes it; an address a control in the sheet wrote is kept on close), plus
   a title with a sub-title, an optional strip fixed under the head (the picker's search), a pinned footer, a detent ('auto' grows with
   the content up to 88% of the screen; 'full' is 94%), accordion sections (<SheetSection>), a focus trap and focus restored on close.
   Rises in 320 ms; no motion under prefers-reduced-motion. The title is the question or the object ("אוקטובר 2026", "דמי ניהול, בשקלים"). */

export interface DeeperSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  label?: string;              // the dialog's accessible name when the title is not plain text
  sub?: ReactNode;             // the line under the title
  lead?: ReactNode;            // before the title (a track's colour square)
  sticky?: ReactNode;          // fixed under the head, outside the scrolling body
  footer?: ReactNode;          // pinned at the bottom
  detent?: 'auto' | 'full';
  id?: string;
  bodyId?: string;
  initialFocus?: 'dialog' | 'close' | 'first' | 'none';  // default 'dialog' (the sheet itself, no ring on a phone; Tab then walks its controls); 'first' = the first control in the sticky strip or body (the picker's search)
  children: ReactNode;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
/** FOCUSABLE inside one part of the sheet: every alternative of the list scoped (a bare prefix would scope only the first one) */
const within = (scope: string) => FOCUSABLE.split(',').map((x) => `${scope} ${x}`).join(',');
/** the first visible control of the sticky strip, else of the body (the picker's search field #pkq) */
function firstControl(el: HTMLElement): HTMLElement | null {
  for (const scope of ['.dsheet-sticky', '.dsheet-b']) {
    const f = [...el.querySelectorAll<HTMLElement>(within(scope))].find((x) => x.getClientRects().length > 0);
    if (f) return f;
  }
  return null;
}

export function DeeperSheet({ open, onClose, title, label, sub, lead, sticky, footer, detent = 'auto', id, bodyId, initialFocus = 'dialog', children }: DeeperSheetProps) {
  useSheetHistory(open, onClose);
  const ref = useRef<HTMLDivElement>(null);
  const tid = `dsh-${useId().replace(/:/g, '')}`;
  // focus: into the sheet on open, held inside while open, back to the control that opened it on close
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && initialFocus !== 'none') {
      const target = initialFocus === 'first' ? firstControl(el) : initialFocus === 'close' ? el.querySelector<HTMLElement>('.dsheet-x') : null;
      (target ?? el).focus({ preventScroll: true });
    }
    // Tab and Shift+Tab walk the sheet's own controls in a loop (moved by hand: WebKit would otherwise leave the sheet for the page)
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0);
      e.preventDefault();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      const next = i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
      f[next].focus();
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (prev && document.contains(prev)) prev.focus({ preventScroll: true }); };
  }, [open, initialFocus]);
  if (!open) return null;
  return createPortal(
    <div className="sheetwrap dsheet-wrap" onClick={(e) => { if (e.target === e.currentTarget) history.back(); }}>
      <div ref={ref} className={`sheet dsheet${detent === 'full' ? ' full' : ''}`} role="dialog" aria-modal="true" id={id}
        aria-labelledby={label ? undefined : tid} aria-label={label} aria-describedby={sub ? `${tid}-s` : undefined} tabIndex={-1}>
        <span className="grip" aria-hidden="true" />
        <div className="dsheet-h">
          {lead}
          <h2><span id={tid}>{title}</span>{sub ? <small id={`${tid}-s`}>{sub}</small> : null}</h2>
          <button type="button" className="dsheet-x" onClick={() => history.back()} aria-label="סגירה">×</button>
        </div>
        {sticky ? <div className="dsheet-sticky">{sticky}</div> : null}
        <div className="dsheet-b" id={bodyId}>{children}</div>
        {footer ? <div className="dsheet-f">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** An accordion section inside a sheet ("כמה הרוויח", "כמה זה עולה"): a 44-px summary row, open by default when `open` */
export function SheetSection({ title, open = false, id, children }: { title: ReactNode; open?: boolean; id?: string; children: ReactNode }) {
  return (
    <details className="dsec" open={open} id={id}>
      <summary>{title}</summary>
      <div className="in">{children}</div>
    </details>
  );
}

/** The track's colour square before a sheet title */
export const SheetSwatch = ({ color }: { color: string }) => <i className="dsheet-sw" style={{ '--c': color } as CSSProperties} aria-hidden="true" />;
