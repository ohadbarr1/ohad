import { Link } from 'react-router-dom';
import { Icon } from '../Icon';
import { FeedItem } from '../FeedItem';
import { useFeed } from '../../lib/feed';
import '../../styles/feed.css';

/** Home: the latest changes of the delta feed (module M2), one line each, and the way to the full feed at /feed. */
export function FeedBlock({ limit = 6 }: { limit?: number }) {
  const { data: F } = useFeed();
  if (!F || !F.events.length) return null;
  return (
    <section className="panel hm-delta" aria-label="מה השתנה">
      <div className="hd"><h2><span className="icotile"><Icon name="spark" /></span>מה השתנה</h2><div className="aside"><Link to="/feed">הכול <span className="num">{F.events.length}</span></Link></div></div>
      <ul className="fd-list">{F.events.slice(0, limit).map((e) => <FeedItem key={e.id} F={F} e={e} compact />)}</ul>
      <Link className="more" to="/feed">לכל השינויים: דוחות, הצגות מחדש, כושר פירעון, יעדים, נתוני הרשות</Link>
    </section>
  );
}
