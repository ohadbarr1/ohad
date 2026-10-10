import { foxOption } from '../lib/foxchart';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, Kpi, Loading, Panel, Seg } from '../components/ui';
import { chartBase, palette } from '../lib/theme';
import { nf, pct } from '../lib/format';
import { load, useFundCats, useFundHist, useFunds, useRegistry, type Fund, type FundCats, type FundHist } from '../lib/useData';

const PRODUCTS = ['גמל', 'השתלמות', 'גמל להשקעה', 'חיסכון לילד', 'פנסיה מקיפה', 'פנסיה כללית', 'פוליסות חיסכון', 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים', 'ביטוחי מנהלים 1992-2003', 'ביטוחי מנהלים 1990-1991', 'מרכזית לפיצויים', 'גמל, מטרה אחרת'];
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
      <NavLink to="/funds/makers">יצרן מול השוק</NavLink>
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
      return foxOption({ x: periods.map(ym), unit: 'בסיס 100', dense: true, scale: true, legend: true,
        series: lines.map((l, i) => ({ name: l.name, data: l.data, kind: 'line' as const, dashed: l.dash, color: l.dash ? b.mu : pal[i % pal.length], dec: 1 })) });
            }} />
  );
}

/** Every savings track the regulator publishes, compared inside its own product and track. */
export function Funds({ makersOnly = false }: { makersOnly?: boolean }) {
  const { data, error } = useFunds();
  const cats = useFundCats().data;
  const [sp, setSp] = useSearchParams();
  const prod = sp.get('prod') ?? 'השתלמות', track = sp.get('track') ?? 'כללי', per = (sp.get('per') as Per) ?? 'y12';
  const sel = useMemo(() => (sp.get('sel') ?? '').split(',').filter(Boolean), [sp]);
  const [closed, setClosed] = useState(false);
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [win, setWin] = useState<Win>('60');
  const set = (patch: Record<string, string>) => { const next = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k))); setSp(next, { replace: true }); };

  const all = data?.funds ?? [];
  const tracks = useMemo(() => { const m = new Map<string, number>(); all.filter((f) => f.prod === prod).forEach((f) => m.set(f.track, (m.get(f.track) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [all, prod]);
  const ALL = 'all';
  const T = makersOnly || track === ALL || tracks.some(([t]) => t === track) ? (makersOnly ? ALL : track) : tracks[0]?.[0] ?? '';
  const [open, setOpen] = useState<string[]>([]);
  // one group per track; a single track is the same table with one group
  const groups = useMemo(() => {
    const t = q.trim();
    return (T === ALL ? tracks.map(([x]) => x) : [T]).map((tr) => {
      const shown = all.filter((f) => f.prod === prod && f.track === tr && (closed || !f.closed));  // the rank is among the tracks on screen
      const ranked = shown.filter((f) => f[per] != null).sort((a, b) => b[per]! - a[per]!);
      const rank = new Map(ranked.map((f, i) => [f.k, i + 1]));
      const list = [...ranked, ...shown.filter((f) => f[per] == null)].filter((f) => !t || f.name.includes(t) || f.mgr.includes(t) || f.grp.includes(t)).map((f) => ({ f, rank: rank.get(f.k) ?? null }));
      return { tr, list, n: ranked.length, assets: shown.reduce((u, f) => u + (f.assets ?? 0), 0), cat: cats?.[`${prod} | ${tr}`] };
    }).filter((g) => g.list.length).sort((x, y) => y.assets - x.assets);
  }, [all, tracks, T, prod, per, closed, q, cats]);
  const rows = { n: groups.reduce((u, g) => u + g.n, 0) };
  // the highlighted manufacturer may arrive as a company id (from search or a company page) or as the group name
  const regs = useRegistry().data;
  const mk = sp.get('mk') ?? '';
  const maker = regs?.find((c) => c.id === mk)?.market_group ?? mk;
  // manufacturer against the market: where each managing group stands in every track (its largest track there, ranked on the chosen period)
  const makers = useMemo(() => {
    const size = new Map<string, number>();
    groups.forEach((g) => g.list.forEach(({ f }) => size.set(f.grp, (size.get(f.grp) ?? 0) + (f.assets ?? 0))));
    const top = [...size.entries()].filter(([n]) => n !== 'קרנות ענפיות ואחרות').sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n]) => n);
    // the chosen manufacturer leads, so it is the first column on a phone, and is shown even when it is not among the largest
    const names = maker && size.has(maker) ? [maker, ...top.filter((n) => n !== maker)] : top;
    const cell = (g: typeof groups[number], name: string) => g.list.filter((x) => x.f.grp === name && x.rank != null).sort((a, b) => (b.f.assets ?? 0) - (a.f.assets ?? 0))[0] ?? null;
    const score = names.map((name) => { const c = groups.map((g) => ({ g, x: cell(g, name) })).filter((y) => y.x && y.g.n >= 4); return { n: c.length, top: c.filter((y) => y.x!.rank! <= Math.ceil(y.g.n / 4)).length }; });
    return { names, cell, score };
  }, [groups, maker]);

  const cat = T === ALL ? undefined : cats?.[`${prod} | ${T}`];

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
      <div className="pagehead"><div><h1>{makersOnly ? 'יצרן מול השוק' : 'קופות ומסלולים'}</h1><div className="sub">{nf(all.length, 0)} מסלולים · {ym(asof)} · {data.source}</div></div></div>
      <Sub />
      <section className="controls">
        <Field label="מוצר"><select value={prod} onChange={(e) => set({ prod: e.target.value, track: '', sel: '' })}>{PRODUCTS.filter((p) => all.some((f) => f.prod === p)).map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
        {!makersOnly && <Field label="מסלול"><select value={T} onChange={(e) => set({ track: e.target.value, sel: '' })}><option value={ALL}>כל המסלולים ({tracks.reduce((u, [, c]) => u + c, 0)})</option>{tracks.map(([t, c]) => <option key={t} value={t}>{t} ({c})</option>)}</select></Field>}
        <div className="field"><span>דירוג לפי</span><Seg label="תקופה" value={per} onChange={(v) => set({ per: v })} options={PERIODS} /></div>
        {!makersOnly && <Field label="חיפוש"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם קופה או גוף" /></Field>}
        <button type="button" className="chip" aria-pressed={closed} onClick={() => setClosed(!closed)}>כולל קופות ענפיות ומפעליות</button>
      </section>

      {T === ALL && makers.names.length > 0 && (
        <Panel title="יצרן מול השוק" aside={<><span>מקום בכל מסלול לפי {PERIODS.find(([k]) => k === per)?.[1]} · המסלול הגדול של היצרן</span><span className="chip est">נגזר</span></>}>
          <div className="scroll"><table className="heat">
            <thead><tr><th>מסלול</th>{makers.names.map((n) => <th key={n} className={n === maker ? 'on' : ''}><button type="button" className="thbtn" aria-pressed={n === maker} onClick={() => set({ mk: n === maker ? '' : n })}>{n}</button></th>)}</tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.tr}>
                  <td><Link className="name" to={`/funds?prod=${encodeURIComponent(prod)}&track=${encodeURIComponent(g.tr)}`}>{g.tr}</Link> <span className="muted num">{g.n}</span></td>
                  {makers.names.map((n) => { const x = makers.cell(g, n); const q4 = x && g.n >= 4 ? (x.rank! <= Math.ceil(g.n / 4) ? 'pos' : x.rank! > g.n - Math.floor(g.n / 4) ? 'neg' : '') : '';
                    return <td key={n} className={`${n === maker ? 'on' : ''} ${q4 ? 'q-' + q4 : ''}`}>{x ? <Link className="num" to={`/funds/${x.f.k}`} title={`${x.f.name} · ${pct(x.f[per]!, 1, true)} · מקום ${x.rank} מתוך ${g.n}`}>{x.rank}</Link> : <span className="muted">·</span>}</td>; })}
                </tr>
              ))}
              <tr className="tot"><td>רבע עליון</td>{makers.score.map((sc, i) => <td key={i} className={makers.names[i] === maker ? 'on' : ''}><span className="num">{sc.n ? `${sc.top}/${sc.n}` : '–'}</span></td>)}</tr>
            </tbody>
          </table></div>
          <div className="src">ירוק: רבע עליון במסלול. אדום: רבע תחתון. לחיצה על יצרן מדגישה את העמודה שלו; לחיצה על מסלול פותחת את הדירוג המלא.</div>
        </Panel>
      )}

      {!makersOnly && <Panel title={`${prod} · ${T === ALL ? 'כל המסלולים' : T}`} aside={<>{T === ALL && <button type="button" className="chip" onClick={() => setOpen(open.length ? [] : groups.map((g) => g.tr))}>{open.length ? 'כווץ הכול' : 'פתח הכול'}</button>}<span>{rows.n} מדורגים</span><span className="chip">3Y ו-5Y: שנתי ממוצע</span>{prod === 'פוליסות חיסכון' && <span className="chip est" title="ביטוח-נט מפרסם מסלולי השקעה. פוליסת חיסכון וביטוח מנהלים שהונפק מ-2004 מושקעים באותו מסלול, ולכן התשואה זהה; הנכסים ודמי הניהול הממוצעים כוללים את שני המוצרים">תשואת המסלול; נכסים ודמי ניהול כוללים גם ביטוחי מנהלים מ-2004</span>}{T === ALL && <span>שורת קבוצה: ממוצע המסלול, משוקלל נכסים</span>}<span>סמן עד 6 להשוואה</span></>}>
        {groups.length === 0 ? <Empty title="אין מסלולים בסינון הזה" /> : (
          <div className="scroll" style={{ maxHeight: 640 }}><table className="rank">
            <thead><tr><th>מסלול</th><th>#</th>{PERIODS.map(([k, l]) => <th key={k} className={k === per ? '' : 'wide-only'}>{l}</th>)}<th>דמי ניהול</th><th className="wide-only">נכסים, מיליוני ש"ח</th><th className="wide-only">שארפ</th><th className="wide-only">מניות</th><th className="wide-only" title="בכמה מחמש השנים הקלנדריות המלאות האחרונות המסלול סיים ברבע העליון של המסלולים בקטגוריה">רבע עליון <span className="chip est">נגזר</span></th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.tr}>
                  {T === ALL && (
                    <tr className="sec grp" onClick={() => setOpen(open.includes(g.tr) ? open.filter((x) => x !== g.tr) : [...open, g.tr])} aria-expanded={open.includes(g.tr)}>
                      <td><button type="button" className="twist" aria-label={open.includes(g.tr) ? `כווץ את ${g.tr}` : `פתח את ${g.tr}`}>{open.includes(g.tr) ? '▾' : '◂'}</button>{g.tr} <span className="muted" style={{ fontWeight: 400 }}>· {g.list.length}</span></td>
                      <td></td>{PERIODS.map(([k]) => <td key={k} className={k === per ? '' : 'wide-only'}><P v={catReturn(g.cat, k, asof)} /></td>)}<td></td>
                      <td className="wide-only"><span className="num">{nf(g.assets, 0)}</span></td><td className="wide-only"></td><td className="wide-only"></td><td className="wide-only"></td>
                    </tr>
                  )}
                  {g.cat && T !== ALL && <tr className="lead"><td>ממוצע המסלול<span className="dim">משוקלל נכסים · נגזר</span></td><td></td>{PERIODS.map(([k]) => <td key={k} className={k === per ? '' : 'wide-only'}><P v={catReturn(g.cat, k, asof)} /></td>)}<td></td><td className="wide-only"><span className="num">{nf(g.assets, 0)}</span></td><td className="wide-only"></td><td className="wide-only"></td><td className="wide-only"></td></tr>}
              {(T !== ALL || open.includes(g.tr)) && g.list.map(({ f, rank }) => (
                <tr key={f.k}>
                  <td><span style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={sel.includes(f.k)} onChange={() => toggle(f.k)} aria-label={`השווה את ${f.name}`} style={{ marginTop: 4, accentColor: 'var(--accent)' }} />
                    <span><Link className="name" to={`/funds/${f.k}`}>{f.name}</Link>{f.closed && <span className="chip" style={{ marginInlineStart: 6 }}>סגורה</span>}<span className="dim">{f.grp}</span></span></span></td>
                  <td><span className="num muted">{rank ?? '–'}</span></td>
                  {PERIODS.map(([k]) => <td key={k} className={k === per ? '' : 'wide-only'}><P v={f[k]} /></td>)}
                  <td>{f.fee == null ? <span className="muted">–</span> : <span className="num">{nf(f.fee, 2)}%</span>}</td>
                  <td className="wide-only"><span className="num">{f.assets == null ? '–' : nf(f.assets, 0)}</span></td>
                  <td className="wide-only"><span className="num">{f.sharpe == null ? '–' : nf(f.sharpe, 2)}</span></td>
                  <td className="wide-only"><span className="num">{f.st == null ? '–' : `${nf(f.st, 0)}%`}</span></td>
                  <td className="wide-only">{f.yrs ? <span className={`num ${f.top! * 2 > f.yrs ? 'pos' : ''}`}>{f.top}/{f.yrs}</span> : <span className="muted">–</span>}</td>
                </tr>
              ))}
                </Fragment>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>}

      {!makersOnly && picked.length > 0 && (
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
  const company = useRegistry().data?.find((c) => f && c.market_group === f.grp);
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
      <div className="pagehead"><div><h1>{f.name}</h1><div className="sub"><span>{f.mgr}</span>{company && <Link className="chip" to={`/company/${company.id}`}>עמוד החברה: {company.name_he}</Link>}<Link className="chip" to={`/funds?prod=${encodeURIComponent(f.prod)}&track=${encodeURIComponent(f.track)}`}>{f.prod} · {f.track}</Link>{f.closed && <span className="chip">קופה ענפית או מפעלית</span>}<span className="chip">{ym(data.asof)}</span></div></div></div>
      <Sub />
      <section className="kpis">
        <Kpi label="LTM" value={f.y12 == null ? '–' : pct(f.y12, 1, true)} tone={f.y12 == null ? undefined : f.y12 < 0 ? 'neg' : 'pos'} sub={rankOf('y12') ? `מקום ${rankOf('y12')}` : ' '} />
        <Kpi label="3Y, שנתי" value={f.a3 == null ? '–' : pct(f.a3, 1, true)} sub={rankOf('a3') ? `מקום ${rankOf('a3')}` : ' '} />
        <Kpi label="5Y, שנתי" value={f.a5 == null ? '–' : pct(f.a5, 1, true)} sub={rankOf('a5') ? `מקום ${rankOf('a5')}` : ' '} />
        <Kpi label="YTD" value={f.ytd == null ? '–' : pct(f.ytd, 1, true)} sub={rankOf('ytd') ? `מקום ${rankOf('ytd')}` : ' '} />
        <Kpi label="דמי ניהול מצבירה" value={f.fee == null ? '–' : `${nf(f.fee, 2)}%`} sub={f.depfee != null ? `מהפקדה ${nf(f.depfee, 2)}%` : ' '} />
        <Kpi label="נכסים" value={f.assets == null ? '–' : nf(f.assets, 0)} sub={'מיליוני ש"ח'} />
        <Kpi label="שארפ" value={f.sharpe == null ? '–' : nf(f.sharpe, 2)} sub={f.yrs ? `רבע עליון ב-${f.top} מתוך ${f.yrs} שנים` : f.sd != null ? `סטיית תקן ${nf(f.sd, 2)}` : ' '} />
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
            const pal = palette();
            return foxOption({ x: last(h.p).map(ym), unit: '%', dense: true, full: true,
              series: ([['מניות', h.st], ['חו"ל', h.fo], ['מט"ח', h.fx]] as [string, (number | null)[]][]).map(([name, data], i) => ({ name, data: last(data), kind: 'line' as const, pct: true, color: pal[i] })) });
            }} />
        </Panel>
        <Panel title="נכסים ודמי ניהול" aside={<span>מיליוני ש"ח · 10 שנים</span>}>
          <Chart label="נכסים" height={260} deps={[k, h.p.length]} build={() => {
            const b = chartBase();
            return foxOption({ x: last(h.p).map(ym), unit: 'מיליוני ש"ח', dense: true, full: true, series: [
              { name: 'נכסים', data: last(h.a), kind: 'bar', color: b.mu, opacity: 0.45, dec: 0 },
              { name: 'דמי ניהול מצבירה', data: last(h.fee), kind: 'line', pct: true, color: b.accent, dec: 2 }] });
            }} />
        </Panel>
      </div>
      <Panel title="פרטי המסלול" aside={<span>כפי שמדווח לרשות שוק ההון</span>}>
        <div className="scroll"><table>
          <tbody>
            {([['מספר ברשות', String(f.id)], ['סיווג', f.cls], ['התמחות', [f.spec, f.sub].filter(Boolean).join(' · ') || null], ['אוכלוסיית יעד', f.target], ['מועד הקמה', f.since ? f.since.slice(0, 10) : null], ['גוף מנהל', f.mgr], ['תאגיד שולט', f.ctrl],
              ['נכסים נזילים', f.liq == null ? null : `${nf(f.liq, 1)}%`], ['חשיפה למניות', f.st == null ? null : `${nf(f.st, 1)}%`], ['חשיפה לחו"ל', f.fo == null ? null : `${nf(f.fo, 1)}%`], ['חשיפה למט"ח', f.fx == null ? null : `${nf(f.fx, 1)}%`],
              ['היסטוריה', `${f.n} חודשים, מ-${ym(h.p[0])}`]] as [string, string | null][]).filter(([, x]) => x).map(([l, x]) => <tr key={l}><td className="muted">{l}</td><td style={{ textAlign: 'start' }}>{x}</td></tr>)}
          </tbody>
        </table></div>
        <div className="src">הרכב נכסים מפורט ומדיניות השקעה מוצהרת אינם במאגרי הרשות הפתוחים; הם מתפרסמים באתר של כל גוף מנהל.</div>
      </Panel>
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

/** Every managing group against the whole market: its place in each track of a product, on one screen. */
export function FundMakers() { return <Funds makersOnly />; }
