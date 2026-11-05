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
import { headTitle, syncHead } from '../lib/seo';  // D2 SEO: the prerendered head wins, description and canonical follow the address
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
import { MonthNotifier } from './Reminders';
import { LibraryMenu, LIB_PATHS } from './LibraryMenu';  // P0 shell: the Pro door's library and lab
import { usePositions } from '../lib/positions';  // W8 feeds: a notification on this device when a new regulator month arrived

// P0 shell (fox 3.0 plan, 05.11.26): each door opens on its hero job and keeps 5 to 7 places, the same on the rail and the phone's bottom bar.
// A place: [route, icon, label, label on the phone (the same word, shortened), other addresses that light it, wide only (on the phone it
// moves into the "עוד" sheet)]. Search lives in the top bar on every screen.
type Place = [to: string, icon: string, label: string, short: string, also: (string | RegExp)[], wide?: boolean];
/** Pro: seven places. The war room is a tab of the scenarios (its address stays); the positions join only once one is published; the
 *  reference screens and the lab sit behind "ספרייה" (components/LibraryMenu) */
const NAV: Place[] = [
  ['/', 'home', 'בית', 'בית', ['/company/', '/pro']],
  ['/industry/peers', 'compare', 'השוואה ענפית', 'השוואה', ['/industry', '/capital', '/restatements']],
  // the long-term-savings section: the lens, flows, managers, the funds pages (and the old /market links)
  ['/savings', 'market', 'חיסכון', 'חיסכון', ['/flows', '/managers', '/funds', '/feebook', '/nowcast', '/market']],
  ['/valuation', 'value', 'שווי', 'שווי', ['/expectations'], true],
  ['/scenarios', 'scenarios', 'תרחישים', 'תרחישים', ['/warroom', '/fragility'], true],
  ['/questions', 'questions', 'שאלות', 'שאלות', ['/findings', '/brief']],
  ['/feed', 'spark', 'מה השתנה', 'מה השתנה', ['/watch', '/calendar']],
];
const POSITIONS: Place = ['/positions', 'positions', 'עמדות', 'עמדות', [], true];
/** the saver: five places; "רגעים" (life moments and the annual statement) took the watchlist's place (it folds into /my) */
const SAVER_NAV: Place[] = [
  ['/', 'home', 'בית', 'בית', []],
  ['/my', 'mine', 'המוצרים שלי', 'המוצרים שלי', []],
  ['/funds/tools/fees', 'fee', 'דמי ניהול', 'דמי ניהול', []],
  ['/funds/compare', 'compare', 'השוואה', 'השוואה', []],
  ['/my/moment', 'moment', 'רגעים', 'רגעים', ['/my/statement']],
];
/** the agent: six places, no chip row and no "עוד" under them; the Pro pages leave this door */
const AGENT_NAV: Place[] = [
  ['/', 'home', 'בית', 'בית', []],
  ['/clients', 'clients', 'לקוחות', 'לקוחות', []],
  ['/funds/screen', 'funds', 'מסלולים', 'מסלולים', ['/funds$', '/funds/makers', '/funds/rank', /^\/funds\/[gip]\d+$/]],
  ['/funds/compare', 'compare', 'השוואה', 'השוואה', []],
  ['/managers', 'companies', 'גופים', 'גופים', []],
  ['/funds/tools', 'sliders', 'כלים', 'כלים', ['/funds/trackers', '/funds/glide', '/funds/default', '/funds/bm']],
];
/** the rail and the bottom bar of a door; with no door chosen yet, the saver's (the widest audience; the picker is one tap away) */
const navOf = (door: Door | null, positions: boolean) => (door === 'pro' ? (positions ? [...NAV, POSITIONS] : NAV) : door === 'agent' ? AGENT_NAV : SAVER_NAV);
/** an address that lights a place besides its own: '/company/' covers every company page, '/capital' itself and anything under it,
 *  '/funds$' that address alone, a pattern what it matches */
const lit = (path: string, also: (string | RegExp)[]) => also.some((s) => (typeof s !== 'string' ? s.test(path) : s.endsWith('$') ? path === s.slice(0, -1) : s.endsWith('/') ? path.startsWith(s) : path === s || path.startsWith(`${s}/`)));
/** a place is on: its own address (and below it; the home and "המוצרים שלי" only exactly), or one of the addresses it also covers */
const isOn = (path: string, [to, , , , also]: Place) => (to === '/' || to === '/my' ? path === to : path === to || path.startsWith(`${to}/`)) || lit(path, also);

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
  const pro = door === 'pro';
  // the positions join the Pro rail once the book has a published position (positions.json is small; it is read in the Pro door only)
  const book = usePositions(pro);
  const nav = navOf(door, (book.data?.positions?.length ?? 0) > 0);
  const cmpHref = useSaverCompareHref(nav === SAVER_NAV);
  const libLit = pro && !nav.some((p) => isOn(loc.pathname, p)) && LIB_PATHS.some((s) => loc.pathname === s || loc.pathname.startsWith(`${s}/`));
  useEffect(() => {
    const names = new Map(reg.data?.map((c) => [c.id, c.name_he]));
    // while the list loads a name is unknown (undefined); once it has loaded, an id that is not on it is a page that does not exist (null)
    document.title = headTitle(loc.pathname) ?? titleFor(loc.pathname, (id) => (reg.data ? names.get(id) ?? null : undefined), door) ?? 'העמוד לא נמצא · fox';
    syncHead(loc.pathname);
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
          {nav.map((p) => <RailItem key={p[0]} p={p} path={loc.pathname} news={news} href={p[0] === '/funds/compare' && cmpHref ? cmpHref : p[0]} />)}
          {pro && <LibraryMenu lit={libLit} more={nav.filter((p) => p[5]).map(([to, , label]) => <li key={to}><NavLink to={to}>{label}</NavLink></li>)} />}
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
        <main className="page" id="main" tabIndex={-1} key={section}>{!pro && isProPage(loc.pathname) && <ProChip door={door} />}<ErrorBoundary resetKey={loc.pathname}><Suspense fallback={<Loading what="עמוד" />}><Outlet /></Suspense></ErrorBoundary><MonthNotifier /></main>
        {/* P0: the footer follows <main> (its own contentinfo landmark), so a page's word budget counts the page, not the site's chrome */}
        <SiteFoot path={loc.pathname} door={door} />
      </div>
    </div>
    {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
    <div className="print-foot">fox · {location.host}{loc.pathname} · כל מספר מקושר לעמוד המקור בדוח · הודפס {pubLabel(new Date().toISOString())}</div>
    </SourceProvider>
  );
}

/** one place on the rail (a whole label) and on the phone's bottom bar (the short one); a wide-only place leaves the bar for "עוד" */
function RailItem({ p, path, news, href }: { p: Place; path: string; news: number; href: string }) {
  const [to, icon, label, short, , wide] = p;
  const badge = to === '/questions' && news > 0;
  return (
    <NavLink to={href} end={to === '/' || to === '/my'} aria-label={badge ? `${label}, ${news} תשובות במעקב השתנו` : label} className={`item${isOn(path, p) ? ' active' : ''}${wide ? ' wide-item' : ''}`}>
      <Ico name={icon} /><span className="lbl-w">{label}</span><span className="lbl-p">{short}</span>
      {badge && <span className="wt-badge" aria-hidden="true">{news > 99 ? '99+' : news}</span>}
    </NavLink>
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
      {/* P0 · F3: the corrections log and the contact (the section itself is built on /about) */}
      <Link to="/about#corrections">תיקונים ויצירת קשר</Link>
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
