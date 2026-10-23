import { Link, NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import type { ReactNode } from 'react';

/** One section for the regulator's fund data: one title, one row of tabs, on every page of it. */
export function FundsNav() {
  return (
    <nav className="subnav" aria-label="קופות">
      <NavLink to="/funds" end>מסלולים</NavLink>
      <NavLink to="/managers">דירוג מנהלים</NavLink>
      <NavLink to="/holdings">הרכב נכסים</NavLink>
      {/* the lens lives in the industry hub; this is a way there, not a tab of this section */}
      <Link to="/industry/savings" className="subnav-out" title="עדשת חיסכון נמצאת בהשוואה ענפית">עדשת חיסכון · בהשוואה ענפית ↖</Link>
    </nav>
  );
}

export function FundsHead({ sub }: { sub?: ReactNode }) {
  return (
    <>
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="market" /></span>קופות ושוק</h1>{sub && <div className="sub">{sub}</div>}</div></div>
      <FundsNav />
    </>
  );
}
