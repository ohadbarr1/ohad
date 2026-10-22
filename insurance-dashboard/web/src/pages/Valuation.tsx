import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Field, Loading, Panel } from '../components/ui';
import { DensityToggle } from '../components/MacroDensity';
import { chartBase, palette } from '../lib/theme';
import { nf, pubLabel, type Unit } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { periodTag, type CompanyKpi } from '../lib/kpi';
import type { Prov } from '../lib/prov';
import type { RegistryCompany } from '../lib/types';
import { useStored } from '../lib/local';
import { usePhone } from '../lib/useMedia';
import { load, useIfrsData, useKpis, useMarket, useRegistry } from '../lib/useData';
import { useMacro, mLabel } from '../lib/macro';
import { ASSUME0, csmMultiples, impliedKe, justifiedPb, keOf, keProv, marketOf, mil, requiredRoe, rfProv, useCsm, useInsurers, xS, pctS, MM,
  type Assume, type Mkt, type Rf, type TasePrice, type CsmOf } from '../lib/valuation';
import type { Market } from '../lib/market';
import '../lib/density';
import '../styles/prov-kpi.css';
import '../styles/market.css';
import '../styles/valuation.css';

export interface VCtx {
  id: string; k: CompanyKpi; name: string; entry: RegistryCompany; price: TasePrice | null; mkt: Mkt;
  a: Assume; setA: (a: Assume) => void; rf: Rf | null; ke: number | null; aum: number | null;
  kpis: Map<string, CompanyKpi>; reg: RegistryCompany[]; insurers: string[];
}
export const useV = () => useOutletContext<VCtx>();

/** A number field: empty means "not set" (NaN), so a default can show through. */
export function Num({ value, onChange, step = 1, label, dec = 4 }: { value: number | null; onChange: (v: number) => void; step?: number; label?: string; dec?: number }) {
  return <input type="number" inputMode="decimal" aria-label={label} value={value != null && Number.isFinite(value) ? +value.toFixed(dec) : ''} step={step} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />;
}
export const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
export const Dash = () => <span className="num muted">–</span>;
/** a figure that opens its source, or a dash */
export function Fig({ v, text, src, className = '' }: { v: number | null | undefined; text: (v: number) => string; src: () => Prov; className?: string }) {
  return fin(v) ? <Sourced className={`num ${className}`} src={src}>{text(v)}</Sourced> : <Dash />;
}

function savingsAum(m: Market | null, group: string | null): number | null {
  if (!m || !group) return null;
  const g = m.groupIndex(group);
  return g < 0 ? null : (m.cell(m.LAST, 'fam:pension', g).a + m.cell(m.LAST, 'fam:gemel', g).a) / 1000;
}

const TABS: [string, string, boolean?][] = [['', 'P/B מוצדק'], ['ri', 'הכנסה שיורית'], ['csm', 'הון ו-CSM'], ['sotp', 'סכום החלקים'], ['dcf', 'DCF · מתקדם', true]];

