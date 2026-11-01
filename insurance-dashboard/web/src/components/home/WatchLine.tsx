import { Link } from 'react-router-dom';
import { useWatchNews } from '../../lib/watchLoad';
import '../../styles/watch.css';

/** S10 on the home page: one line when answers this browser follows changed since the last look at /watch (nothing otherwise) */
export function WatchLine() {
  const n = useWatchNews();
  if (n <= 0) return null;
  return <p className="wt-home" role="status"><Link to="/watch">מאז ביקורך האחרון: <span className="num">{n}</span> {n === 1 ? 'תשובה שאתה עוקב אחריה השתנתה' : 'תשובות שאתה עוקב אחריהן השתנו'}</Link></p>;
}
