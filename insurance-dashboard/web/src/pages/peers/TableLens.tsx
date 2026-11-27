import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Sourced } from '../../components/Source';
import { idCss } from '../../lib/identity';
import { qlab } from '../../lib/quarters';
import { aggOf, colOf, exportBoard, isChgRd, SEC_TITLE, secMetrics, type BoardData, type Sec, type TCol } from './exportBoard';
import type { BoardOut } from '../../lib/peerBoard';
import '../../styles/peers.css';
import '../../styles/p6-lenses.css';

/* Lens טבלה of the peers board (spec p6 §3.2, §13.1 F2 / F7 / F8, §14.3 rules 2–3): the four shipped comps tables, read through the board's
   engine. A YoY beside an LTM level is LTM against LTM, beside a balance quarter end against quarter end, and its head says so; a carried
   figure is starred with its quarter and counted; a quarter-named change the company has not reported is muted and not counted; every
   median carries its n; full numbers, one precision per column; first tap on a head = best first (cheapest first on a multiple). The shell
   renders #guard above and #stamp below. */

export function TableLens({ d }: { d: BoardData }) {
  const tables = useMemo(() => {
    const cache = new Map<string, BoardOut>(), sms = secMetrics(d);
    return (['mkt', 'biz', 'sav', 'ins'] as Sec[]).map((sec) => ({ sec, cols: sms[sec].map((m) => colOf(d, m, cache)) })).filter((t) => t.cols.length);
  }, [d]);
  const [busy, setBusy] = useState(false);
  const go = (v: string) => { d.put('lens', null); d.put('v', v); };
  return (
    <div className="p6-lens" id="table-lens">
      {tables.map((t) => <CompsTable key={t.sec} d={d} sec={t.sec} cols={t.cols} />)}
      <div className="p6-btnrow">
        <button type="button" className="btn" id="xlsx-table" disabled={busy} onClick={() => { setBusy(true); void exportBoard(d).finally(() => setBusy(false)); }}>{busy ? 'מכין…' : 'ייצוא ל-Excel'}</button>
        <button type="button" className="btn" id="to-table" onClick={() => go('table')}>טבלה חופשית ›</button>
        <button type="button" className="btn" id="to-series" onClick={() => go('series')}>סדרה ›</button>
        <button type="button" className="btn" id="to-deck" onClick={() => go('deck')}>מצגת חיסכון ›</button>
      </div>
      <p className="p6-note">* נתון מרבעון מוקדם יותר (טרם דווח על {qlab(d.q)}), נספר בחציון · מעומעם: YoY של הרבעון שהחברה טרם דיווחה, לא נספר · YoY ליד רמת LTM: LTM מול LTM; ליד יתרה: סוף רבעון מול סוף רבעון · זרם שמחליף סימן: הפרש במיליארדי ש"ח · <sup className="p6-n">n</sup> ליד חציון: מספר החברות בו · צבע: רבעון בקבוצה (ירוק = טוב, במכפילים = זול) · לחיצה על כותרת ממיינת · כל מספר נפתח במקור שלו</p>
    </div>
  );
}

