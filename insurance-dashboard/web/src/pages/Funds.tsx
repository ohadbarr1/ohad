import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, Kpi, Loading, Panel, Seg } from '../components/ui';
import { CHART_FONT, chartBase, palette } from '../lib/theme';
import { nf, pct } from '../lib/format';
import { load, useFundCats, useFundHist, useFunds, type Fund, type FundCats, type FundHist } from '../lib/useData';

const PRODUCTS = ['גמל', 'השתלמות', 'גמל להשקעה', 'חיסכון לילד', 'פנסיה מקיפה', 'פנסיה כללית', 'ביטוח 2004 ואילך: מנהלים וחיסכון', 'ביטוחי מנהלים 1992-2003', 'ביטוחי מנהלים 1990-1991', 'מרכזית לפיצויים', 'גמל, מטרה אחרת'];
type Per = 'm1' | 'ytd' | 'y12' | 'a3' | 'a5';
const PERIODS: [Per, string][] = [['m1', '1M'], ['ytd', 'YTD'], ['y12', 'LTM'], ['a3', '3Y'], ['a5', '5Y']];
type Win = '12' | '36' | '60' | '120' | 'max';
const WINDOWS: [Win, string][] = [['12', '1Y'], ['36', '3Y'], ['60', '5Y'], ['120', '10Y'], ['max', 'MAX']];
const ym = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
const catKey = (f: Fund) => `${f.prod} | ${f.track}`;
const tone = (v: number | null | undefined) => (v == null ? '' : v < 0 ? 'neg' : 'pos');
const P = ({ v, d = 1 }: { v: number | null | undefined; d?: number }) => (v == null ? <span className="muted">–</span> : <span className={`num ${tone(v)}`}>{pct(v, d, true)}</span>);

/** Compounded return, annualised volatility and the deepest peak-to-trough fall over the last `n` monthly returns. All derived from the published monthly returns. */
function stats(y: (number | null)[], n: number) {
  const s = y.slice(-n).filter((x): x is number => x != null);
  if (s.length < Math.min(n, 3)) return null;
  let idx = 1, peak = 1, dd = 0;
  s.forEach((r) => { idx *= 1 + r / 100; peak = Math.max(peak, idx); dd = Math.min(dd, idx / peak - 1); });
  const mean = s.reduce((t, r) => t + r, 0) / s.length;
  const sd = Math.sqrt(s.reduce((t, r) => t + (r - mean) ** 2, 0) / Math.max(1, s.length - 1));
  return { ret: (idx - 1) * 100, ann: (idx ** (12 / s.length) - 1) * 100, vol: sd * Math.sqrt(12), dd: dd * 100, best: Math.max(...s), worst: Math.min(...s), months: s.length };
}
/** Series rebased to 100 at the start of the common window. */
function rebased(periods: number[], series: { p: number[]; y: (number | null)[] }) {
  const at = new Map(series.p.map((p, i) => [p, series.y[i]]));
  let idx = 100;
  return periods.map((p, i) => { const r = at.get(p); if (i === 0) return 100; if (r == null) return null; idx *= 1 + r / 100; return +idx.toFixed(2); });
}
const catReturn = (c: FundCats[string] | undefined, per: Per, asof: number) => {
  if (!c) return null;
  const n = per === 'm1' ? 1 : per === 'ytd' ? asof % 100 : per === 'y12' ? 12 : per === 'a3' ? 36 : 60;
  const s = stats(c.y, n);
  return !s || s.months < n ? null : per === 'a3' || per === 'a5' ? s.ann : s.ret;
};

function Sub() {
  return (
    <nav className="subnav" aria-label="קופות ושוק">
      <NavLink to="/funds" end>מסלולים</NavLink>
      <NavLink to="/market/overview">שוק</NavLink>
      <NavLink to="/market/ranking">דירוג חברות</NavLink>
      <NavLink to="/managers">מנהלים</NavLink>
    </nav>
  );
}

