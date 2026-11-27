import type { CSSProperties, ReactNode } from 'react';
import '../styles/compare.css';
import '../styles/p6.css';

/* <MonthGrid>: entities × periods, heat (spec §4.3 item 5, §5.3, v3 §10A.2 C1/C4/D4). Presentational: the numbers come in (lib/compareMonths
   builds the rows), the grid only formats, colours and marks them.
   - Columns: one per track (a colour bar over the name, the name taps open the track sheet), optionally the category average last.
   - Rows: newest first; the first row larger and bold, with "%" in its cells up to four columns; month labels in Hebrew with a two-digit year,
     full names up to three columns and short from four ("אוקטובר 26" / "אוק׳ 26"); a two-line unit label in the corner cell.
   - Cells: the signed figure (U+2212 for minus, always a sign), a heat fill from --heat-up / --heat-down at 7–40% by size (scale = the 90th
     percentile of the absolute values on screen), the ink colour on top. The lead of a row is marked by weight, a ring and a dot, never by
     colour alone; tracks inside the tie band share the mark; a row whose spread is inside the band marks nobody. mark='none' (different
     risk levels or products) marks nothing, in the body or the footer.
   - Footer: summary rows (half year, last year; 3 and 5 years in the years view) and the fee row in shekels ("₪560", "—" under the average
     column); the best of a summary row is ringed (higher is better for returns, lower for fees, each with its own band).
   Sticky: the header row sticks at var(--mg-top, 0px) (the shell sets it to the bottom of its sticky strip) and the label column sticks to
   the start edge; with five or more columns the grid scrolls sideways inside its card, the page never does.
   P6 (spec p6 §2.2, §13.3 F3+, §14.4 F3, tester P2/P3), kind="quarters": companies × quarters, newest first. Everything below is reached only
   with kind="quarters"; months and years render byte-identically to the shipped grid (scripts/month-grid-test.mjs checks it against the
   committed copies in scripts/fixtures/).
   - Rows carry key "2026Q3" and the label "Q3'26" (derived from the key when absent), aligned to the middle of their cells (P3); the newest
     (or `cur`) row's label in the accent colour. No lead marks (mark defaults to 'none'), no "%" row, no first-row enlargement.
   - Cells: `format(v, col)` writes the figure (default: thousands commas, `decimals`; signed when heat="sign"); per-cell marks `star`
     ("*", carried, counted) and `dagger` ("†", printed on another basis); a null cell is hatched "–" with its reason from `why`. heat
     defaults to 'none' (a level); 'sign' tints changes. `renderCell` lets the page draw the figure through `Sourced` (one tap to its source).
   - Heads: full company names, two lines allowed, never clipped; `focus` bolds a company's column.
   - The median (showAvg, avgLabel default "חציון"): its n as a superscript on every median cell; `avgAt` puts the medians in a last
     column ('col'), in a bold row block under the grid with the same quarter labels as heads ('row', six quarters per line), or 'auto':
     the column when the grid is wide enough for 8 columns of ≥ 44 px, the row block when it is not (a container query, phone).
   - `rowsMax` keeps the first N rows (the 6 / 12 option; `RowsSeg` is the control). */

export type MonthGridMark = 'row-max' | 'none';
/** returns are gross only (owner 26.11.26): the corner always says "לפני דמי ניהול" */
export type Basis = 'gross';

/** One column: a track (k = fund key) */
export interface MonthGridCol { k: string; label: string; color: string; sub?: string; closed?: boolean }
/** One body row. Months: give `p` (yyyymm) and the grid writes the Hebrew label; years: give `label` ("2026") and `sub` ("עד אוק׳");
 *  quarters: give `key` ("2026Q3"); the label "Q3'26" is derived when `label` is absent. */
