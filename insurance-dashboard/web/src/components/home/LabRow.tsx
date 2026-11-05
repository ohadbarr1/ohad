import { Link } from 'react-router-dom';
import { LAB } from '../LibraryMenu';
import '../../styles/hub.css';

/* P0 · P2 (fox 3.0 plan, 05.11.26): what the advisory hub at the top of the Pro home became. The lab's models stand on assumptions or have
   no track record yet (the position book, the consolidation screen, the fragility thresholds, the briefs), so they leave the first screen
   and keep one quiet row of links at the bottom; the war room is a tab of the scenarios. AdvisoryHub.tsx is kept, unrendered, for when a
   tile passes its sanity check. */
const MORE: [string, string][] = [['/warroom', 'חדר מלחמה'], ['/methodology#drivers', 'מנגנונים']];

export function LabRow() {
  return (
    <nav className="hub-ev hm-lab" aria-label="מעבדה">
      <span className="l">מעבדה</span>
      {[...LAB, ...MORE].map(([to, l]) => <Link key={to} to={to}>{l}</Link>)}
      <span className="hm-lab-n">מודלים על הנחות, בבדיקה</span>
    </nav>
  );
}
