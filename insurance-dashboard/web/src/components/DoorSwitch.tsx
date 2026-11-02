import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DOORS, type Door } from '../lib/door';
import { Ico } from './home/glyphs';

/* W1 shell: the door switcher in the top bar. On a wide screen a compact segmented control (חוסך | סוכן | Pro) and a button back to
   the picker; on the phone, where the search needs the width, one pill with the current door that opens the same choices as a menu.
   Switching keeps the current page (the rail and the bottom bar follow the door); the picker button goes home. */
export function DoorSwitch({ door, setDoor }: { door: Door | null; setDoor: (d: Door | null) => void }) {
  const nav = useNavigate();
  const pick = () => { setDoor(null); nav('/'); };
  return (
    <>
      <div className="door-sw" role="group" aria-label="דלת: למי האתר מותאם">
        {DOORS.map(([d, label, line]) => <button key={d} type="button" aria-pressed={door === d} title={line} onClick={() => setDoor(d)}>{label}</button>)}
        <button type="button" className="door-sw-all" aria-label="כל הדלתות: חזרה לבחירה" title="כל הדלתות: חזרה לבחירה" onClick={pick}><Ico name="doors" /></button>
      </div>
      <DoorMenu door={door} setDoor={setDoor} pick={pick} />
    </>
  );
}

function DoorMenu({ door, setDoor, pick }: { door: Door | null; setDoor: (d: Door | null) => void; pick: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId(), btn = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  useEffect(() => {
    if (!open) return;
    (items().find((el) => el.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
    const away = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    const all = items(), i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); all[e.key === 'Home' ? 0 : all.length - 1]?.focus(); }
    else if (e.key === 'Tab') close(false);
  };
  const cur = DOORS.find(([d]) => d === door);
  return (
    <div className="door-m">
      <button ref={btn} type="button" className="door-pill" aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={`דלת: ${cur ? cur[1] : 'לא נבחרה'}. החלפה`} onClick={() => setOpen((o) => !o)}>
        <span>{cur ? cur[1] : 'בחירת דלת'}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
      </button>
      {open && (
        <div ref={menu} id={id} className="door-menu" role="menu" aria-label="דלת" onKeyDown={onKey}>
          {DOORS.map(([d, label, line]) => (
            <button key={d} type="button" role="menuitemradio" aria-checked={door === d} tabIndex={-1} onClick={() => { setDoor(d); close(); }}>
              <b>{label}</b><span>{line}</span>
            </button>
          ))}
          <button type="button" role="menuitem" tabIndex={-1} className="door-menu-all" onClick={() => { close(false); pick(); }}><Ico name="doors" />כל הדלתות</button>
        </div>
      )}
    </div>
  );
}
