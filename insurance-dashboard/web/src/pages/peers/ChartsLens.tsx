import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { Chart } from '../../components/Chart';
import { Empty, Pick, Seg } from '../../components/ui';
import { foxOption, foxPeers } from '../../lib/foxchart';
import { identify } from '../../lib/idmarks';
import { idColor } from '../../lib/identity';
import { nf, pubLabel } from '../../lib/format';
import { chartBase, CHART_FONT, palette, tooltipCss } from '../../lib/theme';
import { useSource } from '../../lib/prov';
import { isChg, qlab, readLabel, type QRead } from '../../lib/quarters';
import { BBY, boardRows, closeAt, defRead, fmtB, fmtRead, MBY, median, ols, quarterGrid, shOf, unitB, unitRead, type BMetric, type BoardOut, type BVal } from '../../lib/peerBoard';
import { colOf, ctxOf, type BoardData, type TCol } from './exportBoard';
import '../../styles/p6-lenses.css';

/* Lens גרפים of the peers board (spec p6 §3.2, §13.1 F5, §14.1 G1, §14.3 rules 5 and 8): the seven shipped charts, moved from PeersBoard.tsx
   and read through the board's engine. Line charts name each line once, in the right margin with a leader (foxchart endNamesOf / layoutEnds,
   drawn left to right); the ranking chart's median is a legend in its head; a missing segment is never drawn as zero; the history shows what
   the files hold and says where the series begins. Address keys: bx, by (scatter), bh, bs (history), bw (total return), bf (flows unit),
   bm (ranking: the board's metric and reading). */

type Win = '12' | '36' | '60';
type HWin = '12' | '24' | '40';
type FMode = 'bn' | 'pct';
const narrow = () => typeof window !== 'undefined' && window.innerWidth < 760;

export function ChartsLens({ d }: { d: BoardData }) {
  const cache = useMemo(() => new Map<string, BoardOut>(), [d]);
  const col = useMemo(() => { const m = new Map<string, TCol>(); return (k: string) => { let c = m.get(k); if (!c) { const mm = MBY.get(k) ?? BBY.get(k); if (!mm) return null; c = colOf(d, mm, cache); m.set(k, c); } return c; }; }, [d, cache]);
  const has = (k: string) => d.ms.some((m) => m.key === k);
  const g = d.get;
  return (
    <div className="p6-lens p6-charts" id="charts-lens">
      <div className="p6-ccol">
        <Scatter d={d} col={col} x={g('bx') ?? 'roe'} y={g('by') ?? (has('pb') ? 'pb' : 'pe')} />
        <History d={d} k={g('bh') ?? 'pb'} w={(g('bs') as HWin) ?? '12'} />
        <Bars d={d} />
      </div>
      <div className="p6-ccol">
        <Perf d={d} w={(g('bw') as Win) ?? '36'} />
        {has('odep') && <Flows d={d} col={col} mode={(g('bf') as FMode) ?? 'bn'} />}
        {(has('open') || has('ogem')) && <Mix d={d} col={col} id="mix-assets" title="תמהיל נכסים לפי מוצר" keys={['open', 'ogem', 'opol']} total="oaum"
          src={`רשות שוק ההון · סוף ${qlab(d.pOps || d.q)} · מתחת לשם: סך הנכסים`} />}
        {(has('rlife') || has('rpc')) && <Mix d={d} col={col} id="mix-rev" title="תמהיל הכנסות מביטוח לפי מגזר" keys={['rlife', 'rhealth', 'rpc']}
          src={`ביאור המגזרים, IFRS 17 · LTM לפי הדוח האחרון של כל חברה · מתחת לשם: סך ההכנסות מביטוח`} />}
      </div>
    </div>
  );
}
type ColFn = (k: string) => TCol | null;
const figOf = (c: TCol | null, e: string) => { const x = c?.cells.get(e); return x && !x.out && x.v != null && Number.isFinite(x.v) ? x : null; };

