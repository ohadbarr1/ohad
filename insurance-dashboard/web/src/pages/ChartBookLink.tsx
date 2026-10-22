import { Link } from 'react-router-dom';
import { useBook } from '../lib/book';
import '../styles/book.css';

/** The header's way to the chart book, with the number of charts in it. */
export function ChartBookLink() {
  const { items } = useBook();
  return (
    <Link to="/book" className="iconbtn booklink" aria-label={`ספר הגרפים${items.length ? `, ${items.length} גרפים` : ''}`} title="ספר הגרפים">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4M5 17a3 3 0 013-3h11M9 8h6M9 11h4" /></svg>
      {items.length > 0 && <span className="count num">{items.length}</span>}
    </Link>
  );
}
