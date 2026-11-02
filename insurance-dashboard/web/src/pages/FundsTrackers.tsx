import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FundsHead, CompareAdd } from '../components/FundsNav';
import { Sourced } from '../components/Source';
import { Chart } from '../components/Chart';
import { DataTable } from '../components/DataTable';
import { Tip } from '../components/Explain';
import { Empty, ErrorBox, Loading, Panel, Pick, Seg } from '../components/ui';
import { expP, fundP } from '../lib/market';
import { useSource, type Prov } from '../lib/prov';
import { chartBase, palette } from '../lib/theme';
import { nf, sn } from '../lib/format';
import { useFunds } from '../lib/useData';
import { grossProv, netProv, refOf, ym, type FundX, type FundsFile, type Per } from '../lib/funds';
import { ols, singleIndex, trackersFrom, W3S, type FundLike, type TrackersFile, type TrkGroup, type TrkTrack, type W3 } from '../lib/fundsTools';
import { useOptional } from '../lib/fundsLoad';
import { ToolLinks } from './FundsTools';
import '../styles/lens.css';
import '../styles/fundsTools.css';

/** W5 (red team 3): the method in words. The data file's own note (trackers.json `method`) names its fields (med, tdn, same_index,
 *  sector); the page says the same in Hebrew. */
const TRK_METHOD = 'מסלולים פעילים שהקטגוריה שלהם עוקבת אחרי מדד, בקבוצה לפי המדד (בלי חלוקה למוצר). החציון: חציון התשואה ברוטו של המסלולים בקבוצה. הפער בביצוע: התשואה ברוטו של המסלול פחות החציון. עלות העטיפה: התשואה נטו (אומדן) פחות חציון הברוטו, כלומר מה שהעטיפה עולה לחוסך מעבר לתשואת הקבוצה. LTM: 12 חודשים בריבית דריבית; 3Y ו-5Y: ממוצע שנתי כפי שפורסם. מט"ח: חשיפה למטבע חוץ באחוזי נכסים (הבדלי גידור מסבירים חלק מהפער). רק בקבוצת S&P 500 כל המסלולים עוקבים אחרי אותו מדד; בשאר הקבוצות המדדים שונים (ת"א 35, עולמי, אג"ח ממשלתי או קונצרני), והפער משקף גם את בחירת המדד. מסלול ענפי: פתוח רק לאוכלוסייה מסוימת';

/* /funds/trackers (funds plan #17): the index-tracker lab. Tracks that follow the same index hold the same thing, so the spread of
   their returns is the price of the wrapper: the fee, currency hedging, execution and timing. For each tracker: its gross return
   against the group's median gross (the gap), its net return, its fee and its dollar exposure; a scatter of fee against the gap.
   Groups from funds/trackers.json (F2 DATA) when published, else built here from funds.json, labelled. Only the regulator's
   published track returns: no index prices. */

const pc = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${nf(v, d)}%`);
const pp = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${sn(v, d)} נ"א`);