/* ---------- scatter: any two metrics, with the set's least-squares line ---------- */
function Scatter({ d, col, x, y }: { d: BoardData; col: ColFn; x: string; y: string }) {
  const { open } = useSource();
  const { book } = d;
  const opts = d.ms.filter((m) => !m.hide && m.u !== 'm' && m.u !== 'bn').map((m) => [m.key, m.sh] as [string, string]);
  const mx = MBY.get(x) && opts.some(([k]) => k === x) ? MBY.get(x)! : MBY.get('roe')!, my = MBY.get(y) && opts.some(([k]) => k === y) ? MBY.get(y)! : MBY.get('pb') ?? MBY.get('pe')!;
  const cx = col(mx.key), cy = col(my.key), cm = col('mcap');
  const pts = d.order.map((e) => ({ e, a: figOf(cx, e), b: figOf(cy, e), s: figOf(cm, e)?.v ?? null })).filter((q) => q.a && q.b);
  const fit = ols(pts.map((q) => [q.a!.v!, q.b!.v!]));
  const res = fit ? pts.map((q) => ({ e: q.e, r: q.b!.v! - (fit.a + fit.b * q.a!.v!), fy: fit.a + fit.b * q.a!.v! })) : [];
  const smax = Math.max(1, ...pts.map((q) => q.s ?? 0));
  const fx = (v: number) => cx?.fmt(v) ?? fmtB(mx, v), fy = (v: number) => cy?.fmt(v) ?? fmtB(my, v);
  const fDiff = (v: number) => fmtB({ ...my, u: my.u === 'pctx' ? 'pct' : my.u }, v);
  const build = (): EChartsCoreOption => {
    const b = chartBase();
    const xs = pts.map((q) => q.a!.v!), lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo) * 0.08 || 1;
    const ys = pts.map((q) => q.b!.v!), ylo = Math.min(...ys), yhi = Math.max(...ys), ypad = (yhi - ylo) * 0.18 || 0.5;
    // names: above the bubble unless that covers another bubble or name, then below, right, left (an estimate of the plot in pixels)
    const W = narrow() ? 300 : 520, H = (narrow() ? 300 : 340) - 90, X = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad || 1)) * W, Y = (v: number) => H - ((v - (ylo - ypad)) / (yhi - ylo + 2 * ypad || 1)) * H;
    const rad = (q: (typeof pts)[number]) => (12 + 26 * Math.sqrt((q.s ?? smax * 0.1) / smax)) / 2;
    const boxes: { x: number; y: number; w: number; h: number }[] = [], place: Record<string, string> = {};
    [...pts].sort((a, c) => (c.s ?? 0) - (a.s ?? 0)).forEach((q) => {
      const cx = X(q.a!.v!), cy = Y(q.b!.v!), r = rad(q), w = book.short(q.e).length * 7 + 6, h = 14;
      const cand: [string, number, number][] = [['top', cx, cy - r - 4 - h / 2], ['bottom', cx, cy + r + 4 + h / 2], ['right', cx + r + 4 + w / 2, cy], ['left', cx - r - 4 - w / 2, cy]];
      const hit = (bx: number, by: number) => boxes.some((o) => Math.abs(o.x - bx) < (o.w + w) / 2 && Math.abs(o.y - by) < (o.h + h) / 2)
        || pts.some((o) => { if (o === q) return false; const ox = X(o.a!.v!), oy = Y(o.b!.v!), orr = rad(o), dx = Math.max(Math.abs(ox - bx) - w / 2, 0), dy = Math.max(Math.abs(oy - by) - h / 2, 0); return dx * dx + dy * dy < orr * orr; })
        || by - h / 2 < -8 || bx - w / 2 < -20 || bx + w / 2 > W + 20;
      const c = cand.find(([, bx, by]) => !hit(bx, by)) ?? cand[0];
      place[q.e] = c[0]; boxes.push({ x: c[1], y: c[2], w, h });
    });
    return {
      textStyle: { fontFamily: CHART_FONT, color: b.fg }, animationDuration: 500,
      grid: { left: 8, right: 24, top: 36, bottom: 28, containLabel: true },
      tooltip: { trigger: 'item', confine: true, backgroundColor: b.panel, borderColor: b.ln, extraCssText: tooltipCss(), textStyle: { color: b.fg, fontSize: 12 },
        formatter: (p: { seriesIndex: number; dataIndex: number }) => { if (p.seriesIndex !== 0) return ''; const q = pts[p.dataIndex], r = res.find((z) => z.e === q.e);
          return `<b>${book.name(q.e)}</b><br/>${mx.sh}: ${fx(q.a!.v!)}${q.a!.stale ? '*' : ''}<br/>${my.sh}: ${fy(q.b!.v!)}${q.b!.stale ? '*' : ''}${r ? `<br/>מול הקו: ${r.r >= 0 ? '+' : '−'}${fDiff(Math.abs(r.r))}` : ''}`; } },
      xAxis: { type: 'value', name: mx.sh, nameLocation: 'middle', nameGap: 26, scale: true, min: +(lo - pad).toFixed(2), max: +(hi + pad).toFixed(2), axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln2 } }, nameTextStyle: { color: b.mu } },
      yAxis: { type: 'value', name: my.sh, scale: true, min: +(ylo - ypad).toFixed(3), max: +(yhi + ypad).toFixed(3), axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln2 } }, nameTextStyle: { color: b.mu } },
      series: [
        { type: 'scatter', labelLayout: { moveOverlap: 'shiftY', hideOverlap: false },
          data: pts.map((q) => ({ value: [q.a!.v!, q.b!.v!], symbolSize: 12 + 26 * Math.sqrt((q.s ?? smax * 0.1) / smax),
            itemStyle: { color: idColor(q.e), opacity: q.e === d.focus ? 1 : 0.78, borderColor: q.e === d.focus ? b.fg : b.panel, borderWidth: q.e === d.focus ? 2.5 : 1 },
            label: { show: true, formatter: book.short(q.e), position: place[q.e] ?? 'top', distance: 4, color: q.e === d.focus ? b.fg : b.mu, fontSize: q.e === d.focus ? 12.5 : 11, fontWeight: q.e === d.focus ? 600 : 400 } })) },
        ...(fit ? [{ type: 'line', data: [[lo - pad, fit.a + fit.b * (lo - pad)], [hi + pad, fit.a + fit.b * (hi + pad)]], symbol: 'none', silent: true, lineStyle: { color: b.mu, type: 'dashed', width: 1.2 } }] : []),
      ],
    };
  };
  const r = res.find((z) => z.e === d.focus);
  return (
    <section className="panel" id="scatter">
      <div className="hd"><h2>{my.sh} מול {mx.sh} <small className="p6-hsub">· גודל הבועה: שווי שוק</small></h2><div className="aside p6-ctl">
        <Pick label="ציר אנכי" cap="Y" value={my.key} onChange={(k) => d.put('by', k)} options={opts} /><Pick label="ציר אופקי" cap="X" value={mx.key} onChange={(k) => d.put('bx', k)} options={opts} /></div></div>
      {pts.length < 3 ? <Empty title="פחות משלוש חברות עם שני הנתונים" /> : <>
        <div className="p6-ch"><Chart label={`${my.sh} מול ${mx.sh}`} height={narrow() ? 300 : 340} deps={[mx.key, my.key, d.order.join(), d.focus, pts.length, d.q]} build={build} onPoint={(si, di) => { if (si === 0) open(pts[di].b!.val.prov()); }} source="דוחות החברות · TASE · fox" /></div>
        <p className="p6-note">{fit ? <>קו ריבועים פחותים של הקבוצה: {my.sh} = <span className="num">{nf(fit.a, 2)} {fit.b >= 0 ? '+' : '−'} {nf(Math.abs(fit.b), 3)}</span> × {mx.sh} · <span className="num">R² = {nf(fit.r2, 2)}</span> ({pts.length} חברות){fit.r2 < 0.3 ? ' · קשר חלש: לפרש בזהירות' : ''}.
          {r ? <> <b>{book.short(d.focus)}</b>: {r.r >= 0 ? 'מעל ה' : 'מתחת ל'}קו ב-<span className="num">{fDiff(Math.abs(r.r))}</span>{my.u === 'x' && r.fy > 0 ? <> (<span className="num">{nf(Math.abs(r.r / r.fy) * 100, 0)}%</span> מהערך המותאם)</> : ''}.</> : null}</> : 'אין מספיק פיזור לקו.'}
          {pts.some((q) => q.a!.stale || q.b!.stale) ? ' * נתון מהדוח הקודם (טרם דווח).' : ''} סטטיסטיקה תיאורית על קבוצה קטנה, לא המלצה.</p>
      </>}
    </section>
  );
}

