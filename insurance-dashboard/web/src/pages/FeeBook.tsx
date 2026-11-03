import { useEffect, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IdDot } from '../components/MgrChip';
import { Sourced } from '../components/Source';
import { ErrorBox, Kpi, Loading, Panel, Seg as SegCtl } from '../components/ui';
import { nf } from '../lib/format';
import { LensSrc, ql, ym, type LensData, useLens } from '../lib/lens';
import { baseAssume, costOk, mgrEv, rowEv, rowIn, useFeeBook, type FbAssume, type FbMgr, type FbRow, type FbSeg, type FeeBookData } from '../lib/feebook';
import type { Prov } from '../lib/prov';
import '../styles/lens.css';
import '../styles/nowcast.css';
import '../styles/flownpv.css';
import '../styles/feebook.css';

/** Wave 11, Pro door: what the management fees on today's book are worth, per manager x product. Every assumption is editable here and
 *  every figure opens to its source: regulator month, report page, or the stated assumption. The pipeline writes the base case. */
export function FeeBook() {
  const fb = useFeeBook(), lens = useLens();
  useEffect(() => { document.title = 'ערך ספר דמי הניהול · fox'; }, []);
  if (fb.error || lens.error) return <ErrorBox what="ערך ספר דמי הניהול" error={fb.error ?? lens.error ?? ''} />;
  if (!fb.data || !lens.data) return <Loading what="ערך ספר דמי הניהול" />;
  return <Page d={fb.data} lens={lens.data} />;
}

const PROD: Record<string, string> = { pension_new: 'פנסיה מקיפה', pension_general: 'פנסיה כללית', gemel: 'גמל', hishtalmut: 'השתלמות', gemel_invest: 'גמל להשקעה',
  gemel_child: 'חיסכון לילד', severance: 'מרכזית לפיצויים', other_purpose: 'גמל, מטרה אחרת' };
const SEG_HE: Record<FbSeg, string> = { pen: 'פנסיה', gem: 'גמל והשתלמות' };
const m0 = (x: number | null | undefined) => (x == null ? '–' : nf(x, 0));
const m1 = (x: number | null | undefined, d = 1) => (x == null ? '–' : nf(x, d));
const pct = (x: number | null | undefined, d = 2) => (x == null ? '–' : `${nf(x, d)}%`);
const S = ({ src, children, className = '' }: { src: () => Prov; children: ReactNode; className?: string }) => <Sourced src={src}><span className={`num ${className}`}>{children}</span></Sourced>;
const Dash = ({ why }: { why: string }) => <span className="muted lens-dash" title={why}>–</span>;
const num = (v: string | null, d: number) => { const x = v == null || v === '' ? NaN : Number(v); return Number.isFinite(x) ? x : d; };

function useAssume(d: FeeBookData): [FbAssume, (k: string, v: string) => void, boolean] {
  const [sp, setSp] = useSearchParams();
  const b = baseAssume(d);
  const a: FbAssume = { disc: num(sp.get('r'), b.disc), growth: num(sp.get('gr'), b.growth), horizon: Math.max(1, Math.min(60, Math.round(num(sp.get('h'), b.horizon)))),
    basis: sp.get('cb') === 'ga' ? 'ga' : 'all', up: sp.get('up') === '1', floor: sp.get('fl') !== '0', ds: num(sp.get('ds'), 0) };
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v === '') n.delete(k); else n.set(k, v); setSp(n, { replace: true }); };
  const changed = ['r', 'gr', 'h', 'cb', 'up', 'fl', 'ds'].some((k) => sp.has(k));
  return [a, set, changed];
}

