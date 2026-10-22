import { isValidElement, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Sourced } from './Source';
import { cls, fmt, xlsxFmt, type Unit } from '../lib/format';
import type { Prov } from '../lib/prov';
import type { XCell } from '../lib/xlsx';
import '../styles/datatable.css';

/* One table for the site (lane 2H, ws6 W6-14). A column spec in, a table out: sortable headers (aria-sort), a sticky header and
   first column (the global .scroll rules), numbers right-aligned and isolated LTR (.num) through the one formatter, figures that
   open their source (Sourced), the restated dot and the derived italic, a totals row (sum / median / mean / custom), and a CSV or
   Excel export of exactly the rows on screen. Density follows <html data-density>; the arrow keys between figures come from
   components/Keyboard (every Sourced cell is a `td .src`). */

export type Val = number | string | null | undefined;
export interface Column<R> {
  key: string;
  /** header content */
  head: ReactNode;
  /** header tooltip */
  title?: string;
  /** plain header text for the export (default: the text of `head`) */
  label?: string;
  /** the cell's value: sorts the column, feeds the totals and the export, and is what the default cell shows */
  value?: (r: R) => Val;
  /** default cell: the value through fmt(value, unit, { d, signed }) */
  unit?: Unit;
  d?: number;
  signed?: boolean;
  /** colour the default cell by sign (pos / neg); 'neg' marks only negatives */
  tone?: boolean | 'neg';
  /** the default cell opens this source */
  src?: (r: R) => Prov | null | undefined;
  /** …and is a real link to the document (Cmd/Ctrl-click) */
  href?: (r: R) => string | null | undefined;
  /** restated since first published: the accent dot */
  restated?: (r: R) => boolean;
  /** derived (calc), not printed: italic */
  derived?: (r: R) => boolean;
  /** a custom cell (overrides the default) */
  cell?: (r: R, i: number) => ReactNode;
  /** classes on the th and every td of the column (e.g. "wide-only") */
  className?: string;
  /** a class per cell */
  tdClass?: (r: R) => string | undefined;
  tdProps?: (r: R) => HTMLAttributes<HTMLTableCellElement>;
  /** default: sortable when the column has a value */
  sortable?: boolean;
  /** the first click sorts descending for numbers, ascending for text; override here */
  firstDir?: 'asc' | 'desc';
  /** a cell of the totals row */
  total?: 'sum' | 'median' | 'mean' | ((rows: R[]) => number | ReactNode | null);
  /** leave the column out of the export */
  noExport?: boolean;
  /** export text when the column has no numeric value (default: the text of the cell) */
  text?: (r: R) => string;
  width?: number | string;
}

export interface DataTableProps<R> {
  rows: R[];
  columns: Column<R>[];
  rowKey: (r: R, i: number) => string;
  /** initial sort; none keeps the given order */
  sort?: { key: string; dir: 'asc' | 'desc' } | null;
  className?: string;
  /** accessible name of the table */
  caption?: string;
  rowClass?: (r: R) => string | undefined;
  rowProps?: (r: R) => HTMLAttributes<HTMLTableRowElement>;
  /** rows rendered right after a row (an expanded breakdown); they travel with it when the table is sorted */
  after?: (r: R) => ReactNode;
  /** rows above the sorted body (an average, a benchmark) */
  before?: ReactNode;
  /** label of the totals row; the row appears when a column has `total` */
  totalLabel?: ReactNode;
  /** more rows in the footer */
  foot?: ReactNode;
  maxHeight?: number | string;
  dense?: boolean;
  /** export buttons under the table; `name` is the file name, `title` and `note` stamp the sheet */
  export?: { name: string; title: string; note?: string } | null;
  /** shown instead of an empty body */
  empty?: ReactNode;
  /** no scroll wrapper (the caller provides one) */
  bare?: boolean;
}

