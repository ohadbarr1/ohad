import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';
import { Chart } from '../components/Chart';
import { DataTable, type Column } from '../components/DataTable';
import { Sheet } from '../components/Sheet';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading, Seg } from '../components/ui';
import { foxOption } from '../lib/foxchart';
import { nf, pubLabel } from '../lib/format';
import { idColor, idCss } from '../lib/identity';
import { cssColor } from '../lib/theme';
import { load, useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { NotFound } from './NotFound';
import {
  bn, calcProv, fileProv, GROUPS, groupOf, groupSum, pc, PRODUCT_HE, ql, STATUS_HE, STATUS_SHORT, UNIT,
  type AssetsIndex, type AssetsManager, type Holding, type IndexManager, type Issuer, type Overlap, type Pair,
} from './assetsData';
import '../styles/assets.css';

/* /assets and /assets/:manager · הרכב נכסים. The quarterly single-asset lists (רשימת נכסים ברמת הנכס הבודד) that every institutional
   body publishes on its own website in the CMA's uniform Excel format, read by pipeline/asset_lists (discovery, polite fetch, normalise
   with validation) and pipeline/build_assets.py. NIS millions in the files; NIS billions on the charts. */

type Metric = 'illiq_pct' | 'abroad_pct' | 'ta35_pct' | 'fx_pct';
const METRICS: [Metric, string][] = [['illiq_pct', 'לא סחיר'], ['abroad_pct', 'חשיפה לחו"ל'], ['ta35_pct', 'ת"א 35'], ['fx_pct', 'מט"ח']];
const METRIC_NOTE: Record<Metric, string> = {
  illiq_pct: 'גיליונות "לא סחיר", קרנות השקעה, הלוואות, פיקדונות מעל 3 חודשים, זכויות מקרקעין וחברות מוחזקות, % מסך הנכסים',
  abroad_pct: 'שורות שמדינת החשיפה הכלכלית שלהן אינה ישראל, % מסך הנכסים',
  ta35_pct: 'מניות חברות מדד ת"א 35 (הרכב לפי ויקיפדיה), % מסך הנכסים',
  fx_pct: 'שורות שמטבע הפעילות שלהן אינו שקל, % מסך הנכסים',
};

export function Assets() {
  const { id } = useParams();
  const idx = useLoad<AssetsIndex>('assets/index.json');
  if (idx.error) return <ErrorBox what="רשימות הנכסים" error={idx.error} />;
  if (!idx.data) return <Loading what="רשימות נכסים" />;
  if (id) {
    const row = idx.data.managers.find((m) => m.id === id);
    if (!row) return <NotFound />;
    return row.latest ? <AssetsManagerPage id={id} idx={idx.data} /> : <Unreadable row={row} idx={idx.data} />;
  }
  return <AssetsIndexPage idx={idx.data} />;
}

/* ====================================================================================================== index */
function AssetsIndexPage({ idx }: { idx: AssetsIndex }) {
  const ov = useLoad<Overlap>('assets/overlap.json');
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => setSp((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });
  const metric = (sp.get('m') as Metric) || 'illiq_pct';
  const read = idx.managers.filter((m) => m.latest);
  const [mgrs, setMgrs] = useState<Record<string, AssetsManager>>({});
  // the trend chart needs every manager's series: one small file each
  const files = read.map((m) => m.id).join(',');
  useEffect(() => {
    let live = true;
    void Promise.all(files.split(',').filter(Boolean).map((id) => load<AssetsManager>(`assets/${id}.json`)))
      .then((all) => { if (live) setMgrs(Object.fromEntries(all.map((d) => [d.id, d]))); }, () => {});
    return () => { live = false; };
  }, [files]);
  const total = read.reduce((s, m) => s + (m.total ?? 0), 0);

  return (
    <div className="ast">
      <div className="pagehead">
        <div>
          <h1><span className="icotile"><Icon name="savings" /></span>הרכב נכסים</h1>
          <div className="sub">
            <span>רשימות הנכסים הרבעוניות של הגופים המוסדיים, נכס אחר נכס</span>
            {idx.asof_label && <span className="chip">{idx.asof_label}</span>}
            <span className="chip"><span className="num">{read.length}</span> מנהלים · <span className="num">₪{bn(total)}</span> מיליארד</span>
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="hd"><h2>הרכב לפי מנהל <span className="ast-h2s">{idx.asof_label}</span></h2><div className="aside">% מהנכסים (ללא יתרות שליליות) · לחצו על מנהל לפירוט</div></div>
        <CompareBars rows={read} mgrs={mgrs} />
      </section>

      <section className="panel">
        <div className="hd">
          <h2>לאורך זמן</h2>
          <div className="aside"><Seg label="מדד" value={metric} options={METRICS} onChange={(v) => set('m', v === 'illiq_pct' ? null : v)} /></div>
        </div>
        <p className="ast-lead">{METRIC_NOTE[metric]}</p>
        <TrendChart rows={read} mgrs={mgrs} metric={metric} />
      </section>

      <section className="panel">
        <div className="hd"><h2>חפיפה בין מנהלים</h2><div className="aside">{ov.data && <span>{ql(ov.data.pairs[0]?.qa)}</span>}</div></div>
        {ov.error ? <ErrorBox what="החפיפה" error={ov.error} /> : !ov.data ? <Loading what="חפיפה" /> : <OverlapMatrix ov={ov.data} names={Object.fromEntries(idx.managers.map((m) => [m.id, m.name]))} sel={sp.get('pair')} pick={(v) => set('pair', v)} by={(sp.get('by') as 'iss' | 'sec') || 'iss'} setBy={(v) => set('by', v === 'iss' ? null : v)} />}
      </section>

      <section className="panel">
        <div className="hd"><h2>מנהלים וכיסוי</h2><div className="aside">מקור: אתר כל גוף מוסדי</div></div>
        <ManagersTable rows={idx.managers} />
      </section>

      <Footer idx={idx} />
    </div>
  );
}

function CompareBars({ rows, mgrs }: { rows: IndexManager[]; mgrs: Record<string, AssetsManager> }) {
  const nav = useNavigate();
  const ready = rows.filter((r) => mgrs[r.id]);
  if (!ready.length) return <Loading what="הרכב" />;
  const ordered = [...ready].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  // shares of the gross positive groups: 'נכסים אחרים' carries payables as negatives, which a 100% bar cannot show
  const gross = (m: AssetsManager) => GROUPS.reduce((t, g) => t + Math.max(0, groupSum(m.series[m.latest].cls, g)), 0);
  const share = (m: AssetsManager, g: (typeof GROUPS)[number]) => { const t = gross(m); return t ? (100 * Math.max(0, groupSum(m.series[m.latest].cls, g))) / t : 0; };
  const build = (): EChartsCoreOption => ({
    animation: false,
    grid: { left: 22, right: 8, top: 58, bottom: 4, containLabel: true },
    legend: { top: 0, type: 'scroll', itemWidth: 12, itemHeight: 8, icon: 'roundRect', textStyle: { color: cssColor('--muted'), fontSize: 11.5 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${nf(v, 1)}%` },
    xAxis: { type: 'value', min: 0, max: 100, inverse: true, axisLabel: { formatter: (v: number) => `${v}%`, color: cssColor('--muted'), fontSize: 11 }, splitLine: { lineStyle: { type: 'dashed', color: cssColor('--line') } } },
    yAxis: { type: 'category', position: 'right', inverse: true, data: ordered.map((r) => r.name), axisLabel: { color: cssColor('--fg'), fontSize: 12, fontWeight: 500 }, axisTick: { show: false } },
    series: GROUPS.map((g) => ({ name: g.label, type: 'bar', stack: 'a', barMaxWidth: 26, itemStyle: { color: cssColor(g.c), borderColor: cssColor('--panel'), borderWidth: 0.5 },
      emphasis: { focus: 'series' }, data: ordered.map((r) => Number(share(mgrs[r.id], g).toFixed(2))) })),
  });
  return (
    <Chart label="הרכב נכסים לפי מנהל" height={Math.max(220, 70 + ordered.length * 44)} deps={[ordered.map((r) => r.id).join()]} build={build}
      source={`רשימות נכסים רבעוניות, ${ql(ordered[0].latest)}`}
      onPoint={(_, i) => { const r = ordered[i]; if (r) nav(`/holdings/${r.id}`); }} />
  );
}

function TrendChart({ rows, mgrs, metric }: { rows: IndexManager[]; mgrs: Record<string, AssetsManager>; metric: Metric }) {
  const ready = rows.filter((r) => mgrs[r.id]);
  if (!ready.length) return <Loading what="סדרות" />;
  const qs = [...new Set(ready.flatMap((r) => mgrs[r.id].quarters))].sort();
  const label = METRICS.find((x) => x[0] === metric)![1];
  return (
    <Chart label={`${label} לפי מנהל`} height={300} deps={[metric, qs.join(), ready.length]} source="רשימות נכסים רבעוניות, אתרי הגופים המוסדיים"
      build={() => foxOption({ x: qs.map(ql), unit: '% מסך הנכסים', labels: false, legend: true,
        series: ready.map((r) => ({ name: r.name, color: idColor(r.id), kind: 'line' as const, pct: true, data: qs.map((q) => mgrs[r.id].series[q]?.[metric] ?? null) })) })} />
  );
}

const heat = (v: number, max: number) => Math.min(1, Math.max(0, v / max));
function OverlapMatrix({ ov, names, sel, pick, by, setBy }: { ov: Overlap; names: Record<string, string>; sel: string | null; pick: (v: string | null) => void; by: 'iss' | 'sec'; setBy: (v: 'iss' | 'sec') => void }) {
  const phone = usePhone();
  const ids = ov.managers;
  const get = (a: string, b: string) => ov.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  const cur = sel ? ov.pairs.find((p) => `${p.a}~${p.b}` === sel) ?? null : null;
  const max = Math.max(...ov.pairs.map((p) => p[by]), 1);
  const detail = cur && <PairDetail p={cur} names={names} ov={ov} />;
  return (
    <>
      <div className="ast-mx-top">
        <Seg label="בסיס החפיפה" value={by} options={[['iss', 'לפי מנפיק'], ['sec', 'לפי נייר ערך']]} onChange={setBy} />
        <span className="muted ast-small">{by === 'iss' ? ov.calc.iss : ov.calc.sec}</span>
      </div>
      <div className={`ast-mx-wrap${!phone ? ' side' : ''}`}>
        <div className="scroll ast-mx-scroll">
          <table className="ast-mx" aria-label={`חפיפת תיקים בין מנהלים, ${by === 'iss' ? 'לפי מנפיק' : 'לפי נייר ערך'}, % מסך הנכסים`}>
            <thead><tr><th className="ast-corner" scope="col" />{ids.map((b) => <th key={b} scope="col" className="ast-col" style={{ ['--id' as string]: idCss(b) }}><Link to={`/holdings/${b}`}>{names[b] ?? b}</Link></th>)}</tr></thead>
            <tbody>
              {ids.map((a) => (
                <tr key={a}>
                  <th scope="row" className="ast-row"><span className="ast-dot" style={{ background: idCss(a) }} />{names[a] ?? a}</th>
                  {ids.map((b) => {
                    if (a === b) return <td key={b} className="ast-diag" />;
                    const p = get(a, b)!;
                    const v = p[by], key = `${p.a}~${p.b}`, on = sel === key, k = heat(v, max);
                    return (
                      <td key={b} className={`ast-cell${on ? ' on' : ''}`}>
                        <button type="button" style={{ ['--k' as string]: String(k) }} className={k > 0.6 ? 'ink' : ''} aria-pressed={on} onClick={() => pick(on ? null : key)}
                          aria-label={`${names[a] ?? a} ו${names[b] ?? b}: ${nf(v, 1)}%`}><span className="num">{nf(v, 1)}</span></button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!phone && <aside className="ast-side" aria-live="polite">{detail ?? <p className="muted">בחרו תא: המנפיקים המשותפים הגדולים ומשקלם בכל תיק.</p>}</aside>}
      </div>
      {phone && <Sheet open={!!cur} onClose={() => pick(null)} title="חפיפה">{detail}</Sheet>}
    </>
  );
}

function PairDetail({ p, names, ov }: { p: Pair; names: Record<string, string>; ov: Overlap }) {
  const prov = (k: 'iss' | 'sec') => () => ({ k: 'calc' as const, title: `חפיפה ${k === 'iss' ? 'לפי מנפיק' : 'לפי נייר ערך'} · ${names[p.a]} · ${names[p.b]} · ${ql(p.qa)}`, value: `${nf(p[k], 2)}%`, unit: '% מסך הנכסים', formula: ov.calc[k],
    inputs: p.shared.map((s) => ({ label: s.name, v: `${nf(s.pct_a, 2)}% · ${nf(s.pct_b, 2)}%` })) });
  return (
    <div className="ast-det">
      <div className="ast-det-hd"><span className="ast-dot" style={{ background: idCss(p.a) }} /><b>{names[p.a]}</b><span className="muted">·</span><span className="ast-dot" style={{ background: idCss(p.b) }} /><b>{names[p.b]}</b></div>
      <div className="ast-det-v">
        <div><Sourced src={prov('iss')}>{`${nf(p.iss, 1)}%`}</Sourced><small className="muted">לפי מנפיק</small></div>
        <div><Sourced src={prov('sec')}>{`${nf(p.sec, 1)}%`}</Sourced><small className="muted">לפי נייר ערך</small></div>
      </div>
      <table className="ast-shared">
        <thead><tr><th scope="col">מנפיק משותף</th><th scope="col" className="num">{names[p.a]}</th><th scope="col" className="num">{names[p.b]}</th></tr></thead>
        <tbody>{p.shared.map((s) => <tr key={s.key}><td>{s.name}</td><td className="num">{pc(s.pct_a, 2)}</td><td className="num">{pc(s.pct_b, 2)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function StatusChip({ s, short }: { s: IndexManager['status']; short?: boolean }) {
  return <span className={`chip ast-st ast-st-${s}`} title={STATUS_HE[s]}>{short ? STATUS_SHORT[s] : STATUS_HE[s]}</span>;
}

function ManagersTable({ rows }: { rows: IndexManager[] }) {
  const phone = usePhone();
  const cols: Column<IndexManager>[] = [
    { key: 'n', head: 'מנהל', value: (r) => r.name, cell: (r) => r.latest ? <Link className="ast-co" to={`/holdings/${r.id}`}><span className="ast-dot" style={{ background: idCss(r.id) }} />{r.name}</Link> : <span className="ast-co muted"><span className="ast-dot" style={{ background: idCss(r.id) }} />{r.name}</span> },
    { key: 't', head: 'נכסים', title: 'מיליארדי ש"ח, הרבעון האחרון, במוצרים שנקראו', value: (r) => (r.total == null ? null : r.total / 1000), unit: 'm', d: 1 },
    { key: 'il', head: 'לא סחיר', value: (r) => r.illiq_pct, unit: 'pct', d: 1 },
    ...(phone ? [] : [
      { key: 'ab', head: 'חו"ל', value: (r: IndexManager) => r.abroad_pct, unit: 'pct' as const, d: 1 },
      { key: 'ta', head: 'ת"א 35', value: (r: IndexManager) => r.ta35_pct, unit: 'pct' as const, d: 1 },
      { key: 'p', head: 'מוצרים', value: (r: IndexManager) => r.products.map((p) => PRODUCT_HE[p] ?? p).join(' · ') || null, cell: (r: IndexManager) => <span className="ast-small">{r.products.map((p) => PRODUCT_HE[p] ?? p).join(' · ') || '–'}</span> },
      { key: 'q', head: 'רבעונים', value: (r: IndexManager) => r.quarters.length || null, cell: (r: IndexManager) => r.quarters.length ? <span className="num ast-small">{ql(r.quarters[0])}–{ql(r.quarters[r.quarters.length - 1])}</span> : '–' },
    ]),
    { key: 's', head: 'מצב', value: (r) => STATUS_HE[r.status], cell: (r) => <StatusChip s={r.status} short={phone} /> },
  ];
  return (
    <>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} caption="מנהלים וכיסוי רשימות הנכסים"
        export={{ name: 'fox-assets-managers', title: 'הרכב נכסים · מנהלים וכיסוי', note: 'רשימות נכסים רבעוניות, אתרי הגופים המוסדיים' }} />
      <ul className="ast-notes">
        {rows.filter((r) => r.status !== 'ok' && r.note).map((r) => <li key={r.id}><b>{r.name}:</b> {r.note}</li>)}
      </ul>
    </>
  );
}

function Footer({ idx }: { idx: AssetsIndex }) {
  return (
    <footer className="ast-foot">
      <p className="ast-disc">{idx.disclaimer}</p>
      <p className="muted">נבנה {idx.built}{idx.probed ? ` · אתרי המנהלים נסרקו ${idx.probed}` : ''} · קצב של בקשה לשתי שניות, robots.txt נשמר, אתר שחוסם גישה אוטומטית לא נקרא.
        {idx.ta35 && 'url' in idx.ta35 && <> הרכב ת"א 35: <a href={idx.ta35.url} target="_blank" rel="noreferrer">ויקיפדיה</a>, נשלף {pubLabel(idx.ta35.retrieved)}.</>}</p>
    </footer>
  );
}

function Unreadable({ row, idx }: { row: IndexManager; idx: AssetsIndex }) {
  return (
    <div className="ast">
      <div className="pagehead"><div><h1><span className="ast-dot lg" style={{ background: idCss(row.id) }} />{row.name} <span className="muted">· הרכב נכסים</span></h1>
        <div className="sub"><StatusChip s={row.status} /><Link className="chip" to="/holdings">כל המנהלים</Link></div></div></div>
      <Empty title="רשימות הנכסים של המנהל לא נקראו">{row.note}</Empty>
      <Footer idx={idx} />
    </div>
  );
}

/* ====================================================================================================== manager */
function AssetsManagerPage({ id, idx }: { id: string; idx: AssetsIndex }) {
  const { data: m, error } = useLoad<AssetsManager>(`assets/${id}.json`);
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => setSp((p) => { const x = new URLSearchParams(p); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });
  if (error) return <ErrorBox what="רשימת הנכסים" error={error} />;
  if (!m) return <Loading what="רשימת נכסים" />;
  const q = m.latest, s = m.series[q];
  const fams = Object.keys(s.fam);
  const fam = sp.get('f') && fams.includes(sp.get('f')!) ? sp.get('f')! : '';
  const mode = (sp.get('u') as 'm' | 'pct') || 'm';
  const prev = m.quarters[m.quarters.length - 2];

  return (
    <div className="ast">
      <div className="pagehead">
        <div>
          <h1><span className="ast-dot lg" style={{ background: idCss(m.id) }} />{m.name} <span className="muted">· הרכב נכסים</span></h1>
          <div className="sub">
            <span>{m.entity}</span>
            <span className="chip">{m.products.map((p) => PRODUCT_HE[p] ?? p).join(' · ')}</span>
            <span className="chip num">{ql(m.quarters[0])}–{ql(q)}</span>
            {m.status !== 'ok' && <StatusChip s={m.status} />}
            <Link className="chip" to="/holdings">כל המנהלים</Link>
          </div>
        </div>
      </div>
      {m.note && <p className="ast-lead">{m.note}</p>}

      <div className="kpis ast-kpis">
        <Kpi l="סך נכסים" v={<Sourced src={() => calcProv(m, q, 'סך נכסים', `${nf(s.total, 0)}`, m.calc.total)}>{`₪${bn(s.total)}`}</Sourced>} sub={`מיליארד · ${ql(q)}`} d={prev ? s.total / m.series[prev].total - 1 : null} />
        <Kpi l="לא סחיר" v={<Sourced src={() => calcProv(m, q, 'לא סחיר', pc(s.illiq_pct, 2), m.calc.illiq_pct, '%')}>{pc(s.illiq_pct)}</Sourced>} sub={`₪${bn(s.illiq)} מיליארד`} />
        <Kpi l='חשיפה לחו"ל' v={<Sourced src={() => calcProv(m, q, 'חשיפה לחו"ל', pc(s.abroad_pct, 2), m.calc.abroad_pct, '%')}>{pc(s.abroad_pct)}</Sourced>} sub={`מט"ח ${pc(s.fx_pct)}`} />
        <Kpi l='ת"א 35' v={<Sourced src={() => calcProv(m, q, 'ת"א 35', pc(s.ta35_pct, 2), m.calc.ta35_pct, '%')}>{pc(s.ta35_pct)}</Sourced>} sub={`₪${bn(s.ta35)} מיליארד`} />
        <Kpi l="התחייבויות להשקעה" v={<Sourced src={() => calcProv(m, q, 'יתרות התחייבות להשקעה', nf(s.commit, 0), 'Σ יתרת המחויבות לתקופת הדיווח (באלפי ש"ח), גיליון "יתרות התחייבות להשקעה" ÷ 1,000')}>{`₪${bn(s.commit)}`}</Sourced>} sub="מיליארד, טרם נמשך" />
      </div>

      <section className="panel">
        <div className="hd">
          <h2>הרכב לאורך זמן</h2>
          <div className="aside">
            <Seg label="יחידות" value={mode} options={[['m', '₪ מיליארד'], ['pct', '%']]} onChange={(v) => set('u', v === 'm' ? null : v)} />
          </div>
        </div>
        {fams.length > 1 && (
          <div className="ast-fams" role="group" aria-label="מוצר">
            <button type="button" aria-pressed={!fam} onClick={() => set('f', null)}>כל המוצרים</button>
            {fams.map((f) => <button key={f} type="button" aria-pressed={fam === f} onClick={() => set('f', f)}>{f}</button>)}
          </div>
        )}
        <AllocChart m={m} fam={fam} mode={mode} />
        <p className="ast-lead ast-small">יתרות שליליות (התחייבויות בגיליון נכסים אחרים, נגזרים בהפסד) אינן בערימה; הן כלולות בסך הנכסים.</p>
      </section>

      <div className="grid2 ast-g2">
        <section className="panel">
          <div className="hd"><h2>לפי מוצר <span className="ast-h2s">{ql(q)}</span></h2></div>
          <FamilyTable m={m} />
        </section>
        <section className="panel">
          <div className="hd"><h2>לא סחיר לאורך זמן</h2></div>
          <IlliqChart m={m} />
        </section>
      </div>

      <section className="panel">
        <div className="hd"><h2>המנפיקים הגדולים <span className="ast-h2s">{ql(q)}</span></h2><div className="aside">כל האפיקים מלבד מזומנים, נגזרים ונכסים אחרים</div></div>
        <IssuersTable m={m} rows={m.top_issuers} />
      </section>

      <section className="panel">
        <div className="hd"><h2>ההחזקות הגדולות <span className="ast-h2s">{ql(q)}</span></h2></div>
        <HoldingsTable m={m} rows={m.top_holdings} />
      </section>

      <section className="panel">
        <div className="hd"><h2>קבצי מקור</h2><div className="aside">רשימת נכסים מאוחדת לכל מוצר, כפי שפורסמה</div></div>
        <SourcesTable m={m} />
      </section>

      <Footer idx={idx} />
    </div>
  );
}

function Kpi({ l, v, sub, d }: { l: string; v: ReactNode; sub?: string; d?: number | null }) {
  return (
    <div className="kpi">
      <span className="l">{l}</span>
      <span className="v">{v}</span>
      <span className="s">{sub}{d != null && <> · <span className={`num ${d >= 0 ? 'pos' : 'neg'}`}>{d >= 0 ? '+' : ''}{nf(100 * d, 1)}%</span> QoQ</>}</span>
    </div>
  );
}

function AllocChart({ m, fam, mode }: { m: AssetsManager; fam: string; mode: 'm' | 'pct' }) {
  const qs = m.quarters;
  const clsOf = (q: string) => (fam ? m.series[q].fam[fam]?.cls ?? {} : m.series[q].cls);
  const totOf = (q: string) => (fam ? m.series[q].fam[fam]?.total ?? 0 : m.series[q].total);
  const series = GROUPS.map((g) => ({ name: g.label, color: cssColor(g.c), stack: true, kind: 'bar' as const,
    // negative balances (payables in 'נכסים אחרים', short derivatives) are left out of the stack
    data: qs.map((q) => { const v = Math.max(0, groupSum(clsOf(q), g)), t = totOf(q); if (!t) return null; return mode === 'pct' ? Number(((100 * v) / t).toFixed(2)) : Number((v / 1000).toFixed(2)); }) }))
    .filter((x) => x.data.some((v) => v));
  return (
    <Chart label={`הרכב נכסים ${m.name}${fam ? ` ${fam}` : ''}`} height={340} deps={[m.id, fam, mode]} source={`${m.name}, רשימות נכסים רבעוניות`}
      build={() => foxOption({ x: qs.map(ql), unit: mode === 'pct' ? '% מסך הנכסים' : 'מיליארדי ש"ח', labels: false, legend: true, total: mode === 'm', series })} />
  );
}

function IlliqChart({ m }: { m: AssetsManager }) {
  const qs = m.quarters;
  const fams = Object.keys(m.series[m.latest].fam);
  const pal = ['--s2', '--s8', '--s5', '--s3', '--s9', '--s4', '--s11'];
  return (
    <Chart label={`לא סחיר ${m.name}`} height={260} deps={[m.id]} source={`${m.name}, רשימות נכסים רבעוניות`}
      build={() => foxOption({ x: qs.map(ql), unit: '% מסך הנכסים', labels: false, legend: true, series: [
        { name: 'כל המוצרים', color: idColor(m.id), kind: 'line' as const, pct: true, lead: true, data: qs.map((q) => m.series[q].illiq_pct) },
        ...(fams.length > 1 ? fams.slice(0, 6).map((f, i) => ({ name: f, color: cssColor(pal[i % pal.length]), kind: 'line' as const, pct: true, dashed: true, data: qs.map((q) => m.series[q].fam[f]?.illiq_pct ?? null) })) : []),
      ] })} />
  );
}

interface FamRow { fam: string; total: number; share: number; illiq: number | null; tracks: number; eq: number; credit: number }
function FamilyTable({ m }: { m: AssetsManager }) {
  const s = m.series[m.latest];
  const rows: FamRow[] = Object.entries(s.fam).map(([fam, f]) => ({ fam, total: f.total, share: (100 * f.total) / s.total, illiq: f.illiq_pct, tracks: f.tracks,
    eq: f.total ? (100 * (groupSum(f.cls, GROUPS[0]) + groupSum(f.cls, GROUPS[1]))) / f.total : 0,
    credit: f.total ? (100 * (groupSum(f.cls, GROUPS[5]) + groupSum(f.cls, GROUPS[6]) + groupSum(f.cls, GROUPS[7]))) / f.total : 0 }));
  const cols: Column<FamRow>[] = [
    { key: 'f', head: 'מוצר', value: (r) => r.fam },
    { key: 't', head: 'נכסים', title: 'מיליארדי ש"ח', value: (r) => r.total / 1000, unit: 'm', d: 1, src: (r) => calcProv(m, m.latest, `נכסים · ${r.fam}`, nf(r.total, 0), m.calc.total), total: 'sum' },
    { key: 's', head: 'משקל', value: (r) => r.share, unit: 'pct', d: 1 },
    { key: 'e', head: 'מניות וקרנות', title: 'מניות סחירות, קרנות סל ונאמנות, % מהמוצר', value: (r) => r.eq, unit: 'pct', d: 1 },
    { key: 'i', head: 'לא סחיר', value: (r) => r.illiq, unit: 'pct', d: 1 },
    { key: 'n', head: 'מסלולים', value: (r) => r.tracks, unit: 'int' },
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(r) => r.fam} sort={{ key: 't', dir: 'desc' }} caption={`${m.name}, נכסים לפי מוצר`} totalLabel="סה״כ"
    export={{ name: `fox-assets-${m.id}-families`, title: `${m.name} · נכסים לפי מוצר · ${ql(m.latest)}`, note: 'רשימות נכסים רבעוניות' }} />;
}

const CLS_HE = (k: string) => groupOf(k as never)?.label ?? k;
function IssuersTable({ m, rows }: { m: AssetsManager; rows: Issuer[] }) {
  const phone = usePhone();
  const cols: Column<Issuer>[] = [
    { key: 'n', head: 'מנפיק', value: (r) => r.name, cell: (r) => <span className="ast-nm">{r.name}</span> },
    { key: 'v', head: 'שווי', title: UNIT, value: (r) => r.v, unit: 'm', d: 0, src: (r) => calcProv(m, m.latest, r.name, nf(r.v, 1), 'Σ שווי הוגן של שורות המנפיק בכל המוצרים ÷ 1,000') },
    { key: 'p', head: '% מהנכסים', value: (r) => r.pct, unit: 'pct', d: 2 },
    ...(phone ? [] : [
      { key: 'c', head: 'אפיק עיקרי', value: (r: Issuer) => CLS_HE(r.cls) },
      { key: 's', head: 'ענף', value: (r: Issuer) => r.sector || null, cell: (r: Issuer) => <span className="ast-small">{r.sector || '–'}</span> },
    ]),
    { key: 'i', head: 'לא סחיר', title: 'מתוך החשיפה למנפיק', value: (r) => r.illiq_pct, unit: 'pct', d: 0 },
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(r) => r.key} sort={{ key: 'v', dir: 'desc' }} caption={`${m.name}, המנפיקים הגדולים`}
    export={{ name: `fox-assets-${m.id}-issuers`, title: `${m.name} · המנפיקים הגדולים · ${ql(m.latest)}`, note: 'רשימות נכסים רבעוניות' }} />;
}

function HoldingsTable({ m, rows }: { m: AssetsManager; rows: Holding[] }) {
  const phone = usePhone();
  const cols: Column<Holding>[] = [
    { key: 'n', head: 'נייר / נכס', value: (r) => r.name, cell: (r) => <span className="ast-nm">{r.name}{!phone && r.issuer && r.issuer !== r.name && <small className="muted"> · {r.issuer}</small>}</span> },
    ...(phone ? [] : [
      { key: 'id', head: 'מספר', value: (r: Holding) => r.sec || null, cell: (r: Holding) => <span className="num ast-small">{r.sec || '–'}</span> },
      { key: 'c', head: 'אפיק', value: (r: Holding) => CLS_HE(r.cls) },
    ]),
    { key: 'v', head: 'שווי', title: UNIT, value: (r) => r.v, unit: 'm', d: 0, src: (r) => calcProv(m, m.latest, r.name, nf(r.v, 1), 'Σ שווי הוגן של שורות הנייר בכל המסלולים ÷ 1,000') },
    { key: 'p', head: '% מהנכסים', value: (r) => r.pct, unit: 'pct', d: 2 },
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(r, i) => `${r.sec}-${i}`} sort={{ key: 'v', dir: 'desc' }} caption={`${m.name}, ההחזקות הגדולות`}
    export={{ name: `fox-assets-${m.id}-holdings`, title: `${m.name} · ההחזקות הגדולות · ${ql(m.latest)}`, note: 'רשימות נכסים רבעוניות' }} />;
}

interface SrcRow { q: string; product: string; file: string; url: string | null; retrieved: string | null; ok: boolean; warnings: number; rows: number; i: number }
function SourcesTable({ m }: { m: AssetsManager }) {
  const rows: SrcRow[] = [...m.quarters].reverse().flatMap((q) => m.series[q].src.map((s, i) => ({ q, product: s.product, file: s.file ?? '', url: s.url, retrieved: s.retrieved,
    ok: m.series[q].val.ok, warnings: m.series[q].val.warnings, rows: m.series[q].val.rows, i })));
  const cols: Column<SrcRow>[] = [
    { key: 'q', head: 'רבעון', value: (r) => r.q, cell: (r) => <span className="num">{ql(r.q)}</span> },
    { key: 'p', head: 'מוצר', value: (r) => PRODUCT_HE[r.product] ?? r.product },
    { key: 'f', head: 'קובץ', value: (r) => r.file, cell: (r) => <Sourced src={() => fileProv(m, r.q, m.series[r.q].src[r.i])} href={r.url} className="ast-small">{r.file}</Sourced> },
    { key: 'r', head: 'נשלף', value: (r) => r.retrieved, cell: (r) => <span className="num ast-small">{pubLabel(r.retrieved)}</span> },
    { key: 'v', head: 'בדיקה', title: 'סכומי הגיליונות מול גיליון הסיכום, ושיעורי המסלולים', value: (r) => (r.ok ? 1 : 0), cell: (r) => <span className={`chip ${r.ok ? 'ast-ok' : 'ast-bad'}`}>{r.ok ? 'תקין' : 'לבדיקה'}{r.warnings ? ` · ${r.warnings} הערות` : ''}</span> },
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(r) => `${r.q}-${r.product}`} caption={`${m.name}, קבצי מקור`} />;
}
