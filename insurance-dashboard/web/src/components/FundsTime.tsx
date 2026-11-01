import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Chart } from './Chart';
import { Sourced } from './Source';
import { Tip } from './Explain';
import { Empty, Loading, Panel, Pick, Seg } from './ui';
import { foxOption } from '../lib/foxchart';
import { chartBase } from '../lib/theme';
import { nf, sn } from '../lib/format';
import { monthIn, type TrackRef } from '../lib/market';
import { useSource, type Prov } from '../lib/prov';
import { GROUP_ID, idColor } from '../lib/identity';
import { NET_LABEL, NET_NOTE, PCT_F, catKey, netMonthIn, netSeries, pc, refOf, useBasis, type Basis, type CatX, type FundX, type HistX } from '../lib/funds';
import { RISK_F, RISK_LABEL, RISK_UNIT, STAT_KEYS, backM, pickSet, rankSeries, riskFromHist, toggleWatch, isWatched, type RankMetric, type StatKey, type StatVals } from '../lib/fundsTime';
import { membersOf, useCatFiles, useClosed, useHists, useRf, useWatch, snapOf, yOf } from '../lib/fundsTimeLoad';
import { today } from '../lib/visits';
import '../styles/funds-time.css';

/* F2 TIME, the shared pieces: the section's second row of tabs ("סיכון וזמן"), the category picker, the watch star, the risk panel (track
   card and compare) and the peer-rank-over-time panel (track card). */

export const TIME_TABS: [string, string][] = [['/funds/map', 'מפת סיכון ותשואה'], ['/funds/rank', 'אחוזון לאורך זמן'], ['/funds/quilt', 'שנים'], ['/funds/persist', 'התמדה'], ['/funds/glide', 'מסלולי גיל']];
export function TimeNav() {
  // the category travels with the reader between the views
  const cat = new URLSearchParams(useLocation().search).get('cat');
  return <nav className="subnav sub2 ftime-nav" aria-label="סיכון וזמן">{TIME_TABS.map(([to, l]) => <NavLink key={to} to={{ pathname: to, search: cat && to !== '/funds/persist' && to !== '/funds/glide' ? `?cat=${encodeURIComponent(cat)}` : '' }}>{l}</NavLink>)}</nav>;
}

/** product and track of a category (cat.json key "מוצר | מסלול"), from the tracks of the file; only categories with `min` live tracks */
export function CatPicker({ fs, cat, onChange, min = 5 }: { fs: FundX[]; cat: string; onChange: (c: string) => void; min?: number }) {
  const by = useMemo(() => { const m = new Map<string, number>(); fs.filter((f) => !f.closed && f.assets).forEach((f) => m.set(catKey(f), (m.get(catKey(f)) ?? 0) + 1)); return m; }, [fs]);
  const cats = [...by.entries()].filter(([, n]) => n >= min).map(([k]) => k);
  const [prod, track] = cat.split(' | ');
  const prods = [...new Set(cats.map((c) => c.split(' | ')[0]))];
  const tracks = cats.filter((c) => c.startsWith(`${prod} | `)).map((c) => c.split(' | ')[1]);
  return (
    <>
      <Pick label="מוצר" value={prod} onChange={(p) => { const t = cats.find((c) => c === `${p} | ${track}`) ?? cats.filter((c) => c.startsWith(`${p} | `)).sort((a, b) => (by.get(b) ?? 0) - (by.get(a) ?? 0))[0]; if (t) onChange(t); }} options={prods.map((p) => [p, p] as [string, string])} />
      <Pick label="מסלול" value={track} onChange={(t) => onChange(`${prod} | ${t}`)} options={tracks.map((t) => [t, t, `${by.get(`${prod} | ${t}`)} מסלולים`] as [string, string, string])} />
    </>
  );
}

/** "★ מעקב": follow a track (this browser only) */
export function WatchStar({ f, asof, small }: { f: FundX; asof: number; small?: boolean }) {
  const [w, setW] = useWatch();
  const [b] = useBasis();
  const on = isWatched(w, f.k);
  return (
    <button type="button" className={`wstar${small ? ' sm' : ''}`} aria-pressed={on} aria-label={on ? `הפסקת מעקב: ${f.name}` : `מעקב אחר ${f.name}`} title="מעקב פרטי, נשמר רק בדפדפן הזה"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setW(toggleWatch(w, f.k, f.name, f.gone ? null : snapOf(f, asof, b), today())); }}>
      <span aria-hidden="true">{on ? '★' : '☆'}</span>{!small && <span>{on ? ' במעקב' : ' מעקב'}</span>}
    </button>
  );
}