export interface MonthGridRow {
  key?: string;              // defaults to String(p)
  p?: number;                // yyyymm (month rows)
  label?: string;            // overrides the month label (year rows)
  sub?: string;              // a small second line under the label
  vals: (number | null)[];   // one per column, in column order; null = no figure ("–")
  avg?: number | null;       // the category average of the row (shown with showAvg)
  lead?: number[];           // column indexes that lead the row (from lib/compareMonths rowLead); computed here when absent
  /* ---- quarters (p6) ---- */
  n?: number | null;         // how many figures the median stands on: a superscript beside the median (always in quarters)
  star?: (boolean | null | undefined)[];   // per cell: carried from the company's last report ("*")
  dagger?: (boolean | null | undefined)[]; // per cell: printed on another basis than the company's latest ("†")
  why?: (string | null | undefined)[];     // per cell: the reason of a "–" ("טרם דיווחה", "אין נתון", "בסיס שלילי")
}
/** One footer row: a summary in percent, or the fee in shekels */
export interface MonthGridSum {
  key: string;
  label: string;             // "חצי שנה", "שנה אחרונה", "3 שנים, בשנה", "דמי ניהול"
  sub?: string;              // "בשנה ›" (fee row; rendered in the link colour)
  vals: (number | null)[];
  avg?: number | null;       // under the average column; null renders "—" for shekels, "–" for percent
  unit?: 'pct' | 'ils';      // default 'pct' (one decimal, signed, "%"); 'ils' = "₪560", thousands comma
  better?: 'hi' | 'lo' | null; // default 'hi' for pct, 'lo' for ils
  band?: number;             // tie band: default 0.10 points (pct), 20 ₪ (ils)
  lead?: number[];           // indexes to ring; computed from better + band when absent
  onOpen?: () => void;       // the row opens a sheet (the fee row → the fee sheet)
  id?: string;               // e.g. "fee-line"
}

export interface MonthGridProps {
  id?: string;                         // default "month-grid"
  cols: MonthGridCol[];
  rows: MonthGridRow[];
  footer?: MonthGridSum[];
  kind?: 'months' | 'years' | 'quarters'; // years: one decimal, band 0.10, narrow label column; quarters: see the header note
  decimals?: number;                   // default 2 (months) / 1 (years)
  mark?: MonthGridMark;                // default 'row-max'
  tie?: number;                        // the body's tie band in points: default 0.05 (a month, O4) / 0.10 (a year)
  scale?: number;                      // heat scale (lib/compareMonths heatScale); computed here when absent
  basis?: Basis;                       // the corner label: before fees (gross, as published)
  unit?: ReactNode;                    // replaces the corner label
  showAvg?: boolean;                   // the category-average column (Pro)
  avgLabel?: [string, string];         // default ["ממוצע", "הסוג"]
  labels?: 'auto' | 'full' | 'short';  // month names: auto = full up to three columns, short from four
  onCell?: (rowKey: string, k: string | null) => void;  // k = null for the average column
  onCol?: (k: string) => void;         // a column head (the track sheet)
  onAvg?: () => void;                  // the average column's head (rollout card: the type-month sheet); absent = a plain head
  avgId?: string;                      // the average head's id when it is a button (default "avg-head")
  more?: { label: string; onClick: () => void; id?: string };  // "עוד 6 חודשים ▾" / "עוד שנים ▾"
  loading?: boolean;                   // skeleton rows of the final height
  skeletonRows?: number;               // default 6
  /* ---- quarters (p6); ignored by months and years ---- */
  format?: (v: number, colIndex: number) => string;  // the figure as written ("1.70", "+7.1%", "17,893"); colIndex −1 = the median
  heat?: 'sign' | 'none';              // default 'none' (levels); 'sign' for change readings
  avgAt?: 'col' | 'row' | 'auto';      // where the medians sit (default 'auto')
  focus?: string;                      // a company's column in bold (the focus company)
  cur?: string;                        // the row key whose label is in the accent colour (default: the first row)
  rowsMax?: number;                    // keep the first N rows (6 / 12)
  /** the figure of a cell drawn by the page (e.g. through <Sourced>); k = null for the median. Absent: a button calling onCell. */
  renderCell?: (rowKey: string, k: string | null, text: string, v: number | null) => ReactNode;
  data?: Record<string, string>;       // data-* attributes on the table (data-reading, …); data-kind="quarters" is always set
}

export const HEM = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
export const HEMF = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
/** "אוקטובר 26" / "אוק׳ 26" */
export const monthLabel = (p: number, short = false) => `${(short ? HEM : HEMF)[(p % 100) - 1]} ${String(Math.floor(p / 100)).slice(2)}`;
/** "אוקטובר 2026" (sheet titles, cell labels for screen readers) */
export const monthFull = (p: number) => `${HEMF[(p % 100) - 1]} ${Math.floor(p / 100)}`;

