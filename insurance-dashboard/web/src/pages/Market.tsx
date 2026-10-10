import { foxOption } from '../lib/foxchart';
import { useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, Kpi, Loading, Panel, Seg, copyText } from '../components/ui';
import { CHART_FONT, chartBase, cssVar, palette } from '../lib/theme';
import { METRIC_BY_KEY, METRIC_DEFS, WIN_LABEL, type Market, type MetricKey, type Win } from '../lib/market';
import { cls, nf, pct, sn } from '../lib/format';
import { useMarket } from '../lib/useData';
import type { Fund } from '../lib/types';

function fmtMetric(key: MetricKey, v: number | null, signed = false): string {
  if (v == null || Number.isNaN(v)) return '–';
  const def = METRIC_BY_KEY[key];
  const d = def.dec ?? (def.unit === '%' ? 1 : Math.abs(v) < 10 ? 2 : 1);
  return (signed ? sn(v, d) : nf(v, d)) + (def.unit === '%' ? '%' : '');
}
const signedKey = (k: MetricKey) => k !== 'assets' && k !== 'share' && k !== 'fee';
const toneOf = (k: MetricKey, v: number | null) => (signedKey(k) ? cls(v) : '');

function useM() {
  const { market, error } = useMarket();
  return { market, error };
}
function Gate({ children }: { children: (m: Market) => JSX.Element }) {
  const { market, error } = useM();
  if (error) return <ErrorBox what="נתוני שוק" error={error} />;
  if (!market) return <Loading what="נתוני שוק" />;
  return children(market);
}

export function MarketLayout() {
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>שוק החיסכון הפנסיוני</h1>
          <div className="sub">פנסיה, גמל והשתלמות, ביטוחי מנהלים ופוליסות חיסכון · נתוני הרשות לשוק ההון · מיליארדי ש"ח</div>
        </div>
      </div>
      <nav className="subnav" aria-label="שוק">
        <NavLink to="/funds">מסלולים</NavLink>
        <NavLink to="/funds/makers">יצרן מול השוק</NavLink>
        <NavLink to="overview">סקירה</NavLink>
        <NavLink to="ranking">דירוג חברות</NavLink>
        <NavLink to="funds">קופות</NavLink>
        <NavLink to="/managers">מנהלים</NavLink>
      </nav>
      <Outlet />
    </>
  );
}


