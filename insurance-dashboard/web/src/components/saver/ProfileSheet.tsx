import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DeeperSheet } from '../DeeperSheet';
import { Sourced } from '../Source';
import { useMyAge, useMyRetire, useMySalary, useMySex, useProfiles, useRetire } from '../../lib/mine';
import { writeStored } from '../../lib/local';
import { PROFILE_ADD, PROFILE_LABEL, addProfile, removeProfile, setActive, type ProfileId } from '../../lib/household';  // W7
import type { Prov } from '../../lib/prov';
import { AGE_DEFAULT, KZ_RETIRE, ageText, ilsRound } from '../../lib/retire';
import { pct0, replacementOf, type CoefFile } from '../../lib/coef';  // W6
import { summaryOf, type SumRow } from '../../lib/myCalc';
import { pcf } from '../../lib/verdict';
import { ME_BTN } from '../../lib/pageWords';
import { GlossBar } from './Gloss';

/* "הפרטים שלי" (rollout spec 5.2 #1, 16.1 5d, 17.1 6c; T-M2): the sheet behind /my's 44-px pill (#me-btn), so no form sits above the
   products. First section: today's household profiles and the reader's age, sex, retirement age and salary (W5–W7: the same controls
   that stood at the top of /my, unchanged, moved here). Second section: today's summary strip ("התמונה בקצרה": the yearly fees of all
   products, the pension estimate with its coefficient and source, the replacement-rate lines and "דבר אחד לעשות"); its links open the
   product's sheet or its amounts instead of jumping to an anchor. The glossary bar ("מילים בעמוד", once on the empty /my) sits under
   the first section. Everything stays in this browser only. */

export function ProfileSheet({ open, onClose, rows, coefF, onProduct, onAmounts }: {
  open: boolean; onClose: () => void; rows: SumRow[]; coefF: CoefFile | null | undefined; onProduct: (k: string) => void; onAmounts: (k: string) => void;
}) {
  const R = useRetire();
  return (
    <DeeperSheet open={open} onClose={onClose} id="sheet-profile" title={ME_BTN} sub="נשמר רק בדפדפן הזה · לא חובה" detent="full">
      <section className="my-prof" aria-label="של מי המוצרים, והפרטים">
        <Household />
        <AgeRow />
        <GlossBar />
      </section>
      {rows.length > 0 && <section className="my-prof my-prof-sum">
        <h3>התמונה בקצרה</h3>
        <Strip rows={rows} retire={R.v} coefF={coefF} onProduct={onProduct} onAmounts={onAmounts} />
      </section>}
    </DeeperSheet>
  );
}

/** W7: the household's profiles in one chip row. Each profile keeps its own products, age, sex, retirement age, salary and snapshot
 *  in this browser; no names are stored, and the note to the agent calls anyone but "אני" simply "החוסך/ת". */
function Household() {
  const [P, setP] = useProfiles();
  const others = (['spouse', 'parent'] as const).filter((id) => !P.list.includes(id));
  const drop = (id: ProfileId) => {
    if (!confirm(`להסיר את הפרופיל "${PROFILE_LABEL[id]}" ומה שנשמר בו בדפדפן הזה?`)) return;
    const r = removeProfile(P, id); r.drop.forEach((k) => writeStored(k, undefined)); setP(r.profiles);
  };
  return (
    <div className="sv-hh" role="group" aria-label="של מי המוצרים: כל פרופיל עם המוצרים והגיל שלו, בדפדפן הזה בלבד" title="כל פרופיל עם המוצרים והגיל שלו, בדפדפן הזה בלבד">
      {P.list.map((id) => <button key={id} type="button" className="sv-chip sm" aria-pressed={P.active === id} onClick={() => setP(setActive(P, id))}>{PROFILE_LABEL[id]}</button>)}
      {others.map((id) => <button key={id} type="button" className="sv-chip sm ghost" onClick={() => setP(addProfile(P, id))} aria-label={`הוספת פרופיל: ${PROFILE_LABEL[id]}`}>{PROFILE_ADD[id]}</button>)}
      {P.active !== 'me' && <button type="button" className="linkbtn" onClick={() => drop(P.active)}>הסרת הפרופיל</button>}
    </div>
  );
}

