import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Search } from './Search';
import { useTheme } from '../lib/theme';

export function Layout() {
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <NavLink to="/" className="brand"><i aria-hidden="true" />מרכז מחקר</NavLink>
          <Search />
          <nav className="nav" aria-label="ראשי">
            <NavLink to="/market">שוק</NavLink>
            <NavLink to="/companies">חברות</NavLink>
            <NavLink to="/coverage">כיסוי נתונים</NavLink>
            <NavLink to="/methodology">מתודולוגיה</NavLink>
          </nav>
          <button className="iconbtn" type="button" onClick={toggle} aria-label="החלפת ערכת נושא">{theme === 'dark' ? 'בהיר' : 'כהה'}</button>
        </div>
      </header>
      <main className="page"><Outlet /></main>
    </>
  );
}
