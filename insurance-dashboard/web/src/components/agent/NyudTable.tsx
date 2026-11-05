import type { ReactNode } from 'react';
import { A1_COLS, HNM, fullCost, ilsSigned, type Basis, type NyudRow, type NyudTableOut } from '../../lib/nyud';
import { nf } from '../../lib/format';
import { NyudCover } from './NyudCover';  // W11: the bylaws / claims-adjusted cover price when both sides are comprehensive funds

/* W7 · the ניוד before/after table (lib/nyud), on the client document (print) and on /clients (screen). Each existing product against
   each candidate: this year's fee cost, the projected savings at retirement on one basis, the cover cost a month when both sides have
   one, the annuity at a guaranteed coefficient against the fund's bylaws coefficient, the השתלמות liquidity clock, the rules' notes and
   the circular's questions answered "yes"; then part א.1 of נספח א' as the circular orders it: a row before and a row after. Facts of
   arithmetic on stated inputs, not a recommendation. */

const ILS = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const PC = (v: number) => `${nf(v, 2)}%`;
/** fox 3.0 phase 2: on screen the circular is named by its title and date (its number, 2018-10-11, reads as an ISO date); the print keeps it */
const CIRC_SCREEN = 'חוזר סוכנים ויועצים "מסמך הנמקה – תיקון" (18.07.2018; בתוקף מ-01.07.2019)';