export function FundsTrackers() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const file = useOptional<TrackersFile>('funds/trackers.json');
  const [sp, setSp] = useSearchParams();
  const { open } = useSource();
  const set = (patch: Record<string, string | null>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v == null ? n.delete(k) : n.set(k, v))); setSp(n, { replace: true }); };
  const fromFile = !!file?.groups?.length;
  const tf: TrackersFile | null = useMemo(() => (fromFile ? file! : data ? trackersFrom(data.funds as unknown as FundLike[], data.asof) : null), [fromFile, file, data]);
  const gid = sp.get('g') ?? 'sp500';
  const g: TrkGroup | undefined = tf?.groups.find((x) => x.id === gid) ?? tf?.groups[0];
  const w: W3 = (W3S.find(([x]) => x === sp.get('w'))?.[0]) ?? 'y12';
  const prodQ = sp.get('prod') ?? 'all';
  const xAxis: 'fee' | 'fx' = sp.get('x') === 'fx' ? 'fx' : 'fee';
  const tracks = useMemo(() => (g?.tracks ?? []).filter((t) => prodQ === 'all' || t.prod === prodQ), [g, prodQ]);
  const byK = useMemo(() => new Map(((data?.funds ?? []) as FundX[]).map((f) => [f.k, f])), [data]);

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data || file === undefined) return <Loading what="עוקבי המדד" />;
  if (!tf || !g) return <Empty title="אין מסלולים עוקבי מדד בנתונים" />;
  const asof = tf.asof ?? data.asof;
  const prods = [...new Set(g.tracks.map((t) => t.prod))];
  const wl = W3S.find(([x]) => x === w)![1];

  /* ---- sources: the track's published figure when it is in funds.json, else the file's ---- */
  const f = (t: TrkTrack) => byK.get(t.k);
  const gSrc = (t: TrkTrack) => (): Prov => (f(t) ? grossProv(f(t)!, w as Per, asof) : { k: 'calc', title: `${wl}, ברוטו · ${t.name}`, value: pc(t.g[w]), formula: 'מקובץ עוקבי המדד (funds/trackers.json), מחושב בבניית הנתונים מהתשואות שפורסמו', inputs: [] });
  const nSrc = (t: TrkTrack) => (): Prov => (f(t) && t.nt?.[w] != null ? netProv(f(t)!, w as Per, asof, t.nt[w]!, data.net_method) : { k: 'calc', est: true, title: `${wl}, נטו · ${t.name}`, value: pc(t.nt?.[w]), formula: 'מקובץ עוקבי המדד (funds/trackers.json)', inputs: [] });
  const medProv = (): Prov => ({ k: 'calc', title: `חציון ${wl} ברוטו · עוקבי ${g.label}`, value: pc(g.med[w]), formula: 'החציון של התשואה ברוטו שפורסמה, על כל המסלולים בקבוצה (כל המוצרים)', inputs: g.tracks.filter((t) => t.g[w] != null).map((t) => ({ label: `${t.name} (${t.prod})`, v: pc(t.g[w]), src: gSrc(t) })) });
  const tdProv = (t: TrkTrack): Prov => ({ k: 'calc', title: `פער מהחציון · ${wl} · ${t.name}`, value: pp(t.td[w]), formula: 'התשואה ברוטו של המסלול פחות חציון הקבוצה ברוטו, באותו חלון. ברוטו מול ברוטו: הפער הוא ההבדל בביצוע (גידור, עיתוי, עלויות מסחר); דמי הניהול באים על זה בנטו',
    inputs: [{ label: 'המסלול, ברוטו', v: pc(t.g[w]), src: gSrc(t) }, { label: 'חציון הקבוצה, ברוטו', v: pc(g.med[w]), src: medProv }] });
  const feeSrc = (t: TrkTrack) => (): Prov => (f(t) ? fundP(refOf(f(t)!), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', pc(t.fee)) : { k: 'calc', title: `דמי ניהול · ${t.name}`, value: pc(t.fee), formula: 'מקובץ עוקבי המדד', inputs: [] });
  const fxSrc = (t: TrkTrack) => (): Prov => (f(t) ? expP(refOf(f(t)!), asof, 'FOREIGN_CURRENCY_EXPOSURE', 'חשיפה למט"ח', t.fx ?? null, f(t)!.assets) : { k: 'calc', title: `חשיפה למט"ח · ${t.name}`, value: pc(t.fx, 0), formula: 'מקובץ עוקבי המדד', inputs: [] });
  const gap = (t: TrkTrack) => (t.g[w] != null && t.nt?.[w] != null ? t.g[w]! - t.nt[w]! : null);

  // the scatter: x = fee (or $ exposure), y = the gap to the median, net of fee (net − median gross) so the fee shows
  const pts = tracks.map((t) => ({ t, x: xAxis === 'fee' ? t.fee : t.fx ?? null, y: t.nt?.[w] != null && g.med[w] != null ? t.nt[w]! - g.med[w]! : null })).filter((p): p is { t: TrkTrack; x: number; y: number } => p.x != null && p.y != null);
  const fit = ols(pts.map((p) => [p.x, p.y]));
  const spread = (() => { const v = tracks.map((t) => t.g[w]).filter((x): x is number => x != null); return v.length > 1 ? Math.max(...v) - Math.min(...v) : null; })();
  const ptSrc = (p: (typeof pts)[number]): Prov => ({ k: 'calc', est: true, title: `נטו מול חציון הקבוצה · ${wl} · ${p.t.name}`, value: pp(p.y), formula: 'התשואה נטו של המסלול פחות חציון הקבוצה ברוטו: מה העטיפה עלתה בסך הכול, כולל דמי הניהול',
    inputs: [{ label: 'המסלול, נטו', v: pc(p.t.nt?.[w]), src: nSrc(p.t) }, { label: 'חציון הקבוצה, ברוטו', v: pc(g.med[w]), src: medProv }, { label: xAxis === 'fee' ? 'דמי ניהול' : 'חשיפה למט"ח', v: pc(p.x, xAxis === 'fee' ? 2 : 0), src: xAxis === 'fee' ? feeSrc(p.t) : fxSrc(p.t) }] });

  return (
    <>
      <FundsHead title="מעבדת עוקבי המדד" sub={<>אותו מדד, עטיפות שונות: הפער בין המסלולים הוא מחיר העטיפה · נתונים עד {ym(asof)}</>} />
      <ToolLinks />

      <div className="fwarn">
        <Seg label="קבוצה" value={g.id} onChange={(v) => set({ g: v, prod: null })} options={tf.groups.map((x) => [x.id, `${x.label} (${x.n})`] as [string, string])} />
        <Seg label="חלון" value={w} onChange={(v) => set({ w: v })} options={W3S} />
        <Pick label="מוצר" value={prodQ} onChange={(v) => set({ prod: v === 'all' ? null : v })} options={[['all', 'כל המוצרים'], ...prods.map((p) => [p, p] as [string, string])]} />
        {!fromFile && <span className="chip est" title={TRK_METHOD}>מחושב בדפדפן מ-funds.json</span>}
        {!singleIndex(g.label) && <span className="chip est">הקבוצה כוללת מדדים שונים: הפער אינו רק מחיר העטיפה</span>}
        {tracks.some((t) => t.prod.startsWith('פנסיה')) && <span className="chip est">קרנות פנסיה מחזיקות גם אג"ח מיועדות, ולכן אינן עוקבות טהורות: סננו לפי מוצר להשוואה נקייה</span>}
      </div>

      <section className="kpis">
        <div className="kpi"><div className="l">מסלולים</div><div className="v num">{tracks.length}</div><div className="s">{prodQ === 'all' ? 'כל המוצרים' : prodQ}</div></div>
        <div className="kpi"><div className="l">חציון ברוטו · {wl}</div><div className="v num"><Sourced src={medProv}>{pc(g.med[w])}</Sourced></div><div className="s">כל המוצרים בקבוצה</div></div>
        <div className="kpi"><div className="l">הטווח ברוטו</div><div className="v num">{spread == null ? '–' : <Sourced src={() => { const s = [...tracks].filter((t) => t.g[w] != null).sort((a, b) => b.g[w]! - a.g[w]!); return { k: 'calc', title: `טווח ${wl} ברוטו · ${g.label}`, value: pp(spread), formula: 'הגבוה פחות הנמוך', inputs: [{ label: s[0].name, v: pc(s[0].g[w]), src: gSrc(s[0]) }, { label: s[s.length - 1].name, v: pc(s[s.length - 1].g[w]), src: gSrc(s[s.length - 1]) }] }; }}>{pp(spread)}</Sourced>}</div><div className="s">בין הטוב לחלש באותו מדד</div></div>
        {fit && xAxis === 'fee' && <div className="kpi"><div className="l">כל 0.1% דמי ניהול</div><div className="v num"><Sourced src={() => ({ k: 'calc', est: true, title: `שיפוע: נטו מול חציון, על דמי הניהול · ${wl}`, value: pp(fit.b * 0.1), formula: `ריבועים פחותים של (נטו − חציון ברוטו) על דמי הניהול, ${fit.n} מסלולים; R² = ${nf(fit.r2, 2)}. תיאור, לא סיבתיות`, inputs: pts.map((p) => ({ label: p.t.name, v: `${pc(p.x)} → ${pp(p.y)}`, src: () => ptSrc(p) })) })}>{pp(fit.b * 0.1)}</Sourced></div><div className="s">R² {nf(fit.r2, 2)} · {fit.n} מסלולים</div></div>}
      </section>

      <Panel title={<>{xAxis === 'fee' ? 'דמי ניהול' : 'חשיפה לדולר'} מול הפער מהחציון</>} aside={<Seg label="ציר אופקי" value={xAxis} onChange={(v) => set({ x: v === 'fee' ? null : v })} options={[['fee', 'דמי ניהול'], ['fx', 'חשיפה למט"ח']]} />}>
        {pts.length < 2 ? <Empty title="אין מספיק מסלולים עם נטו ועם הנתון בחלון הזה" /> : (
          <Chart label={`עוקבי ${g.label} · ${xAxis === 'fee' ? 'דמי ניהול' : 'מט"ח'} מול פער`} exportName={`עוקבי-מדד-${g.id}-${w}`} height={320} deps={[g.id, w, prodQ, xAxis, pts.length]}
            onPoint={(si, di) => { const s = si === 0 ? pts.filter((p) => !p.t.gone) : pts.filter((p) => p.t.gone); const p = s[di]; if (p) open(ptSrc(p)); }}
            build={() => { const b = chartBase(), pal = palette(); const xs = pts.map((p) => p.x), lo = Math.min(...xs), hi = Math.max(...xs);
              return { grid: { left: 52, right: 18, top: 30, bottom: 44 }, tooltip: { trigger: 'item', formatter: (q: { data: [number, number, string] }) => `${q.data[2]}<br/>${xAxis === 'fee' ? 'דמי ניהול' : 'מט"ח'}: ${nf(q.data[0], 2)}% · פער נטו: ${sn(q.data[1], 2)} נ"א` },
                xAxis: { type: 'value', name: xAxis === 'fee' ? 'דמי ניהול מצבירה, %' : 'חשיפה למט"ח, %', nameLocation: 'middle', nameGap: 28, scale: true, axisLabel: { color: b.mu }, splitLine: { lineStyle: { color: b.ln2 } } },
                yAxis: { type: 'value', name: 'נטו פחות חציון ברוטו, נ"א', scale: true, axisLabel: { color: b.mu }, splitLine: { lineStyle: { color: b.ln2 } } },
                series: [
                  { type: 'scatter', name: 'פעיל', symbolSize: 9, itemStyle: { color: pal[0] }, data: pts.filter((p) => !p.t.gone).map((p) => [p.x, p.y, p.t.name]) },
                  { type: 'scatter', name: 'נסגר', symbolSize: 9, itemStyle: { color: b.mu }, data: pts.filter((p) => p.t.gone).map((p) => [p.x, p.y, p.t.name]) },
                  ...(fit ? [{ type: 'line', name: 'קו מגמה', symbol: 'none', silent: true, lineStyle: { type: 'dashed', color: b.mu }, data: [[lo, fit.a + fit.b * lo], [hi, fit.a + fit.b * hi]] }] : []),
                ] }; }} />
        )}
        <div className="fnote">ציר אנכי: התשואה נטו של המסלול פחות חציון הקבוצה ברוטו, כלומר כמה העטיפה עלתה בסך הכול. {xAxis === 'fx' ? 'חשיפה נמוכה למט"ח = המסלול מגדר את הדולר; בשנה שבה השקל התחזק, מגדרים הרוויחו.' : 'הקו: ריבועים פחותים, תיאור ולא סיבתיות.'}</div>
      </Panel>

      <Panel title={<>כל עוקבי {g.label}</>} aside={<><span>ממוין לפי דמי ניהול, מהזול</span><Tip k="fee" /></>}>
        <DataTable<TrkTrack> caption={`עוקבי ${g.label}`} rows={tracks} rowKey={(t) => t.k} sort={{ key: 'fee', dir: 'asc' }}
          export={{ name: `עוקבי-מדד-${g.id}-${ym(asof).replace('/', '-')}`, title: `עוקבי ${g.label}`, note: `${wl} · רשות שוק ההון · עד ${ym(asof)}` }}
          columns={[
            { key: 'name', head: 'מסלול', value: (t) => t.name, cell: (t) => <>{f(t) ? <Link to={`/funds/${t.k}`}>{t.name}</Link> : t.name}{t.gone && <span className="chip est">נסגר</span>}</> },
            { key: 'prod', head: 'מוצר', value: (t) => t.prod, className: 'wide-only' },
            { key: 'fee', head: 'ד"נ מצבירה', value: (t) => t.fee, firstDir: 'asc', cell: (t) => (t.fee == null ? <span className="muted">–</span> : <Sourced src={feeSrc(t)}><span className="num">{pc(t.fee)}</span></Sourced>) },
            { key: 'g', head: `ברוטו ${wl}`, value: (t) => t.g[w] ?? null, cell: (t) => (t.g[w] == null ? <span className="muted">–</span> : <Sourced src={gSrc(t)}><span className="num">{pc(t.g[w], 1)}</span></Sourced>) },
            { key: 'td', head: 'פער ברוטו מהחציון', title: 'ברוטו פחות חציון הקבוצה ברוטו', value: (t) => t.td[w] ?? null, cell: (t) => (t.td[w] == null ? <span className="muted">–</span> : <Sourced src={() => tdProv(t)}><span className={`num ${t.td[w]! >= 0 ? 'pos' : 'neg'}`}>{pp(t.td[w])}</span></Sourced>) },
            { key: 'nt', head: `נטו ${wl}`, value: (t) => t.nt?.[w] ?? null, cell: (t) => (t.nt?.[w] == null ? <span className="muted">–</span> : <Sourced src={nSrc(t)}><span className="num">{pc(t.nt[w], 1)}</span></Sourced>) },
            { key: 'cost', head: 'ברוטו פחות נטו', className: 'wide-only', value: gap, cell: (t) => { const v = gap(t); return v == null ? <span className="muted">–</span> : <span className="num">{pp(v)}</span>; } },
            { key: 'fx', head: 'מט"ח', value: (t) => t.fx ?? null, className: 'wide-only', cell: (t) => (t.fx == null ? <span className="muted">–</span> : <Sourced src={fxSrc(t)}><span className="num">{pc(t.fx, 0)}</span></Sourced>) },
            { key: 'a', head: 'נכסים, מ׳ ש"ח', value: (t) => t.assets, className: 'wide-only', unit: 'n', d: 0 },
            { key: 'cmp', head: '', sortable: false, noExport: true, cell: (t) => (f(t) ? <CompareAdd k={t.k} name={t.name} small /> : null) },
          ]} />
        <div className="fnote">עובדה, לא המלצה: מסלולים בעלי אותו מדד שונים גם בגידור המט"ח, במועד ההשקעה ובמבנה המוצר (פוליסה, גמל, פנסיה). {fromFile ? TRK_METHOD : 'הקבוצות לפי שם המסלול ברשות ("עוקב מדד S&P 500" וכו׳); קובץ עוקבי המדד של שכבת הנתונים טרם פורסם.'} מסלולים בניהול אישי (IRA) אינם נכללים.</div>
      </Panel>
    </>
  );
}