type Sort = { i: number; dir: 1 | -1 } | null;
function CompsTable({ d, sec, cols }: { d: BoardData; sec: Sec; cols: TCol[] }) {
  const [sort, setSort] = useState<Sort>(null);
  const { book } = d;
  const rowsAll = sec === 'ins' ? d.order.filter((e) => d.kindOf(e) === 'ins') : d.order;
  const rows = sort ? [...rowsAll].sort((a, b) => {
    const c = cols[sort.i], x = c.cells.get(a), y = c.cells.get(b), xv = x && !x.out ? x.v : null, yv = y && !y.out ? y.v : null;
    return xv == null && yv == null ? 0 : xv == null ? 1 : yv == null ? -1 : (xv - yv) * sort.dir;
  }) : rowsAll;
  // quartile heat by the column's own direction (a change column's direction is the shipped column's: higher growth = better)
  const heat = cols.map((c) => {
    const ranked = [...c.cells.values()].filter((x) => !x.out && x.v != null && rowsAll.includes(x.e)).sort((a, b) => (c.m.better === 'lo' ? a.v! - b.v! : b.v! - a.v!));
    return new Map(ranked.map((x, i) => [x.e, ranked.length > 1 ? 1 - i / (ranked.length - 1) : 0.5]));
  });
  const aggs = cols.map((c) => aggOf(sec, c, cols, rowsAll));
  const hasAgg = aggs.some((a) => a != null);
  const first = (c: TCol): 1 | -1 => (c.m.better === 'lo' ? 1 : -1);
  const tap = (i: number) => {
    const c = cols[i], f = first(c);
    setSort(sort?.i === i ? (sort.dir === f ? { i, dir: (-f) as 1 | -1 } : null) : { i, dir: f });
    if (c.bm && c.rd) { d.put('bm', c.bm.key); d.put('rd', c.rd === c.bm.reads?.[0] ? null : c.rd); }
  };
  const sel = (c: TCol) => !!c.bm && c.bm.key === d.bm && c.rd === d.rd;
  // BB8: a table wider than its panel says so: the company column stays pinned, the far edge fades, and "עוד עמודות ‹" scrolls a screen on
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false), [end, setEnd] = useState(false);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const f = () => { setOver(el.scrollWidth > el.clientWidth + 2); setEnd(Math.abs(el.scrollLeft) + el.clientWidth >= el.scrollWidth - 2); };
    f(); const ro = new ResizeObserver(f); ro.observe(el); el.addEventListener('scroll', f, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', f); };
  }, [cols.length]);
  const more = () => { const el = box.current; if (!el) return; const rtl = getComputedStyle(el).direction === 'rtl'; if (end) el.scrollTo({ left: 0, behavior: 'smooth' }); else el.scrollBy({ left: (rtl ? -1 : 1) * (el.clientWidth - 110), behavior: 'smooth' }); };
  return (
    <section className={`panel p6-tp${over ? ' p6-over' : ''}${end ? ' p6-end' : ''}`} id={`tbl-${sec}`}>
      <div className="hd"><h2>{SEC_TITLE[sec]}</h2>{over ? <button type="button" className="chip p6-tmore" onClick={more} aria-label={end ? 'חזרה לעמודות הראשונות' : 'עוד עמודות'}>{end ? '› לתחילה' : `עוד עמודות ‹`}</button> : null}</div>
      <div className="scroll pr-scroll" ref={box}><table className={`pr-table p6-ct${cols.length > 11 ? ' dense' : ''}`} data-cols={cols.length}>
        <thead><tr><th className="pr-ent">חברה</th>{cols.map((c, i) => (
          <th key={`${c.m.key}`} className={`p6-th${sel(c) ? ' sel' : ''}`} data-m={c.bm?.key ?? c.m.key} data-rd={c.rd ?? ''} aria-sort={sort?.i === i ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
            <button type="button" className="thsort" onClick={() => tap(i)} title={`${c.m.l}${c.m.note ? ` · ${c.m.note}` : ''}${c.bm?.better === 'lo' || c.m.better === 'lo' ? ' · לחיצה ראשונה: הזול / הנמוך ראשון' : ''}`}>
              <span>{c.m.sh}{sort?.i === i ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</span><small>{c.sub}</small></button></th>))}</tr></thead>
        <tbody>{rows.map((e) => (
          <tr key={e} className={e === d.focus ? 'lead' : undefined} data-e={e}>
            <td className="pr-ent"><button type="button" className="p6-ent" onClick={() => d.put('hl', e)} title="מיקוד בחברה"><i className="pdot" style={{ background: idCss(e) }} />{book.short(e)}</button></td>
            {cols.map((c, i) => {
              const x = c.cells.get(e), q = heat[i].get(e), n = heat[i].size;
              const band = q == null || n < 3 || !c.m.better ? '' : q >= 0.75 ? ' q4' : q >= 0.5 ? ' q3' : q > 0.25 ? ' q2' : ' q1';
              if (!x || x.v == null) return <td key={c.m.key} className={`${sel(c) ? 'sel' : ''}`}><span className="muted" title={x?.val.why ?? 'אין נתון'}>–</span></td>;
              const chg = isChgRd(c.rd) || c.m.u === 'pctx' || c.m.u === 'pp';
              const tone = x.out ? '' : chg ? (x.v > 0 ? ' pos' : x.v < 0 ? ' neg' : '') : x.v < 0 ? ' neg' : '';
              const title = x.out ? `טרם דיווחה על ${qlab(c.q)}: נתון ${qlab(x.q)}, לא בחציון` : x.stale ? `טרם דווח על ${qlab(c.q)}: הנתון האחרון (${qlab(x.q)})` : x.per ? `נתון ${qlab(x.per)}` : undefined;
              return <td key={c.m.key} className={`${band}${x.out ? ' outc' : ''}${sel(c) ? ' sel' : ''}`} data-e={e} data-q={x.q ?? ''}>
                <Sourced className={`num${tone}${x.stale ? ' stale' : ''}`} src={x.val.prov} title={title}>{c.fmt(x.v)}{x.stale ? '*' : ''}</Sourced></td>;
            })}
          </tr>
        ))}</tbody>
        <tfoot>
          <tr className="p6-medr"><td className="pr-ent">חציון<sup className="p6-n">n</sup></td>{cols.map((c) => (
            <td key={c.m.key} data-n={c.med.n}>{c.med.v == null || c.med.n < 2 ? <span className="muted">–</span>
              : <span className="p6-medc" dir="ltr"><Sourced className="num" src={() => medProv(d, c)}>{c.fmt(c.med.v)}</Sourced><sup className="p6-n">{c.med.n}</sup></span>}</td>))}</tr>
          <tr><td className="pr-ent">ממוצע</td>{cols.map((c) => <td key={c.m.key}><span className="num">{c.avg == null || c.med.n < 2 ? '–' : c.fmt(c.avg)}</span></td>)}</tr>
          {hasAgg && <tr><td className="pr-ent" title={sec === 'mkt' ? 'סך שווי השוק ÷ סך המכנים' : 'סכום החברות שבטבלה, רק כשכל הנתונים מאותה תקופה'}>{sec === 'mkt' ? 'משוקלל / סך' : sec === 'sav' ? 'סך הקבוצה' : 'סך המבטחות'}</td>
            {cols.map((c, i) => <td key={c.m.key}><span className="num">{aggs[i] == null ? '' : c.fmt(aggs[i]!)}</span></td>)}</tr>}
        </tfoot>
      </table></div>
      {cols.some((c) => c.m.note) && <div className="src">{cols.filter((c) => c.m.note).map((c) => `${c.m.sh}: ${c.m.note}`).join(' · ')}</div>}
    </section>
  );
}

/** a median's source: its n components (carried ones starred) and the rule */
function medProv(d: BoardData, c: TCol) {
  const { book } = d;
  return { k: 'calc' as const, title: `חציון · ${c.m.sh}${c.rd && isChgRd(c.rd) ? ` · ${c.sub}` : ''}`, value: c.fmt(c.med.v!), formula: `חציון של ${c.med.n} חברות`,
    inputs: c.med.parts.map((p) => ({ label: `${book.name(p.e)}${p.stale ? `* (${qlab(p.q)})` : ''}`, v: c.fmt(p.v), src: c.cells.get(p.e)?.val.prov })),
    note: 'חברה שטרם דיווחה: הנתון האחרון שדיווחה, מסומן ונספר; ב-YoY של הרבעון רק מי שדיווח' };
}
