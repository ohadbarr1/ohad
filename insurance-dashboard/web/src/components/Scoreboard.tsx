import type { CSSProperties, ReactNode } from 'react';
import { signed } from './MonthGrid';
import '../styles/compare.css';

/* <Scoreboard> / <ScoreRow>: ranked entities for one measure (spec §4.7, §5.3, v3 §10A.2 C8). A row: the place (a shared place reads
   "2–3" with the chip "כמעט שווים"; across risk levels no place, the colour square instead), the name and a quiet line, the figure large
   with its unit under it, a bar from zero in the track's colour with a tick at the benchmark (the category average), a chevron; a tap opens
   the track sheet. The benchmark row closes the board. Rows come in the order to show (the caller sorts; across risk levels it keeps the
   chosen order). Missing figure: "אין עדיין". */

export interface ScoreRowData {
  k: string;
  label: string;
  color: string;
  sub?: ReactNode;               // "דמי ניהול 0.15% מהחיסכון"
  value: number | null;
  unit?: string;                 // "בשנה, בממוצע"
  place?: string | number | null; // "1", "2–3"; null/absent = the colour square
  tie?: boolean;                 // shows "כמעט שווים"
  tag?: ReactNode;               // a chip after the name instead (e.g. "73% מניות")
  extra?: ReactNode;             // a line of key-values instead of the bar (across risk levels: worst month, largest drop)
}
export interface ScoreboardProps {
  id?: string;                   // default "board"
  rows: ScoreRowData[];
  decimals?: number;             // default 1
  benchmark?: { label: ReactNode; value: number | null } | null;
  max?: number;                  // bar scale; default the largest absolute figure
  onOpen?: (k: string) => void;
}

export function ScoreRow({ r, i, max, bench, decimals, onOpen }: { r: ScoreRowData; i: number; max: number; bench: number | null; decimals: number; onOpen?: (k: string) => void }) {
  const v = r.value, neg = v != null && v < 0;
  const w = v == null ? 0 : Math.max(4, (Math.abs(v) / max) * 100);
  const tick = bench != null && v != null && Math.sign(bench) === Math.sign(v) && Math.abs(bench) <= max ? (neg ? 100 - (Math.abs(bench) / max) * 100 : (Math.abs(bench) / max) * 100) : null;
  return (
    <button type="button" className="sb-row" style={{ '--c': r.color, '--i': i } as CSSProperties} onClick={onOpen ? () => onOpen(r.k) : undefined} aria-haspopup={onOpen ? 'dialog' : undefined}>
      <span className="sb-place">{r.place == null || v == null ? <i className="sq" aria-hidden="true" /> : r.place}</span>
      <span className="nm"><b>{r.label}{r.tag ? <span className="tie">{r.tag}</span> : r.tie ? <span className="tie">כמעט שווים</span> : null}</b>{r.sub ? <small>{r.sub}</small> : null}</span>
      <span className="val">{v == null ? <span className="num mut">אין עדיין</span> : <span className={`num ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}`}>{signed(v, decimals, true)}</span>}{r.unit ? <small>{r.unit}</small> : null}</span>
      <span className="chev" aria-hidden="true">‹</span>
      {r.extra ? <span className="riskrow">{r.extra}</span> : v == null ? null : (
        <span className="track" aria-hidden="true">
          <i className={neg ? 'neg' : undefined} style={{ '--w': `${w.toFixed(0)}%` } as CSSProperties} />
          {tick != null ? <u style={{ '--x': `${tick.toFixed(1)}%` } as CSSProperties} /> : null}
        </span>
      )}
    </button>
  );
}

export function Scoreboard({ id = 'board', rows, decimals = 1, benchmark, max, onOpen }: ScoreboardProps) {
  const mx = max ?? Math.max(0.01, ...rows.map((r) => Math.abs(r.value ?? 0)));
  const bench = benchmark?.value ?? null;
  return (
    <div className="board" id={id}>
      {rows.map((r, i) => <ScoreRow key={r.k} r={r} i={i} max={mx} bench={bench} decimals={decimals} onOpen={onOpen} />)}
      {benchmark ? (
        <div className="avgline"><span><u aria-hidden="true" />{benchmark.label}</span>{bench == null ? <span className="num mut">–</span> : <span className={`num ${bench > 0 ? 'pos' : bench < 0 ? 'neg' : ''}`}>{signed(bench, decimals, true)}</span>}</div>
      ) : null}
    </div>
  );
}
