import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Outlet, useOutletContext, useParams, useNavigate } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Count } from '../components/Count';
import { Empty, ErrorBox, Field, Loading, Panel } from '../components/ui';
import { CHART_FONT, chartBase, palette } from '../lib/theme';
import { nf, pct } from '../lib/format';
import type { CompanyKpi } from '../lib/kpi';
import { useKpis, useMarket, useRegistry } from '../lib/useData';
import type { Market } from '../lib/market';

interface Ctx { k: CompanyKpi; name: string; aum: number | null }
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

export function ValuationLayout() {
  const { id } = useParams();
  const nav = useNavigate();
  const { kpis, error } = useKpis();
  const reg = useRegistry();
  const { market } = useMarket();
  if (error) return <ErrorBox what="נתוני החברות" error={error} />;
  if (!kpis || !reg.data) return <Loading what="הערכת שווי" />;
  const ids = [...kpis.keys()];
  if (!id || !kpis.has(id)) return <Navigate to={`/valuation/${ids.includes('phoenix') ? 'phoenix' : ids[0]}/dcf`} replace />;
  const entry = reg.data.find((c) => c.id === id)!;
  const k = kpis.get(id)!;
  const px = k.lastPrice(), sh = k.lastShares();
  return (
    <>
      <div className="pagehead">
        <div><h1>הערכת שווי · {entry.name_he}</h1>
          <div className="sub">{px != null && <>מחיר <span className="num">{nf(px, 2)}</span> ש"ח</>}{px != null && sh != null && <> · שווי שוק <span className="num">{nf((px * sh) / 1e9, 1)}</span> מיליארד ש"ח <span className="chip est">נגזר</span></>}</div></div>
        <Field label="חברה"><select value={id} onChange={(e) => nav(`/valuation/${e.target.value}/${location.hash.endsWith('sotp') ? 'sotp' : 'dcf'}`)}>{ids.map((x) => <option key={x} value={x}>{reg.data!.find((c) => c.id === x)?.name_he}</option>)}</select></Field>
      </div>
      <nav className="subnav" aria-label="מודל"><NavLink to="dcf">DCF להון</NavLink><NavLink to="sotp">סכום החלקים (SOTP)</NavLink></nav>
      <Outlet context={{ k, name: entry.name_he, aum: savingsAum(market, entry.market_group) } satisfies Ctx} />
    </>
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
  const { k } = useV();
  const base = k.latest('profit', 'ltm'), eq = k.latest('equity'), roe = k.latest('roe');
  const sh = k.lastShares(), px = k.lastPrice();
  const init: DcfIn = { e0: Math.round(base?.v ?? 0), g: 5, years: 5, payout: 40, ke: 10, gt: 2.5 };
  const [a, setA] = useStored<DcfIn>(`fox.dcf.${k.id}`, init);
  const set = (p: Partial<DcfIn>) => setA({ ...a, ...p });
  const r = useMemo(() => dcf(a), [a]);
  const mcap = px && sh ? (px * sh) / 1e6 : null;
  const perShare = sh ? (r.value * 1e6) / sh : null;
  const upside = perShare && px ? (perShare / px - 1) * 100 : null;
  const ik = mcap ? impliedKe(a, mcap) : null;
  const jpb = roe?.v != null && a.ke > a.gt ? (roe.v - a.gt) / (a.ke - a.gt) : null;
  const kes = [-2, -1, 0, 1, 2].map((d) => a.ke + d), gts = [-1, -0.5, 0, 0.5, 1].map((d) => a.gt + d);
  const pal = palette();
  if (!base?.v) return <Empty title="אין רווח LTM לחברה זו" />;
  return (
    <div className="grid12">
      <Panel title="הנחות" aside={<button type="button" className="btn" onClick={() => setA(init)}>איפוס</button>}>
        <div className="assume">
          <h4>בסיס</h4>
          <label>רווח נקי בסיס<small>מיליוני ש"ח · ברירת מחדל: LTM עד {base.period}</small></label><Num value={a.e0} onChange={(v) => set({ e0: v })} step={10} />
          <h4>תחזית</h4>
          <label>צמיחת רווח שנתית<small>%</small></label><Num value={a.g} onChange={(v) => set({ g: v })} step={0.5} />
          <label>שנות תחזית</label><Num value={a.years} onChange={(v) => set({ years: Math.max(1, Math.min(15, Math.round(v) || 1)) })} />
          <label>שיעור חלוקה<small>% מהרווח</small></label><Num value={a.payout} onChange={(v) => set({ payout: v })} step={5} />
          <h4>היוון</h4>
          <label>מחיר ההון<small>%</small></label><Num value={a.ke} onChange={(v) => set({ ke: v })} step={0.25} />
          <label>צמיחה לטווח ארוך<small>%</small></label><Num value={a.gt} onChange={(v) => set({ gt: v })} step={0.25} />
        </div>
        <div className="src">כל ההנחות שלך. ברירות המחדל אינן תחזית.</div>
      </Panel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <Panel>
          <div className="verdict">
            <div><span className="lbl">שווי למניה <span className="chip est">אומדן</span></span><span className="big num"><Count value={perShare} dec={2} /></span> <span className="muted">ש"ח</span></div>
            <div><span className="lbl">מול מחיר {px != null && <span className="num">{nf(px, 2)}</span>}</span><span className={`big num ${(upside ?? 0) >= 0 ? 'pos' : 'neg'}`}><Count value={upside} dec={1} suffix="%" signed /></span></div>
            <div><span className="lbl">שווי הון</span><span className="num" style={{ fontSize: 20, fontWeight: 600 }}><Count value={r.value} /></span> <span className="muted">מיליוני ש"ח</span></div>
          </div>
          <table><tbody>
            <tr><td>ערך נוכחי של חלוקות, {a.years} שנים</td><td><span className="num">{nf(r.sum, 0)}</span></td><td><span className="num muted">{pct(r.sum / r.value * 100, 0)}</span></td></tr>
            <tr><td>ערך נוכחי של ערך הסיום</td><td><span className="num">{nf(r.pvTv, 0)}</span></td><td><span className="num muted">{pct(r.pvTv / r.value * 100, 0)}</span></td></tr>
            <tr><td>מכפיל הון משתמע מהמודל</td><td><span className="num">{eq?.v ? nf(r.value / eq.v, 2) : '–'}</span></td><td /></tr>
            <tr><td>מכפיל הון מוצדק: <bdi dir="ltr">(ROE − g) / (ke − g)</bdi><span className="dim">ROE {roe?.v != null ? pct(roe.v, 1) : '–'}, LTM</span></td><td><span className="num">{jpb == null ? '–' : nf(jpb, 2)}</span></td><td /></tr>
            <tr><td>מחיר הון משתמע ממחיר השוק</td><td><span className="num">{ik == null ? '–' : pct(ik, 1)}</span></td><td /></tr>
          </tbody></table>
        </Panel>
        <div className="grid2">
          <Panel title="חלוקות חזויות וערך נוכחי" aside={<span>מיליוני ש"ח</span>}>
            <Chart label="חלוקות" height={230} deps={[a]} build={() => {
              const b = chartBase();
              return { animationDuration: 500, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 6, right: 6, top: 26, bottom: 2, containLabel: true },
                legend: { top: 0, textStyle: { color: b.mu, fontSize: 11 }, itemWidth: 10, itemHeight: 10, icon: 'roundRect' },
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: (v: number) => nf(v, 0) },
                xAxis: { type: 'category', data: r.rows.map((x) => `+${x.t}`), axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false }, axisLabel: { color: b.mu, fontSize: 11 } },
                yAxis: { type: 'value', axisLabel: { color: b.mu, fontSize: 10, formatter: (v: number) => `\u200E${v}` }, splitLine: { lineStyle: { color: b.ln, opacity: 0.5 } } },
                series: [{ name: 'רווח', type: 'bar', data: r.rows.map((x) => +x.e.toFixed(0)), itemStyle: { color: pal[7], opacity: 0.5, borderRadius: [2, 2, 0, 0] }, barGap: '-100%' },
                  { name: 'חלוקה', type: 'bar', data: r.rows.map((x) => +x.d.toFixed(0)), itemStyle: { color: pal[0], borderRadius: [2, 2, 0, 0] } },
                  { name: 'ערך נוכחי', type: 'line', data: r.rows.map((x) => +x.pv.toFixed(0)), symbolSize: 6, lineStyle: { color: pal[1], width: 2 }, itemStyle: { color: pal[1] } }] };
            }} />
          </Panel>
          <Panel title="רגישות: שווי למניה" aside={<span>מחיר הון × צמיחה לטווח ארוך</span>}>
            <div className="scroll"><table>
              <thead><tr><th>ke \ g</th>{gts.map((g) => <th key={g}><span className="num">{nf(g, 1)}%</span></th>)}</tr></thead>
              <tbody>{kes.map((ke) => (
                <tr key={ke}><td><span className="num">{nf(ke, 1)}%</span></td>{gts.map((gt) => {
                  const v = sh ? (dcf({ ...a, ke, gt }).value * 1e6) / sh : NaN, up = px ? v / px - 1 : 0, here = ke === a.ke && gt === a.gt;
                  const bg = !Number.isFinite(v) ? undefined : `color-mix(in oklch, var(${up >= 0 ? '--up' : '--down'}) ${Math.min(42, Math.abs(up) * 60)}%, transparent)`;
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
  const { k, aum } = useV();
  const eq = k.latest('equity');
  const init: { parts: Part[]; adj: number } = { adj: 0, parts: [
    { name: 'ביטוח (חיים, בריאות, כללי)', basis: 'book', amount: Math.round(eq?.v ?? 0), mult: 1 },
    { name: 'ניהול נכסים: פנסיה וגמל', basis: 'aum', amount: +(aum ?? 0).toFixed(1), mult: 1.5 },
    { name: 'פעילויות אחרות', basis: 'profit', amount: 0, mult: 10 },
  ] };
  const [s, setS] = useStored(`fox.sotp.${k.id}`, init);
  const setPart = (i: number, p: Partial<Part>) => setS({ ...s, parts: s.parts.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const vals = s.parts.map((p) => BASIS[p.basis].value(p)).map((v) => (Number.isFinite(v) ? v : 0));
  const total = vals.reduce((x, y) => x + y, 0) + (Number.isFinite(s.adj) ? s.adj : 0);
  const sh = k.lastShares(), px = k.lastPrice(), mcap = px && sh ? (px * sh) / 1e6 : null;
  const perShare = sh ? (total * 1e6) / sh : null, gap = mcap ? (mcap / total - 1) * 100 : null;
  const pal = palette();
  return (
    <>
      <Panel>
        <div className="verdict">
          <div><span className="lbl">שווי למניה <span className="chip est">אומדן</span></span><span className="big num"><Count value={perShare} dec={2} /></span> <span className="muted">ש"ח</span></div>
          <div><span className="lbl">שווי שוק מול סכום החלקים</span><span className={`big num ${(gap ?? 0) <= 0 ? 'pos' : 'neg'}`}><Count value={gap} dec={1} suffix="%" signed /></span></div>
          <div><span className="lbl">סכום החלקים</span><span className="num" style={{ fontSize: 20, fontWeight: 600 }}><Count value={total} /></span> <span className="muted">מיליוני ש"ח{mcap != null && <> · שוק <span className="num">{nf(mcap, 0)}</span></>}</span></div>
        </div>
        <Chart label="סכום החלקים" height={70} deps={[vals.join(), s.adj, mcap]} build={() => {
          const b = chartBase();
          return { animationDuration: 500, grid: { left: 0, right: 0, top: 4, bottom: 4 }, tooltip: { trigger: 'item', backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: (v: number) => nf(v, 0) },
            xAxis: { type: 'value', show: false, max: Math.max(total, mcap ?? 0) * 1.02 }, yAxis: { type: 'category', show: false, data: [''] },
            series: [...s.parts.map((p, i) => ({ name: p.name, type: 'bar', stack: 'a', data: [Math.max(0, vals[i])], barWidth: 26, itemStyle: { color: pal[i % pal.length], borderRadius: 3 } })),
              ...(mcap ? [{ name: 'שווי שוק', type: 'line', data: [], markLine: { symbol: 'none', silent: true, lineStyle: { color: b.fg, width: 1.5 }, label: { formatter: 'שווי שוק', color: b.mu, fontSize: 11 }, data: [{ xAxis: mcap }] } }] : [])] };
        }} />
      </Panel>
      <Panel title="חלקים" aside={<><button type="button" className="btn" onClick={() => setS({ ...s, parts: [...s.parts, { name: 'חלק חדש', basis: 'profit', amount: 0, mult: 10 }] })}>הוסף חלק</button><button type="button" className="btn" onClick={() => setS(init)}>איפוס</button></>}>
        <div className="scroll"><table>
          <thead><tr><th>חלק</th><th>שיטה</th><th>בסיס</th><th>מכפיל</th><th>שווי, מיליוני ש"ח</th><th>% מהסכום</th><th /></tr></thead>
          <tbody>
            {s.parts.map((p, i) => (
              <tr key={i}>
                <td><span className="dot" style={{ background: pal[i % pal.length], marginInlineEnd: 8 }} /><input type="text" value={p.name} onChange={(e) => setPart(i, { name: e.target.value })} aria-label="שם החלק" /></td>
                <td><select value={p.basis} onChange={(e) => setPart(i, { basis: e.target.value as Basis })}>{(Object.keys(BASIS) as Basis[]).map((b) => <option key={b} value={b}>{BASIS[b].label}</option>)}</select></td>
                <td style={{ width: 130 }}><Num value={p.amount} onChange={(v) => setPart(i, { amount: v })} step={p.basis === 'aum' ? 1 : 10} /><span className="dim">{BASIS[p.basis].amount}</span></td>
                <td style={{ width: 100 }}><Num value={p.mult} onChange={(v) => setPart(i, { mult: v })} step={0.1} /><span className="dim">{BASIS[p.basis].mult}</span></td>
                <td><span className="num">{nf(vals[i], 0)}</span></td><td><span className="num muted">{total ? pct(vals[i] / total * 100, 0) : '–'}</span></td>
                <td><button type="button" className="btn" aria-label="הסר" onClick={() => setS({ ...s, parts: s.parts.filter((_, j) => j !== i) })}>×</button></td>
              </tr>
            ))}
            <tr><td>התאמות חברת האם<span className="dim">חוב נטו, עודפי הון, מיעוט · שלילי להפחתה</span></td><td /><td /><td /><td style={{ width: 130 }}><Num value={s.adj} onChange={(v) => setS({ ...s, adj: v })} step={50} /></td><td /><td /></tr>
            <tr className="tot"><td>סכום החלקים</td><td /><td /><td /><td><span className="num">{nf(total, 0)}</span></td><td /><td /></tr>
          </tbody>
        </table></div>
        <div className="src">ברירות המחדל: הון הקבוצה מה-XBRL, נכסי פנסיה וגמל מרשות שוק ההון. הון הקבוצה כבר כולל את חברות הניהול, ולכן יש להפחית אותו כשמעריכים אותן בנפרד. רווחי המגזרים יוזנו אוטומטית אחרי חילוץ הדוחות.</div>
      </Panel>
    </>
  );
}
