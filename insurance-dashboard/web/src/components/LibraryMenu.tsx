import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Ico } from './home/glyphs';
import '../styles/library.css';

/* P0 shell (fox 3.0 plan, 05.11.26): the Pro door's "ספרייה". The reference screens and the lab (models on assumptions, still under
   review) leave the rail's first rank and sit behind one entry: on the desktop rail a button that opens a panel beside it; on the phone's
   bottom bar the same button reads "עוד" and opens a sheet above the bar, which also carries the places the bar has no room for.
   Every address stays where it was; this only moves the way in. */

/** [address, label, coverage note] */
export const LIBRARY: [string, string, string?][] = [
  ['/presentations', 'מצגות משקיעים'],
  ['/debt', 'חוב ופירעונות'],
  ['/credibility', 'אמינות יעדים'],
  ['/holdings', 'הרכב נכסים', '5/15 מנהלים'],
  ['/book', 'ספר הגרפים'],
  ['/methodology#drivers', 'מנגנונים לכל חברה'],
  ['/data', 'נתונים ואיכות'],
];
/** the lab: models that stand on assumptions or have no track record yet */
export const LAB: [string, string][] = [
  ['/positions', 'עמדות'],
  ['/consolidation', 'מסך האיחודים'],
  ['/fragility', 'מוניטור שבריריות'],
  ['/brief', 'תדריכים'],
];
/** addresses that belong to the library (an address lit by a rail place keeps that place lit instead) */
export const LIB_PATHS = ['/presentations', '/debt', '/credibility', '/holdings', '/book', '/drivers', '/methodology', '/data', '/positions', '/consolidation', '/fragility', '/brief'];

/** the library entry: `more` is what the phone's sheet adds on top (the places hidden from the bottom bar) */
export function LibraryMenu({ lit, more }: { lit: boolean; more?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId(), box = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname, loc.hash]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const here = (to: string) => { const [p, h] = to.split('#'); return (loc.pathname === p || loc.pathname.startsWith(`${p}/`)) && (!h || loc.hash === `#${h}`); };
  const item = ([to, l, note]: [string, string, string?]) => (
    <li key={to}><Link to={to} aria-current={here(to) ? 'page' : undefined}>{l}{note && <span className="chip">{note}</span>}</Link></li>
  );
  return (
    <div className="lib" ref={box}>
      <button ref={btn} type="button" className={`item lib-btn${lit ? ' active' : ''}`} aria-expanded={open} aria-controls={id} aria-label="ספרייה ומעבדה" onClick={() => setOpen((o) => !o)}>
        <Ico name="library" /><span className="lbl-w">ספרייה</span><span className="lbl-p">עוד</span>
      </button>
      <div id={id} className="lib-pop" hidden={!open}>
        {more && <div className="lib-g lib-more" role="group" aria-labelledby={`${id}-m`}><span className="lib-h" id={`${id}-m`}>עוד מקומות</span><ul>{more}</ul></div>}
        <div className="lib-g" role="group" aria-labelledby={`${id}-l`}>
          <span className="lib-h" id={`${id}-l`}>ספרייה</span>
          <ul>{LIBRARY.map(item)}</ul>
        </div>
        <div className="lib-g lib-lab" role="group" aria-labelledby={`${id}-x`}>
          <span className="lib-h" id={`${id}-x`}>מעבדה <span className="lib-note">מודלים על הנחות, בבדיקה</span></span>
          <ul>{LAB.map(item)}</ul>
        </div>
      </div>
    </div>
  );
}