/** the reader's age (and, for the conversion coefficient, sex), asked once and used on every card and in the fee tool */
function AgeRow() {
  const [age, setAge] = useMyAge();
  const [sex, setSex] = useMySex();
  const [raw, setRaw] = useState(age == null ? '' : String(age));
  const [was, setWas] = useState(age);
  if (was !== age) { setWas(age); setRaw(age == null ? '' : String(age)); }
  const bad = raw !== '' && !(Number(raw) >= 16 && Number(raw) <= 66);
  return (
    <div className="sv-who" role="group" aria-label="הגיל שלך">
      <label className="sv-who-age"><span>גיל</span>
        <input type="number" inputMode="numeric" min={16} max={66} step={1} placeholder={String(AGE_DEFAULT)} value={raw} aria-invalid={bad}
          onChange={(e) => { const t = e.target.value; setRaw(t); const x = Number(t); if (t !== '' && Number.isInteger(x) && x >= 16 && x <= 66) setAge(x); }} />
      </label>
      {age == null ? <span className="sv-a sv-who-ex">{AGE_DEFAULT} לדוגמה, שנו</span> : bad ? <span className="sv-err">גיל בין 16 ל-66</span> : null}
      <span className="sv-rets" role="group" aria-label="מין, למקדם הקצבה">
        {([['f', 'אישה'], ['m', 'גבר']] as const).map(([k, l]) => <button key={k} type="button" className="sv-chip sm" aria-pressed={sex === k} onClick={() => setSex(sex === k ? null : k)}>{l}</button>)}
      </span>
      <span className="sv-a">לא חובה</span>
      <RetireIn />
      <SalaryIn />
    </div>
  );
}

/** W5: the retirement age, statutory by sex and age (lib/retire), and the reader's own when typed */
function RetireIn() {
  const R = useRetire();
  const [own, setOwn] = useMyRetire();
  const [raw, setRaw] = useState(own == null ? '' : String(own));
  const [was, setWas] = useState(own);
  if (was !== own) { setWas(own); setRaw(own == null ? '' : String(own)); }
  const bad = raw !== '' && !(Number(raw) >= 50 && Number(raw) <= 75);
  return (
    <span className="sv-who-ret">
      <label className="sv-who-age"><span>גיל פרישה</span>
        <input type="number" inputMode="decimal" min={50} max={75} step={1} placeholder={ageText(R.v)} value={raw} aria-invalid={bad}
          onChange={(e) => { const t = e.target.value; setRaw(t); const x = Number(t); if (t === '') setOwn(null); else if (Number.isFinite(x) && x >= 50 && x <= 75) setOwn(x); }} />
      </label>
      {bad ? <span className="sv-err">גיל בין 50 ל-75</span> : <span className="sv-a">{own != null ? <>שלך · <button type="button" className="linkbtn" onClick={() => setOwn(null)}>לגיל בחוק</button></> : <a className="sv-u" href={KZ_RETIRE} target="_blank" rel="noreferrer" title={R.why}>לפי החוק</a>}</span>}
    </span>
  );
}

/** W6: the reader's gross monthly salary, for the replacement rate (optional; this browser only) */
function SalaryIn() {
  const [sal, setSal] = useMySalary();
  const [raw, setRaw] = useState(sal == null ? '' : String(sal));
  const [was, setWas] = useState(sal);
  if (was !== sal) { setWas(sal); setRaw(sal == null ? '' : String(sal)); }
  const bad = raw !== '' && !(Number(raw) >= 1000 && Number(raw) <= 200000);
  return (
    <span className="sv-who-ret">
      <label className="sv-who-age"><span>שכר ברוטו לחודש</span>
        <input type="number" inputMode="numeric" min={1000} max={200000} step={100} placeholder="למשל 15000" value={raw} aria-invalid={bad} style={{ width: 124 }}
          onChange={(e) => { const t = e.target.value; setRaw(t); const x = Number(t); if (t === '') setSal(null); else if (Number.isFinite(x) && x >= 1000 && x <= 200000) setSal(Math.round(x)); }} />
      </label>
      {bad ? <span className="sv-err">סכום בין 1,000 ל-200,000</span> : <span className="sv-a">לא חובה</span>}
    </span>
  );
}

