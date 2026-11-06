import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { Sourced } from '../components/Source';
import { Tip } from '../components/Explain';
import { ErrorBox, Loading, Panel } from '../components/ui';
import { fundP } from '../lib/market';
import type { Prov } from '../lib/prov';
import { nf } from '../lib/format';
import { useFundCats, useFunds } from '../lib/useData';
import { catKey, refOf, selfDirected, ym, type CatX, type FundX, type FundsFile } from '../lib/funds';
import { annualised, career, feeGrid, median, type Career, type CareerOut, type FeePair } from '../lib/fundsCalc';
import { priceOf, tendersOf, tenderAt, type DefaultFile } from '../lib/fundsTools';
import { numQ, useOptional } from '../lib/fundsLoad';
import { ToolLinks } from './FundsTools';
import { useActiveDoor } from '../components/home/doorState';
import { useMine, useMyAge, useMySex, useRetire } from '../lib/mine';
import { AGE_DEFAULT, RET_FALLBACK, ageText, coefOf, ilsRound } from '../lib/retire';
import { capOf, feeError, KZ_CAPS } from '../lib/feeCaps';
import { singleIndex } from '../lib/verdict';
import '../styles/lens.css';
import '../styles/fundsTools.css';

/* /funds/tools/fees (funds plan #7): what a fee level costs over a working life. A salary path, a deposit rate, a gross return
   assumption, two fee pairs (from deposit, from accumulation) side by side; the balance at retirement, the fees paid, the monthly
   pension through a conversion coefficient; a deposit-fee × accumulation-fee grid; and the reader's track against the cheapest real
   track in the category. Assumptions are labelled as assumptions; the fees of real tracks open their regulator record. */

