import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Search } from './Search';
import { Logo } from './Logo';
import { Icon } from './Icon';
import { THEMES, useTheme } from '../lib/theme';
import { Icon3D } from './Icon3D';

const NAV: [string, string, string][] = [
  ['/', 'home', 'בית'], ['/companies', 'companies', 'חברות'], ['/industry', 'compare', 'השוואה ענפית'],
  ['/valuation', 'value', 'שווי'], ['/funds', 'market', 'קופות ושוק'],
];

export function Layout() {
  const { theme, toggle, next } = useTheme();
  const nextName = THEMES.find(([t]) => t === next)![1];
  const loc = useLocation();
  const section = loc.pathname.split('/').slice(0, 3).join('/');
  useEffect(() => { window.scrollTo(0, 0); }, [section]);
  // a row of tabs wider than the screen opens with the current tab in view
  useEffect(() => { const id = requestAnimationFrame(() => document.querySelectorAll('.subnav a.active').forEach((a) => a.scrollIntoView({ inline: 'center', block: 'nearest' }))); return () => cancelAnimationFrame(id); }, [loc.pathname]);
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
          {NAV.map(([to, icon, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `item${isActive || (to === '/companies' && loc.pathname.startsWith('/company/')) || (to === '/funds' && (loc.pathname.startsWith('/managers') || loc.pathname.startsWith('/market'))) ? ' active' : ''}`}><Icon name={icon} /><Icon3D name={icon} />{label}</NavLink>)}
        </nav>
        <div className="foot">
          <button className="iconbtn" type="button" onClick={toggle} aria-label={`החלפת ערכת עיצוב. הבאה: ${nextName}`} title={`ערכת עיצוב: ${THEMES.find(([t]) => t === theme)![1]}. לחיצה: ${nextName}`}><Icon name={next === 'dark' ? 'moon' : 'sun'} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <div className="top-in">
            <NavLink to="/" className="wordmark">fox<span>.</span></NavLink>
            <Search />
            <button className="iconbtn" type="button" onClick={toggle} aria-label={`החלפת ערכת עיצוב. הבאה: ${nextName}`} title={`ערכת עיצוב: ${THEMES.find(([t]) => t === theme)![1]}. לחיצה: ${nextName}`}><Icon name={next === 'dark' ? 'moon' : 'sun'} /></button>
          </div>
        </header>
        <main className="page" key={section}><Outlet /></main>
      </div>
    </div>
  );
}