export function NyudTable({ out, print = false, basis, onBasis, asofText }: { out: NyudTableOut; print?: boolean; basis: Basis; onBasis?: (b: Basis) => void; asofText: string }) {
  const fc = fullCost(out.rows);
  if (!out.rows.length) return (
    <section className={print ? 'nyud' : 'nyud screen'}>
      <h2>ניוד: לפני ואחרי</h2>
      <p className="adoc-cap">אין זוג להשוואה: צריך מוצר קיים עם יתרה או הפקדה בקובץ המסלקה ומסלול שסומן "מומלץ" או "נבחן".{out.skipped.length ? ` הושמטו: ${out.skipped.join('; ')}.` : ''}</p>
    </section>
  );
  return (
    <section className={print ? 'nyud' : 'nyud screen'} aria-label="ניוד: לפני ואחרי">
      <div className="nyud-h">
        <h2>ניוד: לפני ואחרי, בשקלים</h2>
        {onBasis && <div className="nyud-basis" role="group" aria-label="בסיס החישוב">
          <button type="button" className="chip" aria-pressed={basis === 'fox'} onClick={() => onBasis('fox')}>הנחות האתר</button>
          <button type="button" className="chip" aria-pressed={basis === 'annexB'} onClick={() => onBasis('annexB')}>הנחות נספח ב'</button>
        </div>}
      </div>
      <p className="adoc-cap">{out.basisText}. חיסכון צפוי בגיל הפרישה בשקלים של היום; "+" = במסלול המוצע נשאר יותר כסף בגלל דמי הניהול בלבד, בלי הבדל בתשואה (הנחת תשואה זהה לשני הצדדים). דמי הניהול של המוצע: מחיר המכרז לקרן ברירת מחדל, אחרת הממוצע בפועל של המסלול; דמי הניהול שיוצעו ללקוח יכולים להיות שונים.</p>
      <table className="adoc-t nyud-t">
        <thead><tr><th scope="col">קיים ← מוצע</th><th scope="col">ד"נ לשנה היום</th><th scope="col">חיסכון צפוי בפרישה</th><th scope="col">הפרש בפרישה</th><th scope="col">כיסוי נכות/שאירים לחודש</th><th scope="col">קצבה במקדם</th><th scope="col">נזילות וותק</th></tr></thead>
        <tbody>{out.rows.map((r, i) => <Row key={i} r={r} />)}</tbody>
        {fc && <tfoot><tr><th scope="row">סך דמי ניהול לשנה ({fc.n} זוגות)</th><td><bdi dir="ltr">{ILS(fc.own)} ← {ILS(fc.cand)}</bdi></td><td colSpan={5} className="src">סך העלות של דמי הניהול במוצר הקיים ובמוצר המוצע, לפי {HNM.sections.fullCost}; לפי הנתונים שלמעלה, לא לפי נספח ב' במלואו (ראו הערה).</td></tr></tfoot>}
      </table>
      <NyudCover rows={out.rows} />
      <Notes rows={out.rows} />
      <h3>חלק א.1 בסדר החוזר: שורה לפני ושורה אחרי</h3>
      <p className="adoc-cap">לפי {HNM.sections.a1} ו-{HNM.sections.beforeAfter} ל{print ? HNM.title : CIRC_SCREEN}: מוצר שמשתנה בשתי שורות עוקבות, "לא שונה" בפרמטר שאינו משתנה. "המלצה" ו"השיקולים העיקריים" נשארים לבעל הרישיון. תשואה ברוטו: ממוצע שנתי ל-36 חודשים, נתוני {asofText}.</p>
      <div className="nyud-a1">
        <table className="adoc-t annex-t a1x">
          <thead><tr><th scope="col" /> {A1_COLS.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>{out.rows.map((r, i) => <>
            <tr key={`${i}b`} className="before"><th scope="row">לפני</th>{A1_COLS.map((c) => <td key={c}>{r.annex.before[c] || <span className="blank"><span className="sr-only">להשלמה</span></span>}</td>)}</tr>
            <tr key={`${i}a`} className="after"><th scope="row">אחרי</th>{A1_COLS.map((c) => <td key={c}>{r.annex.after[c] || <span className="blank"><span className="sr-only">להשלמה</span></span>}</td>)}</tr>
          </>)}</tbody>
        </table>
      </div>
      {out.skipped.length > 0 && <p className="adoc-cap">לא בטבלה: {out.skipped.join('; ')}.</p>}
    </section>
  );
}

function Row({ r }: { r: NyudRow }) {
  const f = r.fee;
  return (
    <tr>
      <th scope="row"><b>{r.existName}</b><span>← {r.cand.name} · {r.cand.prod}{r.cand.id != null ? ` · מס' ${r.cand.id}` : ''}</span>
        {f && (f.exBalance || f.exMonthly) && <span className="q">{f.exBalance ? 'יתרה לדוגמה ₪100,000' : ''}{f.exBalance && f.exMonthly ? ', ' : ''}{f.exMonthly ? 'הפקדה לדוגמה' : ''}: אין בקובץ</span>}
        {f?.own.basis === 'avg' && <span className="q">{f.own.how}</span>}</th>
      {f ? <>
        <td><bdi dir="ltr">{ILS(f.annualOwn)} ← {ILS(f.annualCand)}</bdi><span className="q"><bdi dir="ltr">{PC(f.own.pair.depfee)} / {PC(f.own.pair.fee)}</bdi> ← <bdi dir="ltr">{PC(f.cand.pair.depfee)} / {PC(f.cand.pair.fee)}</bdi>{f.cand.basis === 'tender' ? ' (מחיר המכרז)' : ''}</span></td>
        <td><bdi dir="ltr">{ILS(f.balOwn)} ← {ILS(f.balCand)}</bdi><span className="q">{Math.round(f.years)} שנים, על יתרה {ILS(f.balance)} והפקדה {ILS(f.monthly)} לחודש</span></td>
        <td className={f.balRealDiff > 0 ? 'pos' : f.balRealDiff < 0 ? 'neg' : undefined}><b><bdi dir="ltr">{ilsSigned(f.balRealDiff)}</bdi></b><span className="q">דמי ניהול שנחסכים: <bdi dir="ltr">{ilsSigned(f.feesRealDiff)}</bdi></span></td>
      </> : <td colSpan={3} className="src">{r.feeWhy}</td>}
      <td>{r.cover.diff != null ? <><bdi dir="ltr">{ILS(r.cover.exist)} ← {ILS(r.cover.cand)}</bdi><span className="q">הפרש <bdi dir="ltr">{ilsSigned(r.cover.diff)}</bdi> לחודש, {r.cover.n} כיסויים, מהקובץ</span></> : <span className="q">{r.cover.exist != null ? `קיים: ${ILS(r.cover.exist)} לחודש. ` : ''}{r.cover.why}</span>}</td>
      <td>{r.coef ? <><bdi dir="ltr">{ILS(r.coef.annG)} ← {ILS(r.coef.annC)}</bdi><span className="q">מקדם {r.coef.guaranteed} מובטח ← {r.coef.cand.v} {r.coef.cand.real ? `מהתקנון (${r.coef.cand.label})` : 'לפי הנחה'}; הפרש <bdi dir="ltr">{ilsSigned(-r.coef.diff)}</bdi> לחודש</span></> : <span className="q">{r.coefWhy ?? (r.cand.pen ? 'אין מקדם מובטח במוצר הקיים לפי הקובץ' : '–')}</span>}</td>
      <td className="src">{r.seniority ? r.seniority.text : r.cand.prod === 'השתלמות' ? '–' : 'לא רלוונטי (לא קרן השתלמות)'}</td>
    </tr>
  );
}

/** the notes and the questions of every row, once each */
function Notes({ rows }: { rows: NyudRow[] }) {
  const notes = [...new Set(rows.flatMap((r) => r.notes))];
  const qs = rows.flatMap((r) => r.questions.map((q) => ({ q, r })));
  const items: ReactNode[] = [];
  if (qs.length) items.push(<li key="q"><b>שאלות {HNM.sections.questions} שהנתונים עונים עליהן "כן"</b> (החוזר: רק השאלות שנענו בחיוב נכללות): <ul>{qs.map(({ q, r }, i) => <li key={i}>({q.id}) {q.text} <b>כן</b>: {r.existName} ← {r.cand.name}. {q.detail}</li>)}</ul></li>);
  rows.filter((r) => r.coefWhy).forEach((r, i) => items.push(<li key={`c${i}`}>{r.coefWhy}</li>));
  notes.forEach((n, i) => items.push(<li key={`n${i}`}>{n}</li>));
  if (!items.length) return null;
  return <ul className="nyud-notes">{items}</ul>;
}