/* ---------- overview ---------- */
export function MarketOverview() {
  return <Gate>{(m) => <OverviewInner m={m} />}</Gate>;
}
function OverviewInner({ m }: { m: Market }) {
  const L = m.LAST;
  const fams = ['pension', 'gemel', 'insurance'] as const;
  const tot = m.cell(L, 'all', -1).a, tot12 = m.cell(L - 12, 'all', -1).a;
  const fo = m.flows(L, 'ltm', 'fam:pension', -1), fg = m.flows(L, 'ltm', 'fam:gemel', -1);
  const rows = m.d.products.map((p, i) => ({ p, id: 'p:' + p.key, i })).filter((r) => m.cell(L, r.id, -1).a > 0);
  const cols: MetricKey[] = ['assets', 'growth', 'organic', 'fee', 'ret'];
  const colors = () => [cssVar('--s1'), cssVar('--s2'), cssVar('--s3')];

  return (
    <>
      <section className="kpis">
        <Kpi label="סך נכסים" value={nf(tot / 1000, 0)} sub={`מיליארד ש"ח · ${m.plabel(L)}`} />
        <Kpi label="שינוי YoY" value={pct((tot / tot12 - 1) * 100, 1, true)} tone="pos" sub="תשואה, צבירה והעברות תיקים" />
        {fams.map((f) => {
          const g = m.growth(L, 'ltm', 'fam:' + f, -1);
          return <Kpi key={f} label={m.d.families[f]} value={nf(m.cell(L, 'fam:' + f, -1).a / 1000, 0)} sub={<>מיליארד ש"ח · <span className="num">{pct(g, 1, true)}</span> YoY</>} />;
        })}
        {fo && fg && <Kpi label="צבירה אורגנית, LTM (פנסיה וגמל)" value={sn((fo.org + fg.org) / 1000, 1)} sub={'מיליארד ש"ח, לפני העברות (ניוד)'} />}
      </section>
      <div className="grid21">
        <Panel title='נכסים לפי משפחת מוצר (מיליארד ש"ח)'>
          <Chart label="נכסים לפי משפחת מוצר" height={330} deps={[m]} build={() => {
            const c = colors();
            return foxOption({ x: m.P.map((_, i) => m.plabel(i)), unit: 'מיליארד ש"ח', dense: true, full: true, total: true,
              series: fams.map((f, k) => ({ name: m.d.families[f], kind: 'line' as const, area: true, stack: true, color: c[k], dec: 0, data: m.P.map((_, i) => +(m.cell(i, 'fam:' + f, -1).a / 1000).toFixed(1)) })) });
            }} />
        </Panel>
        <Panel title='צבירה אורגנית LTM (מיליארד ש"ח)'>
          <Chart label="צבירה אורגנית" height={330} deps={[m]} build={() => {
            const c = colors();
            return foxOption({ x: m.P.map((_, i) => m.plabel(i)), unit: 'מיליארד ש"ח', dense: true,
              series: (['pension', 'gemel'] as const).map((f, k) => ({ name: m.d.families[f], kind: 'line' as const, color: c[k], dec: 1, data: m.P.map((_, i) => { const x = m.flows(i, 'ltm', 'fam:' + f, -1); return x ? +(x.org / 1000).toFixed(1) : null; }) })) });
            }} />
          <div className="src">פנסיה-נט אינו מפרסם הפקדות ומשיכות לפני אמצע 2016. ביטוח-נט אינו כולל תזרימים.</div>
        </Panel>
      </div>
      <Panel title={`לפי מוצר, ${m.plabel(L)}`}>
        <div className="scroll"><table>
          <thead><tr><th>מוצר</th>{cols.map((c) => <th key={c}>{METRIC_BY_KEY[c].short}{METRIC_BY_KEY[c].win && <><br />LTM</>}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.p.label}</td>{cols.map((c) => { const v = m.value(c, L, 'ltm', r.id, -1); return <td key={c}><span className={`num ${toneOf(c, v)}`}>{fmtMetric(c, v, signedKey(c))}</span></td>; })}</tr>
          ))}</tbody>
        </table></div>
        <div className="src">תשואה משוקללת בנכסים ומושפעת מהרכב המסלולים. שינוי בנכסים כולל תשואה, צבירה והעברות תיקים.</div>
      </Panel>
    </>
  );
}

