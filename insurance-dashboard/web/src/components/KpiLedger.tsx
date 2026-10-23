import { useState, type ReactNode } from 'react';
import { MetricCard, type CardSeries } from './MetricCard';
import { Sourced } from './Source';
import { Sheet } from './Sheet';
import { useMedia } from '../lib/useMedia';
import { NoteField, NoteMark } from './NoteMark';  // lane F
import { nf, pct } from '../lib/format';
import type { Prov } from '../lib/prov';

/** One point of a ledger row: the figure, its period, and where it comes from. */
export interface LedgerPoint { end: string; label: string; v: number | null; src?: () => Prov; href?: string | null; der?: boolean;
  /** the figure's note key where it is a statement row (the grid's key, lib/notes lineKey); the row's key otherwise */
  nk?: string }
/** One headline metric over time. `step` is points per year (4 quarterly, 12 monthly): the previous quarter is step/4 back, the same period a year earlier `step` back. */
export interface LedgerRow {
  key: string; title: string; tag?: string; unit: string; dec: number;
  /** a shorter name for the phone's tiles */
  short?: string;
  /** a percentage or a multiple: its change is a difference, never a percent of a percent */
  ratio?: boolean;
  pts: LedgerPoint[]; step: number;
  /** the sparkline and chart take every n-th point (a year-to-date series is read against the same period of earlier years, not as a saw) */
  stride?: number;
  /** short name of the source, for the source column */
  source: string;
  color?: number; kind?: 'bar' | 'area' | 'stack';
  /** the chart draws these (a split by product) instead of the row's own figures */
  stack?: CardSeries[];
  to?: string;
  /** figures of another (listed) company than the one shown */
  filer?: boolean;
}
export interface LedgerGroup { key: string; title: string; note?: ReactNode; rows: LedgerRow[] }

/** Where a row stands at the report on screen: the latest point at or before `asOf` (null: the latest the row has). */
export function at(row: LedgerRow, asOf: string | null): number {
  if (asOf == null) { for (let i = row.pts.length - 1; i >= 0; i--) if (row.pts[i].v != null) return i; return -1; }
  let c = -1;
  row.pts.forEach((p, i) => { if (p.end <= asOf) c = i; });
  return c;
}
const fmt = (row: LedgerRow, v: number | null | undefined) => (v == null ? '–' : `${nf(v, row.dec)}${row.unit === '%' ? '%' : ''}`);

export interface Change { text: string; tone?: 'pos' | 'neg'; src: () => Prov }
/** The change between two points: a percent only between two positive figures, otherwise the difference (points for a ratio). Opens its formula. */
export function change(row: LedgerRow, a: LedgerPoint | undefined, b: LedgerPoint | undefined): Change | null {
  if (!a || !b || a.v == null || b.v == null) return null;
  let text: string, formula: string, unit: string, x: number;
  if (row.ratio) { x = a.v - b.v; text = `${x > 0 ? '+' : ''}${nf(x, row.dec)}${row.unit === '%' ? ' נק׳' : ''}`; formula = `${a.label} − ${b.label}`; unit = row.unit === '%' ? 'נק׳' : row.unit; }
  else if (a.v > 0 && b.v > 0) { x = (a.v / b.v - 1) * 100; text = x > 300 ? `×${nf(a.v / b.v, 1)}` : pct(Number(x.toFixed(1)) || 0, 1, true); formula = `${a.label} ÷ ${b.label} − 1`; unit = '%'; }
  else { x = a.v - b.v; text = `${x > 0 ? '+' : ''}${nf(x, row.dec)}`; formula = `${a.label} − ${b.label}`; unit = row.unit; }
  const r = Number(x.toFixed(1)) || 0;
  return {
    text, tone: r > 0 ? 'pos' : r < 0 ? 'neg' : undefined,
    src: () => ({ k: 'calc', title: `${row.title} · ${a.label} מול ${b.label}`, value: text, unit, formula,
      inputs: [a, b].map((p) => ({ label: p.label, v: fmt(row, p.v), src: p.src ?? (() => ({ k: 'none', title: row.title, why: 'אין מקור לנתון' }) as Prov) })) }),
  };
}

