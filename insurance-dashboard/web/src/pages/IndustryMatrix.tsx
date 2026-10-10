import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { useStored } from '../lib/local';
import { shiftYear } from '../lib/company';
import { nf, sn, byPeriodDesc } from '../lib/format';
import { useIfrsData, useIfrsFacts, useRegistry } from '../lib/useData';
import type { IfrsFact } from '../lib/types';
import { BASIS, endOf } from './IndustryIfrs';
import { periodName } from './CompanyIfrs';

type Col = { k: string; l: string; m?: string; inst?: boolean; pctv?: boolean; calc?: [string, string, 'ratio' | 'pct'] };
// the catalogue the column picker offers; figures first, then what is derived from them
const COLS: Col[] = [
  { k: 'np', l: 'רווח נקי', m: 'profit_attributable' },
  { k: 'ci', l: 'רווח כולל לפני מס', m: 'comprehensive_income_before_tax' },
  { k: 'cia', l: 'רווח כולל לבעלי המניות', m: 'comprehensive_income_attributable' },
  { k: 'rev', l: 'הכנסות משירותי ביטוח', m: 'insurance_revenue' },
  { k: 'isr', l: 'תוצאות שירותי ביטוח', m: 'insurance_service_result' },
  { k: 'isrm', l: 'תוצאות שירותי ביטוח / הכנסות', calc: ['isr', 'rev', 'pct'] },
  { k: 'inv', l: 'תוצאות השקעה ומימון, נטו', m: 'net_investment_and_finance_result' },
  { k: 'fee', l: 'דמי ניהול', m: 'management_fees' },
  { k: 'eq', l: 'הון לבעלי המניות', m: 'equity_attributable', inst: true },
  { k: 'ta', l: 'סך נכסים', m: 'total_assets', inst: true },
  { k: 'aum', l: 'נכסים מנוהלים', m: 'aum_total', inst: true },
  { k: 'roe', l: 'תשואה להון, כפי שדווחה', m: 'roe_reported', pctv: true },
  { k: 'csm', l: 'יתרת CSM', m: 'csm_closing', inst: true },
  { k: 'nb', l: 'CSM עסק חדש', m: 'csm_new_business' },
  { k: 'rel', l: 'שחרור CSM', m: 'csm_release' },
  { k: 'nbr', l: 'עסק חדש / שחרור', calc: ['nb', 'rel', 'pct'] },
  { k: 'cse', l: 'CSM / הון', calc: ['csm', 'eq', 'ratio'] },
  { k: 'div', l: 'דיבידנד ששולם', m: 'dividend_paid' },
  { k: 'divd', l: 'דיבידנד שהוכרז', m: 'dividend_declared' },
];
const DEFAULT = ['np', 'ci', 'rev', 'isr', 'isrm', 'eq', 'roe', 'csm', 'nb', 'rel', 'nbr', 'cse'];
type Cell = { v: number; f?: IfrsFact; alt?: boolean; calc?: boolean; n?: number; sum?: boolean; mixed?: boolean } | null;
// remarks on a figure, as numbered notes under the table instead of a chip in every cell
const NOTES = ['בסיס שונה מרוב החברות בעמודה (מפורט בריחוף)', 'חיים ובריאות יחד: החברה לא מדפיסה שורת קבוצה', 'נקרא מגרף בדוח או במצגת', 'נגזר: חיים ועוד בריאות, על אותו בסיס', 'כולל רווח עתידי בפוליסות חיסכון, שאינו CSM לפי התקן', 'ללא פוליסות חיסכון: הסכום שהודפס פחות עמודת פוליסות החיסכון באותה טבלה', 'נגזר מהנתונים שבטבלה'];
const SUP = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷'];
const B_ORDER = ['net', 'na', 'gross', 'reinsurance'];

