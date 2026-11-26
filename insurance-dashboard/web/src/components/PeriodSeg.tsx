import type { Door } from '../lib/door';
import type { Per } from '../lib/funds';
import '../styles/rollout.css';

/* <PeriodSeg>: the five periods in the door's words (rollout spec §2.3 as amended by §16.1 4c). Saver: "חודש · מתחילת 2026 ·
   12 חודשים · 3 שנים · 5 שנים" (no "השנה" beside "שנה"); agent and Pro: "1M · YTD · LTM · 3Y · 5Y". 44 px, never scrolls at 390 px.
   The year of "מתחילת" is the data month's year (asof), not the clock's. */

export const PERS: Per[] = ['m1', 'ytd', 'y12', 'a3', 'a5'];
const PRO: Record<Per, string> = { m1: '1M', ytd: 'YTD', y12: 'LTM', a3: '3Y', a5: '5Y' };
/** the label of a period in a door */
export function perLabel(per: Per, door: Door, asof: number): string {
  if (door !== 'saver') return PRO[per];
  return { m1: 'חודש', ytd: `מתחילת ${Math.floor(asof / 100)}`, y12: '12 חודשים', a3: '3 שנים', a5: '5 שנים' }[per];
}

export interface PeriodSegProps {
  door: Door;
  value: Per;
  onChange: (p: Per) => void;
  asof: number;              // yyyymm (for "מתחילת 2026")
  id?: string;               // default "period-seg"
  periods?: Per[];           // default all five
}

export function PeriodSeg({ door, value, onChange, asof, id = 'period-seg', periods = PERS }: PeriodSegProps) {
  return (
    <div className="ro-seg" id={id} role="tablist" aria-label="תקופה">
      {periods.map((p) => (
        <button key={p} type="button" role="tab" aria-selected={p === value} className={p === value ? 'on' : undefined} onClick={() => p !== value && onChange(p)}>
          {perLabel(p, door, asof)}
        </button>
      ))}
    </div>
  );
}
