import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import type { Prov } from '../../lib/prov';
import type { FundX, FundsFile } from '../../lib/funds';
import type { DefaultFile } from '../../lib/fundsTools';
import type { DecisionFile } from '../../lib/decision';
import { useMy, useMyAge, useMySalary, useMySex, useRetire, type MyProduct } from '../../lib/mine';
import { AGE_DEFAULT, INFL_DEFAULT, RET_FALLBACK, ageText, ilsRound, feeGap, annualFees } from '../../lib/retire';
import { birthYearOf, coefFor, trackAgeNote, AGE_TRACKS, type CoefFile } from '../../lib/coef';
import { cardCalc, type CardCalc } from '../../lib/myCalc';
import { isPension, pcf } from '../../lib/verdict';
import { kindOf, rateTotal, AVG_WAGE } from '../../lib/deposits';
import { momentPath, type MomentId } from '../../lib/moments';
import { S, shortOf, type MSrc } from '../../lib/momentsContent';
import { BASKET_2026, GRANT_FACTOR, HISH_CAP_MONTHLY, HISH_WITHHOLD, SEV_EXEMPT_YEAR, defaultFor, digitOf, hishCost, pairOf, raiseRows, retireRows, severance } from '../../lib/momentsCalc';
import { winnerTrack } from '../../lib/pensionPack';
import { FriendSays } from './FriendSays';

/* W9 saver · the moment pages' parts: the chip row on /my, and "מה לבדוק אצלך" for each moment, reading the reader's own products from
   /my (this browser) and computing on the site's engines (lib/momentsCalc). Every figure that is not the reader's or the regulator's is
   labelled as an estimate or an example. Descriptive, never advice. */

export { MomentChips } from './MomentChips';

/** a source link inside a line (underlined: .sv-facts a / .sv-note a) */
export const SrcA = ({ s }: { s: MSrc }) => <a href={s.url} target="_blank" rel="noreferrer" title={s.t}>{shortOf(s)}</a>;

/** what each check reads */
export interface Ctx { data: FundsFile; dfile: DefaultFile | null | undefined; dec: DecisionFile | null | undefined; coefF: CoefFile | null | undefined; list: MyProduct[] }
interface Row { m: MyProduct; f: FundX; C: CardCalc }

/** the reader's products with the card's own arithmetic (lib/myCalc), at the age and retirement age of /my */
function useRows(x: Ctx): { rows: Row[]; age: number; ageSet: boolean; retire: number } {
  const [ageS] = useMyAge(), [sex] = useMySex();
  const R = useRetire();
  const age = ageS ?? AGE_DEFAULT;
  const rows = useMemo(() => {
    const byK = new Map((x.data.funds as FundX[]).map((f) => [f.k, f]));
    return x.list.flatMap((m) => {
      const f = byK.get(m.k); if (!f) return [];
      const pick = coefFor(x.coefF, f.grp, sex, R.v, birthYearOf(age));
      return [{ m, f, C: cardCalc(f, x.data.funds as FundX[], x.data.asof, x.dfile, m, x.dec, { age, coef: pick.v, ret: RET_FALLBACK, retire: R.v }) }];
    });
  }, [x.data, x.dfile, x.dec, x.coefF, x.list, sex, R.v, age]);
  return { rows, age, ageSet: ageS != null, retire: R.v };
}

const None = ({ what }: { what: string }) => <p className="sv-note">אין עדיין {what} ב<Link to="/my">המוצרים שלי</Link>. אחרי שמוסיפים, החשבון כאן נעשה על המספרים שלכם.</p>;
const num = (s: string): number | null => { const t = s.replace(/[,\s₪%]/g, ''); if (t === '') return null; const v = Number(t); return Number.isFinite(v) ? v : null; };
function NumBox({ label, value, onChange, ph, step = 1, width = 120 }: { label: ReactNode; value: string; onChange: (s: string) => void; ph?: string; step?: number; width?: number }) {
  return <label><span>{label}</span><input type="number" inputMode="decimal" min={0} step={step} placeholder={ph} value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: width }} /></label>;
}
/** an amount without the currency word, for a table whose header names it */
const n0 = (v: number) => ilsRound(v).replace(' ש"ח', '');
const calc = (title: string, value: string, formula: string, inputs: { label: string; v: string }[], note?: string): (() => Prov) => () => ({ k: 'calc', est: true, title, value, formula, inputs, note });