/** The plain text of a node tree. */
export function textOf(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (isValidElement(n)) return textOf((n.props as { children?: ReactNode }).children);
  return '';
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const nums = <R,>(rows: R[], c: Column<R>) => rows.map((r) => c.value?.(r)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/** The figure of a default cell. */
function Figure<R>({ c, r, v }: { c: Column<R>; r: R; v: Val }) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return <span className="num muted">–</span>;
  if (typeof v === 'string') return <>{v}</>;
  const k = ['num', c.tone === 'neg' ? (v < 0 ? 'neg' : '') : c.tone ? cls(v) : '', c.restated?.(r) ? 're' : '', c.derived?.(r) ? 'der' : ''].filter(Boolean).join(' ');
  const t = fmt(v, c.unit ?? 'n', { d: c.d, signed: c.signed });
  const src = c.src;
  return src ? <Sourced className={k} src={() => src(r) ?? { k: 'none', title: textOf(c.head), why: 'אין מקור' }} href={c.href?.(r) ?? null}>{t}</Sourced> : <span className={k}>{t}</span>;
}

export function DataTable<R>(p: DataTableProps<R>) {
  const { rows, columns: cols } = p;
  const [sort, setSort] = useState(p.sort ?? null);
  const sorted = useMemo(() => {
    const c = sort && cols.find((x) => x.key === sort.key);
    if (!c?.value) return rows;
    const dir = sort!.dir === 'asc' ? 1 : -1, get = c.value;
    return rows.map((r, i) => ({ r, i, v: get(r) })).sort((a, b) => {
      const na = a.v == null || a.v === '' || (typeof a.v === 'number' && !Number.isFinite(a.v)), nb = b.v == null || b.v === '' || (typeof b.v === 'number' && !Number.isFinite(b.v));
      if (na || nb) return na === nb ? a.i - b.i : na ? 1 : -1;  // empty cells last, whichever the direction
      const d = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'he');
      return d ? d * dir : a.i - b.i;
    }).map((x) => x.r);
  }, [rows, cols, sort]);

  const click = (c: Column<R>) => {
    const first = c.firstDir ?? (rows.some((r) => typeof c.value!(r) === 'number') ? 'desc' : 'asc');
    if (sort?.key !== c.key) setSort({ key: c.key, dir: first });
    else if (sort.dir === first) setSort({ key: c.key, dir: first === 'asc' ? 'desc' : 'asc' });
    else setSort(p.sort ?? null);  // the third click returns to the table's own order
  };

  const hasTotal = cols.some((c) => c.total);
  const totalOf = (c: Column<R>): ReactNode => {
    if (!c.total) return null;
    if (typeof c.total === 'function') { const t = c.total(rows); return typeof t === 'number' ? <span className="num">{fmt(t, c.unit ?? 'n', { d: c.d, signed: c.signed })}</span> : t; }
    const xs = nums(rows, c);
    const v = c.total === 'sum' ? (xs.length ? xs.reduce((s, x) => s + x, 0) : null) : c.total === 'median' ? median(xs) : xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
    return <span className="num">{fmt(v, c.unit ?? 'n', { d: c.d, signed: c.signed })}</span>;
  };

  const table = (
    <table className={['dt', p.className, p.dense ? 'dense' : ''].filter(Boolean).join(' ')} aria-label={p.caption}>
      <thead><tr>{cols.map((c) => {
        const can = c.sortable ?? !!c.value, on = sort?.key === c.key;
        return (
          <th key={c.key} className={c.className} title={c.title} style={c.width != null ? { width: c.width } : undefined} scope="col"
            aria-sort={can ? (on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
            {can ? <button type="button" className={`dt-sort${on ? ' on' : ''}`} onClick={() => click(c)}><span className="dt-h">{c.head}</span><span className="dt-arr" aria-hidden="true">{on ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button> : c.head}
          </th>
        );
      })}</tr></thead>
      <tbody>
        {p.before}
        {sorted.length === 0 && p.empty != null && <tr className="dt-empty"><td colSpan={cols.length}>{p.empty}</td></tr>}
        {sorted.map((r, i) => {
          const rp = p.rowProps?.(r) ?? {};
          const k = p.rowKey(r, i);
          const tr = (
            <tr key={k} {...rp} className={[rp.className, p.rowClass?.(r)].filter(Boolean).join(' ') || undefined}>
              {cols.map((c) => <td key={c.key} className={[c.className, c.tdClass?.(r)].filter(Boolean).join(' ') || undefined} {...c.tdProps?.(r)}>{c.cell ? c.cell(r, i) : <Figure c={c} r={r} v={c.value?.(r)} />}</td>)}
            </tr>
          );
          const extra = p.after?.(r);
          return extra ? [tr, <Rows key={`${k}~`}>{extra}</Rows>] : tr;
        })}
      </tbody>
      {(hasTotal || p.foot) && (
        <tfoot>
          {hasTotal && <tr className="tot">{cols.map((c, j) => <td key={c.key} className={c.className}>{j === 0 && !c.total ? (p.totalLabel ?? 'סה"כ') : totalOf(c)}</td>)}</tr>}
          {p.foot}
        </tfoot>
      )}
    </table>
  );

  return (
    <>
      {p.bare ? table : <div className="scroll dt-wrap" style={p.maxHeight != null ? { maxHeight: p.maxHeight } : undefined}>{table}</div>}
      {p.export && <div className="dt-export"><span className="muted">ייצוא</span><button type="button" className="chip" onClick={() => exportCsv(p.export!, cols, sorted)}>CSV</button><button type="button" className="chip" onClick={() => void exportXlsx(p.export!, cols, sorted)}>Excel</button></div>}
    </>
  );
}
const Rows = ({ children }: { children: ReactNode }) => <>{children}</>;

/* ---- export: exactly the rows and columns on screen, in their order, numbers as numbers ---- */
const head = <R,>(c: Column<R>) => c.label ?? textOf(c.head).trim();
const raw = <R,>(c: Column<R>, r: R, i: number): Val => {
  const v = c.value?.(r);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (c.text) return c.text(r);
  if (v != null) return String(v);
  return c.cell ? textOf(c.cell(r, i)).trim() || null : null;
};

function exportCsv<R>(e: NonNullable<DataTableProps<R>['export']>, cols: Column<R>[], rows: R[]) {
  const use = cols.filter((c) => !c.noExport);
  const q = (s: Val) => (s == null ? '' : typeof s === 'number' ? String(+s.toFixed(6)) : `"${s.replace(/"/g, '""')}"`);
  const lines = [use.map((c) => q(head(c))).join(','), ...rows.map((r, i) => use.map((c) => q(raw(c, r, i))).join(',')), '', q(`fox · ${e.title} · ${location.href}${e.note ? ` · ${e.note}` : ''}`)];
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })), download: `${e.name}.csv` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function exportXlsx<R>(e: NonNullable<DataTableProps<R>['export']>, cols: Column<R>[], rows: R[]) {
  const { downloadXlsx } = await import('../lib/xlsx');
  const use = cols.filter((c) => !c.noExport);
  const body: XCell[][] = [
    [{ v: `fox · ${e.title}`, bold: true }], [location.href], [e.note ?? ''], [],
    use.map((c) => ({ v: head(c), bold: true })),
    ...rows.map((r, i) => use.map((c): XCell => { const v = raw(c, r, i); const link = c.href?.(r) ?? undefined; return typeof v === 'number' ? { v: +v.toFixed(6), fmt: xlsxFmt(c.unit, c.d), link } : link && v ? { v, link } : v; })),
  ];
  downloadXlsx(e.name, [{ name: e.title.slice(0, 31), rows: body, freeze: { rows: 5, cols: 1 }, widths: use.map((_, j) => (j ? 14 : 24)) }]);
}