function Growth({ periods, lines, deps }: { periods: number[]; lines: { name: string; data: (number | null)[]; dash?: boolean }[]; deps: unknown[] }) {
  return (
    <Chart label="תשואה מצטברת, בסיס 100" height={320} deps={deps} build={() => {
      const b = chartBase(), pal = palette();
      return {
        animationDuration: 700, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 6, right: 14, top: 34, bottom: 4, containLabel: true },
        legend: { top: 0, type: 'scroll', textStyle: { color: b.mu, fontSize: 11 }, itemWidth: 14, itemHeight: 3 },
        tooltip: { trigger: 'axis', confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: (v: number | null) => (v == null ? '–' : nf(v, 1)) },
        xAxis: { type: 'category', data: periods.map(ym), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } }, axisLabel: { color: b.mu, fontSize: 10, hideOverlap: true } },
        yAxis: { type: 'value', scale: true, axisLabel: { color: b.mu, fontSize: 10 }, splitLine: { lineStyle: { color: b.ln, opacity: 0.5 } } },
        series: lines.map((l, i) => ({ name: l.name, type: 'line', data: l.data, symbol: 'none', connectNulls: true,
          lineStyle: { width: l.dash ? 1.5 : 2.2, type: l.dash ? 'dashed' : 'solid', color: l.dash ? b.mu : pal[i % pal.length] }, itemStyle: { color: l.dash ? b.mu : pal[i % pal.length] } })),
      };
    }} />
  );
}