/* ---------- multiples and ratios over time (quarter-end closes; the board's carry rule at its quarter) ---------- */
const HIST_KEYS = ['pb', 'pe', 'pbc', 'roe', 'csmeq', 'isrm', 'oshare', 'mcap', 'dy', 'maum', 'nm', 'onetr', 'owdr', 'ofee'];
function History({ d, k, w }: { d: BoardData; k: string; w: HWin }) {
  const { open } = useSource();
  const { book } = d;
  const hm = HIST_KEYS.map((x) => MBY.get(x)).filter((m): m is BMetric => !!m && d.ms.some((y) => y.key === m.key) && (m.type === 'spot' ? !!m.hist?.[d.major] : !!m.tok?.[d.major]));
  const m = hm.find((x) => x.key === k) ?? hm.find((x) => x.key === 'pb') ?? hm[0];
  const want = Number(w) || 12;
  const cx = ctxOf(d), rd: QRead = m?.type === 'spot' ? 'now' : m ? defRead(m) : 'ltm';
  // the board's grid, reached back as far as the files go: the newest quarter carries like the board (13.2 rule 1), the rest as reported
  const grid = useMemo(() => (m ? quarterGrid(cx, m, rd, want + 1).reverse() : []), [m?.key, rd, want, d]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null;
  const has = grid.map((r) => r.cells.some((c) => c.v != null));
  const lo = has.indexOf(true), rows = lo < 0 ? [] : grid.slice(lo, has.lastIndexOf(true) + 1);
  const short = lo > 0 || (lo === 0 && false);
  const xs = rows.map((r) => r.q);
  const ser = d.order.map((e) => ({ e, xs: rows.map((r) => r.cells.find((c) => c.e === e)!) })).filter((s) => s.xs.some((c) => c.v != null));
  const full = ser.length;
  const meds = rows.map((r) => { const v = r.cells.filter((c) => c.v != null && ser.some((s) => s.e === c.e)).map((c) => c.v!); return { v: v.length >= 2 ? median(v) : null, n: v.length }; });
  const pct = m.u === 'pct' || m.u === 'pctx';
  const fmtV = (v: number) => fmtRead(m, rd, v);
  const nStar = ser.filter((s) => s.xs[s.xs.length - 1]?.star).length;
  // the close rule (14.1): the grid's and the chart's quarter-end figure against the board's latest close, for the focus company
  const closeRule = (() => {
    if (m.type !== 'spot' || !xs.length) return null;
    const q = xs[xs.length - 1], cd = closeAt(d.mk, d.focus, q), gv = ser.find((s) => s.e === d.focus)?.xs[xs.length - 1]?.v;
    const bv = boardRows(cx, m, 'now').rows.find((r) => r.e === d.focus)?.v;
    if (gv == null || bv == null || !cd) return null;
    return `בגרף: שווי השוק בסגירת סוף כל רבעון (${qlab(q)}: ${pubLabel(cd)}) ÷ הנתון המדווח. בלוח: הסגירה האחרונה, ${pubLabel(d.pxAsof)}. לכן ${book.short(d.focus)}: ${fmtV(gv)} בגרף ל-${qlab(q)}, ${fmtV(bv)} בלוח.`;
  })();
  const startNote = rows.length && rows.length < want + 1 ? `הרצף בקובץ מתחיל ב-${qlab(rows[0].q)}: מוצגים ${rows.length} רבעונים${lo < 0 ? '' : ''}.` : '';
  void short;
  const build = (): EChartsCoreOption => {
    const b = chartBase();
    const medFull = meds.map((x) => (x.v != null && x.n === full ? +x.v.toFixed(4) : null));
    // the median over fewer than all the companies: dotted, and only where at least two have a figure (spec 4 rule 5)
    const medPart = meds.map((x, i) => (x.v != null && (x.n < full || (i > 0 && meds[i - 1].n < full) || (i < meds.length - 1 && meds[i + 1].n < full)) ? +x.v.toFixed(4) : null));
    const anyPart = meds.some((x) => x.v != null && x.n < full);
    const o = foxOption({ x: xs.map((q) => qlab(q)), unit: unitB(m), legend: false, labels: false, scale: true,
      series: [...ser.map((s) => ({ name: book.short(s.e), kind: 'line' as const, color: idColor(s.e), pct, lead: s.e === d.focus, dim: s.e !== d.focus, dec: m.dec, data: s.xs.map((c) => (c.v == null ? null : +c.v.toFixed(4))) })),
        { name: 'חציון', kind: 'line' as const, color: b.fg, dashed: true, pct, dec: m.dec, data: medFull },
        ...(anyPart ? [{ name: `חציון (חלקי)`, kind: 'line' as const, color: b.mu, dashed: true, pct, dec: m.dec, data: medPart }] : [])] }) as EChartsCoreOption & { series: Record<string, unknown>[]; tooltip: Record<string, unknown> };
    // a company read on its latest figures at the last quarter: a hollow point
    ser.forEach((s, i) => { const c = s.xs[s.xs.length - 1], dd = o.series[i]?.data as unknown[] | undefined; if (c?.star && c.v != null && dd) dd[dd.length - 1] = { value: +c.v.toFixed(4), symbol: 'emptyCircle', symbolSize: 9 }; });
    if (anyPart) { const ps = o.series[ser.length + 1]; ps.lineStyle = { ...(ps.lineStyle as object), type: 'dotted', width: 1.4 }; ps.symbol = 'none'; }
    // the tooltip names the median's n
    o.tooltip.formatter = (ps: { axisValueLabel: string; dataIndex: number; marker: string; seriesName: string; seriesIndex: number; value: unknown }[]) => {
      const i = ps[0]?.dataIndex ?? 0, rowsT = ps.filter((p) => p.seriesIndex < ser.length).map((p) => { const c = ser[p.seriesIndex].xs[i]; return c?.v == null ? '' : `${p.marker} ${p.seriesName}: <b>${fmtV(c.v)}${c.star ? '*' : ''}</b><br>`; }).join('');
      const md = meds[i];
      return `<b>${ps[0]?.axisValueLabel ?? ''}</b><br>${rowsT}${md?.v != null ? `חציון על ${md.n} חברות: <b>${fmtV(md.v)}</b>` : ''}`;
    };
    const out = identify(o, { height: 340 }) as EChartsCoreOption & { series: Record<string, unknown>[] };
    if (anyPart) out.series[ser.length + 1].endLabel = { show: false };
    for (let i = ser.length; i < out.series.length; i++) { out.series[i].symbol = 'none'; out.series[i].showSymbol = false; }
    return out;
  };
  return (
    <section className="panel" id="hist" data-points={xs.length}>
      <div className="hd"><h2>{shOf(m)} לאורך זמן <small className="p6-hsub">· {m.type === 'spot' ? 'סגירת סוף רבעון ÷ נתון מדווח' : `${unitRead(m, rd)}${rd === 'ltm' ? ' · LTM' : ''}`}</small></h2><div className="aside p6-ctl">
        <Pick label="מדד" cap="מדד" value={m.key} onChange={(x) => d.put('bh', x)} options={hm.map((x) => [x.key, shOf(x)] as [string, string])} />
        <Seg<HWin> label="טווח" value={w} onChange={(x) => d.put('bs', x === '12' ? null : x)} options={[['12', '3Y'], ['24', '6Y'], ['40', '10Y']]} /></div></div>
      {xs.length < 2 ? <Empty title="אין רצף למדד ולטווח" /> : (
        <div className="p6-ch"><Chart label={`${shOf(m)} לאורך זמן`} height={340} deps={[m.key, w, d.order.join(), d.focus, d.q, d.book.files.size]} source="דוחות החברות · TASE (סגירה ביום המסחר האחרון ברבעון) · fox"
          onPoint={(si, di) => { const c = ser[si]?.xs[di]; if (c && c.v != null) open(c.val.prov()); }} build={build} /></div>
      )}
      <p className="p6-note">{m.type === 'spot' ? 'מכפיל בסוף כל רבעון: שווי שוק ביום המסחר האחרון ברבעון ÷ הנתון המדווח לאותו רבעון (רווח: LTM).' : `${m.l}, כפי שדווח לסוף כל רבעון.`} קו מקווקו: חציון{meds.some((x) => x.v != null && x.n < full) ? <>; מנוקד ברבעונים שבהם לא לכל {full} החברות יש נתון (מספרן בחלונית)</> : <> של כל {full} החברות</>}.
        {nStar > 0 && <> ב-{qlab(xs[xs.length - 1])}, <span className="num">{nStar}</span> חברות שטרם דיווחו נקראות על הנתון האחרון שדיווחו (נקודה חלולה{m.type === 'spot' ? '; שווי השוק של סוף הרבעון ÷ המכנה האחרון' : ''}), כמו בלוח, ונספרות בחציון.</>}
        {startNote && <> {startNote}</>}
        {closeRule && <><br />{closeRule}</>}</p>
    </section>
  );
}

/* ---------- ranked bars: the board's metric and reading ---------- */
function Bars({ d }: { d: BoardData }) {
  const { open } = useSource();
  const { book } = d;
  const m = BBY.get(d.bm) ?? MBY.get('pe')!;
  const b = useMemo(() => boardRows(ctxOf(d), m, d.rd), [d, m]);
  const rows = b.rows.filter((r) => !r.out && r.v != null && Number.isFinite(r.v));
  const rd = b.rd, f = (v: number) => fmtRead(m, rd, v);
  const opts = useMemo(() => { const seen = new Set<string>(); return d.ms.filter((x) => !x.hide && x.reads?.length && !x.of).map((x) => [x.key, shOf(x)] as [string, string]).filter(([k]) => !seen.has(k) && seen.add(k)); }, [d.ms]);
  const pct = !isChg(rd) && (m.u === 'pct' || m.u === 'pctx');
  const build = (): EChartsCoreOption => {
    const o = foxPeers({ cats: rows.map((r) => `${book.short(r.e)}${r.stale ? '*' : ''}`), sub: rows.map((r) => (r.stale || r.per ? qlab(r.per ?? r.q) : null)), series: [{ name: shOf(m), data: rows.map((r) => +r.v!.toFixed(4)) }],
      lead: rows.findIndex((r) => r.e === d.focus), dec: m.dec, pct, signed: true, axis: false }) as { series: Record<string, unknown>[]; tooltip: Record<string, unknown>; xAxis: Record<string, unknown>; yAxis: Record<string, unknown> };
    const bb = chartBase();
    const s0 = o.series[0];
    if (s0) {
      s0.label = { ...(s0.label as object), show: true, formatter: (p: { value: number | null }) => (p.value == null ? '' : f(p.value).replace(' נק׳', '')) };
      if (b.med.v != null) s0.markLine = { silent: true, symbol: 'none', lineStyle: { color: bb.fg, type: 'dashed', opacity: 0.7, width: 1.5 }, label: { show: false }, data: [narrow() ? { xAxis: b.med.v } : { yAxis: b.med.v }] };
    }
    o.tooltip.valueFormatter = (v: number) => f(v);
    // the sub line under a name is a tag (the quarter of a carried figure), not a signed figure: neutral colour
    const ax = (narrow() ? o.yAxis : o.xAxis) as { axisLabel?: { rich?: Record<string, Record<string, unknown>> } };
    if (ax.axisLabel?.rich) { ax.axisLabel.rich.u = { ...ax.axisLabel.rich.u, color: bb.mu }; ax.axisLabel.rich.d = { ...ax.axisLabel.rich.d, color: bb.mu }; }
    return o as EChartsCoreOption;
  };
  return (
    <section className="panel" id="bars">
      <div className="hd p6-barshd"><h2>דירוג · {shOf(m)}{isChg(rd) || rd === 'q' ? ` ${readLabel(rd, b.q)}` : ''} <small className="p6-hsub">· {unitRead(m, rd)}</small></h2>
        {b.med.v != null && <span className="p6-medleg" id="bars-medlabel"><i aria-hidden="true" />חציון <span className="num">{f(b.med.v)}</span> · {b.med.n} {b.strict ? `שדיווחו ${qlab(b.q)}` : 'חברות'}</span>}
        <div className="aside p6-ctl"><Pick label="מדד לדירוג" cap="מדד" value={m.key} onChange={(k) => { d.put('bm', k); d.put('rd', null); }} options={opts.some(([k]) => k === m.key) ? opts : [[m.key, shOf(m)], ...opts]} /></div></div>
      {rows.length < 2 ? <Empty title="אין מספיק חברות עם נתון" /> : <div className="p6-ch"><Chart label={`דירוג ${shOf(m)}`} height={narrow() ? Math.max(240, rows.length * 34 + 20) : 300} deps={[m.key, rd, d.order.join(), d.focus, rows.length, d.q]} build={build}
        onPoint={(_, di) => open(rows[di].val.prov())} source="דוחות החברות · TASE · fox" /></div>}
      <p className="p6-note">המדד והקריאה שנבחרו בלוח{isChg(rd) ? ` · ${b.q ? `${qlab(b.q)}` : ''}` : ''} · מודגש: {book.short(d.focus)} · קו מקווקו: חציון{rows.some((r) => r.stale) ? ' · * נתון מהדוח הקודם (הרבעון שלו מתחת לשם), נספר' : ''}{b.rows.some((r) => r.out) ? ` · לא בדירוג: ${b.rows.filter((r) => r.out).map((r) => book.short(r.e)).join(', ')} (הדוח ל-${qlab(b.q)} טרם פורסם)` : ''}{m.note ? ` · ${m.note}` : ''}</p>
    </section>
  );
}

/* ---------- total return, rebased to 100 ---------- */
function Perf({ d, w }: { d: BoardData; w: Win }) {
  const { book, mk } = d;
  const have = d.order.filter((e) => mk?.ents[e]?.w.length);
  const last = have.map((e) => mk!.ents[e].last).sort().pop() ?? '';
  const from = last ? (() => { const x = new Date(`${last}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() - Number(w)); return x.toISOString().slice(0, 10); })() : '';
  // a common weekly axis: the weeks of the longest-listed company; each series is read on or before each week and starts at 100 on its first point
  const axisEnt = [...have].sort((x, y) => mk!.ents[x].first.localeCompare(mk!.ents[y].first) || (x === d.focus ? -1 : y === d.focus ? 1 : 0))[0];
  const ax = axisEnt ? mk!.ents[axisEnt].w.filter(([dd]) => dd >= from).map(([dd]) => dd) : [];
  const series = have.map((e) => {
    const ws = mk!.ents[e].w; let j = 0; let base: number | null = null;
    return { e, data: ax.map((dd) => { while (j + 1 < ws.length && ws[j + 1][0] <= dd) j++; if (ws[j][0] > dd) return null; const tr = ws[j][2]; if (base == null) base = tr; return +(tr / base * 100).toFixed(2); }) };
  });
  const late = series.filter((s) => s.data[0] == null && s.data.some((v) => v != null)).map((s) => `${book.short(s.e)} מ-${pubLabel(ax[s.data.findIndex((v) => v != null)])}`);
  const lab = w === '12' ? '1Y' : w === '36' ? '3Y' : '5Y';
  return (
    <section className="panel" id="perf" data-points={ax.length}>
      <div className="hd"><h2>תשואה כוללת · בסיס 100</h2><div className="aside p6-ctl"><Seg<Win> label="טווח" value={w} onChange={(x) => d.put('bw', x === '36' ? null : x)} options={[['12', '1Y'], ['36', '3Y'], ['60', '5Y']]} /></div></div>
      {ax.length < 4 ? <Empty title="אין היסטוריית מחירים" /> : (
        <div className="p6-ch"><Chart label={`תשואה כוללת ${lab}`} height={340} deps={[w, d.order.join(), d.focus, mk?.asof]} source={`TASE · שערי סגירה שבועיים, דיבידנד מושקע מחדש · עד ${pubLabel(last)}`}
          build={() => identify(foxOption({ x: ax.map((x) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(2, 4)}`), unit: 'מדד, 100 בתחילת הטווח', legend: false, labels: false, scale: true, dense: true,
            series: series.map((s) => ({ name: book.short(s.e), kind: 'line' as const, color: idColor(s.e), lead: s.e === d.focus, dim: s.e !== d.focus, dec: 0, data: s.data })) }), { height: 340 })} /></div>
      )}
      <p className="p6-note">TASE · שערי סגירה שבועיים, דיבידנד מושקע מחדש בשער הסגירה ביום האקס · כל חברה מתחילה ב-100 בתחילת הטווח{late.length ? ` (או בהנפקה: ${late.join(', ')})` : ''} · עד {pubLabel(last)}. לפי מדיניות האתר, מחיר הוא קלט להשוואה ולא כותרת.</p>
    </section>
  );
}

