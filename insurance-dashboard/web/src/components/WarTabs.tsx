import { NavLink } from 'react-router-dom';

/** the tab row of the "תרחישים" place (fox 3.0): market scenarios, the war room (A5) and the regulatory simulator (A8) */
export function WarTabs() {
  return (
    <nav className="subnav wr-tabs" aria-label="תרחישים">
      <NavLink to="/scenarios" end className={({ isActive }) => (isActive ? 'active' : '')}>תרחישי שוק</NavLink>
      <NavLink to="/warroom" end className={({ isActive }) => (isActive ? 'active' : '')}>חדר מלחמה · מהלך דמי ניהול</NavLink>
      <NavLink to="/warroom/regulation" className={({ isActive }) => (isActive ? 'active' : '')}>רגולציה</NavLink>
    </nav>
  );
}
