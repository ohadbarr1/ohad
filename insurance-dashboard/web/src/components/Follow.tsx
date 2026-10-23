import { Link } from 'react-router-dom';
import { useStored, useWatchlist } from '../lib/local';
import { savedWhere, useFactNotes } from '../lib/notes';

/** Star that adds a company to the follow list (kept in this browser; follows the reader to other devices when sync is on). */
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

/** Free-text notes on one company, saved as typed; below them, the notes written on this company's figures. */
export function Notes({ id }: { id: string }) {
  const [text, setText] = useStored<string>(`notes:${id}`, '');
  const facts = useFactNotes(id);
  return (
    <div className="notes">
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="תזה, שאלות פתוחות, מה לבדוק בדוח הבא" aria-label="הערות" />
      <div className="src">{savedWhere()}{text ? ` · ${text.trim().split(/\s+/).length} מילים` : ''} · <Link to="/mine">כל ההערות</Link></div>
      {facts.length > 0 && (
        <ul className="factnotes" aria-label="הערות על מספרים">
          {facts.slice(0, 8).map((n) => (
            <li key={n.key}><i aria-hidden="true" /><span className="what">{n.l ?? n.m} · <span className="num">{n.p}</span></span><span className="txt">{n.href ? <Link to={n.href}>{n.t}</Link> : n.t}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
