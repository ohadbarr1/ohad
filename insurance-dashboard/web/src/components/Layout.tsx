import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
import { useWatchNews } from '../lib/watchLoad';  // S10: the badge on שאלות
import '../styles/watch.css';
import '../styles/about.css';  // Wave 0: the site footer and the phone's brand
import { DoorSwitch } from './DoorSwitch';  // W1 shell: the three doors
import { Ico } from './home/glyphs';
import { doorFromSearch, doorLabel, isProPage, useActiveDoor } from './home/doorState';
import type { Door } from '../lib/door';
import '../styles/doors.css';
import { useSaverCompareHref } from '../lib/saverLinks';  // W5 saver: the compare tab opens on the reader's products
import { MonthNotifier } from './Reminders';  // W8 feeds: a notification on this device when a new regulator month arrived

// The six places, the same on the rail and the phone's bottom bar (חיסכון joined in F1: the funds section left the evidence group): [route, icon, label, label on the phone (the same word, shortened),
// other addresses that light it]. Search lives in the top bar on every screen; data quality (/data) keeps its address but is not a place.
const NAV: [string, string, string, string, string[]][] = [
  ['/', 'home', 'בית', 'בית', ['/company/', '/pro']],
  ['/questions', 'questions', 'שאלות', 'שאלות', ['/findings', '/brief']],
  // the long-term savings section: the funds hub, the tracks, compare, the lens, the managers and their holdings (and the old /market links)
  ['/funds', 'market', 'חיסכון', 'חיסכון', ['/savings', '/managers', '/flows', '/feebook', '/holdings', '/market']],
  ['/scenarios', 'scenarios', 'תרחישים', 'תרחישים', []],
  ['/warroom', 'warroom', 'חדר מלחמה', 'חדר מלחמה', ['/capital', '/consolidation', '/fragility']],
  ['/positions', 'positions', 'עמדות', 'עמדות', []],
];
/** the evidence layer under the four places: on the desktop rail only (the phone reaches it from the home hub and from search) */
const EVIDENCE: [string, string, string, string[]][] = [
  ['/industry', 'compare', 'השוואה ענפית', []],
  ['/valuation', 'value', 'שווי', []],
];
/** W1 shell: the places of the saver's and the agent's doors (same shape as NAV; Pro keeps NAV and EVIDENCE as they are) */
const SAVER_NAV: typeof NAV = [
  ['/', 'home', 'בית', 'בית', []],
  ['/my', 'mine', 'המוצרים שלי', 'המוצרים שלי', []],
  ['/funds/tools/fees', 'fee', 'דמי ניהול', 'דמי ניהול', []],
  ['/funds/compare', 'compare', 'השוואה', 'השוואה', []],
  ['/funds/watch', 'eye', 'המעקב שלי', 'המעקב שלי', []],
];
const AGENT_NAV: typeof NAV = [
  ['/', 'home', 'בית', 'בית', []],
  ['/funds/screen', 'funds', 'מסלולים', 'מסלולים', ['/funds$', '/funds/makers', '/funds/rank', '/funds/glide']],
  ['/funds/compare', 'compare', 'השוואה', 'השוואה', []],
  ['/funds/default', 'shield', 'ברירת מחדל', 'ברירת מחדל', []],
  ['/managers', 'companies', 'גופים', 'גופים', []],
  ['/funds/tools', 'sliders', 'כלים', 'כלים', ['/funds/trackers', '/funds/watch']],
];
/** the rail and the bottom bar of a door; with no door chosen yet, the saver's (the widest audience; the picker is one tap away) */
const navOf = (door: Door | null) => (door === 'pro' ? NAV : door === 'agent' ? AGENT_NAV : SAVER_NAV);
/** an address that lights a place besides its own: '/company/' covers every company page, '/capital' itself and anything under it,
 *  and (W1) '/funds$' that address alone */
const lit = (path: string, also: string[]) => also.some((s) => (s.endsWith('$') ? path === s.slice(0, -1) : s.endsWith('/') ? path.startsWith(s) : path === s || path.startsWith(`${s}/`)));

