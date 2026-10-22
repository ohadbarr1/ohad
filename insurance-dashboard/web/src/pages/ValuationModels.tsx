import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Count } from '../components/Count';
import { Sourced } from '../components/Source';
import { Empty, Loading, Panel, Seg } from '../components/ui';
import { foxOption } from '../lib/foxchart';
import { chartBase, palette } from '../lib/theme';
import { nf, pct } from '../lib/format';
import { periodTag } from '../lib/kpi';
import type { Prov } from '../lib/prov';
import { useStored } from '../lib/local';
import { useIfrsData, useLoad } from '../lib/useData';
import { csmMultiples, keProv, mil, pctS, residualIncome, useCsm, xS, MM, type RiIn } from '../lib/valuation';
import { sotpSeeds, type SopData } from '../lib/valuationSotp';
import { Dash, Fig, Gate, Num, PeerTable, fin, usePeers, useV } from './Valuation';

/* ---------- residual income ---------- */
type RiO = Partial<Pick<RiIn, 'roe1' | 'roeL' | 'fade' | 'payout'>>;
export function ValuationRi() {
  const { id, k, mkt, a, ke, rf, name } = useV();
  const [o, setO] = useStored<RiO>(`val.ri.${id}`, {});
  const [okS, setOk] = useStored<boolean>(`val.ri.ok.${id}`, false);
  const fy = k.series('roe', 'fy').filter((p) => p.v != null).slice(-3);
  const fyAvg = fy.length ? fy.reduce((s, p) => s + p.v!, 0) / fy.length : null;
  const d = { roe1: mkt.roe, roeL: fyAvg ?? mkt.roe, fade: 5, payout: mkt.payout ?? 40 };
  const v = { roe1: o.roe1 ?? d.roe1, roeL: o.roeL ?? d.roeL, fade: o.fade ?? d.fade, payout: o.payout ?? d.payout };
  const ok = okS || Object.keys(o).length > 0;
  const set = (p: RiO) => setO({ ...o, ...p });
  if (!fin(mkt.eq) || !fin(v.roe1) || !fin(v.roeL) || !fin(ke)) return <Empty title="חסרים הון, ROE או מחיר הון לחישוב" />;
  const input: RiIn = { b0: mkt.eq, roe1: v.roe1, roeL: v.roeL, fade: v.fade, payout: v.payout, ke, g: a.g };
  const r = residualIncome(input);
  const ipb = r.value / mkt.eq, ratio = fin(mkt.mcap) ? mkt.mcap / r.value : null;
  const fyProv = (): Prov => ({ k: 'calc', title: `ROE ממוצע, ${fy.map((p) => periodTag(p.period)).join(', ')}`, value: pctS(fyAvg!), unit: '%', formula: 'ממוצע פשוט של ROE השנתי', inputs: fy.map((p) => ({ label: periodTag(p.period), v: pctS(p.v!), src: () => k.explain('roe', 'q', p.period) })) });
  const mine = (key: keyof RiO) => o[key] != null;
  const valueProv = (): Prov => ({ k: 'calc', title: `שווי הון, הכנסה שיורית · ${name}`, value: mil(r.value), unit: MM, est: true, formula: 'שווי = הון היום + ערך נוכחי של ההכנסה השיורית בשנות הדעיכה + ערך נוכחי של ערך הסיום; הכנסה שיורית = (ROE − ke) × הון פתיחה',
    inputs: [{ label: `הון, ${mkt.eqPeriod ? periodTag(mkt.eqPeriod) : ''}`, v: mil(mkt.eq!), src: mkt.eqProv }, { label: mine('roe1') ? 'ROE שנה 1 (ההנחה שלך)' : 'ROE שנה 1: LTM', v: pctS(v.roe1!), src: mine('roe1') ? undefined : mkt.roeProv },
      { label: mine('roeL') ? 'ROE לטווח ארוך (ההנחה שלך)' : 'ROE לטווח ארוך: ממוצע 3 שנים', v: pctS(v.roeL!), src: mine('roeL') || fyAvg == null ? undefined : fyProv }, { label: 'שנות דעיכה', v: String(v.fade) },
      { label: mine('payout') || mkt.payout == null ? 'שיעור חלוקה (הנחה)' : 'שיעור חלוקה: LTM', v: pctS(v.payout, 0), src: mine('payout') || mkt.payout == null ? undefined : mkt.payoutProv }, { label: 'ke', v: pctS(ke, 2), src: () => keProv(a, rf) }, { label: 'g (הנחה)', v: pctS(a.g, 2) },
      { label: 'ערך נוכחי, שנות הדעיכה', v: mil(r.sumPv) }, { label: 'ערך נוכחי, ערך הסיום', v: mil(r.pvTv) }] });
  const pal = palette();
  return (
    <div className="grid12 vgrid">
      <Panel title="הנחות המודל" aside={<button type="button" className="btn" onClick={() => { setO({}); setOk(false); }}>איפוס</button>}>
        <div className="assume">
          <h4>בסיס</h4>
          <label>הון לבעלי המניות<small>{mkt.eqPeriod ? periodTag(mkt.eqPeriod) : ''} · מיליוני ש"ח</small></label><Fig v={mkt.eq} text={(x) => nf(x, 0)} src={mkt.eqProv} className="ro" />
          <h4>תשואה על ההון</h4>
          <label>ROE שנה 1<small>% · ברירת מחדל: <Sourced src={mkt.roeProv}>LTM מהדוחות</Sourced></small></label><Num label="ROE שנה 1" dec={2} value={v.roe1} step={0.5} onChange={(x) => set({ roe1: Number.isFinite(x) ? x : undefined })} />
          <label>ROE לטווח ארוך<small>% · ברירת מחדל: {fyAvg != null ? <Sourced src={fyProv}>{`ממוצע ${fy.length} שנים`}</Sourced> : 'LTM'}</small></label><Num label="ROE לטווח ארוך" dec={2} value={v.roeL} step={0.5} onChange={(x) => set({ roeL: Number.isFinite(x) ? x : undefined })} />
          <label>שנות דעיכה<small>מ-ROE שנה 1 ל-ROE לטווח ארוך</small></label><Num label="שנות דעיכה" value={v.fade} onChange={(x) => set({ fade: Math.max(1, Math.min(20, Math.round(x) || 1)) })} />
          <label>שיעור חלוקה<small>% · ברירת מחדל: {mkt.payout != null ? <Sourced src={mkt.payoutProv}>דיבידנד LTM ÷ רווח LTM</Sourced> : 'הנחה'}</small></label><Num label="שיעור חלוקה" dec={1} value={v.payout} step={5} onChange={(x) => set({ payout: Number.isFinite(x) ? x : undefined })} />
          <h4>היוון</h4>
          <label>מחיר ההון (ke)<small>מההנחות המשותפות</small></label><span className="num ro">{pctS(ke, 2)}</span>
          <label>צמיחה לטווח ארוך (g)<small>מההנחות המשותפות</small></label><span className="num ro">{pctS(a.g, 2)}</span>
        </div>
      </Panel>
      <div className="vcol">
        <Panel>
          <Gate ok={ok} onOk={() => setOk(true)} />
          <div className={`verdict${ok ? '' : ' ghost'}`}>
            <div><span className="lbl">שווי הון, מודל <span className="chip est">{ok ? 'אומדן' : 'המחשה'}</span></span><span className="big num"><Sourced src={valueProv}>{nf(r.value / 1000, 2)}</Sourced></span> <span className="muted">מיליארד ש"ח</span></div>
            <div><span className="lbl">P/B משתמע מהמודל</span><span className="mid num"><Sourced src={() => ({ k: 'calc', title: 'P/B משתמע מהמודל', value: xS(ipb), est: true, formula: 'שווי מודל ÷ הון', inputs: [{ label: 'שווי מודל', v: mil(r.value), src: valueProv }, { label: 'הון', v: mil(mkt.eq!), src: mkt.eqProv }] })}>{nf(ipb, 2)}</Sourced></span></div>
            {ok && <div><span className="lbl">שווי שוק ÷ שווי מודל</span><span className="mid num">{fin(ratio) ? <Sourced src={() => ({ k: 'calc', title: 'שווי שוק ÷ שווי מודל', value: xS(ratio), est: true, formula: 'שווי שוק ÷ שווי הון במודל ההכנסה השיורית', inputs: [{ label: 'שווי שוק', v: mil(mkt.mcap!), src: mkt.mcapProv }, { label: 'שווי מודל', v: mil(r.value), src: valueProv }] })}>{nf(ratio, 2)}</Sourced> : '–'}</span></div>}
          </div>
          <table className="ri-t"><tbody>
            <tr><td>הון היום</td><td><span className="num">{nf(mkt.eq, 0)}</span></td><td><span className="num muted">{pct((mkt.eq / r.value) * 100, 0)}</span></td></tr>
            <tr><td>ערך נוכחי של הכנסה שיורית, {v.fade} שנים</td><td><span className="num">{nf(r.sumPv, 0)}</span></td><td><span className="num muted">{pct((r.sumPv / r.value) * 100, 0)}</span></td></tr>
            <tr><td>ערך נוכחי של ערך הסיום</td><td><span className="num">{Number.isFinite(r.pvTv) ? nf(r.pvTv, 0) : '–'}</span></td><td><span className="num muted">{Number.isFinite(r.pvTv) ? pct((r.pvTv / r.value) * 100, 0) : ''}</span></td></tr>
          </tbody></table>
        </Panel>
        <Panel title="הכנסה שיורית לפי שנה">
          <Chart label="הכנסה שיורית" height={230} deps={[JSON.stringify(input)]} build={() => foxOption({ x: r.rows.map((x) => `+${x.t}`), unit: MM, full: true, labels: false, series: [
            { name: 'הכנסה שיורית', kind: 'bar', color: pal[0], dec: 0, data: r.rows.map((x) => +x.ri.toFixed(0)) },
            { name: 'ערך נוכחי', kind: 'line', color: pal[1], dec: 0, data: r.rows.map((x) => +x.pv.toFixed(0)) }] })} />
          <div className="scroll"><table>
            <thead><tr><th>שנה</th>{r.rows.map((x) => <th key={x.t}><span className="num">+{x.t}</span></th>)}</tr></thead>
            <tbody>
              <tr><td>ROE</td>{r.rows.map((x) => <td key={x.t}><span className="num">{nf(x.roe, 1)}%</span></td>)}</tr>
              <tr><td>הון פתיחה</td>{r.rows.map((x) => <td key={x.t}><span className="num">{nf(x.b0, 0)}</span></td>)}</tr>
              <tr><td>הכנסה שיורית</td>{r.rows.map((x) => <td key={x.t}><span className={`num ${x.ri < 0 ? 'neg' : ''}`}>{nf(x.ri, 0)}</span></td>)}</tr>
            </tbody>
          </table></div>
        </Panel>
      </div>
    </div>
  );
}