export function ValuationLayout() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const phone = usePhone();
  const { kpis, error } = useKpis();
  const reg = useRegistry();
  const macro = useMacro().data;
  // market data loads only on the tabs that use the savings assets
  const { market } = useMarket(loc.pathname.endsWith('/sotp'));
  const has = !!reg.data?.find((c) => c.id === id)?.has_price;
  const [price, setPrice] = useState<TasePrice | null>(null);
  useEffect(() => { setPrice(null); if (id && has) load<TasePrice>(`companies/${id}.price.json`).then(setPrice, () => setPrice(null)); }, [id, has]);
  const [a0, setA] = useStored<Assume>('val.assume', ASSUME0);
  const a = { ...ASSUME0, ...a0 };
  const [manual, setManual] = useStored<number | null>(`val.px.${id ?? ''}`, null);
  const insurers = useInsurers(reg.data, kpis);
  if (error) return <ErrorBox what="נתוני החברות" error={error} />;
  if (!kpis || !reg.data) return <Loading what="הערכת שווי" />;
  const ids = reg.data.filter((c) => kpis.get(c.id)?.latest('equity')).map((c) => c.id);
  if (!id || !kpis.has(id)) return <Navigate to={`/valuation/${ids.includes('phoenix') ? 'phoenix' : ids[0]}`} replace />;
  const entry = reg.data.find((c) => c.id === id)!;
  const k = kpis.get(id)!;
  const n10 = macro?.series.nom10;
  const rf: Rf | null = n10?.months.length ? { v: n10.months[n10.months.length - 1][1], month: n10.months[n10.months.length - 1][0], url: n10.url, retrieved: n10.retrieved, code: n10.code } : null;
  const ke = keOf(a, rf);
  const mkt = marketOf(k, price, manual);
  const tab = loc.pathname.split('/')[3] ?? '';
  const set = (p: Partial<Assume>) => setA({ ...a, ...p });
  const ctx: VCtx = { id, k, name: entry.name_he, entry, price, mkt, a, setA, rf, ke, aum: savingsAum(market, entry.market_group), kpis, reg: reg.data, insurers };
  const assumeRow = (
    <div className="vas-grid">
      <label>ריבית חסרת סיכון<small>{a.rf == null ? <>בנק ישראל · אפס 10Y · {rf ? mLabel(rf.month) : '–'}</> : 'ההנחה שלך'}</small>
        <span className="in"><Num label="ריבית חסרת סיכון" value={a.rf ?? rf?.v ?? null} dec={2} step={0.1} onChange={(v) => set({ rf: Number.isFinite(v) ? v : null })} />{a.rf != null && <button type="button" className="btn mini" onClick={() => set({ rf: null })} aria-label="חזרה לנתון בנק ישראל">↺</button>}{a.rf == null && rf && <Sourced className="srcdot" src={() => rfProv(a, rf)}>מקור</Sourced>}</span></label>
      <label>ביתא<small>הנחה</small><Num label="ביתא" value={a.beta} step={0.05} onChange={(v) => set({ beta: v })} /></label>
      <label>פרמיית סיכון<small>הנחה, %</small><Num label="פרמיית סיכון" value={a.erp} step={0.25} onChange={(v) => set({ erp: v })} /></label>
      <div className="ke"><span>מחיר ההון (ke)</span>{fin(ke) ? <Sourced className="num big" src={() => keProv(a, rf)}>{pctS(ke, 2)}</Sourced> : <Dash />}</div>
      <label>צמיחה לטווח ארוך<small>הנחה, %</small><Num label="צמיחה לטווח ארוך" value={a.g} step={0.25} onChange={(v) => set({ g: v })} /></label>
      <label>שיעור מס<small>הנחה, %</small><Num label="שיעור מס" value={a.tax} step={0.5} onChange={(v) => set({ tax: v })} /></label>
      <button type="button" className="btn" onClick={() => setA(ASSUME0)}>איפוס</button>
    </div>
  );
  return (
    <div className="wide-page valuation">
      <div className="pagehead">
        <div><h1>הערכת שווי · {entry.name_he}</h1>
          <div className="sub">מודלים על נתוני הדוחות; המחיר והשווי בשוק הם קלט בלבד · {k.latest('equity') && <>הון לפי {periodTag(k.latest('equity')!.period)}</>}</div></div>
        <div className="vhead-tools">
          <Field label="חברה"><select value={id} onChange={(e) => nav(`/valuation/${e.target.value}${tab ? `/${tab}` : ''}`)}>{ids.map((x) => <option key={x} value={x}>{reg.data!.find((c) => c.id === x)?.name_he}</option>)}</select></Field>
          <DensityToggle />
        </div>
      </div>
      <section className="vinputs" aria-label="קלט שוק">
        <div className="pxfield">
          <span className="l">מחיר למניה <span className="chip est">קלט</span></span>
          <span className="in"><Num label="מחיר למניה, ש&quot;ח" value={mkt.px} step={0.1} onChange={(v) => setManual(Number.isFinite(v) && v > 0 ? v : null)} /><small>ש"ח</small>
            {mkt.manual ? <button type="button" className="btn mini" onClick={() => setManual(null)}>מחיר הבורסה</button> : price && <Sourced className="srcdot" src={mkt.pxProv}>{`TASE · ${pubLabel(price.asof)}`}</Sourced>}</span>
          {mkt.manual && <span className="s">קלט ידני{price && <> · בבורסה <span className="num">{nf(price.last / 100, 2)}</span></>}</span>}
          {!price && !mkt.manual && <span className="s">אין מחיר מהבורסה לחברה זו</span>}
        </div>
        <div><span className="l">שווי שוק</span><span className="v"><Fig v={mkt.mcap} text={(v) => nf(v / 1000, 2)} src={mkt.mcapProv} /><small>מיליארד ש"ח</small></span></div>
        <div><span className="l">P/B</span><span className="v"><Fig v={mkt.pb} text={(v) => xS(v)} src={mkt.pbProv} /></span></div>
        <div><span className="l">P/E, LTM</span><span className="v"><Fig v={mkt.pe} text={(v) => xS(v, 1)} src={mkt.peProv} /></span></div>
        <div><span className="l">ROE, LTM</span><span className="v"><Fig v={mkt.roe} text={(v) => pctS(v)} src={mkt.roeProv} /></span></div>
        <div><span className="l">תשואת דיבידנד, LTM</span><span className="v"><Fig v={mkt.dy} text={(v) => pctS(v)} src={mkt.dyProv} /></span></div>
      </section>
      <details className="vassume panel" open={!phone}>
        <summary><h2>הנחות</h2><span className="muted vas-sum">משותפות לכל המודלים ולטבלת העמיתים <bdi>ke <b className="num">{fin(ke) ? pctS(ke, 2) : '–'}</b></bdi> <bdi>g <b className="num">{pctS(a.g, 2)}</b></bdi> <bdi>מס <b className="num">{pctS(a.tax, 2)}</b></bdi></span></summary>
        {assumeRow}
      </details>
      <nav className="subnav" aria-label="מודל">{TABS.map(([to, l, adv]) => <NavLink key={to} to={to ? to : '.'} end={!to} className={adv ? 'adv' : undefined}>{l}</NavLink>)}</nav>
      <Outlet context={ctx} />
    </div>
  );
}

