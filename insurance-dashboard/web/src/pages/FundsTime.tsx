import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { ECharts } from 'echarts/core';
import { BasisToggle, CompareAdd, FundsHead } from '../components/FundsNav';
import { CatPicker, Lede, TimeNav, WatchStar, monthsIn, pctChartOption, rankProv } from '../components/FundsTime';
import { MgrChip, IdDot } from '../components/MgrChip';
import { Sourced } from '../components/Source';
import { Chart } from '../components/Chart';
import { DataTable } from '../components/DataTable';
import { Tip } from '../components/Explain';
import { Empty, ErrorBox, Loading, Panel, Pick, Seg } from '../components/ui';
import { useFunds } from '../lib/useData';
import { useSource, type Prov } from '../lib/prov';
import { useTheme, chartBase, tooltipCss, CHART_FONT } from '../lib/theme';
import { polish } from '../lib/foxchart';
import { GROUP_ID, idColor, idCss } from '../lib/identity';
import { nf, sn } from '../lib/format';
import { expP, fundP } from '../lib/market';
import { NET_LABEL, NET_NOTE, netProv, pc, refOf, retOf, selfDirected, useBasis, useTray, type Basis, type FundX, type FundsFile, type Per } from '../lib/funds';
import { BANDS, backM, frameMonths, frameOf, frontier, median, persistVerdict, pickSet, quilt, rankSeries, rowShares, stepDown, ymL, type Band, type Frame, type PersistTest, type QuiltCell, type RankMetric } from '../lib/fundsTime';
import { membersOf, useBranch, useCat, useCatFiles, useClosed, useGlide, useHists, usePersist, yOf } from '../lib/fundsTimeLoad';
import '../styles/lens.css';
import '../styles/market.css';
import '../styles/funds-time.css';

/* F2 TIME, the views of the section's "סיכון וזמן" tab: the risk/return map with its year-by-year animation (#10), peer rank over time
   by category (#11), the calendar quilt (#13), the persistence test (#12, the view of the DATA build's file) and the age-track glide paths
   (#15). Net of fee by default; closed tracks are in every historical view (survivorship); every number opens its source. */

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const useFile = () => { const { data, error } = useFunds(); return { data: data as FundsFile | undefined, error }; };
const basisLbl = (b: Basis) => (b === 'net' ? NET_LABEL : 'ברוטו');
const grpId = (g: string) => GROUP_ID[g] ?? '';

/* ======================================================================================== the map (#10) */
type Axis = 'vol' | 'dd' | 'st';
const AXES: [Axis, string][] = [['vol', 'תנודתיות'], ['dd', 'ירידה מרבית'], ['st', 'חשיפה למניות']];
const AXIS_NAME: Record<Axis, string> = { vol: 'תנודתיות שנתית, %', dd: 'ירידה מרבית בחלון, % (בערך מוחלט)', st: 'חשיפה למניות, % מהנכסים' };
const WINS: ['12' | '36' | '60', string][] = [['12', '1Y'], ['36', '3Y'], ['60', '5Y']];
const riskX = (p: Frame, x: Axis) => (x === 'vol' ? p.vol : x === 'dd' ? -p.dd : p.st);

