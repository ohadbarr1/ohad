/* Red team 06.11.26 (bring-back) · the check-up's status line and the next check-up date, in a module small enough for the saver home
   (components/home/Doors) to load without the whole check-up engine (lib/checkup re-exports it). Pure. */

const ils = (v: number) => { const a = Math.abs(v), r = a >= 100000 ? Math.round(a / 1000) * 1000 : a >= 10000 ? Math.round(a / 100) * 100 : Math.round(a / 10) * 10; return `${r.toLocaleString('en-US')} ש"ח`; };

/** a day `n` months on ('YYYY-MM-DD'), the day of the month kept where the month has it, else its last day */
export function addMonthsIso(iso: string, n: number): string {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n, d = +iso.slice(8, 10);
  const Y = y + Math.floor(m / 12), M = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate();
  return `${Y}-${String(M + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
/** the annual reminder: 11 months after the check-up, so the next one runs before the statement's anniversary */
export const YEAR_MONTHS = 11;
export const nextCheckOf = (at: string) => addMonthsIso(at, YEAR_MONTHS);

/* ======================= the status after a check-up ======================= */
/** what the saver home and /my show once a check-up ran: the red items, the saving from negotiations that ended, the day it ran */
export interface CkStatus { v: 1; at: string; red: number; saved: number }
export const CK_STATUS_KEY = 'my:ckstatus';
export const normStatus = (x: unknown): CkStatus | null => {
  const o = x as Partial<CkStatus> | null;
  return o && o.v === 1 && typeof o.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.at) && Number.isFinite(o.red) && Number.isFinite(o.saved) ? { v: 1, at: o.at, red: Math.max(0, Math.round(o.red!)), saved: Math.max(0, o.saved!) } : null;
};
/** "2 לטיפול · חסכתם כ-126,000 ש"ח · הבדיקה הבאה 10/27" */
export function statusLine(s: CkStatus): string {
  const n = nextCheckOf(s.at);
  return [s.red ? `${s.red} לטיפול` : 'אין פריטים לטיפול', s.saved >= 500 ? `חסכתם כ-${ils(s.saved)}` : null, `הבדיקה הבאה ${n.slice(5, 7)}/${n.slice(2, 4)}`].filter(Boolean).join(' · ');
}