/** Every savings track the regulator publishes, compared inside its own product and track. */
export function Funds() {
  const { data, error } = useFunds();
  const cats = useFundCats().data;
  const [sp, setSp] = useSearchParams();
  const prod = sp.get('prod') ?? 'השתלמות', track = sp.get('track') ?? 'כללי', per = (sp.get('per') as Per) ?? 'y12';
  const sel = useMemo(() => (sp.get('sel') ?? '').split(',').filter(Boolean), [sp]);
  const [closed, setClosed] = useState(false);
  const [q, setQ] = useState('');
  const [win, setWin] = useState<Win>('60');
  const set = (patch: Record<string, string>) => { const next = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k))); setSp(next, { replace: true }); };

  const all = data?.funds ?? [];
  const tracks = useMemo(() => { const m = new Map<string, number>(); all.filter((f) => f.prod === prod).forEach((f) => m.set(f.track, (m.get(f.track) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [all, prod]);
  const T = tracks.some(([t]) => t === track) ? track : tracks[0]?.[0] ?? '';
  const members = useMemo(() => all.filter((f) => f.prod === prod && f.track === T), [all, prod, T]);
  const rows = useMemo(() => {
    const shown = members.filter((f) => closed || !f.closed);  // the rank is among the tracks on screen
    const ranked = shown.filter((f) => f[per] != null).sort((a, b) => b[per]! - a[per]!);
    const rank = new Map(ranked.map((f, i) => [f.k, i + 1]));
    const t = q.trim();
    return { n: ranked.length, list: [...ranked, ...shown.filter((f) => f[per] == null)].filter((f) => !t || f.name.includes(t) || f.mgr.includes(t)).map((f) => ({ f, rank: rank.get(f.k) ?? null })) };
  }, [members, per, closed, q]);
  const cat = cats?.[`${prod} | ${T}`];

  // histories of the tracks picked for comparison
  const [hist, setHist] = useState<Record<string, FundHist>>({});
  useEffect(() => { sel.filter((k) => !hist[k]).forEach((k) => load<FundHist>(`funds/${k}.json`).then((h) => setHist((cur) => ({ ...cur, [k]: h })), () => {})); }, [sel, hist]);
  const picked = sel.map((k) => all.find((f) => f.k === k)).filter((f): f is Fund => !!f && !!hist[f.k]);
  const n = win === 'max' ? Infinity : Number(win);
  const axis = useMemo(() => {
    if (!picked.length) return [];
    const start = Math.max(...picked.map((f) => hist[f.k].p[Math.max(0, hist[f.k].p.length - (n === Infinity ? hist[f.k].p.length : n + 1))]));
    return hist[picked[0].k].p.filter((p) => p >= start);
  }, [picked, hist, n]);

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="קופות" />;
  const asof = data.asof;
  const toggle = (k: string) => set({ sel: (sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k].slice(-6)).join(',') });

  return (
    <>
      <div className="pagehead"><div><h1>קופות ומסלולים</h1><div className="sub">{nf(all.length, 0)} מסלולים · {ym(asof)} · {data.source}</div></div></div>
      <Sub />
      <section className="controls">
        <Field label="מוצר"><select value={prod} onChange={(e) => set({ prod: e.target.value, track: '', sel: '' })}>{PRODUCTS.filter((p) => all.some((f) => f.prod === p)).map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
        <Field label="מסלול"><select value={T} onChange={(e) => set({ track: e.target.value, sel: '' })}>{tracks.map(([t, c]) => <option key={t} value={t}>{t} ({c})</option>)}</select></Field>
        <div className="field"><span>דירוג לפי</span><Seg label="תקופה" value={per} onChange={(v) => set({ per: v })} options={PERIODS} /></div>
        <Field label="חיפוש"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם קופה או גוף" /></Field>
        <button type="button" className="chip" aria-pressed={closed} onClick={() => setClosed(!closed)}>כולל קופות ענפיות ומפעליות</button>
      </section>

      <Panel title={`${prod} · ${T}`} aside={<><span>{rows.n} מדורגים</span><span className="chip">3Y ו-5Y: שנתי ממוצע</span><span>סמן עד 6 להשוואה</span></>}>
        {rows.list.length === 0 ? <Empty title="אין מסלולים בסינון הזה" /> : (
          <div className="scroll" style={{ maxHeight: 640 }}><table className="rank">
            <thead><tr><th>מסלול</th><th>#</th>{PERIODS.map(([k, l]) => <th key={k} className={k === per ? '' : 'wide-only'}>{l}</th>)}<th>דמי ניהול</th><th className="wide-only">נכסים, מיליוני ש"ח</th><th className="wide-only">שארפ</th><th className="wide-only">מניות</th></tr></thead>
            <tbody>
              {cat && <tr className="lead"><td>ממוצע המסלול<span className="dim">משוקלל נכסים · נגזר</span></td><td></td>{PERIODS.map(([k]) => <td key={k} className={k === per ? '' : 'wide-only'}><P v={catReturn(cat, k, asof)} /></td>)}<td></td><td className="wide-only"><span className="num">{nf(members.reduce((t, f) => t + (f.assets ?? 0), 0), 0)}</span></td><td className="wide-only"></td><td className="wide-only"></td></tr>}
              {rows.list.map(({ f, rank }) => (
                <tr key={f.k}>
                  <td><span style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={sel.includes(f.k)} onChange={() => toggle(f.k)} aria-label={`השווה את ${f.name}`} style={{ marginTop: 4, accentColor: 'var(--accent)' }} />
                    <span><Link className="name" to={`/funds/${f.k}`}>{f.name}</Link>{f.closed && <span className="chip" style={{ marginInlineStart: 6 }}>סגורה</span>}<span className="dim">{f.grp}</span></span></span></td>
                  <td><span className="num muted">{rank ?? '–'}</span></td>
                  {PERIODS.map(([k]) => <td key={k} className={k === per ? '' : 'wide-only'}><P v={f[k]} /></td>)}
                  <td>{f.fee == null ? <span className="muted">–</span> : <span className="num">{nf(f.fee, 2)}%</span>}</td>
                  <td className="wide-only"><span className="num">{f.assets == null ? '–' : nf(f.assets, 0)}</span></td>
                  <td className="wide-only"><span className="num">{f.sharpe == null ? '–' : nf(f.sharpe, 2)}</span></td>
                  <td className="wide-only"><span className="num">{f.st == null ? '–' : `${nf(f.st, 0)}%`}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>

      {picked.length > 0 && (
        <Panel title="השוואה" aside={<><Seg label="חלון" value={win} onChange={setWin} options={WINDOWS} /><button type="button" className="chip" onClick={() => set({ sel: '' })}>נקה</button></>}>
          <Growth periods={axis} deps={[sel.join(), win, Object.keys(hist).length]} lines={[...picked.map((f) => ({ name: f.name, data: rebased(axis, hist[f.k]) })), ...(cat ? [{ name: 'ממוצע המסלול', data: rebased(axis, cat), dash: true }] : [])]} />
          <div className="scroll"><table>
            <thead><tr><th>מסלול</th><th>תשואה בחלון</th><th>שנתי</th><th>תנודתיות, שנתי</th><th>ירידה מרבית</th><th>חודש טוב</th><th>חודש גרוע</th><th>דמי ניהול</th><th>חודשים</th></tr></thead>
            <tbody>{picked.map((f) => { const s = stats(hist[f.k].y, Math.max(1, axis.length - 1)); return (
              <tr key={f.k}><td><Link to={`/funds/${f.k}`}>{f.name}</Link></td><td><P v={s?.ret} /></td><td><P v={s?.ann} /></td><td><span className="num">{s ? `${nf(s.vol, 1)}%` : '–'}</span></td><td><P v={s?.dd} /></td><td><P v={s?.best} /></td><td><P v={s?.worst} /></td><td><span className="num">{f.fee == null ? '–' : `${nf(f.fee, 2)}%`}</span></td><td><span className="num muted">{s?.months ?? '–'}</span></td></tr>
            ); })}</tbody>
          </table></div>
          <div className="src">תשואה, תנודתיות וירידה מרבית מחושבות מהתשואות החודשיות שפורסמו. החלון מתחיל במועד שבו לכל המסלולים שנבחרו יש נתונים.</div>
        </Panel>
      )}
    </>
  );
}

/** One track: its record against the category, year by year, with exposure and money flows. */
export function FundCard() {
  const { k = '' } = useParams();
  const { data, error } = useFunds();
  const hist = useFundHist(k);
  const cats = useFundCats().data;
  const [win, setWin] = useState<Win>('60');
  const f = data?.funds.find((x) => x.k === k);
  const h = hist.data;
  const cat = f && cats ? cats[catKey(f)] : undefined;
  // ranked against the tracks open to everyone, as in the table
  const peers = useMemo(() => (data && f ? data.funds.filter((x) => catKey(x) === catKey(f) && (f.closed || !x.closed)) : []), [data, f]);
  const years = useMemo(() => {
    if (!h) return [];
    const by = (s: { p: number[]; y: (number | null)[] }) => { const m = new Map<number, number[]>(); s.p.forEach((p, i) => { const r = s.y[i]; if (r != null) m.set(Math.floor(p / 100), [...(m.get(Math.floor(p / 100)) ?? []), r]); }); return m; };
    const mine = by(h), theirs = cat ? by(cat) : new Map<number, number[]>();
    const comp = (xs: number[] | undefined) => (xs ? (xs.reduce((t, r) => t * (1 + r / 100), 1) - 1) * 100 : null);
    return [...mine.keys()].sort((a, b) => b - a).map((y) => ({ y, n: mine.get(y)!.length, me: comp(mine.get(y)), cat: theirs.get(y)?.length === mine.get(y)!.length ? comp(theirs.get(y)) : null }));
  }, [h, cat]);

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data || (!h && !hist.error)) return <Loading what="מסלול" />;
  if (!f || !h) return <Empty title="המסלול לא נמצא או אינו פעיל"><Link to="/funds">לכל המסלולים</Link></Empty>;
  const n = win === 'max' ? h.p.length - 1 : Math.min(Number(win), h.p.length - 1);
  const axis = h.p.slice(-(n + 1));
  const s = stats(h.y, n), cs = cat ? stats(cat.y.slice(0, cat.p.indexOf(axis[axis.length - 1]) + 1), n) : null;
  const rankOf = (key: Per) => { const r = peers.filter((x) => x[key] != null).sort((a, b) => b[key]! - a[key]!); const i = r.findIndex((x) => x.k === f.k); return i < 0 ? null : `${i + 1} מתוך ${r.length}`; };
  const last = <T,>(xs: T[]) => xs.slice(-121);

  return (
    <>
      <div className="pagehead"><div><h1>{f.name}</h1><div className="sub"><span>{f.mgr}</span><Link className="chip" to={`/funds?prod=${encodeURIComponent(f.prod)}&track=${encodeURIComponent(f.track)}`}>{f.prod} · {f.track}</Link>{f.closed && <span className="chip">קופה ענפית או מפעלית</span>}<span className="chip">{ym(data.asof)}</span></div></div></div>
      <Sub />
      <section className="kpis">
        <Kpi label="LTM" value={f.y12 == null ? '–' : pct(f.y12, 1, true)} tone={f.y12 == null ? undefined : f.y12 < 0 ? 'neg' : 'pos'} sub={rankOf('y12') ? `מקום ${rankOf('y12')}` : ' '} />
        <Kpi label="3Y, שנתי" value={f.a3 == null ? '–' : pct(f.a3, 1, true)} sub={rankOf('a3') ? `מקום ${rankOf('a3')}` : ' '} />
        <Kpi label="5Y, שנתי" value={f.a5 == null ? '–' : pct(f.a5, 1, true)} sub={rankOf('a5') ? `מקום ${rankOf('a5')}` : ' '} />
        <Kpi label="YTD" value={f.ytd == null ? '–' : pct(f.ytd, 1, true)} sub={rankOf('ytd') ? `מקום ${rankOf('ytd')}` : ' '} />
        <Kpi label="דמי ניהול מצבירה" value={f.fee == null ? '–' : `${nf(f.fee, 2)}%`} sub={f.depfee != null ? `מהפקדה ${nf(f.depfee, 2)}%` : ' '} />
        <Kpi label="נכסים" value={f.assets == null ? '–' : nf(f.assets, 0)} sub={'מיליוני ש"ח'} />
        <Kpi label="שארפ" value={f.sharpe == null ? '–' : nf(f.sharpe, 2)} sub={f.sd != null ? `סטיית תקן ${nf(f.sd, 2)}` : ' '} />
        <Kpi label="חשיפה למניות" value={f.st == null ? '–' : `${nf(f.st, 0)}%`} sub={f.fo != null ? `חו"ל ${nf(f.fo, 0)}% · מט"ח ${f.fx == null ? '–' : nf(f.fx, 0) + '%'}` : ' '} />
      </section>

      <div className="grid21">
        <Panel title="תשואה מצטברת, בסיס 100" aside={<Seg label="חלון" value={win} onChange={setWin} options={WINDOWS} />}>
          <Growth periods={axis} deps={[k, win, h.p.length, !!cat]} lines={[{ name: f.name, data: rebased(axis, h) }, ...(cat ? [{ name: `ממוצע ${f.track}`, data: rebased(axis, cat), dash: true }] : [])]} />
          <div className="scroll"><table>
            <thead><tr><th>{ym(axis[0])} עד {ym(axis[axis.length - 1])} <span className="chip est">נגזר</span></th><th>תשואה</th><th>שנתי</th><th>תנודתיות, שנתי</th><th>ירידה מרבית</th><th>חודש טוב</th><th>חודש גרוע</th></tr></thead>
            <tbody>
              <tr><td>המסלול</td><td><P v={s?.ret} /></td><td><P v={s?.ann} /></td><td><span className="num">{s ? `${nf(s.vol, 1)}%` : '–'}</span></td><td><P v={s?.dd} /></td><td><P v={s?.best} /></td><td><P v={s?.worst} /></td></tr>
              {cs && <tr><td>ממוצע {f.track}</td><td><P v={cs.ret} /></td><td><P v={cs.ann} /></td><td><span className="num">{nf(cs.vol, 1)}%</span></td><td><P v={cs.dd} /></td><td><P v={cs.best} /></td><td><P v={cs.worst} /></td></tr>}
            </tbody>
          </table></div>
        </Panel>
        <Panel title="לפי שנה" aside={<span className="chip est">נגזר מתשואות חודשיות</span>}>
          <div className="scroll" style={{ maxHeight: 470 }}><table>
            <thead><tr><th>שנה</th><th>המסלול</th><th>ממוצע המסלולים</th><th>פער</th></tr></thead>
            <tbody>{years.map((r) => <tr key={r.y}><td><span className="num">{r.y}</span>{r.n < 12 && <span className="dim">{r.n} חודשים</span>}</td><td><P v={r.me} /></td><td><P v={r.cat} /></td><td><P v={r.me != null && r.cat != null ? r.me - r.cat : null} /></td></tr>)}</tbody>
          </table></div>
        </Panel>
      </div>

      <div className="grid2">
        <Panel title="חשיפות" aside={<span>% מהנכסים · 10 שנים</span>}>
          <Chart label="חשיפות" height={260} deps={[k, h.p.length]} build={() => {
            const b = chartBase(), pal = palette();
            const line = (name: string, data: (number | null)[], i: number) => ({ name, type: 'line', data: last(data), symbol: 'none', connectNulls: true, lineStyle: { width: 2, color: pal[i] }, itemStyle: { color: pal[i] } });
            return { animationDuration: 700, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 6, right: 12, top: 30, bottom: 4, containLabel: true }, legend: { top: 0, textStyle: { color: b.mu, fontSize: 11 }, itemWidth: 14, itemHeight: 3 },
              tooltip: { trigger: 'axis', confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: (v: number | null) => (v == null ? '–' : `${nf(v, 1)}%`) },
              xAxis: { type: 'category', data: last(h.p).map(ym), boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } }, axisLabel: { color: b.mu, fontSize: 10, hideOverlap: true } },
              yAxis: { type: 'value', axisLabel: { color: b.mu, fontSize: 10 }, splitLine: { lineStyle: { color: b.ln, opacity: 0.5 } } },
              series: [line('מניות', h.st, 0), line('חו"ל', h.fo, 1), line('מט"ח', h.fx, 2)] };
          }} />
        </Panel>
        <Panel title="נכסים ודמי ניהול" aside={<span>מיליוני ש"ח · 10 שנים</span>}>
          <Chart label="נכסים" height={260} deps={[k, h.p.length]} build={() => {
            const b = chartBase();
            return { animationDuration: 700, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 6, right: 6, top: 30, bottom: 4, containLabel: true }, legend: { top: 0, textStyle: { color: b.mu, fontSize: 11 }, itemWidth: 14, itemHeight: 3 },
              tooltip: { trigger: 'axis', confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 } },
              xAxis: { type: 'category', data: last(h.p).map(ym), axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } }, axisLabel: { color: b.mu, fontSize: 10, hideOverlap: true } },
              yAxis: [{ type: 'value', axisLabel: { color: b.mu, fontSize: 10 }, splitLine: { lineStyle: { color: b.ln, opacity: 0.5 } } }, { type: 'value', axisLabel: { color: b.mu, fontSize: 10, formatter: '{value}%' }, splitLine: { show: false } }],
              series: [{ name: 'נכסים', type: 'bar', data: last(h.a), itemStyle: { color: b.mu, opacity: 0.45 }, barCategoryGap: '10%' }, { name: 'דמי ניהול מצבירה', type: 'line', yAxisIndex: 1, data: last(h.fee), symbol: 'none', connectNulls: true, lineStyle: { width: 2, color: b.accent }, itemStyle: { color: b.accent } }] };
          }} />
        </Panel>
      </div>
      {h.dep && (
        <Panel title="תזרים, LTM" aside={<span>מיליוני ש"ח</span>}>
          <section className="kpis" style={{ border: 0, boxShadow: 'none', background: 'none' }}>
            {([['הפקדות', h.dep], ['משיכות', h.wd!], ['העברות נטו', h.tr!]] as const).map(([l, xs]) => { const v = xs.slice(-12).reduce((t: number, x) => t + (x ?? 0), 0); return <Kpi key={l} label={l} value={nf(l === 'משיכות' ? -v : v, 0)} tone={l === 'העברות נטו' ? (v < 0 ? 'neg' : 'pos') : undefined} />; })}
            <Kpi label="צבירה נטו" value={nf([h.dep, h.wd!, h.tr!].reduce((t, xs, i) => t + (i === 1 ? -1 : 1) * xs.slice(-12).reduce((u: number, x) => u + (x ?? 0), 0), 0), 0)} />
          </section>
        </Panel>
      )}
    </>
  );
}
