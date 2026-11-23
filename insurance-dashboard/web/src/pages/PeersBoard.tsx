import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { Empty, Loading, Pick, Seg } from '../components/ui';
import { foxOption, foxPeers } from '../lib/foxchart';
import { identify } from '../lib/idmarks';
import { idColor, idCss } from '../lib/identity';
import { nf, pubLabel } from '../lib/format';
import { chartBase, CHART_FONT, palette, tooltipCss } from '../lib/theme';
import { useSource, type Prov } from '../lib/prov';
import { back, plab, useBook, type Registry } from '../lib/registry';
import { load, useLoad, useRegistry } from '../lib/useData';
import type { TasePrice } from '../lib/valuation';
import { mayaReport } from '../lib/sources';
import { aggMultiple, bizVal, fmtB, histVal, MBY, median, metricsFor, needIds, ols, spotVal, statOf, TAX, unitB, type BMetric, type BVal, type Kind, type MktFile, type Stat } from '../lib/peerBoard';
import '../styles/peerboard.css';

/* The comparison board (default view of "השוואה ענפית"): one company in focus against its peer set, on the stock and on the business.
   Read top-down: who is where (focus tiles, positioning map), the two comps tables, then the charts (P/B against ROE, ranked bars,
   multiples over time, total return). Every figure opens its source; multiples are estimates over TASE closes and printed figures. */

interface Props { reg: Registry; ents: string[]; setName: string }
type Win = '12' | '36' | '60';
type HWin = '12' | '24' | '40';
type FMode = 'bn' | 'pct';
const BAL = new Set(['oaum', 'open', 'ogem', 'opol']);
const HK = ['bx', 'by', 'bm', 'bh', 'bw', 'bs', 'bf'];

