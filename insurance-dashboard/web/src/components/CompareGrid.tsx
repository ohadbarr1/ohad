import type React from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { leadOf } from './MonthGrid';
import '../styles/compare.css';

/* <CompareGrid>: entities × metrics, the lead of a row marked (spec §5.3; "להחלטה", "סיכון", the fee sheet, the risk note, the extremes
   block; later the peers board and managers' fees). Presentational: each row brings its own cell renderer and the value its lead is judged
   on. The lead is marked by weight and a soft pill (never by colour alone), only when the row has a direction, the values differ, and
   `mark` is on (off across risk levels or products). Columns carry the track's colour as a bar over the name.
   A cell whose figure opens its source (Sourced) is tappable as a whole: a tap anywhere in the cell opens the figure's source (review B2
   N4: the figure alone was 17 px high); the keyboard and screen readers still reach the figure's own button. */

/** a tap on a cell, not on a control in it: the cell's first sourced figure opens */
const cellTap = (e: React.MouseEvent<HTMLTableCellElement>) => {
  if ((e.target as HTMLElement).closest('a, button, input, select, label')) return;
  e.currentTarget.querySelector<HTMLElement>('a.src, button.src')?.click();
};

export interface CompareGridCol { k: string; label: string; color: string; sub?: string }
export interface CompareGridRow {
  key?: string;
  label: ReactNode;                          // the row's name ("דמי ניהול מצבירה")
  sub?: ReactNode;                           // a quiet second line under the name
  cell: (k: string) => ReactNode;            // what the cell shows (a formatted figure, with its own small line if any)
  value?: (k: string) => number | null;      // the figure the lead is judged on
  better?: 'hi' | 'lo' | null;               // direction; null/absent = never marked
  band?: number;                             // tie band in the value's units (default 0: equal values share the lead)
}
export interface CompareGridProps {
  id?: string;
  cols: CompareGridCol[];
  rows: CompareGridRow[];
  mark?: boolean;                            // default true; false across risk levels or products (sameGroupOnly)
  head?: boolean;                            // the column heads (default true)
  corner?: ReactNode;                        // the corner cell
  onCol?: (k: string) => void;
  quiet?: boolean;                           // grey, smaller (the fee sheet's "איך זה מתחלק")
  className?: string;
}

export function CompareGrid({ id, cols, rows, mark = true, head = true, corner, onCol, quiet = false, className }: CompareGridProps) {
  return (
    <table className={['cg', quiet ? 'quiet' : '', className ?? ''].filter(Boolean).join(' ')} id={id}>
      {head ? (
        <thead>
          <tr>
            <th scope="col" className="cg-corner">{corner}</th>
            {cols.map((c) => (
              <th key={c.k} scope="col" style={{ '--c': c.color } as CSSProperties}>
                <button type="button" className="mg-col" onClick={onCol ? () => onCol(c.k) : undefined} disabled={!onCol}>
                  <i className="mg-bar" aria-hidden="true" /><b>{c.label}</b>{c.sub ? <small>{c.sub}</small> : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((r, ri) => {
          const vals = r.value ? cols.map((c) => r.value!(c.k)) : [];
          const lead = mark && r.better && r.value ? leadOf(vals, Math.max(r.band ?? 0, 1e-6), r.better) : [];
          return (
            <tr key={r.key ?? ri}>
              <th scope="row">{r.label}{r.sub ? <small>{r.sub}</small> : null}</th>
              {cols.map((c, i) => <td key={c.k} className={lead.includes(i) ? 'lead' : undefined} onClick={cellTap}>{r.cell(c.k)}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