const MINUS = '−';
/** half-up on the absolute value (8.85 → 8.9, as the live site shows); the sign written, U+2212 for minus; "–" for no figure */
export function signed(v: number | null | undefined, d = 2, pct = false): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const a = (Math.round(Math.abs(v) * 10 ** d + 1e-6) / 10 ** d).toFixed(d);
  const zero = Number(a) === 0;
  return `${zero ? '' : v > 0 ? '+' : MINUS}${a}${pct ? '%' : ''}`;
}
/** "₪1,560" (shekels, already rounded by the caller) */
export const shekels = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);

/** 90th percentile of the absolute values: one extreme month does not flatten the rest */
export function heatScale(vals: (number | null | undefined)[]): number {
  const a = vals.filter((v): v is number => v != null && Number.isFinite(v)).map(Math.abs).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length * 0.9)] || a[a.length - 1] || 1 : 1;
}
/** the fill of a cell: which hue and how strong (7%–40% by size against the scale); none for no figure or zero */
export function heatFill(v: number | null | undefined, scale: number): { hue: 'up' | 'down' | null; alpha: number } {
  if (v == null || !Number.isFinite(v) || v === 0) return { hue: null, alpha: 0 };
  return { hue: v < 0 ? 'down' : 'up', alpha: +(0.07 + 0.33 * Math.min(1, Math.abs(v) / (scale || 1))).toFixed(2) };
}
/** Indexes inside the band of the best (hi: the max, lo: the min). Nobody when fewer than two figures, or when every figure is inside the band. */
export function leadOf(vals: (number | null | undefined)[], band: number, better: 'hi' | 'lo' = 'hi'): number[] {
  const have = vals.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  if (have.length < 2) return [];
  const sgn = better === 'hi' ? 1 : -1, best = Math.max(...have.map((x) => sgn * x.v)), worst = Math.min(...have.map((x) => sgn * x.v));
  if (best - worst < band - 1e-9) return [];
  return have.filter((x) => best - sgn * x.v < band - 1e-9).map((x) => x.i);
}
/** "2026Q3" → "Q3'26" (a key that is not a quarter is returned as it is) */
export const quarterLabel = (key: string) => { const m = /^(\d{4})Q([1-4])$/.exec(key); return m ? `Q${m[2]}'${m[1].slice(2)}` : key; };
/** a level in the quarters grid: thousands commas, fixed decimals, U+2212 for minus; "–" for none */
export function plain(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const a = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return Number(a.replace(/,/g, '')) === 0 ? a : v < 0 ? `${MINUS}${a}` : a;
}
/** the text of a quarters cell: the figure, then "†" (another basis) and "*" (carried) */
export const cellText = (txt: string, star?: boolean | null, dagger?: boolean | null) => `${txt}${dagger ? '†' : ''}${star ? '*' : ''}`;
/** the median row block on a phone: quarters in lines of six */
export const chunk = <T,>(a: T[], k = 6): T[][] => Array.from({ length: Math.ceil(a.length / k) }, (_, i) => a.slice(i * k, i * k + k));

/** layout of the grid for a column count (tracks + the average column): month-label width, short names, "%" on the first row, sideways scroll */
export function gridLayout(n: number, kind: 'months' | 'years' = 'months', labels: 'auto' | 'full' | 'short' = 'auto') {
  const short = labels === 'short' || (labels === 'auto' && n > 3);
  const mw = kind === 'years' ? 72 : short ? 62 : 84;
  return { short, mw, wideLabel: mw >= 84, pctFirst: n <= 4, compact: n >= 4, wide: n > 4, width: n > 4 ? mw + n * 74 : null };
}

const Dot = () => <i className="mg-dot" aria-hidden="true" />;

