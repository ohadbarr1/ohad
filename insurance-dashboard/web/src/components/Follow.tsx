import { useStored, useWatchlist } from '../lib/local';

/** Star that adds a company to the follow list (kept in this browser). */
export function Star({ id, name }: { id: string; name: string }) {
  const w = useWatchlist();
  const on = w.has(id);
  return (
    <button type="button" className="star" aria-pressed={on} aria-label={on ? `הסר את ${name} מהמעקב` : `הוסף את ${name} למעקב`} title={on ? 'במעקב' : 'הוסף למעקב'}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); w.toggle(id); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z" /></svg>
    </button>
  );
}

/** Free-text notes on one company, saved as typed in this browser. */
export function Notes({ id }: { id: string }) {
  const [text, setText] = useStored<string>(`notes:${id}`, '');
  return (
    <div className="notes">
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="תזה, שאלות פתוחות, מה לבדוק בדוח הבא" aria-label="הערות" />
      <div className="src">נשמר במכשיר הזה בלבד{text ? ` · ${text.trim().split(/\s+/).length} מילים` : ''}</div>
    </div>
  );
}
