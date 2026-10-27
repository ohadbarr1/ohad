import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import type { ReactNode } from 'react';
import { Toolbar } from './ui';

/** One section for long-term savings: the lens first, then the regulator's track data. One title, one row of tabs, on every page of it. */
export function FundsNav() {
  return (
    <nav className="subnav" aria-label="חיסכון ארוך טווח">
      <NavLink to="/savings">עדשת חיסכון</NavLink>
      <NavLink to="/funds" end>מסלולים</NavLink>
      <NavLink to="/managers">דירוג מנהלים</NavLink>
      <NavLink to="/holdings">הרכב נכסים</NavLink>
    </nav>
  );
}

/** The section head: the title, its tabs and (design lane) the page's own controls on the same toolbar row. */
export function FundsHead({ sub, tools }: { sub?: ReactNode; tools?: ReactNode }) {
  return (
    <>
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="market" /></span>חיסכון ארוך טווח</h1>{sub && <div className="sub">{sub}</div>}</div></div>
      <Toolbar lead={<FundsNav />}>{tools}</Toolbar>
    </>
  );
}
