import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Search } from './Search';
import { Logo } from './Logo';
import { Icon } from './Icon';
import { useTheme } from '../lib/theme';

const NAV: [string, string, string][] = [
  ['/', 'home', 'בית'], ['/companies', 'companies', 'חברות'], ['/industry', 'compare', 'השוואה ענפית'],
  ['/valuation', 'value', 'שווי'], ['/market', 'market', 'שוק וקופות'],
];

export function Layout() {
  const { theme, toggle } = useTheme();
  const loc = useLocation();
  const section = loc.pathname.split('/').slice(0, 3).join('/');
  useEffect(() => { window.scrollTo(0, 0); }, [section]);
  // spotlight: surfaces read the pointer position from --mx/--my
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest?.('.panel, .mcard, .card, .kpis') as HTMLElement | null;
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', `${e.clientX - r.left}px`); t.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);
  return (
    <div className="shell">
      <aside className="rail">
        <NavLink to="/" className="brand" aria-label="fox"><Logo size={36} /></NavLink>
        <nav aria-label="ראשי">
          {NAV.map(([to, icon, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `item${isActive || (to === '/companies' && loc.pathname.startsWith('/company/')) || (to === '/market' && loc.pathname.startsWith('/managers')) ? ' active' : ''}`}><Icon name={icon} />{label}</NavLink>)}
        </nav>
        <div className="foot">
          <button className="iconbtn" type="button" onClick={toggle} aria-label={theme === 'dark' ? 'ערכה בהירה' : 'ערכה כהה'}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <div className="top-in">
            <NavLink to="/" className="wordmark">fox<span>.</span></NavLink>
            <Search />
            <button className="iconbtn" type="button" onClick={toggle} aria-label={theme === 'dark' ? 'ערכה בהירה' : 'ערכה כהה'}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
          </div>
        </header>
        <main className="page" key={section}><Outlet /></main>
      </div>
    </div>
  );
}