const ils = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 0)} ש"ח`);
const pc = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${nf(v, d)}%`);
const DEPS = [0, 1, 2, 3, 4, 6], ACCS = [0.1, 0.2, 0.3, 0.5, 0.75, 1.05];
const ALL_MAX = 12, TOP_N = 10;
const BOI = 'הנחה. יעד האינפלציה של בנק ישראל: 1%–3% בשנה';

export function FundsFees() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cats = useFundCats().data as Record<string, CatX> | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const [sp, setSp] = useSearchParams();
  const set = (patch: Record<string, string | null>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v == null ? n.delete(k) : n.set(k, v))); setSp(n, { replace: true }); };
  const asof = data?.asof ?? 0;
  // W4: in the saver door the tool opens on the reader's first saved product, their age (asked on /my), their balance, deposit and
  // fees, and a conservative 4% return; the agent and Pro doors keep the category defaults (the largest track, 35, the 10-year past)
  // W5 (red team 3): a visitor with no door chosen gets the saver's conservative defaults too (4%, the reader's age), not the
  // category's 10-year past (9.12% and a ₪14,311 pension read as a promise); the answer leads, the assumptions fold below
  const [door] = useActiveDoor();
  const saver = door !== 'agent' && door !== 'pro';
  const [myList] = useMine(), [ageS] = useMyAge(), [sex] = useMySex();
  const RT = useRetire();
  const ownF = useMemo(() => { if (!saver) return undefined; const by = new Map(((data?.funds ?? []) as FundX[]).map((f) => [f.k, f])); return myList.map((m) => by.get(m.k)).find((f): f is FundX => !!f && !!f.assets && !f.closed && f.fee != null); }, [saver, myList, data]);
  const ownM = ownF ? myList.find((m) => m.k === ownF.k) : undefined;

  const cat = sp.get('cat') ?? (ownF ? catKey(ownF) : 'פנסיה מקיפה | עד 50');
  const [prod, track] = cat.split(' | ');
  const live = useMemo(() => ((data?.funds ?? []) as FundX[]).filter((f) => f.assets && !f.closed && !selfDirected(f) && f.fee != null), [data]);
  const catList = useMemo(() => { const m = new Map<string, number>(); live.forEach((f) => m.set(catKey(f), (m.get(catKey(f)) ?? 0) + 1)); return m; }, [live]);
  const prods = useMemo(() => [...new Set(live.map((f) => f.prod))], [live]);
  const tracks = useMemo(() => [...catList.keys()].filter((k) => k.startsWith(prod + ' | ')).map((k) => k.split(' | ')[1]), [catList, prod]);
  const members = useMemo(() => live.filter((f) => catKey(f) === cat).sort((a, b) => (a.fee! - b.fee!) || ((a.depfee ?? 0) - (b.depfee ?? 0))), [live, cat]);
  const mine = members.find((f) => f.k === (sp.get('k') ?? (ownF && catKey(ownF) === cat ? ownF.k : null))) ?? [...members].sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0))[0];
  const own = ownM && mine?.k === ownM.k ? ownM : undefined;  // the reader's own numbers apply to their own track only
  const cheap = members[0];
  /** the fees of a row: the reader's own on their own track when entered (W5: the row and the card agree), else the track's average */
  const pairOf = (f: FundX): FeePair => (own && f.k === own.k ? { depfee: own.depfee ?? f.depfee ?? 0, fee: own.fee ?? f.fee! } : { depfee: f.depfee ?? 0, fee: f.fee! });
  const ownRow = (f: FundX) => !!own && f.k === own.k && (own.fee != null || own.depfee != null);
  // red team 06.11.26: plain words for the two fee pairs (was "זוג א / זוג ב"); "שלך" only for a product the reader saved
  const LA = own ? 'דמי הניהול שלך' : 'המסלול שנבחר', LB = 'דמי ניהול להשוואה';

  // the return assumption: the reader's, else the category's 10-year gross (asset-weighted average of its tracks)
  const c = cats?.[cat];
  const cat10 = c ? annualised(c.y, 120) : null;
  const retQ = sp.get('r');
  const ret = numQ(retQ, saver ? RET_FALLBACK : cat10 != null ? +cat10.toFixed(2) : 4, -10, 30);
  const retSrc: 'user' | 'cat' | 'default' | 'safe' = retQ != null && retQ !== '' ? 'user' : saver ? 'safe' : cat10 != null ? 'cat' : 'default';
  const rate = numQ(sp.get('rate'), 18.5, 0, 100);
  const salary0 = own?.monthly != null && rate > 0 ? Math.round(own.monthly / (rate / 100) / 10) * 10 : 12000;
  const C: Career = { age: numQ(sp.get('age'), saver ? ageS ?? AGE_DEFAULT : 35, 15, 80), retire: numQ(sp.get('ra'), saver ? RT.v : 67, 40, 80), salary: numQ(sp.get('sal'), salary0, 0, 1e7), growth: numQ(sp.get('g'), 2, -10, 20), rate,
    ret, infl: numQ(sp.get('inf'), 2, -5, 20), start: numQ(sp.get('b0'), own?.balance ?? 0, 0, 1e9), coef: numQ(sp.get('coef'), saver ? coefOf(sex).v : 200, 50, 500) };
  const cap = capOf(prod);
  const ts = tendersOf(dfile), tender = asof ? tenderAt(ts, asof) : null;
  const tp = tender ? priceOf(tender) : null;
  // a fee above the legal ceiling is computed at the ceiling, with an inline error (lib/feeCaps)
  const A: FeePair = { depfee: numQ(sp.get('da'), own?.depfee ?? mine?.depfee ?? 1.5, 0, cap.depfee), fee: numQ(sp.get('fa'), own?.fee ?? mine?.fee ?? 0.2, 0, cap.fee) };
  const B: FeePair = { depfee: numQ(sp.get('db'), cheap?.depfee ?? 1, 0, cap.depfee), fee: numQ(sp.get('fb'), cheap?.fee ?? 0.1, 0, cap.fee) };
  const errOf = (k: string, w: 'fee' | 'depfee') => feeError(prod, w, sp.get(k) == null || sp.get(k) === '' ? null : Number(sp.get(k)), true);
  const oa = career(C, A), ob = career(C, B);
  const grid = useMemo(() => feeGrid(C, DEPS, ACCS), [JSON.stringify(C)]);  // eslint-disable-line react-hooks/exhaustive-deps
  const tenth = career(C, { ...A, fee: A.fee + 0.1 });

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="מחשבון" />;

  /* ---- sources ---- */
  const assumptions = () => [
    { label: saver && sp.get('age') == null ? (ageS != null ? 'גיל היום (שלך, מ"המוצרים שלי")' : 'גיל היום (לדוגמה)') : 'גיל היום (קלט שלך)', v: nf(C.age, 0) }, { label: saver && sp.get('ra') == null ? `גיל פרישה (${RT.own ? 'שלך, מ"המוצרים שלי"' : RT.why})` : 'גיל פרישה (קלט שלך)', v: ageText(C.retire) }, { label: 'שכר ברוטו חודשי היום (קלט שלך)', v: ils(C.salary) },
    { label: 'עליית שכר בשנה, נומינלי (הנחה)', v: pc(C.growth, 1) }, { label: 'שיעור הפקדה מהשכר (קלט שלך)', v: pc(C.rate, 1) },
    { label: retSrc === 'user' ? 'תשואה שנתית ברוטו (הנחה שלך)' : retSrc === 'cat' ? `תשואה שנתית ברוטו: ${cat}, 10Y (הנחה: העבר כאומדן)` : retSrc === 'safe' ? 'תשואה שנתית ברוטו (הנחה שמרנית)' : 'תשואה שנתית ברוטו (הנחת ברירת מחדל)', v: pc(C.ret), src: retSrc === 'cat' ? retProv : undefined },
    { label: 'אינפלציה בשנה (הנחה)', v: pc(C.infl, 1) }, { label: 'יתרה היום (קלט שלך)', v: ils(C.start) }, { label: 'מקדם המרה לקצבה (הנחה)', v: nf(C.coef, 0) },
  ];
  function retProv(): Prov {
    const ms = c!.p.slice(-120);
    return { k: 'calc', title: `תשואה שנתית ברוטו, 10Y · ${cat}`, value: pc(cat10), formula: '((1 + r₁) × … × (1 + r₁₂₀)) בחזקת 12 ÷ 120, פחות 1, על ממוצע הקטגוריה המשוקלל בנכסים של כל חודש (ברוטו, לפני דמי ניהול; דמי הניהול מנוכים במחשבון)',
      note: 'הנחה: תשואת העבר של הקטגוריה כאומדן לעתיד. אינה תחזית',
      inputs: ms.map((p, i) => ({ label: `ממוצע הקטגוריה · ${ym(p)}`, v: pc(c!.y[c!.y.length - 120 + i]) })) };
  }
  const pairInputs = (f: FeePair, who: string) => [{ label: `${who}: דמי ניהול מהפקדה`, v: pc(f.depfee) }, { label: `${who}: דמי ניהול מצבירה, שנתי`, v: pc(f.fee) }];
  const F = 'כל חודש: הפקדה = שכר × שיעור ההפקדה (השכר עולה כל 12 חודשים); דמי הניהול מהפקדה יורדים מההפקדה; היתרה גדלה ב-(1 + תשואה שנתית)^(1/12) − 1; דמי הניהול מצבירה (שנתי ÷ 12) יורדים מהיתרה בסוף החודש';
  const outProv = (o: CareerOut, f: FeePair, who: string, what: 'bal' | 'balReal' | 'fees' | 'feesReal' | 'pensionReal'): Prov => {
    const v = o[what], T: Record<typeof what, string> = { bal: 'יתרה בפרישה, נומינלי', balReal: 'יתרה בפרישה, בשקלי היום', fees: 'סך דמי הניהול, נומינלי', feesReal: 'סך דמי הניהול, בשקלי היום', pensionReal: 'קצבה חודשית, בשקלי היום' };
    const extra = what === 'balReal' || what === 'feesReal' || what === 'pensionReal' ? ' בשקלי היום: חלקי (1 + אינפלציה)^(חודשים ÷ 12).' : '';
    return { k: 'calc', est: true, title: `${T[what]} · ${who}`, value: ils(v), formula: `${F}.${extra}${what.startsWith('pension') ? ' קצבה = יתרה ÷ מקדם ההמרה.' : ''}${what.startsWith('fees') ? ' סך = דמי ניהול מהפקדה + מצבירה, על כל החודשים.' : ''}`,
      note: 'הנחות, לא תחזית: התשואה, השכר, האינפלציה ומקדם ההמרה. מקדם בפועל תלוי בגיל, במין ובתקנון', inputs: [...assumptions(), ...pairInputs(f, who), { label: 'חודשים עד הפרישה', v: nf(o.months, 0) }] };
  };
  const diffProv = (what: 'bal' | 'balReal' | 'fees' | 'feesReal' | 'pensionReal'): Prov => ({ k: 'calc', est: true, title: `ההפרש: ${LB} מול ${LA}`, value: ils(ob[what] - oa[what]), formula: `${LB} פחות ${LA}`, inputs: [{ label: LA, v: ils(oa[what]), src: () => outProv(oa, A, LA, what) }, { label: LB, v: ils(ob[what]), src: () => outProv(ob, B, LB, what) }] });
  const feeP = (f: FundX, which: 'fee' | 'depfee') => () => fundP(refOf(f), asof, which === 'fee' ? 'AVG_ANNUAL_MANAGEMENT_FEE' : 'AVG_DEPOSIT_FEE', which === 'fee' ? 'דמי ניהול מצבירה' : 'דמי ניהול מהפקדה', pc(f[which]));
  const medFee = median(members.map((f) => f.fee!)), medDep = median(members.map((f) => f.depfee).filter((v): v is number => v != null));

  /* ---- presets for a pair ---- */
  type Pre = { label: string; p: FeePair; src?: () => Prov };
  const presets: Pre[] = [
    ...(mine ? [{ label: `המסלול: ${mine.grp}`, p: { depfee: mine.depfee ?? 0, fee: mine.fee! } }] : []),
    ...(cheap ? [{ label: `הזול בקטגוריה: ${cheap.grp}`, p: { depfee: cheap.depfee ?? 0, fee: cheap.fee! } }] : []),
    ...(medFee != null && medDep != null ? [{ label: 'חציון הקטגוריה', p: { depfee: medDep, fee: medFee } }] : []),
    ...(tender && tp?.fee != null && tp.depfee != null ? [{ label: `מחיר מכרז ברירת המחדל ${tender.id}${tender.verified ? '' : ' (לא אומת)'}`, p: { depfee: tp.depfee, fee: tp.fee } }] : []),
    ...(dfile?.caps?.[prod.startsWith('פנסיה') ? 'pension' : 'gemel'] ? [(() => { const cp = dfile.caps![prod.startsWith('פנסיה') ? 'pension' : 'gemel']!; return { label: `התקרה החוקית${cp.verified ? '' : ' (לא אומת)'}`, p: { depfee: cp.depfee, fee: cp.fee } }; })()] : []),
  ];
  const PairBox = ({ who, f, o, keys, color }: { who: string; f: FeePair; o: CareerOut; keys: [string, string]; color: string }) => (
    <div className="fpair">
      <h3><span className="sw" style={{ background: color }} aria-hidden="true" />{who}</h3>
      <div className="fform">
        <label><span>מהפקדה, % <Tip k="depfee" /></span><input type="number" inputMode="decimal" step={0.05} min={0} max={cap.depfee} value={sp.get(keys[0]) ?? f.depfee} aria-invalid={!!errOf(keys[0], 'depfee')} onChange={(e) => set({ [keys[0]]: e.target.value })} /></label>
        <label><span>מצבירה, % שנתי <Tip k="fee" /></span><input type="number" inputMode="decimal" step={0.01} min={0} max={cap.fee} value={sp.get(keys[1]) ?? f.fee} aria-invalid={!!errOf(keys[1], 'fee')} onChange={(e) => set({ [keys[1]]: e.target.value })} /></label>
      </div>
      {[errOf(keys[0], 'depfee'), errOf(keys[1], 'fee')].filter(Boolean).map((t) => <p key={t} className="ferr" role="alert">{t} {cap.legal && <a href={KZ_CAPS} target="_blank" rel="noreferrer">כל זכות</a>}</p>)}
      <div className="fpresets">{presets.map((x) => <button key={x.label} type="button" className="chip" aria-pressed={x.p.depfee === f.depfee && x.p.fee === f.fee} onClick={() => set({ [keys[0]]: String(x.p.depfee), [keys[1]]: String(x.p.fee) })}>{x.label} · {nf(x.p.depfee, 2)}% / {nf(x.p.fee, 2)}%</button>)}</div>
      <div className="muted">קצבה חודשית בשקלי היום: <Sourced src={() => outProv(o, f, who, 'pensionReal')}><b className="num">{ils(o.pensionReal)}</b></Sourced></div>
    </div>
  );

  // the grid's colour: share of the way from the worst cell to the best
  const flat = grid.flat().map((o) => o.pensionReal), gmin = Math.min(...flat), gmax = Math.max(...flat);
  const tone = (v: number) => { const t = gmax > gmin ? (v - gmin) / (gmax - gmin) : 1; return `color-mix(in oklch, var(--down) ${Math.round((1 - t) * 42)}%, var(--panel))`; };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const read = tenth.pensionReal - oa.pensionReal;
  // every open track when they fit (the header counts what the table shows), else the cheapest TOP_N and the reader's own
  const rowsT = members.length <= ALL_MAX ? members : [...members.slice(0, TOP_N), ...(mine && !members.slice(0, TOP_N).includes(mine) ? [mine] : [])];

  /* ---- W5: the answer first (saver door and no door): what the cheapest track would change, in a sentence ---- */
  const bDefault = sp.get('db') == null && sp.get('fb') == null;
  const dPen = ob.pensionReal - oa.pensionReal, dBal = ob.balReal - oa.balReal, dFees = oa.feesReal - ob.feesReal;
  const answer = saver && cheap && mine ? (
    <section className="panel ffees-ans" aria-label="התשובה בקצרה">
      <p className="fans-big">{bDefault && cheap.k === mine.k ? <>המסלול {own ? 'שלך' : 'שבחרת'} הוא הזול בקטגוריה ({cat}).</>
        : Math.abs(dPen) < 10 ? <>בהנחות האלה, {bDefault ? `המסלול הזול בקטגוריה (${cheap.name})` : 'דמי הניהול להשוואה'} כמעט לא משנה את הקצבה.</>
        : <>{bDefault ? <>במסלול הזול בקטגוריה, <Link to={`/funds/${cheap.k}`}>{cheap.name}</Link>,</> : 'עם דמי הניהול להשוואה'} הקצבה הייתה <Sourced src={() => diffProv('pensionReal')}><b className="num">{dPen > 0 ? 'גבוהה' : 'נמוכה'} בכ-{ilsRound(Math.abs(dPen))}</b></Sourced> לחודש, ויהיו <Sourced src={() => diffProv('balReal')}><b className="num">כ-{ilsRound(Math.abs(dBal))}</b></Sourced> {dBal > 0 ? 'יותר' : 'פחות'} בחיסכון בגיל הפרישה ({ageText(C.retire)}).</>}</p>
      {!(bDefault && cheap.k === mine.k) && Math.abs(dPen) >= 10 && <p className="muted">{dFees > 0 ? <>עם דמי הניהול {own ? 'שלך' : 'של המסלול'} ({pc(A.depfee)} מהפקדה, {pc(A.fee)} מצבירה) {sex === 'f' ? 'תשלמי' : sex === 'm' ? 'תשלם' : 'תשלמו'} <b className="num">כ-{ilsRound(dFees)}</b> יותר בדמי ניהול עד הפרישה. </> : null}בשקלי היום, על הנחות: תשואה {pc(C.ret)} ברוטו בשנה, {saver && sp.get('age') == null && ageS == null ? 'גיל 38 לדוגמה' : `גיל ${nf(C.age, 0)}`}, שכר {ils(C.salary)}. ההנחות למטה, ואפשר לשנות.</p>}
      <p className="fans-note">{own && bDefault && cheap.k !== mine.k ? <>ההשוואה כאן: מול הממוצע בפועל במסלול הזול בקטגוריה. <Link to="/my/checkup">בבדיקה השנתית</Link> העוגן הוא {prod.startsWith('פנסיה') ? 'מחיר קרנות ברירת המחדל, המחיר שהמכתב מבקש' : 'חציון הממוצע בפועל בקטגוריה'}, ולכן הסכום שם שונה. </> : null}{own ? <>לפי המוצר והנתונים שלך מ<Link to="/my">"המוצרים שלי"</Link>.</> : ownF ? <>לפי המוצר הראשון ב<Link to="/my">"המוצרים שלי"</Link>, עם דמי הניהול הממוצעים במסלול.</> : <>לפי המסלול הגדול בקטגוריה, עם דמי הניהול הממוצעים בו. את המוצר שלך מוסיפים ב<Link to="/my">"המוצרים שלי"</Link>.</>} אין כאן המלצה לעבור.</p>
    </section>
  ) : null;

  return (
    <>
      <FundsHead title="דמי ניהול לאורך קריירה" sub={<>כמה עולים דמי ניהול עד הפרישה · מחשבון על הנחות, עם דמי הניהול של מסלולים אמיתיים · נתונים עד {ym(asof)}</>} />
      {!saver && <ToolLinks />}
      {answer}

      <Assumptions fold={saver}>
      <Panel title="ההנחות" aside={<span className="chip est">הנחות וקלט שלך · לא נשלח</span>}>
        <div className="fform">
          <label><span>גיל היום</span><input type="number" inputMode="numeric" min={15} max={80} value={C.age} onChange={(e) => set({ age: e.target.value })} /></label>
          <label><span>גיל פרישה</span><input type="number" inputMode="numeric" min={40} max={80} value={C.retire} onChange={(e) => set({ ra: e.target.value })} /></label>
          <label><span>שכר ברוטו לחודש, ש"ח</span><input type="number" inputMode="decimal" step={500} min={0} value={C.salary} onChange={(e) => set({ sal: e.target.value })} /></label>
          <label><span>עליית שכר בשנה, %</span><input type="number" inputMode="decimal" step={0.5} value={C.growth} onChange={(e) => set({ g: e.target.value })} /></label>
          <label><span>הפקדה מהשכר, %</span><input type="number" inputMode="decimal" step={0.5} min={0} value={C.rate} onChange={(e) => set({ rate: e.target.value })} /></label>
          <label><span>יתרה היום, ש"ח</span><input type="number" inputMode="decimal" step={1000} min={0} value={C.start} onChange={(e) => set({ b0: e.target.value })} /></label>
          <label><span>תשואה שנתית ברוטו, % (הנחה)</span><input type="number" inputMode="decimal" step={0.25} value={C.ret} onChange={(e) => set({ r: e.target.value })} /></label>
          <label><span>אינפלציה בשנה, % (הנחה)</span><input type="number" inputMode="decimal" step={0.25} value={C.infl} onChange={(e) => set({ inf: e.target.value })} /></label>
          <label><span>מקדם המרה (הנחה)</span><input type="number" inputMode="decimal" step={5} min={50} value={C.coef} onChange={(e) => set({ coef: e.target.value })} /></label>
          <label><span>מוצר</span><select value={prod} onChange={(e) => { const p = e.target.value; const t = [...catList.keys()].filter((k) => k.startsWith(p + ' | ')).sort((a, b) => catList.get(b)! - catList.get(a)!)[0]; set({ cat: t ?? null, k: null, da: null, fa: null, db: null, fb: null, r: null }); }}>{prods.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          <label><span>מסלול (קטגוריה)</span><select value={track} onChange={(e) => set({ cat: `${prod} | ${e.target.value}`, k: null, da: null, fa: null, db: null, fb: null, r: null })}>{tracks.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label><span>המסלול שלך</span><select value={mine?.k ?? ''} onChange={(e) => set({ k: e.target.value, da: null, fa: null })}>{members.map((f) => <option key={f.k} value={f.k}>{f.name}</option>)}</select></label>
        </div>
        <div className="fprivacy">
          {saver && ownF && <>בדלת החוסך: {own ? <>המסלול, היתרה{own.monthly != null ? ', השכר (נגזר מההפקדה החודשית שהזנת)' : ''} ודמי הניהול שלך מ<Link to="/my">"המוצרים שלי"</Link>. </> : <>הקטגוריה של המוצר הראשון ב<Link to="/my">"המוצרים שלי"</Link>. </>}</>}
          תשואה: {retSrc === 'safe' ? <>הנחה שמרנית של {pc(RET_FALLBACK)} ברוטו בשנה. {cat10 != null && !(mine && singleIndex(mine)) && <button type="button" className="linkbtn" onClick={() => set({ r: cat10.toFixed(2) })}>תשואת העבר של הקטגוריה ב-10 שנים, לא תחזית ({pc(cat10)})</button>} </> : retSrc === 'user' ? 'ההנחה שלך. ' : retSrc === 'cat' ? <>ממוצע הקטגוריה ב-10 השנים האחרונות, <Sourced src={retProv}>{pc(cat10)}</Sourced> ברוטו (תשואת עבר כהנחה, לא תחזית). </> : 'אין לקטגוריה 10 שנים מלאות: הנחת ברירת מחדל 4%. '}
          {retSrc === 'user' && (saver ? <button type="button" className="linkbtn" onClick={() => set({ r: null })}>חזרה להנחה השמרנית ({pc(RET_FALLBACK)})</button> : cat10 != null && <button type="button" className="linkbtn" onClick={() => set({ r: null })}>חזרה לממוצע הקטגוריה ({pc(cat10)})</button>)}
          {' '}אינפלציה: {BOI}. מקדם המרה {nf(C.coef, 0)}: {saver && sex != null && sp.get('coef') == null ? coefOf(sex).why : 'הנחה עגולה'}; המקדם בפועל תלוי בגיל, במין, במסלול הקצבה ובתקנון. החישוב רץ בדפדפן ולא נשלח.
        </div>
      </Panel>
      </Assumptions>

      <div className="fpairs">
        <PairBox who={LA} f={A} o={oa} keys={['da', 'fa']} color="var(--warn)" />
        <PairBox who={LB} f={B} o={ob} keys={['db', 'fb']} color="var(--accent)" />
      </div>

      <Panel title="בפרישה" aside={<span className="chip est">הנחות · גיל {nf(C.retire, 0)}</span>}>
        <p className="fread"><Sourced src={() => ({ k: 'calc', est: true, title: '0.1% נוסף מהצבירה, בקצבה החודשית', value: ils(read), formula: `הקצבה בשקלי היום עם ${LA} ועוד 0.1 מהצבירה, פחות הקצבה עם ${LA}`, inputs: [{ label: LA, v: ils(oa.pensionReal), src: () => outProv(oa, A, LA, 'pensionReal') }, { label: `${LA} + 0.1% מצבירה`, v: ils(tenth.pensionReal), src: () => outProv(tenth, { ...A, fee: A.fee + 0.1 }, `${LA} + 0.1%`, 'pensionReal') }] })}><b className="num">0.1%</b></Sourced> נוסף מהצבירה = <b className="num">{ils(Math.abs(read))}</b> לחודש בקצבה, בשקלי היום.</p>
        <div className="scroll"><table className="fsimple fcards">
          <caption className="sr-only">{LA} מול {LB} בפרישה</caption>
          <thead><tr><th scope="col">בפרישה</th><th scope="col">{LA}</th><th scope="col">{LB}</th><th scope="col">ההפרש</th></tr></thead>
          <tbody>{([['יתרה, בשקלי היום', 'balReal'], ['סך דמי ניהול, בשקלי היום', 'feesReal'], ['קצבה חודשית, בשקלי היום', 'pensionReal']] as const).map(([l, w]) => (
            <tr key={w}><th scope="row">{l}</th>
              <td data-label={LA}><Sourced src={() => outProv(oa, A, LA, w)}><span className="num">{ils(oa[w])}</span></Sourced></td>
              <td data-label={LB}><Sourced src={() => outProv(ob, B, LB, w)}><span className="num">{ils(ob[w])}</span></Sourced></td>
              <td data-label="ההפרש"><Sourced src={() => diffProv(w)}><span className={`num ${(ob[w] - oa[w]) * (w.startsWith('fees') ? -1 : 1) >= 0 ? 'pos' : 'neg'}`}>{ob[w] - oa[w] >= 0 ? '+' : '−'}{nf(Math.abs(ob[w] - oa[w]), 0)}</span></Sourced></td></tr>))}</tbody>
        </table></div>
        <div className="fnote">סך ההפקדות: <span className="num">{ils(oa.dep)}</span> על פני <span className="num">{nf(oa.months, 0)}</span> חודשים. ההפקדה מחושבת על כל השכר שהוקלד; בפועל ההפקדה לפנסיה מוגבלת בתקרות.</div>
      </Panel>

      {/* W6 doors (saver red team 02.11.26): the nominal rows and the 6×6 grid are the professional's; the saver and a visitor with no
          door see the real-₪ rows and the answer above. Agent and Pro open them here. */}
      {!saver && <details className="ffees-pro">
        <summary>נומינלי ורגישות: יתרה ודמי ניהול במונחים נומינליים, ורשת דמי ניהול מהפקדה × מצבירה</summary>
        <Panel title="בפרישה, נומינלי" aside={<span className="chip est">הנחות · לפני ניכוי אינפלציה</span>}>
          <div className="scroll"><table className="fsimple fcards">
            <caption className="sr-only">{LA} מול {LB} בפרישה, נומינלי</caption>
            <thead><tr><th scope="col">בפרישה</th><th scope="col">{LA}</th><th scope="col">{LB}</th><th scope="col">ההפרש</th></tr></thead>
            <tbody>{([['יתרה, נומינלי', 'bal'], ['סך דמי ניהול, נומינלי', 'fees']] as const).map(([l, w]) => (
              <tr key={w}><th scope="row">{l}</th>
                <td data-label={LA}><Sourced src={() => outProv(oa, A, LA, w)}><span className="num">{ils(oa[w])}</span></Sourced></td>
                <td data-label={LB}><Sourced src={() => outProv(ob, B, LB, w)}><span className="num">{ils(ob[w])}</span></Sourced></td>
                <td data-label="ההפרש"><Sourced src={() => diffProv(w)}><span className={`num ${(ob[w] - oa[w]) * (w === 'fees' ? -1 : 1) >= 0 ? 'pos' : 'neg'}`}>{ob[w] - oa[w] >= 0 ? '+' : '−'}{nf(Math.abs(ob[w] - oa[w]), 0)}</span></Sourced></td></tr>))}</tbody>
          </table></div>
        </Panel>
        <Panel title="רגישות: דמי ניהול מהפקדה × מצבירה" aside={<span>קצבה חודשית בשקלי היום</span>}>
        <div className="scroll"><table className="fgrid">
          <caption className="sr-only">קצבה חודשית לפי דמי ניהול מהפקדה (שורות) ומצבירה (עמודות)</caption>
          <thead><tr><th scope="col"><span className="fgrid-c">מהפקדה ↓ מצבירה ←</span></th>{ACCS.map((a) => <th key={a} scope="col" className="num">{nf(a, 2)}%</th>)}</tr></thead>
          <tbody>{DEPS.map((dd, i) => <tr key={dd}><th scope="row" className="num">{nf(dd, 1)}%</th>{ACCS.map((a, j) => { const o = grid[i][j]; const hit = (near(dd, A.depfee) && near(a, A.fee)) || (near(dd, B.depfee) && near(a, B.fee));
            return <td key={a} className={hit ? 'hit' : undefined} style={{ background: tone(o.pensionReal) }}><Sourced src={() => outProv(o, { depfee: dd, fee: a }, `${nf(dd, 1)}% / ${nf(a, 2)}%`, 'pensionReal')}><span className="num">{nf(o.pensionReal, 0)}</span></Sourced></td>; })}</tr>)}</tbody>
        </table></div>
        <div className="fnote">כל תא: אותן הנחות, דמי ניהול אחרים. ככל שהתא כהה יותר, הקצבה נמוכה יותר. תא ממוסגר = אחד משני צמדי דמי הניהול למעלה.</div>
        </Panel>

      </details>}

      <Panel title={<>{own ? 'דמי הניהול שלך' : 'המסלול שנבחר'} מול הזול בקטגוריה · {cat}</>} aside={<span>{rowsT.length === members.length ? `${members.length} מסלולים פתוחים` : `${TOP_N} הזולים מתוך ${members.length} מסלולים פתוחים${mine && !members.slice(0, TOP_N).includes(mine) ? `, ועוד ${own ? 'שלך' : 'המסלול שנבחר'}` : ''}`} · {ym(asof)}</span>}>
        <div className="scroll"><table className="fsimple fcards">
          <caption className="sr-only">דמי ניהול בקטגוריה והקצבה בהנחות למעלה</caption>
          <thead><tr><th scope="col">מסלול</th><th scope="col">מהפקדה</th><th scope="col">מצבירה</th><th scope="col">קצבה, שקלי היום</th><th scope="col">{own ? 'מול שלך' : 'מול שנבחר'}</th></tr></thead>
          <tbody>{rowsT.map((f) => { const p = pairOf(f), o = career(C, p), base = mine ? career(C, pairOf(mine)) : null;
            return <tr key={f.k} className={f === mine ? 'fme' : undefined}><td><Link to={`/funds/${f.k}`}>{f.name}</Link>{f === cheap && <span className="chip">הזול</span>}{f === mine && <span className="chip">{own ? 'שלך' : ownF || sp.get('k') ? 'שנבחר' : 'לדוגמה: הגדול בקטגוריה'}</span>}</td>
              <td data-label="מהפקדה">{ownRow(f) ? <span className="num">{pc(p.depfee)}<span className="dim"> שלך</span></span> : <Sourced src={feeP(f, 'depfee')}><span className="num">{pc(f.depfee)}</span></Sourced>}</td><td data-label="מצבירה">{ownRow(f) ? <span className="num">{pc(p.fee)}<span className="dim"> שלך</span></span> : <Sourced src={feeP(f, 'fee')}><span className="num">{pc(f.fee)}</span></Sourced>}</td>
              <td data-label="קצבה, שקלי היום"><Sourced src={() => ({ ...outProv(o, p, f.name, 'pensionReal'), inputs: [...assumptions(), ...(ownRow(f) ? pairInputs(p, 'שלך') : [{ label: 'דמי ניהול מהפקדה', v: pc(f.depfee), src: feeP(f, 'depfee') }, { label: 'דמי ניהול מצבירה', v: pc(f.fee), src: feeP(f, 'fee') }])] })}><span className="num">{ils(o.pensionReal)}</span></Sourced></td>
              <td data-label={own ? 'מול שלך' : 'מול שנבחר'}>{base ? <span className={`num ${o.pensionReal >= base.pensionReal ? 'pos' : 'neg'}`}>{o.pensionReal >= base.pensionReal ? '+' : '−'}{nf(Math.abs(o.pensionReal - base.pensionReal), 0)}</span> : '–'}</td></tr>; })}</tbody>
        </table></div>
        <div className="fnote">דמי הניהול: הממוצע בפועל של כל מסלול ב-{ym(asof)}, מנתוני רשות שוק ההון{own && ownRow(mine!) ? '; בשורה שלך, דמי הניהול שהזנת' : ''}. חוסך מסוים משלם את מה שסיכם; עמית חדש בקרן ברירת מחדל משלם את מחיר המכרז. ממוין מהזול. {mine && <>מהלך: <Link to={`/funds/compare?k=${[mine.k, cheap?.k].filter(Boolean).join(',')}`}>{own ? 'השוואת המסלול שלך לזול' : 'השוואת המסלול שנבחר לזול'}</Link>.</>}</div>
      </Panel>
    </>
  );
}

/** W5: the assumptions panel, folded under the answer in the saver door (and for a visitor with no door); open as it was elsewhere */
function Assumptions({ fold, children }: { fold: boolean; children: React.ReactNode }) {
  if (!fold) return <>{children}</>;
  return <details className="ffees-assume"><summary>ההנחות והקלט: גיל, שכר, תשואה, מוצר ומסלול</summary>{children}</details>;
}
