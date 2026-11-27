import type { CSSProperties, ReactNode } from 'react';
import { signed } from './MonthGrid';
import '../styles/compare.css';
import '../styles/rollout.css';
import '../styles/p6.css';

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
   - `head` (a line above the rows) and `note` (the closing note under the average: "מסלולים בהפרש קטן מ-0.05% בחודש חולקים מקום…").
   P6 (spec p6 §2.2, §13.1 F3, §13.3 F3+, §14.4 F3), layout="track", the peers board. Without `layout` nothing below is reached:
   - each row is a fixed grid [place + name, any tag on a second line under the name] · [track] · [value]; the name column has one width
     on every row, so every track starts and ends at the same x, and a tag wraps inside the name column (never into the track);
   - bars on one scale from a common zero (min(0, values) … max(0, values), or `range`): a negative runs the other way from the zero line
     (drawn whenever a value is negative); a value outside `range` pins at the edge with its true value printed (the caller tags it "חריג");
   - the median: a 2-px line at one x through every ranked row (`benchmark.line`, default on); the closing average line only when
     `benchmark.label` is given (the board puts the median with its n in `head` instead);
   - `ScoreRowData.out`: not ranked and not in the median (a quarter-named reading the company has not reported): listed after the ranked
     rows under `outHead`, muted, place "–", no bar, its own last figure and its quarter tag ("Q2'26 · טרם דיווחה");
   - the row's name opens the company (`onOpen`); the value is the page's (`cell`, e.g. through <Sourced>), so a number opens its source
     in one tap and no button sits inside another; `mine` is the focus row (tint, the accent bar); `data` sets data-* on the board. */

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
  out?: boolean;                 // p6 track: not ranked, not in the median; listed under `outHead`
}
export type ScoreBars = 'auto' | 'always' | 'none';
export interface ScoreboardProps {
  id?: string;                   // default "board"
  rows: ScoreRowData[];
  decimals?: number;             // default 1
  benchmark?: { label: ReactNode; value: number | null; line?: boolean } | null;
  max?: number;                  // bar scale; default the largest absolute figure
  onOpen?: (k: string) => void;
  /* ---- rollout (optional) ---- */
  format?: (v: number) => ReactNode;
  trailing?: (k: string) => ReactNode;
  bars?: ScoreBars;
  mineWord?: string | null;      // default "שלי"; null keeps the tint without the word
  head?: ReactNode;
  note?: ReactNode;
  /* ---- p6 (optional; only with layout="track") ---- */
  layout?: 'track';
  outHead?: ReactNode;           // "לא בדירוג ולא בחציון: הדוח ל-Q3'26 טרם פורסם"
  cell?: (r: ScoreRowData, text: string) => ReactNode;  // the value slot (text = the default or `format` writing)
  range?: [number, number];      // the bar scale; default min(0, ranked values) … max(0, ranked values)
  data?: Record<string, string>; // data-* on the board (data-metric, data-reading)
  label?: string;                // the board's accessible name
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

export function Scoreboard(props: ScoreboardProps) {
  if (props.layout === 'track') return <TrackBoard {...props} />;
  return <ClassicBoard {...props} />;
}

/** p6: the scale of a track board: [lo, hi] with zero inside, from the ranked rows (and the median) */
export function trackScale(vals: (number | null | undefined)[], range?: [number, number]): [number, number] {
  if (range) return [Math.min(range[0], 0), Math.max(range[1], 0)];
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  const lo = Math.min(0, ...v), hi = Math.max(0, ...v);
  return hi - lo > 0 ? [lo, hi] : [0, 1];
}
/** p6: a bar's start and width in % of the track, from the zero; a value outside the scale pins at the edge */
export function barOf(v: number, [lo, hi]: [number, number]): { start: number; width: number; pinned: boolean } {
  const span = hi - lo || 1, pos = (x: number) => ((Math.min(hi, Math.max(lo, x)) - lo) / span) * 100;
  const z = pos(0), p = pos(v);
  return { start: +Math.min(z, p).toFixed(2), width: +Math.max(0.8, Math.abs(p - z)).toFixed(2), pinned: v > hi || v < lo };
}
export const posOf = (v: number, [lo, hi]: [number, number]) => +(((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * 100).toFixed(2);

function TrackBoard({ id = 'board', rows, decimals = 1, benchmark, onOpen, format, head, note, outHead, cell, range, data, label, mineWord }: ScoreboardProps) {
  const inn = rows.filter((r) => !r.out), out = rows.filter((r) => r.out);
  const bench = benchmark?.value ?? null, line = benchmark?.line ?? true;
  const sc = trackScale([...inn.map((r) => r.value), bench], range);
  const neg = sc[0] < 0, zero = posOf(0, sc), med = bench != null && line ? posOf(bench, sc) : null;
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) attrs[`data-${k}`] = v;
  const text = (v: number | null) => { if (v == null) return '–'; const f = format?.(v); return typeof f === 'string' || typeof f === 'number' ? String(f) : signed(v, decimals, true); };
  const row = (r: ScoreRowData, i: number) => {
    const v = r.value, has = v != null && Number.isFinite(v), b = has && !r.out ? barOf(v as number, sc) : null;
    const tag = r.tag ?? (r.tie && !r.out ? 'כמעט שווים' : null);
    const t = text(has ? (v as number) : null);
    const valNode = cell ? cell(r, t) : !has ? <span className="num mut">–</span> : format ? <span className="num">{format(v as number)}</span> : <span className={`num ${(v as number) > 0 ? 'pos' : (v as number) < 0 ? 'neg' : ''}`}>{t}</span>;
    return (
      <div key={r.k} className={`sb-row p6-tr${r.mine ? ' mine' : ''}${r.out ? ' out' : ''}`} data-k={r.k} style={{ '--c': r.color, '--i': i } as CSSProperties}>
        <button type="button" className="p6-sb-open" onClick={onOpen ? () => onOpen(r.k) : undefined} aria-haspopup={onOpen ? 'dialog' : undefined} aria-label={onOpen ? `${r.label}: מול הקבוצה` : undefined}>
          <span className="sb-place">{r.out || r.place == null || !has ? '–' : r.place}</span>
          <span className="p6-sb-nm">
            <span className="p6-sb-n"><i className="sq" aria-hidden="true" /><b>{r.label}</b>{r.mine && mineWord ? <span className="sb-mine">{mineWord}</span> : null}</span>
            {tag ? <span className={`p6-sb-tag${r.out ? ' warn' : ''}`}>{tag}</span> : null}
            {r.sub ? <small>{r.sub}</small> : null}
          </span>
        </button>
        <span className="p6-sb-track" aria-hidden="true">
          {b ? <i className={`${(v as number) < 0 ? 'neg' : ''}${b.pinned ? ' pin' : ''}`.trim() || undefined} style={{ insetInlineStart: `${b.start}%`, width: `${b.width}%` }} /> : null}
          {neg && !r.out ? <s style={{ insetInlineStart: `${zero}%` }} /> : null}
          {med != null && !r.out ? <em style={{ insetInlineStart: `${med}%` }} /> : null}
        </span>
        <span className="p6-sb-val">{valNode}</span>
      </div>
    );
  };
  return (
    <div className={`board p6-sb${neg ? ' p6-neg' : ''}`} id={id} role="group" aria-label={label} {...attrs}>
      {head}
      {inn.map(row)}
      {out.length ? <div className="p6-sb-sub">{outHead}</div> : null}
      {out.map((r, i) => row(r, inn.length + i))}
      {benchmark && benchmark.label != null ? (
        <div className="avgline"><span>{benchmark.label}</span>{bench == null ? <span className="num mut">–</span> : format ? <span className="num">{format(bench)}</span> : <span className={`num ${bench > 0 ? 'pos' : bench < 0 ? 'neg' : ''}`}>{signed(bench, decimals, true)}</span>}</div>
      ) : null}
      {note ? <div className="sb-note">{note}</div> : null}
    </div>
  );
}

function ClassicBoard({ id = 'board', rows, decimals = 1, benchmark, max, onOpen, format, trailing, bars, mineWord, head, note }: ScoreboardProps) {
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