function Page({ d, lens }: { d: FeeBookData; lens: LensData }) {
  const [a, set, changed] = useAssume(d);
  const [sp] = useSearchParams();
  const ls = useMemo(() => new LensSrc(lens), [lens]);
  const P = useMemo(() => new FbSrc(d, ls, lens), [d, ls, lens]);
  const byG = useMemo(() => { const m = new Map<number, FbRow[]>(); d.rows.forEach((x) => m.set(x.g, [...(m.get(x.g) ?? []), x])); return m; }, [d]);
  const tot = d.managers.map((m) => ({ m, ...mgrEv(byG.get(m.g) ?? [], a) }));
  const all = tot.filter((t) => t.ev != null), sumEv = all.reduce((s, t) => s + t.ev!, 0), sumA = all.reduce((s, t) => s + t.aum, 0);
  const sel = d.managers.find((m) => m.c === sp.get('m')) ?? d.managers[0];
  const base = !changed;
  return (
    <>
      <h2 className="band">ערך ספר דמי הניהול<span className="muted"><span className="chip nc-draft">טיוטה</span> כמה שוות הכנסות דמי הניהול מהנכסים שכבר מנוהלים, לפי מנהל ומוצר · רשות עד <span className="num">{ym(d.meta.asof)}</span> · הוצאות: <span className="num">{d.meta.cost_quarters.map(ql).join(', ')}</span> · שיטה {d.meta.method}</span></h2>
      <Assumptions d={d} a={a} set={set} changed={changed} P={P} />
      <section className="kpis fb-kpis">
        <Kpi label="ערך הספר, כל המנהלים שהוערכו" value={<S className="est-num" src={() => P.sumP(tot.filter((t) => t.ev != null).map((t) => ({ m: t.m, ev: t.ev! })), sumEv)}>{nf(sumEv / 1000, 1)}</S>} sub={`מיליארד ש"ח · ${all.length} מנהלים${base ? ' · מקרה בסיס' : ' · ההנחות שלך'}`} />
        <Kpi label="נכסים שהוערכו" value={nf(sumA / 1000, 0)} sub='מיליארד ש"ח, רשות' />
        <Kpi label="ערך לכל ₪ נכסים" value={pct(sumA ? sumEv / sumA * 100 : null, 2)} sub="ממוצע משוקלל" />
      </section>
      <Panel title="לפי מנהל" aside={<span>מיליוני ש"ח · לחיצה על שם: מוצרים ורגישות</span>}>
        <div className="scroll"><table className="lens-tbl nc-tbl fb-tbl">
          <thead><tr><th>מנהל</th><th>נכסים (מיליארד)</th><th>ערך הספר</th><th>ערך ÷ נכסים</th><th className="wide-only">ערך לפני הוצאות</th><th className="wide-only">הוצאות להכנסות: פנסיה</th><th className="wide-only">גמל והשתלמות</th><th className="wide-only">שרידות ממוצעת</th><th className="wide-only">CSM ÷ נכסי ביטוח</th></tr></thead>
          <tbody>{tot.map(({ m, ev, aum }) => { const rs = byG.get(m.g) ?? [], gross = rs.reduce((s, x) => s + (rowEv(x, a) == null ? 0 : evGross(x, a)), 0);
            const sv = wAvg(rs.filter((x) => x.surv != null).map((x) => [rowIn(x, a).surv!, x.aum]));
            return (
              <tr key={m.c} className={m.c === sel.c ? 'sel' : ''}>
                <td><button type="button" className="linkish fb-mgr" onClick={() => set('m', m.c === d.managers[0].c ? '' : m.c)} aria-pressed={m.c === sel.c}><IdDot grp={m.name} />{m.name}</button></td>
                <td><S src={() => P.aumMgr(m, rs)}>{m1(m.aum / 1000)}</S></td>
                <td>{ev != null ? <S className="est-num" src={() => P.evMgr(m, rs, a)}>{m0(ev)}</S> : <Dash why={whyMgr(m)} />}{ev != null && m.n_v < m.n && <span className="nc-lag" title="חלק מהמוצרים לא הוערכו (נכסים קטנים או בלי נתונים)">*</span>}</td>
                <td>{ev != null ? <span className="num est-num">{pct(ev / aum * 100, 2)}</span> : '–'}</td>
                <td className="wide-only">{ev != null ? <span className="num est-num">{m0(gross)}</span> : '–'}</td>
                {(['pen', 'gem'] as FbSeg[]).map((s) => { const c = m.costs[s]; return <td key={s} className="wide-only">{costOk(c) ? <S src={() => P.cost(m, s)}>{pct((a.basis === 'ga' ? c.ci_ga : c.ci) * 100, 1)}</S> : <Dash why={'why' in c ? c.why : ''} />}</td>; })}
                <td className="wide-only">{sv == null ? '–' : <span className="num">{pct(sv * 100, 1)}</span>}</td>
                <td className="wide-only">{m.csm?.csm_aum != null ? <S src={() => P.csmP(m)}>{pct(m.csm.csm_aum, 1)}</S> : '–'}</td>
              </tr>); })}</tbody>
        </table></div>
        <div className="fnote">ערך הספר: הערך הנוכחי של דמי הניהול מצבירה על הנכסים של היום, אחרי הוצאות, בלי הפקדות חדשות ובלי דמי ניהול מהפקדה (אלה עסקים חדשים, לא הספר). אין הערכה בלי הוצאות מגזר מדווחות: המספר נשאר ריק ולא מונח. CSM ÷ נכסי ביטוח: בדיקת סבירות בלבד, CSM כולל גם ביטוח סיכון ובריאות. * חלק מהמוצרים לא הוערכו.</div>
      </Panel>
      <Products d={d} m={sel} rows={byG.get(sel.g) ?? []} a={a} P={P} />
      <Grid d={d} m={sel} rows={byG.get(sel.g) ?? []} a={a} />
      <CsmCheck d={d} a={a} byG={byG} P={P} />
      <Panel title="שיטה ומגבלות" aside={<span className="chip est">אומדן</span>}>
        <ul className="nc-notes">
          <li>ערך = Σ<sub>t=1..H</sub> נכסים × [שרידות × (1 + צמיחה)]<sup>t−1</sup> × דמי ניהול<sub>t</sub> ÷ 100 × (1 − הוצאות להכנסות) ÷ (1 + r)<sup>t</sup>: דמי ניהול על יתרת הפתיחה של כל שנה, מתקבלים בסופה. ללא מס.</li>
          <li>דמי ניהול<sub>t</sub> = max(רצפה, דמי ניהול היום + שחיקה × (t − 1)). שחיקה: שיפוע הקו הישר של דמי הניהול הממוצעים בחודשי {d.assume.win} האחרונים; מגמה עולה אינה מוקרנת (אלא אם בחרת). רצפה בפנסיה: דמי הניהול מצבירה של קרנות ברירת המחדל ({d.assume.floor ? `${pct(d.assume.floor.fee, 2)}, הליך ${d.assume.floor.tender}` : '–'}); כשדמי הניהול כבר מתחתיה, הם נשארים במקום.</li>
          <li>שרידות = 1 − (משיכות + העברות נטו יוצאות) ÷ נכסים, ממוצע {d.assume.win} חודשים. הרשות מפרסמת העברות נטו בלבד: אצל מנהל שגם מקבל העברות, היציאות האמיתיות גבוהות יותר והשרידות כאן גבוהה מדי.</li>
          <li>הוצאות להכנסות: (שיווק ומכירה + הנהלה וכלליות) ÷ הכנסות מדמי ניהול של המגזר בדוחות, 4 רבעונים. ההכנסות בדוח כוללות דמי ניהול מהפקדה, ולכן יחס ההוצאות מוחל כאן על זרם קטן יותר (הנחה: ההוצאות משתנות עם ההכנסות). &quot;הנהלה וכלליות בלבד&quot;: ספר שאינו מגייס אינו משלם עמלות גיוס, אבל עמלות היקף לסוכנים יושבות בשיווק אצל חלק מהמנהלים: גבול עליון, לא עובדה. מיטב: לפני דמי ניהול לחברה האם (ראו הערת העדשה), ולכן ההוצאות נמוכות מדי והערך גבוה מדי.</li>
          <li>שיעור ההיוון וצמיחת הנכסים הם הנחות. בבסיס הצמיחה 0, כפי שהשיטה הוגדרה: ספר נומינלי שמהוון ב-{nf(d.assume.disc, 0)}% נומינלי בלי תשואה על הנכסים הוא קריאה שמרנית; נסו צמיחה של תשואת אג״ח ממשלתית.</li>
        </ul>
      </Panel>
    </>
  );
}
const wAvg = (xs: [number, number][]) => { const w = xs.reduce((s, x) => s + x[1], 0); return w ? xs.reduce((s, x) => s + x[0] * x[1], 0) / w : null; };
const evGross = (x: FbRow, a: FbAssume) => { const i = rowIn(x, a); return rowEvWith(x, a, i, 0) ?? 0; };
function rowEvWith(x: FbRow, a: FbAssume, i: ReturnType<typeof rowIn>, ci: number) {
  if (i.surv == null || x.fee == null) return null;
  const fl = i.floor != null ? Math.max(0, Math.min(x.fee, i.floor)) : 0, k = 1 + a.disc / 100;
  let bal = x.aum, pv = 0;
  for (let t = 1; t <= a.horizon; t++) { pv += bal * Math.max(fl, x.fee + i.eros * (t - 1)) / 100 * (1 - ci) / k ** t; bal *= i.surv * (1 + a.growth / 100); }
  return pv;
}
const whyMgr = (m: FbMgr) => { const w = (['pen', 'gem'] as FbSeg[]).map((s) => m.costs[s]).find((c) => 'why' in c) as { why: string } | undefined; return w?.why ?? 'אין הוצאות מגזר מדווחות'; };

function Assumptions({ d, a, set, changed, P }: { d: FeeBookData; a: FbAssume; set: (k: string, v: string) => void; changed: boolean; P: FbSrc }) {
  const In = ({ k, label, v, step, sub }: { k: string; label: string; v: number; step: number; sub: string }) => (
    <label><span>{label}</span><span className="in"><input type="number" inputMode="decimal" step={step} value={v} aria-label={label} onChange={(e) => set(k, e.target.value)} /></span><small>{sub}</small></label>);
  return (
    <section className="npv-as fb-as" aria-label="הנחות">
      <In k="r" label="שיעור היוון, %" v={a.disc} step={0.5} sub={`הנחה · בסיס ${nf(d.assume.disc, 1)}% נומינלי`} />
      <In k="gr" label="צמיחת הנכסים, % לשנה" v={a.growth} step={0.5} sub={`הנחה · בסיס ${nf(d.assume.growth, 1)}%`} />
      <In k="h" label="אופק, שנים" v={a.horizon} step={1} sub={`בסיס ${d.assume.horizon}`} />
      <In k="ds" label="הזזת שרידות, נק׳" v={a.ds} step={0.5} sub="0 = 3 שנים בפועל" />
      <div className="field"><span>הוצאות</span><SegCtl<'all' | 'ga'> label="בסיס ההוצאות" value={a.basis} onChange={(v) => set('cb', v === 'all' ? '' : v)} options={[['all', 'כל הוצאות המגזר'], ['ga', 'הנהלה וכלליות בלבד']]} /></div>
      <div className="field"><span>מגמת דמי ניהול עולה</span><SegCtl<'0' | '1'> label="מגמה עולה" value={a.up ? '1' : '0'} onChange={(v) => set('up', v === '1' ? '1' : '')} options={[['0', 'לא מוקרנת'], ['1', 'מוקרנת']]} /></div>
      <div className="field"><span>רצפת ברירת המחדל</span><SegCtl<'1' | '0'> label="רצפה" value={a.floor ? '1' : '0'} onChange={(v) => set('fl', v === '0' ? '0' : '')} options={[['1', 'פעילה'], ['0', 'כבויה']]} /></div>
      <div className="ann"><span>רצפה בפנסיה</span>{d.assume.floor ? <S src={() => P.floorP()}>{pct(d.assume.floor.fee, 2)}</S> : '–'}<small>הליך {d.assume.floor?.tender ?? '–'}</small></div>
      {changed && <button type="button" className="btn" onClick={() => ['r', 'gr', 'h', 'cb', 'up', 'fl', 'ds'].forEach((k) => set(k, ''))}>חזרה לבסיס</button>}
    </section>
  );
}

function Products({ d, m, rows, a, P }: { d: FeeBookData; m: FbMgr; rows: FbRow[]; a: FbAssume; P: FbSrc }) {
  return (
    <Panel title={`${m.name} · לפי מוצר`} aside={<span>מיליוני ש"ח · רשות {ym(d.meta.asof)}</span>}>
      <div className="scroll"><table className="lens-tbl nc-tbl fb-tbl">
        <thead><tr><th>מוצר</th><th>נכסים</th><th>דמי ניהול</th><th className="wide-only">מגמה, נק׳ לשנה</th><th className="wide-only">רצפה</th><th>שרידות</th><th className="wide-only">הוצאות להכנסות</th><th>ערך</th><th>ערך ÷ נכסים</th></tr></thead>
        <tbody>{rows.map((x) => { const i = rowIn(x, a), ev = rowEv(x, a); return (
          <tr key={x.p}>
            <td>{PROD[x.p] ?? x.p}</td>
            <td><S src={() => P.aumP(x)}>{m0(x.aum)}</S></td>
            {x.skip ? <td colSpan={7} className="muted">{x.skip}</td> : <>
              <td><S src={() => P.feeP(x)}>{pct(x.fee, 3)}</S></td>
              <td className="wide-only">{x.trend == null ? <Dash why="פחות מ-24 חודשי דמי ניהול" /> : <S src={() => P.trendP(x)}>{`${x.trend > 0 ? '+' : ''}${nf(x.trend, 3)}`}</S>}</td>
              <td className="wide-only">{i.floor != null ? <S src={() => P.floorP()}>{pct(i.floor, 2)}</S> : '–'}</td>
              <td>{i.surv == null ? <Dash why={x.why ?? 'אין תזרימים'} /> : <S src={() => P.survP(x, a)}>{pct(i.surv * 100, 1)}</S>}</td>
              <td className="wide-only">{i.ci == null ? <Dash why={x.why ?? ''} /> : <S src={() => P.cost(m, x.seg)}>{pct(i.ci * 100, 1)}</S>}</td>
              <td>{ev == null ? <Dash why={x.why ?? 'אין הוצאות מגזר מדווחות'} /> : <S className={`est-num ${ev < 0 ? 'neg' : ''}`} src={() => P.evRow(m, x, a)}>{m0(ev)}</S>}</td>
              <td>{ev == null ? '–' : <span className="num est-num">{pct(ev / x.aum * 100, 2)}</span>}</td></>}
          </tr>); })}</tbody>
      </table></div>
      <div className="fnote">ערך שלילי: ההוצאות המדווחות של המגזר גבוהות מההכנסות (מגזר בהפסד או בשלב גיוס); בבסיס &quot;הנהלה וכלליות בלבד&quot; הוא נבדק בלי עלויות הגיוס. מגמה: שינוי דמי הניהול הממוצעים בנקודות אחוז לשנה.</div>
    </Panel>
  );
}

function Grid({ d, m, rows, a }: { d: FeeBookData; m: FbMgr; rows: FbRow[]; a: FbAssume }) {
  const has = rows.some((x) => rowEv(x, a) != null);
  return (
    <Panel title={`${m.name} · רגישות: שיעור היוון × שרידות`} aside={<span>ערך הספר, מיליוני ש"ח · שאר ההנחות כמו למעלה</span>}>
      {!has ? <p className="muted">אין ערך בלי הוצאות מגזר מדווחות.</p> : (
        <div className="scroll"><table className="lens-tbl nc-tbl fb-grid">
          <thead><tr><th>היוון \ שרידות</th>{d.assume.grid_s.map((s) => <th key={s}>{s === 0 ? 'בפועל' : `${s > 0 ? '+' : ''}${nf(s, 0)} נק׳`}</th>)}</tr></thead>
          <tbody>{d.assume.grid_r.map((r) => (
            <tr key={r} className={Math.abs(r - a.disc) < 1e-9 ? 'sel' : ''}><th scope="row"><span className="num">{nf(r, 1)}%</span></th>
              {d.assume.grid_s.map((s) => { const v = mgrEv(rows, a, { disc: r, ds: a.ds + s }).ev; return <td key={s} className={s === 0 && Math.abs(r - a.disc) < 1e-9 ? 'base' : ''}><span className="num est-num">{m0(v)}</span></td>; })}</tr>))}</tbody>
        </table></div>)}
      <div className="fnote">שרידות: הזזה בנקודות אחוז של השרידות השנתית של כל מוצר (מעל ההזזה שבחרת למעלה). השורה המודגשת: שיעור ההיוון שבחרת.</div>
    </Panel>
  );
}

function CsmCheck({ d, a, byG, P }: { d: FeeBookData; a: FbAssume; byG: Map<number, FbRow[]>; P: FbSrc }) {
  const ins = d.managers.filter((m) => m.csm);
  return (
    <Panel title="בדיקת סבירות: CSM של המבטחות לכל ₪ נכסי ביטוח" aside={<span>אחוז מהנכסים</span>}>
      <div className="scroll"><table className="lens-tbl nc-tbl fb-tbl">
        <thead><tr><th>מבטחת</th><th>CSM (מיליוני ש"ח)</th><th className="wide-only">בסיס</th><th className="wide-only">נכסי ביטוח, רשות (מיליארד)</th><th>CSM ÷ נכסים</th><th className="wide-only">CSM חיים וחיסכון ÷ נכסים</th><th>ספר דמי הניהול ÷ נכסים</th></tr></thead>
        <tbody>{ins.map((m) => { const c = m.csm!, t = mgrEv(byG.get(m.g) ?? [], a); return (
          <tr key={m.c}><td><span className="lens-mgr"><IdDot grp={m.name} />{m.name}</span></td>
            <td><S src={() => P.csmV(m)}>{m0(c.v)}</S></td><td className="wide-only">{c.basis} · {c.date.slice(8, 10)}.{c.date.slice(5, 7)}.{c.date.slice(2, 4)}</td>
            <td className="wide-only"><S src={() => ({ k: 'reg', metric: 'assets', pi: c.pi ?? 0, w: 'm', set: 'fam:insurance', g: m.g })}>{m1(c.a_ins / 1000)}</S></td>
            <td><S src={() => P.csmP(m)}>{pct(c.csm_aum, 1)}</S></td>
            <td className="wide-only">{c.life ? <S src={() => P.csmLife(m)}>{pct(c.life.csm_aum, 1)}</S> : '–'}</td>
            <td>{t.ev != null ? <span className="num est-num">{pct(t.ev / t.aum * 100, 2)}</span> : '–'}</td></tr>); })}</tbody>
      </table></div>
      <div className="fnote">ה-CSM הוא הרווח העתידי שטרם הוכר על חוזי ביטוח (IFRS 17), ברובו ביטוח סיכון ובריאות; נכסי הביטוח הם ביטוחי מנהלים ופוליסות חיסכון (ביטוח-נט). ספר דמי הניהול כאן הוא פנסיה וגמל בלבד, נטו מהוצאות. הפער הגדול צפוי: הוא אומר שרוב ערך המבטחות בחיסכון ארוך הטווח יושב בפוליסות ובסיכון, לא בדמי הניהול של הקרנות.</div>
    </Panel>
  );
}

/* ---------- provenance ---------- */
class FbSrc {
  constructor(readonly d: FeeBookData, readonly ls: LensSrc, readonly lens: LensData) {}
  private rowsL = new Map<string, LensData['rows'][number]>();
  private lr(g: number, s: FbSeg, q: string) {
    if (!this.rowsL.size) this.lens.rows.forEach((r) => this.rowsL.set(`${r.g}|${r.s}|${r.q}`, r));
    return this.rowsL.get(`${g}|${s}|${q}`);
  }
  aumP(x: FbRow): Prov { return { k: 'reg', metric: 'assets', pi: x.pi, w: 'm', set: `p:${x.p}`, g: x.g }; }
  feeP(x: FbRow): Prov { return { k: 'reg', metric: 'fee', pi: x.pi, w: 'm', set: `p:${x.p}`, g: x.g }; }
  aumMgr(m: FbMgr, rs: FbRow[]): Prov {
    return { k: 'calc', title: `נכסים · ${m.name} · ${ym(this.d.meta.asof)}`, value: m1(m.aum / 1000), unit: 'מיליארד ש"ח', formula: 'סכום המוצרים (פנסיה, גמל והשתלמות)',
      inputs: rs.map((x) => ({ label: PROD[x.p] ?? x.p, v: m0(x.aum), src: () => this.aumP(x) })) };
  }
  trendP(x: FbRow): Prov {
    const w = this.d.assume.win;
    return { k: 'calc', est: true, title: `מגמת דמי הניהול · ${PROD[x.p]} · ${this.lens.groups[x.g].name}`, value: `${nf(x.trend!, 4)} נק׳ לשנה`,
      formula: `שיפוע OLS של דמי הניהול הממוצעים המשוקללים בנכסים, ${x.fee_n} חודשים מתוך ${w}, × 12. בבסיס: מגמה עולה אינה מוקרנת (שחיקה = min(0, מגמה))`,
      inputs: [{ label: `דמי ניהול · ${ym(madd(this.d.meta.asof, -(w - 1)))}`, v: pct(x.fee_first, 3), src: () => ({ k: 'reg', metric: 'fee', pi: x.pi - (w - 1), w: 'm', set: `p:${x.p}`, g: x.g }) },
        { label: `דמי ניהול · ${ym(this.d.meta.asof)}`, v: pct(x.fee, 3), src: () => this.feeP(x) }] };
  }
  survP(x: FbRow, a: FbAssume): Prov {
    const o = x.out!;
    return { k: 'calc', est: true, title: `שרידות · ${PROD[x.p]} · ${this.lens.groups[x.g].name}`, value: pct(rowIn(x, a).surv! * 100, 2), unit: 'לשנה',
      formula: `1 − (Σ משיכות + Σ העברות נטו יוצאות, חודש בחודש) ÷ (${o.n} ÷ 12) ÷ נכסים ממוצעים${a.ds ? ` ; + הזזה ${nf(a.ds, 1)} נק׳ (ההנחה שלך)` : ''}`,
      note: `רשות שוק ההון, ${ym(o.from)}–${ym(o.to)}, קבוצה × מוצר (flows/${x.fid}.json, build_flows.py). הרשות מפרסמת העברות נטו בלבד`,
      inputs: [{ label: 'Σ משיכות', v: m1(o.wd) }, { label: 'Σ העברות נטו יוצאות (חודשים של יציאה נטו)', v: m1(o.tro) },
        { label: 'נכסים ממוצעים', v: m1(o.avg) }, { label: 'שיעור יציאה שנתי', v: pct(o.rate, 2) },
        { label: `העברות נטו, 12 חודשים עד ${ym(o.to)}`, v: '', src: () => ({ k: 'reg', metric: 'transfers', pi: x.pi, w: 'ltm', set: `p:${x.p}`, g: x.g }) },
        { label: `צבירה אורגנית (הפקדות − משיכות), 12 חודשים עד ${ym(o.to)}`, v: '', src: () => ({ k: 'reg', metric: 'organic', pi: x.pi, w: 'ltm', set: `p:${x.p}`, g: x.g }) }] };
  }
  cost(m: FbMgr, s: FbSeg): Prov {
    const c = m.costs[s];
    if (!costOk(c)) return { k: 'none', title: `הוצאות להכנסות · ${m.name} · ${SEG_HE[s]}`, why: 'why' in c ? c.why : '' };
    return { k: 'calc', title: `הוצאות להכנסות · ${m.name} · ${SEG_HE[s]}`, value: pct(c.ci * 100, 2), formula: '(Σ שיווק ומכירה + Σ הנהלה וכלליות) ÷ Σ הכנסות מדמי ניהול, 4 רבעונים מהדוחות. הנהלה וכלליות בלבד: ' + pct(c.ci_ga * 100, 2),
      inputs: c.parts.flatMap((p) => { const r = this.lr(m.g, s, p.q); return [
        { label: `שיווק ומכירה · ${ql(p.q)}`, v: m1(p.sm), src: r ? () => this.ls.rep(r, 'sm', 'q') : undefined },
        { label: `הנהלה וכלליות · ${ql(p.q)}`, v: m1(p.ga), src: r ? () => this.ls.rep(r, 'ga', 'q') : undefined },
        { label: `הכנסות מדמי ניהול · ${ql(p.q)}`, v: m1(p.fees), src: r ? () => this.ls.rep(r, 'fees', 'q') : undefined }]; }) };
  }
  floorP(): Prov {
    const f = this.d.assume.floor;
    if (!f) return { k: 'none', title: 'רצפת ברירת המחדל', why: 'אין הליך עם דמי ניהול מפורסמים' };
    return { k: 'report', title: `דמי ניהול מצבירה בקרנות ברירת המחדל, הליך ${f.tender}`, value: pct(f.fee, 2), url: f.src, pg: null, doc: f.src_title ?? undefined,
      period: `${f.from} – ${f.to}`, srcType: 'רשות שוק ההון', note: `דמי ניהול מהפקדה בהליך: ${pct(f.depfee, 2)}. funds/default.json` };
  }
  evRow(m: FbMgr, x: FbRow, a: FbAssume): Prov {
    const i = rowIn(x, a), ev = rowEv(x, a);
    return { k: 'calc', est: true, title: `ערך הספר · ${m.name} · ${PROD[x.p]}`, value: m0(ev), unit: 'מיליוני ש"ח',
      formula: 'Σ_{t=1..H} נכסים × [שרידות × (1 + צמיחה)]^(t−1) × max(רצפה, דמי ניהול + שחיקה × (t−1)) ÷ 100 × (1 − הוצאות להכנסות) ÷ (1 + r)^t',
      inputs: [{ label: 'נכסים', v: m0(x.aum), src: () => this.aumP(x) }, { label: 'דמי ניהול היום', v: pct(x.fee, 3), src: () => this.feeP(x) },
        { label: 'שחיקה, נק׳ לשנה', v: nf(i.eros, 4), src: x.trend != null ? () => this.trendP(x) : undefined },
        { label: 'רצפה', v: i.floor == null ? 'אין' : pct(i.floor, 2), src: i.floor != null ? () => this.floorP() : undefined },
        { label: 'שרידות', v: pct(i.surv == null ? null : i.surv * 100, 2), src: x.out ? () => this.survP(x, a) : undefined },
        { label: `הוצאות להכנסות (${a.basis === 'ga' ? 'הנהלה וכלליות בלבד' : 'כל הוצאות המגזר'})`, v: pct(i.ci == null ? null : i.ci * 100, 2), src: () => this.cost(m, x.seg) },
        { label: 'שיעור היוון (הנחה)', v: pct(a.disc, 1) }, { label: 'צמיחת נכסים (הנחה)', v: pct(a.growth, 1) }, { label: 'אופק, שנים', v: String(a.horizon) }] };
  }
  evMgr(m: FbMgr, rs: FbRow[], a: FbAssume): Prov {
    const t = mgrEv(rs, a);
    return { k: 'calc', est: true, title: `ערך הספר · ${m.name}`, value: m0(t.ev), unit: 'מיליוני ש"ח', formula: 'סכום המוצרים שהוערכו',
      inputs: rs.filter((x) => rowEv(x, a) != null).map((x) => ({ label: PROD[x.p] ?? x.p, v: m0(rowEv(x, a)), src: () => this.evRow(m, x, a) })) };
  }
  sumP(xs: { m: FbMgr; ev: number }[], v: number): Prov {
    return { k: 'calc', est: true, title: 'ערך ספר דמי הניהול, כל המנהלים שהוערכו', value: m0(v), unit: 'מיליוני ש"ח', formula: 'סכום המנהלים',
      inputs: xs.map((x) => ({ label: x.m.name, v: m0(x.ev) })) };
  }
  csmV(m: FbMgr): Prov {
    const c = m.csm!;
    if (c.parts.length === 1) return { k: 'report', title: `CSM · ${m.name}`, value: m0(c.v), unit: 'מיליוני ש"ח', url: c.url, pg: c.parts[0].pg,
      doc: `דוח ${c.period} ${m.name}`, period: c.date, srcType: 'דוח כספי', note: `${c.basis} · ${c.parts[0].l}` };
    return { k: 'calc', title: `CSM · ${m.name}`, value: m0(c.v), unit: 'מיליוני ש"ח', formula: `${c.basis}: סכום השורות שבדוח`,
      inputs: c.parts.map((p) => ({ label: `${p.s} · עמ׳ ${p.pg}`, v: m0(p.v), src: () => ({ k: 'report', title: `CSM · ${m.name} · ${p.s}`, value: m0(p.v), unit: 'מיליוני ש"ח', url: c.url, pg: p.pg,
        doc: `דוח ${c.period} ${m.name}`, period: c.date, srcType: 'דוח כספי', note: p.l }) as Prov })) };
  }
  csmP(m: FbMgr): Prov {
    const c = m.csm!;
    return { k: 'calc', title: `CSM ÷ נכסי ביטוח · ${m.name}`, value: pct(c.csm_aum, 2), formula: 'CSM ÷ נכסי ביטוחי מנהלים ופוליסות חיסכון (ביטוח-נט) באותו תאריך × 100',
      inputs: [{ label: 'CSM', v: m0(c.v), src: () => this.csmV(m) }, { label: `נכסי ביטוח · ${ym(c.ym)}`, v: m0(c.a_ins), src: () => ({ k: 'reg', metric: 'assets', pi: c.pi ?? 0, w: 'm', set: 'fam:insurance', g: m.g }) }] };
  }
  csmLife(m: FbMgr): Prov {
    const c = m.csm!, l = c.life!;
    return { k: 'calc', title: `CSM חיים וחיסכון ÷ נכסי ביטוח · ${m.name}`, value: pct(l.csm_aum, 2), formula: 'שורת ה-CSM של מגזר החיים / החיסכון ארוך הטווח ÷ נכסי ביטוח × 100',
      inputs: [{ label: `CSM · ${l.s}`, v: m0(l.v), src: () => ({ k: 'report', title: `CSM · ${m.name} · ${l.s}`, value: m0(l.v), unit: 'מיליוני ש"ח', url: c.url, pg: l.pg,
        doc: `דוח ${c.period} ${m.name}`, period: c.date, srcType: 'דוח כספי', note: l.l }) },
        { label: `נכסי ביטוח · ${ym(c.ym)}`, v: m0(c.a_ins), src: () => ({ k: 'reg', metric: 'assets', pi: c.pi ?? 0, w: 'm', set: 'fam:insurance', g: m.g }) }] };
  }
}
const madd = (p: number, k: number) => { const t = Math.floor(p / 100) * 12 + (p % 100 - 1) + k; return Math.floor(t / 12) * 100 + (t % 12) + 1; };