/* ======================= job ======================= */
export function JobCheck(x: Ctx) {
  const { rows, age, ageSet, retire } = useRows(x);
  const pens = rows.filter((r) => isPension(r.f.prod)), hish = rows.filter((r) => r.f.prod === 'השתלמות');
  return (
    <>
      {pens.length ? pens.map((r) => <SevBlock key={r.f.k} r={r} x={x} age={age} ageSet={ageSet} retire={retire} />) : <None what="קרן פנסיה" />}
      {hish.length > 0 && <ul className="sv-facts">{hish.map((r) => <li key={r.f.k}><b>{r.f.name}</b>: ממשיכה לצבור ותק גם בלי הפקדות{r.m.balance != null ? <>, ויש בה כ-{ilsRound(r.m.balance)}</> : null}. מועד הנזילות לא משתנה בגלל העזיבה (<SrcA s={S.hish} />).</li>)}</ul>}
      <h3 className="mo-h3">הקרן אצל המעסיק החדש</h3>
      <DefaultBlock {...x} compact />
    </>
  );
}

function SevBlock({ r, x, age, ageSet, retire }: { r: Row; x: Ctx; age: number; ageSet: boolean; retire: number }) {
  const [sexS] = useMySex();
  const [sev, setSev] = useState(''), [yrs, setYrs] = useState('');
  const a = num(sev), y = num(yrs);
  const pick = coefFor(x.coefF, r.f.grp, sexS, retire, birthYearOf(age));
  const out = a != null && a > 0 ? severance(a, y ?? 0, r.C.plan, r.C.mine, pick.v) : null;
  const share = Math.round((6 / rateTotal({ employee: 6, employer: 6.5, severance: 6 })) * 100);
  return (
    <div className="mo-box">
      <p className="mo-box-h"><b>{r.f.name}</b></p>
      <p>מתוך כל הפקדה לפנסיה, 6% מהשכר הם פיצויים: כ-{share}% מההפקדה (בשיעורי המינימום בחוק, <SrcA s={S.rates} />). בדוח השנתי מופיע כמה מהיתרה הם כספי פיצויים.</p>
      <div className="sv-form mo-form">
        <NumBox label='כספי הפיצויים בקרן, ש"ח' value={sev} onChange={setSev} ph="מהדוח השנתי" step={1000} />
        <NumBox label="שנות עבודה אצל המעסיק" value={yrs} onChange={setYrs} ph="למשל 6" step={1} width={90} />
      </div>
      {out && <ul className="sv-facts">
        <li>פטור ממס: עד <Sourced src={calc('הפטור על הפיצויים', ilsRound(out.exempt), `${SEV_EXEMPT_YEAR.toLocaleString('en-US')} ש"ח × שנות העבודה, ולא יותר מהסכום`, [{ label: 'שנות עבודה', v: String(y ?? 0) }, { label: 'פטור לשנה (2026)', v: `${SEV_EXEMPT_YEAR.toLocaleString('en-US')} ש"ח` }])}><b className="num">{ilsRound(out.exempt)}</b></Sourced> ({SEV_EXEMPT_YEAR.toLocaleString('en-US')} ש"ח לכל שנת עבודה, 2026, <SrcA s={S.tax2026} />).{out.taxable > 0 && <> מעל הפטור, כ-<b className="num">{ilsRound(out.taxable)}</b> חייבים במס לפי מדרגת המס שלכם (<SrcA s={S.sever} />).</>}</li>
        {out.pensionCut != null && <li>אם הכסף נשאר בקרן, הוא יכול להיות כ-<Sourced src={calc(`קצבה חודשית מכספי הפיצויים בגיל ${ageText(retire)} · אומדן`, ilsRound(out.pensionCut), 'הסכום, בלי הפקדות נוספות, גדל עד גיל הפרישה בתשואה 4% ברוטו פחות דמי הניהול שלכם, בשקלי היום (אינפלציה 2%), חלקי מקדם ההמרה',
          [{ label: ageSet ? 'גיל היום (שלך)' : 'גיל היום (לדוגמה)', v: String(age) }, { label: 'גיל פרישה', v: ageText(retire) }, { label: 'דמי ניהול מצבירה', v: pcf(r.C.mine.fee) }, { label: pick.real ? `מקדם (${pick.label})` : 'מקדם (הנחה)', v: String(pick.v) }], 'לא כולל מס ולא את עלות הכיסוי הביטוחי')}><b className="num">{ilsRound(out.pensionCut)}</b></Sourced> לחודש בקצבה, בגיל {ageText(retire)}, בשקלי היום. <span className="sv-a">אומדן</span></li>}
        {out.exempt > 0 && <li>ניצול הפטור עכשיו מקטין את "סל הפטור" בפרישה בכ-<b className="num">{ilsRound(out.basketCut)}</b> ({ilsRound(out.exempt)} × {GRANT_FACTOR}, לפני הצמדה), מתוך {BASKET_2026.toLocaleString('en-US')} ש"ח ב-2026, כשהמענק בתוך 32 השנים שלפני גיל הזכאות (<SrcA s={S.g161d(6)} />).</li>}
      </ul>}
      {r.m.covers?.length ? <p className="sv-note">הכיסויים שלך מקובץ המסלקה מופיעים בכרטיס הקרן ב<Link to={`/my#${r.f.k}`}>המוצרים שלי</Link>; הם נמשכים חודשים ספורים אחרי ההפקדה האחרונה.</p> : null}
    </div>
  );
}

/* ======================= השתלמות ======================= */
export function HishCheck(x: Ctx) {
  const { rows } = useRows(x);
  const hish = rows.filter((r) => r.f.prod === 'השתלמות');
  const [k, setK] = useState<string | null>(null);
  const r = hish.find((h) => h.f.k === k) ?? hish[0] ?? null;
  return (
    <>
      {hish.length > 1 && <div className="sv-chips" role="group" aria-label="איזו קרן">{hish.map((h) => <button key={h.f.k} type="button" className="sv-chip sm" aria-pressed={h === r} onClick={() => setK(h.f.k)}>{h.f.name}</button>)}</div>}
      {!r && <None what="קרן השתלמות" />}
      <HishCalc key={r?.f.k ?? 'none'} r={r} />
    </>
  );
}
function HishCalc({ r }: { r: Row | null }) {
  const [bal, setBal] = useState(r?.m.balance != null ? String(r.m.balance) : '');
  const [fee, setFee] = useState(r ? String(+r.C.mine.fee.toFixed(2)) : '0.6');
  const [liq, setLiq] = useState<'yes' | 'no' | null>(null);
  const [years, setYears] = useState(3);
  const B = num(bal), F = num(fee);
  const out = B != null && B > 0 && F != null ? hishCost({ balance: B, fee: F, years, ret: RET_FALLBACK, infl: INFL_DEFAULT }) : null;
  const feeWho = r ? (r.C.ownAny ? 'שלך' : 'ממוצע המסלול') : 'לדוגמה';
  return (
    <div className="mo-box">
      <div className="sv-form mo-form">
        <NumBox label='יתרה, ש"ח' value={bal} onChange={setBal} ph="מהדוח השנתי" step={1000} />
        <NumBox label={`דמי ניהול מצבירה, % (${feeWho})`} value={fee} onChange={setFee} step={0.05} width={90} />
      </div>
      <div className="sv-chips" role="group" aria-label="האם הקרן כבר נזילה">
        <button type="button" className="sv-chip sm" aria-pressed={liq === 'yes'} onClick={() => setLiq('yes')}>כבר עברו 6 שנים</button>
        <button type="button" className="sv-chip sm" aria-pressed={liq === 'no'} onClick={() => setLiq('no')}>עוד לא</button>
      </div>
      {!out && <p className="sv-note">הזינו את היתרה מהדוח השנתי כדי לראות את הסכומים.</p>}
      {out && liq === 'yes' && <ul className="sv-facts">
        <li>משיכה עכשיו: 0 ש"ח מס על הכסף שהופקד בתוך התקרה הפטורה. על הפקדות מעל התקרה, 25% מס רווחי הון על הרווח (<SrcA s={S.hish} />).</li>
        <li>להשאיר את הכסף עוד{' '}
          <span className="sv-rets mo-inline" role="group" aria-label="כמה שנים">{[1, 3, 6].map((n) => <button key={n} type="button" className="sv-chip sm" aria-pressed={years === n} onClick={() => setYears(n)}>{n === 1 ? 'שנה' : `${n} שנים`}</button>)}</span>
          {' '}: כ-<Sourced src={calc(`היתרה בעוד ${years} שנים, בשקלי היום · אומדן`, ilsRound(out.keepReal), 'היתרה, בלי הפקדות נוספות, בתשואה 4% ברוטו בשנה פחות דמי הניהול מצבירה; בשקלי היום (אינפלציה 2%). השיטה של מחשבון דמי הניהול',
            [{ label: 'יתרה היום', v: ilsRound(B!) }, { label: `דמי ניהול (${feeWho})`, v: pcf(F!) }, { label: 'תשואה ברוטו (הנחה)', v: pcf(RET_FALLBACK) }, { label: 'אינפלציה (הנחה)', v: pcf(INFL_DEFAULT) }], 'התשואה בעתיד אינה ידועה')}><b className="num">{ilsRound(out.keepReal)}</b></Sourced>.
          {' '}על רווח של כ-{ilsRound(out.gainReal)} מחוץ לקרן (למשל בתיק השקעות) היה משולם מס רווחי הון של 25%: כ-<b className="num">{ilsRound(out.taxSaved)}</b>. בקרן הוא פטור. <span className="sv-a">אומדן, בשקלי היום</span></li>
        <li>דמי הניהול על היתרה: כ-<b className="num">{ilsRound(out.feeYear)}</b> בשנה ({pcf(F!)}).</li>
      </ul>}
      {out && liq === 'no' && <ul className="sv-facts">
        <li>משיכה לפני המועד: חלק המעסיק והרווחים חייבים במס, והקרן עשויה לנכות {HISH_WITHHOLD}% במקור (<SrcA s={S.hish} />, <SrcA s={S.tax2026} />). על יתרה של {ilsRound(B!)}: בין כ-<Sourced src={calc('ניכוי במקור במשיכה מוקדמת, גבול תחתון · אומדן', ilsRound(out.early.lo), `${HISH_WITHHOLD}% × היתרה × 75% (חלק המעסיק בשיעורים המקובלים, 7.5 מתוך 10; בלי רווחים)`, [{ label: 'יתרה', v: ilsRound(B!) }], 'הנחה: הופקדו 2.5% מהעובד ו-7.5% מהמעסיק. המס הסופי לפי מדרגת המס שלכם; אפשר לבקש החזר')}><b className="num">{ilsRound(out.early.lo)}</b></Sourced> לכ-<b className="num">{ilsRound(out.early.hi)}</b> ({HISH_WITHHOLD}% מכל היתרה). <span className="sv-a">אומדן</span></li>
        <li>בלי מס כבר עכשיו: אחרי 3 שנים, ללימודים או להשתלמות, או למי שהגיע לגיל פרישה (<SrcA s={S.pkuda} />). תאריך ההפקדה הראשונה כתוב בדוח השנתי.</li>
      </ul>}
      <p className="sv-note">לא חלק מהחישוב: מס על הפקדות מעל התקרה, והרווח של כל מסלול בפועל.</p>
    </div>
  );
}

/* ======================= raise ======================= */
export function RaiseCheck(x: Ctx) {
  const { rows } = useRows(x);
  const [salS] = useMySalary();
  const [now, setNow] = useState(salS != null ? String(salS) : '');
  const [next, setNext] = useState('');
  const prods = rows.filter((r) => kindOf(r.f.prod));
  const N = num(now), X = num(next);
  const inRows = prods.length ? prods.map((r) => ({ kind: kindOf(r.f.prod)!, monthly: r.m.monthly ?? null, rates: r.m.depRates ?? null, name: r.f.name }))
    : [{ kind: 'pension' as const, monthly: null, rates: null, name: 'קרן פנסיה (לדוגמה)' }, { kind: 'hishtalmut' as const, monthly: null, rates: null, name: 'קרן השתלמות (לדוגמה)' }];
  const out = X != null && X >= 1000 ? raiseRows(N != null && N >= 1000 ? N : null, X, inRows) : null;
  return (
    <div className="mo-box">
      <div className="sv-form mo-form">
        <NumBox label='השכר ברוטו עד עכשיו, ש"ח' value={now} onChange={setNow} ph="למשל 15000" step={100} />
        <NumBox label='השכר אחרי ההעלאה, ש"ח' value={next} onChange={setNext} ph="למשל 16500" step={100} />
      </div>
      {!prods.length && <None what="קרן פנסיה או השתלמות" />}
      {!out ? <p className="sv-note">הזינו את השכר אחרי ההעלאה.</p> : <div className="scroll"><table className="mo-t">
        <thead><tr><th scope="col">מוצר</th><th scope="col">שיעורים</th>{out.some((o) => o.now) && <th scope="col">הפקדה עכשיו</th>}<th scope="col">אחרי ההעלאה</th></tr></thead>
        <tbody>{out.map((o, i) => <tr key={i}>
          <th scope="row">{inRows[i].name}</th>
          <td className="num">{o.kind === 'pension' ? `${o.rates.employee}+${o.rates.employer}+${o.rates.severance}%` : `${o.rates.employee}+${o.rates.employer}%`}</td>
          {out.some((q) => q.now) && <td className="num">{o.now ? ilsRound(o.now.total) : '–'}</td>}
          <td className="num"><b>{ilsRound(o.next.total)}</b>{o.delta != null && Math.abs(o.delta) >= 1 ? <span className="sv-a">{o.delta > 0 ? '+' : '−'}{ilsRound(Math.abs(o.delta))}</span> : null}{o.next.capped ? <span className="sv-a">עד התקרה</span> : null}</td>
        </tr>)}</tbody>
      </table></div>}
      {out && <ul className="sv-facts">
        {out.map((o, i) => o.gap != null && Math.abs(o.gap) >= Math.max(20, (o.now?.total ?? 0) * 0.01) ? <li key={i}>{inRows[i].name}: הזנתם הפקדה של {ilsRound(o.entered!)} לחודש; לפי השכר עד עכשיו היא אמורה להיות כ-{ilsRound(o.now!.total)} ({o.gap > 0 ? `חסרים כ-${ilsRound(o.gap)}` : `יותר בכ-${ilsRound(-o.gap)}`}). בדיקת 12 החודשים בכרטיס: <Link to="/my#deposits">ההפקדות שלי</Link>.</li> : null)}
        {out.some((o) => o.kind === 'pension') && <li>המינימום בצו מחושב על שכר היסוד ועד השכר הממוצע במשק ({AVG_WAGE.toLocaleString('en-US')} ש"ח, 2026); הסכמים רבים מבטחים את כל השכר, והחישוב כאן על כל השכר (<SrcA s={S.rates} />).</li>}
        {out.some((o) => o.kind === 'hishtalmut') && <li>השתלמות: ההפקדה הפטורה עד שכר של {HISH_CAP_MONTHLY.toLocaleString('en-US')} ש"ח לחודש (2026); מעל זה, הפקדת המעסיק חייבת במס (<SrcA s={S.hish} />).</li>}
      </ul>}
    </div>
  );
}

/* ======================= near 60 ======================= */
export function SixtyCheck(x: Ctx) {
  const { rows, age, ageSet } = useRows(x);
  const [sex, setSex] = useMySex();
  const tracked = rows.filter((r) => AGE_TRACKS.some((b) => b.track === r.f.track));
  const pens = rows.filter((r) => isPension(r.f.prod));
  return (
    <>
      {!ageSet && <p className="sv-note">הגיל כאן לדוגמה ({AGE_DEFAULT}); אפשר להזין את הגיל ב<Link to="/my">המוצרים שלי</Link>.</p>}
      {tracked.length > 0 && <ul className="sv-facts">{tracked.map((r) => { const n = trackAgeNote(r.f.track, age); return <li key={r.f.k}><b>{r.f.name}</b>: מסלול "{r.f.track}". {n ? n.text : `בגיל ${age} זה המסלול שהמודל התלוי בגיל מצרף אליו.`} (<SrcA s={S.ageModel} />)</li>; })}</ul>}
      {sex == null && pens.length > 0 && <div className="sv-chips" role="group" aria-label="מין, למקדם מהתקנון"><span className="sv-note">המקדם בתקנון תלוי במין:</span>{([['f', 'אישה'], ['m', 'גבר']] as const).map(([k, l]) => <button key={k} type="button" className="sv-chip sm" aria-pressed={false} onClick={() => setSex(k)}>{l}</button>)}</div>}
      {pens.length ? pens.map((r) => <RetireTable key={r.f.k} r={r} x={x} age={age} ageSet={ageSet} sex={sex} />) : <None what="קרן פנסיה" />}
    </>
  );
}
function RetireTable({ r, x, age, ageSet, sex }: { r: Row; x: Ctx; age: number; ageSet: boolean; sex: 'm' | 'f' | null }) {
  const by = birthYearOf(age);
  const t = retireRows(r.C.plan, r.C.mine, (a) => { const p = coefFor(x.coefF, r.f.grp, sex, a, by); return { v: p.v, real: p.real }; });
  if (!t.length) return null;
  const picks = t.map((row) => coefFor(x.coefF, r.f.grp, sex, row.age, by));
  const base = t[0];
  const ex = r.C.exBalance || r.C.exMonthly;
  const prov = (i: number) => calc(`קצבה חודשית בפרישה בגיל ${t[i].age}, בשקלי היום · ${r.f.name}`, ilsRound(t[i].pension), 'החיסכון בגיל הפרישה (ההפקדה עולה 2% בשנה, תשואה 4% ברוטו, דמי הניהול שלכם או הממוצע, אינפלציה 2%) חלקי מקדם ההמרה לאותו גיל',
    [{ label: ageSet ? 'גיל היום (שלך)' : 'גיל היום (לדוגמה)', v: String(age) }, { label: r.m.balance != null ? 'יתרה (שלך)' : 'יתרה (לדוגמה)', v: ilsRound(r.C.plan.balance) }, { label: r.m.monthly != null ? 'הפקדה (שלך)' : 'הפקדה (לדוגמה)', v: ilsRound(r.C.plan.monthly) },
      { label: 'חיסכון בגיל הפרישה', v: ilsRound(t[i].balReal) }, { label: picks[i].real ? `מקדם (${picks[i].label})` : 'מקדם (הנחה)', v: String(t[i].coef) }], 'אומדן. לא מנכה את עלות הכיסוי הביטוחי ולא מס');
  return (
    <div className="mo-box">
      <p className="mo-box-h"><b>{r.f.name}</b>{ex && <span className="sv-a">עם {r.C.exBalance ? 'יתרה' : 'הפקדה'} לדוגמה</span>}</p>
      <div className="scroll"><table className="mo-t">
        <thead><tr><th scope="col">פרישה בגיל</th><th scope="col">חיסכון, ש"ח</th><th scope="col">מקדם</th><th scope="col">קצבה לחודש, ש"ח</th></tr></thead>
        <tbody>{t.map((row, i) => <tr key={row.age}>
          <th scope="row" className="num">{row.age}</th>
          <td className="num">{n0(row.balReal)}</td>
          <td className="num"><Sourced src={picks[i].prov}>{row.coef}</Sourced>{!row.real && <span className="sv-a">הנחה</span>}</td>
          <td className="num"><Sourced src={prov(i)}><b>{n0(row.pension)}</b></Sourced>{i > 0 && <span className="sv-a">+{n0(row.pension - base.pension)}</span>}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="sv-note">בשקלי היום, לפני מס. {picks.some((p) => p.real) ? `המקדם מתקנון הקרן (${picks.find((p) => p.real)!.optLabel ?? 'מסלול ברירת המחדל'}); ` : 'המקדם הוא הנחה של האתר, לא של הקרן; '}המקדם בפועל נקבע בפרישה, לפי התקנון שבתוקף אז ומסלול הקצבה שתבחרו. <span className="sv-a">אומדן</span></p>
    </div>
  );
}

/* ======================= switch ======================= */
export function SwitchCheck(x: Ctx) {
  const { rows } = useRows(x);
  const [sex] = useMySex();
  if (!rows.length) return <None what="מוצרים" />;
  return <>{rows.map((r) => <div key={r.f.k} className="mo-box"><p className="mo-box-h"><b>{r.f.name}</b> <span className="sv-muted">{r.f.prod} · {r.f.track}</span></p>
    <FriendSays f={r.f} data={x.data} dfile={x.dfile} dec={x.dec} C={r.C} sex={sex} startOpen /></div>)}</>;
}

/* ======================= the default fund by the ID digit ======================= */
const DIGIT_KEY = 'my:iddigit';
export function DefaultBlock(x: Ctx & { compact?: boolean }) {
  const { rows } = useRows(x);
  const [saved, setSaved] = useMy<number | null>(DIGIT_KEY, null);
  const [raw, setRaw] = useState(saved != null ? String(saved) : '');
  const [big, setBig] = useState(true);
  const digit = digitOf(raw);
  const pick = defaultFor(x.dfile, x.data.asof, digit, big);
  const funds = x.data.funds as FundX[];
  const pen = rows.find((r) => r.f.prod === 'פנסיה מקיפה') ?? rows.find((r) => isPension(r.f.prod)) ?? null;
  if (!pick) return <p className="sv-note">נתוני המכרזים לא נטענו.</p>;
  const t = pick.tender;
  const save = (on: boolean) => setSaved(on && digit != null ? digit : null);
  return (
    <div className="mo-box mo-dflt">
      <fieldset className="mo-fs"><legend>המעסיק</legend>
        <label><input type="radio" name="mo-size" checked={big} onChange={() => setBig(true)} /> 50 עובדים ומעלה</label>
        <label><input type="radio" name="mo-size" checked={!big} onChange={() => setBig(false)} /> פחות מ-50</label>
      </fieldset>
      {big && <div className="sv-form mo-form">
        <label><span>הספרה האחרונה בתעודת הזהות (ספרת הביקורת)</span>
          <input type="text" inputMode="numeric" maxLength={1} pattern="[0-9]" placeholder="0–9" value={raw} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(-1); setRaw(v); if (saved != null) setSaved(v === '' ? null : Number(v)); }} style={{ maxWidth: 80 }} autoComplete="off" />
        </label>
        <label className="mo-save"><input type="checkbox" checked={saved != null} disabled={digit == null} onChange={(e) => save(e.target.checked)} /> <span>לשמור את הספרה בדפדפן הזה</span></label>
      </div>}
      {big && <p className="sv-note">רק הספרה האחרונה, לא מספר הזהות. היא נשמרת רק אם מסמנים, ורק בדפדפן הזה.</p>}
      {pick.winners.length > 0 && <ul className="sv-facts">
        {pick.winners.map((w) => { const p = pairOf(t, w); const tr = winnerTrack(w, funds); return (
          <li key={w.grp}>{big ? <>לפי ספרה {digit}: </> : null}<b>{w.grp}</b>{tr ? <> (<Link to={`/funds/${tr.k}`}>{tr.name}</Link>)</> : null}{p ? <>, במחיר המכרז: {pcf(p.depfee)} מכל הפקדה ו-{pcf(p.fee)} מהחיסכון בשנה</> : null} (<SrcA s={S.tender2024} />).</li>); })}
        {!big && <li>אצל מעסיק של פחות מ-50 עובדים אין שיבוץ לפי ספרה: ההפקדה לאחת הקרנות הנבחרות (<SrcA s={S.dflt} />).</li>}
        <li>המחיר חל על מי שמצטרף כעמית חדש בתקופת ההליך ({t.from.split('-').reverse().join('.')}–{t.to.split('-').reverse().join('.')}), ל-{t.fee_years ?? 10} שנים לפחות מההצטרפות (<SrcA s={S.circ2024} />).{t.fee_alt?.length ? ' אפשר להמיר בין שני החלקים לפי טבלת ההמרה של ההליך.' : ''}</li>
      </ul>}
      {pen && pick.winners.length > 0 && (() => { const p = pairOf(t, pick.winners[0]); return p ? <Gap r={pen} p={p} /> : null; })()}
      {!pen && pick.winners.length > 0 && <p className="sv-note">עם קרן הפנסיה שלכם ב<Link to="/my">המוצרים שלי</Link>, כאן יופיע הפער בשקלים מול מחיר המכרז.</p>}
      {x.compact && <p className="sv-note"><Link to={momentPath('default')}>עוד על קרנות ברירת המחדל</Link>.</p>}
    </div>
  );
}
function Gap({ r, p }: { r: Row; p: { fee: number; depfee: number } }) {
  const g = feeGap(r.C.plan, r.C.mine, p);
  const yr = annualFees(r.C.plan.balance, r.C.plan.monthly, r.C.mine).total - annualFees(r.C.plan.balance, r.C.plan.monthly, p).total;
  const who = r.C.ownAny ? 'שלך' : 'הממוצעים במסלול';
  const src = calc(`הפער בחיסכון בגיל ${ageText(r.C.plan.retire)} · מחיר המכרז מול דמי הניהול ${who}`, ilsRound(Math.abs(g.balReal)), 'אותה תוכנית בשני המקרים (היתרה, ההפקדה שעולה 2% בשנה, תשואה 4% ברוטו, אינפלציה 2%); רק דמי הניהול שונים. בשקלי היום',
    [{ label: `דמי ניהול ${who}`, v: `${pcf(r.C.mine.depfee)} / ${pcf(r.C.mine.fee)}` }, { label: 'מחיר המכרז', v: `${pcf(p.depfee)} / ${pcf(p.fee)}` }, { label: r.m.balance != null ? 'יתרה (שלך)' : 'יתרה (לדוגמה)', v: ilsRound(r.C.plan.balance) }, { label: r.m.monthly != null ? 'הפקדה (שלך)' : 'הפקדה (לדוגמה)', v: ilsRound(r.C.plan.monthly) }],
    'אומדן, לא תחזית; לא כולל עלות כיסוי ביטוחי ומס. מחיר המכרז מובטח ל-10 שנים מההצטרפות, והחישוב מניח אותו עד הפרישה');
  return (
    <p>מול {r.f.name} (דמי ניהול {who}: {pcf(r.C.mine.depfee)} מהפקדה, {pcf(r.C.mine.fee)} מהחיסכון): {Math.abs(g.balReal) < 500 ? <>הפער בחיסכון בגיל הפרישה קטן מ-500 ש"ח.</> : <>במחיר המכרז יהיו בחיסכון בגיל {ageText(r.C.plan.retire)} כ-<Sourced src={src}><b className="num">{ilsRound(Math.abs(g.balReal))}</b></Sourced> {g.balReal > 0 ? 'יותר' : 'פחות'}{Math.abs(yr) >= 10 ? <>; השנה, כ-{ilsRound(Math.abs(yr))} {yr > 0 ? 'פחות' : 'יותר'} דמי ניהול</> : null}.</>} <span className="sv-a">אומדן, בשקלי היום</span></p>
  );
}

export const CHECKS: Record<MomentId, (x: Ctx) => JSX.Element> = { job: JobCheck, hishtalmut: HishCheck, raise: RaiseCheck, sixty: SixtyCheck, switch: SwitchCheck, default: (x) => <DefaultBlock {...x} /> };