export function PeersBoard({ reg, ents, setName }: Props) {
  const [sp, setSp] = useSearchParams();
  const put = (k: string, v: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  const kindOf = (e: string): Kind => (reg.entities.find((x) => x.id === e)?.k === 'fund' ? 'fund' : 'ins');
  const kinds = ents.map(kindOf);
  const ms = useMemo(() => metricsFor(kinds), [kinds.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const major: Kind = kinds.filter((k) => k === 'ins').length >= kinds.length / 2 ? 'ins' : 'fund';

  // the metric files the board reads: parse its tokens against an empty book, then load
  const { book: b0 } = useBook(reg, []);
  const ids = useMemo(() => needIds(b0, ms, true), [b0, ms]);
  const { book, pending } = useBook(reg, ids);
  const coReg = useRegistry().data;
  const mk = useLoad<MktFile>('mkt.json').data ?? null;
  const [px, setPx] = useState<Record<string, TasePrice | null>>({});
  useEffect(() => {
    if (!coReg) return;
    let live = true;
    ents.filter((e) => !(e in px)).forEach((e) => {
      if (!coReg.find((c) => c.id === e)?.has_price) { setPx((cur) => ({ ...cur, [e]: null })); return; }
      load<TasePrice>(`companies/${e}.price.json`).then((p) => live && setPx((cur) => ({ ...cur, [e]: p })), () => live && setPx((cur) => ({ ...cur, [e]: null })));
    });
    return () => { live = false; };
  }, [ents.join(), coReg]);  // eslint-disable-line react-hooks/exhaustive-deps

  const focus0 = sp.get('hl') ?? '';
  const focus = ents.includes(focus0) ? focus0 : ents[0] ?? '';
  const npId = major === 'ins' ? 'ifrs:profit_attributable' : 'xbrl:profit';
  const p = book ? book.latest(npId, 'LTM', ents) ?? '' : '';
  // the regulator's files are monthly: the operating figures run to their own latest quarter, ahead of the filings
  const pOps = book ? book.latest('reg:assets@all', 'LTM', ents) ?? p : p;

  // the grid: metric × company
  const cells = useMemo(() => {
    const out = new Map<string, Map<string, BVal>>();
    if (!book || !p) return out;
    ms.forEach((m) => {
      const row = new Map<string, BVal>();
      ents.forEach((e) => row.set(e, m.spot ? spotVal(m, { book, ent: e, kind: kindOf(e), p, peers: ents, px: px[e] ?? null, mk }) : bizVal(book, m, e, kindOf(e), m.ax === 'reg' ? pOps : p, ents)));
      out.set(m.key, row);
    });
    return out;
  }, [book, p, pOps, ms, ents.join(), px, mk]);  // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => new Map(ms.map((m) => [m.key, statOf(m, new Map(ents.map((e) => [e, cells.get(m.key)?.get(e)?.v ?? null])))])), [cells, ms]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!book || !p || pending > 0) return <Loading what="לוח ההשוואה" />;
  const v = (k: string, e: string) => cells.get(k)?.get(e)?.v ?? null;
  const pxAsof = ents.map((e) => px[e]?.asof).filter((x): x is string => !!x).sort().pop();
  const order = [...ents].sort((a, b) => (v('mcap', b) ?? -1) - (v('mcap', a) ?? -1) || ents.indexOf(a) - ents.indexOf(b));
  const mkt = ms.filter((m) => m.sec === 'mkt'), biz = ms.filter((m) => m.sec === 'biz');
  const sav = ms.filter((m) => m.grp === 'sav'), insOps = ms.filter((m) => m.grp === 'ins');
  const anyOf = (xs: BMetric[]) => xs.filter((m) => ents.some((e) => cells.get(m.key)?.get(e)?.v != null));
  const savShown = anyOf(sav).filter((m) => !m.hide), insShown = anyOf(insOps);
  const insOrder = order.filter((e) => kindOf(e) === 'ins');
  const sumOf = (rows: string[]) => (m: BMetric) => { if (m.u !== 'bn' && m.u !== 'm') return null; const xs = rows.map((e) => v(m.key, e)).filter((x): x is number => x != null); return xs.length && (BAL.has(m.key) || (xs.length === rows.length && !rows.some((e) => cells.get(m.key)?.get(e)?.stale))) ? xs.reduce((a, x) => a + x, 0) : null; };
  // a total over the whole set only, of one period; an asset balance by product is the exception: a group without the product holds none
  const has = (k: string) => ms.some((m) => m.key === k);

  return (
    <div className="pb">
      <section className="panel pb-head">
        <div className="pb-focus" role="group" aria-label="חברה במיקוד">
          <span className="pb-cap">במיקוד</span>
          {order.map((e) => <button key={e} type="button" className="chip" aria-pressed={e === focus} onClick={() => put('hl', e)}><i className="sw" style={{ background: idCss(e) }} />{book.short(e)}</button>)}
        </div>
        <div className="pb-asof">{setName} · נתונים כספיים: <b>{plab('LTM', p)}</b> (סוף התקופה){savShown.length ? <> · פעילות (רגולטור): <b>{plab('LTM', pOps)}</b></> : null} · שוק: סגירה <b>{pxAsof ? pubLabel(pxAsof) : '–'}</b> · מכפילים הם אומדן: שווי שוק ÷ נתון מדווח{pending ? ' · טוען…' : ''}</div>
      </section>

      <FocusTiles book={book} focus={focus} ms={ms} cells={cells} stats={stats} n={ents.length} />

      <section className="panel">
        <div className="hd"><h2>מפת מיקום</h2><div className="aside"><span>כל נקודה חברה · הקו האנכי: חציון הקבוצה · מרחף לערך</span></div></div>
        <div className="pb-maps">
          <PosMap title="המניה" ends={['זול', 'יקר']} ms={mkt.filter((m) => m.u !== 'm' && m.u !== 'bn' && m.u !== 'pctx')} cells={cells} stats={stats} focus={focus} book={book} by="value" onPick={(k) => put('bm', k)} />
          <PosMap title="העסק" ends={['חלש', 'חזק']} ms={biz.filter((m) => m.better)} cells={cells} stats={stats} focus={focus} book={book} by="good" onPick={(k) => put('bm', k)} />
          {[...savShown, ...insShown].some((m) => m.better) && <PosMap title="הפעילות" ends={['חלש', 'חזק']} ms={[...savShown, ...insShown].filter((m) => m.better && (stats.get(m.key)?.n ?? 0) >= Math.min(3, ents.length))} cells={cells} stats={stats} focus={focus} book={book} by="good" onPick={(k) => put('bm', k)} />}
        </div>
      </section>

      <CompsTable title="המניה · מכפילים ותשואה" sub={`שווי שוק בסגירת ${pxAsof ? pubLabel(pxAsof) : '–'} · מכפילים על ${plab('LTM', p)}`} ms={mkt} order={order} cells={cells} stats={stats} focus={focus} book={book}
        onFocus={(e) => put('hl', e)} onMetric={(k) => put('bm', k)} agg={(m) => aggRow(m, order, v)} />
      <CompsTable title="העסק · רווחיות, צמיחה והון" sub={`${plab('LTM', p)} · YoY מול ${plab('LTM', back('LTM', p, 4)).replace('LTM ', '')}`} ms={biz} order={order} cells={cells} stats={stats} focus={focus} book={book}
        onFocus={(e) => put('hl', e)} onMetric={(k) => put('bm', k)} />
      {savShown.length > 0 && <CompsTable title="הפעילות · חיסכון ארוך טווח: נכסים, הפקדות, משיכות וניוד" sub={`רשות שוק ההון (גמל-נט, פנסיה-נט, ביטוח-נט) ${plab('LTM', pOps)} · ניוד יוצא ועסק חדש: מצגות החברות`}
        ms={savShown} order={order} cells={cells} stats={stats} focus={focus} book={book} onFocus={(e) => put('hl', e)} onMetric={(k) => put('bm', k)} agg={sumOf(order)} aggLabel="סך הקבוצה" />}
      {insShown.length > 0 && <CompsTable title="הפעילות · ביטוח: הכנסות, צמיחה ומרווח לפי מגזר" sub={`ביאור המגזרים (IFRS 17) ${plab('LTM', p)} · פרמיות ברוטו: כפי שהחברה מדווחת`}
        ms={insShown} order={insOrder} cells={cells} stats={stats} focus={focus} book={book} onFocus={(e) => put('hl', e)} onMetric={(k) => put('bm', k)} agg={sumOf(insOrder)} aggLabel="סך המבטחות" />}
      {(savShown.length > 0 || insShown.length > 0) && <div className="pb-grid">
        {savShown.some((m) => m.key === 'open' || m.key === 'ogem') && <Mix title="תמהיל נכסים לפי מוצר" book={book} ents={order} cells={cells} focus={focus} keys={['open', 'ogem', 'opol']} total="oaum"
          src={`רשות שוק ההון · ${plab('LTM', pOps).replace('LTM ', 'סוף ')} · מתחת לשם: סך הנכסים`} />}
        {savShown.some((m) => m.key === 'odep') && <Flows book={book} ents={order} cells={cells} focus={focus} mode={(sp.get('bf') as FMode) ?? 'bn'} setMode={(f) => put('bf', f)} p={pOps} />}
        {insShown.some((m) => m.key === 'rlife' || m.key === 'rpc') && <Mix title="תמהיל הכנסות מביטוח לפי מגזר" book={book} ents={order} cells={cells} focus={focus} keys={['rlife', 'rhealth', 'rpc']}
          src={`ביאור המגזרים, IFRS 17 · ${plab('LTM', p)} · מתחת לשם: סך ההכנסות מביטוח`} />}
      </div>}

      <div className="pb-grid">
        <Scatter book={book} ents={order} ms={ms} cells={cells} focus={focus} x={sp.get('bx') ?? 'roe'} y={sp.get('by') ?? (has('pb') ? 'pb' : 'pe')} setX={(k) => put('bx', k)} setY={(k) => put('by', k)} />
        <Bars book={book} ents={order} ms={ms} cells={cells} stats={stats} focus={focus} k={sp.get('bm') && MBY.has(sp.get('bm')!) && has(sp.get('bm')!) ? sp.get('bm')! : 'pe'} setK={(k) => put('bm', k)} />
      </div>
      <div className="pb-grid">
        <History book={book} ents={order} kindOf={kindOf} focus={focus} p={MBY.get(sp.get('bh') ?? 'pb')?.ax === 'reg' ? pOps : p} k={sp.get('bh') ?? 'pb'} setK={(k) => put('bh', k)} w={(sp.get('bs') as HWin) ?? '12'} setW={(w) => put('bs', w)} major={major} />
        <Perf book={book} ents={order} mk={mk} focus={focus} w={(sp.get('bw') as Win) ?? '36'} setW={(w) => put('bw', w)} />
      </div>
      <div className="src pr-foot">
        מקורות: דוחות החברות (IFRS 17, XBRL), דוחות כושר פירעון, רשות שוק ההון (גמל-נט, פנסיה-נט, ביטוח-נט: נכסים, הפקדות, משיכות, ניוד), מצגות החברות, הבורסה לניירות ערך (שערי סגירה, שווי שוק, דיבידנד לפי שער הבסיס ביום האקס) · P/E על רווח נקי לבעלי המניות LTM; P/B על הון לבעלי המניות;
        {has('pbc') ? ` CSM נטו ממס בשיעור ${nf(TAX, 2)}% (הנחה, כמו בדפי הערכת השווי);` : ''} מכפיל של רווח או הון שליליים אינו מוצג · "משוקלל" = סך שווי השוק ÷ סך המכנים · תשואה כוללת: דיבידנד מושקע מחדש ·
        {' '}<button type="button" className="linkbtn" onClick={() => void exportBoard(book, ms, order, cells, stats, setName, p, pxAsof ?? '', pOps)}>ייצוא ל-Excel</button>
      </div>
    </div>
  );
}
export const BOARD_KEYS = HK;

function aggRow(m: BMetric, order: string[], v: (k: string, e: string) => number | null): number | null {
  const mc = order.map((e) => v('mcap', e));
  if (m.key === 'pe') return aggMultiple(mc, order.map((e) => (v('pe', e) ? v('mcap', e)! / v('pe', e)! : null)));
  if (m.key === 'pb') return aggMultiple(mc, order.map((e) => (v('pb', e) ? v('mcap', e)! / v('pb', e)! : null)));
  if (m.key === 'pbc') return aggMultiple(mc, order.map((e) => (v('pbc', e) ? v('mcap', e)! / v('pbc', e)! : null)));
  if (m.key === 'mcap') { const xs = mc.filter((x): x is number => x != null); return xs.length ? xs.reduce((s, x) => s + x, 0) : null; }
  return null;
}

/* ---------- focus tiles ---------- */
function FocusTiles({ book, focus, ms, cells, stats, n }: { book: NonNullable<ReturnType<typeof useBook>['book']>; focus: string; ms: BMetric[]; cells: Map<string, Map<string, BVal>>; stats: Map<string, Stat>; n: number }) {
  const want = ['pe', 'pb', 'pbc', 'maum', 'dy', 'roe', 'npy', 'csmy', 'aumy', 'sr'].filter((k) => ms.some((m) => m.key === k)).slice(0, 8);
  const ops = ['oshare', 'oshd', 'onetr', 'owdr', 'pout', 'rpcy', 'mhealth'].filter((k) => ms.some((m) => m.key === k) && cells.get(k)?.get(focus)?.v != null).slice(0, 6);
  const pbx = cells.get('pb')?.get(focus)?.v, pbm = stats.get('pb')?.med, roe = cells.get('roe')?.get(focus)?.v, roem = stats.get('roe')?.med;
  const prem = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? (a / b - 1) * 100 : null);
  const pp = prem(pbx, pbm);
  return (
    <section className="panel pb-tiles">
      <div className="hd"><h2><i className="pdot" style={{ background: idCss(focus) }} />{book.name(focus)} מול הקבוצה</h2>
        <div className="aside"><Link to={`/company/${focus}`}>לדף החברה</Link>{book.ent.get(focus)?.k === 'ins' && <> · <Link to={`/valuation/${focus}`}>הערכת שווי</Link></>}</div></div>
      {pbx != null && pbm != null && roe != null && roem != null && (
        <p className="pb-lede">נסחרת ב-P/B של <b>{nf(pbx, 2)}x</b> מול חציון {nf(pbm, 2)}x ({pp! >= 0 ? 'פרמיה' : 'דיסקאונט'} של {nf(Math.abs(pp!), 0)}%), עם ROE של <b>{nf(roe, 1)}%</b> מול חציון {nf(roem, 1)}%.
          {roe > roem === pbx > pbm ? ' המכפיל והתשואה להון באותו צד של החציון.' : roe > roem ? ' תשואה להון מעל החציון במכפיל מתחתיו.' : ' מכפיל מעל החציון בתשואה להון מתחתיו.'}</p>
      )}
      {[want, ops].filter((ks) => ks.length).map((ks, gi) => <div key={gi} className="pb-tilegrid" aria-label={gi ? 'פעילות' : 'המניה והעסק'}>{gi ? <div className="pb-tilecap">פעילות</div> : null}{ks.map((k) => {
        const m = MBY.get(k)!, x = cells.get(k)?.get(focus), s = stats.get(k)!, r = s.rank.get(focus), d = x?.v != null && s.med != null ? x.v - s.med : null;
        const good = d == null || !m.better ? null : (m.better === 'hi' ? d > 0 : d < 0);
        return (
          <div key={k} className="pb-tile">
            <div className="pb-tl">{m.sh}</div>
            <div className="pb-tv">{x?.v == null ? <span className="muted" title={x?.why}>–</span> : <Sourced className="num" src={x.prov}>{fmtB(m, x.v)}</Sourced>}</div>
            <div className="pb-ts">חציון {s.med == null ? '–' : fmtB(m, s.med)}{d != null && <span className={good == null ? '' : good ? 'up' : 'down'}> · {d >= 0 ? '+' : '−'}{m.u === 'pp' ? `${nf(Math.abs(d), m.dec)} נק׳` : fmtB({ ...m, u: m.u === 'pctx' ? 'pct' : m.u }, Math.abs(d)).replace('%', m.u === 'pct' || m.u === 'pctx' ? ' נק׳' : '')}</span>}</div>
            {r != null && <div className="pb-rank" title={m.better === 'lo' ? 'דירוג: 1 = הנמוך בקבוצה' : 'דירוג: 1 = הגבוה בקבוצה'}><span style={{ ['--w' as string]: `${(s.pct.get(focus) ?? 0) * 100}%` }} /><em>{r} מתוך {s.n}{m.better === 'lo' ? ' · מהזול' : ''}</em></div>}
          </div>
        );
      })}</div>)}
      <div className="src">{n} חברות בקבוצה · דירוג 1 = הגבוה ביותר (במכפילים: הזול ביותר) · ההפרש מהחציון בנקודות אחוז לשיעורים</div>
    </section>
  );
}

/* ---------- positioning map ---------- */
function PosMap({ title, ends, ms, cells, stats, focus, book, by, onPick }: { title: string; ends: [string, string]; ms: BMetric[]; cells: Map<string, Map<string, BVal>>; stats: Map<string, Stat>; focus: string; book: NonNullable<ReturnType<typeof useBook>['book']>; by: 'value' | 'good'; onPick: (k: string) => void }) {
  return (
    <div className="pb-map">
      <div className="pb-maphd"><h3>{title}</h3><span className="pb-ends"><i>{ends[0]}</i><i>{ends[1]}</i></span><span /></div>
      {ms.map((m) => {
        const s = stats.get(m.key)!, row = cells.get(m.key)!;
        if (!s.n) return null;
        // a robust span (median ± 3 × MAD): one extreme value pins at the edge instead of squeezing the rest together
        const xs = [...row.values()].map((x) => x.v).filter((x): x is number => x != null), md = s.med ?? 0;
        const mad = xs.length ? (xs.map((x) => Math.abs(x - md)).sort((a, b) => a - b)[Math.floor(xs.length / 2)] || 0) : 0;
        const lo = mad ? Math.max(s.min, md - 3 * mad) : s.min, hi = mad ? Math.min(s.max, md + 3 * mad) : s.max;
        const span = hi - lo || 1;
        // position: by value (multiples: low = cheap at the start) or by goodness (business: weak at the start)
        const pos = (x: number) => { const t = Math.min(1, Math.max(0, (Math.min(hi, Math.max(lo, x)) - lo) / span)); return by === 'value' ? (m.better === 'hi' ? 1 - t : t) : m.better === 'lo' ? 1 - t : t; };
        const fv = row.get(focus)?.v;
        return (
          <button type="button" key={m.key} className="pb-maprow" onClick={() => onPick(m.key)} title={`${m.l}: עמודות בגרף הדירוג`}>
            <span className="pb-ml">{m.sh}</span>
            <span className="pb-track">
              {s.med != null && <span className="pb-med" style={{ insetInlineStart: `${pos(s.med) * 100}%` }} />}
              {[...row].filter(([e, x]) => e !== focus && x.v != null).map(([e, x]) => <span key={e} className="pb-dot" style={{ insetInlineStart: `${pos(x.v!) * 100}%`, background: idCss(e) }} title={`${book.short(e)}: ${fmtB(m, x.v!)}`} />)}
              {fv != null && <span className="pb-dot f" style={{ insetInlineStart: `${pos(fv) * 100}%`, background: idCss(focus) }} title={`${book.short(focus)}: ${fmtB(m, fv)}`} />}
            </span>
            <span className="pb-mv num">{fv == null ? '–' : fmtB(m, fv)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- comps table ---------- */
function CompsTable({ title, sub, ms, order, cells, stats, focus, book, onFocus, onMetric, agg, aggLabel }: { title: string; sub: string; ms: BMetric[]; order: string[]; cells: Map<string, Map<string, BVal>>; stats: Map<string, Stat>; focus: string;
  book: NonNullable<ReturnType<typeof useBook>['book']>; onFocus: (e: string) => void; onMetric: (k: string) => void; agg?: (m: BMetric) => number | null; aggLabel?: string }) {
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(null);
  const rows = sort ? [...order].sort((a, b) => { const x = cells.get(sort.k)?.get(a)?.v, y = cells.get(sort.k)?.get(b)?.v; return x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : (x - y) * sort.d; }) : order;
  const hasAgg = !!agg && ms.some((m) => agg(m) != null);
  return (
    <section className="panel pr-panel">
      <div className="hd"><h2>{title}</h2><div className="aside"><span>{sub} · צבע: רבעון בקבוצה (ירוק = טוב, במכפילים = זול) · לחיצה על כותרת ממיינת</span></div></div>
      <div className="scroll pr-scroll"><table className="pr-table pb-table">
        <thead><tr><th className="pr-ent">חברה</th>{ms.map((m) => (
          <th key={m.key} className="pb-th" aria-sort={sort?.k === m.key ? (sort.d > 0 ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="thsort" onClick={() => { setSort(sort?.k === m.key ? (sort.d === -1 ? { k: m.key, d: 1 } : null) : { k: m.key, d: -1 }); onMetric(m.key); }} title={m.l + (m.note ? ` · ${m.note}` : '')}>
              <span>{m.sh}</span><small>{unitB(m)}{m.freq === 'FY' ? ' · FY' : m.freq === 'H' ? ' · H/FY' : ''}{sort?.k === m.key ? (sort.d > 0 ? ' ▲' : ' ▼') : ''}</small></button></th>))}</tr></thead>
        <tbody>{rows.map((e) => (
          <tr key={e} className={e === focus ? 'lead' : undefined}>
            <td className="pr-ent"><button type="button" className="pb-ent" onClick={() => onFocus(e)} title="מיקוד בחברה"><i className="pdot" style={{ background: idCss(e) }} />{book.short(e)}</button></td>
            {ms.map((m) => {
              const x = cells.get(m.key)?.get(e), s = stats.get(m.key)!, q = m.better && x?.v != null ? s.pct.get(e) : undefined;
              const band = q == null || s.n < 3 ? '' : q >= 0.75 ? ' q4' : q >= 0.5 ? ' q3' : q > 0.25 ? ' q2' : ' q1';
              return <td key={m.key} className={band}>{x?.v == null ? <span className="muted" title={x?.why}>–</span>
                : <Sourced className={`num${x.v < 0 ? ' neg' : ''}${x.stale ? ' stale' : ''}`} src={x.prov} title={x.stale ? `נתון מ-${plab(x.p!.endsWith('FY') ? 'FY' : x.p!.includes('H') ? 'H' : 'LTM', x.p!).replace('LTM ', '')}` : undefined}>{fmtB(m, x.v)}{x.stale ? '*' : ''}</Sourced>}</td>;
            })}
          </tr>
        ))}</tbody>
        <tfoot>
          <tr><td className="pr-ent">חציון</td>{ms.map((m) => { const s = stats.get(m.key)!; return <td key={m.key}><span className="num">{s.med == null || s.n < 2 ? '–' : fmtB(m, s.med)}</span></td>; })}</tr>
          <tr><td className="pr-ent">ממוצע</td>{ms.map((m) => { const s = stats.get(m.key)!; return <td key={m.key}><span className="num">{s.avg == null || s.n < 2 ? '–' : fmtB(m, s.avg)}</span></td>; })}</tr>
          {hasAgg && <tr><td className="pr-ent" title={aggLabel ? 'סכום החברות שבטבלה' : 'סך שווי השוק ÷ סך המכנים'}>{aggLabel ?? 'משוקלל / סך'}</td>{ms.map((m) => { const a = agg!(m); return <td key={m.key}><span className="num">{a == null ? '' : fmtB(m, a)}</span></td>; })}</tr>}
        </tfoot>
      </table></div>
      <div className="src">* נתון מתקופה מוקדמת יותר (כושר פירעון ומצגות מתפרסמים פעמיים בשנה). כל מספר נפתח במקור ובנוסחה שלו.{ms.some((m) => m.note) ? <> · {ms.filter((m) => m.note).map((m) => `${m.sh}: ${m.note}`).join(' · ')}</> : null}</div>
    </section>
  );
}

/* ---------- scatter: any two metrics, with the set's least-squares line ---------- */
function Scatter({ book, ents, ms, cells, focus, x, y, setX, setY }: { book: NonNullable<ReturnType<typeof useBook>['book']>; ents: string[]; ms: BMetric[]; cells: Map<string, Map<string, BVal>>; focus: string; x: string; y: string; setX: (k: string) => void; setY: (k: string) => void }) {
  const { open } = useSource();
  const opts = ms.filter((m) => !m.hide && m.u !== 'm' && m.u !== 'bn').map((m) => [m.key, m.sh] as [string, string]);
  const mx = MBY.get(x) ?? MBY.get('roe')!, my = MBY.get(y) ?? MBY.get('pb')!;
  const pts = ents.map((e) => ({ e, a: cells.get(mx.key)?.get(e), b: cells.get(my.key)?.get(e), s: cells.get('mcap')?.get(e)?.v ?? null })).filter((q) => q.a?.v != null && q.b?.v != null);
  const fit = ols(pts.map((q) => [q.a!.v!, q.b!.v!]));
  const res = fit ? pts.map((q) => ({ e: q.e, r: q.b!.v! - (fit.a + fit.b * q.a!.v!), fy: fit.a + fit.b * q.a!.v! })) : [];
  const smax = Math.max(1, ...pts.map((q) => q.s ?? 0));
  const build = (): EChartsCoreOption => {
    const b = chartBase();
    const xs = pts.map((q) => q.a!.v!), lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo) * 0.08 || 1;
    const ys = pts.map((q) => q.b!.v!), ylo = Math.min(...ys), yhi = Math.max(...ys), ypad = (yhi - ylo) * 0.16 || 0.5;
    return {
      textStyle: { fontFamily: CHART_FONT, color: b.fg }, animationDuration: 500,
      grid: { left: 8, right: 24, top: 36, bottom: 28, containLabel: true },
      tooltip: { trigger: 'item', confine: true, backgroundColor: b.panel, borderColor: b.ln, extraCssText: tooltipCss(), textStyle: { color: b.fg, fontSize: 12 },
        formatter: (p: { seriesIndex: number; dataIndex: number }) => { if (p.seriesIndex !== 0) return ''; const q = pts[p.dataIndex], r = res.find((z) => z.e === q.e);
          return `<b>${book.name(q.e)}</b><br/>${mx.sh}: ${fmtB(mx, q.a!.v!)}<br/>${my.sh}: ${fmtB(my, q.b!.v!)}${r ? `<br/>מול הקו: ${r.r >= 0 ? '+' : '−'}${fmtB({ ...my, u: my.u === 'pctx' ? 'pct' : my.u }, Math.abs(r.r))}` : ''}`; } },
      xAxis: { type: 'value', name: mx.sh, nameLocation: 'middle', nameGap: 26, scale: true, min: +(lo - pad).toFixed(2), max: +(hi + pad).toFixed(2), axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln2 } }, nameTextStyle: { color: b.mu } },
      yAxis: { type: 'value', name: my.sh, scale: true, min: +(ylo - ypad).toFixed(3), max: +(yhi + ypad).toFixed(3), axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln2 } }, nameTextStyle: { color: b.mu } },
      series: [
        { type: 'scatter', data: pts.map((q) => ({ value: [q.a!.v!, q.b!.v!], symbolSize: 12 + 26 * Math.sqrt((q.s ?? smax * 0.1) / smax),
            itemStyle: { color: idColor(q.e), opacity: q.e === focus ? 1 : 0.78, borderColor: q.e === focus ? b.fg : b.panel, borderWidth: q.e === focus ? 2.5 : 1 },
            label: { show: true, formatter: book.short(q.e), position: 'top', color: q.e === focus ? b.fg : b.mu, fontSize: q.e === focus ? 12.5 : 11, fontWeight: q.e === focus ? 600 : 400 } })) },
        ...(fit ? [{ type: 'line', data: [[lo - pad, fit.a + fit.b * (lo - pad)], [hi + pad, fit.a + fit.b * (hi + pad)]], symbol: 'none', silent: true, lineStyle: { color: b.mu, type: 'dashed', width: 1.2 } }] : []),
      ],
    };
  };
  return (
    <section className="panel">
      <div className="hd"><h2>{my.sh} מול {mx.sh}</h2><div className="aside">
        <Pick label="ציר אנכי" cap="Y" value={my.key} onChange={setY} options={opts} /><Pick label="ציר אופקי" cap="X" value={mx.key} onChange={setX} options={opts} /></div></div>
      {pts.length < 3 ? <Empty title="פחות משלוש חברות עם שני הנתונים" /> : <>
        <Chart label={`${my.sh} מול ${mx.sh}`} height={360} deps={[x, y, ents.join(), focus, pts.length]} build={build} onPoint={(si, di) => { if (si === 0) open(pts[di].b!.prov()); }} source="דוחות החברות · TASE · fox" />
        <div className="src">{fit ? <>קו ריבועים פחותים של הקבוצה: {my.sh} = {nf(fit.a, 2)} {fit.b >= 0 ? '+' : '−'} {nf(Math.abs(fit.b), 3)} × {mx.sh} · R² = {nf(fit.r2, 2)} ({pts.length} חברות){fit.r2 < 0.3 ? ' · קשר חלש: לפרש בזהירות' : ''}. גודל הבועה: שווי שוק.
          {(() => { const r = res.find((z) => z.e === focus); return r ? <> <b>{book.short(focus)}</b>: {r.r >= 0 ? 'מעל' : 'מתחת ל'}קו ב-{fmtB({ ...my, u: my.u === 'pctx' ? 'pct' : my.u }, Math.abs(r.r))} {my.u === 'x' && r.fy > 0 ? ` (${nf(Math.abs(r.r / r.fy) * 100, 0)}% מהערך המותאם)` : ''}.</> : null; })()}</> : 'אין מספיק פיזור לקו'}
          {' '}סטטיסטיקה תיאורית על קבוצה קטנה, לא המלצה.</div>
      </>}
    </section>
  );
}

/* ---------- ranked bars ---------- */
function Bars({ book, ents, ms, cells, stats, focus, k, setK }: { book: NonNullable<ReturnType<typeof useBook>['book']>; ents: string[]; ms: BMetric[]; cells: Map<string, Map<string, BVal>>; stats: Map<string, Stat>; focus: string; k: string; setK: (k: string) => void }) {
  const { open } = useSource();
  const m = MBY.get(k)!, s = stats.get(k)!;
  const rows = ents.map((e) => ({ e, x: cells.get(k)?.get(e) })).filter((r) => r.x?.v != null).sort((a, b) => (m.better === 'lo' ? a.x!.v! - b.x!.v! : b.x!.v! - a.x!.v!));
  const pct = m.u === 'pct' || m.u === 'pctx';
  const build = (): EChartsCoreOption => {
    const o = foxPeers({ cats: rows.map((r) => book.short(r.e)), series: [{ name: m.sh, data: rows.map((r) => +r.x!.v!.toFixed(4)) }], lead: rows.findIndex((r) => r.e === focus), dec: m.dec, pct, signed: true, axis: false }) as { series: Record<string, unknown>[] };
    const narrow = typeof window !== 'undefined' && window.innerWidth < 760, b = chartBase();
    if (s.med != null && o.series[0]) o.series[0].markLine = { silent: true, symbol: 'none', lineStyle: { color: b.mu, type: 'dashed' }, label: { formatter: `חציון ${fmtB(m, s.med)}`, color: b.mu, fontSize: 10.5, position: narrow ? 'end' : 'insideEndTop' },
      data: [narrow ? { xAxis: s.med } : { yAxis: s.med }] };
    return o as EChartsCoreOption;
  };
  return (
    <section className="panel">
      <div className="hd"><h2>דירוג · {m.l}</h2><div className="aside"><Pick label="מדד לדירוג" cap="מדד" value={k} onChange={setK} options={ms.filter((x) => !x.hide).map((x) => [x.key, x.sh] as [string, string])} /></div></div>
      {!rows.length ? <Empty title="אין נתונים למדד" /> : <Chart label={`דירוג ${m.sh}`} height={Math.max(300, rows.length * 30)} deps={[k, ents.join(), focus, rows.length]} build={build} onPoint={(_, di) => open(rows[di].x!.prov())} source="דוחות החברות · TASE · fox" />}
      <div className="src">{unitB(m)} · מודגש: החברה במיקוד · קו מקווקו: חציון הקבוצה{m.note ? ` · ${m.note}` : ''}</div>
    </section>
  );
}

/* ---------- multiples over time (quarter-end closes) ---------- */
function History({ book, ents, kindOf, focus, p, k, setK, w, setW, major }: { book: NonNullable<ReturnType<typeof useBook>['book']>; ents: string[]; kindOf: (e: string) => Kind; focus: string; p: string; k: string; setK: (k: string) => void; w: HWin; setW: (w: HWin) => void; major: Kind }) {
  const { open } = useSource();
  const hm = [...MBY.values()].filter((m) => m.hist?.[major]);
  const m = hm.find((x) => x.key === k) ?? hm.find((x) => x.key === 'pb') ?? hm[0];
  const n = (Number(w) || 12) + 1;  // quarters
  const ps = Array.from({ length: n }, (_, i) => back('LTM', p, n - 1 - i));
  const g = ents.map((e) => ps.map((q) => histVal(book, m, e, kindOf(e), q, ents)));
  const shown = ps.map((_, i) => g.some((r) => r[i]?.v != null));
  const lo = shown.indexOf(true), xs = lo < 0 ? [] : ps.slice(lo), gg = g.map((r) => r.slice(lo));
  const med = xs.map((_, i) => median(gg.map((r) => r[i]?.v).filter((v): v is number => v != null)));
  const pct = m.u === 'pct' || m.u === 'pctx';
  return (
    <section className="panel">
      <div className="hd"><h2>{m.sh} לאורך זמן</h2><div className="aside">
        <Pick label="מדד" cap="מדד" value={m.key} onChange={setK} options={hm.map((x) => [x.key, x.sh] as [string, string])} />
        <Seg<HWin> label="טווח" value={w} onChange={setW} options={[['12', '3Y'], ['24', '6Y'], ['40', '10Y']]} /></div></div>
      {xs.length < 2 ? <Empty title="אין רצף למדד ולטווח" /> : (
        <Chart label={`${m.sh} לאורך זמן`} height={340} deps={[m.key, w, ents.join(), focus, p, book.files.size]} source="דוחות החברות · TASE (סגירה ביום המסחר האחרון ברבעון) · fox"
          onPoint={(si, di) => { const x = gg[si]?.[di]; if (x && x.v != null) open(x.prov()); }}
          build={() => identify(foxOption({ x: xs.map((q) => plab('Q', q)), unit: unitB(m), legend: false, labels: false, scale: true,
            series: [...ents.map((e, i) => ({ name: book.short(e), kind: 'line' as const, color: idColor(e), pct, lead: e === focus, dim: e !== focus, dec: m.dec, data: gg[i].map((x) => (x?.v == null ? null : +x.v.toFixed(4))) })),
              { name: 'חציון', kind: 'line' as const, color: chartBase().mu, dashed: true, pct, dec: m.dec, data: med.map((x) => (x == null ? null : +x.toFixed(4))) }] }), { height: 340 })} />
      )}
      <div className="src">מכפיל בסוף כל רבעון: שווי שוק ביום המסחר האחרון ברבעון ÷ הנתון המדווח לאותו רבעון (רווח: LTM). קו מקווקו: חציון. אחרי סוף רבעון ועד פרסום הדוחות הנקודה האחרונה חסרה.</div>
    </section>
  );
}

/* ---------- total return, rebased to 100 ---------- */
function Perf({ book, ents, mk, focus, w, setW }: { book: NonNullable<ReturnType<typeof useBook>['book']>; ents: string[]; mk: MktFile | null; focus: string; w: Win; setW: (w: Win) => void }) {
  const have = ents.filter((e) => mk?.ents[e]?.w.length);
  const last = have.map((e) => mk!.ents[e].last).sort().pop() ?? '';
  const from = last ? (() => { const d = new Date(`${last}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - Number(w)); return d.toISOString().slice(0, 10); })() : '';
  // a common weekly axis: the weeks of the longest-listed company; each series is read on or before each week and starts at 100 on its first point
  const axisEnt = [...have].sort((x, y) => mk!.ents[x].first.localeCompare(mk!.ents[y].first) || (x === focus ? -1 : y === focus ? 1 : 0))[0];
  const ax = axisEnt ? mk!.ents[axisEnt].w.filter(([d]) => d >= from).map(([d]) => d) : [];
  const series = have.map((e) => {
    const ws = mk!.ents[e].w; let j = 0; let base: number | null = null;
    return { e, data: ax.map((d) => { while (j + 1 < ws.length && ws[j + 1][0] <= d) j++; if (ws[j][0] > d) return null; const tr = ws[j][2]; if (base == null) base = tr; return +(tr / base * 100).toFixed(2); }) };
  });
  return (
    <section className="panel">
      <div className="hd"><h2>תשואה כוללת · בסיס 100</h2><div className="aside"><Seg<Win> label="טווח" value={w} onChange={setW} options={[['12', '1Y'], ['36', '3Y'], ['60', '5Y']]} /></div></div>
      {ax.length < 4 ? <Empty title="אין היסטוריית מחירים" /> : (
        <Chart label={`תשואה כוללת ${w === '12' ? '1Y' : w === '36' ? '3Y' : '5Y'}`} height={340} deps={[w, ents.join(), focus, mk?.asof]} source={`TASE · שערי סגירה שבועיים, דיבידנד מושקע מחדש · עד ${pubLabel(last)}`}
          build={() => identify(foxOption({ x: ax.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`), unit: 'מדד, 100 בתחילת הטווח', legend: false, labels: false, scale: true, dense: true,
            series: series.map((s) => ({ name: book.short(s.e), kind: 'line' as const, color: idColor(s.e), lead: s.e === focus, dim: s.e !== focus, dec: 0, data: s.data })) }), { height: 340 })} />
      )}
      <div className="src">כל חברה מתחילה ב-100 בתחילת הטווח (או בהנפקה, אם מאוחרת). דיבידנד מושקע מחדש בשער הסגירה ביום האקס. לפי מדיניות האתר, מחיר הוא קלט להשוואה ולא כותרת.</div>
    </section>
  );
}

/* ---------- operations: a mix per company (assets by product, insurance revenue by segment) ---------- */
function Mix({ title, book, ents, cells, focus, keys, total, src }: { title: string; book: NonNullable<ReturnType<typeof useBook>['book']>; ents: string[]; cells: Map<string, Map<string, BVal>>; focus: string; keys: string[]; total?: string; src: string }) {
  const { open } = useSource();
  const ms = keys.map((k) => MBY.get(k)!);
  const rows = ents.map((e) => {
    const parts = keys.map((k) => cells.get(k)?.get(e)?.v ?? null), t = (total ? cells.get(total)?.get(e)?.v : null) ?? parts.reduce<number>((a, x) => a + (x ?? 0), 0);
    return { e, parts, t };
  }).filter((r) => r.t > 0 && r.parts.some((x) => x != null)).sort((a, b) => b.t - a.t);
  const u = ms[0].u, tot = (t: number) => (u === 'bn' ? `${nf(t, 0)} מ״ד` : `${nf(t / 1000, 1)} מ״ד`);
  const build = (): EChartsCoreOption => {
    const pal = palette();
    return foxPeers({ cats: rows.map((r) => book.short(r.e) + (r.e === focus ? ' ◂' : '')), sub: rows.map((r) => tot(r.t)), stack: true, pct: true, dec: 0, max: 100, lead: rows.findIndex((r) => r.e === focus),
      series: ms.map((m, i) => ({ name: m.sh, color: pal[i % pal.length], data: rows.map((r) => (r.parts[i] == null ? null : +((r.parts[i]! / r.t) * 100).toFixed(2))) })) }) as EChartsCoreOption;
  };
  return (
    <section className="panel">
      <div className="hd"><h2>{title}</h2><div className="aside"><span>חלק כל מוצר מסך החברה, %</span></div></div>
      {rows.length < 2 ? <Empty title="אין מספיק נתונים" /> : <Chart label={title} height={Math.max(300, rows.length * 30 + 60)} deps={[keys.join(), ents.join(), focus, rows.length]} build={build} source="fox"
        onPoint={(si, di) => { const x = cells.get(keys[si])?.get(rows[di].e); if (x?.v != null) open(x.prov()); }} />}
      <div className="src">{src} · ◂ החברה במיקוד</div>
    </section>
  );
}

/* ---------- operations: the flow bridge, deposits − withdrawals + net transfers = net accumulation ---------- */
function Flows({ book, ents, cells, focus, mode, setMode, p }: { book: NonNullable<ReturnType<typeof useBook>['book']>; ents: string[]; cells: Map<string, Map<string, BVal>>; focus: string; mode: FMode; setMode: (m: FMode) => void; p: string }) {
  const { open } = useSource();
  const legs: [string, string, number][] = [['odep', 'הפקדות', 1], ['owd', 'משיכות ופדיונות', -1], ['otr', 'ניוד נטו', 1], ['onet', 'צבירה נטו', 1]];
  const val = (k: string, e: string) => cells.get(k)?.get(e)?.v ?? null;
  const rows = ents.filter((e) => val('odep', e) != null && val('onet', e) != null && (mode === 'bn' || (val('oflowa', e) ?? 0) > 0))
    .sort((a, b) => (mode === 'pct' ? (val('onet', b)! / val('oflowa', b)!) - (val('onet', a)! / val('oflowa', a)!) : val('onet', b)! - val('onet', a)!));
  const at = (k: string, sgn: number, e: string) => { const x = val(k, e); if (x == null) return null; const y = sgn * x; return mode === 'pct' ? +((y / val('oflowa', e)!) * 100).toFixed(2) : +y.toFixed(2); };
  const build = (): EChartsCoreOption => {
    const b = chartBase(), pal = palette(), col = [b.up, b.down, pal[2], b.accent];
    const cats = rows.map((e) => book.short(e) + (e === focus ? ' ◂' : ''));
    if (typeof window !== 'undefined' && window.innerWidth < 760) {
      // a phone: companies down the page, the four legs as thin horizontal bars (foxPeers would keep only the last series)
      const fmt = (v: number) => `${nf(v, 1)}${mode === 'pct' ? '%' : ''}`;
      return { textStyle: { fontFamily: CHART_FONT, color: b.fg }, animationDuration: 500,
        grid: { left: 4, right: 10, top: 30, bottom: 4, containLabel: true },
        legend: { top: 0, type: 'scroll', textStyle: { color: b.fg, fontSize: 11 }, itemWidth: 10, itemHeight: 10, icon: 'rect' },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, backgroundColor: b.panel, borderColor: b.ln, extraCssText: tooltipCss(), textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: (v: number) => fmt(v) },
        yAxis: { type: 'category', inverse: true, data: cats, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: b.fg, fontSize: 11.5 } },
        xAxis: { type: 'value', axisLabel: { color: b.mu, fontSize: 10 }, splitLine: { lineStyle: { color: b.ln2 } } },
        series: legs.map(([k, name, sgn], i) => ({ name, type: 'bar', barGap: '10%', barCategoryGap: '22%', itemStyle: { color: col[i] }, data: rows.map((e) => at(k, sgn, e)) })) } as EChartsCoreOption;
    }
    return foxPeers({ cats, dec: 1, pct: mode === 'pct', axis: true,
      series: legs.map(([k, name, sgn], i) => ({ name, color: col[i], data: rows.map((e) => at(k, sgn, e)) })) }) as EChartsCoreOption;
  };
  return (
    <section className="panel">
      <div className="hd"><h2>גשר הצבירה · {plab('LTM', p)}</h2><div className="aside"><Seg<FMode> label="יחידה" value={mode} onChange={setMode} options={[['bn', 'מיליארדי ש"ח'], ['pct', '% מהנכסים']]} /></div></div>
      {rows.length < 2 ? <Empty title="אין נתוני תזרים" /> : <Chart label="גשר הצבירה" height={Math.max(320, rows.length * (typeof window !== 'undefined' && window.innerWidth < 760 ? 92 : 34))} deps={[mode, ents.join(), focus, rows.length, p]} build={build} source="רשות שוק ההון · fox"
        onPoint={(si, di) => { const x = cells.get(legs[si][0])?.get(rows[di]); if (x?.v != null) open(x.prov()); }} />}
      <div className="src">הפקדות פחות משיכות ופדיונות ועוד ניוד נטו = צבירה נטו (LTM, כל המוצרים){mode === 'pct' ? ' · באחוזים מנכסי פנסיה וגמל בסוף התקופה (לפוליסות אין נתוני תזרים)' : ''} · משיכות כוללות קצבאות ותשלומי פרישה, לא רק ביטולים · ◂ החברה במיקוד</div>
    </section>
  );
}

