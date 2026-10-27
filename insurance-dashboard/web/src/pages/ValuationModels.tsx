import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { Empty, Panel } from '../components/ui';
import { foxOption } from '../lib/foxchart';
import { palette } from '../lib/theme';
import { nf, pct } from '../lib/format';
import { periodTag } from '../lib/kpi';
import type { Prov } from '../lib/prov';
import { useStored } from '../lib/local';
import { keProv, mil, pctS, residualIncome, xS, MM, type RiIn } from '../lib/valuation';
import { Fig, Gate, Num, fin, useV } from './Valuation';
import { ExpectationsPanel } from '../components/Expectations';
import { ASSUME0 } from '../lib/valuation';

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

/* ---------- A3: what the multiple requires (the expectations decoder) ---------- */
export function ValuationExpectations() {
  const { id, entry, mkt, a } = useV();
  if (!entry.has_price) return <Empty title="ציפיות השוק מחושבות לחברות הנסחרות בלבד" />;
  const own = mkt.manual || (['erp', 'beta', 'g', 'tax'] as const).some((k) => a[k] !== ASSUME0[k]) || a.rf != null;
  const note = own ? <p className="s exp-own">מחושב על המחיר של 22.10.26 ועל הנחות ברירת המחדל; המחיר או ההנחות שהזנת למעלה לא משנים את הלוח הזה.</p> : undefined;
  return <ExpectationsPanel key={id} id={id} note={note} />;
}