/* ---------- peers: the insurers on the same multiples ---------- */
export interface PeerRow { id: string; name: string; color: string; mkt: Mkt; jpb: number | null; ike: number | null; csm: CsmOf | null; cm: ReturnType<typeof csmMultiples> }
export function usePeers(): PeerRow[] {
  const { insurers, kpis, reg, id, mkt, a, ke } = useV();
  const ifrs = useIfrsData().data;
  const csm = useCsm(insurers, ifrs);
  const [prices, setPrices] = useState<Record<string, TasePrice | null>>({});
  useEffect(() => {
    let live = true;
    insurers.filter((x) => reg.find((c) => c.id === x)?.has_price).forEach((x) => load<TasePrice>(`companies/${x}.price.json`).then((p) => live && setPrices((c) => ({ ...c, [x]: p })), () => {}));
    return () => { live = false; };
  }, [insurers, reg]);
  const pal = palette();
  return useMemo(() => insurers.map((x) => {
    const k = kpis.get(x)!, m = x === id ? mkt : marketOf(k, prices[x] ?? null, null), c = csm.get(x) ?? null;
    const jpb = fin(m.roe) && fin(ke) ? justifiedPb(m.roe, ke, a.g) : null, ike = fin(m.pb) && fin(m.roe) ? impliedKe(m.pb, m.roe, a.g) : null;
    return { id: x, name: reg.find((r) => r.id === x)?.name_he ?? x, color: pal[reg.findIndex((r) => r.id === x) % pal.length], mkt: m, jpb, ike, csm: c, cm: csmMultiples(m.eq, c?.close.v ?? null, a.tax, m.mcap) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [insurers, kpis, prices, csm, id, mkt, ke, a.g, a.tax, reg]);
}

type ColK = 'mcap' | 'eq' | 'pb' | 'roe' | 'jpb' | 'ike' | 'pe' | 'csm' | 'pec' | 'icm';
const COLS: { k: ColK; l: string; unit?: string; u: Unit; d: number; get: (r: PeerRow) => number | null }[] = [
  { k: 'mcap', l: 'שווי שוק', unit: 'מיליארד', get: (r) => (fin(r.mkt.mcap) ? r.mkt.mcap / 1000 : null), u: 'n', d: 1 },
  { k: 'eq', l: 'הון', unit: 'מיליארד', get: (r) => (fin(r.mkt.eq) ? r.mkt.eq / 1000 : null), u: 'n', d: 1 },
  { k: 'pb', l: 'P/B', get: (r) => r.mkt.pb, u: 'n', d: 2 },
  { k: 'roe', l: 'ROE, LTM', get: (r) => r.mkt.roe, u: 'pct', d: 1 },
  { k: 'jpb', l: 'P/B מוצדק', get: (r) => r.jpb, u: 'n', d: 2 },
  { k: 'ike', l: 'ke משתמע', get: (r) => r.ike, u: 'pct', d: 1 },
  { k: 'pe', l: 'P/E, LTM', get: (r) => r.mkt.pe, u: 'n', d: 1 },
  { k: 'csm', l: 'CSM אחרי מס', unit: 'מיליארד', get: (r) => (r.cm ? r.cm.csmNet / 1000 : null), u: 'n', d: 1 },
  { k: 'pec', l: 'שוק ÷ (הון+CSM)', get: (r) => r.cm?.pec ?? null, u: 'n', d: 2 },
  { k: 'icm', l: 'מכפיל CSM משתמע', get: (r) => r.cm?.implied ?? null, u: 'n', d: 2 },
];

export function PeerTable({ rows, focus }: { rows: PeerRow[]; focus: string }) {
  const { a, ke, rf } = useV();
  const cellProv = (r: PeerRow, k: ColK): Prov => {
    const g = a.g, tax = a.tax;
    switch (k) {
      case 'mcap': return r.mkt.mcapProv();
      case 'eq': return r.mkt.eqProv();
      case 'pb': return r.mkt.pbProv();
      case 'roe': return r.mkt.roeProv();
      case 'pe': return r.mkt.peProv();
      case 'jpb': return { k: 'calc', title: `P/B מוצדק · ${r.name}`, value: xS(r.jpb!), est: true, formula: 'P/B מוצדק = (ROE − g) ÷ (ke − g)',
        inputs: [{ label: 'ROE, LTM', v: pctS(r.mkt.roe!), src: r.mkt.roeProv }, { label: 'ke (הנחות)', v: pctS(ke!, 2), src: () => keProv(a, rf) }, { label: 'g (הנחה)', v: pctS(g, 2) }] };
      case 'ike': return { k: 'calc', title: `מחיר הון משתמע · ${r.name}`, value: pctS(r.ike!), unit: '%', est: true, formula: 'ke משתמע = g + (ROE − g) ÷ P/B בשוק',
        inputs: [{ label: 'P/B בשוק', v: xS(r.mkt.pb!), src: r.mkt.pbProv }, { label: 'ROE, LTM', v: pctS(r.mkt.roe!), src: r.mkt.roeProv }, { label: 'g (הנחה)', v: pctS(g, 2) }] };
      case 'csm': return { k: 'calc', title: `CSM אחרי מס · ${r.name}`, value: mil(r.cm!.csmNet), unit: MM, est: true, formula: 'CSM אחרי מס = יתרת CSM × (1 − שיעור מס)',
        inputs: [{ label: `יתרת CSM, ${periodTag(r.csm!.p)} · ${r.csm!.label}`, v: mil(r.csm!.close.v), src: () => r.csm!.prov(`יתרת CSM · ${r.name}`) }, { label: 'שיעור מס (הנחה)', v: pctS(tax, 2) }] };
      case 'pec': return { k: 'calc', title: `שווי שוק ÷ (הון + CSM אחרי מס) · ${r.name}`, value: xS(r.cm!.pec!), est: true, formula: 'שווי שוק ÷ (הון לבעלי המניות + CSM אחרי מס)',
        inputs: [{ label: 'שווי שוק', v: mil(r.mkt.mcap!), src: r.mkt.mcapProv }, { label: 'הון', v: mil(r.mkt.eq!), src: r.mkt.eqProv }, { label: 'CSM אחרי מס', v: mil(r.cm!.csmNet), src: () => cellProv(r, 'csm') }] };
      case 'icm': return { k: 'calc', title: `מכפיל CSM משתמע · ${r.name}`, value: xS(r.cm!.implied!), est: true, formula: '(שווי שוק − הון) ÷ CSM אחרי מס: כמה משלם השוק מעל ההון על כל שקל CSM אחרי מס',
        inputs: [{ label: 'שווי שוק', v: mil(r.mkt.mcap!), src: r.mkt.mcapProv }, { label: 'הון', v: mil(r.mkt.eq!), src: r.mkt.eqProv }, { label: 'CSM אחרי מס', v: mil(r.cm!.csmNet), src: () => cellProv(r, 'csm') }] };
    }
  };
  return (
    <Panel title="עמיתים" className="peers" aside={<span>ביטוח · שווי שוק מהבורסה, הון ו-CSM מהדוח האחרון</span>}>
      <DataTable className="peer-t" caption="עמיתים: מכפילים והערכת שווי" rows={rows} rowKey={(r) => r.id} rowClass={(r) => (r.id === focus ? 'focus' : undefined)} totalLabel="חציון"
        export={{ name: 'fox_valuation_peers', title: 'הערכת שווי · עמיתים', note: `הנחות: ke ${fin(ke) ? nf(ke, 2) : '–'}%, g ${nf(a.g, 2)}%, מס ${nf(a.tax, 2)}% · שווי שוק: TASE · הון ו-ROE: XBRL · CSM: הדוח הכספי (IFRS 17) · אומדנים, לא המלצה` }}
        columns={[
          { key: 'name', head: 'חברה', value: (r) => r.name, cell: (r) => <><span className="dot" style={{ background: r.color }} /><Link to={`/valuation/${r.id}`}>{r.name}</Link>{r.csm?.inc && <span className="chip est" title="יתרת ה-CSM בטבלת החברה כוללת רווח עתידי בפוליסות חיסכון">כולל פוליסות חיסכון</span>}{r.csm?.b.scope === 'life' && <span className="chip est" title="בדוח שחולץ יתרת ה-CSM מודפסת למגזר חיים בלבד">CSM חיים בלבד</span>}</> },
          ...COLS.map((c): Column<PeerRow> => ({ key: c.k, head: <>{c.l}{c.unit && <span className="dim">{c.unit} ש"ח</span>}</>, label: c.l + (c.unit ? ` (${c.unit} ש"ח)` : ''), value: c.get, unit: c.u, d: c.d, src: (r) => cellProv(r, c.k), total: 'median' })),
        ]} />
      <div className="src">P/B מוצדק ו-ke משתמע: לפי ההנחות שלמעלה · CSM: יתרת סגירה בדוח האחרון שחולץ, נטו מביטוח משנה כשמודפס · הון לבעלי המניות; CSM כולל חלק המיעוט בחברות הבנות · אומדנים להשוואה, לא המלצה</div>
    </Panel>
  );
}

/** ROE against P/B for the insurers, with the justified P/B line at the current ke and g. */
export function PbScatter({ rows, focus }: { rows: PeerRow[]; focus: string }) {
  const { ke, a } = useV();
  const pts = rows.filter((r) => fin(r.mkt.roe) && fin(r.mkt.pb));
  if (pts.length < 2) return null;
  const xs = pts.map((r) => r.mkt.roe!), lo = Math.max(0, Math.floor(Math.min(...xs) - 3)), hi = Math.ceil(Math.max(...xs) + 3);
  return (
    <Panel title="ROE מול P/B" aside={<span>קו: P/B מוצדק ב-ke <span className="num">{fin(ke) ? pctS(ke, 1) : '–'}</span>, g <span className="num">{pctS(a.g, 1)}</span></span>}>
      <Chart label="ROE מול P/B, עמיתים" height={300} deps={[pts.map((r) => `${r.id}${r.mkt.pb}`).join(), ke, a.g, focus]} source="P/B: שווי שוק (TASE) ÷ הון (XBRL) · ROE: LTM, XBRL" build={() => {
        const b = chartBase();
        // a label that would sit on a neighbour's goes below its point
        const pos = new Map<string, string>();
        [...pts].sort((x, y) => x.mkt.roe! - y.mkt.roe!).forEach((r, i, arr) => { const near = arr.slice(0, i).some((q) => pos.get(q.id) === 'top' && Math.abs(q.mkt.roe! - r.mkt.roe!) < 2.5 && Math.abs(q.mkt.pb! - r.mkt.pb!) < 0.35); pos.set(r.id, near ? 'bottom' : 'top'); });
        return {
          grid: { left: 44, right: 16, top: 36, bottom: 36 },
          tooltip: { trigger: 'item', formatter: (p: { seriesName: string; value: [number, number] }) => `${p.seriesName}<br/>ROE ${nf(p.value[0], 1)}% · P/B ${nf(p.value[1], 2)}` },
          xAxis: { type: 'value', name: 'ROE, LTM (%)', nameLocation: 'middle', nameGap: 24, min: lo, max: hi, axisLine: { lineStyle: { color: b.ln } }, splitLine: { show: false }, axisLabel: { color: b.mu } },
          yAxis: { type: 'value', name: 'P/B', min: 0, axisLabel: { color: b.mu }, splitLine: { lineStyle: { color: b.ln, opacity: 0.5 } } },
          series: [
            ...(fin(ke) && ke > a.g ? [{ name: 'P/B מוצדק', type: 'line', silent: true, symbol: 'none', lineStyle: { color: b.mu, type: 'dashed', width: 1 }, data: [lo, hi].map((x) => [x, Math.max(0, (x - a.g) / (ke - a.g))]), tooltip: { show: false } }] : []),
            // drawn as one-point lines with markers: the shared chart bundle carries line and bar only
            ...pts.map((r) => ({ name: r.name, type: 'line', showSymbol: true, symbol: 'circle', lineStyle: { opacity: 0 }, symbolSize: r.id === focus ? 16 : 11, itemStyle: { color: r.color, borderColor: r.id === focus ? b.fg : 'transparent', borderWidth: 1.5 },
              label: { show: true, formatter: r.name, position: pos.get(r.id) ?? 'top', color: b.fg, fontSize: 11 }, data: [[r.mkt.roe!, r.mkt.pb!]] })),
          ],
        };
      }} />
    </Panel>
  );
}

/* ---------- the default view: justified P/B ---------- */
export function ValuationPb() {
  const { id, k, mkt, a, ke, rf, name } = useV();
  const [roeO, setRoeO] = useStored<number | null>(`val.roe.${id}`, null);
  const roe = fin(roeO) ? roeO : mkt.roe;
  const rows = usePeers();
  const jpb = fin(roe) && fin(ke) ? justifiedPb(roe, ke, a.g) : null;
  const ike = fin(mkt.pb) && fin(roe) ? impliedKe(mkt.pb, roe, a.g) : null;
  const rroe = fin(mkt.pb) && fin(ke) ? requiredRoe(mkt.pb, ke, a.g) : null;
  const roeSrc = (): Prov => (fin(roeO) ? { k: 'none', title: 'ROE', why: `ההנחה שלך: ${pctS(roeO)}. ROE LTM מהדוחות: ${fin(mkt.roe) ? pctS(mkt.roe) : '–'}` } : mkt.roeProv());
  const roeLabel = fin(roeO) ? 'ROE (ההנחה שלך)' : `ROE, LTM עד ${mkt.roePeriod ? periodTag(mkt.roePeriod) : ''}`;
  const jpbProv = (): Prov => ({ k: 'calc', title: `P/B מוצדק · ${name}`, value: xS(jpb!), est: true, formula: 'P/B מוצדק = (ROE − g) ÷ (ke − g)',
    inputs: [{ label: roeLabel, v: pctS(roe!), src: roeSrc }, { label: 'ke', v: pctS(ke!, 2), src: () => keProv(a, rf) }, { label: 'g (הנחה)', v: pctS(a.g, 2) }] });
  const ikeProv = (): Prov => ({ k: 'calc', title: 'מחיר הון משתמע מהשוק', value: pctS(ike!), unit: '%', est: true, formula: 'ke משתמע = g + (ROE − g) ÷ P/B בשוק',
    inputs: [{ label: 'P/B בשוק', v: xS(mkt.pb!), src: mkt.pbProv }, { label: roeLabel, v: pctS(roe!), src: roeSrc }, { label: 'g (הנחה)', v: pctS(a.g, 2) }] });
  const rroeProv = (): Prov => ({ k: 'calc', title: 'ROE שהשוק מגלם', value: pctS(rroe!), unit: '%', est: true, formula: 'ROE נדרש = g + P/B בשוק × (ke − g)',
    inputs: [{ label: 'P/B בשוק', v: xS(mkt.pb!), src: mkt.pbProv }, { label: 'ke', v: pctS(ke!, 2), src: () => keProv(a, rf) }, { label: 'g (הנחה)', v: pctS(a.g, 2) }] });
  const roes = fin(roe) ? [-4, -2, 0, 2, 4].map((d) => roe + d) : [], kes = fin(ke) ? [-2, -1, 0, 1, 2].map((d) => ke + d) : [];
  const hist = k.series('roe', 'q').filter((p) => p.v != null).slice(-12);
  if (!fin(mkt.eq)) return <Empty title="אין הון מדווח לחברה זו" />;
  return (
    <>
      <div className="grid12 vgrid">
        <Panel title="קלטים">
          <div className="assume">
            <label>{fin(roeO) ? 'ROE · ההנחה שלך' : 'ROE, LTM'}<small>% · ברירת מחדל: <Sourced src={mkt.roeProv}>{`מהדוחות${mkt.roePeriod ? `, ${periodTag(mkt.roePeriod)}` : ''}`}</Sourced></small></label>
            <span className="in"><Num label="ROE" value={roe} dec={2} step={0.5} onChange={(v) => setRoeO(Number.isFinite(v) ? v : null)} />{fin(roeO) && <button type="button" className="btn mini" onClick={() => setRoeO(null)} aria-label="חזרה ל-ROE מהדוחות">↺</button>}</span>
            <label>מחיר ההון (ke)<small>מההנחות המשותפות</small></label><span className="num ro">{fin(ke) ? pctS(ke, 2) : '–'}</span>
            <label>צמיחה לטווח ארוך (g)<small>מההנחות המשותפות</small></label><span className="num ro">{pctS(a.g, 2)}</span>
            <label>הון לבעלי המניות<small>{mkt.eqPeriod ? periodTag(mkt.eqPeriod) : ''} · מיליוני ש"ח</small></label><Fig v={mkt.eq} text={(v) => nf(v, 0)} src={mkt.eqProv} className="ro" />
          </div>
          {hist.length > 2 && <div className="roehist"><span className="l">ROE, LTM · {hist.length} רבעונים</span>
            <div className="bars">{hist.map((p) => <Sourced key={p.period} className="bar" src={() => k.explain('roe', 'q', p.period)} title={`${periodTag(p.period)} · ${pctS(p.v!)}`}><i style={{ height: `${Math.max(4, Math.min(100, (p.v! / Math.max(...hist.map((h) => h.v!), 1)) * 100))}%` }} /></Sourced>)}</div>
            <span className="axis"><span className="num">{periodTag(hist[0].period)}</span><span className="num">{periodTag(hist[hist.length - 1].period)}</span></span></div>}
        </Panel>
        <div className="vcol">
          <Panel>
            <div className="verdict">
              <div><span className="lbl">P/B מוצדק <span className="chip est">אומדן</span></span><span className="big num">{fin(jpb) ? <Sourced src={jpbProv}>{nf(jpb, 2)}</Sourced> : '–'}</span></div>
              <div><span className="lbl">P/B בשוק</span><span className="big num">{fin(mkt.pb) ? <Sourced src={mkt.pbProv}>{nf(mkt.pb, 2)}</Sourced> : '–'}</span></div>
              <div><span className="lbl">ke משתמע מהשוק</span><span className="mid num">{fin(ike) ? <Sourced src={ikeProv}>{pctS(ike)}</Sourced> : '–'}</span></div>
              <div><span className="lbl">ROE שהשוק מגלם</span><span className="mid num">{fin(rroe) ? <Sourced src={rroeProv}>{pctS(rroe)}</Sourced> : '–'}</span></div>
            </div>
            <div className="formula"><bdi dir="ltr">P/B = (ROE − g) ÷ (ke − g)</bdi> = <bdi dir="ltr" className="num">({fin(roe) ? nf(roe, 1) : '–'} − {nf(a.g, 1)}) ÷ ({fin(ke) ? nf(ke, 1) : '–'} − {nf(a.g, 1)})</bdi>{fin(ke) && ke <= a.g && <span className="chip est">ke חייב לעלות על g</span>}</div>
          </Panel>
          {roes.length > 0 && kes.length > 0 && (
            <Panel title="רגישות: P/B מוצדק" aside={<span>ROE × ke · {fin(mkt.pb) && <>מסומן: מעל ומתחת ל-P/B בשוק (<span className="num">{nf(mkt.pb, 2)}</span>)</>}</span>}>
              <div className="scroll"><table className="sens-t">
                <thead><tr><th>ROE \ ke</th>{kes.map((x) => <th key={x}><span className="num">{nf(x, 1)}%</span></th>)}</tr></thead>
                <tbody>{roes.map((r) => (
                  <tr key={r}><td><span className="num">{nf(r, 1)}%</span></td>{kes.map((x) => {
                    const v = justifiedPb(r, x, a.g), here = r === roe && x === ke, up = fin(v) && fin(mkt.pb) ? v - mkt.pb : null;
                    const bg = up == null ? undefined : `color-mix(in oklch, var(${up >= 0 ? '--up' : '--down'}) ${Math.min(20, Math.abs(up) * 14)}%, transparent)`;
                    return <td key={x} className={`heat${here ? ' here' : ''}`} style={{ background: bg }}><span className="num">{fin(v) ? nf(v, 2) : '–'}</span></td>;
                  })}</tr>
                ))}</tbody>
              </table></div>
            </Panel>
          )}
        </div>
      </div>
      <div className="vpeers">
        <PbScatter rows={rows} focus={id} />
        <PeerTable rows={rows} focus={id} />
      </div>
    </>
  );
}

export function Gate({ ok, onOk, children }: { ok: boolean; onOk: () => void; children?: ReactNode }) {
  return ok ? null : <div className="illus"><b>המחשה בהנחות ברירת מחדל</b><span>{children ?? 'ההנחות טרם נקבעו או אושרו. התוצאה מדגימה את המכניקה ואינה הערכת שווי.'}</span><button type="button" className="btn" onClick={onOk}>אישור ההנחות</button></div>;
}
