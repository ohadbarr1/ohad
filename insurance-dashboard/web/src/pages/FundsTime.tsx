import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BasisToggle, FundsHead } from '../components/FundsNav';
import { IdDot } from '../components/MgrChip';
import { Sourced } from '../components/Source';
import { Chart } from '../components/Chart';
import { DataTable } from '../components/DataTable';
import { Tip } from '../components/Explain';
import { Empty, ErrorBox, Loading, Panel, Pick, Seg } from '../components/ui';
import { useFunds } from '../lib/useData';
import { useSource, type Prov } from '../lib/prov';
import { chartBase, CHART_FONT } from '../lib/theme';
import { nf, sn } from '../lib/format';
import { expP, fundP } from '../lib/market';
import { NET_LABEL, netProv, pc, refOf, retOf, selfDirected, useBasis, type Basis, type FundX, type FundsFile, type Per } from '../lib/funds';
import { BANDS, stepDown, ymL, type Band } from '../lib/fundsTime';
import { useGlide, useHists } from '../lib/fundsTimeLoad';
import '../styles/lens.css';
import '../styles/market.css';
import '../styles/funds-time.css';

/* F2 TIME, the views of the section's "סיכון וזמן" tab: the age-track glide paths (#15) (the peer rank over time, #11, is the screener's
   persistence column since wave 2b).
   Net of fee by default; closed tracks are in every historical view (survivorship); every number opens its source. The map (#10), the
   quilt (#13) and the persistence view (#12) were removed (owner, 01.11.26; code cut in phase 0, 05.11.26); their addresses land on
   the screener sorted by persistence. The persistence file (funds/persist.json) is still built: the answers Q-220 and Q-221 read it. */

const useFile = () => { const { data, error } = useFunds(); return { data: data as FundsFile | undefined, error }; };
const basisLbl = (b: Basis) => (b === 'net' ? NET_LABEL : 'ברוטו');

/* the percentile over time by category (#11) left this page in wave 2b (fox 3.0): it is the screener's persistence column
   (/funds/screen?sort=persist; /funds/rank lands there) and the percentile chart of the track card */

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
