import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Kpi, Loading, Panel, Seg as SegCtl } from '../components/ui';
import { IdDot } from '../components/MgrChip';
import { foxOption } from '../lib/foxchart';
import { nf, sn } from '../lib/format';
import { cssColor } from '../lib/theme';
import { useLens, ql, warmRep, type LensData } from '../lib/lens';
import { useStored } from '../lib/local';
import { ASSUME0, type Assume } from '../lib/valuation';
import { useSource, type Prov } from '../lib/prov';
import { usePhone } from '../lib/useMedia';
import { NSEGS, NpvSrc, isLtm, pl, useFlowNpv, type Basis, type FlowNpv, type NSeg, type NpvRow } from '../lib/flowNpv';
import '../styles/flownpv.css';

const short = (g: string) => g.replace('מנורה מבטחים', 'מנורה').replace('אלטשולר שחם', 'אלטשולר').replace('ילין לפידות', 'ילין').replace('ביטוח ישיר', 'ישיר');
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const S = ({ src, children, className = '' }: { src: () => Prov; children: ReactNode; className?: string }) => <Sourced src={src}><span className={`num ${className}`}>{children}</span></Sourced>;
const Dash = ({ why }: { why: string }) => <span className="muted lens-dash" title={why}>–</span>;
const fin = (v: number) => Number.isFinite(v);

/** The Savings Lens, view "ערך הניוד" (v=npv): the operating profit that net transfers and net organic flow carry, discounted (M3). */
export function LensNpv() {
  const npv = useFlowNpv(), lens = useLens();
  if (npv.error || lens.error) return <ErrorBox what="ערך הניוד" error={(npv.error || lens.error)!} />;
  if (!npv.data || !lens.data) return <Loading what="ערך הניוד" />;
  return <NpvView d={npv.data} lens={lens.data} />;
}

function NumIn({ value, onChange, step, label, dec = 2 }: { value: number; onChange: (v: number | null) => void; step: number; label: string; dec?: number }) {
  return <input type="number" inputMode="decimal" aria-label={label} value={+value.toFixed(dec)} step={step} onChange={(e) => { const v = Number(e.target.value); onChange(e.target.value === '' || !fin(v) ? null : v); }} />;
}

