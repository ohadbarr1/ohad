import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../../components/Source';
import { Tip } from '../../components/Explain';
import { Panel } from '../../components/ui';
import { DeeperSheet } from '../../components/DeeperSheet';
import { Takeaway } from '../../components/Takeaway';
import { NumText } from '../../components/NumText';
import { fundP } from '../../lib/market';
import type { Prov } from '../../lib/prov';
import { nf } from '../../lib/format';
import { refOf, ym, type CatX, type FundX } from '../../lib/funds';
import { annualised, career, feeGrid, median, type Career, type CareerOut, type FeePair } from '../../lib/fundsCalc';
import { priceOf, tendersOf, tenderAt, type DefaultFile } from '../../lib/fundsTools';
import { numQ } from '../../lib/fundsLoad';
import type { MyProduct } from '../../lib/mine';
import { AGE_DEFAULT, BALANCE_EX, RETIRE_AGE, RET_FALLBACK, ageText, coefOf, exampleMonthly, type Sex } from '../../lib/retire';
import { capOf, feeError, KZ_CAPS } from '../../lib/feeCaps';
import { singleIndex } from '../../lib/verdict';
import type { CareerAssume } from '../../lib/pageMonths';
import {
  AFTER_RETIRE, AGE_ASK, AGE_CHOICES, AGE_MINE, AGE_OTHER, ageExample, retDeposits, retTakeaway, sensTakeaway,
} from '../../lib/pageWords';

/* The career side of the fees tool (rollout spec §7.2 lenses, §7.5 "must not be lost", §16.1 2d, §17.1 #5; T-F2, T-F3):
   - `feeModel`: today's calculator (salary path, deposit rate, a gross return assumption with its three sources, two fee pairs with
     preset chips, career() and the 6×6 grid), moved here from pages/FundsFees.tsx with its sources and address parameters unchanged
     (age, ra, sal, g, rate, r, inf, b0, coef, da, fa, db, fb, k). Defaults follow mockup v4 in every door: age 38 unless the reader's,
     retirement 67 (the saver's statutory age when known), a 4% gross return (the category's 10-year past one tap away), the
     balance and deposit from the reader's amounts (lib/myAmounts), else the example (100,000 ₪ and the product's example deposit).
   - `AgeStep`: "עד הפרישה" asks for the age before it shows anything (saver; #age-ask).
   - `AssumeSheet`: "ההנחות ›" = today's assumptions panel in a sheet, with the legal lines.
   - `SensLens` / `RetLens` (agent, Pro): today's grid, "בפרישה" (today's shekels and nominal), the two fee pairs and "המסלול שנבחר מול
     הזול בקטגוריה". */

