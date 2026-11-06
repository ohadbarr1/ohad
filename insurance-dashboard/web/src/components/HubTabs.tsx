import { Link, Outlet, useLocation } from 'react-router-dom';

/* fox 3.0 phase 0 (05.11.26): one canonical page per question, the former neighbours as its tabs. Each tab keeps its own address, so
   every old link still opens the same view, now with the tab row above it. The row is a layout route (App.tsx), so it shows while the
   view itself is still loading. Wave 2b: a tab may be a view of a page (?view=, ?v=): `on` says when it is the one in force. */

type On = (path: string, q: URLSearchParams) => boolean;
type Tab = [to: string, label: string, end?: boolean, on?: On];
const csmView = (q: URLSearchParams) => q.get('view') ?? '';
const HUBS: Record<'feed' | 'questions' | 'data' | 'clients' | 'flows' | 'industry' | 'value', { label: string; tabs: Tab[] }> = {
  // "מה השתנה": everything, what this browser follows (the answers' morning brief, /watch), the report calendar
  feed: { label: 'מה השתנה', tabs: [['/feed', 'הכול', true], ['/watch', 'שאני עוקב', true], ['/calendar', 'לוח דיווחים', true]] },
  // "שאלות": the index, the findings, the meeting briefs
  questions: { label: 'שאלות', tabs: [['/questions', 'שאלות', true], ['/findings', 'ממצאים', true], ['/brief', 'תדריכים', true]] },
  // "נתונים": quality and coverage, the report-day autopilot, the open files as an API
  data: { label: 'נתונים', tabs: [['/data', 'איכות', true], ['/data/autopilot', 'טייס אוטומטי', true], ['/data/api', 'API', true]] },
  // the agent's "לקוחות": the client folders, the stress test across them
  clients: { label: 'לקוחות', tabs: [['/clients', 'תיקים', true], ['/clients/book', 'מבחן לחץ לתיק', true]] },
  // "החודש" of the savings hub (P3, wave 2b): who won · the month's leaders and laggards and fee changes (the old /funds hub, Pro) ·
  // under the median and still taking money (/funds/under) · the monthly letter
  flows: { label: 'החודש', tabs: [['/flows', 'מי ניצח', true], ['/funds', 'מובילים ומאספים', true], ['/funds/under', 'הרבעון התחתון', true], ['/flows/letter', 'המכתב החודשי']] },
  // wave 2b: "השוואה ענפית": peers · IFRS 17 (the standardised view of the CSM ledger) · the CSM ledger's other views · capital (/capital,
  // the canonical capital page) · P&C ratios · investment houses · restatements
  industry: { label: 'השוואה ענפית', tabs: [
    ['/industry/peers', 'טבלת עמיתים'],
    ['/industry/csm?view=std', 'IFRS 17', false, (p, q) => p === '/industry/csm' && csmView(q) === 'std'],
    ['/industry/csm', 'CSM', false, (p, q) => p === '/industry/csm' && csmView(q) !== 'std'],
    ['/capital', 'הון'],
    ['/industry/pnc', 'ביטוח כללי'],
    ['/industry/houses', 'בתי השקעות'],
    ['/restatements', 'הצגות מחדש'],
  ] },
  // wave 2b: the savings hub's "ערך": the value of the month's flows (/savings?v=npv) and the fee book's embedded value (/feebook, a draft)
  value: { label: 'ערך', tabs: [
    ['/savings?v=npv', 'ערך הניוד', false, (p, q) => p === '/savings' && (q.get('v') === 'npv' || q.get('v') === 'value')],
    ['/feebook', 'ערך ספר דמי הניהול · טיוטה', true],
  ] },
};
export type HubId = keyof typeof HUBS;

const isOn = (path: string, q: URLSearchParams, [to, , end, on]: Tab) => {
  if (on) return on(path, q);
  const base = to.split('?')[0];
  return path === base || (!end && path.startsWith(`${base}/`));
};

export function HubTabs({ hub, sub }: { hub: HubId; sub?: boolean }) {
  const h = HUBS[hub];
  const loc = useLocation();
  const path = loc.pathname.replace(/\/+$/, '') || '/', q = new URLSearchParams(loc.search);
  return (
    <nav className={`subnav hub-tabs${sub ? ' sub2' : ''}`} aria-label={h.label}>
      {h.tabs.map((t) => { const on = isOn(path, q, t); return <Link key={t[0]} to={t[0]} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined}>{t[1]}</Link>; })}
    </nav>
  );
}

/** the layout route: the hub's tab row, then the view of the address */
export function Hub({ hub }: { hub: HubId }) {
  return <><HubTabs hub={hub} /><Outlet /></>;
}
