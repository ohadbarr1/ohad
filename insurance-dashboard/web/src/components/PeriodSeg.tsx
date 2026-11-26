import type { Door } from '../lib/door';
import type { Per } from '../lib/funds';
import '../styles/rollout.css';
import '../styles/p6.css';

/* <PeriodSeg>: the five periods in the door's words (rollout spec §2.3 as amended by §16.1 4c). Saver: "חודש · מתחילת 2026 ·
   12 חודשים · 3 שנים · 5 שנים" (no "השנה" beside "שנה"); agent and Pro: "1M · YTD · LTM · 3Y · 5Y". 44 px, never scrolls at 390 px.
   The year of "מתחילת" is the data month's year (asof), not the clock's.
   P6 (spec p6 §2.2, §13.1 F2, §14.4 F3): mode="quarter" is the board's and the company page's reading seg: "LTM · Q3'26 · YoY · QoQ ·
   LTM YoY" (the quarter's own label for `q`, never "רבעון נוכחי"; "אשתקד" never), and "3M · YTD · 12M" for total return. role="group" with
   aria-pressed, 44-px hit area. Without `mode` the five fund periods render byte-identically to the shipped seg. */

export const PERS: Per[] = ['m1', 'ytd', 'y12', 'a3', 'a5'];
const PRO: Record<Per, string> = { m1: '1M', ytd: 'YTD', y12: 'LTM', a3: '3Y', a5: '5Y' };
/** the label of a period in a door */
export function perLabel(per: Per, door: Door, asof: number): string {
  if (door !== 'saver') return PRO[per];
  return { m1: 'חודש', ytd: `מתחילת ${Math.floor(asof / 100)}`, y12: '12 חודשים', a3: '3 שנים', a5: '5 שנים' }[per];
}

/** A reading of a quarterly metric (lib/peerBoard `BMetric.reads`): ltm = sum of four quarters (flows) or the LTM ratio; q = the quarter
 *  itself ("Q3'26"); yoy / qoq = the quarter against the same quarter a year earlier / the previous quarter; ltmy = LTM against LTM a year
 *  earlier; now = the latest (multiples, no seg); r3 / rytd / r12 = total return. */
export type QRead = 'ltm' | 'q' | 'yoy' | 'qoq' | 'ltmy' | 'now' | 'r3' | 'rytd' | 'r12';
export const QREADS: QRead[] = ['ltm', 'q', 'yoy', 'qoq', 'ltmy'];
const QL: Record<Exclude<QRead, 'q'>, string> = { ltm: 'LTM', yoy: 'YoY', qoq: 'QoQ', ltmy: 'LTM YoY', now: 'עכשיו', r3: '3M', rytd: 'YTD', r12: '12M' };
/** "2026Q3" → "Q3'26" */
const qLab = (q: string) => { const m = /^(\d{4})Q([1-4])$/.exec(q); return m ? `Q${m[2]}'${m[1].slice(2)}` : q; };
/** the label of a quarterly reading: the quarter's own label for `q` */
export const qReadLabel = (r: QRead, quarter: string) => (r === 'q' ? qLab(quarter) : QL[r]);

export interface QuarterSegProps {
  mode: 'quarter';
  value: QRead;
  onChange: (r: QRead) => void;
  quarter: string;           // "2026Q3": the label of the `q` reading
  periods?: QRead[];         // the metric's readings in order (default LTM · Q · YoY · QoQ · LTM YoY)
  id?: string;               // default "period-seg"
  label?: string;            // the group's accessible name (default "קריאה")
}

export interface PeriodSegProps {
  mode?: 'fund';
  door: Door;
  value: Per;
  onChange: (p: Per) => void;
  asof: number;              // yyyymm (for "מתחילת 2026")
  id?: string;               // default "period-seg"
  periods?: Per[];           // default all five
}

export function PeriodSeg(props: PeriodSegProps | QuarterSegProps) {
  if (props.mode === 'quarter') return <QuarterSeg {...props} />;
  return <FundSeg {...props} />;
}

function QuarterSeg({ value, onChange, quarter, periods = QREADS, id = 'period-seg', label = 'קריאה' }: QuarterSegProps) {
  return (
    <div className="p6-seg p6-qseg" id={id} role="group" aria-label={label}>
      {periods.map((r) => (
        <button key={r} type="button" aria-pressed={r === value} className={r === value ? 'on' : undefined} data-r={r} onClick={() => r !== value && onChange(r)}>
          {qReadLabel(r, quarter)}
        </button>
      ))}
    </div>
  );
}

function FundSeg({ door, value, onChange, asof, id = 'period-seg', periods = PERS }: PeriodSegProps) {
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