/* ---------- ranking ---------- */
export function MarketRanking() {
  return <Gate>{(m) => <RankingInner m={m} />}</Gate>;
}
function RankingInner({ m }: { m: Market }) {
  const [pi, setPi] = useState(m.LAST);
  const [set, setSet] = useState('all');
  const [metric, setMetric] = useState<MetricKey>('assets');
  const [win, setWin] = useState<Win>('ltm');
  const [copied, setCopied] = useState('העתק לאקסל');
  const def = METRIC_BY_KEY[metric];
  const mkt = m.value(metric, pi, win, set, -1);
  const data = useMemo(() => m.activeGroups(pi, set)
    .map((g) => ({ g: m.d.groups[g], v: m.value(metric, pi, win, set, g) }))
    .filter((x): x is { g: string; v: number } => x.v != null && !Number.isNaN(x.v))
    .sort((a, b) => b.v - a.v), [m, pi, set, metric, win]);
  const tableCols: MetricKey[] = ['assets', 'share', 'growth', 'organic', 'rate', 'fee', 'ret'];
  const groups = m.activeGroups(pi, set).sort((a, b) => m.cell(pi, set, b).a - m.cell(pi, set, a).a);
  const dec = def.dec ?? 1;

  const copy = () => {
    const head = ['קבוצה', ...tableCols.map((c) => METRIC_BY_KEY[c].label)].join('\t');
    const body = groups.map((g) => [m.d.groups[g], ...tableCols.map((c) => { const v = m.value(c, pi, win, set, g); return v == null ? '' : v.toFixed(4); })].join('\t'));
    copyText([head, ...body].join('\n'), (ok) => { setCopied(ok ? 'הועתק' : 'ההעתקה נחסמה'); setTimeout(() => setCopied('העתק לאקסל'), 1600); });
  };

  return (
    <>
      <section className="controls">
        <Field label="חודש"><select value={pi} onChange={(e) => setPi(+e.target.value)}>{m.P.map((_, i) => m.P.length - 1 - i).map((i) => <option key={i} value={i}>{m.plabel(i)}</option>)}</select></Field>
        <Field label="מוצר"><select value={set} onChange={(e) => setSet(e.target.value)}>{m.sets.map((s) => <option key={s.id} value={s.id}>{s.sub ? '  ' : ''}{s.label}</option>)}</select></Field>
        <Field label="מדד"><select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>{METRIC_DEFS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></Field>
        {def.win && <div className="field"><span>חלון</span><Seg<Win> label="חלון" value={win} onChange={setWin} options={[['m', 'חודש'], ['ytd', 'YTD'], ['ltm', 'LTM']]} /></div>}
      </section>
      <Panel title={`${def.label}${def.win ? ' · ' + WIN_LABEL[win] : ''} · ${m.plabel(pi)}`} aside={<>כלל השוק: <b className={`num ${toneOf(metric, mkt)}`}>{fmtMetric(metric, mkt, signedKey(metric))}</b>{def.unit === 'bn' && ' מיליארד ש"ח'}</>}>
        {data.length === 0 ? <Empty title="אין נתון זמין לבחירה זו">תזרימים מפורסמים לפנסיה וגמל בלבד, ופנסיה-נט מתחיל באמצע 2016.</Empty> : (
          <Chart label="דירוג קבוצות" height={Math.max(260, data.length * 32 + 40)} deps={[m, data, mkt, metric]} build={() => {
            const b = chartBase();
            return {
              animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 112, right: 64, top: 12, bottom: 24 },
              tooltip: { trigger: 'item', backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, formatter: (p: { name: string; value: number }) => `${p.name}: <b>${nf(p.value, dec)}${def.unit === '%' ? '%' : ''}</b>` },
              xAxis: { type: 'value', axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
              yAxis: { type: 'category', inverse: true, data: data.map((d) => d.g), axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false }, axisLabel: { color: b.fg, fontSize: 12 } },
              series: [{ type: 'bar', barMaxWidth: 26,
                data: data.map((d) => ({ value: +d.v.toFixed(3), name: d.g, itemStyle: { color: d.v < 0 ? b.down : b.accent } })),
                label: { show: true, position: 'right', color: b.fg, fontSize: 11.5, formatter: (p: { value: number }) => nf(p.value, dec) + (def.unit === '%' ? '%' : '') },
                markLine: def.ratio && mkt != null ? { silent: true, symbol: 'none', label: { show: true, formatter: `שוק ${nf(mkt, dec)}${def.unit === '%' ? '%' : ''}`, color: b.down, fontSize: 11 }, lineStyle: { color: b.down, type: 'dashed' }, data: [{ xAxis: mkt }] } : undefined }],
            };
          }} />
        )}
        <div className="src">{['organic', 'transfers', 'netflow', 'rate'].includes(metric) && 'תזרימים כוללים פנסיה וגמל בלבד. ביטוח-נט אינו מפרסם תזרימים, ופנסיה-נט אינו מפרסם אותם לפני אמצע 2016. '}הקו המקווקו מציג את כלל השוק במוצר שנבחר.</div>
      </Panel>
      <Panel title="כל המדדים לפי קבוצה" aside={<button className="btn" type="button" onClick={copy}>{copied}</button>}>
        <div className="scroll"><table>
          <thead><tr><th>קבוצה</th>{tableCols.map((c) => <th key={c}>{METRIC_BY_KEY[c].short}{METRIC_BY_KEY[c].win && <><br />{WIN_LABEL[win]}</>}</th>)}</tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g}><td><Link to={`/market/group/${encodeURIComponent(m.d.groups[g])}`}>{m.d.groups[g]}</Link></td>
                {tableCols.map((c) => { const v = m.value(c, pi, win, set, g); return <td key={c}><span className={`num ${toneOf(c, v)}`}>{fmtMetric(c, v, signedKey(c))}</span></td>; })}</tr>
            ))}
            <tr className="tot"><td>כלל השוק</td>{tableCols.map((c) => { const v = m.value(c, pi, win, set, -1); return <td key={c}><span className={`num ${toneOf(c, v)}`}>{fmtMetric(c, v, signedKey(c))}</span></td>; })}</tr>
          </tbody>
        </table></div>
      </Panel>
    </>
  );
}

