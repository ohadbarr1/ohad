import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { idCss } from '../../lib/identity';
import { SinceDot } from '../SinceBadge';

export interface ListRow {
  id: string; name: string; meta: string; stale: boolean;
  /** the key figure, already wrapped in its source; null renders a dash */
  fig: ReactNode | null; figUnit: string;
  /** the secondary figures, each with its own source */
  subs: ReactNode[];
  chips?: ReactNode;
  children?: { id: string; name: string; note: string }[];
}

/** The scoreboard on a phone: one row per company, no sideways table. The name is the way into the company; every figure opens its source. */
export function CompanyList({ rows, label }: { rows: ListRow[]; label: string }) {
  return (
    <ol className="hm-list" aria-label={label}>
      {rows.map((r) => (
        <li key={r.id} className={r.stale ? 'stale' : undefined}>
          
          <Link className="hm-who" to={`/company/${r.id}`}>
            <i className="hm-dot" style={{ background: idCss(r.id) }} aria-hidden="true" />
            <span className="hm-name">{r.name}</span><SinceDot id={r.id} />
            <span className="hm-meta">{r.meta}</span>
          </Link>
          <span className="hm-fig">
            <span className="hm-v">{r.fig ?? <span className="muted">–</span>}{r.fig != null && <span className="hm-u">{r.figUnit}</span>}</span>
            {r.subs.length > 0 && <span className="hm-sub">{r.subs.map((s, i) => <span key={i}>{s}</span>)}</span>}
          </span>
          {r.chips && <span className="hm-chips">{r.chips}</span>}
          {r.children?.map((c) => <Link key={c.id} className="hm-child" to={`/company/${c.id}`}>{c.name}<span className="muted"> · {c.note}</span></Link>)}
        </li>
      ))}
    </ol>
  );
}