/* ---------- operations: a mix per company (assets by product, insurance revenue by segment) ---------- */
function Mix({ d, col, id, title, keys, total, src }: { d: BoardData; col: ColFn; id: string; title: string; keys: string[]; total?: string; src: string }) {
  const { open } = useSource();
  const { book } = d;
  const ms = keys.map((k) => MBY.get(k)!), cs = keys.map((k) => col(k)), ct = total ? col(total) : null;
  // a mix is drawn only from figures of one period, and only when its parts are whole: without a printed total every part must be there;
  // with one, the parts that are there must make the total (a group without a product holds none). A missing segment is never a zero.
  const all = d.order.map((e) => {
    const xs = cs.map((c) => figOf(c, e)), parts = xs.map((x) => x?.v ?? null), tx = ct ? figOf(ct, e) : null;
    const sum = parts.reduce<number>((a, x) => a + (x ?? 0), 0);
    const t = tx?.v ?? (parts.every((x) => x != null) ? sum : null);
    const miss = keys.flatMap((_, i) => (parts[i] == null ? [ms[i].sh] : []));
    const pers = new Set([...xs, tx].filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.q ?? ''));
    const whole = t != null && t > 0 && (miss.length === 0 || (tx != null && Math.abs(sum - t) <= Math.abs(t) * 0.005));
    const why = !parts.some((x) => x != null) ? null : !whole ? `חסר מגזר בנתונים (${miss.join(', ')}): התמהיל אינו מוצג` : pers.size > 1 ? 'הרכיבים מתקופות שונות: התמהיל אינו מוצג' : null;
    return { e, xs, parts, t: t ?? 0, why, stale: [...xs, tx].some((x) => x?.stale), q: tx?.q ?? xs.find((x) => x)?.q ?? null };
  }).filter((r) => r.parts.some((x) => x != null));
  const rows = [...all].sort((a, b) => (a.why ? 1 : 0) - (b.why ? 1 : 0) || b.t - a.t);
  const u = ms[0].u, tot = (t: number) => (u === 'bn' ? `${nf(t, 1)} מ״ד` : `${nf(t / 1000, 1)} מ״ד`);
  const shown = rows.filter((r) => !r.why);
  const build = (): EChartsCoreOption => {
    const pal = palette();
    const o = foxPeers({ cats: rows.map((r) => book.short(r.e) + (r.stale ? '*' : '') + (r.e === d.focus ? ' ◂' : '')), sub: rows.map((r) => (r.why ? 'חסר מגזר' : `${tot(r.t)}${r.stale && r.q ? ` · ${qlab(r.q)}` : ''}`)), stack: true, pct: true, dec: 0, max: 100, lead: rows.findIndex((r) => r.e === d.focus),
      series: ms.map((m, i) => ({ name: m.sh, color: pal[i % pal.length], data: rows.map((r) => (r.why || r.parts[i] == null ? null : +((r.parts[i]! / r.t) * 100).toFixed(2))) })) }) as { series: Record<string, unknown>[]; xAxis: Record<string, unknown>; yAxis: Record<string, unknown> };
    // white figures inside the segments: no halo; the line under a name is a total or a tag, not a signed change: neutral
    o.series.forEach((x) => { x.label = { ...(x.label as object), textBorderWidth: 0 }; });
    const mu = chartBase().mu, ax = (narrow() ? o.yAxis : o.xAxis) as { axisLabel?: { rich?: Record<string, Record<string, unknown>> } };
    if (ax.axisLabel?.rich) { ax.axisLabel.rich.u = { ...ax.axisLabel.rich.u, color: mu }; ax.axisLabel.rich.d = { ...ax.axisLabel.rich.d, color: mu }; }
    return o as EChartsCoreOption;
  };
  const out = rows.filter((r) => r.why);
  // a company whose printed total is made by the parts it has: it holds none of the others (said, so a full bar is not read as a gap)
  const none = rows.filter((r) => !r.why && r.parts.some((x) => x == null)).map((r) => `${book.short(r.e)}: אין ${keys.flatMap((_, i) => (r.parts[i] == null ? [ms[i].sh] : [])).join(', ')} (סך הנכסים = הרכיבים שיש)`);
  return (
    <section className="panel" id={id}>
      <div className="hd p6-mixhd"><h2>{title}{cs[0]?.q ? <small className="p6-hsub"> · {id === 'mix-rev' ? 'LTM' : `סוף ${qlab(cs[0].q)}`}</small> : null}</h2><span className="p6-hsub">חלק כל {id === 'mix-rev' ? 'מגזר' : 'מוצר'} מסך החברה, %</span></div>
      {shown.length < 2 ? <Empty title="אין מספיק נתונים" /> : <div className="p6-ch"><Chart label={title} height={Math.max(narrow() ? 260 : 300, rows.length * (narrow() ? 38 : 30) + 70)} deps={[keys.join(), d.order.join(), d.focus, rows.length, d.q]} build={build} source="fox"
        onPoint={(si, di) => { const x = rows[di]?.xs[si]; if (x) open(x.val.prov()); }} /></div>}
      <p className="p6-note">{src} · ◂ {book.short(d.focus)}{rows.some((r) => r.stale && !r.why) ? ' · * נתון מהרבעון הקודם (טרם דווח)' : ''}{none.length > 0 && <> · {none.join(' · ')}</>}{out.length > 0 && <> · {out.map((r) => `${book.short(r.e)}: ${r.why}`).join(' · ')}</>}</p>
    </section>
  );
}