/** Indices of the last `n` points of a row up to `c`, oldest first, every `stride`-th. */
function idxBack(row: LedgerRow, c: number, n: number): number[] {
  const s = row.stride ?? 1, out: number[] = [];
  for (let i = c; i >= 0 && out.length < n; i -= s) out.unshift(i);
  return out;
}
/** A row read at one report: the figure, the previous quarter, the same period a year earlier, the change, the last twelve points. */
export function readRow(row: LedgerRow, asOf: string | null) {
  const c = at(row, asOf), cur = row.pts[c], q = row.step >= 4 ? row.pts[c - row.step / 4] : undefined, y = row.pts[c - row.step];
  return { c, cur, q, y, yoy: change(row, cur, y), spark: c < 0 ? [] : idxBack(row, c, 12).map((i) => row.pts[i].v) };
}

/** The last twelve points of a series as a small line, the latest marked. */
export function Spark({ data, w = 96, h = 24 }: { data: (number | null)[]; w?: number; h?: number }) {
  const pts = data.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <span className="muted">–</span>;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v)), span = hi - lo || 1, i0 = pts[0].i, ix = pts[pts.length - 1].i - i0 || 1;
  const xy = pts.map((p) => [2 + ((p.i - i0) / ix) * (w - 4), h - 3 - ((p.v - lo) / span) * (h - 6)] as const);
  const zero = lo < 0 && hi > 0 ? h - 3 - ((0 - lo) / span) * (h - 6) : null;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {zero != null && <line x1="0" x2={w} y1={zero} y2={zero} className="zero" />}
      <polyline points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="2.6" />
    </svg>
  );
}

/** The row as the chart card: up to twenty points ending at the report on screen. */
function RowChart({ row, asOf, height }: { row: LedgerRow; asOf: string | null; height: number }) {
  const r = readRow(row, asOf), ix = r.c < 0 ? [] : idxBack(row, r.c, 20), upto = ix.map((i) => row.pts[i]);
  return (
    <>
    <MetricCard title={row.title} tag={row.tag} unit={row.unit === '%' ? '%' : row.unit} value={fmt(row, r.cur?.v)} dec={row.dec} color={row.color ?? 0} kind={row.kind ?? (row.ratio ? 'area' : 'bar')}
      delta={r.yoy ? { text: `${r.yoy.text} YoY`, tone: r.yoy.tone } : undefined} src={r.cur?.src} href={r.cur?.href} to={row.to} height={height}
      x={upto.map((p) => p.label)} series={row.stack ? row.stack.map((s) => ({ ...s, data: ix.map((i) => s.data[i]) })) : [{ name: row.title, data: upto.map((p) => p.v) }]}
      foot={<>{row.source}{r.cur ? <> · <span className="num">{r.cur.label}</span></> : null}</>} />
    {r.cur && <NoteField p={r.cur.label} m={r.cur.nk ?? row.key} label={row.title} />}
    </>
  );
}

function Val({ row, p }: { row: LedgerRow; p: LedgerPoint | undefined }) {
  if (!p || p.v == null) return <span className="muted">–</span>;
  const t = fmt(row, p.v);
  return <span className={`num${p.der ? ' der' : ''}`}>{p.src ? <Sourced src={p.src} href={p.href}>{t}</Sourced> : t}</span>;
}

/** Every headline metric of a company on one screen: metric · the report · the quarter before · a year earlier · YoY · twelve periods · source,
 *  grouped, each group with its own period heads (statements by quarter, the regulator by month). The report and the window come from the address.
 *  A selected row draws its chart in a sticky pane beside the table on a wide screen, in a full-screen sheet on a narrow one. Every figure opens its source. */
