import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

/** One section for the regulator's fund data: one title, one row of tabs, on every page of it. */
export function FundsNav() {
  return (
    <nav className="subnav" aria-label="קופות ושוק">
      <NavLink to="/funds" end>מסלולים</NavLink>
      <NavLink to="/funds/makers">יצרן מול השוק</NavLink>
      <NavLink to="/market/overview">שוק</NavLink>
      <NavLink to="/market/ranking">דירוג קבוצות</NavLink>
      <NavLink to="/managers">מנהלים</NavLink>
    </nav>
  );
}

export function FundsHead({ sub }: { sub?: ReactNode }) {
  return (
    <>
      <div className="pagehead"><div><h1>קופות ושוק</h1>{sub && <div className="sub">{sub}</div>}</div></div>
      <FundsNav />
    </>
  );
}