/* ---------- price over equity plus after-tax CSM ---------- */
export function ValuationCsm() {
  const { id, mkt, a, name, insurers } = useV();
  const ifrs = useIfrsData().data;
  const csm = useCsm(insurers.includes(id) ? [id] : [], ifrs).get(id);
  const rows = usePeers();
  if (!insurers.includes(id)) return <Empty title="אין CSM לחברה זו">המודל חל על חברות ביטוח המדווחות לפי IFRS 17. <Link to="/valuation/phoenix/csm">לדוגמה: הפניקס</Link></Empty>;
  if (csm === undefined) return <Loading what="יתרת ה-CSM" />;
  const cm = csmMultiples(mkt.eq, csm?.close.v ?? null, a.tax, mkt.mcap);
  const csmT = `יתרת CSM · ${name}`;
  const netProv = (): Prov => ({ k: 'calc', title: `CSM אחרי מס · ${name}`, value: mil(cm!.csmNet), unit: MM, est: true, formula: 'CSM אחרי מס = יתרת CSM × (1 − שיעור מס)', inputs: [{ label: `יתרת CSM, ${periodTag(csm!.p)}`, v: mil(csm!.close.v), src: () => csm!.prov(csmT) }, { label: 'שיעור מס (הנחה)', v: pctS(a.tax, 2) }] });
  const adjProv = (): Prov => ({ k: 'calc', title: 'הון + CSM אחרי מס', value: mil(cm!.adj), unit: MM, est: true, formula: 'הון לבעלי המניות + CSM אחרי מס', inputs: [{ label: 'הון', v: mil(mkt.eq!), src: mkt.eqProv }, { label: 'CSM אחרי מס', v: mil(cm!.csmNet), src: netProv }] });
  const pecProv = (): Prov => ({ k: 'calc', title: 'שווי שוק ÷ (הון + CSM אחרי מס)', value: xS(cm!.pec!), est: true, formula: 'שווי שוק ÷ (הון + CSM אחרי מס)', inputs: [{ label: 'שווי שוק', v: mil(mkt.mcap!), src: mkt.mcapProv }, { label: 'הון + CSM אחרי מס', v: mil(cm!.adj), src: adjProv }] });
  const icmProv = (): Prov => ({ k: 'calc', title: 'מכפיל CSM משתמע', value: xS(cm!.implied!), est: true, formula: '(שווי שוק − הון) ÷ CSM אחרי מס', inputs: [{ label: 'שווי שוק', v: mil(mkt.mcap!), src: mkt.mcapProv }, { label: 'הון', v: mil(mkt.eq!), src: mkt.eqProv }, { label: 'CSM אחרי מס', v: mil(cm!.csmNet), src: netProv }] });
  const mismatch = csm && mkt.eqPeriod && csm.p !== mkt.eqPeriod;
  const pal = palette();
  return (
    <>
      {!csm || !cm ? <Empty title="לא נמצאה יתרת CSM בדוח האחרון שחולץ" /> : (
        <div className="grid12 vgrid">
          <Panel title="רכיבים">
            <div className="assume">
              <label>יתרת CSM<small>{periodTag(csm.p)} · {csm.label} · מיליוני ש"ח</small></label><Sourced className="num ro" src={() => csm.prov(csmT)}>{nf(csm.close.v, 0)}</Sourced>
              <label>שיעור מס<small>הנחה · מההנחות המשותפות</small></label><span className="num ro">{pctS(a.tax, 2)}</span>
              <label>CSM אחרי מס</label><Sourced className="num ro" src={netProv}>{nf(cm.csmNet, 0)}</Sourced>
              <label>הון לבעלי המניות<small>{mkt.eqPeriod ? periodTag(mkt.eqPeriod) : ''}</small></label><Fig v={mkt.eq} text={(x) => nf(x, 0)} src={mkt.eqProv} className="ro" />
              <label>הון + CSM אחרי מס</label><Sourced className="num ro" src={adjProv}>{nf(cm.adj, 0)}</Sourced>
            </div>
            {csm.label !== 'נטו · קבוצה' && <div className="src"><span className="chip est">{csm.label}</span> בסיס היתרה לפי הדוח</div>}
            {mismatch && <div className="src"><span className="chip est">תאריכים שונים</span> CSM לפי {periodTag(csm.p)}, הון לפי {periodTag(mkt.eqPeriod!)}</div>}
          </Panel>
          <div className="vcol">
            <Panel>
              <div className="verdict">
                <div><span className="lbl">שווי שוק ÷ (הון + CSM אחרי מס) <span className="chip est">אומדן</span></span><span className="big num">{fin(cm.pec) ? <Sourced src={pecProv}>{nf(cm.pec, 2)}</Sourced> : '–'}</span></div>
                <div><span className="lbl">P/B</span><span className="big num">{fin(mkt.pb) ? <Sourced src={mkt.pbProv}>{nf(mkt.pb, 2)}</Sourced> : '–'}</span></div>
                <div><span className="lbl">מכפיל CSM משתמע</span><span className="mid num">{fin(cm.implied) ? <Sourced src={icmProv}>{nf(cm.implied, 2)}</Sourced> : '–'}</span></div>
                <div><span className="lbl">CSM אחרי מס ÷ הון</span><span className="mid num">{fin(mkt.eq) ? <Sourced src={() => ({ k: 'calc', title: 'CSM אחרי מס ÷ הון', value: xS(cm.csmNet / mkt.eq!), est: true, formula: 'CSM אחרי מס ÷ הון לבעלי המניות', inputs: [{ label: 'CSM אחרי מס', v: mil(cm.csmNet), src: netProv }, { label: 'הון', v: mil(mkt.eq!), src: mkt.eqProv }] })}>{nf(cm.csmNet / mkt.eq, 2)}</Sourced> : '–'}</span></div>
              </div>
              {fin(mkt.mcap) && (
                <Chart label="שווי שוק מול הון ו-CSM" height={92} deps={[mkt.mcap, cm.adj, mkt.eq]} build={() => {
                  const b = chartBase(), max = Math.max(mkt.mcap!, cm.adj) * 1.04;
                  return { animation: false, grid: { left: 70, right: 8, top: 4, bottom: 4 }, tooltip: { trigger: 'item', valueFormatter: (x: number) => `${nf(x, 0)} ${MM}` },
                    xAxis: { type: 'value', show: false, max }, yAxis: { type: 'category', data: ['הון + CSM', 'שווי שוק'], axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: b.mu, fontSize: 11 } },
                    series: [{ name: 'הון', type: 'bar', stack: 'a', barWidth: 18, data: [mkt.eq, null], itemStyle: { color: pal[0] } }, { name: 'CSM אחרי מס', type: 'bar', stack: 'a', data: [cm.csmNet, null], itemStyle: { color: pal[0], opacity: 0.45 } },
                      { name: 'שווי שוק', type: 'bar', stack: 'a', data: [null, mkt.mcap], itemStyle: { color: b.fg, opacity: 0.75 } }] };
                }} />
              )}
            </Panel>
          </div>
        </div>
      )}
      <PeerTable rows={rows} focus={id} />
    </>
  );
}