export function KpiLedger({ groups, asOf, sel, onSel }: { groups: LedgerGroup[]; asOf: string | null; sel: string; onSel: (key: string) => void }) {
  const narrow = useMedia('(max-width: 1100px)');
  const [sheet, setSheet] = useState<string | null>(null);
  const live = groups.map((g) => ({ ...g, rows: g.rows.filter((r) => readRow(r, asOf).cur?.v != null) })).filter((g) => g.rows.length);
  if (!live.length) return null;
  const all = live.flatMap((g) => g.rows), cur = narrow ? null : all.find((r) => r.key === sel) ?? null, open = all.find((r) => r.key === sheet) ?? null;
  const pick = (r: LedgerRow) => { if (narrow) setSheet(r.key); else onSel(sel === r.key ? '' : r.key); };
  return (
    <div className={`ledger-wrap${cur ? ' has-pane' : ''}`}>
      <div className="panel ledger">
        <table>
          {live.map((g) => {
            const lead = g.rows.map((r) => readRow(r, asOf)).find((x) => x.cur) ?? null;
            return (
              <tbody key={g.key}>
                <tr className="sec"><td colSpan={7}>{g.title}{g.note && <span className="dim">{g.note}</span>}</td></tr>
                <tr className="lhd">
                  <th scope="col">מדד</th><th scope="col"><span className="num">{lead?.cur?.label}</span></th><th scope="col" className="wide-only"><span className="num">{lead?.q?.label ?? ''}</span></th>
                  <th scope="col" className="wide-only"><span className="num">{lead?.y?.label ?? ''}</span></th><th scope="col">YoY</th><th scope="col" className="spk">12 תקופות</th><th scope="col" className="lsrc">מקור</th>
                </tr>
                {g.rows.map((row) => {
                  const r = readRow(row, asOf), on = cur?.key === row.key;
                  return (
                    <tr key={row.key} className={on ? 'on' : ''} onClick={(e) => { if (!(e.target as HTMLElement).closest('.src')) pick(row); }} tabIndex={-1}>
                      <td className="lbl"><span className="lblin"><button type="button" className="rowbtn" onClick={(e) => { e.stopPropagation(); pick(row); }} aria-pressed={on} aria-label={`${row.title}: גרף`}>{row.title}</button>{row.tag && <span className="chip est">{row.tag}</span>}{r.cur && <NoteMark p={r.cur.label} m={r.cur.nk ?? row.key} was={r.cur.nk ? [row.key, row.key.replace(/^st:/, 'rd:')] : undefined} label={row.title} add />}</span></td>
                      <td className="v"><Val row={row} p={r.cur} />{r.cur && r.cur.end !== lead?.cur?.end && <span className="dim num">{r.cur.label}</span>}</td>
                      <td className="wide-only"><Val row={row} p={r.q} /></td>
                      <td className="wide-only"><Val row={row} p={r.y} /></td>
                      <td>{r.yoy ? <Sourced src={r.yoy.src}><span className={`num ${r.yoy.tone ?? ''}`}>{r.yoy.text}</span></Sourced> : <span className="muted">–</span>}</td>
                      <td className="spk"><Spark data={r.spark} w={narrow ? 56 : 96} h={narrow ? 20 : 24} /></td>
                      <td className="lsrc muted">{row.source}<span className="u">{row.unit}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      {cur && (
        <aside className="ledger-chart" aria-label={`גרף: ${cur.title}`}>
          <button type="button" className="btn ledger-x" onClick={() => onSel('')} aria-label="סגירת הגרף">×</button>
          <RowChart key={cur.key} row={cur} asOf={asOf} height={300} />
        </aside>
      )}
      {narrow && open && <Sheet open onClose={() => setSheet(null)} title={open.title}><div className="sheet-full"><RowChart row={open} asOf={asOf} height={300} /></div></Sheet>}
    </div>
  );
}

/** The phone's company card: a few headline metrics as tiles (figure, period, YoY, twelve periods). The figure opens its source; the tile opens its chart full-screen. */
export function KpiTiles({ rows, asOf }: { rows: LedgerRow[]; asOf: string | null }) {
  const [sheet, setSheet] = useState<string | null>(null);
  const open = rows.find((r) => r.key === sheet) ?? null;
  if (!rows.length) return null;
  return (
    <>
      <div className="ktiles">
        {rows.map((row) => {
          const r = readRow(row, asOf);
          return (
            <div className="ktile" key={row.key} onClick={(e) => { if (!(e.target as HTMLElement).closest('.src')) setSheet(row.key); }}>
              <button type="button" className="kt-hd" onClick={(e) => { e.stopPropagation(); setSheet(row.key); }} aria-label={`${row.title}: גרף`}>
                <span className="kt-t">{row.short ?? row.title}</span><span className="kt-p num">{r.cur?.label}</span>
              </button>
              <div className="kt-v"><Val row={row} p={r.cur} /><span className="kt-u">{row.unit === '%' ? '' : row.unit}</span>{r.cur && <NoteMark p={r.cur.label} m={r.cur.nk ?? row.key} was={r.cur.nk ? [row.key, row.key.replace(/^st:/, 'rd:')] : undefined} label={row.title} />}</div>
              <div className="kt-f">
                {r.yoy ? <Sourced src={r.yoy.src}><span className={`num ${r.yoy.tone ?? ''}`}>{r.yoy.text}</span></Sourced> : <span className="muted">–</span>}
                <span className="kt-yl">YoY</span>
                <Spark data={r.spark} w={64} h={22} />
              </div>
            </div>
          );
        })}
      </div>
      {open && <Sheet open onClose={() => setSheet(null)} title={open.title}><div className="sheet-full"><RowChart row={open} asOf={asOf} height={300} /></div></Sheet>}
    </>
  );
}