/* ---------- operations: the flow bridge, deposits − withdrawals + net transfers = net accumulation ---------- */
function Flows({ d, col, mode }: { d: BoardData; col: ColFn; mode: FMode }) {
  const { open } = useSource();
  const { book } = d;
  const legs: [string, string, number][] = [['odep', 'הפקדות', 1], ['owd', 'משיכות ופדיונות', -1], ['otr', 'ניוד נטו', 1], ['onet', 'צבירה נטו', 1]];
  const c = (k: string) => col(k);
  const fig = (k: string, e: string): BVal | null => figOf(c(k), e)?.val ?? null;
  const val = (k: string, e: string) => figOf(c(k), e)?.v ?? null;
  const rows = d.order.filter((e) => val('odep', e) != null && val('onet', e) != null && (mode === 'bn' || (val('oflowa', e) ?? 0) > 0))
    .sort((a, b) => (mode === 'pct' ? (val('onet', b)! / val('oflowa', b)!) - (val('onet', a)! / val('oflowa', a)!) : val('onet', b)! - val('onet', a)!));
  const at = (k: string, sgn: number, e: string) => { const x = val(k, e); if (x == null) return null; const y = sgn * x; return mode === 'pct' ? +((y / val('oflowa', e)!) * 100).toFixed(2) : +y.toFixed(2); };
  const q = c('onet')?.q ?? d.pOps;
  const fmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), 1)}${mode === 'pct' ? '%' : ''}`;
  const build = (): EChartsCoreOption => {
    const b = chartBase(), pal = palette(), colr = [b.up, b.down, pal[2], b.accent];
    const cats = rows.map((e) => book.short(e) + (e === d.focus ? ' ◂' : ''));
    const lab = (v: number | null, horiz: boolean) => ({ show: true, position: horiz ? (v != null && v < 0 ? 'left' : 'right') : (v != null && v < 0 ? 'bottom' : 'top'), color: b.fg, fontSize: horiz ? 11 : 10, distance: 3, formatter: () => (v == null ? '' : fmt(v)) });
    if (narrow()) {
      // a phone: companies down the page, the four legs as thin horizontal bars with their figures printed (foxPeers would keep only the last series)
      return { textStyle: { fontFamily: CHART_FONT, color: b.fg }, animationDuration: 500,
        grid: { left: 4, right: 12, top: 30, bottom: 4, containLabel: true },
        legend: { top: 0, type: 'scroll', textStyle: { color: b.fg, fontSize: 11 }, itemWidth: 10, itemHeight: 10, icon: 'rect' },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, backgroundColor: b.panel, borderColor: b.ln, extraCssText: tooltipCss(), textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: (v: number) => fmt(v) },
        yAxis: { type: 'category', inverse: true, data: cats, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: b.fg, fontSize: 11.5 } },
        xAxis: { type: 'value', axisLabel: { color: b.mu, fontSize: 10 }, splitLine: { lineStyle: { color: b.ln2 } } },
        series: legs.map(([k, name, sgn], i) => ({ name, type: 'bar', barGap: '10%', barCategoryGap: '22%', itemStyle: { color: colr[i] },
          data: rows.map((e) => { const v = at(k, sgn, e); return { value: v, label: lab(v, true) }; }) })) } as EChartsCoreOption;
    }
    const o = foxPeers({ cats, dec: 1, pct: mode === 'pct', axis: true, series: legs.map(([k, name, sgn], i) => ({ name, color: colr[i], data: rows.map((e) => at(k, sgn, e)) })) }) as { series: Record<string, unknown>[]; tooltip: Record<string, unknown> };
    o.series.forEach((s, i) => { const [k, , sgn] = legs[i]; s.data = rows.map((e) => { const v = at(k, sgn, e); return v == null ? null : { value: v, itemStyle: { color: colr[i] }, label: lab(v, false) }; }); });
    o.tooltip.valueFormatter = (v: number) => fmt(v);
    return o as EChartsCoreOption;
  };
  return (
    <section className="panel" id="flows">
      <div className="hd"><h2>גשר הצבירה · LTM {qlab(q)}</h2><div className="aside p6-ctl"><Seg<FMode> label="יחידה" value={mode} onChange={(x) => d.put('bf', x === 'bn' ? null : x)} options={[['bn', 'מ׳ד ש"ח'], ['pct', '% מהנכסים']]} /></div></div>
      {rows.length < 2 ? <Empty title="אין נתוני תזרים" /> : <div className="p6-ch"><Chart label="גשר הצבירה" height={Math.max(320, rows.length * (narrow() ? 104 : 40))} deps={[mode, d.order.join(), d.focus, rows.length, q]} build={build} source="רשות שוק ההון · fox"
        onPoint={(si, di) => { const x = fig(legs[si][0], rows[di]); if (x) open(x.prov()); }} /></div>}
      <p className="p6-note">הפקדות פחות משיכות ופדיונות ועוד ניוד נטו = צבירה נטו (LTM, כל המוצרים){mode === 'pct' ? ' · באחוזים מנכסי פנסיה וגמל בסוף התקופה (לפוליסות אין נתוני תזרים)' : ' · מיליארדי ש"ח'} · משיכות כוללות קצבאות ותשלומי פרישה, לא רק ביטולים · ◂ {book.short(d.focus)} · רשות שוק ההון.</p>
    </section>
  );
}