export function MonthGrid(props: MonthGridProps) {
  if (props.kind === 'quarters') return <QuarterGrid {...props} />;
  const { id = 'month-grid', cols, rows, footer = [], kind = 'months', mark = 'row-max', showAvg = false, onCell, onCol, more, loading = false } = props;
  const yrs = kind === 'years';
  const d = props.decimals ?? (yrs ? 1 : 2), band = props.tie ?? (yrs ? 0.1 : 0.05);
  const n = cols.length + (showAvg ? 1 : 0), L = gridLayout(n, kind, props.labels);
  const scale = props.scale ?? heatScale(rows.flatMap((r) => r.vals));
  const [avgA, avgB] = props.avgLabel ?? ['ממוצע', 'הסוג'];
  const after = 'לפני';
  const unit = props.unit ?? (L.wideLabel ? <>באחוזים,<br />{after} דמי ניהול</> : <>%, {after}<br />דמי ניהול</>);
  const rowKey = (r: MonthGridRow) => r.key ?? String(r.p ?? r.label ?? '');
  const rowLabel = (r: MonthGridRow) => r.label ?? (r.p != null ? monthLabel(r.p, L.short) : '');
  const rowFull = (r: MonthGridRow) => r.label ?? (r.p != null ? monthFull(r.p) : '');
  const cls = ['mg', L.compact ? 'c4' : '', L.wide ? 'wide' : '', yrs ? 'yrs' : ''].filter(Boolean).join(' ');

  const head = (
    <thead>
      <tr>
        <th className="m" scope="col"><span className="mg-unit">{unit}</span></th>
        {cols.map((c) => (
          <th key={c.k} scope="col" style={{ '--c': c.color } as CSSProperties}>
            <button type="button" className="mg-col" onClick={onCol ? () => onCol(c.k) : undefined} disabled={!onCol} aria-label={onCol ? `${c.label}: פרטי המסלול` : undefined}>
              <i className="mg-bar" aria-hidden="true" /><b>{c.label}</b>{c.sub ? <small>{c.sub}</small> : null}{c.closed ? <small className="mg-closed">נסגר</small> : null}
            </button>
          </th>
        ))}
        {showAvg ? (
          <th scope="col" className="avg" style={{ '--c': 'var(--line)' } as CSSProperties}>
            {props.onAvg ? (
              <button type="button" className="mg-col mg-avgh" id={props.avgId ?? 'avg-head'} onClick={props.onAvg} aria-haspopup="dialog"><i className="mg-bar" aria-hidden="true" /><b>{avgA}</b><small>{avgB}</small></button>
            ) : (
              <span className="mg-col"><i className="mg-bar" aria-hidden="true" /><b>{avgA}</b><small>{avgB}</small></span>
            )}
          </th>
        ) : null}
      </tr>
    </thead>
  );

  if (loading) {
    const sk = props.skeletonRows ?? 6, nf = footer.length || 3;
    return (
      <div className={`mgw${L.wide ? ' scroll' : ''}`} aria-busy="true">
        <table className={cls} id={id} style={L.width ? { width: L.width } : undefined}>
          <colgroup><col style={{ width: L.mw }} />{Array.from({ length: n }, (_, i) => <col key={i} />)}</colgroup>
          {head}
          <tbody>
            {Array.from({ length: sk }, (_, ri) => (
              <tr key={ri} className={ri === 0 ? 'first' : ''}>
                <th className="m" scope="row"><span className="mg-skel" style={{ width: '70%' }} /></th>
                {Array.from({ length: n }, (_, i) => <td key={i}><span className="mg-cell mg-skelcell" /></td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            {Array.from({ length: nf }, (_, ri) => (
              <tr key={ri} className="sum">
                <th className="m" scope="row"><span className="mg-skel" style={{ width: '60%' }} /></th>
                {Array.from({ length: n }, (_, i) => <td key={i}><span className="mg-skel" style={{ width: '55%', margin: 'auto' }} /></td>)}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    );
  }

  const body = rows.map((r, ri) => {
    const k = rowKey(r), first = ri === 0;
    const lead = mark === 'none' ? [] : r.lead ?? leadOf(r.vals, band, 'hi');
    const pct = first && L.pctFirst;
    return (
      <tr key={k} className={first ? 'first' : undefined} style={{ '--i': Math.min(ri, 12) } as CSSProperties}>
        <th className="m" scope="row">{rowLabel(r)}{r.sub ? <small>{r.sub}</small> : null}</th>
        {r.vals.map((v, i) => {
          const c = cols[i]; if (!c) return null;
          const h = heatFill(v, scale), best = lead.includes(i);
          const style = { '--k': h.hue ? `var(--heat-${h.hue})` : '0 0 0', '--a': h.alpha } as CSSProperties;
          const txt = signed(v, d, pct);
          return (
            <td key={c.k}>
              <button type="button" className={`mg-cell${best ? ' best' : ''}`} style={style} onClick={onCell ? () => onCell(k, c.k) : undefined}
                aria-label={`${c.label}, ${rowFull(r)}: ${v == null ? 'אין נתון' : signed(v, d, true)}${best ? ', הגבוה בשורה' : ''}`}>
                <span className="num">{txt}</span>{best ? <Dot /> : null}
              </button>
            </td>
          );
        })}
        {showAvg ? (
          <td className="avg">
            <button type="button" className="mg-cell" style={{ '--a': 0 } as CSSProperties} onClick={onCell ? () => onCell(k, null) : undefined}
              aria-label={`${avgA} ${avgB}, ${rowFull(r)}: ${r.avg == null ? 'אין נתון' : signed(r.avg, d, true)}`}>
              <span className="num">{signed(r.avg, d, pct)}</span>
            </button>
          </td>
        ) : null}
      </tr>
    );
  });

  const foot = footer.map((s) => {
    const ils = s.unit === 'ils', better = s.better === undefined ? (ils ? 'lo' : 'hi') : s.better;
    const lead = mark === 'none' || !better ? [] : s.lead ?? leadOf(s.vals, s.band ?? (ils ? 20 : 0.1), better);
    const fmt = (v: number | null | undefined) => (ils ? shekels(v) : signed(v, 1, true));
    const tone = (v: number | null | undefined) => (ils || v == null || v === 0 ? '' : v > 0 ? ' pos' : ' neg');
    return (
      <tr key={s.key} id={s.id} className={`sum${s.onOpen ? ' open' : ''}${ils ? ' ils' : ''}`} onClick={s.onOpen}>
        <th className="m" scope="row">
          {s.onOpen ? (
            <button type="button" className="mg-sumlbl" onClick={(e) => { e.stopPropagation(); s.onOpen?.(); }}>{s.label}{s.sub ? <small>{s.sub}</small> : null}</button>
          ) : (<>{s.label}{s.sub ? <small>{s.sub}</small> : null}</>)}
        </th>
        {s.vals.map((v, i) => (cols[i] ? (
          <td key={cols[i].k}><span className={`sumc${lead.includes(i) ? ' best' : ''}`}><span className={`num${tone(v)}`}>{fmt(v)}</span></span></td>
        ) : null))}
        {showAvg ? (
          <td className="avg"><span className="sumc mut">{s.avg == null ? <span title={ils ? 'אין ממוצע מפורסם לדמי ניהול מהפקדה' : undefined}>{ils ? '—' : '–'}</span> : <span className="num">{fmt(s.avg)}</span>}</span></td>
        ) : null}
      </tr>
    );
  });

  return (
    <div className={`mgw${L.wide ? ' scroll' : ''}`}>
      <table className={cls} id={id} style={L.width ? { width: L.width } : undefined}>
        <colgroup><col style={{ width: L.mw }} />{Array.from({ length: n }, (_, i) => <col key={i} />)}</colgroup>
        {head}
        <tbody key={rows.map(rowKey).join(',')}>{body}</tbody>
        {foot.length ? <tfoot>{foot}</tfoot> : null}
      </table>
      {more ? <button type="button" className="mg-more" id={more.id} onClick={more.onClick}>{more.label}</button> : null}
    </div>
  );
}

/* ---------------- quarters (p6) ---------------- */
function QuarterGrid(props: MonthGridProps) {
  const { id = 'quarter-grid', cols, footer = [], showAvg = false, onCell, onCol, more, loading = false, focus, renderCell } = props;
  const rows = props.rowsMax ? props.rows.slice(0, props.rowsMax) : props.rows;
  const d = props.decimals ?? 2, heat = props.heat ?? 'none', at = showAvg ? props.avgAt ?? 'auto' : null;
  const mark = props.mark ?? 'none', band = props.tie ?? 0.05;
  const scale = props.scale ?? heatScale(rows.flatMap((r) => r.vals));
  const [avgA, avgB] = props.avgLabel ?? ['חציון', ''];
  const fmt = (v: number | null | undefined, i: number) => (v == null || !Number.isFinite(v) ? '–' : props.format ? props.format(v, i) : heat === 'sign' ? signed(v, d) : plain(v, d));
  const rowKey = (r: MonthGridRow) => r.key ?? String(r.p ?? r.label ?? '');
  const rowLabel = (r: MonthGridRow) => r.label ?? quarterLabel(rowKey(r));
  const cur = props.cur ?? (rows[0] ? rowKey(rows[0]) : '');
  const withCol = at === 'col' || at === 'auto', withRow = at === 'row' || at === 'auto';
  const wide = cols.length + (withCol ? 1 : 0) > 8;
  const cls = ['mg', 'p6-q', heat === 'sign' ? 'p6-heat' : ''].filter(Boolean).join(' ');
  const dataAttrs: Record<string, string> = { 'data-kind': 'quarters' };
  for (const [k, v] of Object.entries(props.data ?? {})) dataAttrs[`data-${k}`] = v;
  const unit = props.unit ?? 'רבעון';
  const nSup = (n: number | null | undefined) => (n == null ? null : <sup className="p6-n">{n}</sup>);
  const medCell = (r: MonthGridRow, label: string) => {
    const k = rowKey(r), txt = fmt(r.avg, -1);
    const aria = `${avgA}, ${label}: ${r.avg == null ? 'אין נתון' : txt}${r.n != null ? `, על ${r.n} חברות` : ''}`;
    if (r.avg == null) return <span className="mg-cell p6-na" title="אין חציון">–</span>;
    return renderCell ? <span className="mg-cell p6-x p6-med">{renderCell(k, null, txt, r.avg)}{nSup(r.n)}</span> : (
      <button type="button" className="mg-cell" onClick={onCell ? () => onCell(k, null) : undefined} aria-label={aria}><span className="num">{txt}</span>{nSup(r.n)}</button>
    );
  };

  const head = (
    <thead>
      <tr>
        <th className="m" scope="col"><span className="mg-unit">{unit}</span></th>
        {cols.map((c) => (
          <th key={c.k} scope="col" data-e={c.k} className={c.k === focus ? 'fc' : undefined} style={{ '--c': c.color } as CSSProperties}>
            <button type="button" className="mg-col" onClick={onCol ? () => onCol(c.k) : undefined} disabled={!onCol} aria-label={onCol ? `${c.label}: פרטי החברה` : undefined}>
              <i className="mg-bar" aria-hidden="true" /><b>{c.label}</b>{c.sub ? <small>{c.sub}</small> : null}
            </button>
          </th>
        ))}
        {withCol ? <th scope="col" className="avg p6-avgc"><span className="mg-col"><b>{avgA}<sup className="p6-n">n</sup></b>{avgB ? <small>{avgB}</small> : null}</span></th> : null}
      </tr>
    </thead>
  );
  const colgroup = <colgroup><col className="p6-lc" /></colgroup>;

  if (loading) {
    const sk = props.rowsMax ?? props.skeletonRows ?? 6;
    return (
      <div className={`mgw p6-qw${wide ? ' scroll' : ''}`} aria-busy="true">
        <table className={cls} id={id} {...dataAttrs}>
          {colgroup}{head}
          <tbody>
            {Array.from({ length: sk }, (_, ri) => (
              <tr key={ri}>
                <th className="m" scope="row"><span className="mg-skel" style={{ width: '70%' }} /></th>
                {cols.map((c) => <td key={c.k}><span className="mg-cell mg-skelcell" /></td>)}
                {withCol ? <td className="avg p6-avgc"><span className="mg-cell mg-skelcell" /></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const body = rows.map((r, ri) => {
    const k = rowKey(r), label = rowLabel(r);
    const lead = mark === 'none' ? [] : r.lead ?? leadOf(r.vals, band, 'hi');
    return (
      <tr key={k} data-q={k} className={k === cur ? 'cur' : undefined} style={{ '--i': Math.min(ri, 12) } as CSSProperties}>
        <th className="m" scope="row">{label}{r.sub ? <small>{r.sub}</small> : null}</th>
        {r.vals.map((v, i) => {
          const c = cols[i]; if (!c) return null;
          const fc = c.k === focus ? 'fc' : '';
          if (v == null || !Number.isFinite(v)) {
            const why = r.why?.[i] ?? 'אין נתון';
            return <td key={c.k} data-e={c.k} data-q={k} className={['p6-na', fc].filter(Boolean).join(' ')} title={why}><span className="mg-cell" aria-label={`${c.label}, ${label}: ${why}`}>–</span></td>;
          }
          const h = heat === 'sign' ? heatFill(v, scale) : { hue: null, alpha: 0 };
          const style = { '--k': h.hue ? `var(--heat-${h.hue})` : '0 0 0', '--a': h.alpha } as CSSProperties;
          const star = !!r.star?.[i], dag = !!r.dagger?.[i], best = lead.includes(i);
          const txt = cellText(fmt(v, i), star, dag);
          const tdc = [star ? 'car' : '', dag ? 'p6-dag' : '', fc].filter(Boolean).join(' ') || undefined;
          const aria = `${c.label}, ${label}: ${txt}${star ? ', טרם דיווחה: הנתון האחרון שלה' : ''}${dag ? ', על בסיס אחר' : ''}`;
          return (
            <td key={c.k} data-e={c.k} data-q={k} className={tdc}>
              {renderCell ? <span className={`mg-cell p6-x${best ? ' best' : ''}`} style={style}>{renderCell(k, c.k, txt, v)}</span> : (
                <button type="button" className={`mg-cell${best ? ' best' : ''}`} style={style} onClick={onCell ? () => onCell(k, c.k) : undefined} aria-label={aria}>
                  <span className="num">{txt}</span>{best ? <Dot /> : null}
                </button>
              )}
            </td>
          );
        })}
        {withCol ? <td className="avg p6-avgc" data-q={k} data-n={r.n ?? undefined}>{medCell(r, label)}</td> : null}
      </tr>
    );
  });

  const foot = footer.map((s) => (
    <tr key={s.key} id={s.id} className="sum">
      <th className="m" scope="row">{s.label}{s.sub ? <small>{s.sub}</small> : null}</th>
      {s.vals.map((v, i) => (cols[i] ? <td key={cols[i].k}><span className="sumc"><span className="num">{fmt(v, i)}</span></span></td> : null))}
      {withCol ? <td className="avg p6-avgc"><span className="sumc mut"><span className="num">{fmt(s.avg, -1)}</span></span></td> : null}
    </tr>
  ));

  const medRows = withRow && rows.length ? (
    <div className="p6-medrow" id={`${id}-med`}>
      {chunk(rows).map((part, pi) => (
        <table key={pi} className="p6-mr">
          <thead><tr><th scope="col" className="m" aria-label="רבעון" />{part.map((r) => <th key={rowKey(r)} scope="col" className={rowKey(r) === cur ? 'cur' : undefined}>{rowLabel(r)}</th>)}{Array.from({ length: 6 - part.length }, (_, i) => <th key={`e${i}`} aria-hidden="true" />)}</tr></thead>
          <tbody><tr><th scope="row" className="m">{avgA}<sup className="p6-n">n</sup></th>{part.map((r) => <td key={rowKey(r)} data-q={rowKey(r)} data-n={r.n ?? undefined}>{medCell(r, rowLabel(r))}</td>)}{Array.from({ length: 6 - part.length }, (_, i) => <td key={`e${i}`} aria-hidden="true" />)}</tr></tbody>
        </table>
      ))}
    </div>
  ) : null;

  return (
    <div className={`mgw p6-qw${wide ? ' scroll' : ''}${at ? ` p6-at-${at}` : ''}`}>
      <table className={cls} id={id} {...dataAttrs}>
        {colgroup}{head}
        <tbody key={rows.map(rowKey).join(',')}>{body}</tbody>
        {foot.length ? <tfoot>{foot}</tfoot> : null}
      </table>
      {medRows}
      {more ? <button type="button" className="mg-more" id={more.id} onClick={more.onClick}>{more.label}</button> : null}
    </div>
  );
}

/** The 6 / 12 quarters option (address key `gq` on the board): a two-button seg, 44-px hit area, aria-pressed. */
export function RowsSeg({ value, onChange, options = [6, 12], id = 'gq-seg', label = 'מספר רבעונים' }: { value: number; onChange: (n: number) => void; options?: number[]; id?: string; label?: string }) {
  return (
    <div className="p6-seg" id={id} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => o !== value && onChange(o)}>{o}</button>
      ))}
    </div>
  );
}