/** Peer matrix: one row per insurer, reported group figures side by side, with derived ratios marked and a CSV export. */
export function IndustryMatrix() {
  const { data: d, error } = useIfrsData();
  const reg = useRegistry();
  const periods = useMemo(() => [...new Set((d?.files ?? []).map((f) => f.period))].sort(byPeriodDesc), [d]);
  const [period, setPeriod] = useState('');
  const [win, setWin] = useState<'q' | 'ytd'>('q');
  const [view, setView] = useState<'v' | 'y'>('v');
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const [pick, setPick] = useState(false);
  const [picked, setPicked] = useStored<string[]>('matrix.cols', DEFAULT);
  const P = periods.includes(period) ? period : periods[0] ?? '';
  const facts = useIfrsFacts(P || null);
  const annual = P.endsWith('FY'), end = P ? endOf(P) : '', W = annual ? 'fy' : win;

  const build = (end: string) => {
    const F = (facts.data ?? []).filter((f) => !f.tr && !f.model && !f.bk);
    return [...new Set(F.map((f) => f.c))].map((id) => {
      const pickOne = (c: Col): { f: IfrsFact; alt: boolean } | null => {
        const mine = F.filter((f) => f.c === id && f.m === c.m && f.d === end && (c.inst ? f.w === 'instant' : f.w === W || (c.pctv && f.w !== 'instant')));
        const sort = (xs: IfrsFact[]) => xs.sort((a, b) => B_ORDER.indexOf(a.b) - B_ORDER.indexOf(b.b) || Number(b.s === b.g) - Number(a.s === a.g) || Number(b.dv != null) - Number(a.dv != null));
        const g = sort(mine.filter((f) => f.g === 'group'));
        if (g.length) return { f: g[0], alt: false };
        // a filer that reports life and health together has no separate group line for CSM
        const lh = c.m?.startsWith('csm') ? sort(mine.filter((f) => f.g === 'life_health')) : [];
        return lh.length ? { f: lh[0], alt: true } : null;
      };
      const cells: Record<string, Cell> = {};
      COLS.filter((c) => c.m).forEach((c) => {
        const p = pickOne(c);
        if (!p) {
          // no group or combined line: life and health are added when both are printed on one basis, and the cell is marked as derived
          const part = (g: string) => F.filter((f) => f.c === id && f.m === c.m && f.g === g && f.s === g && f.d === end && (c.inst ? f.w === 'instant' : f.w === W)).sort((a, b) => B_ORDER.indexOf(a.b) - B_ORDER.indexOf(b.b));
          const l = part('life'), h = c.m?.startsWith('csm') ? part('health').find((x) => l[0] && x.b === l[0].b) : undefined;
          cells[c.k] = l[0] && h ? { v: c.k === 'rel' ? Math.abs(l[0].v) + Math.abs(h.v) : l[0].v + h.v, f: l[0], sum: true } : null;
          return;
        }
        // one movement printed as several rows of the same tied-out table adds up
        const parts = !c.inst && p.f.dv != null ? F.filter((x) => x.c === id && x.m === p.f.m && x.s === p.f.s && x.b === p.f.b && x.w === p.f.w && x.d === p.f.d && x.dv != null && x.l !== p.f.l) : [];
        const v = (p.f.dv ?? p.f.v) + parts.reduce((t, x) => t + x.dv!, 0);
        cells[c.k] = { v: c.k === 'rel' ? Math.abs(v) : v, f: p.f, alt: p.alt, n: parts.length + 1 };
      });
      COLS.filter((c) => c.calc).forEach((c) => {
        const [a, b, how] = c.calc!, x = cells[a], y = cells[b];
        // a ratio is shown only when both sides exist and, for CSM flows, share a basis
        const ok = x && y && y.v !== 0 && (how === 'ratio' || x.f!.b === y.f!.b || !x.f!.m.startsWith('csm'));
        cells[c.k] = ok ? { v: how === 'pct' ? (x!.v / y!.v) * 100 : x!.v / y!.v, calc: true, mixed: !!(x!.f?.inc || y!.f?.inc) } : null;  // a ratio inherits the caveat of the figures it is built from
      });
      return { id, cells };
    });
  };
  const rows = useMemo(() => build(end), [facts.data, end, W]);  // eslint-disable-line react-hooks/exhaustive-deps
  // the same report prints the year-earlier column: YoY is taken from it, restated comparatives included
  const before = useMemo(() => new Map(build(shiftYear(end, -1)).map((r) => [r.id, r.cells])), [facts.data, end, W]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorBox what="מטריצת עמיתים" error={error} />;
  if (!d || !reg.data || (P && !facts.data && !facts.error)) return <Loading what="מטריצת עמיתים" />;
  if (!P) return <Empty title="אין דוחות מחולצים" />;
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  const url = (f: IfrsFact) => (f.u !== undefined ? f.u : d.files.find((x) => x.company === f.c && x.period === P)?.url);
  const show = (c: Col, v: number) => (c.calc?.[2] === 'ratio' ? nf(v, 2) + '×' : c.calc || c.pctv ? nf(v, 1) + '%' : nf(v, Math.abs(v) < 100 ? 1 : 0));
  const cols = COLS.filter((c) => picked.includes(c.k));
  // what a cell shows: the figure, or its change on the year-earlier column (percent for amounts, points for rates and ratios)
  const shown = (r: { id: string; cells: Record<string, Cell> }, c: Col): number | null => {
    const x = r.cells[c.k];
    if (!x) return null;
    if (view === 'v') return x.v;
    const y = before.get(r.id)?.[c.k];
    if (!y) return null;
    return c.calc || c.pctv ? x.v - y.v : y.v ? ((x.v - y.v) / Math.abs(y.v)) * 100 : null;
  };
  const fmt = (c: Col, v: number) => (view === 'v' ? show(c, v) : c.calc?.[2] === 'ratio' ? `${sn(v, 2)}×` : c.calc || c.pctv ? `${sn(v, 1)} נק׳` : `${sn(v, 1)}%`);
  const sorted = (() => {
    const c = sort && cols.find((x) => x.k === sort.k);
    if (!c) return rows;
    return [...rows].sort((a, b) => { const x = shown(a, c), y = shown(b, c); return x == null ? 1 : y == null ? -1 : (y - x) * sort.dir; });
  })();
  const top = new Map(cols.map((c) => [c.k, Math.max(0, ...rows.map((r) => Math.abs(shown(r, c) ?? 0)))]));
  const median = (c: Col): number | null => { const xs = rows.map((r) => shown(r, c)).filter((v): v is number => v != null).sort((p, q) => p - q); return xs.length < 3 ? null : xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2; };
  // the basis most companies use in a column; a cell on another basis carries note 1
  const usual = new Map(cols.map((c) => { const n = new Map<string, number>(); rows.forEach((r) => { const b = r.cells[c.k]?.f?.b; if (b && b !== 'na' && !r.cells[c.k]?.calc) n.set(b, (n.get(b) ?? 0) + 1); }); return [c.k, [...n.entries()].sort((p, q) => q[1] - p[1])[0]?.[0]] as [string, string | undefined]; }));
  const marks = (c: Col, x: NonNullable<Cell>): number[] => {
    const m: number[] = [];
    if (x.calc) { if (x.mixed) m.push(4); return m; }
    const f = x.f!;
    if (f.b !== 'na' && usual.get(c.k) && f.b !== usual.get(c.k)) m.push(0);
    if (x.alt) m.push(1);
    if (f.src === 'chart') m.push(2);
    if (x.sum) m.push(3);
    if (f.m.startsWith('csm') && f.cl === 1) m.push(5); else if (f.m.startsWith('csm') && f.inc === 1) m.push(4);
    if ((x.n ?? 1) > 1) m.push(6);
    return m;
  };
  const used = new Set<number>();
  const press = (k: string) => setSort((cur) => (cur?.k !== k ? { k, dir: 1 } : cur.dir === 1 ? { k, dir: -1 } : null));
  const csv = () => {
    const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
    const head = ['company', ...cols.flatMap((c) => [c.l, `${c.l} · basis`, `${c.l} · page`])];
    const body = sorted.map((r) => [name(r.id), ...cols.flatMap((c) => { const x = r.cells[c.k]; return x ? [Number(x.v.toFixed(3)), x.calc ? 'derived' : x.f!.b, x.f?.pg ?? ''] : ['', '', '']; })]);
    const blob = new Blob(['\uFEFF' + [head, ...body].map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `fox_peers_${P}_${W}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <section className="controls">
        <Field label="דוח"><select value={P} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{periodName(p)}</option>)}</select></Field>
        {!annual && <div className="field"><span>חלון</span><Seg label="חלון" value={win} onChange={setWin} options={[['q', 'QTD'], ['ytd', 'YTD']]} /></div>}
        <div className="field"><span>תצוגה</span><Seg<'v' | 'y'> label="תצוגה" value={view} onChange={setView} options={[['v', 'ערך'], ['y', 'YoY']]} /></div>
        <div className="field"><span>עמודות</span><button type="button" className={`btn${pick ? ' primary' : ''}`} aria-expanded={pick} onClick={() => setPick((v) => !v)}>{`${cols.length} מתוך ${COLS.length}`}</button></div>
        <div className="field"><span>ייצוא</span><button type="button" className="btn" onClick={csv}>CSV</button></div>
      </section>
      {pick && <div className="colpick" role="group" aria-label="בחירת עמודות">
        {COLS.map((c) => <button key={c.k} type="button" aria-pressed={picked.includes(c.k)} onClick={() => setPicked(picked.includes(c.k) ? picked.filter((k) => k !== c.k) : COLS.map((x) => x.k).filter((k) => k === c.k || picked.includes(k)))}>{c.l}{c.calc ? ' ÷' : ''}</button>)}
        <button type="button" className="linkbtn" onClick={() => setPicked(DEFAULT)}>ברירת מחדל</button>
      </div>}
      <Panel title="מטריצת עמיתים" aside={<span>{periodName(P)} · {annual ? 'FY' : win === 'q' ? 'QTD' : 'YTD'} · {view === 'v' ? 'מיליוני ש"ח, קבוצה, כפי שדווח' : `שינוי מול ${periodName(P).replace(/'(\d\d)/, (_, y) => `'${String(Number(y) - 1).padStart(2, '0')}`)}`} · לחיצה על כותרת ממיינת</span>}>
        <div className="scroll"><table className="matrix">
          <thead><tr><th>חברה</th>{cols.map((c) => <th key={c.k} aria-sort={sort?.k === c.k ? (sort.dir === 1 ? 'descending' : 'ascending') : 'none'}><button type="button" className="thsort" onClick={() => press(c.k)}>{c.l}{c.calc ? <span className="dim"> ÷</span> : usual.get(c.k) ? <span className="dim"> · {BASIS[usual.get(c.k)!]}</span> : null}<i>{sort?.k === c.k ? (sort.dir === 1 ? '▼' : '▲') : ''}</i></button></th>)}</tr></thead>
          <tbody>{sorted.map((r, ri) => (
            <tr key={r.id}>
              <td>{sort && <span className="rk num">{ri + 1}</span>}<Link to={`/company/${r.id}/review`}>{name(r.id)}</Link></td>
              {cols.map((c) => {
                const x = r.cells[c.k], v = shown(r, c);
                if (!x || v == null) return <td key={c.k}><span className="muted">–</span></td>;
                const ms = marks(c, x); ms.forEach((m) => used.add(m));
                const sup = ms.length ? <sup title={ms.map((m) => (m === 0 ? `${BASIS[x.f!.b]}; ${NOTES[0]}` : NOTES[m])).join(' · ')}>{ms.map((m) => SUP[m]).join('')}</sup> : null;
                const tone = view === 'y' ? (v >= 0 ? 'pos' : 'neg') : v < 0 ? 'neg' : '';
                const w = top.get(c.k) ? Math.round((Math.abs(v) / top.get(c.k)!) * 100) : 0;
                const href = !x.calc && url(x.f!) && x.f!.pg != null ? `${url(x.f!)}#page=${x.f!.pg}` : null;
                return (
                  <td key={c.k} className="bar" style={{ ['--w' as string]: `${w}%` }}>
                    {href ? <a className={`num ${tone}`} href={href} target="_blank" rel="noreferrer" title={`${x.f!.l} · עמ׳ ${x.f!.pg}`}>{fmt(c, v)}</a> : <span className={`num ${tone}`}>{fmt(c, v)}</span>}{sup}
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
          <tfoot><tr><td>חציון</td>{cols.map((c) => { const m = median(c); return <td key={c.k}>{m == null ? <span className="muted">–</span> : <span className="num">{fmt(c, m)}</span>}</td>; })}</tr></tfoot>
        </table></div>
        {used.size > 0 && <ol className="fnotes">{[...used].sort().map((m) => <li key={m}><sup>{SUP[m]}</sup> {NOTES[m]}</li>)}</ol>}
      </Panel>
    </>
  );
}
