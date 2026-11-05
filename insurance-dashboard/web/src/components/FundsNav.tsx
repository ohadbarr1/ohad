import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import type { ReactNode } from 'react';
import { Seg, Toolbar } from './ui';
import { Tip } from './Explain';
import { useBasis, useReal, useTray, TRAY_MAX, type Basis } from '../lib/funds';
import '../styles/funds.css';
import { useActiveDoor } from './home/doorState';
import { HubTabs } from './HubTabs';

/* The "חיסכון" section's tab row, Pro door only (P0 shell, fox 3.0 plan 05.11.26; wave 2b: the savings hub). On the hub's pages the row is
   the hub's seven tabs: עדשה · נכסים ותזרימים · החודש (/flows: who won, the month's leaders and laggards, under the median, the letter) ·
   מנהלים · רווחיות · ערך (the flows' value and the fee book) · אומדן; each keeps its own address (?v= on /savings). On the tracks engine's
   pages (the screener, a track card, compare, the tools) the row is the engine's own. The saver and the agent have their places on the
   rail; no row for them. */
type On = (path: string, v: string) => boolean;
const LENS_VIEWS = ['market', 'econ', 'npv', 'value', 'now'];
const SAVINGS_TABS: [string, string, On][] = [
  ['/savings', 'עדשה', (p, v) => p === '/savings' && !LENS_VIEWS.includes(v)],
  ['/savings?v=market', 'נכסים ותזרימים', (p, v) => p === '/savings' && v === 'market'],
  ['/flows', 'החודש', (p) => p === '/flows' || p.startsWith('/flows/') || p === '/funds/under' || p === '/funds'],
  ['/managers', 'מנהלים', (p) => p === '/managers'],
  ['/savings?v=econ', 'רווחיות', (p, v) => p === '/savings' && v === 'econ'],
  ['/savings?v=npv', 'ערך', (p, v) => (p === '/savings' && (v === 'npv' || v === 'value')) || p === '/feebook'],
  ['/savings?v=now', 'אומדן', (p, v) => p === '/savings' && v === 'now'],
];
const ENGINE_TABS: [string, string][] = [['/funds/screen', 'מסלולים'], ['/funds/compare', 'השוואה'], ['/funds/default', 'ברירת מחדל'], ['/funds/tools', 'כלים']];
const here = (loc: { pathname: string; search: string }) => ({ p: loc.pathname.replace(/\/+$/, '') || '/', v: new URLSearchParams(loc.search).get('v') ?? '' });

export function FundsNav() {
  const loc = useLocation();
  const [door] = useActiveDoor();
  if (door !== 'pro') return null;
  const { p, v } = here(loc);
  if (SAVINGS_TABS.some(([, , on]) => on(p, v))) return (
    <nav className="subnav" aria-label="חיסכון">
      {SAVINGS_TABS.map(([to, l, on]) => { const a = on(p, v); return <Link key={to} to={to} className={a ? 'active' : ''} aria-current={a ? 'page' : undefined}>{l}</Link>; })}
    </nav>
  );
  // a track card (/funds/p2009) belongs to the tracks tab
  const card = /^\/funds\/[gip]\d+$/.test(p);
  return (
    <nav className="subnav" aria-label="מסלולים">
      {ENGINE_TABS.map(([to, l]) => <NavLink key={to} to={to} className={({ isActive }) => (isActive || (card && to === '/funds/screen') ? 'active' : '')}>{l}</NavLink>)}
    </nav>
  );
}

/** the second row under the hub's tab: the views of "החודש" and of "ערך" (components/HubTabs) */
function SubTabs() {
  const loc = useLocation();
  const [door] = useActiveDoor();
  const { p, v } = here(loc);
  if (p === '/flows' || p.startsWith('/flows/') || p === '/funds/under' || (p === '/funds' && door === 'pro')) return <HubTabs hub="flows" sub />;
  if (door === 'pro' && ((p === '/savings' && (v === 'npv' || v === 'value')) || p === '/feebook')) return <HubTabs hub="value" sub />;
  return null;
}

/** Net or gross, nominal or real: one choice for the whole section, kept in this browser (and in the URL when a link carries it). */
export function BasisToggle({ real: showReal = true, netReady = true }: { real?: boolean; netReady?: boolean }) {
  const [b, setB] = useBasis();
  const [real, setReal] = useReal();
  return (
    <div className="basis">
      <Seg<Basis> label="בסיס התשואה" value={b} onChange={setB} options={[['net', 'נטו'], ['gross', 'ברוטו']]} />
      {b === 'net' && !netReady && <span className="chip est" title="קובץ הנתונים עוד אינו כולל תשואה נטו לכל המסלולים: הטבלאות מציגות ברוטו; כרטיס המסלול וההשוואה מחשבים אומדן מהיסטוריית דמי הניהול">מוצג ברוטו</span>}
      <Tip k={b === 'net' ? 'net' : 'gross'} />
      {showReal && <button type="button" className="chip" aria-pressed={real} onClick={() => setReal(!real)}>ריאלי</button>}
    </div>
  );
}

/** The section head: the title, its tabs and the page's own controls on the same toolbar row. */
export function FundsHead({ sub, tools, title = 'חיסכון' }: { sub?: ReactNode; tools?: ReactNode; title?: ReactNode }) {
  return (
    <>
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="market" /></span>{title}</h1>{sub && <div className="sub">{sub}</div>}</div></div>
      <Toolbar lead={<FundsNav />}>{tools}</Toolbar>
      <SubTabs />
      <CompareTray />
    </>
  );
}

/** The compare tray: a pill that follows the reader through the section (above the bottom bar on a phone). */
export function CompareTray() {
  const { keys, clear } = useTray();
  const loc = useLocation();
  if (!keys.length || loc.pathname === '/funds/compare') return null;
  return (
    <div className="cmptray" role="region" aria-label="מגש השוואה">
      <Link className="cmptray-go" to={`/funds/compare?k=${keys.join(',')}`}><Icon name="compare" /><span>השוואה · <span className="num">{keys.length}</span></span></Link>
      <button type="button" className="cmptray-x" onClick={clear} aria-label="ריקון מגש ההשוואה"><Icon name="x" /></button>
    </div>
  );
}

/** "+ השוואה" on a row, a card or a page: adds the track to the tray (or takes it out). */
export function CompareAdd({ k, name, small }: { k: string; name: string; small?: boolean }) {
  const t = useTray();
  const on = t.has(k), full = !on && t.keys.length >= TRAY_MAX;
  return (
    <button type="button" className={`cmpadd${small ? ' sm' : ''}`} aria-pressed={on} disabled={full} title={full ? `המגש מלא: עד ${TRAY_MAX} מסלולים` : undefined}
      aria-label={on ? `הוצאה מההשוואה: ${name}` : `הוספה להשוואה: ${name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); t.toggle(k); }}>
      <span aria-hidden="true">{on ? '✓' : '+'}</span>{!small && <span>{on ? ' בהשוואה' : ' השוואה'}</span>}
    </button>
  );
}
