import { NavLink, Outlet } from 'react-router-dom';
import '../styles/prov-kpi.css';

export function IndustryLayout() {
  return (
    <>
      <div className="pagehead"><div><h1>השוואה ענפית</h1></div></div>
      <nav className="subnav" aria-label="השוואה ענפית">
        <NavLink to="peers">טבלת עמיתים</NavLink>
        <NavLink to="csm">IFRS 17 · CSM · הון</NavLink>
        <NavLink to="savings">חיסכון ארוך טווח</NavLink>
      </nav>
      <Outlet />
    </>
  );
}
