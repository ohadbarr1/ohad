import { Link } from 'react-router-dom';
import { CHIP_IDS, MOMENTS, momentPath, type MomentId } from '../../lib/moments';

/** W9 saver · the five life moments as one row of chips (on /my: the labels only, inside the page's 400-word budget). Light: the
 *  registry only, so /my does not load the moment pages' text. */
export function MomentChips({ current }: { current?: MomentId }) {
  return (
    <nav className="sv-moments" aria-label="רגעים בשנה: מה לבדוק כש…">
      {CHIP_IDS.map((id) => <Link key={id} to={momentPath(id)} className="sv-chip sm mo-chip" aria-current={current === id ? 'page' : undefined}>{MOMENTS[id].chip}</Link>)}
    </nav>
  );
}
