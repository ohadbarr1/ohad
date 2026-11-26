import type { CSSProperties, ReactNode } from 'react';
import { signed } from './MonthGrid';
import '../styles/compare.css';
import '../styles/rollout.css';

/* <Scoreboard> / <ScoreRow>: ranked entities for one measure (spec §4.7, §5.3, v3 §10A.2 C8). A row: the place (a shared place reads
   "2–3" with the chip "כמעט שווים"; across risk levels no place, the colour square instead), the name and a quiet line, the figure large
   with its unit under it, a bar from zero in the track's colour with a tick at the benchmark (the category average), a chevron; a tap opens
   the track sheet. The benchmark row closes the board. Rows come in the order to show (the caller sorts; across risk levels it keeps the
   chosen order). Missing figure: "אין עדיין".
   Rollout extensions (spec §2.2, §16.1 4a, F4), all optional; without them the markup is byte-identical to the shipped board
   (scripts/scoreboard-test.mjs checks it against the base commit):
   - `format(v)`: the figure as the caller writes it ("₪560" on the fees board), no sign colour;
   - `trailing(k)`: a control beside the row button, not inside it (the 46-px "＋" add-to-compare); the row and it sit in one line;
   - `ScoreRowData.mine`: the row tinted, with "שלי" after the name (`mineWord` changes or drops the word; the saver door only);
   - `bars`: 'always' (the shipped bars), 'auto' (bars only when every figure on the board is zero or more: never upside-down bars in a
     negative month), 'none'. Passing `bars` also drops the tick at the benchmark (removed on the rollout pages; the average is the
     closing line);
   - `head` (a line above the rows) and `note` (the closing note under the average: "מסלולים בהפרש קטן מ-0.05% בחודש חולקים מקום…"). */

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
  mine?: boolean;                // the reader's own track: tinted, "שלי" (rollout)
}
export type ScoreBars = 'auto' | 'always' | 'none';
export interface ScoreboardProps {
  id?: string;                   // default "board"
  rows: ScoreRowData[];
  decimals?: number;             // default 1
  benchmark?: { label: ReactNode; value: number | null } | null;
  max?: number;                  // bar scale; default the largest absolute figure
  onOpen?: (k: string) => void;
  /* ---- rollout (optional) ---- */
  format?: (v: number) => ReactNode;
  trailing?: (k: string) => ReactNode;
  bars?: ScoreBars;
  mineWord?: string | null;      // default "שלי"; null keeps the tint without the word
  head?: ReactNode;
  note?: ReactNode;
}

/** 'auto': bars only when every figure on the board is zero or more */
export const showBars = (bars: ScoreBars | undefined, vals: (number | null | undefined)[]) =>
  bars === undefined || bars === 'always' ? true : bars === 'none' ? false : vals.some((v) => v != null) && vals.every((v) => v == null || v >= 0);

interface RowOpts { format?: (v: number) => ReactNode; bars?: boolean; tick?: boolean; mineWord?: string | null }
export function ScoreRow({ r, i, max, bench, decimals, onOpen, o }: { r: ScoreRowData; i: number; max: number; bench: number | null; decimals: number; onOpen?: (k: string) => void; o?: RowOpts }) {
  const v = r.value, neg = v != null && v < 0;
  const w = v == null ? 0 : Math.max(4, (Math.abs(v) / max) * 100);
  const bars = o?.bars ?? true, mineWord = o?.mineWord === undefined ? 'שלי' : o.mineWord;
  const tick = (o?.tick ?? true) && bench != null && v != null && Math.sign(bench) === Math.sign(v) && Math.abs(bench) <= max ? (neg ? 100 - (Math.abs(bench) / max) * 100 : (Math.abs(bench) / max) * 100) : null;
  return (
    <button type="button" className={`sb-row${r.mine ? ' mine' : ''}${bars ? '' : ' nobar'}`} style={{ '--c': r.color, '--i': i } as CSSProperties} onClick={onOpen ? () => onOpen(r.k) : undefined} aria-haspopup={onOpen ? 'dialog' : undefined}>
      <span className="sb-place">{r.place == null || v == null ? <i className="sq" aria-hidden="true" /> : r.place}</span>
      <span className="nm"><b>{r.label}{r.mine && mineWord ? <span className="sb-mine">{mineWord}</span> : null}{r.tag ? <span className="tie">{r.tag}</span> : r.tie ? <span className="tie">כמעט שווים</span> : null}</b>{r.sub ? <small>{r.sub}</small> : null}</span>
      <span className="val">{v == null ? <span className="num mut">אין עדיין</span> : o?.format ? <span className="num">{o.format(v)}</span> : <span className={`num ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}`}>{signed(v, decimals, true)}</span>}{r.unit ? <small>{r.unit}</small> : null}</span>
      <span className="chev" aria-hidden="true">‹</span>
      {r.extra ? <span className="riskrow">{r.extra}</span> : v == null || !bars ? null : (
        <span className="track" aria-hidden="true">
          <i className={neg ? 'neg' : undefined} style={{ '--w': `${w.toFixed(0)}%` } as CSSProperties} />
          {tick != null ? <u style={{ '--x': `${tick.toFixed(1)}%` } as CSSProperties} /> : null}
        </span>
      )}
    </button>
  );
}

export function Scoreboard({ id = 'board', rows, decimals = 1, benchmark, max, onOpen, format, trailing, bars, mineWord, head, note }: ScoreboardProps) {
  const mx = max ?? Math.max(0.01, ...rows.map((r) => Math.abs(r.value ?? 0)));
  const bench = benchmark?.value ?? null;
  const ext = format !== undefined || trailing !== undefined || bars !== undefined || mineWord !== undefined || rows.some((r) => r.mine);
  const o: RowOpts | undefined = ext ? { format, bars: showBars(bars, rows.map((r) => r.value)), tick: bars === undefined, mineWord } : undefined;
  return (
    <div className={o ? 'board ro' : 'board'} id={id}>
      {head}
      {rows.map((r, i) => {
        const row = <ScoreRow key={r.k} r={r} i={i} max={mx} bench={bench} decimals={decimals} onOpen={onOpen} o={o} />;
        return trailing ? <div key={r.k} className={`sb-rowx${r.mine ? ' mine' : ''}`}>{row}<span className="sb-trail">{trailing(r.k)}</span></div> : row;
      })}
      {benchmark ? (
        <div className="avgline"><span>{o && !o.tick ? null : <u aria-hidden="true" />}{benchmark.label}</span>{bench == null ? <span className="num mut">–</span> : format ? <span className="num">{format(bench)}</span> : <span className={`num ${bench > 0 ? 'pos' : bench < 0 ? 'neg' : ''}`}>{signed(bench, decimals, true)}</span>}</div>
      ) : null}
      {note ? <div className="sb-note">{note}</div> : null}
    </div>
  );
}
