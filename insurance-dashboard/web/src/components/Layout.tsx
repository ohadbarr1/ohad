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
import { ChartBookLink } from '../pages/ChartBookLink';  // lane G

// The five places, the same on the rail and the phone's bottom bar: [route, icon, label, label on the phone (the same word, shortened),
// other addresses that light it]. Search lives in the top bar on every screen; data quality (/data) keeps its address but is not a place.
const NAV: [string, string, string, string, string[]][] = [
  ['/', 'home', 'בית', 'בית', ['/company/']],
  ['/questions', 'questions', 'שאלות', 'שאלות', ['/findings']],
  ['/scenarios', 'scenarios', 'תרחישים', 'תרחישים', []],
  ['/warroom', 'warroom', 'חדר מלחמה', 'חדר מלחמה', ['/capital', '/consolidation', '/fragility']],
  ['/positions', 'positions', 'עמדות', 'עמדות', []],
];
/** the evidence layer under the four places: on the desktop rail only (the phone reaches it from the home hub and from search) */
const EVIDENCE: [string, string, string, string[]][] = [
  // the long-term savings section: the lens, the tracks, the managers and their holdings (and the old /market links)
  ['/savings', 'market', 'חיסכון ארוך טווח', ['/funds', '/managers', '/holdings', '/market']],
  ['/industry', 'compare', 'השוואה ענפית', []],
  ['/valuation', 'value', 'שווי', []],
];
/** an address that lights a place besides its own: '/company/' covers every company page, '/capital' itself and anything under it */
const lit = (path: string, also: string[]) => also.some((s) => (s.endsWith('/') ? path.startsWith(s) : path === s || path.startsWith(`${s}/`)));

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
        <NavLink to="/" className="brand" aria-label="fox" title="fox · דף הבית"><Logo size={40} /></NavLink>
        <nav aria-label="ראשי">
          {NAV.map(([to, icon, label, short, also]) => <NavLink key={to} to={to} end={to === '/'} aria-label={label} className={({ isActive }) => `item${isActive || lit(loc.pathname, also) ? ' active' : ''}`}><Icon name={icon} /><span className="lbl-w">{label}</span><span className="lbl-p">{short}</span></NavLink>)}
          <div className="rail-ev" role="group" aria-labelledby="rail-ev-l">
            <span className="rail-ev-l" id="rail-ev-l">ראיות</span>
            {EVIDENCE.map(([to, icon, label, also]) => <NavLink key={to} to={to} aria-label={label} className={({ isActive }) => `item ev${isActive || lit(loc.pathname, also) ? ' active' : ''}`}><Icon name={icon} /><span className="lbl-w">{label}</span></NavLink>)}
          </div>
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
            <ChartBookLink />
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
