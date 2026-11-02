import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import type { ReactNode } from 'react';
import { Seg, Toolbar } from './ui';
import { Tip } from './Explain';
import { useBasis, useReal, useTray, TRAY_MAX, type Basis } from '../lib/funds';
import '../styles/funds.css';
import { useWatchBadge } from '../lib/fundsTimeLoad';
import { useActiveDoor } from './home/doorState';

/* The "חיסכון" section (funds plan, IA): two halves under one header and one row of tabs. Products (the hub, the tracks, compare)
   for the people who hold them; the business (the lens, the managers, their holdings) for the people who analyse the companies. */
const TABS: [string, string, boolean?][] = [['/funds', 'קופות', true], ['/funds/screen', 'מסלולים'], ['/funds/compare', 'השוואה'], ['/savings', 'ענף'], ['/managers', 'מנהלים'], ['/flows', 'זרימות'], ['/holdings', 'הרכב נכסים']];
TABS.splice(TABS.findIndex(([t]) => t === '/savings'), 0, ['/funds/tools', 'כלים']);  // F2 TOOLS: the calculators and trackers
// F2 TIME: "סיכון וזמן" after compare (its views share one tab), and the watchlist at the end
TABS.splice(TABS.findIndex(([to]) => to === '/funds/compare') + 1, 0, ['/funds/rank', 'סיכון וזמן']);
TABS.push(['/funds/watch', 'המעקב שלי']);
const TIME_VIEW = /^\/funds\/(rank|glide)$/;

/** W4: the analyst's tabs (the industry's economics, the managers' holdings): shown in the Pro door only */
const PRO_ONLY = new Set(['/savings', '/holdings']);
/** W6 doors (agent red team 02.11.26): the agent's row keeps the six places; the time views, the trackers lab and the Pro tabs sit
 *  behind one "עוד" */
const AGENT_MORE: [string, string, string?][] = [['/funds/rank', 'אחוזון לאורך זמן'], ['/funds/glide', 'מסלולי גיל'], ['/funds/trackers', 'מעבדת עוקבי המדד'], ['/savings', 'ענף', 'Pro'], ['/holdings', 'הרכב נכסים', 'Pro']];
const AGENT_HIDE = new Set(['/funds/rank']);

export function FundsNav() {
  const loc = useLocation();
  const [door] = useActiveDoor();
  const agent = door === 'agent';
  // W6 doors: the saver (and a visitor with no door yet) has the five places of the rail; the section's nine chips are not theirs
  if (!agent && door !== 'pro') return null;
  const tabs = door === 'pro' ? TABS : TABS.filter(([to]) => !PRO_ONLY.has(to) && !AGENT_HIDE.has(to));
  // a track card (/funds/p2009) belongs to the tracks tab
  const card = /^\/funds\/[gip]\d+$/.test(loc.pathname);
  const tool = /^\/funds\/(tools|default|trackers)(\/|$)/.test(loc.pathname);
  const time = TIME_VIEW.test(loc.pathname), badge = useWatchBadge();
  const inMore = agent && AGENT_MORE.some(([to]) => loc.pathname === to || (to === '/funds/rank' && time));
  return (
    <nav className="subnav" aria-label="חיסכון">
      {tabs.map(([to, l, end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive || (card && to === '/funds/screen') || (tool && to === '/funds/tools' && !(agent && loc.pathname.startsWith('/funds/trackers'))) || (!agent && time && to === '/funds/rank') ? 'active' : '')}>{l}{to === '/funds/watch' && badge > 0 && <span className="wbadge num" aria-label={`${badge} מסלולים עם חודש חדש`}>{badge}</span>}</NavLink>)}
      {agent && <details className="snmore" key={loc.pathname}>
        <summary className={inMore ? 'active' : ''} aria-label="עוד עמודים בחיסכון">עוד<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg></summary>
        <div className="snmore-menu" role="group" aria-label="עוד">
          {AGENT_MORE.map(([to, l, tag]) => <NavLink key={to} to={to} className={({ isActive }) => (isActive || (to === '/funds/rank' && time) ? 'active' : '')}>{l}{tag && <span className="chip">{tag}</span>}</NavLink>)}
        </div>
      </details>}
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