export function Layout() {
  const { theme, toggle, next } = useTheme();
  const nextName = THEMES.find(([t]) => t === next)![1];
  const loc = useLocation();
  const section = loc.pathname.split('/').slice(0, 3).join('/');
  useEffect(() => { window.scrollTo(0, 0); }, [section]);
  const reg = useRegistry();
  const { help, setHelp } = useKeyboard(toggle);
  const news = useWatchNews();  // S10: followed answers that changed since the last look at /watch (0 when nothing is followed)
  // W1 shell: the door in force (?door= wins, then the stored choice); a ?door= is stored and dropped from the address
  const [door, setDoor] = useActiveDoor();
  const go = useNavigate();
  useEffect(() => {
    const asked = doorFromSearch(loc.search);
    if (asked === undefined) return;
    setDoor(asked);
    const q = new URLSearchParams(loc.search); q.delete('door');
    const rest = q.toString();
    go({ pathname: loc.pathname, search: rest ? `?${rest}` : '', hash: loc.hash }, { replace: true });
  }, [loc.search]);  // eslint-disable-line react-hooks/exhaustive-deps
  const nav = navOf(door);
  const pro = door === 'pro';
  const cmpHref = useSaverCompareHref(nav === SAVER_NAV);
  useEffect(() => {
    const names = new Map(reg.data?.map((c) => [c.id, c.name_he]));
    // while the list loads a name is unknown (undefined); once it has loaded, an id that is not on it is a page that does not exist (null)
    document.title = titleFor(loc.pathname, (id) => (reg.data ? names.get(id) ?? null : undefined), door) ?? 'העמוד לא נמצא · fox';
  }, [loc.pathname, reg.data, door]);
  // a row of tabs wider than the screen opens with the current tab in view
  useEffect(() => { const id = requestAnimationFrame(() => document.querySelectorAll('.subnav a.active').forEach((a) => a.scrollIntoView({ inline: 'center', block: 'nearest' }))); return () => cancelAnimationFrame(id); }, [loc.pathname]);
  return (
    <SourceProvider>
    <a className="skip" href="#main">דילוג לתוכן</a>
    <div className="shell">
      <aside className="rail">
        <NavLink to="/" className="brand" aria-label="fox" title="fox · דף הבית"><Logo size={40} /></NavLink>
        <nav aria-label="ראשי">
          {nav.map(([to, icon, label, short, also]) => <NavLink key={to} to={to === '/funds/compare' && cmpHref ? cmpHref : to} end={to === '/'} aria-label={to === '/questions' && news > 0 ? `${label}, ${news} תשובות במעקב השתנו` : label} className={({ isActive }) => `item${isActive || lit(loc.pathname, also) ? ' active' : ''}`}><Ico name={icon} /><span className="lbl-w">{label}</span><span className="lbl-p">{short}</span>{to === '/questions' && news > 0 && <span className="wt-badge" aria-hidden="true">{news > 99 ? '99+' : news}</span>}</NavLink>)}
          {pro && <div className="rail-ev" role="group" aria-labelledby="rail-ev-l">
            <span className="rail-ev-l" id="rail-ev-l">ראיות</span>
            {EVIDENCE.map(([to, icon, label, also]) => <NavLink key={to} to={to} aria-label={label} className={({ isActive }) => `item ev${isActive || lit(loc.pathname, also) ? ' active' : ''}`}><Icon name={icon} /><span className="lbl-w">{label}</span></NavLink>)}
          </div>}
        </nav>
        <div className="foot">
          <button className="iconbtn" type="button" onClick={toggle} aria-label={`החלפת ערכת עיצוב. הבאה: ${nextName}`} title={`ערכת עיצוב: ${THEMES.find(([t]) => t === theme)![1]}. לחיצה: ${nextName}`}><Icon name={next === 'dark' ? 'moon' : 'sun'} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <div className="top-in">
            <NavLink to="/" className="wordmark">fox<span>.</span></NavLink>
            <NavLink to="/" className="brand-m" aria-label="fox · דף הבית"><Logo size={24} />fox<span>.</span></NavLink>
            <Search />
            {pro && <ChartBookLink />}
            <DoorSwitch door={door} setDoor={setDoor} />
            <button className="iconbtn" type="button" onClick={toggle} aria-label={`החלפת ערכת עיצוב. הבאה: ${nextName}`} title={`ערכת עיצוב: ${THEMES.find(([t]) => t === theme)![1]}. לחיצה: ${nextName}`}><Icon name={next === 'dark' ? 'moon' : 'sun'} /></button>
          </div>
        </header>
        <main className="page" id="main" tabIndex={-1} key={section}>{!pro && isProPage(loc.pathname) && <ProChip door={door} />}<ErrorBoundary resetKey={loc.pathname}><Suspense fallback={<Loading what="עמוד" />}><Outlet /></Suspense></ErrorBoundary><SiteFoot path={loc.pathname} door={door} /><MonthNotifier /></main>
      </div>
    </div>
    {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
    <div className="print-foot">fox · {location.host}{loc.pathname} · כל מספר מקושר לעמוד המקור בדוח · הודפס {pubLabel(new Date().toISOString())}</div>
    </SourceProvider>
  );
}

/** Wave 0 (red team 01.11.26): every page says who is behind it and links /about; the savings pages also say what they are not */
const SAVINGS = ['/funds', '/savings', '/managers', '/flows', '/feebook', '/holdings', '/questions', '/my'];
function SiteFoot({ path, door }: { path: string; door: Door | null }) {
  // W1: the saver's and the agent's homes (and the picker) show savings figures too
  const savings = path !== '/my' && (SAVINGS.some((s) => path === s || path.startsWith(`${s}/`)) || (path === '/' && door !== 'pro'));
  return (
    <footer className="site-foot">
      {/* W6 doors: the agent reads one professional line; the saver's sentences ("שלכם") are the saver's */}
      {savings && (door === 'agent'
        ? <span className="disc">נתוני רשות שוק ההון, עובדתיים ומשווים; אינם ייעוץ או שיווק פנסיוני ללקוח מסוים. תשואות עבר אינן מבטיחות תשואות עתיד; ״נטו״: אומדן לפי דמי הניהול הממוצעים בפועל.</span>
        : <span className="disc">המידע עובדתי ומשווה, ואינו ייעוץ השקעות או שיווק פנסיוני ואינו מתחשב בנתונים האישיים שלכם. תשואות עבר אינן מבטיחות תשואות בעתיד. ״נטו״ הוא אומדן לפי דמי הניהול הממוצעים בפועל.</span>)}
      <NavLink to="/about">על fox ומקורות הנתונים</NavLink>
      <span>חינם, בלי פרסומות ובלי עמלות</span>
    </footer>
  );
}

/** W1 shell: a Pro page opened from the saver's or the agent's door still works; this says so, quietly, with the way back */
function ProChip({ door }: { door: Door | null }) {
  return (
    <p className="pro-chip"><span className="chip"><Ico name="terminal" size={14} />עמוד מקצועי · Pro</span><Link to="/">{door ? `לבית של ה${doorLabel(door)}` : 'לדף הבית'}</Link></p>
  );
}