/* ---------- funds ---------- */
type FKey = keyof Fund;
const FCOLS: { k: FKey; label: string; fmt: (f: Fund) => string; tone?: (f: Fund) => string; text?: boolean }[] = [
  { k: 'name', label: 'קופה', fmt: (f) => f.name, text: true }, { k: 'grp', label: 'קבוצה', fmt: (f) => f.grp, text: true },
  { k: 'assets', label: 'נכסים (מיליון ש"ח)', fmt: (f) => (f.assets == null ? '–' : nf(f.assets, 0)) },
  { k: 'fee', label: 'דמי ניהול %', fmt: (f) => (f.fee == null ? '–' : nf(f.fee, 2)) },
  { k: 'ytd', label: 'תשואה YTD %', fmt: (f) => (f.ytd == null ? '–' : sn(f.ytd, 1)), tone: (f) => cls(f.ytd) },
  { k: 'y12', label: 'תשואה LTM %', fmt: (f) => (f.y12 == null ? '–' : sn(f.y12, 1)), tone: (f) => cls(f.y12) },
  { k: 'a3', label: '3Y, שנתי %', fmt: (f) => (f.a3 == null ? '–' : nf(f.a3, 1)) }, { k: 'a5', label: '5Y, שנתי %', fmt: (f) => (f.a5 == null ? '–' : nf(f.a5, 1)) },
  { k: 'sharpe', label: 'שארפ', fmt: (f) => (f.sharpe == null ? '–' : nf(f.sharpe, 2)) },
  { k: 'stock', label: 'חשיפה למניות %', fmt: (f) => (f.stock == null ? '–' : nf(f.stock, 0)) }, { k: 'foreign', label: 'חשיפה לחו"ל %', fmt: (f) => (f.foreign == null ? '–' : nf(f.foreign, 0)) },
  { k: 'net12', label: 'צבירה אורגנית LTM (מיליון ש"ח)', fmt: (f) => (f.net12 == null ? '–' : sn(f.net12, 0)), tone: (f) => cls(f.net12) },
];
export function MarketFunds() {
  return <Gate>{(m) => <FundsInner m={m} />}</Gate>;
}
function FundsInner({ m }: { m: Market }) {
  const [sp] = useSearchParams();
  const [set, setSet] = useState('all');
  const [grp, setGrp] = useState('');
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [sort, setSort] = useState<FKey>('assets');
  const [dir, setDir] = useState(-1);
  const [copied, setCopied] = useState('העתק לאקסל');
  const list = useMemo(() => {
    const s = m.sets.find((x) => x.id === set)!;
    const prodIdx = new Map(m.d.products.map((p, i) => [p.key, i]));
    const L = m.d.funds.filter((f) => s.has.has(prodIdx.get(f.prod)!) && (!grp || f.grp === grp) && (!q.trim() || f.name.includes(q.trim())));
    L.sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return typeof x === 'string' ? dir * x.localeCompare(y as string, 'he') : dir * ((x as number) - (y as number));
    });
    return L;
  }, [m, set, grp, q, sort, dir]);
  const copy = () => {
    const t = FCOLS.map((c) => c.label).join('\t') + '\n' + list.map((f) => FCOLS.map((c) => (f[c.k] ?? '')).join('\t')).join('\n');
    copyText(t, (ok) => { setCopied(ok ? 'הועתק' : 'ההעתקה נחסמה'); setTimeout(() => setCopied('העתק לאקסל'), 1600); });
  };
  return (
    <>
      <section className="controls">
        <Field label="מוצר"><select value={set} onChange={(e) => setSet(e.target.value)}>{m.sets.map((s) => <option key={s.id} value={s.id}>{s.sub ? '  ' : ''}{s.label}</option>)}</select></Field>
        <Field label="קבוצה"><select value={grp} onChange={(e) => setGrp(e.target.value)}><option value="">כל הקבוצות</option>{m.activeGroups(m.LAST, 'all').map((g) => <option key={g} value={m.d.groups[g]}>{m.d.groups[g]}</option>)}</select></Field>
        <Field label="חיפוש בשם קופה"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        <button className="btn" type="button" onClick={copy}>{copied}</button>
      </section>
      <Panel title={`${nf(list.length, 0)} קופות${list.length > 300 ? ' (מוצגות 300 הראשונות)' : ''}`} aside={<>{m.plabel(m.LAST)} · לחיצה על כותרת ממיינת</>}>
        <div className="scroll" style={{ maxHeight: 680 }}>
          <table>
            <thead><tr>{FCOLS.map((c, ci) => <th key={c.k} className="sortable" style={ci === 0 ? { minWidth: 220 } : undefined} tabIndex={0} aria-sort={sort === c.k ? (dir > 0 ? 'ascending' : 'descending') : undefined}
              onClick={() => { if (sort === c.k) setDir(-dir); else { setSort(c.k); setDir(c.text ? 1 : -1); } }}>{c.label}{sort === c.k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
            <tbody>{list.slice(0, 300).map((f) => (
              <tr key={f.fam + f.id}>{FCOLS.map((c) => <td key={c.k}>{c.text ? c.fmt(f) : <span className={`num ${c.tone ? c.tone(f) : ''}`}>{c.fmt(f)}</span>}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/* ---------- group (also embedded in the company "savings" tab) ---------- */
export function MarketGroup() {
  const { name } = useParams();
  return <Gate>{(m) => <GroupPanel m={m} group={decodeURIComponent(name ?? '')} standalone />}</Gate>;
}

const CM: MetricKey[] = ['assets', 'share', 'organic', 'rate', 'fee', 'ret'];
export function GroupPanel({ m, group, standalone = false }: { m: Market; group: string; standalone?: boolean }) {
  const nav = useNavigate();
  const [set, setSet] = useState('all');
  const [metric, setMetric] = useState<MetricKey>('assets');
  const gi = m.groupIndex(group);
  if (gi < 0) return <Empty title="הקבוצה לא נמצאה">אין נתוני שוק לשם זה.</Empty>;
  const L = m.LAST, def = METRIC_BY_KEY[metric], win: Win = def.win ? 'ltm' : 'm';
  const rows = CM.map((k) => {
    const w: Win = METRIC_BY_KEY[k].win ? 'ltm' : 'm';
    return { k, now: m.value(k, L, w, set, gi), prev: L >= 12 ? m.value(k, L - 12, w, set, gi) : null, mk: m.value(k, L, w, set, -1) };
  });
  const dec = def.dec ?? 1;
  const own = m.P.map((_, i) => m.value(metric, i, win, set, gi));
  const mkt = m.P.map((_, i) => m.value(metric, i, win, set, -1));
  const pts = m.P.map((p, i) => (p % 100 === 12 || i === L ? i : -1)).filter((i) => i >= 0);
  const prodIdx = m.d.products.map((_, i) => i).filter((i) => m.sets.find((s) => s.id === set)!.has.has(i) && pts.some((pi) => m.cell(pi, 'p:' + m.d.products[i].key, gi).a > 0));
  const gopts = m.activeGroups(L, 'all').map((g) => m.d.groups[g]);
  if (!gopts.includes(group)) gopts.push(group);

  return (
    <>
      {standalone && <div className="pagehead"><div><h1>{group}</h1><div className="sub">שוק החיסכון הפנסיוני · קבוצה</div></div>
        <Field label="קבוצה"><select value={group} onChange={(e) => nav(`/market/group/${encodeURIComponent(e.target.value)}`)}>{gopts.map((g) => <option key={g}>{g}</option>)}</select></Field></div>}
      <section className="controls"><Field label="מוצר"><select value={set} onChange={(e) => setSet(e.target.value)}>{m.sets.map((s) => <option key={s.id} value={s.id}>{s.sub ? '  ' : ''}{s.label}</option>)}</select></Field></section>
      <div className="grid21">
        <Panel title={def.label} aside={def.unit === 'bn' ? 'מיליארד ש"ח' : def.win ? 'LTM' : undefined}>
          <Chart label="סדרה לאורך זמן" height={320} deps={[m, group, set, metric]} build={() => {
            const b = chartBase(), pct = def.unit === '%';
            return foxOption({ x: m.P.map((_, i) => m.plabel(i)), unit: pct ? '%' : def.unit === 'bn' ? 'מיליארד ש"ח' : '', dense: true, scale: !!def.ratio, legend: true, series: [
              { name: group, kind: 'line', lead: true, pct, color: b.accent, dec, data: own.map((v) => (v == null ? null : +v.toFixed(3))) },
              ...(def.ratio ? [{ name: 'כלל השוק', kind: 'line' as const, dashed: true, pct, color: b.mu, dec, data: mkt.map((v) => (v == null ? null : +v.toFixed(3))) }] : [])] });
            }} />
        </Panel>
        <Panel title={`מדדים, ${m.plabel(L)}`}>
          <div className="scroll"><table>
            <thead><tr><th>מדד</th><th>{m.plabel(L)}</th><th>{m.plabel(L - 12)}</th><th>כלל השוק</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.k} style={{ cursor: 'pointer', background: r.k === metric ? 'var(--accent-soft)' : undefined }} onClick={() => setMetric(r.k)}>
                <td>{METRIC_BY_KEY[r.k].short}{METRIC_BY_KEY[r.k].win && <span className="dim">LTM</span>}</td>
                <td><span className="num">{fmtMetric(r.k, r.now)}</span></td><td><span className="num">{fmtMetric(r.k, r.prev)}</span></td><td><span className="num">{fmtMetric(r.k, r.mk)}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="src">לחיצה על שורה מחליפה את הגרף. תזרימים כוללים פנסיה וגמל בלבד.</div>
        </Panel>
      </div>
      <Panel title={`נכסים לפי מוצר (מיליארד ש"ח, דצמבר של כל שנה ו-${m.plabel(L)})`}>
        <Chart label="נכסים לפי מוצר" height={280} deps={[m, group, set]} build={() => {
          const pal = palette();
          return foxOption({ x: pts.map((i) => (i === L ? m.plabel(i) : String(Math.floor(m.P[i] / 100)))), unit: 'מיליארד ש"ח', full: true, total: true, labels: false,
            series: prodIdx.map((i) => ({ name: m.d.products[i].label, kind: 'bar' as const, stack: true, color: pal[i % pal.length], dec: 1, data: pts.map((pi) => +(m.cell(pi, 'p:' + m.d.products[i].key, gi).a / 1000).toFixed(2)) })) });
            }} />
      </Panel>
    </>
  );
}
