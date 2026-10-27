import { NavLink } from 'react-router-dom';

/** the tab row shared with the regulatory simulator (A5 /warroom and A8 /warroom/regulation) */
export function WarTabs() {
  return (
    <nav className="subnav wr-tabs" aria-label="חדר מלחמה">
      <NavLink to="/warroom" end className={({ isActive }) => (isActive ? 'active' : '')}>מהלך דמי ניהול</NavLink>
      <NavLink to="/warroom/regulation" className={({ isActive }) => (isActive ? 'active' : '')}>רגולציה</NavLink>
    </nav>
  );
}
