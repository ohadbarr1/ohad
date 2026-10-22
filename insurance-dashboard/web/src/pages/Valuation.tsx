import { foxOption } from '../lib/foxchart';
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useOutletContext, useParams, useNavigate } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Count } from '../components/Count';
import { Empty, ErrorBox, Field, Loading, Panel } from '../components/ui';
import { chartBase, palette } from '../lib/theme';
import { nf, pct } from '../lib/format';
import { dividendYield, dividendYieldProv, periodTag, priceProv, type CompanyKpi } from '../lib/kpi';
import type { PriceData } from '../lib/types';
import { Sourced } from '../components/Source';
import type { Prov } from '../lib/prov';
import '../styles/prov-kpi.css';
import { useCompanyPrice, useKpis, useMarket, useRegistry } from '../lib/useData';
import '../styles/market.css';
import type { Market } from '../lib/market';

interface Ctx { k: CompanyKpi; name: string; aum: number | null; px: number | null; price: PriceData | null }
const useV = () => useOutletContext<Ctx>();

function useStored<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, set] = useState<T>(() => { try { const s = localStorage.getItem(key); return s ? { ...init, ...JSON.parse(s) } : init; } catch { return init; } });
  useEffect(() => { try { const s = localStorage.getItem(key); set(s ? { ...init, ...JSON.parse(s) } : init); } catch { set(init); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);
  return [v, (n: T) => { set(n); try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* storage may be blocked */ } }];
}
function Num({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return <input type="number" value={Number.isFinite(value) ? value : ''} step={step} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />;
}
function savingsAum(m: Market | null, group: string | null): number | null {
  if (!m || !group) return null;
  const g = m.groupIndex(group);
  return g < 0 ? null : (m.cell(m.LAST, 'fam:pension', g).a + m.cell(m.LAST, 'fam:gemel', g).a) / 1000;
}

const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;

export function ValuationLayout() {
  const { id } = useParams();
  const nav = useNavigate();
  const { kpis, error } = useKpis();
  const reg = useRegistry();
  const { market } = useMarket();
  // the price file of the company on screen only, and only for a company that has one
  const price = useCompanyPrice(id ?? null, !!reg.data?.find((c) => c.id === id)?.has_price).data;
  if (error) return <ErrorBox what="נתוני החברות" error={error} />;
  if (!kpis || !reg.data) return <Loading what="הערכת שווי" />;
  const ids = [...kpis.keys()];
  if (!id || !kpis.has(id)) return <Navigate to={`/valuation/${ids.includes('phoenix') ? 'phoenix' : ids[0]}/dcf`} replace />;
  const entry = reg.data.find((c) => c.id === id)!;
  const k = kpis.get(id)!;
  const px = price ? price.last / 100 : null, sh = k.lastShares();
  return (
    <>
      <div className="pagehead">
        <div><h1>הערכת שווי · {entry.name_he}</h1>
          <div className="sub">{px != null && price && <span className="pxin">קלט להערכה: <Sourced src={() => priceProv(price)}>מחיר סגירה אחרון <span className="num">{nf(px, 2)}</span> ש"ח</Sourced> · <span className="num">{dmy(price.asof)}</span> · <span className="num">{price.ticker}</span></span>}{px == null && <>אין מחיר מוגדר לחברה זו: יחס המחיר להערכה אינו מחושב</>}{px != null && price && sh != null && <> · <Sourced src={() => k.marketCapNow(price)}>שווי שוק <span className="num">{nf((px * sh) / 1e9, 1)}</span> מיליארד ש"ח</Sourced> <span className="chip est">נגזר</span></>}</div></div>
        <Field label="חברה"><select value={id} onChange={(e) => nav(`/valuation/${e.target.value}/${location.pathname.endsWith('sotp') ? 'sotp' : 'dcf'}`)}>{ids.map((x) => <option key={x} value={x}>{reg.data!.find((c) => c.id === x)?.name_he}</option>)}</select></Field>
      </div>
      {price && <MarketStrip k={k} price={price} />}
      <nav className="subnav" aria-label="מודל"><NavLink to="dcf">DCF להון</NavLink><NavLink to="sotp">סכום החלקים (SOTP)</NavLink></nav>
      <Outlet context={{ k, name: entry.name_he, aum: savingsAum(market, entry.market_group), px, price: price ?? null } satisfies Ctx} />
    </>
  );
}

/** The price-based figures of the company, the only place they live: market value, multiples and dividend yield, each opening its inputs. */
function MarketStrip({ k, price }: { k: CompanyKpi; price: PriceData }) {
  const roe = k.latest('roe'), sh = k.lastShares(), mc = sh ? (price.last / 100 * sh) / 1e6 : null, y = dividendYield(price);
  const pb = k.multipleNow('pb', price), pe = k.multipleNow('pe', price);
  const item = (label: string, p: Prov, text: string | null, unit?: string) => (
    <div><span className="l">{label}</span><span className="v num">{text == null || p.k === 'none' ? (p.k === 'none' && text != null ? <Sourced src={() => p}>–</Sourced> : '–') : <Sourced src={() => p}>{text}</Sourced>}{unit && text != null && <small>{unit}</small>}</span></div>
  );
  const mult = (p: Prov) => (p.k === 'calc' ? p.value : null);
  return (
    <section className="vstrip" aria-label="נתוני שוק">
      {item('שווי שוק', k.marketCapNow(price), mc == null ? null : nf(mc / 1000, 1), 'מיליארד ש"ח')}
      {item('P/B', pb, mult(pb))}
      {item('P/E, LTM', pe, mult(pe))}
      {item('תשואת דיבידנד, LTM', dividendYieldProv(price), y == null ? null : `${nf(y, 1)}%`)}
      {roe && item(`ROE, LTM`, k.explain('roe', 'q', roe.period), `${nf(roe.v!, 1)}%`)}
    </section>
  );
}

/* ---------- DCF to equity ---------- */
interface DcfIn { e0: number; g: number; years: number; payout: number; ke: number; gt: number }
function dcf(a: DcfIn) {
  const rows: { t: number; e: number; d: number; pv: number }[] = [];
  let e = a.e0, sum = 0;
  for (let t = 1; t <= a.years; t++) { e *= 1 + a.g / 100; const d = e * a.payout / 100, pv = d / Math.pow(1 + a.ke / 100, t); rows.push({ t, e, d, pv }); sum += pv; }
  const spread = (a.ke - a.gt) / 100;
  const tv = spread > 0 ? (e * (1 + a.gt / 100) * a.payout / 100) / spread : NaN;
  const pvTv = tv / Math.pow(1 + a.ke / 100, a.years);
  return { rows, sum, tv, pvTv, value: sum + pvTv };
}
function impliedKe(a: DcfIn, target: number): number | null {
  let lo = a.gt + 0.2, hi = 40;
  if (!(dcf({ ...a, ke: lo }).value > target) || !(dcf({ ...a, ke: hi }).value < target)) return null;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (dcf({ ...a, ke: mid }).value > target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export function Dcf() {
  const { k, px, price } = useV();
  const base = k.latest('profit', 'ltm'), eq = k.latest('equity'), roe = k.latest('roe');
  const sh = k.lastShares();
  // defaults: base profit as reported, growth = ROE x retention held to 2-6%, payout 40% (the filings give no payout ratio), ke 10%, g 3%
  const g0 = roe?.v != null ? Math.min(6, Math.max(2, Math.round(roe.v * 0.6 * 2) / 2)) : 5;
  const init: DcfIn = { e0: Math.round(base?.v ?? 0), g: g0, years: 5, payout: 40, ke: 10, gt: 3 };
  const [a, setA] = useStored<DcfIn>(`fox.dcf.${k.id}`, init);
  // the result is a verdict only once the assumptions are the user's: edited, or confirmed with the button
  const [okS, setOk] = useStored<{ ok: boolean }>(`fox.dcf.ok.${k.id}`, { ok: false });
  const ok = okS.ok;
  const set = (p: Partial<DcfIn>) => { setA({ ...a, ...p }); if (!ok) setOk({ ok: true }); };
  const r = useMemo(() => dcf(a), [a]);
  const mcap = px && sh ? (px * sh) / 1e6 : null;
  const perShare = sh ? (r.value * 1e6) / sh : null;
  const upside = perShare && px ? (perShare / px - 1) * 100 : null;
  const ik = mcap ? impliedKe(a, mcap) : null;
  const jpb = roe?.v != null && a.ke > a.gt ? (roe.v - a.gt) / (a.ke - a.gt) : null;
  const kes = [-2, -1, 0, 1, 2].map((d) => a.ke + d), gts = [-1, -0.5, 0, 0.5, 1].map((d) => a.gt + d);
  const pal = palette();
  if (!base?.v) return <Empty title="אין רווח LTM לחברה זו" />;
  const mil = (v: number) => `${nf(v, 0)} מיליוני ש"ח`;
  // the model's outputs are estimates from the user's assumptions; the filings and the price enter as inputs with their own sources
  const eqProv = (): Prov => ({ k: 'calc', title: 'שווי הון, DCF', value: mil(r.value), unit: 'מיליוני ש"ח', est: true, formula: 'שווי הון = ערך נוכחי של החלוקות + ערך נוכחי של ערך הסיום',
    inputs: [{ label: 'רווח בסיס (ההנחה שלך; ברירת מחדל LTM)', v: mil(a.e0), src: a.e0 === Math.round(base.v ?? 0) ? () => k.explain('profit', 'ltm', base.period) : undefined }, { label: 'צמיחת רווח שנתית (ההנחה שלך)', v: `${nf(a.g, 1)}%` }, { label: `שנות תחזית (ההנחה שלך)`, v: String(a.years) },
      { label: 'שיעור חלוקה (ההנחה שלך)', v: `${nf(a.payout, 0)}%` }, { label: 'מחיר ההון (ההנחה שלך)', v: `${nf(a.ke, 2)}%` }, { label: 'צמיחה לטווח ארוך (ההנחה שלך)', v: `${nf(a.gt, 2)}%` },
      { label: 'ערך נוכחי של החלוקות', v: mil(r.sum) }, { label: 'ערך נוכחי של ערך הסיום', v: mil(r.pvTv) }] });
  const perShareProv = (): Prov => perShare == null ? { k: 'none', title: 'שווי למניה', why: 'מספר המניות אינו ניתן לגזירה' } : { k: 'calc', title: 'שווי למניה, DCF', value: `${nf(perShare, 2)} ש"ח`, unit: 'ש"ח', est: true, formula: 'שווי למניה = שווי הון ÷ מניות',
    inputs: [{ label: 'שווי הון, DCF', v: mil(r.value), src: eqProv }, { label: 'מניות', v: `${nf(sh! / 1e6, 1)} מיליון`, src: () => k.sharesProv() }] };
  const upsideProv = (): Prov => upside == null || !price ? { k: 'none', title: 'פער מהמחיר', why: 'אין מחיר או שווי למניה' } : { k: 'calc', title: 'שווי למניה מול מחיר', value: `${nf(upside, 1)}%`, unit: '%', est: true, formula: 'פער = שווי למניה ÷ מחיר סגירה אחרון − 1',
    inputs: [{ label: 'שווי למניה, DCF', v: `${nf(perShare!, 2)} ש"ח`, src: perShareProv }, { label: 'מחיר סגירה אחרון', v: `${nf(px!, 2)} ש"ח`, src: () => priceProv(price) }] };
  const roeSrc = roe?.v != null ? () => k.explain('roe', 'q', roe.period) : undefined;
  const justProv = (): Prov => ({ k: 'calc', title: 'מכפיל הון מוצדק', value: nf(jpb!, 2), est: true, formula: 'P/B מוצדק = (ROE − g) ÷ (ke − g)',
    inputs: [{ label: 'ROE, LTM', v: `${nf(roe!.v!, 1)}%`, src: roeSrc }, { label: 'מחיר ההון (ההנחה שלך)', v: `${nf(a.ke, 2)}%` }, { label: 'צמיחה לטווח ארוך (ההנחה שלך)', v: `${nf(a.gt, 2)}%` }] });
  const impliedProv = (): Prov => ({ k: 'calc', title: 'מחיר הון משתמע ממחיר השוק', value: `${nf(ik!, 1)}%`, unit: '%', est: true, formula: 'ke שבו שווי ה-DCF שווה לשווי השוק (פתרון נומרי, שאר ההנחות שלך)',
    inputs: [{ label: 'שווי שוק', v: mil(mcap!), src: price ? () => k.marketCapNow(price) : undefined }, { label: 'שווי הון, DCF בשיעור זה', v: mil(mcap!), src: eqProv }] });
  const impliedPbProv = (): Prov => ({ k: 'calc', title: 'מכפיל הון משתמע מהמודל', value: nf(r.value / eq!.v!, 2), est: true, formula: 'שווי הון DCF ÷ הון לבעלי המניות',
    inputs: [{ label: 'שווי הון, DCF', v: mil(r.value), src: eqProv }, { label: `הון, ${periodTag(eq!.period)}`, v: mil(eq!.v!), src: () => k.explain('equity', 'q', eq!.period) }] });
  return (
    <div className="grid12">
      <Panel title="הנחות" aside={<button type="button" className="btn" onClick={() => { setA(init); setOk({ ok: false }); }}>איפוס</button>}>
        <div className="assume">
          <h4>בסיס</h4>
          <label>רווח נקי בסיס<small>מיליוני ש"ח · ברירת מחדל: <Sourced src={() => k.explain('profit', 'ltm', base.period)}>LTM עד {periodTag(base.period)}</Sourced></small></label><Num value={a.e0} onChange={(v) => set({ e0: v })} step={10} />
          <h4>תחזית</h4>
          <label>צמיחת רווח שנתית<small>% · ברירת מחדל: ROE LTM × 60%, בטווח 2% עד 6%</small></label><Num value={a.g} onChange={(v) => set({ g: v })} step={0.5} />
          <label>שנות תחזית</label><Num value={a.years} onChange={(v) => set({ years: Math.max(1, Math.min(15, Math.round(v) || 1)) })} />
          <label>שיעור חלוקה<small>% מהרווח · ברירת מחדל, הדוחות אינם מציגים שיעור חלוקה</small></label><Num value={a.payout} onChange={(v) => set({ payout: v })} step={5} />
          <h4>היוון</h4>
          <label>מחיר ההון<small>%</small></label><Num value={a.ke} onChange={(v) => set({ ke: v })} step={0.25} />
          <label>צמיחה לטווח ארוך<small>%</small></label><Num value={a.gt} onChange={(v) => set({ gt: v })} step={0.25} />
        </div>
        <div className="src">כל ההנחות שלך. ברירות המחדל אינן תחזית.</div>
      </Panel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <Panel>
          {!ok && <div className="illus"><b>המחשה בהנחות ברירת מחדל</b><span>ההנחות טרם נקבעו או אושרו. התוצאה מדגימה את המכניקה ואינה הערכת שווי.</span><button type="button" className="btn" onClick={() => setOk({ ok: true })}>אישור ההנחות</button></div>}
          <div className={`verdict${ok ? '' : ' ghost'}`}>
            <div><span className="lbl">{ok ? 'שווי למניה' : 'שווי למניה, המחשה'} <span className="chip est">{ok ? 'אומדן' : 'המחשה'}</span></span><span className="big num"><Sourced src={perShareProv}><Count value={perShare} dec={2} /></Sourced></span> <span className="muted">ש"ח</span></div>
            {ok && <div><span className="lbl">מול מחיר {px != null && price && <Sourced src={() => priceProv(price)}><span className="num">{nf(px, 2)}</span></Sourced>}</span><span className={`big num ${(upside ?? 0) >= 0 ? 'pos' : 'neg'}`}><Sourced src={upsideProv}><Count value={upside} dec={1} suffix="%" signed /></Sourced></span></div>}
            <div><span className="lbl">שווי הון</span><span className="num" style={{ fontSize: 20, fontWeight: 600 }}><Sourced src={eqProv}><Count value={r.value} /></Sourced></span> <span className="muted">מיליוני ש"ח</span></div>
          </div>
          <table><tbody>
            <tr><td>ערך נוכחי של חלוקות, {a.years} שנים</td><td><span className="num">{nf(r.sum, 0)}</span></td><td><span className="num muted">{pct(r.sum / r.value * 100, 0)}</span></td></tr>
            <tr><td>ערך נוכחי של ערך הסיום</td><td><span className="num">{nf(r.pvTv, 0)}</span></td><td><span className="num muted">{pct(r.pvTv / r.value * 100, 0)}</span></td></tr>
            <tr><td>מכפיל הון משתמע מהמודל</td><td>{eq?.v ? <Sourced src={impliedPbProv}><span className="num">{nf(r.value / eq.v, 2)}</span></Sourced> : <span className="num">–</span>}</td><td /></tr>
            <tr><td>מכפיל הון מוצדק: <bdi dir="ltr">(ROE − g) / (ke − g)</bdi><span className="dim">ROE {roe?.v != null ? <Sourced src={roeSrc!}>{pct(roe.v, 1)}</Sourced> : '–'}, LTM</span></td><td>{jpb == null ? <span className="num">–</span> : <Sourced src={justProv}><span className="num">{nf(jpb, 2)}</span></Sourced>}</td><td /></tr>
            <tr><td>מחיר הון משתמע ממחיר השוק</td><td>{ik == null ? <span className="num">–</span> : <Sourced src={impliedProv}><span className="num">{pct(ik, 1)}</span></Sourced>}</td><td /></tr>
          </tbody></table>
        </Panel>
        <div className="grid2">
          <Panel title="חלוקות חזויות וערך נוכחי" aside={<span>מיליוני ש"ח</span>}>
            <Chart label="חלוקות" height={230} deps={[a]} build={() => {
              return foxOption({ x: r.rows.map((x) => `+${x.t}`), unit: 'מיליוני ש"ח', full: true, labels: false, series: [
                { name: 'רווח', kind: 'bar', color: pal[7], opacity: 0.5, dec: 0, data: r.rows.map((x) => +x.e.toFixed(0)) },
                { name: 'חלוקה', kind: 'bar', overlay: true, color: pal[0], dec: 0, data: r.rows.map((x) => +x.d.toFixed(0)) },
                { name: 'ערך נוכחי', kind: 'line', color: pal[1], dec: 0, data: r.rows.map((x) => +x.pv.toFixed(0)) }] });
            }} />
          </Panel>
          <Panel title="רגישות: שווי למניה" aside={<span>מחיר הון × צמיחה לטווח ארוך</span>}>
            <div className="scroll"><table>
              <thead><tr><th>ke \ g</th>{gts.map((g) => <th key={g}><span className="num">{nf(g, 1)}%</span></th>)}</tr></thead>
              <tbody>{kes.map((ke) => (
                <tr key={ke}><td><span className="num">{nf(ke, 1)}%</span></td>{gts.map((gt) => {
                  const v = sh ? (dcf({ ...a, ke, gt }).value * 1e6) / sh : NaN, up = px ? v / px - 1 : 0, here = ke === a.ke && gt === a.gt;
                  const bg = !ok || !Number.isFinite(v) ? undefined : `color-mix(in oklch, var(${up >= 0 ? '--up' : '--down'}) ${Math.min(42, Math.abs(up) * 60)}%, transparent)`;
                  return <td key={gt} className="heat" style={{ background: bg, outline: here ? '1px solid var(--fg)' : undefined, outlineOffset: -1 }}><span className="num">{Number.isFinite(v) ? nf(v, 1) : '–'}</span></td>;
                })}</tr>
              ))}</tbody>
            </table></div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ---------- sum of the parts ---------- */
type Basis = 'book' | 'profit' | 'aum';
interface Part { name: string; basis: Basis; amount: number; mult: number }
const BASIS: Record<Basis, { label: string; amount: string; mult: string; value: (p: Part) => number }> = {
  book: { label: 'הון × מכפיל הון', amount: 'הון, מיליוני ש"ח', mult: 'P/B', value: (p) => p.amount * p.mult },
  profit: { label: 'רווח × מכפיל רווח', amount: 'רווח, מיליוני ש"ח', mult: 'P/E', value: (p) => p.amount * p.mult },
  aum: { label: 'נכסים מנוהלים × %', amount: 'נכסים, מיליארדי ש"ח', mult: '% מהנכסים', value: (p) => p.amount * 1000 * p.mult / 100 },
};

export function Sotp() {
  const { k, aum, px, price } = useV();
  const eq = k.latest('equity');
  // only parts with a figure behind them: a part at zero is added by the user, with the segment profit read from the profit-sources tab
  const init: { parts: Part[]; adj: number } = { adj: 0, parts: [
    { name: 'ביטוח (חיים, בריאות, כללי)', basis: 'book', amount: Math.round(eq?.v ?? 0), mult: 1 },
    ...(aum ? [{ name: 'ניהול נכסים: פנסיה וגמל', basis: 'aum' as Basis, amount: +aum.toFixed(1), mult: 1.5 }] : []),
  ] };
  const [s, setS0] = useStored(`fox.sotp.v2.${k.id}`, init);
  const [okS, setOk] = useStored<{ ok: boolean }>(`fox.sotp.ok.${k.id}`, { ok: false });
  const ok = okS.ok;
  const setS = (n: typeof init) => { setS0(n); if (!ok) setOk({ ok: true }); };
  const setPart = (i: number, p: Partial<Part>) => setS({ ...s, parts: s.parts.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const vals = s.parts.map((p) => BASIS[p.basis].value(p)).map((v) => (Number.isFinite(v) ? v : 0));
  const total = vals.reduce((x, y) => x + y, 0) + (Number.isFinite(s.adj) ? s.adj : 0);
  const sh = k.lastShares(), mcap = px && sh ? (px * sh) / 1e6 : null;
  const perShare = sh ? (total * 1e6) / sh : null, gap = mcap && total ? (mcap / total - 1) * 100 : null;
  const pal = palette();
  const mil = (v: number) => `${nf(v, 0)} מיליוני ש"ח`;
  const totalProv = (): Prov => ({ k: 'calc', title: 'סכום החלקים', value: mil(total), unit: 'מיליוני ש"ח', est: true, formula: 'סכום החלקים = Σ (בסיס × מכפיל) + התאמות חברת האם',
    inputs: [...s.parts.map((p, i) => ({ label: `${p.name} (${BASIS[p.basis].mult} ${nf(p.mult, 2)}, ההנחה שלך)`, v: mil(vals[i]), src: p.basis === 'book' && eq?.v != null && p.amount === Math.round(eq.v) ? () => k.explain('equity', 'q', eq.period) : undefined })), { label: 'התאמות חברת האם (ההנחה שלך)', v: mil(Number.isFinite(s.adj) ? s.adj : 0) }] });
  const perShareProv = (): Prov => perShare == null ? { k: 'none', title: 'שווי למניה', why: 'מספר המניות אינו ניתן לגזירה' } : { k: 'calc', title: 'שווי למניה, SOTP', value: `${nf(perShare, 2)} ש"ח`, unit: 'ש"ח', est: true, formula: 'שווי למניה = סכום החלקים ÷ מניות',
    inputs: [{ label: 'סכום החלקים', v: mil(total), src: totalProv }, { label: 'מניות', v: `${nf(sh! / 1e6, 1)} מיליון`, src: () => k.sharesProv() }] };
  const mcapProv = (): Prov => (price ? k.marketCapNow(price) : { k: 'none', title: 'שווי שוק', why: 'אין מחיר לחברה' });
  const gapProv = (): Prov => gap == null ? { k: 'none', title: 'שווי שוק מול סכום החלקים', why: 'אין מחיר או סכום' } : { k: 'calc', title: 'שווי שוק מול סכום החלקים', value: `${nf(gap, 1)}%`, unit: '%', est: true, formula: 'פער = שווי שוק ÷ סכום החלקים − 1',
    inputs: [{ label: 'שווי שוק', v: mil(mcap!), src: mcapProv }, { label: 'סכום החלקים', v: mil(total), src: totalProv }] };
  return (
    <>
      <Panel>
        {!ok && <div className="illus"><b>המחשה בהנחות ברירת מחדל</b><span>החלקים והמכפילים טרם נקבעו או אושרו. התוצאה מדגימה את המכניקה ואינה הערכת שווי.</span><button type="button" className="btn" onClick={() => setOk({ ok: true })}>אישור ההנחות</button></div>}
        <div className={`verdict${ok ? '' : ' ghost'}`}>
          <div><span className="lbl">{ok ? 'שווי למניה' : 'שווי למניה, המחשה'} <span className="chip est">{ok ? 'אומדן' : 'המחשה'}</span></span><span className="big num"><Sourced src={perShareProv}><Count value={perShare} dec={2} /></Sourced></span> <span className="muted">ש"ח</span></div>
          {ok && <div><span className="lbl">שווי שוק מול סכום החלקים</span><span className={`big num ${(gap ?? 0) <= 0 ? 'pos' : 'neg'}`}><Sourced src={gapProv}><Count value={gap} dec={1} suffix="%" signed /></Sourced></span></div>}
          <div><span className="lbl">סכום החלקים</span><span className="num" style={{ fontSize: 20, fontWeight: 600 }}><Sourced src={totalProv}><Count value={total} /></Sourced></span> <span className="muted">מיליוני ש"ח{ok && mcap != null && <> · שוק <Sourced src={mcapProv}><span className="num">{nf(mcap, 0)}</span></Sourced></>}</span></div>
        </div>
        <Chart label="סכום החלקים" height={70} deps={[vals.join(), s.adj, mcap, ok]} build={() => {
          const b = chartBase();
          return { animationDuration: 500, grid: { left: 0, right: 0, top: 4, bottom: 4 }, tooltip: { trigger: 'item', backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: (v: number) => nf(v, 0) },
            xAxis: { type: 'value', show: false, max: Math.max(total, ok ? mcap ?? 0 : 0) * 1.02 }, yAxis: { type: 'category', show: false, data: [''] },
            series: [...s.parts.map((p, i) => ({ name: p.name, type: 'bar', stack: 'a', data: [Math.max(0, vals[i])], barWidth: 26, itemStyle: { color: pal[i % pal.length], borderRadius: 3 } })),
              ...(ok && mcap ? [{ name: 'שווי שוק', type: 'line', data: [], markLine: { symbol: 'none', silent: true, lineStyle: { color: b.fg, width: 1.5 }, label: { formatter: 'שווי שוק', color: b.mu, fontSize: 11 }, data: [{ xAxis: mcap }] } }] : [])] };
        }} />
      </Panel>
      <Panel title="חלקים" aside={<><button type="button" className="btn" onClick={() => setS({ ...s, parts: [...s.parts, { name: 'חלק חדש', basis: 'profit', amount: 0, mult: 10 }] })}>הוסף חלק</button><button type="button" className="btn" onClick={() => { setS0(init); setOk({ ok: false }); }}>איפוס</button></>}>
        <div className="scroll"><table>
          <thead><tr><th>חלק</th><th>שיטה</th><th>בסיס</th><th>מכפיל</th><th>שווי, מיליוני ש"ח</th><th>% מהסכום</th><th /></tr></thead>
          <tbody>
            {s.parts.map((p, i) => (
              <tr key={i}>
                <td><span className="dot" style={{ background: pal[i % pal.length], marginInlineEnd: 8 }} /><input type="text" value={p.name} onChange={(e) => setPart(i, { name: e.target.value })} aria-label="שם החלק" /></td>
                <td><select value={p.basis} onChange={(e) => setPart(i, { basis: e.target.value as Basis })}>{(Object.keys(BASIS) as Basis[]).map((b) => <option key={b} value={b}>{BASIS[b].label}</option>)}</select></td>
                <td style={{ width: 130 }}><Num value={p.amount} onChange={(v) => setPart(i, { amount: v })} step={p.basis === 'aum' ? 1 : 10} /><span className="dim">{BASIS[p.basis].amount}</span></td>
                <td style={{ width: 100 }}><Num value={p.mult} onChange={(v) => setPart(i, { mult: v })} step={0.1} /><span className="dim">{BASIS[p.basis].mult}</span></td>
                <td><span className="num">{p.amount ? nf(vals[i], 0) : '–'}</span></td><td><span className="num muted">{total && p.amount ? pct(vals[i] / total * 100, 0) : '–'}</span></td>
                <td><button type="button" className="btn" aria-label="הסר" onClick={() => setS({ ...s, parts: s.parts.filter((_, j) => j !== i) })}>×</button></td>
              </tr>
            ))}
            <tr><td>התאמות חברת האם<span className="dim">חוב נטו, עודפי הון, מיעוט · שלילי להפחתה</span></td><td /><td /><td /><td style={{ width: 130 }}><Num value={s.adj} onChange={(v) => setS({ ...s, adj: v })} step={50} /></td><td /><td /></tr>
            <tr className="tot"><td>סכום החלקים</td><td /><td /><td /><td><span className="num">{nf(total, 0)}</span></td><td /><td /></tr>
          </tbody>
        </table></div>
        <div className="src">ברירות המחדל: הון הקבוצה מה-XBRL, נכסי פנסיה וגמל מרשות שוק ההון. הון הקבוצה כבר כולל את חברות הניהול, ולכן יש להפחית אותו כשמעריכים אותן בנפרד. רווחי המגזרים כפי שדווחו מופיעים בלשונית <Link to={`/company/${k.id}/profit`}>מקורות הרווח</Link> של החברה; אפשר להוסיף מהם חלק בשיטת רווח × מכפיל רווח.</div>
      </Panel>
    </>
  );
}
