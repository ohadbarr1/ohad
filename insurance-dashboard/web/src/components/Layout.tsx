import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Search } from './Search';
import { Logo } from './Logo';
import { Icon } from './Icon';
import { THEMES, useTheme } from '../lib/theme';
import { SourceProvider } from './Source';
import { ErrorBoundary } from './ErrorBoundary';
import { Loading } from './ui';
import { Suspense } from 'react';
import { ShortcutsHelp, useKeyboard } from './Keyboard';
import '../styles/sheet.css';
import '../lib/density';
import { useRegistry } from '../lib/useData';
import { titleFor } from '../lib/title';
import { pubLabel } from '../lib/format';

// [route, icon, label, label on the phone's bottom bar: the same word, shortened]. Four places on the phone too: search lives in the top bar
// on every screen, so the fourth place goes to valuation, which no other control on a phone reaches.
const NAV: [string, string, string, string | null][] = [
  ['/', 'home', 'בית', 'בית'], ['/industry', 'compare', 'ענף', 'ענף'],
  ['/valuation', 'value', 'שווי', 'שווי'], ['/funds', 'market', 'קופות ושוק', 'קופות'],
];

export function Layout() {
  const { theme, toggle, next } = useTheme();
  const nextName = THEMES.find(([t]) => t === next)![1];
  const loc = useLocation();
  const section = loc.pathname.split('/').slice(0, 3).join('/');
  useEffect(() => { window.scrollTo(0, 0); }, [section]);
  const reg = useRegistry();
  const { help, setHelp } = useKeyboard(toggle);
  useEffect(() => {
    const names = new Map(reg.data?.map((c) => [c.id, c.name_he]));
    // while the list loads a name is unknown (undefined); once it has loaded, an id that is not on it is a page that does not exist (null)
    document.title = titleFor(loc.pathname, (id) => (reg.data ? names.get(id) ?? null : undefined)) ?? 'העמוד לא נמצא · fox';
  }, [loc.pathname, reg.data]);
  // a row of tabs wider than the screen opens with the current tab in view
  useEffect(() => { const id = requestAnimationFrame(() => document.querySelectorAll('.subnav a.active').forEach((a) => a.scrollIntoView({ inline: 'center', block: 'nearest' }))); return () => cancelAnimationFrame(id); }, [loc.pathname]);
  return (
    <SourceProvider>
    <a className="skip" href="#main">דילוג לתוכן</a>
    <div className="shell">
      <aside className="rail">
        <NavLink to="/" className="brand" aria-label="fox"><Logo size={36} /></NavLink>
        <nav aria-label="ראשי">
          {NAV.map(([to, icon, label, short]) => <NavLink key={to} to={to} end={to === '/'} aria-label={label} className={({ isActive }) => `item${short ? '' : ' wide-item'}${isActive || (to === '/' && loc.pathname.startsWith('/company/')) || (to === '/funds' && (loc.pathname.startsWith('/managers') || loc.pathname.startsWith('/market'))) ? ' active' : ''}`}><Icon name={icon} /><span className="lbl-w">{label}</span><span className="lbl-p">{short}</span></NavLink>)}
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
        <main className="page" id="main" tabIndex={-1} key={section}><ErrorBoundary resetKey={loc.pathname}><Suspense fallback={<Loading what="עמוד" />}><Outlet /></Suspense></ErrorBoundary></main>
      </div>
    </div>
    {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
    <div className="print-foot">fox · {location.host}{loc.pathname} · כל מספר מקושר לעמוד המקור בדוח · הודפס {pubLabel(new Date().toISOString())}</div>
    </SourceProvider>
  );
}
