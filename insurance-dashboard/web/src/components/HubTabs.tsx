import { NavLink, Outlet } from 'react-router-dom';

/* fox 3.0 phase 0 (05.11.26): one canonical page per question, the former neighbours as its tabs. Each tab keeps its own address, so
   every old link still opens the same view, now with the tab row above it. The row is a layout route (App.tsx), so it shows while the
   view itself is still loading. */

type Tab = [to: string, label: string, end?: boolean];
const HUBS: Record<'feed' | 'questions' | 'data' | 'clients', { label: string; tabs: Tab[] }> = {
  // "מה השתנה": everything, what this browser follows (the answers' morning brief, /watch), the report calendar
  feed: { label: 'מה השתנה', tabs: [['/feed', 'הכול', true], ['/watch', 'שאני עוקב', true], ['/calendar', 'לוח דיווחים', true]] },
  // "שאלות": the index, the findings, the meeting briefs
  questions: { label: 'שאלות', tabs: [['/questions', 'שאלות', true], ['/findings', 'ממצאים', true], ['/brief', 'תדריכים', true]] },
  // "נתונים": quality and coverage, the report-day autopilot, the open files as an API
  data: { label: 'נתונים', tabs: [['/data', 'איכות', true], ['/data/autopilot', 'טייס אוטומטי', true], ['/data/api', 'API', true]] },
  // the agent's "לקוחות": the client folders, the stress test across them
  clients: { label: 'לקוחות', tabs: [['/clients', 'תיקים', true], ['/clients/book', 'מבחן לחץ לתיק', true]] },
};
export type HubId = keyof typeof HUBS;

export function HubTabs({ hub }: { hub: HubId }) {
  const h = HUBS[hub];
  return (
    <nav className="subnav hub-tabs" aria-label={h.label}>
      {h.tabs.map(([to, l, end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>{l}</NavLink>)}
    </nav>
  );
}

/** the layout route: the hub's tab row, then the view of the address */
export function Hub({ hub }: { hub: HubId }) {
  return <><HubTabs hub={hub} /><Outlet /></>;
}