/* ---------- figures of the time module, with their sources ---------- */

/** a statistic as text in its unit */
export function statText(k: StatKey, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const u = RISK_UNIT[k];
  if (u === 'n') return nf(v, 0);
  if (k === 'up_cap36' || k === 'down_cap36') return nf(v, 0);
  if (u === 'x') return nf(v, 2);
  return k === 'dd_max' || k === 'dd_cur' || k === 'worst_m' || k === 'best_m' ? pc(v, 2) : nf(v, 2) + '%';
}
/** the monthly returns behind a window, as source inputs (net: each month's gross return and fee; gross: the published return) */
export function monthsIn(f: TrackRef, h: HistX, ps: number[], b: Basis) {
  if (b === 'net') { const ns = netSeries(h); return ps.map((p) => netMonthIn(f, h, p, ns)); }
  return ps.map((p) => monthIn(f, 'y', p, h.y[h.p.indexOf(p)] ?? null));
}
const TIPS: Partial<Record<StatKey, string>> = { dd_max_all: 'dd', vol36: 'vol', dd_max: 'dd', dd_cur: 'ddcur', rec_months: 'rec', sharpe36: 'sharpe', sortino36: 'sortino', beta36_vs_cat: 'beta', te36_vs_cat: 'te', up_cap36: 'upcap', down_cap36: 'downcap' };
export const RATE_F = 'תשואת אג"ח ממשלתי שקלי אפס-קופון לשנה, ממוצע חודשי (בנק ישראל, עקום ZCM, ZC_TSB_ZND_01Y_MA, macro/boi_curve.json), כשיעור חודשי: (1 + תשואה) בחזקת 1/12 − 1; חודש בלי נתון: האחרון שפורסם';

/** the source of one statistic: the formula, the 36 months behind it, and where the rate and the category average come from */
export function statProv(name: string, f: TrackRef | null, h: HistX | null, k: StatKey, v: number | null | undefined, months: number[], b: Basis, how: 'file' | 'browser' | 'cat', cat?: { label: string; c: CatX | null }): Prov {
  const extra: { label: string; v: string }[] = [];
  if (k === 'sharpe36' || k === 'sortino36') extra.push({ label: 'ריבית חסרת סיכון', v: RATE_F });
  if (/_vs_cat|cap36/.test(k) && cat) extra.push({ label: 'ממוצע הקטגוריה', v: `${cat.label}: ממוצע משוקלל נכסים של תשואות החברים בכל חודש (funds/cat.json)${b === 'net' ? ', נטו' : ''}` });
  const inputs = how === 'cat' && cat?.c
    ? months.map((p) => { const i = cat.c!.p.indexOf(p), y = b === 'net' ? cat.c!.yn?.[i] : cat.c!.y[i]; return { label: `ממוצע הקטגוריה · ${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`, v: y == null ? '–' : sn(y, 2) + '%' }; })
    : f && h ? monthsIn(f, h, months, b) : [];
  return { k: 'calc', est: b === 'net', title: `${RISK_LABEL[k]}, 36 חודשים${b === 'net' ? `, ${NET_LABEL}` : ''} · ${name}`, value: statText(k, v),
    formula: (how === 'file' ? 'מחושב בבניית הנתונים (funds/stats): ' : how === 'cat' ? 'על סדרת ממוצע הקטגוריה: ' : '') + RISK_F[k], inputs: [...extra, ...inputs], note: b === 'net' ? NET_NOTE : undefined };
}

