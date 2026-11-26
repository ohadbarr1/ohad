import type { CSSProperties } from 'react';
import '../styles/compare.css';

/* <TrackBar>: the entities on screen as chips (spec §4.3 item 2, §5.3, v3 §10A.2 C7). 44-px chips: the track's colour square, the short
   name, a "שלי" badge for the reader's own track, "נסגר" for a closed one; a tap opens the track sheet. "＋ מסלול" at the end, only when
   onAdd is given (the shell leaves it out at the door's cap). The row scrolls sideways up to three chips and wraps above three. */

export interface TrackBarItem { k: string; label: string; color: string; mine?: boolean; closed?: boolean }
export interface TrackBarProps {
  items: TrackBarItem[];
  onOpen: (k: string) => void;
  onAdd?: () => void;
  addLabel?: string;          // default "＋ מסלול"
  wrap?: boolean;             // default: items.length > 3
  id?: string;                // default "trackbar"
}

export function TrackBar({ items, onOpen, onAdd, addLabel = '＋ מסלול', wrap, id = 'trackbar' }: TrackBarProps) {
  const w = wrap ?? items.length > 3;
  return (
    <div className={`trackbar${w ? ' wrap' : ''}`} id={id}>
      {items.map((t) => (
        <button key={t.k} type="button" className={`tchip${t.closed ? ' closed' : ''}`} style={{ '--c': t.color } as CSSProperties} onClick={() => onOpen(t.k)} aria-haspopup="dialog">
          <i className="dot" aria-hidden="true" />{t.label}
          {t.mine ? <span className="mine">שלי</span> : null}
          {t.closed ? <span className="tag">נסגר</span> : null}
        </button>
      ))}
      {onAdd ? <button type="button" className="tchip add" id="add-track" onClick={onAdd} aria-label="מסלול נוסף">{addLabel}</button> : null}
    </div>
  );
}
