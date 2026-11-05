import { Link, useLocation } from 'react-router-dom';

/** the tab row of the "תרחישים" place (fox 3.0): market scenarios, the solvency stress view (wave 2b: the stress lab that was
 *  /industry/csm?view=stress), the war room (A5) and the regulatory simulator (A8) */
const TABS: [to: string, label: string, on: (path: string, view: string) => boolean][] = [
  ['/scenarios', 'תרחישי שוק', (p, v) => p === '/scenarios' && v !== 'solvency'],
  ['/scenarios?view=solvency', 'כושר פירעון', (p, v) => p === '/scenarios' && v === 'solvency'],
  ['/warroom', 'חדר מלחמה · מהלך דמי ניהול', (p) => p === '/warroom'],
  ['/warroom/regulation', 'רגולציה', (p) => p.startsWith('/warroom/regulation')],
];

export function WarTabs() {
  const loc = useLocation();
  const path = loc.pathname.replace(/\/+$/, ''), view = new URLSearchParams(loc.search).get('view') ?? '';
  return (
    <nav className="subnav wr-tabs" aria-label="תרחישים">
      {TABS.map(([to, l, on]) => { const a = on(path, view); return <Link key={to} to={to} className={a ? 'active' : ''} aria-current={a ? 'page' : undefined}>{l}</Link>; })}
    </nav>
  );
}
