import { NavLink, Outlet } from 'react-router-dom';
import { Icon } from '../components/Icon';
import '../styles/prov-kpi.css';

export function IndustryLayout() {
  return (
    <>
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="compare" /></span>השוואה ענפית</h1></div></div>
      <nav className="subnav" aria-label="השוואה ענפית">
        <NavLink to="peers">טבלת עמיתים</NavLink>
        <NavLink to="csm">IFRS 17 · CSM · הון</NavLink>
        <NavLink to="savings">עדשת חיסכון</NavLink>
        <NavLink to="/restatements">הצגות מחדש</NavLink>
        <NavLink to="/presentations">מצגות</NavLink>
        <NavLink to="/debt">חוב ופירעונות</NavLink>
      </nav>
      <Outlet />
    </>
  );
}