/* ---------- export ---------- */
function describe(p: Prov): [string, string, string] {
  switch (p.k) {
    case 'report': return ['דוח', [p.doc, p.period, p.note].filter(Boolean).join(' · '), p.url ? (p.pg ? `${p.url}#page=${p.pg}` : p.url) : ''];
    case 'xbrl': return ['XBRL', `${p.company} · ${p.concept}`, p.rid ? mayaReport(p.rid) : ''];
    case 'calc': return ['מחושב', `${p.formula} | ${p.inputs.map((i) => `${i.label}: ${i.v}`).join(' ; ')}`, ''];
    case 'price': return ['TASE', `${p.ticker} · ${p.vendor} · ${p.date}`, ''];
    case 'none': return ['–', p.why, ''];
    default: return [p.k, '', ''];
  }
}
async function exportBoard(book: NonNullable<ReturnType<typeof useBook>['book']>, ms: BMetric[], order: string[], cells: Map<string, Map<string, BVal>>, stats: Map<string, Stat>, setName: string, p: string, asof: string, pOps: string) {
  const { downloadXlsx } = await import('../lib/xlsx');
  type XC = import('../lib/xlsx').XCell;
  const fmt = (m: BMetric) => (m.u === 'm' ? 'n0' : m.u === 'x' || m.u === 'bn' ? 'n2' : 'n1') as 'n0' | 'n1' | 'n2';
  const NAME = { mkt: 'המניה', biz: 'העסק', ops: 'הפעילות' } as const;
  const sheet = (sec: 'mkt' | 'biz' | 'ops') => {
    const mm = ms.filter((m) => m.sec === sec && !m.hide && order.some((e) => cells.get(m.key)?.get(e)?.v != null));
    const rows: XC[][] = [[{ v: `fox · השוואה ענפית · ${NAME[sec]}`, bold: true }], [`${setName} · נתונים כספיים ${plab('LTM', p)} · שוק: סגירה ${asof}${sec === 'ops' ? ` · רגולטור ${plab('LTM', pOps)}` : ''}`], [],
      [{ v: 'חברה', head: true }, ...mm.map((m) => ({ v: `${m.sh} (${unitB(m)})`, head: true }))]];
    order.forEach((e) => rows.push([book.name(e), ...mm.map((m) => { const x = cells.get(m.key)?.get(e); return x?.v == null ? null : { v: +x.v.toFixed(4), fmt: fmt(m) }; })]));
    rows.push([{ v: 'חציון', bold: true }, ...mm.map((m) => { const s = stats.get(m.key)!; return s.med == null ? null : { v: +s.med.toFixed(4), fmt: fmt(m), bold: true }; })]);
    rows.push([{ v: 'ממוצע', bold: true }, ...mm.map((m) => { const s = stats.get(m.key)!; return s.avg == null ? null : { v: +s.avg.toFixed(4), fmt: fmt(m), bold: true }; })]);
    return { name: NAME[sec], rows, freeze: { rows: 4, cols: 1 }, widths: [18, ...mm.map(() => 14)] };
  };
  const src: XC[][] = [['חברה', 'מדד', 'ערך', 'סוג מקור', 'מסמך / נוסחה ורכיבים', 'קישור'].map((v) => ({ v, head: true }))];
  ms.forEach((m) => order.forEach((e) => { const x = cells.get(m.key)?.get(e); if (x?.v == null) return; const [k, d, url] = describe(x.prov()); src.push([book.name(e), m.l, { v: +x.v.toFixed(4), fmt: fmt(m) }, k, d, url ? { v: url, link: url } : '']); }));
  downloadXlsx(`fox-comps-${p}`, [sheet('mkt'), sheet('biz'), sheet('ops'), { name: 'מקורות', rows: src, freeze: { rows: 1, cols: 0 }, widths: [14, 30, 12, 10, 80, 40] }]);
}