/* ---------- the risk panel of a track card ---------- */
export function RiskPanel({ f, h, cats }: { f: FundX; h: HistX; asof?: number; cats: Record<string, CatX> | null | undefined }) {
  const [basisAsked] = useBasis();
  const b: Basis = basisAsked;
  const cat = catKey(f);
  const files = useCatFiles(cat, { stats: true, rank: false });
  const end = h.p[h.p.length - 1];
  const rf = useRf(end);
  // the build's row when it is for this month and on the basis shown (a track without 36 net months is computed gross there)
  const fileRow = files.stats && files.stats.asof === end ? files.stats.tracks.find((t) => t.k === f.k && t.basis === b) ?? null : null;
  const c = cats?.[cat] ?? null;
  const cs = useMemo(() => (c ? { p: c.p, y: (b === 'net' ? c.yn : null) ?? c.y } : null), [c, b]);
  const mine = useMemo(() => riskFromHist(h, yOf(h, b), end, cs, rf), [h, b, end, cs, rf]);
  // the category's own average series through the same formulas (its beta and captures against itself are not shown)
  const catAvg = useMemo(() => (cs ? riskFromHist({ p: cs.p }, cs.y, end, null, rf) : null), [cs, end, rf]);
  const vals: StatVals | null = fileRow ?? mine;
  const med = fileRow && files.stats && b === 'net' ? files.stats.cat_median : null;
  const months = backM(end, 36), R = refOf(f);
  if (!vals) return <Panel title="סיכון, 36 חודשים"><Empty title="אין 36 חודשי תשואה רצופים">המדדים דורשים תשואה חודשית לכל אחד מ-36 החודשים האחרונים.</Empty></Panel>;
  const shown = STAT_KEYS.filter((k) => vals[k] != null || (med ?? catAvg)?.[k] != null);
  return (
    <Panel title={<>סיכון, 36 חודשים <Tip k="sd" /></>} aside={<><span className="num">{String(months[0] % 100).padStart(2, '0')}/{String(Math.floor(months[0] / 100)).slice(2)}–{String(end % 100).padStart(2, '0')}/{String(Math.floor(end / 100)).slice(2)}</span><span className={`chip${b === 'net' ? ' est' : ''}`}>{b === 'net' ? NET_LABEL : 'ברוטו'}</span><span className="chip">{fileRow ? 'מחושב בבניית הנתונים' : 'מחושב בדפדפן מהתשואות החודשיות'}</span></>}>
      <div className="scroll"><table className="frisk">
        <thead><tr><th>מדד</th><th>המסלול</th><th>{med ? 'חציון הקטגוריה' : 'ממוצע הקטגוריה'}</th><th className="wide-only">מה זה אומר</th></tr></thead>
        <tbody>{shown.map((k) => (
          <tr key={k}>
            <td>{RISK_LABEL[k]} {TIPS[k] && <Tip k={TIPS[k]!} />}</td>
            <td>{vals[k] == null ? <span className="muted">–</span> : <Sourced src={() => statProv(f.name, R, h, k, vals[k], months, b, fileRow ? 'file' : 'browser', { label: cat, c })}><span className="num">{statText(k, vals[k])}</span></Sourced>}</td>
            <td>{med ? (med[k] == null ? <span className="muted">–</span> : <Sourced src={() => ({ k: 'calc', est: true, title: `${RISK_LABEL[k]}, חציון ${cat}`, value: statText(k, med[k]), formula: `החציון של ${RISK_LABEL[k]} על פני מסלולי הקטגוריה, כפי שחושב בבניית הנתונים (funds/stats). ${RISK_F[k]}`,
                inputs: (files.stats?.tracks ?? []).filter((t) => t[k] != null).map((t) => ({ label: t.name, v: statText(k, t[k]) })) })}><span className="num muted">{statText(k, med[k])}</span></Sourced>)
              : catAvg?.[k] == null || /_vs_cat|cap36|dd_cur|dd_len/.test(k) ? <span className="muted">–</span> : <Sourced src={() => statProv(`ממוצע ${cat}`, null, null, k, catAvg[k], months, b, 'cat', { label: cat, c })}><span className="num muted">{statText(k, catAvg[k])}</span></Sourced>}</td>
            <td className="wide-only fexp">{RISK_F[k]}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="fnote">{b === 'net' ? 'נטו, אומדן: התשואה החודשית פחות דמי הניהול מצבירה ÷ 12. ' : 'ברוטו, כפי שהרשות מפרסמת. '}שארפ וסורטינו: מעל תשואת אג"ח ממשלתי שקלי לשנה (עקום האפס של בנק ישראל){rf ? '' : ' (העקום לא נטען: חסרים)'}. בטא, סטיית מעקב ולכידה: מול ממוצע הקטגוריה המשוקלל בנכסים. שום מדד כאן אינו ציון; כל אחד הוא עובדה נפרדת.</div>
    </Panel>
  );
}

/* ---------- the risk rows of the head-to-head ---------- */
export function CompareRisk({ items, cats }: { items: { f: FundX; h: HistX }[]; cats: Record<string, CatX> | null | undefined }) {
  const [b] = useBasis();
  const end = items.length ? Math.min(...items.map((it) => it.h.p[it.h.p.length - 1])) : 0;
  const rf = useRf(end);
  const rows = useMemo(() => items.map((it) => { const c = cats?.[catKey(it.f)]; const cs = c ? { p: c.p, y: (b === 'net' ? c.yn : null) ?? c.y } : null; return { ...it, c: c ?? null, s: riskFromHist(it.h, yOf(it.h, b), end, cs, rf) }; }), [items, cats, b, end, rf]);
  if (!items.length) return null;
  const months = backM(end, 36);
  return (
    <Panel title={<>סיכון, 36 חודשים <Tip k="sd" /></>} aside={<><span className="num">עד {String(end % 100).padStart(2, '0')}/{String(Math.floor(end / 100)).slice(2)}</span><span className={`chip${b === 'net' ? ' est' : ''}`}>{b === 'net' ? NET_LABEL : 'ברוטו'}</span><span className="chip">נומינלי</span></>}>
      <div className="scroll"><table className="frisk">
        <thead><tr><th>מדד</th>{rows.map((r) => <th key={r.f.k} title={r.f.name}>{r.f.name.length > 26 ? r.f.name.slice(0, 24) + '…' : r.f.name}</th>)}</tr></thead>
        <tbody>{STAT_KEYS.map((k) => (
          <tr key={k}><td>{RISK_LABEL[k]} {TIPS[k] && <Tip k={TIPS[k]!} />}</td>
            {rows.map((r) => <td key={r.f.k}>{r.s?.[k] == null ? <span className="muted">–</span> : <Sourced src={() => statProv(r.f.name, refOf(r.f), r.h, k, r.s![k], months, b, 'browser', { label: catKey(r.f), c: r.c })}><span className="num">{statText(k, r.s[k])}</span></Sourced>}</td>)}</tr>
        ))}</tbody>
      </table></div>
      <div className="fnote">אותו חלון לכל המסלולים (36 החודשים שמסתיימים בחודש האחרון המשותף). בטא, סטיית מעקב ולכידה: כל מסלול מול ממוצע הקטגוריה שלו, לכן מסלולים מקטגוריות שונות אינם מושווים על אותו בסיס. מסלול בלי 36 חודשים רצופים: ריק.</div>
    </Panel>
  );
}

/* ---------- percentile rank over time ---------- */
const QBAND = (b: ReturnType<typeof chartBase>) => ({ silent: true, itemStyle: { color: b.mu, opacity: 0.07 }, data: [[{ yAxis: 75 }, { yAxis: 100 }], [{ yAxis: 0 }, { yAxis: 25 }]] });
/** a percentile line chart on 0..100 with the top and bottom quartile shaded */
export function pctChartOption(x: string[], lines: { name: string; data: (number | null)[]; color: string; dashed?: boolean; lead?: boolean }[], legend = lines.length > 1) {
  const b = chartBase();
  const o = foxOption({ x, unit: 'אחוזון', dense: true, full: true, legend, series: lines.map((l) => ({ name: l.name, data: l.data, kind: 'line' as const, color: l.color, dashed: l.dashed, lead: l.lead, dec: 0 })) }) as { yAxis: Record<string, unknown>[]; series: Record<string, unknown>[] };
  o.yAxis[0].min = 0; o.yAxis[0].max = 100; o.yAxis[0].interval = 25; o.yAxis[0].scale = false;
  if (o.series[0]) o.series[0].markArea = QBAND(b);
  return o;
}
export const rankProv = (name: string, p: number, v: number | null, n: number | null, metric: RankMetric, b: Basis, how: 'file' | 'browser', inputs: { label: string; v: string; src?: () => Prov }[] = []): Prov => ({
  k: 'calc', est: b === 'net', title: `אחוזון ${metric === 'y12' ? 'LTM' : '3Y שנתי'}${b === 'net' ? ', נטו' : ''} בקטגוריה · ${name} · ${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`, value: v == null ? '–' : nf(v, 0),
  formula: `${how === 'file' ? 'מחושב בבניית הנתונים (funds/rank). ' : 'מחושב בדפדפן מהתשואות החודשיות של חברי הקטגוריה. '}תשואה ${metric === 'y12' ? 'מצטברת של 12 החודשים' : 'שנתית ממוצעת של 36 החודשים'} שמסתיימים בחודש. ${PCT_F}. חברי הקטגוריה כפי שהיו באותו חודש, כולל מסלולים שנסגרו מאז`,
  inputs: [{ label: 'מסלולים מדורגים בחודש', v: n == null ? '–' : nf(n, 0) }, ...inputs] });

export function RankPanel({ f, h, data }: { f: FundX; h: HistX; data: { funds: FundX[] } }) {
  const [basisAsked] = useBasis();
  const [metric, setMetric] = useState<RankMetric>('y12');
  const [own, setOwn] = useState(false);
  const { open } = useSource();
  const cat = catKey(f);
  const files = useCatFiles(cat, { stats: false, rank: true });
  const set = pickSet(files.rank, metric, basisAsked) ?? pickSet(files.rank, metric, 'net');
  const b: Basis = set?.basis ?? basisAsked;
  const closed = useClosed(own && !set);
  const mem = useMemo(() => (own && !set && closed ? membersOf(data.funds, closed, cat) : []), [own, set, closed, data, cat]);
  const hs = useHists(mem.map((x) => x.k));
  const months = files.rank?.months ?? h.p.slice(-120);
  const browser = useMemo(() => {
    if (set || !own || !mem.length || hs.pending) return null;
    const ms = mem.filter((x) => hs.h[x.k]).map((x) => ({ k: x.k, p: hs.h[x.k].p, y: yOf(hs.h[x.k], b) }));
    return rankSeries(ms, months, metric === 'y12' ? 12 : 36);
  }, [set, own, mem, hs.pending, hs.h, months, metric, b]);
  const series = set ? { tracks: set.tracks, n: set.n, how: 'file' as const } : browser ? { ...browser, how: 'browser' as const } : null;
  const line = series?.tracks[f.k] ?? null;
  const first = line ? line.findIndex((v) => v != null) : -1;
  const ms = first > 0 ? months.slice(first) : months, ys = first > 0 ? line!.slice(first) : line;
  const id = GROUP_ID[f.grp];
  return (
    <Panel title={<>אחוזון בקטגוריה לאורך זמן <Tip k="rank" /></>} aside={<><Seg<RankMetric> label="חלון" value={metric} onChange={setMetric} options={[['y12', 'LTM'], ['a3', '3Y']]} /><span className={`chip${b === 'net' ? ' est' : ''}`}>{b === 'net' ? NET_LABEL : 'ברוטו'}</span>{series && <span className="chip">{series.how === 'file' ? 'מחושב בבניית הנתונים' : 'מחושב בדפדפן'}</span>}</>}>
      {series && ys && ys.some((v) => v != null) ? (
        <>
          <Chart label={`אחוזון בקטגוריה · ${f.name}`} height={240} deps={[f.k, metric, b, series.how, ys.length]} onPoint={(_s, di) => { const p = ms[di], v = ys[di], i = months.indexOf(p); open(rankProv(f.name, p, v, series.n[i] ?? null, metric, b, series.how, monthsIn(refOf(f), h, backM(p, metric === 'y12' ? 12 : 36), b))); }}
            build={() => pctChartOption(ms.map((p) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`), [{ name: f.name, data: ys, color: id ? idColor(id) : chartBase().accent, lead: true }], false)} />
          <div className="fnote">100 = התשואה הגבוהה בקטגוריה בחלון שהסתיים באותו חודש; הרצועות המוצללות: הרבע העליון והתחתון. חברי הקטגוריה כפי שהיו בכל חודש{series.how === 'file' ? ', כולל מסלולים שנסגרו מאז' : closed && closed.length ? ', כולל מסלולים שנסגרו מאז' : ''}. לחיצה על נקודה פותחת את החישוב.</div>
        </>
      ) : !files.settled || (own && !series) ? <Loading what={own ? `${mem.length || ''} היסטוריות של הקטגוריה` : 'אחוזונים'} />
        : !set && !own ? (
          <Empty title="קובץ האחוזונים עוד לא פורסם לקטגוריה הזו">
            אפשר לחשב אותו כאן מהתשואות החודשיות של כל חברי הקטגוריה. <button type="button" className="chip" onClick={() => setOwn(true)}>חישוב בדפדפן</button>
          </Empty>
        ) : <Empty title="אין למסלול אחוזון בחלון הזה">דרושים חמישה מסלולים מדורגים לפחות, ותשואה לכל חודשי החלון.</Empty>}
    </Panel>
  );
}

/** a quiet "what this page computes" line under a tool's header */
export function Lede({ children }: { children: ReactNode }) { return <p className="flede">{children}</p>; }