const ils = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 0)} ש"ח`);
const pc = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${nf(v, d)}%`);
const DEPS = [0, 1, 2, 3, 4, 6], ACCS = [0.1, 0.2, 0.3, 0.5, 0.75, 1.05];
const ALL_MAX = 12, TOP_N = 10;
const BOI = 'הנחה. יעד האינפלציה של בנק ישראל: 1%–3% בשנה';
/** the old address parameters of the calculator: a link with any of them opens on "בפרישה" (agent, Pro) or "עד הפרישה" (saver) */
export const CALC_PARAMS = ['age', 'ra', 'sal', 'g', 'rate', 'r', 'inf', 'b0', 'coef', 'da', 'fa', 'db', 'fb'];
/** `age=ex`: the reader chose "להראות על דוגמה (גיל 38)" (the example's age, not the reader's) */
export const AGE_EX = 'ex';
/** The lens a fees address opens on (§7.5): `v` when the door has it; else a link with any of today's calculator inputs opens on
 *  "בפרישה" (agent, Pro) or "עד הפרישה" (saver); else "בשנה". */
export function feesLensOf(sp: URLSearchParams, ids: string[], saver: boolean): string {
  const v = sp.get('v');
  if (v && ids.includes(v)) return v;
  return CALC_PARAMS.some((p) => sp.get(p) != null) ? (saver ? 'career' : 'ret') : 'rank';
}

export interface FeeModelIn {
  sp: URLSearchParams;
  saver: boolean;
  cat: string;
  prod: string;
  asof: number;
  /** the type's open tracks with a published fee, not self-managed (today's `members`), cheapest first */
  members: FundX[];
  cats?: Record<string, CatX>;
  dfile?: DefaultFile | null;
  /** the reader's saved product of this type (saver), for its own fee pair (O9) */
  own?: MyProduct;
  /** the stored age (saver), the sex, the retirement age (lib/mine useRetire) */
  ageS: number | null;
  sex: Sex | null;
  retire: { v: number; why: string; own: boolean };
  /** the amounts of the product on screen (lib/myAmounts): balance null = the example */
  balance: number | null;
  monthly: number | null;
}

export type FeeModel = ReturnType<typeof feeModel>;

export function feeModel(m: FeeModelIn) {
  const { sp, saver, cat, prod, asof, members, cats, dfile, own, ageS, sex } = m;
  const mine = members.find((f) => f.k === (sp.get('k') ?? own?.k ?? null)) ?? [...members].sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0))[0];
  const ownT = own && mine?.k === own.k ? own : undefined;  // the reader's own fees apply to their own track only
  const cheap = members[0];
  const pairOf = (f: FundX): FeePair => (ownT && f.k === ownT.k ? { depfee: ownT.depfee ?? f.depfee ?? 0, fee: ownT.fee ?? f.fee! } : { depfee: f.depfee ?? 0, fee: f.fee! });
  const ownRow = (f: FundX) => !!ownT && f.k === ownT.k && (ownT.fee != null || ownT.depfee != null);
  const LA = ownT ? 'דמי הניהול שלך' : 'המסלול שנבחר', LB = 'דמי ניהול להשוואה';

  // the return assumption: the reader's, else a conservative 4% (mockup v4, every door); the category's 10-year gross one tap away
  const c = cats?.[cat];
  const cat10 = c ? annualised(c.y, 120) : null;
  const retQ = sp.get('r');
  const ret = numQ(retQ, RET_FALLBACK, -10, 30);
  const retSrc: 'user' | 'safe' = retQ != null && retQ !== '' ? 'user' : 'safe';
  const rate = numQ(sp.get('rate'), 18.5, 0, 100);
  const dep0 = m.monthly ?? exampleMonthly(prod).v;
  const salary0 = rate > 0 ? Math.round(dep0 / (rate / 100) / 10) * 10 : 12000;
  const ageQ = sp.get('age');
  const ageEx = ageQ === AGE_EX;
  const C: Career = {
    age: numQ(ageEx ? null : ageQ, saver && ageS != null ? ageS : AGE_DEFAULT, 15, 80), retire: numQ(sp.get('ra'), saver ? m.retire.v : RETIRE_AGE, 40, 80),
    salary: numQ(sp.get('sal'), salary0, 0, 1e7), growth: numQ(sp.get('g'), 2, -10, 20), rate, ret, infl: numQ(sp.get('inf'), 2, -5, 20),
    start: numQ(sp.get('b0'), m.balance ?? BALANCE_EX, 0, 1e9), coef: numQ(sp.get('coef'), saver ? coefOf(sex).v : 200, 50, 500),
  };
  /** is the age the reader's (typed, stored or in the address), or the example's? */
  const ageOwn = !ageEx && ((ageQ != null && ageQ !== '') || (saver && ageS != null));
  const cap = capOf(prod);
  const ts = tendersOf(dfile ?? undefined), tender = asof ? tenderAt(ts, asof) : null;
  const tp = tender ? priceOf(tender) : null;
  const A: FeePair = { depfee: numQ(sp.get('da'), ownT?.depfee ?? mine?.depfee ?? 1.5, 0, cap.depfee), fee: numQ(sp.get('fa'), ownT?.fee ?? mine?.fee ?? 0.2, 0, cap.fee) };
  const B: FeePair = { depfee: numQ(sp.get('db'), cheap?.depfee ?? 1, 0, cap.depfee), fee: numQ(sp.get('fb'), cheap?.fee ?? 0.1, 0, cap.fee) };
  const errOf = (k: string, w: 'fee' | 'depfee') => feeError(prod, w, sp.get(k) == null || sp.get(k) === '' ? null : Number(sp.get(k)), true);
  /** the "עד הפרישה" board's assumptions: the same as the calculator's, so every lens agrees */
  const assume: CareerAssume = { age: C.age, retire: C.retire, ret: C.ret, infl: C.infl, growth: C.growth, coef: C.coef };

  /* ---- sources ---- */
  const assumptions = () => [
    { label: ageEx ? 'גיל היום (לדוגמה)' : saver && ageQ == null ? (ageS != null ? 'גיל היום (שלך, מ"המוצרים שלי")' : 'גיל היום (לדוגמה)') : 'גיל היום (קלט שלך)', v: nf(C.age, 0) },
    { label: saver && sp.get('ra') == null ? `גיל פרישה (${m.retire.own ? 'שלך, מ"המוצרים שלי"' : m.retire.why})` : 'גיל פרישה (קלט שלך)', v: ageText(C.retire) }, { label: 'שכר ברוטו חודשי היום (קלט שלך)', v: ils(C.salary) },
    { label: 'עליית שכר בשנה, נומינלי (הנחה)', v: pc(C.growth, 1) }, { label: 'שיעור הפקדה מהשכר (קלט שלך)', v: pc(C.rate, 1) },
    { label: retSrc === 'user' ? 'תשואה שנתית ברוטו (הנחה שלך)' : 'תשואה שנתית ברוטו (הנחה שמרנית)', v: pc(C.ret) },
    { label: 'אינפלציה בשנה (הנחה)', v: pc(C.infl, 1) }, { label: m.balance != null && sp.get('b0') == null ? 'יתרה היום (שלך)' : sp.get('b0') == null ? 'יתרה היום (לדוגמה)' : 'יתרה היום (קלט שלך)', v: ils(C.start) }, { label: 'מקדם המרה לקצבה (הנחה)', v: nf(C.coef, 0) },
  ];
  const retProv = (): Prov => {
    const ms = c!.p.slice(-120);
    return { k: 'calc', title: `תשואה שנתית ברוטו, 10Y · ${cat}`, value: pc(cat10), formula: '((1 + r₁) × … × (1 + r₁₂₀)) בחזקת 12 ÷ 120, פחות 1, על ממוצע הקטגוריה המשוקלל בנכסים של כל חודש (ברוטו, לפני דמי ניהול; דמי הניהול מנוכים במחשבון)',
      note: 'הנחה: תשואת העבר של הקטגוריה כאומדן לעתיד. אינה תחזית',
      inputs: ms.map((p, i) => ({ label: `ממוצע הקטגוריה · ${ym(p)}`, v: pc(c!.y[c!.y.length - 120 + i]) })) };
  };
  const pairInputs = (f: FeePair, who: string) => [{ label: `${who}: דמי ניהול מהפקדה`, v: pc(f.depfee) }, { label: `${who}: דמי ניהול מצבירה, שנתי`, v: pc(f.fee) }];
  const F = 'כל חודש: הפקדה = שכר × שיעור ההפקדה (השכר עולה כל 12 חודשים); דמי הניהול מהפקדה יורדים מההפקדה; היתרה גדלה ב-(1 + תשואה שנתית)^(1/12) − 1; דמי הניהול מצבירה (שנתי ÷ 12) יורדים מהיתרה בסוף החודש';
  type W = 'bal' | 'balReal' | 'fees' | 'feesReal' | 'pensionReal' | 'pension';
  const outProv = (o: CareerOut, f: FeePair, who: string, what: W): Prov => {
    const v = o[what], T: Record<W, string> = { bal: 'יתרה בפרישה, נומינלי', balReal: 'יתרה בפרישה, בשקלי היום', fees: 'סך דמי הניהול, נומינלי', feesReal: 'סך דמי הניהול, בשקלי היום', pensionReal: 'קצבה חודשית, בשקלי היום', pension: 'קצבה חודשית, נומינלי' };
    const extra = what === 'balReal' || what === 'feesReal' || what === 'pensionReal' ? ' בשקלי היום: חלקי (1 + אינפלציה)^(חודשים ÷ 12).' : '';
    return { k: 'calc', est: true, title: `${T[what]} · ${who}`, value: ils(v), formula: `${F}.${extra}${what.startsWith('pension') ? ' קצבה = יתרה ÷ מקדם ההמרה.' : ''}${what.startsWith('fees') ? ' סך = דמי ניהול מהפקדה + מצבירה, על כל החודשים.' : ''}`,
      note: 'הנחות, לא תחזית: התשואה, השכר, האינפלציה ומקדם ההמרה. מקדם בפועל תלוי בגיל, במין ובתקנון', inputs: [...assumptions(), ...pairInputs(f, who), { label: 'חודשים עד הפרישה', v: nf(o.months, 0) }] };
  };
  const feeP = (f: FundX, which: 'fee' | 'depfee') => () => fundP(refOf(f), asof, which === 'fee' ? 'AVG_ANNUAL_MANAGEMENT_FEE' : 'AVG_DEPOSIT_FEE', which === 'fee' ? 'דמי ניהול מצבירה' : 'דמי ניהול מהפקדה', pc(f[which]));
  const medFee = median(members.map((f) => f.fee!)), medDep = median(members.map((f) => f.depfee).filter((v): v is number => v != null));

  /* ---- presets for a pair ---- */
  type Pre = { label: string; p: FeePair };
  const presets: Pre[] = [
    ...(mine ? [{ label: `המסלול: ${mine.grp}`, p: { depfee: mine.depfee ?? 0, fee: mine.fee! } }] : []),
    ...(cheap ? [{ label: `הזול בקטגוריה: ${cheap.grp}`, p: { depfee: cheap.depfee ?? 0, fee: cheap.fee! } }] : []),
    ...(medFee != null && medDep != null ? [{ label: 'חציון הקטגוריה', p: { depfee: medDep, fee: medFee } }] : []),
    ...(tender && tp?.fee != null && tp.depfee != null ? [{ label: `מחיר מכרז ברירת המחדל ${tender.id}${tender.verified ? '' : ' (לא אומת)'}`, p: { depfee: tp.depfee, fee: tp.fee } }] : []),
    ...(dfile?.caps?.[prod.startsWith('פנסיה') ? 'pension' : 'gemel'] ? [(() => { const cp = dfile.caps![prod.startsWith('פנסיה') ? 'pension' : 'gemel']!; return { label: `התקרה החוקית${cp.verified ? '' : ' (לא אומת)'}`, p: { depfee: cp.depfee, fee: cp.fee } }; })()] : []),
  ];
  const coefWhy = saver && sex != null && sp.get('coef') == null ? coefOf(sex).why : 'הנחה עגולה';
  return { coefWhy, C, A, B, mine, cheap, ownT, pairOf, ownRow, LA, LB, cat10, retSrc, ageOwn, ageEx, cap, errOf, assume, assumptions, retProv, pairInputs, outProv, feeP, presets, members };
}

/** the career results of a model (memoised by the page; the 6×6 grid only when the sensitivity lens is open) */
export function useCareerOut(m: FeeModel, grid: boolean) {
  const key = JSON.stringify(m.C);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const g = useMemo(() => (grid ? feeGrid(m.C, DEPS, ACCS) : null), [key, grid]);
  const oa = career(m.C, m.A), ob = career(m.C, m.B), tenth = career(m.C, { ...m.A, fee: m.A.fee + 0.1 });
  return { oa, ob, tenth, grid: g };
}

/* ======================= the age step (saver, "עד הפרישה") ======================= */

export function AgeStep({ onAge, onOther, onExample }: { onAge: (a: number) => void; onOther: () => void; onExample: () => void }) {
  return (
    <>
      <Takeaway text={AGE_ASK} />
      <div className="fb-age" id="age-ask">
        <span>{AGE_MINE}</span>
        {AGE_CHOICES.map((a) => <button key={a} type="button" className="pk-chip" onClick={() => onAge(a)}><bdi dir="ltr">{a}</bdi></button>)}
        <button type="button" className="pk-chip" onClick={onOther} aria-haspopup="dialog">{AGE_OTHER}</button>
      </div>
      <button type="button" className="fb-hint" id="age-example" onClick={onExample}><span><NumText t={ageExample(AGE_DEFAULT)} /></span></button>
    </>
  );
}
export const AfterRetire = () => <Takeaway text={`${AFTER_RETIRE}.`} />;

/* ======================= "ההנחות ›": today's assumptions panel, in a sheet ======================= */

export interface AssumeProps {
  open: boolean; onClose: () => void;
  m: FeeModel; prod: string; cat: string;
  set: (patch: Record<string, string | null>) => void;
  /** the career lens: the balance and the deposit are the amounts (lib/myAmounts), changed in the amounts sheet */
  amountsLine?: ReactNode;
  onAmounts?: () => void;
}
export function AssumeSheet({ open, onClose, m, prod, cat, set, amountsLine, onAmounts }: AssumeProps) {
  const { C } = m;
  return (
    <DeeperSheet open={open} onClose={onClose} id="sheet-assume" title="ההנחות" sub="אפשר לשנות · החישוב רץ בדפדפן ולא נשלח"
      footer={onAmounts ? <button type="button" className="cs-btn pri" id="assume-amounts" onClick={onAmounts}>לשנות את הסכומים והגיל ›</button> : undefined}>
      <div className="fb-assume">
        <span className="chip est">הנחות וקלט שלך · לא נשלח</span>
        <div className="fform">
          <label><span>גיל היום</span><input type="number" inputMode="numeric" min={15} max={80} value={C.age} onChange={(e) => set({ age: e.target.value })} /></label>
          <label><span>גיל פרישה</span><input type="number" inputMode="numeric" min={40} max={80} value={C.retire} onChange={(e) => set({ ra: e.target.value })} /></label>
          {amountsLine ? null : <>
            <label><span>שכר ברוטו לחודש, ש"ח</span><input type="number" inputMode="decimal" step={500} min={0} value={C.salary} onChange={(e) => set({ sal: e.target.value })} /></label>
            <label><span>הפקדה מהשכר, %</span><input type="number" inputMode="decimal" step={0.5} min={0} value={C.rate} onChange={(e) => set({ rate: e.target.value })} /></label>
            <label><span>יתרה היום, ש"ח</span><input type="number" inputMode="decimal" step={1000} min={0} value={C.start} onChange={(e) => set({ b0: e.target.value })} /></label>
          </>}
          <label><span>עליית שכר בשנה, %</span><input type="number" inputMode="decimal" step={0.5} value={C.growth} onChange={(e) => set({ g: e.target.value })} /></label>
          <label><span>תשואה שנתית ברוטו, % (הנחה)</span><input type="number" inputMode="decimal" step={0.25} value={C.ret} onChange={(e) => set({ r: e.target.value })} /></label>
          <label><span>אינפלציה בשנה, % (הנחה)</span><input type="number" inputMode="decimal" step={0.25} value={C.infl} onChange={(e) => set({ inf: e.target.value })} /></label>
          <label><span>מקדם המרה (הנחה)</span><input type="number" inputMode="decimal" step={5} min={50} value={C.coef} onChange={(e) => set({ coef: e.target.value })} /></label>
          {!amountsLine && m.members.length > 1 ? (
            <label className="wide"><span>המסלול שנבחר</span><select value={m.mine?.k ?? ''} onChange={(e) => set({ k: e.target.value, da: null, fa: null })}>{m.members.map((f) => <option key={f.k} value={f.k}>{f.name}</option>)}</select></label>
          ) : null}
        </div>
        {amountsLine ? <p className="fb-assume-amt">{amountsLine}</p> : null}
        <div className="fprivacy">
          תשואה: {m.retSrc === 'safe' ? <>הנחה שמרנית של {pc(RET_FALLBACK)} ברוטו בשנה. {m.cat10 != null && !(m.mine && singleIndex(m.mine)) && <button type="button" className="linkbtn" onClick={() => set({ r: m.cat10!.toFixed(2) })}>תשואת העבר של הקטגוריה ב-10 שנים, לא תחזית ({pc(m.cat10)})</button>} </> : <>ההנחה שלך{m.cat10 != null && Math.abs(C.ret - +m.cat10.toFixed(2)) < 1e-9 ? <>: ממוצע הקטגוריה ב-10 השנים האחרונות, <Sourced src={m.retProv}>{pc(m.cat10)}</Sourced> ברוטו (תשואת עבר כהנחה, לא תחזית)</> : null}. </>}
          {m.retSrc === 'user' && <button type="button" className="linkbtn" onClick={() => set({ r: null })}>חזרה להנחה השמרנית ({pc(RET_FALLBACK)})</button>}
          {' '}אינפלציה: {BOI}. מקדם המרה {nf(C.coef, 0)}: {m.coefWhy}; המקדם בפועל תלוי בגיל, במין, במסלול הקצבה ובתקנון. החישוב רץ בדפדפן ולא נשלח.
        </div>
        <p className="fb-legal">דמי הניהול: הממוצע בפועל של כל מסלול, מנתוני רשות שוק ההון ({cat}). חוסך מסוים משלם את מה שסיכם; עמית חדש בקרן ברירת מחדל משלם את מחיר המכרז. {prod.startsWith('פנסיה') ? 'בפנסיה ההפקדה מוגבלת בתקרות. ' : ''}אין כאן המלצה לעבור.</p>
      </div>
    </DeeperSheet>
  );
}

/* ======================= "רגישות" (agent, Pro): today's 6×6 grid, real or nominal ======================= */

export function SensLens({ m, out, nominal, setNominal, onAssume }: { m: FeeModel; out: ReturnType<typeof useCareerOut>; nominal: boolean; setNominal: (v: boolean) => void; onAssume: () => void }) {
  const { C, A, B } = m;
  const grid = out.grid ?? [];
  const val = (o: CareerOut) => (nominal ? o.pension : o.pensionReal);
  const flat = grid.flat().map(val), gmin = Math.min(...flat), gmax = Math.max(...flat);
  const tone = (v: number) => { const t = gmax > gmin ? (v - gmin) / (gmax - gmin) : 1; return `color-mix(in oklch, var(--down) ${Math.round((1 - t) * 42)}%, var(--panel))`; };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return (
    <>
      <Takeaway text={sensTakeaway({ age: C.age, retire: C.retire, coef: C.coef })} />
      <div className="ro-seg fb-nom" role="group" aria-label="שקלי היום או נומינלי">
        <button type="button" className={nominal ? undefined : 'on'} aria-pressed={!nominal} onClick={() => setNominal(false)}>בשקלי היום</button>
        <button type="button" className={nominal ? 'on' : undefined} aria-pressed={nominal} onClick={() => setNominal(true)}>נומינלי</button>
      </div>
      <Panel title="רגישות: דמי ניהול מהפקדה × מצבירה" aside={<span>קצבה חודשית {nominal ? 'נומינלית' : 'בשקלי היום'}</span>} className="fb-sens">
        <div className="scroll"><table className="fgrid" id="sens-grid">
          <caption className="sr-only">קצבה חודשית לפי דמי ניהול מהפקדה (שורות) ומצבירה (עמודות)</caption>
          <thead><tr><th scope="col"><span className="fgrid-c">מהפקדה ↓ מצבירה ←</span></th>{ACCS.map((a) => <th key={a} scope="col" className="num">{nf(a, 2)}%</th>)}</tr></thead>
          <tbody>{DEPS.map((dd, i) => <tr key={dd}><th scope="row" className="num">{nf(dd, 1)}%</th>{ACCS.map((a, j) => { const o = grid[i]?.[j]; if (!o) return <td key={a} />; const hit = (near(dd, A.depfee) && near(a, A.fee)) || (near(dd, B.depfee) && near(a, B.fee));
            return <td key={a} className={hit ? 'hit' : undefined} style={{ background: tone(val(o)) }}><Sourced src={() => m.outProv(o, { depfee: dd, fee: a }, `${nf(dd, 1)}% / ${nf(a, 2)}%`, nominal ? 'pension' : 'pensionReal')}><span className="num">{nf(val(o), 0)}</span></Sourced></td>; })}</tr>)}</tbody>
        </table></div>
        <div className="fnote">כל תא: אותן הנחות, דמי ניהול אחרים. ככל שהתא כהה יותר, הקצבה נמוכה יותר. תא ממוסגר = אחד משני צמדי דמי הניהול בעדשה ״בפרישה״.</div>
      </Panel>
      <p className="ro-stamp">אומדן על הנחות: תשואה <bdi dir="ltr" className="sgnum">{`${+C.ret.toFixed(2)}%`}</bdi> בשנה, אינפלציה <bdi dir="ltr" className="sgnum">{pc(C.infl, 1)}</bdi> · <button type="button" onClick={onAssume} aria-haspopup="dialog">ההנחות ›</button></p>
    </>
  );
}

/* ======================= "בפרישה" (agent, Pro): today's panels ======================= */

export function RetLens({ m, out, sp, set, asof, cat, onAssume }: { m: FeeModel; out: ReturnType<typeof useCareerOut>; sp: URLSearchParams; set: (patch: Record<string, string | null>) => void; asof: number; cat: string; onAssume: () => void }) {
  const { C, A, B, LA, LB, mine, cheap, members, cap } = m;
  const { oa, ob, tenth } = out;
  type W = 'bal' | 'balReal' | 'fees' | 'feesReal' | 'pensionReal';
  const diffProv = (what: W): Prov => ({ k: 'calc', est: true, title: `ההפרש: ${LB} מול ${LA}`, value: ils(ob[what] - oa[what]), formula: `${LB} פחות ${LA}`, inputs: [{ label: LA, v: ils(oa[what]), src: () => m.outProv(oa, A, LA, what) }, { label: LB, v: ils(ob[what]), src: () => m.outProv(ob, B, LB, what) }] });
  const read = tenth.pensionReal - oa.pensionReal;
  const rowsT = members.length <= ALL_MAX ? members : [...members.slice(0, TOP_N), ...(mine && !members.slice(0, TOP_N).includes(mine) ? [mine] : [])];
  const PairBox = ({ who, f, o, keys, color }: { who: string; f: FeePair; o: CareerOut; keys: [string, string]; color: string }) => (
    <div className="fpair">
      <h3><span className="sw" style={{ background: color }} aria-hidden="true" />{who}</h3>
      <div className="fform">
        <label><span>מהפקדה, % <Tip k="depfee" /></span><input type="number" inputMode="decimal" step={0.05} min={0} max={cap.depfee} value={sp.get(keys[0]) ?? f.depfee} aria-invalid={!!m.errOf(keys[0], 'depfee')} onChange={(e) => set({ [keys[0]]: e.target.value })} /></label>
        <label><span>מצבירה, % שנתי <Tip k="fee" /></span><input type="number" inputMode="decimal" step={0.01} min={0} max={cap.fee} value={sp.get(keys[1]) ?? f.fee} aria-invalid={!!m.errOf(keys[1], 'fee')} onChange={(e) => set({ [keys[1]]: e.target.value })} /></label>
      </div>
      {[m.errOf(keys[0], 'depfee'), m.errOf(keys[1], 'fee')].filter(Boolean).map((t) => <p key={t} className="ferr" role="alert">{t} {cap.legal && <a href={KZ_CAPS} target="_blank" rel="noreferrer">כל זכות</a>}</p>)}
      <div className="fpresets">{m.presets.map((x) => <button key={x.label} type="button" className="chip" aria-pressed={x.p.depfee === f.depfee && x.p.fee === f.fee} onClick={() => set({ [keys[0]]: String(x.p.depfee), [keys[1]]: String(x.p.fee) })}>{x.label} · {nf(x.p.depfee, 2)}% / {nf(x.p.fee, 2)}%</button>)}</div>
      <div className="muted">קצבה חודשית בשקלי היום: <Sourced src={() => m.outProv(o, f, who, 'pensionReal')}><b className="num">{ils(o.pensionReal)}</b></Sourced></div>
    </div>
  );
  const sign = (d: number, w: W) => <span className={`num ${d * (w.startsWith('fees') ? -1 : 1) >= 0 ? 'pos' : 'neg'}`}>{d >= 0 ? '+' : '−'}{nf(Math.abs(d), 0)}</span>;
  return (
    <>
      <Takeaway text={retTakeaway(mine?.grp ?? LA, cheap?.grp ?? LB, { age: C.age, retire: C.retire, ret: +C.ret.toFixed(2), coef: C.coef })} />
      <details className="x fb-x" open>
        <summary>בפרישה, בשקלי היום</summary>
        <div className="fb-xin">
          <p className="fread"><Sourced src={() => ({ k: 'calc', est: true, title: '0.1% נוסף מהצבירה, בקצבה החודשית', value: ils(read), formula: `הקצבה בשקלי היום עם ${LA} ועוד 0.1 מהצבירה, פחות הקצבה עם ${LA}`, inputs: [{ label: LA, v: ils(oa.pensionReal), src: () => m.outProv(oa, A, LA, 'pensionReal') }, { label: `${LA} + 0.1% מצבירה`, v: ils(tenth.pensionReal), src: () => m.outProv(tenth, { ...A, fee: A.fee + 0.1 }, `${LA} + 0.1%`, 'pensionReal') }] })}><b className="num">0.1%</b></Sourced> נוסף מהצבירה = <b className="num">{ils(Math.abs(read))}</b> לחודש בקצבה, בשקלי היום.</p>
          <div className="scroll"><table className="fsimple fcards" id="ret-real">
            <caption className="sr-only">{LA} מול {LB} בפרישה</caption>
            <thead><tr><th scope="col">בפרישה</th><th scope="col">{LA}</th><th scope="col">{LB}</th><th scope="col">ההפרש</th></tr></thead>
            <tbody>{([['יתרה, בשקלי היום', 'balReal'], ['סך דמי ניהול, בשקלי היום', 'feesReal'], ['קצבה חודשית, בשקלי היום', 'pensionReal']] as const).map(([l, w]) => (
              <tr key={w}><th scope="row">{l}</th>
                <td data-label={LA}><Sourced src={() => m.outProv(oa, A, LA, w)}><span className="num">{ils(oa[w])}</span></Sourced></td>
                <td data-label={LB}><Sourced src={() => m.outProv(ob, B, LB, w)}><span className="num">{ils(ob[w])}</span></Sourced></td>
                <td data-label="ההפרש"><Sourced src={() => diffProv(w)}>{sign(ob[w] - oa[w], w)}</Sourced></td></tr>))}</tbody>
          </table></div>
          <div className="fnote"><NumText t={retDeposits(oa.dep, oa.months)} /> ההפקדה מחושבת על כל השכר שהוקלד; בפועל ההפקדה לפנסיה מוגבלת בתקרות.</div>
        </div>
      </details>
      <details className="x fb-x">
        <summary>בפרישה, נומינלי</summary>
        <div className="fb-xin">
          <div className="scroll"><table className="fsimple fcards" id="ret-nom">
            <caption className="sr-only">{LA} מול {LB} בפרישה, נומינלי</caption>
            <thead><tr><th scope="col">בפרישה</th><th scope="col">{LA}</th><th scope="col">{LB}</th><th scope="col">ההפרש</th></tr></thead>
            <tbody>{([['יתרה, נומינלי', 'bal'], ['סך דמי ניהול, נומינלי', 'fees']] as const).map(([l, w]) => (
              <tr key={w}><th scope="row">{l}</th>
                <td data-label={LA}><Sourced src={() => m.outProv(oa, A, LA, w)}><span className="num">{ils(oa[w])}</span></Sourced></td>
                <td data-label={LB}><Sourced src={() => m.outProv(ob, B, LB, w)}><span className="num">{ils(ob[w])}</span></Sourced></td>
                <td data-label="ההפרש"><Sourced src={() => diffProv(w)}>{sign(ob[w] - oa[w], w)}</Sourced></td></tr>))}</tbody>
          </table></div>
        </div>
      </details>
      <details className="x fb-x">
        <summary>שני צמדי דמי הניהול</summary>
        <div className="fb-xin">
          <div className="fpairs">
            <PairBox who={LA} f={A} o={oa} keys={['da', 'fa']} color="var(--warn)" />
            <PairBox who={LB} f={B} o={ob} keys={['db', 'fb']} color="var(--accent)" />
          </div>
        </div>
      </details>
      <details className="x fb-x">
        <summary>{m.ownT ? 'דמי הניהול שלך' : 'המסלול שנבחר'} מול הזול בקטגוריה</summary>
        <div className="fb-xin">
          <p className="fb-xsub">{cat} · {rowsT.length === members.length ? `${members.length} מסלולים פתוחים` : `${TOP_N} הזולים מתוך ${members.length} מסלולים פתוחים${mine && !members.slice(0, TOP_N).includes(mine) ? ', ועוד המסלול שנבחר' : ''}`} · {ym(asof)}</p>
          <div className="scroll"><table className="fsimple fcards" id="ret-cheap">
            <caption className="sr-only">דמי ניהול בקטגוריה והקצבה בהנחות</caption>
            <thead><tr><th scope="col">מסלול</th><th scope="col">מהפקדה</th><th scope="col">מצבירה</th><th scope="col">קצבה, שקלי היום</th><th scope="col">מול שנבחר</th></tr></thead>
            <tbody>{rowsT.map((f) => { const p = m.pairOf(f), o = career(C, p), base = mine ? career(C, m.pairOf(mine)) : null;
              return <tr key={f.k} className={f === mine ? 'fme' : undefined}><td><Link to={`/funds/${f.k}`}>{f.name}</Link>{f === cheap && <span className="chip">הזול</span>}{f === mine && <span className="chip">{m.ownT ? 'שלך' : 'שנבחר'}</span>}</td>
                <td data-label="מהפקדה">{m.ownRow(f) ? <span className="num">{pc(p.depfee)}<span className="dim"> שלך</span></span> : <Sourced src={m.feeP(f, 'depfee')}><span className="num">{pc(f.depfee)}</span></Sourced>}</td><td data-label="מצבירה">{m.ownRow(f) ? <span className="num">{pc(p.fee)}<span className="dim"> שלך</span></span> : <Sourced src={m.feeP(f, 'fee')}><span className="num">{pc(f.fee)}</span></Sourced>}</td>
                <td data-label="קצבה, שקלי היום"><Sourced src={() => ({ ...m.outProv(o, p, f.name, 'pensionReal'), inputs: [...m.assumptions(), ...(m.ownRow(f) ? m.pairInputs(p, 'שלך') : [{ label: 'דמי ניהול מהפקדה', v: pc(f.depfee), src: m.feeP(f, 'depfee') }, { label: 'דמי ניהול מצבירה', v: pc(f.fee), src: m.feeP(f, 'fee') }])] })}><span className="num">{ils(o.pensionReal)}</span></Sourced></td>
                <td data-label="מול שנבחר">{base ? <span className={`num ${o.pensionReal >= base.pensionReal ? 'pos' : 'neg'}`}>{o.pensionReal >= base.pensionReal ? '+' : '−'}{nf(Math.abs(o.pensionReal - base.pensionReal), 0)}</span> : '–'}</td></tr>; })}</tbody>
          </table></div>
          <div className="fnote">דמי הניהול: הממוצע בפועל של כל מסלול ב-{ym(asof)}, מנתוני רשות שוק ההון{m.ownT && mine && m.ownRow(mine) ? '; בשורה שלך, דמי הניהול שהזנת' : ''}. חוסך מסוים משלם את מה שסיכם; עמית חדש בקרן ברירת מחדל משלם את מחיר המכרז. ממוין מהזול. {mine && <>מהלך: <Link to={`/funds/compare?k=${[mine.k, cheap?.k].filter(Boolean).join(',')}`}>השוואת המסלול שנבחר לזול</Link>.</>} אין כאן המלצה לעבור.</div>
        </div>
      </details>
      <p className="ro-stamp">אומדן על הנחות: גיל <bdi dir="ltr" className="sgnum">{nf(C.age, 0)}</bdi> עד <bdi dir="ltr" className="sgnum">{ageText(C.retire)}</bdi>, תשואה <bdi dir="ltr" className="sgnum">{`${+C.ret.toFixed(2)}%`}</bdi> ברוטו, אינפלציה <bdi dir="ltr" className="sgnum">{pc(C.infl, 1)}</bdi> · <button type="button" onClick={onAssume} aria-haspopup="dialog">ההנחות ›</button></p>
    </>
  );
}