/** the strip at the top: what the reader pays this year, the pension estimate, and the one thing worth asking for */
function Strip({ rows, retire, coefF, onProduct, onAmounts }: { rows: SumRow[]; retire: number; coefF: CoefFile | null | undefined; onProduct: (k: string) => void; onAmounts: (k: string) => void }) {
  const at = `בגיל ${ageText(retire)}`;
  const s = summaryOf(rows);
  const [salary] = useMySalary();
  const nReal = rows.filter((r) => r.prod.startsWith('פנסיה') && r.coefReal).length, nPen = rows.filter((r) => r.prod.startsWith('פנסיה')).length;
  const coefWhy = nPen === 0 ? '' : nReal === nPen ? 'מקדם מהתקנון' : nReal === 0 ? 'מקדם לפי הנחה' : `מקדם מהתקנון ב-${nReal} מתוך ${nPen}`;
  const rep = salary != null && s.pension != null && s.penBal > 0 && coefF ? replacementOf(s.pension, salary, coefF) : null;
  const firstPen = rows.find((r) => r.prod.startsWith('פנסיה'));
  const feesProv = (): Prov => ({ k: 'calc', est: true, title: 'דמי ניהול בשנה, כל המוצרים', value: ilsRound(s.fees), formula: 'לכל מוצר: היתרה × דמי הניהול מצבירה, ועוד 12 הפקדות × דמי הניהול מהפקדה. דמי הניהול שלך כשהזנת, אחרת הממוצע במסלול',
    note: [s.feesAvg ? 'בחלק מהמוצרים: דמי הניהול הממוצעים במסלול, לא שלך' : null, s.feesEx ? 'בחלק מהמוצרים: יתרה או הפקדה לדוגמה' : null].filter(Boolean).join('. ') || undefined,
    inputs: rows.map((r) => ({ label: `${r.name} (${r.c.v.fee.own ? 'שלך' : 'ממוצע'}: ${pcf(r.c.mine.fee)} / ${pcf(r.c.mine.depfee)})`, v: ilsRound(r.c.annual.total) })) });
  const penProv = (): Prov => ({ k: 'calc', est: true, title: `קצבה חודשית מקרנות הפנסיה ${at}, בשקלי היום · אומדן`, value: ilsRound(s.pension ?? 0),
    formula: `סכום האומדנים של כל קרן פנסיה ברשימה: החיסכון ${at} ÷ מקדם ההמרה של הקרן. ${coefWhy}. תשואה שמרנית של 4% ברוטו, הפקדה שעולה 2% בשנה, אינפלציה 2%`,
    note: 'אומדן גס. לא מנכה את עלות הכיסוי הביטוחי, לא כולל מוצרים שאינם קרן פנסיה, קצבת זקנה מביטוח לאומי או מס. המקדם של כל קרן: בכרטיס שלה, עם העמוד בתקנון',
    inputs: rows.filter((r) => r.prod.startsWith('פנסיה')).map((r) => ({ label: r.name, v: ilsRound(r.c.out.pensionReal) })) });
  const a = s.act;
  return (
    <section className="panel sv-sum" aria-label="התמונה בקצרה">
      <dl className="sv-kpis">
        <div><dt>דמי ניהול בשנה</dt><dd><Sourced src={feesProv}><b className="num">{ilsRound(s.fees)}</b></Sourced></dd><dd className="sv-a">{rows.length > 1 ? `כל ${rows.length} המוצרים` : 'המוצר'}{s.feesAvg ? ', חלקם לפי הממוצע במסלול' : ', לפי דמי הניהול שלך'}{s.feesEx ? ', עם נתונים לדוגמה' : ''}</dd></div>
        {s.pension != null && (s.penBal > 0
          ? <div><dt>קצבה מהפנסיה, אומדן</dt><dd><Sourced src={penProv}><b className="num">{ilsRound(s.pension)}</b></Sourced> לחודש</dd><dd className="sv-a">{at}, בשקלי היום, תשואה 4%; {coefWhy}</dd></div>
          : <div><dt>קצבה מהפנסיה, אומדן</dt><dd>{firstPen ? <button type="button" className="linkbtn sv-u" onClick={() => onAmounts(firstPen.k)}>הזינו יתרה</button> : 'הזינו יתרה'}</dd><dd className="sv-a">בלי היתרה שלך מהדוח אין מה לאמוד; {coefWhy}</dd></div>)}
      </dl>
      {rep && coefF && <ReplaceLines rep={rep} coefF={coefF} salary={salary!} pension={s.pension!} />}
      <p className="sv-one"><b>דבר אחד לעשות:</b>{' '}
        {a.kind === 'fee' ? <>לבקש הפחתת דמי ניהול ב<button type="button" className="linkbtn sv-u" onClick={() => onProduct(a.k)}>{rows.filter((r) => r.prod === a.prod).length === 1 ? shortName(a.name, a.prod) : a.name}</button>: כ-{ilsRound(a.v)} פחות בחיסכון {a.prod === 'השתלמות' ? `בעוד ${a.years} שנים` : 'בגיל הפרישה'}, {a.ref === 'med' ? (a.own ? 'לעומת חציון הממוצע בפועל בקטגוריה' : 'לעומת החציון בקטגוריה') : 'לעומת מחיר קרנות ברירת המחדל'}{a.own ? '' : ' (לפי הממוצע במסלול)'}. ההודעה בכרטיס.</>
          : a.kind === 'enter' ? <>להזין את דמי הניהול מהדוח השנתי ב<button type="button" className="linkbtn sv-u" onClick={() => onProduct(a.k)}>{a.name}</button>: בלי זה החישוב לפי הממוצע במסלול.</>
          : <>לבדוק בדוח השנתי שהמוטבים מעודכנים (<Link to="/my/statement#st-ben">איפה זה בדוח</Link>). דמי הניהול שלך לא גבוהים מהחציון באף מוצר.</>}
      </p>
    </section>
  );
}
/** W6: the replacement rate in three lines: pension ÷ last salary, the same with the National Insurance basic old-age pension, and the
 *  benchmark the literature uses (70%). Facts of the arithmetic on the estimate above, not a recommendation. */