export function FundsMap() {
  const { data, error } = useFile();
  const [cat, setCat] = useCat();
  const [sp, setSp] = useSearchParams();
  const w = (['12', '36', '60'].includes(sp.get('w') ?? '') ? sp.get('w') : '36') as '12' | '36' | '60';
  const x = (['vol', 'dd', 'st'].includes(sp.get('x') ?? '') ? sp.get('x') : 'vol') as Axis;
  const setQ = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }); };
  const [b] = useBasis();
  const [tap, setTap] = useState<'open' | 'cmp'>('open');
  const [fixed, setFixed] = useState(false);
  const [br, setBr] = useBranch();
  const nav = useNavigate();
  const tray = useTray();
  const closed = useClosed(true);
  const mem = useMemo(() => (data && closed ? membersOf(data.funds, closed, cat, br) : []), [data, closed, cat, br]);
  const hs = useHists(mem.map((f) => f.k));
  const n = Number(w), asof = data?.asof ?? 0;
  const ready = !!data && !!closed && mem.length > 0 && hs.pending === 0;
  const live = mem.filter((f) => hs.h[f.k]);
  const frames = useMemo(() => {
    if (!ready) return [] as number[];
    const firsts = live.map((f) => { const h = hs.h[f.k], y = yOf(h, b); return h.p.find((_, i) => y[i] != null) ?? 999999; });
    return frameMonths(firsts, asof, n);
  }, [ready, live.length, b, asof, n]);  // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => frames.map((e) => live.map((f) => (f.gone && f.end != null && e > f.end ? null : frameOf(f.k, hs.h[f.k], yOf(hs.h[f.k], b), e, n)))), [frames, b, n]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [fi, setFi] = useState(-1);
  const at = fi < 0 || fi >= frames.length ? frames.length - 1 : fi;
  useEffect(() => { setFi(-1); }, [cat, w, b, br]);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (at >= frames.length - 1) { setPlaying(false); return; }
    const id = setTimeout(() => setFi(at + 1), reducedMotion() ? 1800 : 1100);
    return () => clearTimeout(id);
  }, [playing, at, frames.length]);

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  const pts = (all[at] ?? []).map((p, i) => (p ? { p, f: live[i] } : null)).filter((z): z is { p: Frame; f: FundX } => !!z && riskX(z.p, x) != null);
  const end = frames[at];
  const medX = median(pts.map((z) => riskX(z.p, x)!)), medY = median(pts.map((z) => z.p.ret));
  const winLbl = WINS.find(([k]) => k === w)![1];
  const retLbl = n > 12 ? `תשואה שנתית ממוצעת, ${winLbl}` : `תשואה ${winLbl}`;
  const retProv = (z: { p: Frame; f: FundX }): Prov => ({ k: 'calc', est: b === 'net', title: `${retLbl}${b === 'net' ? ', נטו' : ''} · ${z.f.name} · עד ${ymL(z.p.months[z.p.months.length - 1])}`, value: pc(z.p.ret),
    formula: n > 12 ? '(1 + r₁) × … × (1 + rₙ) בחזקת 12 ÷ n, פחות 1, על התשואות החודשיות של החלון' : '(1 + r₁) × … × (1 + r₁₂) − 1', note: b === 'net' ? NET_NOTE : undefined, inputs: monthsIn(refOf(z.f), hs.h[z.f.k], z.p.months, b) });
  const riskProv = (z: { p: Frame; f: FundX }): Prov => {
    const e = z.p.months[z.p.months.length - 1];
    if (x === 'st') return expP(refOf(z.f), e, 'STOCK_MARKET_EXPOSURE', 'חשיפה למניות', z.p.st, z.p.a);
    return { k: 'calc', est: b === 'net', title: `${x === 'vol' ? 'תנודתיות שנתית' : 'ירידה מרבית'}, ${winLbl} · ${z.f.name} · עד ${ymL(e)}`, value: x === 'vol' ? nf(z.p.vol, 2) + '%' : pc(z.p.dd),
      formula: x === 'vol' ? 'סטיית התקן של התשואות החודשיות בחלון (n − 1) כפול שורש 12' : 'הירידה הגדולה ביותר של מדד התשואה המצטברת משיא לשפל בתוך החלון', inputs: monthsIn(refOf(z.f), hs.h[z.f.k], z.p.months, b) };
  };
  const aProv = (z: { p: Frame; f: FundX }): Prov => fundP(refOf(z.f), z.p.months[z.p.months.length - 1], 'TOTAL_ASSETS', 'נכסים', z.p.a == null ? '–' : nf(z.p.a, 1), 'מיליוני ש"ח');
  const medProv = (axis: 'x' | 'y', v: number | null): Prov => ({ k: 'calc', title: `חציון ${axis === 'x' ? AXIS_NAME[x] : retLbl} · ${cat} · ${end ? ymL(end) : ''}`, value: v == null ? '–' : nf(v, 2) + '%', formula: 'החציון על פני המסלולים שבמפה בחודש הזה',
    inputs: pts.map((z) => ({ label: z.f.name, v: nf(axis === 'x' ? riskX(z.p, x)! : z.p.ret, 2) + '%', src: () => (axis === 'x' ? riskProv(z) : retProv(z)) })) });
  const gone = pts.filter((z) => z.f.gone).length;

  return (
    <>
      <FundsHead title="סיכון וזמן" sub={<>מפת סיכון ותשואה · {cat}{data ? <> · <span className="num">{ymL(asof)}</span></> : null}</>} tools={<><CatPicker fs={data?.funds ?? []} cat={cat} onChange={setCat} /><BasisToggle real={false} /></>} />
      <TimeNav />
      <Panel title={<>כל מסלול בקטגוריה: תשואה מול סיכון <Tip k="map" /></>} aside={<><Seg label="חלון" value={w} onChange={(v) => setQ('w', v)} options={WINS} /><Seg label="ציר הסיכון" value={x} onChange={(v) => setQ('x', v)} options={AXES} /><button type="button" className="chip" aria-pressed={br} onClick={() => setBr(!br)} title="קופות של ארגון או מפעל, שאינן פתוחות לכל הציבור">קופות ענפיות</button><span className={`chip${b === 'net' ? ' est' : ''}`}>{basisLbl(b)}</span></>}>
        {!ready ? <Loading what={mem.length ? `${mem.length - hs.pending} מתוך ${mem.length} מסלולים` : 'המסלולים'} /> : frames.length === 0 || !pts.length ? <Empty title="אין מסלולים עם תשואה לכל חודשי החלון בקטגוריה הזו" /> : (
          <>
            <div className="fplay" role="group" aria-label="הנפשה לפי שנים">
              <button type="button" className="chip" onClick={() => { if (at >= frames.length - 1) setFi(0); if (!playing) setFixed(true); setPlaying(!playing); }} aria-pressed={playing} aria-label={playing ? 'עצירה' : 'הפעלה שנה אחר שנה'}>{playing ? '⏸ עצירה' : '▶ שנה אחר שנה'}</button>
              <button type="button" className="chip" onClick={() => { setPlaying(false); setFi(Math.max(0, at - 1)); }} disabled={at <= 0} aria-label="השנה הקודמת">‹</button>
              <input type="range" min={0} max={frames.length - 1} value={at} onChange={(e) => { setPlaying(false); setFi(Number(e.target.value)); }} aria-label="חודש הסיום של החלון" aria-valuetext={ymL(end)} />
              <button type="button" className="chip" onClick={() => { setPlaying(false); setFi(Math.min(frames.length - 1, at + 1)); }} disabled={at >= frames.length - 1} aria-label="השנה הבאה">›</button>
              <b className="num fplay-at" aria-live="polite">{ymL(end)}</b>
              <Seg label="צירים" value={fixed ? 'fixed' : 'fit'} onChange={(v) => setFixed(v === 'fixed')} options={[['fit', 'צירים לפי השנה'], ['fixed', 'צירים קבועים']]} />
              <Seg label="לחיצה על נקודה" value={tap} onChange={setTap} options={[['open', 'פתיחת כרטיס'], ['cmp', 'הוספה להשוואה']]} />
            </div>
            <MapChart pts={pts} all={fixed ? all : [pts.map((z) => z.p)]} live={live} x={x} retLbl={retLbl} medX={medX} medY={medY} structure={`${cat}|${w}|${x}|${b}|${br}|${fixed}`}
              onDot={(k) => { const f = live.find((z) => z.k === k); if (!f) return; if (tap === 'open' || f.gone) nav(`/funds/${k}`); else tray.toggle(k); }} />
            <div className="fnote">
              כל נקודה: מסלול; גודל: הנכסים בסוף החלון; צבע: המנהל. קווים מקווקווים: החציון בכל ציר (<Sourced src={() => medProv('x', medX)}><span className="num">{medX == null ? '–' : nf(medX, 1)}</span></Sourced>, <Sourced src={() => medProv('y', medY)}><span className="num">{medY == null ? '–' : nf(medY, 1)}</span></Sourced>). הקו הדק: המסלולים שאף מסלול אחר לא השיג יותר בפחות סיכון.
              {' '}בכל שנה מוצגים המסלולים שהיו קיימים אז, כולל {gone ? <><span className="num">{gone}</span> שנסגרו מאז</> : 'מסלולים שנסגרו מאז, כשהיו'}. {b === 'net' ? 'נטו, אומדן: אחרי דמי ניהול מצבירה.' : 'ברוטו, כפי שהרשות מפרסמת.'} {reducedMotion() ? 'תנועה מופחתת: המעבר בין שנים בלי הנפשה.' : ''}
            </div>
          </>
        )}
      </Panel>
      {ready && pts.length > 0 && (
        <Panel title={<>הנקודות · <span className="num">{ymL(end)}</span></>} aside={<span>{pts.length} מסלולים</span>}>
          <DataTable caption={`מפת סיכון ותשואה · ${cat} · ${ymL(end)}`} rows={pts} rowKey={(z) => z.f.k} sort={{ key: 'ret', dir: 'desc' }} maxHeight={520}
            export={{ name: `fox-map-${ymL(end).replace('/', '-')}`, title: `מפת סיכון ותשואה · ${cat} · ${ymL(end)} · ${basisLbl(b)}`, note: 'נגזר מתשואות חודשיות · רשות שוק ההון' }}
            columns={[
              { key: 'n', head: 'מסלול', value: (z) => z.f.name, firstDir: 'asc', cell: (z) => <span className="fmapname"><Link to={`/funds/${z.f.k}`}>{z.f.name}</Link><MgrChip grp={z.f.grp} mgr={z.f.mgr} short />{z.f.gone && <span className="chip">נסגר {z.f.end ? ymL(z.f.end) : ''}</span>}</span> },
              { key: 'ret', head: retLbl, value: (z) => z.p.ret, cell: (z) => <Sourced src={() => retProv(z)}><span className="num">{pc(z.p.ret, 1)}</span></Sourced> },
              { key: 'x', head: AXIS_NAME[x], value: (z) => riskX(z.p, x), cell: (z) => <Sourced src={() => riskProv(z)}><span className="num">{nf(riskX(z.p, x)!, 1)}%</span></Sourced> },
              { key: 'a', head: 'נכסים, מיליוני ש"ח', className: 'wide-only', value: (z) => z.p.a, cell: (z) => (z.p.a == null ? <span className="muted">–</span> : <Sourced src={() => aProv(z)}><span className="num">{nf(z.p.a, 0)}</span></Sourced>) },
              { key: 'act', head: <span className="sr-only">פעולות</span>, label: 'פעולות', noExport: true, sortable: false, cell: (z) => <span className="fact">{!z.f.gone && <CompareAdd k={z.f.k} name={z.f.name} small />}{!z.f.gone && <WatchStar f={z.f} asof={asof} small />}</span> },
            ]} />
        </Panel>
      )}
    </>
  );
}
/** The scatter, drawn on its own instance so a new year tweens the dots instead of redrawing them (a merge, not a replace). */
function MapChart({ pts, all, live, x, retLbl, medX, medY, structure, onDot }: { pts: { p: Frame; f: FundX }[]; all: (Frame | null)[][]; live: FundX[]; x: Axis; retLbl: string; medX: number | null; medY: number | null; structure: string; onDot: (k: string) => void }) {
  const el = useRef<HTMLDivElement>(null), chart = useRef<ECharts | null>(null), last = useRef('');
  const { theme } = useTheme();
  const [ready, setReady] = useState(false);
  const dot = useRef(onDot); dot.current = onDot;
  useEffect(() => {
    let alive = true, ro: ResizeObserver | null = null;
    void import('../lib/echarts').then(({ echarts }) => {
      if (!alive || !el.current) return;
      const c = echarts.init(el.current); chart.current = c;
      ro = new ResizeObserver(() => c.resize()); ro.observe(el.current);
      c.on('click', (e) => { const d = e.data as { k?: string } | undefined; if (d?.k) dot.current(d.k); });
      setReady(true);
    });
    return () => { alive = false; ro?.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);
  // fixed axes over every year, so a dot's move is a real move
  const ext = useMemo(() => {
    const xs: number[] = [], ys: number[] = [], as: number[] = [];
    all.forEach((fr) => fr.forEach((p) => { if (!p) return; const v = riskX(p, x); if (v != null) xs.push(v); ys.push(p.ret); if (p.a != null) as.push(p.a); }));
    const pad = (lo: number, hi: number) => { const d = (hi - lo) * 0.06 || 1; return [Math.floor(lo - d), Math.ceil(hi + d)]; };
    return { x: pad(Math.min(...xs), Math.max(...xs)), y: pad(Math.min(...ys), Math.max(...ys)), a: Math.max(1, ...as) };
  }, [all, x]);
  const groups = useMemo(() => { const m = new Map<string, number>(); live.forEach((f) => m.set(f.grp, (m.get(f.grp) ?? 0) + (f.assets ?? f.end_assets ?? 0))); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g); }, [live]);
  useEffect(() => {
    if (!ready || !chart.current) return;
    const id = requestAnimationFrame(() => {
      const bs = chartBase(), red = reducedMotion(), at = new Map(pts.map((z) => [z.f.k, z]));
      const size = (a: number | null) => 7 + 30 * Math.sqrt(Math.max(0, a ?? 0) / ext.a);
      const edge = frontier(pts.map((z) => ({ x: riskX(z.p, x)!, y: z.p.ret })));
      const series: Record<string, unknown>[] = groups.map((g) => {
        const fs = live.filter((f) => f.grp === g), col = grpId(g) ? idColor(grpId(g)) : bs.mu;
        return { id: `g:${g}`, name: g, type: 'scatter', itemStyle: { color: col, opacity: 0.82, borderColor: bs.panel, borderWidth: 1 }, emphasis: { focus: 'series', itemStyle: { opacity: 1 } },
          data: fs.map((f) => { const z = at.get(f.k); return z ? { value: [riskX(z.p, x), z.p.ret], k: f.k, name: f.name, a: z.p.a, gone: !!f.gone, symbolSize: size(z.p.a) } : { value: ['-', '-'], k: f.k, name: f.name, symbolSize: 0 }; }) };
      });
      series.push({ id: 'edge', name: 'גבול יעיל', type: 'line', silent: true, symbol: 'none', data: edge.map((p) => [p.x, p.y]), lineStyle: { color: bs.mu, width: 1, opacity: 0.6 }, z: 1, tooltip: { show: false },
        markLine: { silent: true, symbol: 'none', lineStyle: { color: bs.mu, type: 'dashed', width: 1 }, label: { show: false }, data: [...(medX != null ? [{ xAxis: medX }] : []), ...(medY != null ? [{ yAxis: medY }] : [])] } });
      const fmt = (v: number) => `${nf(v, 1)}%`;
      const opt = polish({
        animation: !red, animationDurationUpdate: red ? 0 : 900, animationEasingUpdate: 'cubicInOut',
        textStyle: { fontFamily: CHART_FONT, color: bs.fg },
        grid: { left: 8, right: 18, top: 56, bottom: 30, containLabel: true },
        legend: { top: 0, type: 'scroll', data: groups, textStyle: { color: bs.fg, fontSize: 11.5 }, itemWidth: 10, itemHeight: 10, icon: 'circle' },
        tooltip: { trigger: 'item', confine: true, backgroundColor: bs.panel, borderColor: bs.ln, extraCssText: tooltipCss(), textStyle: { color: bs.fg, fontSize: 12 },
          formatter: (q: { data: { value: [number, number]; name: string; a: number | null; gone?: boolean }; seriesName: string; marker: string }) => (q.data?.name ? `${q.marker} <b>${q.data.name}</b>${q.data.gone ? ' (נסגר)' : ''}<br>${q.seriesName}<br>${retLbl}: <b>${fmt(q.data.value[1])}</b><br>${AXIS_NAME[x]}: <b>${fmt(q.data.value[0])}</b><br>נכסים: ${q.data.a == null ? '–' : nf(q.data.a, 0)} מיליוני ש"ח` : '') },
        xAxis: { type: 'value', name: AXIS_NAME[x], nameLocation: 'middle', nameGap: 24, min: ext.x[0], max: ext.x[1], nameTextStyle: { color: bs.mu, fontSize: 11 }, axisLabel: { color: bs.mu, fontSize: 11, formatter: (v: number) => `${nf(v, 0)}` }, splitLine: { lineStyle: { color: bs.ln2 } } },
        yAxis: { type: 'value', name: `${retLbl}, %`, min: ext.y[0], max: ext.y[1], nameTextStyle: { color: bs.mu, fontSize: 11, align: 'left' }, axisLabel: { color: bs.mu, fontSize: 11, formatter: (v: number) => `${nf(v, 0)}` }, splitLine: { lineStyle: { color: bs.ln2 } } },
        series,
      });
      const replace = last.current !== `${structure}|${theme}`;
      last.current = `${structure}|${theme}`;
      chart.current!.setOption(opt, { notMerge: replace });
    });
    return () => cancelAnimationFrame(id);
  }, [ready, pts, ext, groups, x, retLbl, medX, medY, structure, theme, live]);
  return <div ref={el} className="fmap" role="img" aria-label={`מפת סיכון ותשואה: ${pts.length} מסלולים, ${retLbl} מול ${AXIS_NAME[x]}. הטבלה שמתחת מפרטת כל נקודה.`} />;
}

/* ======================================================================================== rank over time, by category (#11) */
export function FundsRank() {
  const { data, error } = useFile();
  const [cat, setCat] = useCat();
  const [basisAsked] = useBasis();
  const [metric, setMetric] = useState<RankMetric>('y12');
  const [own, setOwn] = useState(false);
  const { open } = useSource();
  const files = useCatFiles(cat, { stats: false, rank: true });
  const set = pickSet(files.rank, metric, basisAsked) ?? pickSet(files.rank, metric, 'net');
  const b: Basis = set?.basis ?? basisAsked;
  const [br, setBr] = useBranch();
  const closed = useClosed(true);
  const mem = useMemo(() => (data && closed ? membersOf(data.funds, closed, cat, br) : []), [data, closed, cat, br]);
  const hs = useHists(own && !set ? mem.map((f) => f.k) : []);
  const asof = data?.asof ?? 0;
  const months = files.rank?.months ?? (asof ? backM(asof, 60) : []);
  const browser = useMemo(() => {
    if (set || !own || !mem.length || hs.pending) return null;
    return rankSeries(mem.filter((f) => hs.h[f.k]).map((f) => ({ k: f.k, p: hs.h[f.k].p, y: yOf(hs.h[f.k], b) })), months, metric === 'y12' ? 12 : 36);
  }, [set, own, mem, hs.pending, hs.h, months, metric, b]);
  const series = set ? { tracks: set.tracks, n: set.n, how: 'file' as const } : browser ? { ...browser, how: 'browser' as const } : null;
  useEffect(() => { setOwn(false); }, [cat]);
  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  const fOf = (k: string) => mem.find((f) => f.k === k);
  const L = months.length - 1;
  const rows = series ? Object.entries(series.tracks).map(([k, xs]) => { const f = fOf(k); if (!f) return null;
    const ranked = xs.slice(-60).filter((v) => v != null) as number[];
    return { f, xs, now: xs[L] ?? null, y1: xs[L - 12] ?? null, y3: xs[L - 36] ?? null, top: ranked.filter((v) => v >= 75).length, of: ranked.length }; }).filter((r): r is NonNullable<typeof r> => !!r) : [];
  const top10 = rows.filter((r) => r.now != null && !r.f.gone).sort((a, c) => c.now! - a.now!).slice(0, 10);
  const firstOfGrp = new Map<string, string>(); top10.forEach((r) => { if (!firstOfGrp.has(r.f.grp)) firstOfGrp.set(r.f.grp, r.f.k); });
  const shown = months.slice(-60), off = months.length - shown.length;
  const P = (r: (typeof rows)[number], i: number) => () => rankProv(r.f.name, months[i], r.xs[i] ?? null, series!.n[i] ?? null, metric, b, series!.how);
  const cell = (r: (typeof rows)[number], i: number, v: number | null) => (v == null ? <span className="muted">–</span> : <Sourced src={P(r, i)}><span className="num">{nf(v, 0)}</span></Sourced>);
  return (
    <>
      <FundsHead title="סיכון וזמן" sub={<>אחוזון בקטגוריה לאורך זמן · {cat}</>} tools={<><CatPicker fs={data?.funds ?? []} cat={cat} onChange={setCat} /><BasisToggle real={false} /></>} />
      <TimeNav />
      <Panel title={<>עשרת המובילים היום, ומאיפה הגיעו <Tip k="rank" /></>} aside={<><Seg<RankMetric> label="חלון" value={metric} onChange={setMetric} options={[['y12', 'LTM'], ['a3', '3Y']]} /><span className={`chip${b === 'net' ? ' est' : ''}`}>{basisLbl(b)}</span><button type="button" className="chip" aria-pressed={br} onClick={() => setBr(!br)} title="להציג גם קופות של ארגון או מפעל, שאינן פתוחות לכל הציבור">קופות ענפיות</button>{series && <span className="chip">{series.how === 'file' ? 'מחושב בבניית הנתונים' : 'מחושב בדפדפן'}</span>}</>}>
        {!data || !files.settled ? <Loading what="אחוזונים" /> : !series ? (own ? <Loading what={`${mem.length - hs.pending} מתוך ${mem.length} היסטוריות`} /> : (
          <Empty title="קובץ האחוזונים עוד לא פורסם לקטגוריה הזו">אפשר לחשב אותו כאן מהתשואות החודשיות של כל חברי הקטגוריה, כולל מסלולים שנסגרו. <button type="button" className="chip" onClick={() => setOwn(true)}>חישוב בדפדפן ({mem.length} קבצים)</button></Empty>
        )) : !top10.length ? <Empty title="אין מסלולים מדורגים בחודש האחרון" /> : (
          <>
            <Chart label={`אחוזון ${metric === 'y12' ? 'LTM' : '3Y'} · ${cat}`} height={340} deps={[cat, metric, b, series.how, top10.map((r) => r.f.k).join()]}
              onPoint={(si, di) => { const r = top10[si]; if (r) open(P(r, off + di)()); }}
              build={() => pctChartOption(shown.map(ymL), top10.map((r) => ({ name: r.f.name, data: r.xs.slice(off), color: grpId(r.f.grp) ? idColor(grpId(r.f.grp)) : chartBase().mu, dashed: firstOfGrp.get(r.f.grp) !== r.f.k })))} />
            <div className="fnote">חמש השנים האחרונות. צבע: המנהל; מסלול שני של אותו מנהל: מקווקו. הרצועות: הרבע העליון והתחתון. מסלול שאינו בקטגוריה בחודש מסוים: הקו נקטע.</div>
          </>
        )}
      </Panel>
      {series && rows.length > 0 && (
        <Panel title="כל המסלולים" aside={<span>אחוזון היום, לפני שנה ולפני שלוש שנים; חודשים ברבע העליון מתוך 60</span>}>
          <DataTable caption={`אחוזון לאורך זמן · ${cat}`} rows={rows} rowKey={(r) => r.f.k} sort={{ key: 'now', dir: 'desc' }} maxHeight={560}
            export={{ name: 'fox-rank-history', title: `אחוזון ${metric === 'y12' ? 'LTM' : '3Y'} לאורך זמן · ${cat} · ${basisLbl(b)}`, note: 'נגזר מתשואות חודשיות · רשות שוק ההון' }}
            columns={[
              { key: 'n', head: 'מסלול', value: (r) => r.f.name, firstDir: 'asc', cell: (r) => <span className="fmapname"><Link to={`/funds/${r.f.k}`}>{r.f.name}</Link><MgrChip grp={r.f.grp} mgr={r.f.mgr} short />{r.f.gone && <span className="chip">נסגר</span>}</span> },
              { key: 'now', head: <>היום <span className="dim num">{ymL(months[L])}</span></>, value: (r) => r.now, cell: (r) => cell(r, L, r.now) },
              { key: 'y1', head: 'לפני שנה', value: (r) => r.y1, cell: (r) => cell(r, L - 12, r.y1) },
              { key: 'y3', head: 'לפני 3 שנים', className: 'wide-only', value: (r) => r.y3, cell: (r) => cell(r, L - 36, r.y3) },
              { key: 'top', head: 'ברבע העליון', value: (r) => (r.of ? r.top / r.of : null), cell: (r) => (r.of ? <Sourced src={() => ({ k: 'calc', title: `חודשים ברבע העליון · ${r.f.name}`, value: `${r.top} מתוך ${r.of}`, formula: 'מספר החודשים מתוך 60 האחרונים שבהם האחוזון היה 75 ומעלה, מתוך החודשים שבהם המסלול דורג',
                inputs: r.xs.slice(-60).map((v, i) => ({ label: ymL(months[months.length - 60 + i] ?? 0), v: v == null ? '–' : nf(v, 0), src: v == null ? undefined : P(r, months.length - 60 + i) })).filter((z) => z.v !== '–') })}><span className="num">{r.top}/{r.of}</span></Sourced> : <span className="muted">–</span>) },
              { key: 'act', head: <span className="sr-only">פעולות</span>, label: 'פעולות', noExport: true, sortable: false, cell: (r) => (r.f.gone ? null : <span className="fact"><CompareAdd k={r.f.k} name={r.f.name} small /><WatchStar f={r.f} asof={asof} small /></span>) },
            ]} />
        </Panel>
      )}
    </>
  );
}

/* ======================================================================================== the quilt (#13) */
export function FundsQuilt() {
  const { data, error } = useFile();
  const [cat, setCat] = useCat();
  const [b] = useBasis();
  const [mode, setMode] = useState<'mgr' | 'all'>('mgr');
  const [hi, setHi] = useState<string | null>(null);
  const [phone, setPhone] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px)').matches);
  useEffect(() => { if (typeof matchMedia === 'undefined') return; const m = matchMedia('(max-width: 760px)'); const on = () => setPhone(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  const [br, setBr] = useBranch();
  const closed = useClosed(true);
  const mem = useMemo(() => (data && closed ? membersOf(data.funds, closed, cat, br) : []), [data, closed, cat, br]);
  const hs = useHists(mem.map((f) => f.k));
  const asof = data?.asof ?? 0, ready = !!data && !!closed && mem.length > 0 && hs.pending === 0;
  const years = useMemo(() => (asof ? Array.from({ length: 10 }, (_, i) => Math.floor(asof / 100) - 9 + i) : []), [asof]);
  // per manager: its largest track of the category (assets today, or at closing)
  const chosen = useMemo(() => {
    const live = mem.filter((f) => hs.h[f.k]);
    if (mode === 'all') return live;
    const by = new Map<string, FundX>();
    live.filter((f) => !f.gone && !f.closed).forEach((f) => { const c = by.get(f.grp); if (!c || (f.assets ?? 0) > (c.assets ?? 0)) by.set(f.grp, f); });
    return [...by.values()];
  }, [mem, hs.h, mode]);
  const q = useMemo(() => (ready ? quilt(chosen.map((f) => ({ k: f.k, grp: f.grp, p: hs.h[f.k].p, y: yOf(hs.h[f.k], b), gone: f.gone })), asof, years) : null), [ready, chosen, b, asof, years]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  const fOf = (k: string) => mem.find((f) => f.k === k)!;
  const depth = q ? Math.max(0, ...[...q.values()].map((c) => c.length)) : 0;
  const cut = phone && depth > 10;
  const grps = [...new Set(chosen.map((f) => f.grp))];
  const cellProv = (k: string, yr: number, r: number, ps: number[]): Prov => { const f = fOf(k);
    return { k: 'calc', est: b === 'net', title: `תשואה ${yr}${yr === Math.floor(asof / 100) ? ' (YTD)' : ''}${b === 'net' ? ', נטו' : ''} · ${f.name}`, value: pc(r), formula: '(1 + r₁) × … × (1 + rₙ) − 1 על התשואות החודשיות של השנה', note: b === 'net' ? NET_NOTE : undefined, inputs: monthsIn(refOf(f), hs.h[k], ps, b) }; };
  // on a phone: the last five years, and in each year its top five and bottom five (all of it when a year has ten or fewer)
  const shownYears = phone ? years.slice(-5) : years;
  const rowsIdx = cut ? [0, 1, 2, 3, 4, -1, 6, 7, 8, 9, 10] : Array.from({ length: depth }, (_, i) => i);
  const cellAt = (cs: QuiltCell[], ix: number): { c: QuiltCell; place: number } | undefined => {
    const i = !cut || ix < 5 ? ix : cs.length > 10 ? cs.length - 5 + (ix - 6) : 5 + (ix - 6);
    return cs[i] ? { c: cs[i], place: i + 1 } : undefined;
  };
  return (
    <>
      <FundsHead title="סיכון וזמן" sub={<>שנים: מי היה למעלה ומי למטה · {cat}</>} tools={<><CatPicker fs={data?.funds ?? []} cat={cat} onChange={setCat} /><BasisToggle real={false} /></>} />
      <TimeNav />
      <Panel title={<>תשואה לפי שנה, מהגבוה לנמוך <Tip k="quilt" /></>} aside={<><Seg label="מה מוצג" value={mode} onChange={setMode} options={[['mgr', 'מנהל: המסלול הגדול'], ['all', 'כל המסלולים']]} />{mode === 'all' && <button type="button" className="chip" aria-pressed={br} onClick={() => setBr(!br)}>קופות ענפיות</button>}<span className={`chip${b === 'net' ? ' est' : ''}`}>{basisLbl(b)}</span></>}>
        {!ready || !q ? <Loading what={mem.length ? `${mem.length - hs.pending} מתוך ${mem.length} מסלולים` : 'המסלולים'} /> : !depth ? <Empty title="אין שנים מלאות בקטגוריה הזו" /> : (
          <>
            <div className="fq-legend" role="group" aria-label="הדגשת מנהל">
              {grps.map((g) => <button key={g} type="button" className="chip" aria-pressed={hi === g} onClick={() => setHi(hi === g ? null : g)}><IdDot grp={g} />{g}</button>)}
            </div>
            <div className="scroll"><table className={`fquilt${hi ? ' hi' : ''}`}>
              <caption className="sr-only">תשואה לפי שנה קלנדרית, כל עמודה ממוינת מהגבוה לנמוך, {cat}</caption>
              <thead><tr><th scope="col" className="fq-rk">מקום</th>{shownYears.map((y) => <th key={y} scope="col"><span className="num">{y}</span>{y === Math.floor(asof / 100) ? <span className="dim"> YTD</span> : ''}<span className="dim fq-n">{q.get(y)?.length ?? 0} מסלולים</span></th>)}</tr></thead>
              <tbody>{rowsIdx.map((ri) => ri < 0 ? <tr key="gap"><th scope="row" className="dim">⋯</th>{shownYears.map((y) => <td key={y} className="fq-gap">{(q.get(y)?.length ?? 0) > 10 ? '⋯' : ''}</td>)}</tr> : (
                <tr key={ri}><th scope="row" className="dim">{cut && ri > 5 ? '' : <span className="num">{ri + 1}</span>}</th>{shownYears.map((y) => { const hit = cellAt(q.get(y) ?? [], ri);
                  if (!hit) return <td key={y} />;
                  const { c, place } = hit, f = fOf(c.k), id = grpId(c.grp);
                  return <td key={y} className={`fq-c${hi && hi !== c.grp ? ' dim2' : ''}${hi === c.grp ? ' on' : ''}`} style={{ ['--idc' as string]: id ? idCss(id) : 'var(--neutral)' }}>
                    <Sourced src={() => cellProv(c.k, y, c.r, c.ps)} title={`${f.name} · ${c.grp} · מקום ${place} מתוך ${q.get(y)?.length ?? 0}`}><span className="num">{sn(c.r, 1)}</span></Sourced><span className="fq-m">{c.grp.replace('מנורה מבטחים', 'מנורה').replace('אלטשולר שחם', 'אלטשולר').replace('ילין לפידות', 'ילין')}{c.gone ? ' †' : ''}</span></td>; })}</tr>
              ))}</tbody>
            </table></div>
            <div className="fnote">{mode === 'mgr' ? 'לכל מנהל: המסלול הגדול שלו בקטגוריה היום. ' : 'כל מסלולי הקטגוריה, כולל מסלולים שנסגרו (†) בשנים שבהן פעלו. '}שנה נכללת רק כשפורסמה תשואה לכל חודשיה; השנה הנוכחית: עד {ymL(asof)}. {phone ? 'בטלפון: חמש השנים האחרונות; בשנה עם יותר מעשרה, חמשת הראשונים וחמשת האחרונים. ' : ''}{b === 'net' ? 'נטו, אומדן: אחרי דמי ניהול מצבירה.' : 'ברוטו.'} לחיצה על מנהל מדגישה את דרכו לאורך השנים.</div>
          </>
        )}
      </Panel>
    </>
  );
}

/* ======================================================================================== persistence (#12 view) */
const VERDICT: Record<ReturnType<typeof persistVerdict>, string> = { above: 'מעל מטבע', below: 'מתחת למטבע', coin: 'לא מובחן ממטבע' };
const QHEAD = ['רבע עליון', 'רבע שני', 'רבע שלישי', 'רבע תחתון', 'נסגר'];
function verdictHead(t: PersistTest) {
  const v = persistVerdict(t), s = t.surv.share ?? t.stay.share;
  return v === 'above' ? (s - t.stay.coin < 10 ? 'יש התמדה, חלשה' : 'יש התמדה') : v === 'below' ? 'המובילים נטו לרדת' : 'אין התמדה שאפשר להבחין בה';
}
export function FundsPersist() {
  const p = usePersist();
  const [b] = useBasis();
  const [sp, setSp] = useSearchParams();
  const fams = p.data ? [...new Set(p.data.tests.map((t) => t.prod))].sort((x, y) => (x === 'הכל' ? -1 : y === 'הכל' ? 1 : 0)) : [];
  const cur = fams.includes(sp.get('prod') ?? '') ? sp.get('prod')! : fams[0] ?? null;
  const tests = p.data?.tests.filter((t) => t.prod === cur && t.basis === b).sort((x, y) => x.win - y.win) ?? [];
  const famL = (f: string) => (f === 'הכל' ? 'כל המוצרים יחד' : f);
  const cellProv = (t: PersistTest, i: number, j: number): Prov => ({ k: 'calc', est: t.basis === 'net', title: `${famL(t.prod)} · ${t.label} · מ${QHEAD[i]} אל ${QHEAD[j]}`, value: `${nf(rowShares(t.m[i])[j], 1)}%`, formula: 'מספר המקרים בתא ÷ סך המקרים שהתחילו באותו רבע × 100. מקרה: מסלול בחודש התחלה; הרבע לפי התשואה בחלון שהסתיים בו, ושוב בחלון הבא באותו אורך',
    inputs: [{ label: 'מקרים בתא', v: nf(t.m[i][j], 0) }, { label: `התחילו ב${QHEAD[i]}`, v: nf(t.m[i].reduce((x, c) => x + c, 0), 0) }, ...(t.first ? [{ label: 'חודשי התחלה', v: `${ymL(t.first)}–${ymL(t.last ?? t.first)}${t.nStarts ? ` (${t.nStarts})` : ''}` }] : []), ...(t.cats ? [{ label: 'קטגוריות', v: nf(t.cats, 0) }] : [])], note: p.data?.method ?? undefined });
  const stayProv = (t: PersistTest, surv: boolean): Prov => ({ k: 'calc', est: t.basis === 'net', title: `נשארו ברבע העליון${surv ? ', מתוך השורדים' : ''} · ${famL(t.prod)} · ${t.label}`, value: `${nf(surv ? t.surv.share ?? 0 : t.stay.share, 1)}%`,
    formula: surv ? 'נשארו ברבע העליון ÷ מי שהתחיל בו ושרד את החלון הבא × 100. מטבע הוגן: 25%' : 'נשארו ברבע העליון ÷ כל מי שהתחיל בו, כולל מסלולים שנסגרו בחלון הבא × 100',
    inputs: [{ label: 'נשארו', v: nf(t.stay.k, 0) }, { label: surv ? 'התחילו ושרדו' : 'התחילו ברבע העליון', v: nf((surv ? t.surv.n : t.stay.n) ?? 0, 0) },
      ...(surv && t.surv.lo != null ? [{ label: t.ci === 'boot' ? 'רווח 90%, bootstrap בבלוקים' : 'רווח 90%, Wilson על חלונות שאינם חופפים', v: `${nf(t.surv.lo, 1)}%–${nf(t.surv.hi ?? 0, 1)}%` }] : []),
      ...(!surv && t.stay.lo != null ? [{ label: 'רווח 90%, bootstrap בבלוקים', v: `${nf(t.stay.lo, 1)}%–${nf(t.stay.hi ?? 0, 1)}%` }] : []), ...(t.eff ? [{ label: 'חלונות בלתי חופפים', v: nf(t.eff, 1) }] : [])], note: p.data?.method ?? undefined });
  return (
    <>
      <FundsHead title="סיכון וזמן" sub="האם המנצחים נשארים מנצחים?" tools={<>{fams.length > 1 && <Pick label="מוצר" value={cur ?? ''} onChange={(v) => { const n = new URLSearchParams(sp); n.set('prod', v); setSp(n, { replace: true }); }} options={fams.map((x) => [x, famL(x)] as [string, string])} />}<BasisToggle real={false} /></>} />
      <TimeNav />
      <Lede>בכל חודש התחלה מחלקים כל קטגוריה לארבעה רבעים לפי התשואה בחלון שהסתיים בו, ובודקים באיזה רבע כל מסלול היה בחלון הבא. אם העבר לא מלמד דבר, מי ששרד ברבע העליון יישאר בו ב-25% מהמקרים, כמו מטבע.</Lede>
      {!p.data ? (p.missing ? <Empty title="מבחן ההתמדה יתפרסם עם בניית הנתונים הבאה">הקובץ funds/persist.json עוד לא קיים באתר. המבחן מחושב בבניית הנתונים על כל ההיסטוריה, כולל מסלולים שנסגרו.</Empty> : <Loading what="מבחן ההתמדה" />)
        : !tests.length ? <Empty title="אין מבחן במוצר ובבסיס האלה" /> : tests.map((t) => { const v = persistVerdict(t), tot = t.m[0].reduce((x, c) => x + c, 0);
          return (
            <Panel key={`${t.prod}${t.win}${t.basis}`} title={<>{famL(t.prod)} · {t.label} <Tip k="persist" /></>} aside={<><span className={`chip ${v === 'above' ? 'pos' : v === 'below' ? 'neg' : ''}`}>{VERDICT[v]}</span>{t.thin && <span className="chip est" title="פחות משלושה חלונות שאינם חופפים">מדגם דק</span>}<span className={`chip${t.basis === 'net' ? ' est' : ''}`}>{basisLbl(t.basis)}</span></>}>
              <p className="fverdict"><b>{verdictHead(t)}.</b> מי שהיה ברבע העליון ושרד נשאר בו ב-<Sourced src={() => stayProv(t, true)}><span className="num">{nf(t.surv.share ?? 0, 1)}%</span></Sourced> מהמקרים, מול 25% של מטבע{t.surv.lo != null ? <> (רווח 90%: <span className="num">{nf(t.surv.lo, 1)}%–{nf(t.surv.hi ?? 0, 1)}%</span>)</> : ''}. מכל מי שהתחיל ברבע העליון, כולל מי שנסגר: <Sourced src={() => stayProv(t, false)}><span className="num">{nf(t.stay.share, 1)}%</span></Sourced>; <span className="num">{nf(tot ? (100 * t.m[0][3]) / tot : 0, 1)}%</span> ירדו לרבע התחתון ו-<span className="num">{nf(tot ? (100 * t.m[0][4]) / tot : 0, 1)}%</span> נסגרו לפני סוף החלון הבא{t.goneQ4Pct != null ? <> (ברבע התחתון: <span className="num">{nf(t.goneQ4Pct, 1)}%</span>)</> : ''}.</p>
              <div className="scroll"><table className="fpersist">
                <caption className="sr-only">מטריצת מעבר בין רבעים, {famL(t.prod)}, {t.label}: שורה = הרבע בחלון הראשון, עמודה = הרבע בחלון הבא</caption>
                <thead><tr><th scope="col">בחלון הראשון ↓ · בחלון הבא ←</th>{QHEAD.map((h) => <th key={h} scope="col">{h}</th>)}<th scope="col">מקרים</th></tr></thead>
                <tbody>{t.m.map((row, i) => { const sh = rowShares(row); return (
                  <tr key={i}><th scope="row">{QHEAD[i]}</th>{sh.map((x, j) => <td key={j} className={`fp-c${i === j ? ' diag' : ''}`} style={{ ['--w' as string]: `${Math.min(100, x * 2)}%` }}><Sourced src={() => cellProv(t, i, j)}><span className="num">{nf(x, 1)}%</span></Sourced></td>)}<td><span className="num muted">{nf(row.reduce((x, c) => x + c, 0), 0)}</span></td></tr>
                ); })}</tbody>
              </table></div>
              <div className="fnote">אלכסון מודגש: נשארו באותו רבע. {t.first ? <>חודשי התחלה {ymL(t.first)}–{ymL(t.last ?? t.first)}{t.nStarts ? <>, <span className="num">{t.nStarts}</span> חודשים</> : ''}{t.cats ? <>, <span className="num">{t.cats}</span> קטגוריות</> : ''}. </> : ''}{t.rho != null ? <>מתאם הדירוגים (Spearman) בין החלון לחלון הבא, בין השורדים: <span className="num">{nf(t.rho, 2)}</span>. </> : ''}החלונות חופפים, ולכן הרווח מחושב ב-bootstrap בבלוקים של חודשי התחלה ({t.eff != null ? <><span className="num">{nf(t.eff, 1)}</span> חלונות בלתי חופפים</> : 'ראו שיטה'}).</div>
            </Panel>
          ); })}
      {p.data?.note && <div className="fnote">{p.data.note}</div>}
      {p.data?.method && <details className="fnote"><summary>שיטה</summary>{p.data.method}</details>}
    </>
  );
}

/* ======================================================================================== glide paths (#15) */
const GLIDE_PRODS = ['גמל', 'פנסיה מקיפה', 'פנסיה כללית', 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)'];
type GRow = { grp: string; t: Partial<Record<Band, FundX>>; step: number | null };
export function FundsGlide() {
  const { data, error } = useFile();
  const glide = useGlide();
  const [b] = useBasis();
  const [sp, setSp] = useSearchParams();
  const prod = GLIDE_PRODS.includes(sp.get('prod') ?? '') ? sp.get('prod')! : 'גמל';
  const [per, setPer] = useState<Per>('a3');
  const [sel, setSel] = useState<string | null>(null);
  const asof = data?.asof ?? 0;
  // per manager and band: the track the DATA build chose (glide.json) or, without it, the manager's largest track in that band
  const rows: GRow[] = useMemo(() => {
    if (!data) return [];
    const live = data.funds.filter((f) => f.prod === prod && (BANDS as readonly string[]).includes(f.track) && !f.closed && f.assets && !selfDirected(f));
    const pub = glide.data?.prods.find((x) => x.prod === prod);
    const by = new Map<string, Partial<Record<Band, FundX>>>();
    if (pub) pub.groups.forEach((g) => g.tracks.forEach((t) => { const f = live.find((x) => x.k === t.k); if (f) by.set(g.grp, { ...(by.get(g.grp) ?? {}), [t.band]: f }); }));
    else live.forEach((f) => { const m = by.get(f.grp) ?? {}, c = m[f.track as Band]; if (!c || (f.assets ?? 0) > (c.assets ?? 0)) m[f.track as Band] = f; by.set(f.grp, m); });
    return [...by.entries()].filter(([, t]) => Object.keys(t).length >= 2).map(([grp, t]) => ({ grp, t, step: stepDown({ tracks: BANDS.filter((x) => t[x]).map((x) => ({ band: x, k: t[x]!.k, st: t[x]!.st })) }) })).sort((a, c) => (c.step ?? -99) - (a.step ?? -99));
  }, [data, prod, glide.data]);
  const pick = rows.find((r) => r.grp === sel) ?? rows[0];
  const pubG = glide.data?.prods.find((x) => x.prod === prod)?.groups.find((g) => g.grp === pick?.grp) ?? null;
  const hasPubHist = !!pubG && pubG.tracks.every((t) => t.hist);
  const keys = pick && !hasPubHist ? BANDS.map((x) => pick.t[x]?.k).filter((k): k is string => !!k) : [];
  const hs = useHists(keys);
  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  const stSrc = (f: FundX) => () => expP(refOf(f), asof, 'STOCK_MARKET_EXPOSURE', 'חשיפה למניות', f.st, f.assets);
  const stepProv = (r: GRow): Prov => ({ k: 'calc', title: `ירידת החשיפה למניות, עד 50 → 60 ומעלה · ${r.grp} · ${prod}`, value: r.step == null ? '–' : `${nf(r.step, 1)} נ"א`, formula: 'החשיפה למניות במסלול עד 50 פחות החשיפה במסלול 60 ומעלה, כפי שהגוף מדווח (STOCK_MARKET_EXPOSURE)',
    inputs: BANDS.filter((x) => r.t[x]).map((x) => ({ label: `${x}: ${r.t[x]!.name}`, v: r.t[x]!.st == null ? '–' : nf(r.t[x]!.st!, 1) + '%', src: stSrc(r.t[x]!) })) });
  const retV = (f: FundX) => retOf(f, per, b).v;
  const retSrc = (f: FundX) => () => (b === 'net' ? netProv(f, per, asof, retOf(f, per, 'net').v, data?.net_method) : fundP(refOf(f), asof, per === 'a3' ? 'AVG_ANNUAL_YIELD_TRAILING_3YRS' : per === 'a5' ? 'AVG_ANNUAL_YIELD_TRAILING_5YRS' : 'MONTHLY_YIELD', per, pc(f[per])));
  const gapProv = (r: GRow): Prov => { const a = r.t['עד 50']!, c = r.t['60 ומעלה']!;
    return { k: 'calc', est: b === 'net', title: `פער התשואה, עד 50 מול 60 ומעלה · ${r.grp}`, value: `${sn(retV(a)! - retV(c)!, 2)} נ"א`, formula: 'התשואה של מסלול עד 50 פחות התשואה של מסלול 60 ומעלה באותו חלון', inputs: [{ label: a.name, v: pc(retV(a)), src: retSrc(a) }, { label: c.name, v: pc(retV(c)), src: retSrc(c) }] }; };
  const perL = per === 'y12' ? 'LTM' : per === 'a3' ? '3Y שנתי' : '5Y שנתי';
  return (
    <>
      <FundsHead title="סיכון וזמן" sub={<>מסלולי גיל: כמה סיכון המעבר בגיל באמת מוריד · {prod}</>} tools={<><Pick label="מוצר" value={prod} onChange={(v) => { const n = new URLSearchParams(sp); n.set('prod', v); setSp(n, { replace: true }); }} options={GLIDE_PRODS.map((x) => [x, x] as [string, string])} /><BasisToggle real={false} /></>} />
      <TimeNav />
      {!data ? <Loading what="מסלולי גיל" /> : !rows.length ? <Empty title="אין מנהלים עם שני מסלולי גיל לפחות במוצר הזה" /> : (
        <>
          <Panel title={<>חשיפה למניות לפי גיל, לכל מנהל <Tip k="glide" /></>} aside={<><span>ממוין לפי הירידה מעד 50 ל-60 ומעלה</span><span className="num">{ymL(asof)}</span></>}>
            <Chart label={`חשיפה למניות במסלולי גיל · ${prod}`} height={Math.max(260, rows.length * 34 + 60)} deps={[prod, rows.length, glide.data ? 1 : 0]}
              onPoint={(si, di) => { const r = rows[di], f = r?.t[BANDS[si]]; if (f) setSel(r.grp); }}
              build={() => { const bs = chartBase(); const cols = [bs.accent, bs.mu, bs.fg];
                return { textStyle: { fontFamily: CHART_FONT, color: bs.fg }, grid: { left: 8, right: 30, top: 34, bottom: 8, containLabel: true }, legend: { top: 0, textStyle: { color: bs.fg, fontSize: 11.5 }, itemWidth: 10, itemHeight: 10, icon: 'rect' },
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => (v == null ? '–' : `${nf(v, 1)}%`) },
                  yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.grp), axisTick: { show: false }, axisLabel: { color: bs.fg, fontSize: 11.5 } },
                  xAxis: { type: 'value', max: 100, axisLabel: { color: bs.mu, formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: bs.ln2 } } },
                  series: BANDS.map((x, i) => ({ name: x, type: 'bar', barGap: '10%', itemStyle: { color: cols[i], opacity: 1 - i * 0.18, borderRadius: [0, 2, 2, 0] }, data: rows.map((r) => r.t[x]?.st ?? null) })) }; }} />
            <div className="fnote">{(() => { const md = glide.data?.prods.find((x) => x.prod === prod); return md?.gapSt != null ? <>חציון הירידה בחשיפה למניות מעד 50 ל-60 ומעלה: <Sourced src={() => ({ k: 'calc', title: `חציון ירידת החשיפה למניות · ${prod}`, value: `${nf(md.gapSt!, 1)} נ"א`, formula: 'החציון על פני המנהלים של (חשיפה למניות במסלול עד 50 פחות 60 ומעלה), מחושב בבניית הנתונים (funds/glide.json)', inputs: rows.map((r) => ({ label: r.grp, v: r.step == null ? '–' : `${nf(r.step, 1)} נ"א`, src: () => stepProv(r) })) })}><span className="num">{nf(md.gapSt, 1)}</span></Sourced> נקודות אחוז. </> : null; })()}החשיפה למניות כפי שכל גוף מדווח לרשות על המסלול (לא שם המסלול). לכל מנהל ולכל גיל: {glide.data ? 'המסלול שבחרה בניית הנתונים (funds/glide.json)' : 'המסלול הגדול שלו באותו גיל'}. לחיצה על מנהל מציגה את ההיסטוריה שלו.</div>
          </Panel>
          <Panel title="המנהלים, גיל מול גיל" aside={<><Seg label="חלון" value={per} onChange={setPer} options={[['y12', 'LTM'], ['a3', '3Y'], ['a5', '5Y']]} /><span className={`chip${b === 'net' ? ' est' : ''}`}>{basisLbl(b)}</span></>}>
            <DataTable caption={`מסלולי גיל · ${prod}`} rows={rows} rowKey={(r) => r.grp} maxHeight={560} export={{ name: 'fox-glide', title: `מסלולי גיל · ${prod} · ${perL} · ${basisLbl(b)}`, note: 'רשות שוק ההון' }}
              columns={[
                { key: 'g', head: 'מנהל', value: (r) => r.grp, firstDir: 'asc', cell: (r) => <button type="button" className="linkish" aria-pressed={pick?.grp === r.grp} onClick={() => setSel(r.grp)}><IdDot grp={r.grp} /> {r.grp}</button> },
                ...BANDS.map((x) => ({ key: `st${x}`, head: <>מניות · {x}</>, value: (r: GRow) => r.t[x]?.st ?? null, cell: (r: GRow) => (r.t[x]?.st == null ? <span className="muted">–</span> : <Sourced src={stSrc(r.t[x]!)}><span className="num">{nf(r.t[x]!.st!, 0)}%</span></Sourced>) })),
                { key: 'step', head: 'ירידה, נ"א', value: (r) => r.step, cell: (r) => (r.step == null ? <span className="muted">–</span> : <Sourced src={() => stepProv(r)}><span className="num">{nf(r.step, 1)}</span></Sourced>) },
                ...BANDS.map((x) => ({ key: `r${x}`, head: <>{perL} · {x}</>, className: x === '50-60' ? 'wide-only' : undefined, value: (r: GRow) => (r.t[x] ? retV(r.t[x]!) : null), cell: (r: GRow) => { const f = r.t[x]; const v = f ? retV(f) : null; return v == null ? <span className="muted">–</span> : <Sourced src={retSrc(f!)}><span className="num">{pc(v, 1)}</span></Sourced>; } })),
                { key: 'gap', head: 'פער עד 50 מול 60+', value: (r) => (r.t['עד 50'] && r.t['60 ומעלה'] && retV(r.t['עד 50']!) != null && retV(r.t['60 ומעלה']!) != null ? retV(r.t['עד 50']!)! - retV(r.t['60 ומעלה']!)! : null),
                  cell: (r) => (r.t['עד 50'] && r.t['60 ומעלה'] && retV(r.t['עד 50']!) != null && retV(r.t['60 ומעלה']!) != null ? <Sourced src={() => gapProv(r)}><span className="num">{sn(retV(r.t['עד 50']!)! - retV(r.t['60 ומעלה']!)!, 1)}</span></Sourced> : <span className="muted">–</span>) },
              ]} />
          </Panel>
          {pick && (
            <Panel title={<>{pick.grp}: החשיפה למניות לאורך זמן</>} aside={<span>% מהנכסים · 10 שנים</span>}>
              {hs.pending ? <Loading what="היסטוריה" /> : (
                <GlideHist pick={pick} hs={hasPubHist ? Object.fromEntries(pubG!.tracks.map((t) => [t.k, { p: t.hist!.p, st: t.hist!.st, a: t.hist!.p.map(() => null) } as unknown as import('../lib/funds').HistX])) : hs.h} />
              )}
              <div className="links">{BANDS.filter((x) => pick.t[x]).map((x) => <Fragment key={x}><Link to={`/funds/${pick.t[x]!.k}`}>{x}: {pick.t[x]!.name}</Link>{' '}</Fragment>)}</div>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
function GlideHist({ pick, hs }: { pick: GRow; hs: Record<string, import('../lib/funds').HistX> }) {
  const { open } = useSource();
  const fs = BANDS.map((x) => pick.t[x]).filter((f): f is FundX => !!f && !!hs[f.k]);
  if (!fs.length) return <Empty title="אין היסטוריה" />;
  const axis = [...new Set(fs.flatMap((f) => hs[f.k].p))].sort((a, c) => a - c).slice(-120);
  const at = (f: FundX) => { const h = hs[f.k], m = new Map(h.p.map((p, i) => [p, h.st[i]])); return axis.map((p) => m.get(p) ?? null); };
  return <Chart label={`חשיפה למניות במסלולי הגיל · ${pick.grp}`} height={260} deps={[pick.grp, axis.length]}
    onPoint={(si, di) => { const f = fs[si], h = f && hs[f.k], p = axis[di], i = h ? h.p.indexOf(p) : -1; if (h && i >= 0 && h.st[i] != null) open(expP(refOf(f), p, 'STOCK_MARKET_EXPOSURE', 'חשיפה למניות', h.st[i], h.a[i] ?? null)); }}
    build={() => { const bs = chartBase(), cols = [bs.accent, bs.mu, bs.fg];
      return { textStyle: { fontFamily: CHART_FONT, color: bs.fg }, grid: { left: 8, right: 14, top: 34, bottom: 6, containLabel: true }, legend: { top: 0, textStyle: { color: bs.fg, fontSize: 11.5 }, icon: 'rect', itemWidth: 10, itemHeight: 10 },
        tooltip: { trigger: 'axis', valueFormatter: (v: number) => (v == null ? '–' : `${nf(v, 1)}%`) },
        xAxis: { type: 'category', data: axis.map(ymL), axisLabel: { color: bs.mu, fontSize: 11, hideOverlap: true }, axisTick: { show: false } },
        yAxis: { type: 'value', axisLabel: { color: bs.mu, formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: bs.ln2 } } },
        series: fs.map((f) => ({ name: f.track, type: 'line', symbol: 'none', connectNulls: false, data: at(f), lineStyle: { width: 2, color: cols[BANDS.indexOf(f.track as Band)] }, itemStyle: { color: cols[BANDS.indexOf(f.track as Band)] } })) }; }} />;
}
