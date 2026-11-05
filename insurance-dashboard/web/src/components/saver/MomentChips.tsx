import { Link } from 'react-router-dom';
import { CHIP_IDS, MOMENTS, momentPath, type MomentId } from '../../lib/moments';

/** W9 saver · the five life moments as one row of chips (on /my: the labels only, inside the page's 400-word budget). Light: the
 *  registry only, so /my does not load the moment pages' text. S1 (fox 3.0): "הדוח השנתי הגיע" leads the row and opens the annual
 *  check-up (/my/checkup); it is a link, not a moment page, so CHIP_IDS stays the five moments. */
export function MomentChips({ current, lead = true }: { current?: MomentId; /** the check-up chip (off on /my, which has its own link) */ lead?: boolean }) {
  return (
    <nav className="sv-moments" aria-label="רגעים בשנה: מה לבדוק כש…">
      {lead && <Link to="/my/checkup" className="sv-chip sm mo-chip mo-chip-lead">הדוח השנתי הגיע</Link>}
      {CHIP_IDS.map((id) => <Link key={id} to={momentPath(id)} className="sv-chip sm mo-chip" aria-current={current === id ? 'page' : undefined}>{MOMENTS[id].chip}</Link>)}
    </nav>
  );
}