function NpvView({ d, lens }: { d: FlowNpv; lens: LensData }) {
  const phone = usePhone();
  const { open } = useSource();
  const [sp, setSp] = useSearchParams();
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setSp(n, { replace: true }); };
  const seg: NSeg = sp.get('s') === 'gem' ? 'gem' : 'pen';
  const p = d.periods.includes(sp.get('np') ?? '') ? sp.get('np')! : d.meta.ltm;
  const basis: Basis = sp.get('mb') === 'ga' ? 'ga' : 'ci';
  // assumptions: ke follows the valuation page's stored assumptions (beta, ERP, rf); D is the derived default; both can be set here
  const [a0] = useStored<Assume>('val.assume', ASSUME0);
  const kd = NpvSrc.keDefault({ ...ASSUME0, ...a0 }, d);
  const num = (k: string) => { const v = Number(sp.get(k)); return sp.get(k) != null && fin(v) && v > 0 ? v : null; };
  const keU = num('ke'), dU: Record<NSeg, number | null> = { pen: num('dp'), gem: num('dg') };
  const ke = keU ?? kd.ke;
  const keP = (): Prov => keU == null ? kd.p() : { k: 'calc', est: true, title: 'מחיר ההון (ke)', value: `${nf(keU, 2)}%`, formula: 'ההנחה שלך בתצוגה זו', inputs: [{ label: 'ke לפי הנחות דף הערכת השווי', v: `${nf(kd.ke, 2)}%`, src: kd.p }] };
  const ctx = { ke, keP, D: { pen: dU.pen ?? d.dur.pen.v, gem: dU.gem ?? d.dur.gem.v }, Dset: { pen: dU.pen != null, gem: dU.gem != null }, basis };
  const src = useMemo(() => new NpvSrc(d, lens, ctx), [d, lens, ke, ctx.D.pen, ctx.D.gem, basis, keU]);  // eslint-disable-line react-hooks/exhaustive-deps

  const all = d.rows.filter((r) => r.s === seg && r.p === p);
  const val = (r: NpvRow, k: 'tr' | 'org') => src.npv(r, k);
  const rank = (k: 'tr' | 'org') => { const xs = all.filter((r) => val(r, k) != null).sort((a, b) => val(b, k)! - val(a, k)!); return new Map(xs.map((r, i) => [r.g, i + 1])); };
  const rkT = rank('tr'), rkO = rank('org');
  const rows = [...all].sort((a, b) => (val(b, 'tr') ?? -Infinity) - (val(a, 'tr') ?? -Infinity) || (b.avg ?? 0) - (a.avg ?? 0));
  const priced = rows.filter((r) => val(r, 'tr') != null);
  const tot = (k: 'tr' | 'org') => priced.reduce((t, r) => t + (val(r, k) ?? 0), 0);
  const ltm = isLtm(p), du = d.dur[seg];
  const rankP = (r: NpvRow, k: 'tr' | 'org'): Prov => ({ k: 'calc', est: true, title: `דירוג · ${src.name(r.g)} · ${d.segs[seg]} · ${pl(p)}`, value: String((k === 'tr' ? rkT : rkO).get(r.g) ?? '–'),
    formula: `1 = הערך הנוכחי הגבוה ביותר של ${k === 'tr' ? 'הניוד' : 'הצבירה האורגנית'} בין ${(k === 'tr' ? rkT : rkO).size} המנהלים שיש להם דוח. D ו-ke משותפים לכל המנהלים, ולכן הדירוג אינו תלוי בהם; הוא תלוי בזרימה ובמרווח`,
    inputs: [...all].filter((x) => val(x, k) != null).sort((a, b) => val(b, k)! - val(a, k)!).map((x) => ({ label: src.name(x.g), v: sn(val(x, k)!, 1), src: () => src.npvP(x, k) })) });
  const why = (r: NpvRow) => (!r.c ? 'לחברה אין דוח רווח והפסד מגזרי באתר' : r.fy == null ? 'חסרה תשואת דמי ניהול (הכנסות או נכסים) באחד הרבעונים' : basis === 'ci' && r.ci == null ? 'הדוח אינו מפצל שיווק והנהלה' : r.tr == null ? 'אין תזרים מלא לתקופה' : 'חסר נתון');

  const xlsx = async () => {
    const { downloadXlsx } = await import('../lib/xlsx');
    const head = ['מנהל', 'ניוד נטו, מיליוני ש"ח', 'NPV ניוד, מיליוני ש"ח', 'דירוג ניוד', 'צבירה אורגנית, מיליוני ש"ח', 'NPV צבירה אורגנית, מיליוני ש"ח', 'דירוג צבירה', 'תשואת דמי ניהול %', 'הוצאות להכנסות %', 'מרווח על נכסים %', 'הכנסות מדמי ניהול', 'שיווק ומכירה', 'הנהלה וכלליות', 'נכסים ממוצעים (Σ רבעונים), רשות'];
    const n = (x: number | null | undefined, f: 'n0' | 'n1' | 'n2' = 'n1') => (x == null ? null : { v: x, fmt: f });
    downloadXlsx(`fox-ערך-ניוד-${seg}-${p}`, [{ name: `${d.segs[seg]} ${pl(p)}`.slice(0, 31), freeze: { rows: 1, cols: 1 }, widths: [22, ...head.slice(1).map(() => 14)],
      rows: [head.map((h) => ({ v: h, bold: true })), ...rows.map((r) => [src.name(r.g), n(r.tr), n(val(r, 'tr')), n(rkT.get(r.g), 'n0'), n(r.org), n(val(r, 'org')), n(rkO.get(r.g), 'n0'), n(r.fy, 'n2'), n(r.ci), n(src.margin(r), 'n2'), n(r.fees), n(r.sm), n(r.ga), n(r.avg, 'n0')]),
        [], [`אומדן. ${d.meta.formula}. D = ${nf(ctx.D[seg], 2)} שנים, ke = ${nf(ke, 2)}%, מרווח: ${basis === 'ci' ? 'לאחר שיווק והנהלה' : 'לאחר הנהלה וכלליות בלבד'}.`],
        [`מקור: ${d.meta.source_reg}; ${d.meta.source_rep}; ${d.meta.source_macro}. נוסחאות: pipeline/build_flow_npv.py. fox · ${location.host}${location.pathname}${location.search}`]] }]);
  };

  const pick = [...d.periods].filter((x) => isLtm(x)).reverse().concat([...d.periods].filter((x) => !isLtm(x)).reverse());
  const chartRows = priced.slice(0, phone ? 9 : 12);
  return (
    <>
      <section className="controls lens-ctl npv-ctl">
        <div className="field"><span>פעילות</span><SegCtl<NSeg> label="פעילות" value={seg} onChange={(v) => set({ s: v === 'pen' ? '' : v })} options={NSEGS} /></div>
        <label className="field"><span>תקופה</span><select value={p} onChange={(e) => set({ np: e.target.value === d.meta.ltm ? '' : e.target.value })}>{pick.map((x) => <option key={x} value={x}>{pl(x)}</option>)}</select></label>
        <div className="field"><span>מרווח</span><SegCtl<Basis> label="בסיס המרווח" value={basis} onChange={(v) => set({ mb: v === 'ci' ? '' : v })} options={[['ci', 'אחרי כל ההוצאות'], ['ga', 'לפני שיווק']]} /></div>
      </section>

      <section className="npv-as" aria-label="הנחות">
        <label><span>משך (D) · {d.segs[seg]} <span className="chip est">הנחה</span></span><small>{dU[seg] == null ? 'ותק משתמע משיעור היציאה, LTM' : 'ההנחה שלך'}</small>
          <span className="in"><NumIn label="משך בשנים" value={ctx.D[seg]} step={0.5} onChange={(v) => set({ [seg === 'pen' ? 'dp' : 'dg']: v == null || Math.abs(v - du.v) < 1e-9 ? '' : String(v) })} /><small>שנים</small>
            {dU[seg] != null ? <button type="button" className="btn mini" onClick={() => set({ [seg === 'pen' ? 'dp' : 'dg']: '' })} title="חזרה לברירת המחדל" aria-label="חזרה לברירת המחדל">↺</button> : <Sourced className="srcdot" src={() => src.durP(seg)}>מקור</Sourced>}</span></label>
        <label><span>מחיר ההון (ke) <span className="chip est">הנחה</span></span><small>{keU == null ? 'לפי הנחות דף הערכת השווי' : 'ההנחה שלך'}</small>
          <span className="in"><NumIn label="מחיר ההון באחוזים" value={ke} step={0.25} onChange={(v) => set({ ke: v == null || Math.abs(v - kd.ke) < 1e-9 ? '' : String(v) })} /><small>%</small>
            {keU != null ? <button type="button" className="btn mini" onClick={() => set({ ke: '' })} title="חזרה לברירת המחדל" aria-label="חזרה לברירת המחדל">↺</button> : <Sourced className="srcdot" src={keP}>מקור</Sourced>}</span></label>
        <div className="ann"><span>מקדם היוון a(D, ke)</span><S src={() => src.annuityP(seg)} className="big">{nf(src.a(seg), 2)}</S><small>שנות מרווח מהוונות</small></div>
      </section>

      <section className="kpis">
        <Kpi label={`ערך הניוד נטו, ${pl(p)}`} value={priced.length ? <Sourced src={() => src.totalP(priced, 'tr', seg, p)}>{sn(tot('tr'), 0)}</Sourced> : '–'} tone={tot('tr') < 0 ? 'neg' : undefined} sub={<>מיליוני ש"ח · <span className="num">{priced.length}</span> מנהלים · <span className="chip est">אומדן</span></>} />
        <Kpi label={`ערך הצבירה האורגנית, ${pl(p)}`} value={priced.length ? <Sourced src={() => src.totalP(priced, 'org', seg, p)}>{sn(tot('org'), 0)}</Sourced> : '–'} tone={tot('org') < 0 ? 'neg' : undefined} sub={<>מיליוני ש"ח · <span className="chip est">אומדן</span></>} />
        <Kpi label={`משך, ${d.segs[seg]}`} value={<Sourced src={() => src.durP(seg)}>{nf(ctx.D[seg], 1)}</Sourced>} sub={<>שנים · שיעור יציאה <span className="num">{nf(du.wd_rate + du.out_rate, 1)}%</span> · <span className="chip est">הנחה</span></>} />
        <Kpi label="מחיר ההון" value={<Sourced src={keP}>{`${nf(ke, 2)}%`}</Sourced>} sub={<>ke · <span className="chip est">הנחה</span></>} />
      </section>
      <div className="lens-note est"><span className="chip est">אומדן</span> NPV = זרימה × מרווח על נכסים × a(D, ke) · מרווח = תשואת דמי ניהול × (1 − {basis === 'ci' ? 'הוצאות להכנסות' : 'הנהלה וכלליות להכנסות'}) מהעדשה · {ltm ? `זרימה = סכום ארבעת הרבעונים ${d.rows.find((r) => r.p === p)?.qs.map(ql).join(', ') ?? ''}` : 'זרימה = הרבעון'} · רווח תפעולי של המגזר, לפני מס · בלי צמיחת הנכסים, שחיקת דמי ניהול ועלות שולית.</div>

      <Panel title={`ערך הניוד · ${d.segs[seg]} · ${pl(p)}`} aside={<><span>זרימות: מיליארדי ש"ח · ערך נוכחי: מיליוני ש"ח</span><button type="button" className="btn" onClick={() => void xlsx()}>Excel</button></>}>
        {!rows.length ? <Empty title="אין נתונים לתקופה" /> : <div className="scroll"><table className="lens-tbl npv-tbl">
          <thead><tr>
            <th>מנהל</th><th className="wide-only">ניוד נטו</th><th>{phone ? 'NPV ניוד' : 'ערך הניוד'} <span className="chip est">אומדן</span></th><th>#</th>
            <th className="wide-only">צבירה אורגנית</th><th>{phone ? 'NPV אורגני' : 'ערך הצבירה'} <span className="chip est">אומדן</span></th><th className="wide-only">#</th>
            <th className="wide-only">תשואת דמי ניהול</th><th className="wide-only">{basis === 'ci' ? 'הוצאות להכנסות' : 'הנהלה להכנסות'}</th><th className="wide-only">מרווח על נכסים</th>
          </tr></thead>
          <tbody>{rows.map((r) => {
            const vT = val(r, 'tr'), vO = val(r, 'org'), m = src.margin(r), name = src.name(r.g);
            return (
              <tr key={r.g} onPointerEnter={() => warmRep(r.c)}>
                <td><span className="lens-mgr"><IdDot grp={name} />{phone ? short(name) : name}</span>{r.mark && <span className="chip est" title={r.mark}>לא בר השוואה</span>}</td>
                <td className="wide-only">{r.tr == null ? <Dash why="אין תזרים מלא לתקופה" /> : <S className={tone(r.tr)} src={() => src.flow(r, 'tr')}>{sn(r.tr / 1000, 2)}</S>}</td>
                <td>{vT == null ? <Dash why={why(r)} /> : <S className={`${tone(vT)} est-num`} src={() => src.npvP(r, 'tr')}>{sn(vT, 1)}</S>}</td>
                <td>{rkT.get(r.g) == null ? '' : <S src={() => rankP(r, 'tr')} className="muted">{rkT.get(r.g)}</S>}</td>
                <td className="wide-only">{r.org == null ? <Dash why="אין תזרים מלא לתקופה" /> : <S className={tone(r.org)} src={() => src.flow(r, 'org')}>{sn(r.org / 1000, 2)}</S>}</td>
                <td>{vO == null ? <Dash why={why(r)} /> : <S className={`${tone(vO)} est-num`} src={() => src.npvP(r, 'org')}>{sn(vO, 1)}</S>}</td>
                <td className="wide-only">{rkO.get(r.g) == null ? '' : <S src={() => rankP(r, 'org')} className="muted">{rkO.get(r.g)}</S>}</td>
                <td className="wide-only">{r.fy == null ? <Dash why={why(r)} /> : <S src={() => src.fy(r)}>{nf(r.fy, 3)}%</S>}</td>
                <td className="wide-only">{basis === 'ci' ? (r.ci == null ? <Dash why={why(r)} /> : <S src={() => src.ci(r)}>{nf(r.ci, 0)}%</S>) : (r.ga == null || !r.fees ? <Dash why={why(r)} /> : <S src={() => src.gaRatio(r)}>{nf(r.ga / r.fees * 100, 0)}%</S>)}</td>
                <td className="wide-only">{m == null ? <Dash why={why(r)} /> : <S className={m < 0 ? 'neg' : ''} src={() => src.marginP(r)}>{nf(m, 3)}%</S>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>}
        <div className="fnote">ערך = הרווח התפעולי שהזרימה תניב לאורך D שנים, מהוון ב-ke. מרווח שלילי (הוצאות מעל ההכנסות) הופך את הסימן. מרווח "לפני שיווק": בלי עמלות והוצאות רכישה, גבול עליון לנכסים שכבר עברו. ביטוחי מנהלים ופוליסות חיסכון: ביטוח-נט אינו מפרסם תזרימים, ולכן אין חישוב. {rows.find((r) => r.mark)?.mark ?? ''}</div>
      </Panel>

      {chartRows.length > 0 && <Panel title={`ערך נוכחי לפי מנהל · ${d.segs[seg]} · ${pl(p)}`} aside={<span>מיליוני ש"ח · אומדן</span>}>
        <Chart label={`ערך הניוד והצבירה · ${d.segs[seg]} · ${pl(p)}`} height={phone ? 300 : 320} deps={[seg, p, basis, ke, ctx.D[seg], chartRows.map((r) => r.g).join()]} source={`${d.meta.source_reg}; ${d.meta.source_rep}`}
          onPoint={(si, di) => { const r = chartRows[di]; if (r) open(src.npvP(r, si === 0 ? 'tr' : 'org')); }}
          build={() => foxOption({ x: chartRows.map((r) => short(src.name(r.g))), unit: 'מיליוני ש"ח', legend: true, labels: !phone, rotate: phone ? 40 : 0,
            series: [{ name: 'ערך הניוד נטו', kind: 'bar', color: cssColor('--accent'), dec: 1, data: chartRows.map((r) => { const v = val(r, 'tr'); return v == null ? null : +v.toFixed(1); }) },
              { name: 'ערך הצבירה האורגנית', kind: 'bar', color: cssColor('--neutral'), dec: 1, data: chartRows.map((r) => { const v = val(r, 'org'); return v == null ? null : +v.toFixed(1); }) }] })} />
      </Panel>}
    </>
  );
}
