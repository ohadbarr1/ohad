import { Link } from 'react-router-dom';
import { useBook } from '../lib/book';
import { Icon } from '../components/Icon';
import '../styles/book.css';

/** The header's way to the chart book, with the number of charts in it. */
export function ChartBookLink() {
  const { items } = useBook();
  return (
    <Link to="/book" className="iconbtn booklink" aria-label={`ספר הגרפים${items.length ? `, ${items.length} גרפים` : ''}`} title="ספר הגרפים">
      <Icon name="book" />
      {items.length > 0 && <span className="count num">{items.length}</span>}
    </Link>
  );
}
