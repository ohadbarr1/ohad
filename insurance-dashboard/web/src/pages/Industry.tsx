import { NavLink, Outlet } from 'react-router-dom';
import '../styles/prov-kpi.css';

export function IndustryLayout() {
  return (
    <>
      <div className="pagehead"><div><h1>ענף</h1></div></div>
      <nav className="subnav" aria-label="ענף">
        <NavLink to="peers">טבלת עמיתים</NavLink>
        <NavLink to="csm">IFRS 17 · CSM · הון</NavLink>
        <NavLink to="savings">חיסכון ארוך טווח</NavLink>
        <NavLink to="/restatements">הצגות מחדש</NavLink>
        <NavLink to="/presentations">מצגות</NavLink>
      </nav>
      <Outlet />
    </>
  );
}
