import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { newsForFund, type NewsFile } from '../lib/news';
import { useLoad } from '../lib/useData';
import { pubLabel } from '../lib/format';
import '../styles/alerts.css';

/** One short factual line per event of the last `days` days that concerns this track: a change in its own average management fee, or a
 *  company-level event of its manager (restatement; merger, tender, service-index and regulator decisions once the feed carries them), each
 *  with its source. Renders nothing when there is none, and nothing while data/news.json (≈15 KB) is on its way.
 *  Usage (saver card, agent views): <NewsForFund k={f.k} grp={f.grp} /> */
export function NewsForFund({ k, grp, c, days = 90, max = 3, door = 'saver' }: { k: string; grp?: string | null; c?: string | null; days?: number; max?: number; door?: 'saver' | 'agent' }) {
  const { data } = useLoad<NewsFile>('news.json');
  const lines = useMemo(() => (data ? newsForFund(data, { k, grp, c }, { days, max }) : []), [data, k, grp, c, days, max]);
  if (!lines.length) return null;
  return (
    <ul className={`nff nff-${door}`} aria-label="חדשות על המסלול ועל הגוף המנהל">
      {lines.map((x) => (
        <li key={x.id}>
          <span className="nff-t">{x.text}</span>{' '}
          <span className="nff-src">
            (מקור: {x.src.href ? <a href={x.src.href} target="_blank" rel="noreferrer">{x.src.text}</a> : x.src.text}
            {x.got ? <>; התקבל ב-fox {pubLabel(x.got)}</> : null}
            {' · '}<Link to={x.to}>פירוט</Link>)
          </span>
        </li>
      ))}
    </ul>
  );
}