function ReplaceLines({ rep, coefF, salary, pension }: { rep: NonNullable<ReturnType<typeof replacementOf>>; coefF: CoefFile; salary: number; pension: number }) {
  const b = coefF.btl, t = coefF.target;
  const from = `${b.from.slice(8, 10)}.${b.from.slice(5, 7)}.${b.from.slice(0, 4)}`;
  const btlProv = (): Prov => ({ k: 'report', title: 'קצבת אזרח ותיק (זקנה) בסיסית ליחיד', value: `${b.single.toLocaleString('en-US')} ש"ח לחודש`, url: b.url, pg: null, doc: b.title, period: `מ-${from}`, note: `${b.quote}. ${b.note ?? ''} נקרא ${b.retrieved}` });
  const tgtProv = (): Prov => ({ k: 'report', title: 'יחס תחלופה מקובל', value: `${t.rate}%`, url: t.url, pg: t.pg ?? null, doc: t.title, note: `${t.quote ? `"${t.quote}". ` : ''}${t.note ?? ''}` });
  const rateProv = (withBtl: boolean) => (): Prov => ({ k: 'calc', est: true, title: `יחס תחלופה ${withBtl ? 'עם' : 'בלי'} קצבת זקנה מביטוח לאומי`, value: pct0(withBtl ? rep.withBtl : rep.noBtl),
    formula: withBtl ? '(אומדן הקצבה מהפנסיה + קצבת אזרח ותיק בסיסית ליחיד) ÷ השכר ברוטו לחודש' : 'אומדן הקצבה מהפנסיה ÷ השכר ברוטו לחודש שהזנת',
    note: 'הקצבה באומדן לפני מס ובשקלי היום; השכר ברוטו. יחס התחלופה במאמר האוצר הוא נטו, מול ההכנסה הפנויה, ולכן אינו זהה',
    inputs: [{ label: 'קצבה מהפנסיה, אומדן', v: ilsRound(pension) }, ...(withBtl ? [{ label: `קצבת אזרח ותיק בסיסית ליחיד (מ-${from})`, v: ilsRound(rep.btl), src: btlProv }] : []), { label: 'שכר ברוטו לחודש (שלך)', v: ilsRound(salary) }] });
  return (
    <ul className="sv-lines sv-rep" aria-label="יחס תחלופה">
      <li><span className="sv-dot" aria-hidden="true" /><span>יחס תחלופה בלי ביטוח לאומי: <Sourced src={rateProv(false)}><b className="num">{pct0(rep.noBtl)}</b></Sourced> מהשכר ברוטו.</span></li>
      <li><span className="sv-dot" aria-hidden="true" /><span>עם קצבת אזרח ותיק בסיסית ליחיד (<Sourced src={btlProv}><span className="num">{b.single.toLocaleString('en-US')} ש"ח</span></Sourced>, מ-{from}): <Sourced src={rateProv(true)}><b className="num">{pct0(rep.withBtl)}</b></Sourced>.</span></li>
      <li><span className="sv-dot" aria-hidden="true" /><span>יעד מקובל: <Sourced src={tgtProv}><span className="num">{t.rate}%</span></Sourced> ומעלה (משרד האוצר, 2016: "המינימום המקובל"; יחס נטו, לא יעד רשמי). תיאור, לא המלצה.</span></li>
    </ul>
  );
}
/** "קרן הפנסיה" / "קרן ההשתלמות" when the reader has one of each; the full name otherwise */
function shortName(name: string, prod: string) {
  return prod === 'פנסיה מקיפה' || prod === 'פנסיה כללית' ? 'קרן הפנסיה' : prod === 'השתלמות' ? 'קרן ההשתלמות' : name;
}
