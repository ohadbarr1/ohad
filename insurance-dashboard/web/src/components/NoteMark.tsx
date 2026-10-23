import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useParams } from 'react-router-dom';
import { factKey, NOTE_PREFIX, savedWhere, useNote } from '../lib/notes';
import { readStored, useStoreTick } from '../lib/local';
import { usePhone } from '../lib/useMedia';
import { Sheet } from './Sheet';
import '../styles/notes.css';

const here = (loc: { pathname: string; search: string }) => { const q = new URLSearchParams(loc.search); q.delete('src'); const s = q.toString(); return loc.pathname + (s ? `?${s}` : ''); };

interface Anchor {
  /** company id; defaults to the route's :id */
  co?: string;
  /** period label as on screen (Q2'26, FY'25) */
  p?: string;
  /** the metric's stable id on this surface (statement role, else the line or ledger label) */
  m: string;
  /** what the figure is called, for the note's header and for "שלי" */
  label?: string;
}

/** The note editor: a text box on one figure, saved as typed; an empty box removes the note. */
function Editor({ k, label, p, periods, onPeriod, autoFocus }: { k: string; label: string; p: string; periods?: string[]; onPeriod?: (p: string) => void; autoFocus?: boolean }) {
  const [note, setNote] = useNote(k);
  const loc = useLocation();
  const [text, setText] = useState(note?.t ?? '');
  useEffect(() => { setText(note?.t ?? ''); /* another figure, or another device wrote it */ }, [k, note?.t]);
  return (
    <div className="note-ed">
      <div className="note-ed-hd">
        <span className="note-ed-what">{label}</span>
        {periods && periods.length > 1 && onPeriod
          ? <select value={p} onChange={(e) => onPeriod(e.target.value)} aria-label="תקופה">{periods.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          : <span className="num">{p}</span>}
      </div>
      <textarea value={text} rows={3} autoFocus={autoFocus} placeholder="מה חשוב לזכור על המספר הזה" aria-label={`הערה על ${label} ${p}`}
        onChange={(e) => { setText(e.target.value); setNote(e.target.value, { l: label, href: here(loc) }); }} />
      <div className="note-ed-ft">
        <span>{note ? savedWhere() : 'ריק: אין הערה'}</span>
        {note && <button type="button" className="linkbtn" onClick={() => { setText(''); setNote(''); }}>מחיקה</button>}
      </div>
    </div>
  );
}

/** A popover beside its button on a wide screen. */
function Pop({ at, onClose, children, title }: { at: HTMLElement; onClose: () => void; children: React.ReactNode; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const place = useCallback(() => {
    const r = at.getBoundingClientRect(), w = Math.min(320, innerWidth - 16), h = ref.current?.offsetHeight ?? 180;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    const top = r.bottom + 8 + h > innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8;
    setPos({ top, left });
  }, [at]);
  useLayoutEffect(place, [place]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !at.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); at.focus(); } };
    addEventListener('mousedown', down); addEventListener('keydown', key);
    addEventListener('scroll', place, { passive: true, capture: true }); addEventListener('resize', place);
    return () => { removeEventListener('mousedown', down); removeEventListener('keydown', key); removeEventListener('scroll', place, { capture: true }); removeEventListener('resize', place); };
  }, [at, onClose, place]);
  return createPortal(<div ref={ref} className="note-pop" role="dialog" aria-label={title} style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}>{children}</div>, document.body);
}

/** The marker of a figure's note: a dot where a note exists (a tap opens it); with `add`, a quiet "+" that appears on the row's hover,
 *  for writing one. `periods` lets the "+" of a row pick the column. Renders nothing when there is no note and no `add`. */
export function NoteMark({ co, p, m, label, add = false, periods }: Anchor & { add?: boolean; periods?: string[] }) {
  const { id } = useParams();
  const company = co ?? id ?? '';
  const [per, setPer] = useState(p ?? periods?.[0] ?? '');
  useEffect(() => { setPer(p ?? periods?.[0] ?? ''); }, [p, periods?.[0]]);  // eslint-disable-line react-hooks/exhaustive-deps
  const k = company && per ? factKey(company, per, m) : null;
  const [note] = useNote(k);
  // a row's "+" shows the dot when any of its columns has a note
  const anyKey = !note && periods && company ? periods.map((x) => factKey(company, x, m)) : null;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const phone = usePhone();
  if (!k || (!note && !add)) return null;
  const name = label ?? m;
  const editor = <Editor k={k} label={name} p={per} periods={periods} onPeriod={setPer} autoFocus />;
  return (
    <>
      <button ref={btn} type="button" className={`notemark${note ? ' on' : ' add'}`} aria-expanded={open} aria-haspopup="dialog"
        aria-label={note ? `הערה על ${name} ${per}: ${note.t}` : `הוספת הערה על ${name}`} title={note ? note.t : 'הוספת הערה'}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}>
        {note ? <i aria-hidden="true" /> : <span aria-hidden="true">+</span>}
      </button>
      {anyKey && <AnyDot keys={anyKey} />}
      {open && (phone
        ? <Sheet open onClose={() => setOpen(false)} title="הערה">{editor}</Sheet>
        : btn.current && <Pop at={btn.current} onClose={() => setOpen(false)} title={`הערה על ${name}`}>{editor}</Pop>)}
    </>
  );
}

/** a dot for "some column of this row has a note" (read-only; the column's own marker opens it) */
function AnyDot({ keys }: { keys: string[] }) {
  useStoreTick(NOTE_PREFIX);
  const has = keys.some((k) => readStored(NOTE_PREFIX + k, null) != null);
  return has ? <span className="notemark-any" title="יש הערה באחת התקופות" aria-hidden="true" /> : null;
}

/** The note on one figure as an inline field: under a chart pane or in a phone sheet. */
export function NoteField({ co, p, m, label }: Anchor) {
  const { id } = useParams();
  const company = co ?? id ?? '';
  if (!company || !p) return null;
  return <div className="note-field"><Editor k={factKey(company, p, m)} label={label ?? m} p={p} /></div>;
}
