import { useLocation } from 'react-router-dom';
import { DOORS, useDoor, type Door } from '../../lib/door';

/* W1 shell: the door in force. The stored choice (lib/door.ts, this browser only), unless the address carries ?door=, which wins at
   once (no flash of another door's home) and is then stored and dropped from the address by the layout, so a shared link opens the
   right door and keeps it. ?door=pick clears the choice and shows the picker. */
export const isDoor = (v: string | null): v is Door => DOORS.some(([d]) => d === v);
/** what ?door= asks for: a door, null (the picker), or undefined (nothing asked) */
export function doorFromSearch(search: string): Door | null | undefined {
  const v = new URLSearchParams(search).get('door');
  if (v == null) return undefined;
  return isDoor(v) ? v : v === 'pick' || v === '' ? null : undefined;
}

export function useActiveDoor(): [Door | null, (d: Door | null) => void] {
  const [stored, setDoor] = useDoor();
  const asked = doorFromSearch(useLocation().search);
  return [asked === undefined ? stored : asked, setDoor];
}

export const doorLabel = (d: Door) => DOORS.find(([x]) => x === d)![1];

/** Sections that belong to the Pro terminal: opened from the saver or agent door, they carry a small "עמוד מקצועי" chip. */
export const PRO_SECTIONS = new Set(['pro', 'company', 'companies', 'industry', 'compare', 'savings', 'holdings', 'valuation', 'calendar', 'book', 'data', 'restatements',
  'presentations', 'credibility', 'nowcast', 'debt', 'facts', 'ownership', 'card', 'attribution', 'feed', 'positions', 'drivers', 'scenarios', 'warroom', 'capital',
  'fragility', 'expectations', 'consolidation', 'questions', 'findings', 'brief', 'watch', 'doc', 'market']);
export const isProPage = (path: string) => PRO_SECTIONS.has(path.split('/')[1] ?? '');