/* ---------- sum of the parts ---------- */
type Basis = 'pretax' | 'book' | 'profit' | 'aum';
interface Part { name: string; basis: Basis; amount: number; mult: number; seed?: number; core?: boolean }
interface SotpState { win: 'ltm' | 'fy'; parts: Part[] | null; adj: number }
const BASIS: Record<Basis, { label: string; amount: string; mult: string }> = {
  pretax: { label: 'רווח לפני מס × (1 − מס) × מכפיל', amount: 'רווח לפני מס, מיליוני ש"ח', mult: 'P/E' },
  book: { label: 'הון × מכפיל הון', amount: 'הון, מיליוני ש"ח', mult: 'P/B' },
  profit: { label: 'רווח נקי × מכפיל רווח', amount: 'רווח, מיליוני ש"ח', mult: 'P/E' },
  aum: { label: 'נכסים מנוהלים × %', amount: 'נכסים, מיליארדי ש"ח', mult: '% מהנכסים' },
};
const MULT0 = 10;

export function Sotp() {
  const { id, mkt, a, aum, name } = useV();
  const sop = useLoad<SopData>(`sop/${id}.json`);
  const [s0, setS0] = useStored<SotpState>(`val.sotp.v3.${id}`, { win: 'ltm', parts: null, adj: 0 });
  const [okS, setOk] = useStored<boolean>(`val.sotp.ok.${id}`, false);
  const s: SotpState = s0;
  const seeded = useMemo(() => (sop.data ? sotpSeeds(id, sop.data, s.win === 'ltm') : null), [sop.data, id, s.win]);
  const eq = mkt.eq;
  const defaults: Part[] = seeded ? seeded.seeds.map((x, i) => ({ name: x.label, basis: 'pretax', amount: +x.v.toFixed(1), mult: MULT0, seed: i, core: x.core }))
    : [{ name: 'קבוצה, לפי הון', basis: 'book', amount: Math.round(eq ?? 0), mult: 1 }, ...(aum ? [{ name: 'ניהול נכסים: פנסיה וגמל', basis: 'aum' as Basis, amount: +aum.toFixed(1), mult: 1.5 }] : [])];
  const parts = s.parts ?? defaults;
  const ok = okS || s.parts != null;
  const save = (p: Partial<SotpState>) => setS0({ ...s, parts, ...p });
  const setPart = (i: number, p: Partial<Part>) => save({ parts: parts.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const t = a.tax / 100;
  const valOf = (p: Part) => { const v = p.basis === 'pretax' ? p.amount * (1 - t) * p.mult : p.basis === 'aum' ? p.amount * 1000 * p.mult / 100 : p.amount * p.mult; return Number.isFinite(v) ? v : 0; };
  const vals = parts.map(valOf);
  const total = vals.reduce((x, y) => x + y, 0) + (Number.isFinite(s.adj) ? s.adj : 0);
  const gap = fin(mkt.mcap) && total ? (mkt.mcap / total - 1) * 100 : null;
  const pal = palette();
  const seedOf = (p: Part) => (seeded && p.seed != null && seeded.seeds[p.seed] && Math.abs(seeded.seeds[p.seed].v - p.amount) < 0.051 ? seeded.seeds[p.seed] : null);
  const partProv = (p: Part, i: number): Prov => {
    const sd = seedOf(p);
    const amountIn = { label: `${BASIS[p.basis].amount}${sd ? '' : ' (ההנחה שלך)'}`, v: nf(p.amount, 1), src: sd ? sd.prov : p.basis === 'book' && eq != null && p.amount === Math.round(eq) ? mkt.eqProv : undefined };
    return { k: 'calc', title: `${p.name}, שווי`, value: mil(vals[i]), unit: MM, est: true, formula: BASIS[p.basis].label, inputs: [amountIn, ...(p.basis === 'pretax' ? [{ label: 'שיעור מס (הנחה)', v: pctS(a.tax, 2) }] : []), { label: `${BASIS[p.basis].mult} (ההנחה שלך)`, v: nf(p.mult, 2) }] };
  };
  const totalProv = (): Prov => ({ k: 'calc', title: `סכום החלקים · ${name}`, value: mil(total), unit: MM, est: true, formula: 'Σ שווי החלקים + התאמות חברת האם',
    inputs: [...parts.map((p, i) => ({ label: p.name, v: mil(vals[i]), src: () => partProv(p, i) })), { label: 'התאמות חברת האם (ההנחה שלך)', v: mil(Number.isFinite(s.adj) ? s.adj : 0) }] });
  const gapProv = (): Prov => ({ k: 'calc', title: 'שווי שוק מול סכום החלקים', value: `${nf(gap!, 1)}%`, unit: '%', est: true, formula: 'שווי שוק ÷ סכום החלקים − 1', inputs: [{ label: 'שווי שוק', v: mil(mkt.mcap!), src: mkt.mcapProv }, { label: 'סכום החלקים', v: mil(total), src: totalProv }] });
  if (sop.data === null && !sop.error) return <Loading what="מקורות הרווח" />;
  return (
    <>
      <Panel>
        <Gate ok={ok} onOk={() => setOk(true)}>המכפילים טרם נקבעו: ברירת המחדל היא מכפיל אחיד ({MULT0}) לכל החלקים. רווחי המגזרים הם מהדוח.</Gate>
        <div className={`verdict${ok ? '' : ' ghost'}`}>
          <div><span className="lbl">סכום החלקים <span className="chip est">{ok ? 'אומדן' : 'המחשה'}</span></span><span className="big num"><Sourced src={totalProv}><Count value={total / 1000} dec={2} /></Sourced></span> <span className="muted">מיליארד ש"ח</span></div>
          {fin(mkt.mcap) && <div><span className="lbl">שווי שוק</span><span className="mid num"><Sourced src={mkt.mcapProv}>{nf(mkt.mcap / 1000, 2)}</Sourced></span></div>}
          {ok && fin(gap) && <div><span className="lbl">שווי שוק מול סכום החלקים</span><span className="mid num"><Sourced src={gapProv}>{`${gap > 0 ? '+' : ''}${nf(gap, 1)}%`}</Sourced></span></div>}
        </div>
        <Chart label="סכום החלקים" height={70} deps={[vals.join(), s.adj, mkt.mcap, ok]} build={() => {
          const b = chartBase();
          return { animation: false, grid: { left: 0, right: 0, top: 4, bottom: 4 }, tooltip: { trigger: 'item', valueFormatter: (v: number) => nf(v, 0) },
            xAxis: { type: 'value', show: false, max: Math.max(total, ok ? mkt.mcap ?? 0 : 0) * 1.02 }, yAxis: { type: 'category', show: false, data: [''] },
            series: [...parts.map((p, i) => ({ name: p.name, type: 'bar', stack: 'a', data: [Math.max(0, vals[i])], barWidth: 26, itemStyle: { color: pal[i % pal.length], opacity: p.core === false ? 0.5 : 1 } })),
              ...(ok && mkt.mcap ? [{ name: 'שווי שוק', type: 'line', data: [], markLine: { symbol: 'none', silent: true, lineStyle: { color: b.fg, width: 1.5 }, label: { formatter: 'שווי שוק', color: b.mu, fontSize: 11 }, data: [{ xAxis: mkt.mcap }] } }] : [])] };
        }} />
      </Panel>
      <Panel title="חלקים" aside={<>
        {seeded && <Seg label="תקופה" value={s.win} onChange={(w) => setS0({ ...s, win: w, parts: null })} options={[['ltm', 'LTM'], ['fy', 'שנה אחרונה']]} />}
        <button type="button" className="btn" onClick={() => save({ parts: [...parts, { name: 'חלק חדש', basis: 'profit', amount: 0, mult: MULT0 }] })}>הוסף חלק</button>
        <button type="button" className="btn" onClick={() => { setS0({ win: s.win, parts: null, adj: 0 }); setOk(false); }}>איפוס</button></>}>
        <div className="scroll"><table className="sotp-t">
          <thead><tr><th>חלק</th><th>שיטה</th><th>בסיס</th><th>מכפיל</th><th>שווי, מיליוני ש"ח</th><th>% מהסכום</th><th /></tr></thead>
          <tbody>
            {parts.map((p, i) => { const sd = seedOf(p); return (
              <tr key={i}>
                <td><span className="dot" style={{ background: pal[i % pal.length], opacity: p.core === false ? 0.5 : 1 }} /><input type="text" value={p.name} onChange={(e) => setPart(i, { name: e.target.value })} aria-label="שם החלק" />{p.core === false && <span className="dim">לא ליבה</span>}</td>
                <td><select value={p.basis} onChange={(e) => setPart(i, { basis: e.target.value as Basis })}>{(Object.keys(BASIS) as Basis[]).map((b) => <option key={b} value={b}>{BASIS[b].label}</option>)}</select></td>
                <td className="amt"><Num label="בסיס" value={p.amount} onChange={(v) => setPart(i, { amount: v })} step={p.basis === 'aum' ? 1 : 10} />
                  <span className="dim">{sd ? <Sourced src={sd.prov}>{sd.ltm ? 'LTM · מהדוח' : 'שנתי · מהדוח'}</Sourced> : BASIS[p.basis].amount}</span></td>
                <td className="mlt"><Num label="מכפיל" value={p.mult} onChange={(v) => setPart(i, { mult: v })} step={0.5} /><span className="dim">{BASIS[p.basis].mult}</span></td>
                <td><Sourced className="num" src={() => partProv(p, i)}>{nf(vals[i], 0)}</Sourced></td><td><span className="num muted">{total ? pct((vals[i] / total) * 100, 0) : '–'}</span></td>
                <td><button type="button" className="btn mini" aria-label="הסר" onClick={() => save({ parts: parts.filter((_, j) => j !== i) })}>×</button></td>
              </tr>
            ); })}
            <tr><td>התאמות חברת האם<span className="dim">חוב נטו, עודפי הון, מיעוט · שלילי להפחתה</span></td><td /><td /><td /><td className="amt"><Num label="התאמות" value={s.adj} onChange={(v) => save({ adj: v })} step={50} /></td><td /><td /></tr>
            <tr className="tot"><td>סכום החלקים</td><td /><td /><td /><td><Sourced className="num" src={totalProv}>{nf(total, 0)}</Sourced></td><td /><td /></tr>
          </tbody>
        </table></div>
        <div className="src">{seeded ? <>רווחי המגזרים: {seeded.basis}, מתוך <Link to={`/company/${id}/profit`}>מקורות הרווח</Link> בדוח · {seeded.ltmAll || s.win === 'fy' ? '' : 'חלק מהשורות אינן מודפסות בדוח החצי-שנתי, ולכן מוצגות לשנה האחרונה · '}המכפילים והמס: הנחות</> : <>אין טבלת מקורות רווח לחברה זו: ברירת המחדל היא הון הקבוצה (XBRL) ונכסי פנסיה וגמל (רשות שוק ההון)</>}</div>
      </Panel>
    </>
  );
}

/* ---------- DCF to equity: kept as an advanced view, never the default verdict ---------- */
interface DcfIn { e0: number; g: number; years: number; payout: number; ke: number; gt: number }
function dcf(x: DcfIn) {
  const rows: { t: number; e: number; d: number; pv: number }[] = [];
  let e = x.e0, sum = 0;
  for (let t = 1; t <= x.years; t++) { e *= 1 + x.g / 100; const d = e * x.payout / 100, pv = d / Math.pow(1 + x.ke / 100, t); rows.push({ t, e, d, pv }); sum += pv; }
  const spread = (x.ke - x.gt) / 100, tv = spread > 0 ? (e * (1 + x.gt / 100) * x.payout / 100) / spread : NaN, pvTv = tv / Math.pow(1 + x.ke / 100, x.years);
  return { rows, sum, tv, pvTv, value: sum + pvTv };
}
export function Dcf() {
  const { id, k, mkt, a, ke } = useV();
  const base = k.latest('profit', 'ltm');
  const g0 = fin(mkt.roe) ? Math.min(6, Math.max(2, Math.round(mkt.roe * 0.6 * 2) / 2)) : 4;
  const init: DcfIn = { e0: Math.round(base?.v ?? 0), g: g0, years: 5, payout: Math.round(mkt.payout ?? 40), ke: +(ke ?? 10).toFixed(2), gt: a.g };
  const [o, setO] = useStored<Partial<DcfIn>>(`val.dcf.${id}`, {});
  const [okS, setOk] = useStored<boolean>(`val.dcf.ok.${id}`, false);
  const x: DcfIn = { ...init, ...o };
  const ok = okS || Object.keys(o).length > 0;
  const set = (p: Partial<DcfIn>) => setO({ ...o, ...p });
  const r = useMemo(() => dcf(x), [JSON.stringify(x)]); // eslint-disable-line react-hooks/exhaustive-deps
  const pal = palette();
  if (!base?.v) return <Empty title="אין רווח LTM לחברה זו" />;
  const perShare = mkt.shares ? (r.value * 1e6) / mkt.shares : null;
  const eqProv = (): Prov => ({ k: 'calc', title: 'שווי הון, DCF', value: mil(r.value), unit: MM, est: true, formula: 'ערך נוכחי של החלוקות + ערך נוכחי של ערך הסיום',
    inputs: [{ label: 'רווח בסיס', v: mil(x.e0), src: x.e0 === Math.round(base.v ?? 0) ? () => k.explain('profit', 'ltm', base.period) : undefined }, { label: 'צמיחה (הנחה)', v: pctS(x.g) }, { label: 'שנים', v: String(x.years) }, { label: 'שיעור חלוקה', v: pctS(x.payout, 0) }, { label: 'ke', v: pctS(x.ke, 2) }, { label: 'צמיחה לטווח ארוך', v: pctS(x.gt, 2) }] });
  const kes = [-2, -1, 0, 1, 2].map((d) => x.ke + d), gts = [-1, -0.5, 0, 0.5, 1].map((d) => x.gt + d);
  return (
    <div className="grid12 vgrid">
      <Panel title="הנחות" aside={<button type="button" className="btn" onClick={() => { setO({}); setOk(false); }}>איפוס</button>}>
        <div className="assume">
          <h4>בסיס</h4>
          <label>רווח נקי בסיס<small>מיליוני ש"ח · ברירת מחדל: <Sourced src={() => k.explain('profit', 'ltm', base.period)}>{`LTM עד ${periodTag(base.period)}`}</Sourced></small></label><Num value={x.e0} onChange={(v) => set({ e0: v })} step={10} />
          <h4>תחזית</h4>
          <label>צמיחת רווח שנתית<small>% · ברירת מחדל: ROE × 60%, בטווח 2%–6%</small></label><Num value={x.g} onChange={(v) => set({ g: v })} step={0.5} />
          <label>שנות תחזית</label><Num value={x.years} onChange={(v) => set({ years: Math.max(1, Math.min(15, Math.round(v) || 1)) })} />
          <label>שיעור חלוקה<small>% · ברירת מחדל: {mkt.payout != null ? <Sourced src={mkt.payoutProv}>LTM</Sourced> : 'הנחה'}</small></label><Num value={x.payout} onChange={(v) => set({ payout: v })} step={5} />
          <h4>היוון</h4>
          <label>מחיר ההון<small>% · ברירת מחדל: <Sourced src={() => keProv(a, null)}>מההנחות המשותפות</Sourced></small></label><Num value={x.ke} onChange={(v) => set({ ke: v })} step={0.25} />
          <label>צמיחה לטווח ארוך<small>%</small></label><Num value={x.gt} onChange={(v) => set({ gt: v })} step={0.25} />
        </div>
      </Panel>
      <div className="vcol">
        <Panel>
          <div className="illus adv"><b>מתקדם</b><span>DCF לחלוקות אינו תצוגת ברירת המחדל: לחברת ביטוח המסגרת היא P/B מול ROE.</span></div>
          <Gate ok={ok} onOk={() => setOk(true)} />
          <div className={`verdict${ok ? '' : ' ghost'}`}>
            <div><span className="lbl">שווי הון, DCF <span className="chip est">{ok ? 'אומדן' : 'המחשה'}</span></span><span className="big num"><Sourced src={eqProv}>{nf(r.value / 1000, 2)}</Sourced></span> <span className="muted">מיליארד ש"ח</span></div>
            <div><span className="lbl">למניה</span><span className="mid num">{fin(perShare) ? <Sourced src={() => ({ k: 'calc', title: 'שווי למניה, DCF', value: `${nf(perShare, 2)} ש"ח`, est: true, formula: 'שווי הון ÷ מניות', inputs: [{ label: 'שווי הון', v: mil(r.value), src: eqProv }, { label: 'מניות', v: `${nf(mkt.shares! / 1e6, 1)} מיליון`, src: mkt.sharesProv }] })}>{nf(perShare, 2)}</Sourced> : <Dash />}</span></div>
            {fin(mkt.eq) && <div><span className="lbl">P/B משתמע</span><span className="mid num">{nf(r.value / mkt.eq, 2)}</span></div>}
          </div>
        </Panel>
        <div className="grid2">
          <Panel title="חלוקות חזויות וערך נוכחי">
            <Chart label="חלוקות" height={230} deps={[JSON.stringify(x)]} build={() => foxOption({ x: r.rows.map((q) => `+${q.t}`), unit: MM, full: true, labels: false, series: [
              { name: 'רווח', kind: 'bar', color: pal[7], opacity: 0.5, dec: 0, data: r.rows.map((q) => +q.e.toFixed(0)) },
              { name: 'חלוקה', kind: 'bar', overlay: true, color: pal[0], dec: 0, data: r.rows.map((q) => +q.d.toFixed(0)) },
              { name: 'ערך נוכחי', kind: 'line', color: pal[1], dec: 0, data: r.rows.map((q) => +q.pv.toFixed(0)) }] })} />
          </Panel>
          <Panel title="רגישות: שווי הון" aside={<span>מיליארד ש"ח · ke × g</span>}>
            <div className="scroll" tabIndex={0} role="region" aria-label="טבלת רגישות"><table className="sens-t">
              <thead><tr><th>ke \ g</th>{gts.map((g) => <th key={g}><span className="num">{nf(g, 1)}%</span></th>)}</tr></thead>
              <tbody>{kes.map((kk) => (
                <tr key={kk}><td><span className="num">{nf(kk, 1)}%</span></td>{gts.map((gt) => { const v = dcf({ ...x, ke: kk, gt }).value; return <td key={gt} className={`heat${kk === x.ke && gt === x.gt ? ' here' : ''}`}><span className="num">{Number.isFinite(v) ? nf(v / 1000, 1) : '–'}</span></td>; })}</tr>
              ))}</tbody>
            </table></div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
