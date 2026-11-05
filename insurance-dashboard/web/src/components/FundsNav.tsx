import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import type { ReactNode } from 'react';
import { Seg, Toolbar } from './ui';
import { Tip } from './Explain';
import { useBasis, useReal, useTray, TRAY_MAX, type Basis } from '../lib/funds';
import '../styles/funds.css';
import { useActiveDoor } from './home/doorState';

/* The "חיסכון" section's chip row, Pro door only (P0 shell, fox 3.0 plan 05.11.26): at most six chips, the places an analyst moves between
   inside the section. Everything else in the section (the time views, the trackers lab, the tools, the under-median list, the book value,
   the holdings) keeps its address and is reached from its page's links, the rail's "חיסכון" and the library. The saver and the agent have
   their places on the rail; no chip row for them. */
const TABS: [string, string, boolean?][] = [['/funds/screen', 'מסלולים'], ['/funds/compare', 'השוואה'], ['/managers', 'גופים'], ['/funds', 'החודש', true], ['/flows', 'מי ניצח'], ['/funds/default', 'ברירת מחדל']];

export function FundsNav() {
  const loc = useLocation();
  const [door] = useActiveDoor();
  if (door !== 'pro') return null;
  // a track card (/funds/p2009) belongs to the tracks chip
  const card = /^\/funds\/[gip]\d+$/.test(loc.pathname);
  return (
    <nav className="subnav" aria-label="חיסכון">
      {TABS.map(([to, l, end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive || (card && to === '/funds/screen') ? 'active' : '')}>{l}</NavLink>)}
    </nav>
  );
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
