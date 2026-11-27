import { back, plab, yearAgo, type Freq } from './registry';

/* P6-2c (spec 3.7, 4.5, 14.3, T-V5): the pure parts of the peer-table host: which address keys belong to the board only, the links of the
   hub menu, the partial-quarter line over the free table and the series, and the basis line of a changed column. */

/** keys only the board lens (pages/PeersBoard and its lenses) reads: a view that is not the board never leaves them in the address (tester P5) */
export const BOARD_KEYS = ['lens', 'bm', 'rd', 'base', 'sec', 'sheet', 'gq', 'bx', 'by', 'bh', 'bs', 'bf', 'bw'];
/** keys only the free table and the series read */
export const TABLE_KEYS = ['c', 'f', 'p', 'n', 'k', 'o', 'h', 'pin', 'w', 't'];

export function leaveBoard(sp: URLSearchParams): URLSearchParams {
  const n = new URLSearchParams(sp);
  BOARD_KEYS.forEach((k) => n.delete(k));
  return n;
}

export type PeerViewId = 'board' | 'table' | 'series' | 'deck';
export const PEER_VIEWS: [PeerViewId, string][] = [['board', 'לוח ההשוואה'], ['table', 'טבלה חופשית'], ['series', 'סדרה'], ['deck', 'מצגת חיסכון']];

/** the address of a peer-table view from the current search: the set, the focus, the door stay; the other view's own keys go */
export function peerViewSearch(search: string, v: PeerViewId): string {
  const n = leaveBoard(new URLSearchParams(search));
  n.delete('v');
  if (v === 'board' || v === 'deck') TABLE_KEYS.forEach((k) => n.delete(k));
  if (v !== 'board') n.set('v', v);
  const s = n.toString();
  return s ? `?${s}` : '';
}

export interface GuardIn {
  /** the table's frequency and the period in the address ('' = the latest) */
  f: Freq; p: string;
  /** the table's latest period when `p` is empty */
  auto: string;
  /** companies with statements in the set ("7") */
  n: number;
  /** companies whose cell of the latest period is carried from an earlier one, set order */
  names: string[];
  /** the period their figures are of (the newest of them) */
  from: string | null;
  /** newest and common quarter of the set (reportStatus), and how many have not reported the newest */
  bq: string; cq: string; waiting: number;
}
export interface Guard { mode: 'latest' | 'common'; text: string; action: string; to: string }
/** The line over the free table and the series (spec 4 rule 4, 13.2 rule 4): "3 מתוך 7 דיווחו Q3'26 …" with the action that reads every
 *  company at the common period, and, once there, the line that says so with the way back. null: nothing to say. */
export function tableGuard(i: GuardIn): Guard | null {
  const quarterly = i.f === 'Q' || i.f === 'LTM';
  if (quarterly && i.p && i.p === i.cq && i.cq < i.bq && i.waiting > 0 && i.names.length === 0)
    return { mode: 'common', text: `מוצג על בסיס ${plab('Q', i.p)}, הרבעון האחרון שכל ${i.n} החברות דיווחו.`, action: `חזרה ל-${plab('Q', i.auto)} ›`, to: '' };
  if (!i.names.length || !i.from || i.p) return null;
  const k = i.names.length, done = Math.max(0, i.n - k), lf: Freq = i.f === 'LTM' ? 'Q' : i.f;  // the line names the quarter reported, not the LTM built on it
  const who = k > 4 ? `${k} חברות` : i.names.join(', ');
  return { mode: 'latest', text: `${done} מתוך ${i.n} דיווחו ${plab(lf, i.auto)}. ${who}: לפי ${plab(lf, i.from)}, מסומנות ונספרות.`, action: `הכול על ${plab(lf, i.from)} ›`, to: i.from };
}

/** the basis of a changed column, in words: "YoY: LTM Q3'26 מול LTM Q3'25" (a level has none; its period is the column's) */
export function basisLine(tr: string, f: Freq, p: string): string | null {
  if (tr === 'y') return `YoY: ${plab(f, p)} מול ${plab(f, yearAgo(f, p))}`;
  if (tr === 'q') return `מול תקופה קודמת: ${plab(f, p)} מול ${plab(f, back(f, p, 1))}`;
  if (tr === 'c') return `CAGR 3 שנים: ${plab(f, p)} מול ${plab(f, back(f, p, 3 * (f === 'FY' ? 1 : f === 'H' ? 2 : 4)))}`;
  if (tr === 's') return `נתח מהקבוצה: ${plab(f, p)}, החברות שיש להן נתון בתקופה`;
  return null;
}

/** "n" beside a median: the count it stands on (spec 13.2 rule 3) */
export const medN = (n: number) => `חציון על ${n} חברות`;

/** the series' version of the basis line: every point is read against its own earlier period */
export function seriesBasis(tr: string): string | null {
  return tr === 'y' ? 'YoY: כל נקודה מול אותה תקופה שנה קודם' : tr === 'q' ? 'כל נקודה מול התקופה הקודמת' : tr === 'c' ? 'CAGR 3 שנים עד כל נקודה' : tr === 's' ? 'נתח מהקבוצה בכל נקודה, החברות שיש להן נתון' : null;
}
