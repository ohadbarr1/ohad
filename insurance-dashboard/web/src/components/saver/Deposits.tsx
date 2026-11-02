import { useEffect, useMemo, useRef } from 'react';
import { Sourced } from '../Source';
import { Tip } from '../Explain';
import type { Prov } from '../../lib/prov';
import type { DepositRow } from '../../lib/clientTypes';
import type { FundX } from '../../lib/funds';
import type { MyProduct } from '../../lib/mine';
import { ilsRound } from '../../lib/retire';
import { AVG_WAGE, DEADLINE_DAY, HISH_CAP_MONTHLY, PENSION_RATES, PENSION_SINCE, RATES_YEAR, SEVERANCE_FULL, SRC, addMonths, auditDeposits, dateHe, defaultRates, depSummary, kindOf, letterOf, monthsWindow, rateTotal, ymHe, type Audit, type DepKind, type Rates } from '../../lib/deposits';
import { Script } from './Script';

/* W7 saver · the deposit watchdog on the card: the 12 rows of the statement's table ה' (typed here, or imported from the clearing-house
   file), the expected monthly deposit on the insured salary and the rates (editable), what is missing, short or late, in ₪, and the letter
   to the employer. Pure arithmetic in lib/deposits; this file is the grid and the words. Descriptive: it never says what to do with the
   money, only what the statement shows against what the order and the regulations require. */

const num = (s: string): number | null => { const t = s.replace(/[,\s₪]/g, ''); if (t === '') return null; const x = Number(t); return Number.isFinite(x) ? x : null; };
const N = 12;

/** the saver's deposit rows, the salary they are read against and the audit, shared by the folded line and the section */
export function useDepAudit(f: FundX, my: MyProduct | undefined, profileSalary: number | null): { kind: DepKind | null; rows: DepositRow[]; salary: number | null; rates: Rates; audit: Audit | null } {
  const kind = kindOf(f.prod);
  const rows = useMemo(() => (Array.isArray(my?.deposits) ? my!.deposits!.filter((r) => r && typeof r.ym === 'string') : []), [my?.deposits]);
  const rates = my?.depRates ?? (kind ? defaultRates(kind) : defaultRates('pension'));
  const rowSal = rows.map((r) => r.salary).filter((x): x is number => x != null && x > 0).pop() ?? null;
  const salary = my?.salary ?? profileSalary ?? rowSal;
  const audit = useMemo(() => (kind && salary && rows.length ? auditDeposits(rows, salary, rates, kind) : null), [kind, salary, rows, rates]);
  return { kind, rows, salary, rates, audit };
}

/** the folded card's one line, only when there is something to report */
export function DepLine({ audit, onOpen }: { audit: Audit | null; onOpen: () => void }) {
  const s = audit ? depSummary(audit) : null;
  if (!s) return null;
  return <p className="sv-dep-line t-bad"><span className="sv-dot" aria-hidden="true" /><span>הפקדות מהמעסיק: {s}. <button type="button" className="linkbtn sv-u" onClick={onOpen}>לבדיקה ולמכתב</button></span></p>;
}

export function Deposits({ f, my, onChange, profileSalary, third, focus }: { f: FundX; my: MyProduct | undefined; onChange: (p: Partial<MyProduct>) => void; profileSalary: number | null; third: boolean; focus?: boolean }) {
  const { kind, rows, salary, rates, audit } = useDepAudit(f, my, profileSalary);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [focus]);
  if (!kind) return null;
  const months = monthsWindow(rows, N);
  const setRows = (next: DepositRow[]) => onChange({ deposits: next.filter((r) => r.employee != null || r.employer != null || r.severance != null || r.total != null || r.paid) });
  const rowOf = (ym: string): DepositRow => rows.find((r) => r.ym === ym) ?? { ym };
  const patchRow = (ym: string, p: Partial<DepositRow>) => { const has = rows.some((r) => r.ym === ym); setRows(has ? rows.map((r) => (r.ym === ym ? { ...r, ...p } : r)) : [...rows, { ym, ...p }]); };
  const setRate = (k: keyof Rates, v: number | null) => { if (v == null || v < 0 || v > 20) return; onChange({ depRates: { ...rates, [k]: v } }); };
  const isPen = kind === 'pension';
  const minimum = isPen && rateTotal(rates) === rateTotal(PENSION_RATES) && rates.employee === PENSION_RATES.employee;
  const gapProv = (): Prov => ({ k: 'calc', est: false, title: `הפרש ההפקדות ב-${N} החודשים · ${f.name}`, value: ilsRound(audit?.totalGap ?? 0),
    formula: `לכל חודש: ההפקדה הצפויה (שכר מבוטח × ${rateTotal(rates)}%${kind === 'hishtalmut' ? `, עד תקרת שכר של ${HISH_CAP_MONTHLY.toLocaleString('en-US')} ש"ח` : ''}) פחות מה שהגיע לקרן לפי השורות; חודש בלי שורה נספר במלואו. הפרש של עד 1% (לפחות 20 ש"ח) נחשב עיגול`,
    note: `השורות: ${my?.imp ? 'מקובץ המסלקה ומה שהוקלד' : 'מה שהוקלד מטבלה ה\' בדוח השנתי'}. ${isPen ? `השיעורים: ${minimum ? 'המינימום בצו ההרחבה ממשכורת ' + PENSION_SINCE : 'לפי מה שהוזן כאן'}` : 'השיעורים לפי ההסכם עם המעסיק; אין חובה בחוק להפקיד להשתלמות'}`,
    inputs: [{ label: 'שכר מבוטח לחודש', v: ilsRound(salary ?? 0) }, { label: 'עובד', v: `${rates.employee}%` }, { label: 'מעסיק', v: `${rates.employer}%` }, ...(isPen ? [{ label: 'פיצויים', v: `${rates.severance}%` }] : []),
      ...(audit ? [{ label: 'צפוי בסך הכול', v: ilsRound(audit.totalExp) }, { label: 'הגיע לקרן', v: ilsRound(audit.totalGot) }] : [])] });
  const letter = audit ? letterOf(audit, { fund: f.name, prod: f.prod, id: f.id, third }) : null;
  return (
    <section ref={ref} className="sv-sec sv-deps" id={`${f.k}-deposits`} aria-labelledby={`${f.k}-deps-h`}>
      <h3 id={`${f.k}-deps-h`}>ההפקדות מהמעסיק<span className="sv-tag">בדיקה</span><Tip k="deposits" /></h3>
      <p>{my?.deposits?.length && my.imp ? 'השורות הגיעו מקובץ המסלקה; אפשר לתקן או להשלים.' : <>העתיקו את {N} השורות מטבלה ה' בדוח השנתי (חודש משכורת, תגמולי עובד, תגמולי מעסיק{isPen ? ', פיצויים' : ''}). הבדיקה משווה כל חודש להפקדה הצפויה מהשכר.</>}</p>

      <div className="sv-dep-rates">
        <label className="sv-dep-f"><span>שכר מבוטח לחודש, ש"ח</span><input type="number" inputMode="numeric" min={0} step={100} placeholder="מהדוח, טבלה ה'" defaultValue={my?.salary ?? ''} onChange={(e) => { const x = num(e.target.value); onChange({ salary: x }); }} /></label>
        <label className="sv-dep-f sm"><span>עובד %</span><input type="number" inputMode="decimal" min={0} max={20} step={0.25} value={rates.employee} onChange={(e) => setRate('employee', num(e.target.value))} /></label>
        <label className="sv-dep-f sm"><span>מעסיק %</span><input type="number" inputMode="decimal" min={0} max={20} step={0.25} value={rates.employer} onChange={(e) => setRate('employer', num(e.target.value))} /></label>
        {isPen && <label className="sv-dep-f sm"><span>פיצויים %</span><input type="number" inputMode="decimal" min={0} max={20} step={0.01} value={rates.severance} onChange={(e) => setRate('severance', num(e.target.value))} /></label>}
        {isPen && <button type="button" className="sv-chip sm" aria-pressed={rates.severance === SEVERANCE_FULL} onClick={() => onChange({ depRates: { ...rates, severance: rates.severance === SEVERANCE_FULL ? PENSION_RATES.severance : SEVERANCE_FULL } })}>פיצויים מלאים {SEVERANCE_FULL}%</button>}
        {my?.depRates && <button type="button" className="linkbtn" onClick={() => onChange({ depRates: null })}>{isPen ? 'למינימום בצו' : 'ל-2.5% ו-7.5%'}</button>}
      </div>
      <p className="sv-note">{isPen
        ? <>המינימום לפי צו ההרחבה ממשכורת {PENSION_SINCE}: {PENSION_RATES.employee}% עובד, {PENSION_RATES.employer}% מעסיק ו-{PENSION_RATES.severance}% פיצויים ({rateTotal(PENSION_RATES)}%); פיצויים מלאים: {SEVERANCE_FULL}%. הצו מחשב את המינימום על שכר הבסיס או על השכר הממוצע במשק ({AVG_WAGE.toLocaleString('en-US')} ש"ח ב-{RATES_YEAR}), הנמוך מביניהם; בהסכם אפשר יותר, והדוח שלכם אומר כמה. <a href={SRC.order.url} target="_blank" rel="noreferrer">כל זכות</a></>
        : <>אין חובה בחוק להפקיד לקרן השתלמות; כשסוכם, בדרך כלל 2.5% עובד ו-7.5% מעסיק, עם הטבת מס עד שכר של {HISH_CAP_MONTHLY.toLocaleString('en-US')} ש"ח לחודש ({RATES_YEAR}). <a href={SRC.hish.url} target="_blank" rel="noreferrer">כל זכות</a></>}</p>

      <div className="scroll"><table className="sv-dep-grid" aria-label={`הפקדות לפי חודש, ${f.name}`}>
        <thead><tr><th scope="col">חודש</th>{audit && <th scope="col">מול הצפוי</th>}<th scope="col">עובד</th><th scope="col">מעסיק</th>{isPen && <th scope="col">פיצויים</th>}<th scope="col">הגיע לקרן ב-</th></tr></thead>
        <tbody>
          {months.map((ym) => {
            const r = rowOf(ym), m = audit?.months.find((x) => x.ym === ym);
            const cell = (k: 'employee' | 'employer' | 'severance') => <td><input type="number" inputMode="decimal" min={0} step={1} aria-label={`${ymHe(ym)} ${k === 'employee' ? 'עובד' : k === 'employer' ? 'מעסיק' : 'פיצויים'}`} value={r[k] ?? ''} onChange={(e) => patchRow(ym, { [k]: num(e.target.value) })} /></td>;
            return (
              <tr key={ym} className={m ? `st-${m.status}${m.lateDays ? ' late' : ''}` : undefined}>
                <th scope="row" className="num">{ymHe(ym)}</th>
                {audit && <td className="sv-dep-st">{!m ? '' : m.status === 'missing' ? 'אין הפקדה' : m.status === 'short' ? `חסרים כ-${ilsRound(m.gap)}` : m.status === 'over' ? 'יותר מהצפוי' : 'תקין'}{m?.lateDays ? `; ${m.lateDays} ימי איחור` : ''}</td>}
                {cell('employee')}{cell('employer')}{isPen && cell('severance')}
                <td><input type="date" aria-label={`${ymHe(ym)} תאריך ההפקדה`} value={r.paid ?? ''} min={`${ym}-01`} max={`${addMonths(ym, 12)}-28`} onChange={(e) => patchRow(ym, { paid: e.target.value || null })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <p className="sv-note">מועד ההפקדה (לא חובה): מהעמודה "מועד הפקדה" בדוח. הפקדה שהגיעה אחרי ה-{DEADLINE_DAY} בחודש העוקב מסומנת כאיחור, המועד המאוחר ביותר שהתקנות מתירות (7 ימי עסקים מתשלום המשכורת או 15 יום מתום החודש, המוקדם). <a href={SRC.transfer.url} target="_blank" rel="noreferrer">כל זכות</a></p>

      {!salary && rows.length > 0 && <p className="sv-note sv-err">בלי שכר מבוטח אין למה להשוות: הזינו אותו למעלה (מהדוח, טבלה ה'), או בראש העמוד.</p>}
      {audit && (
        <div className="sv-dep-out">
          {audit.missing.length === 0 && audit.short.length === 0 && audit.late.length === 0
            ? <p className="sv-big">כל {N} החודשים הופקדו בסכום הצפוי{audit.late.length === 0 && audit.months.some((m) => m.paid) ? ' ובזמן' : ''}. <span className="sv-a">מול שכר של {ilsRound(salary!)} ו-{rateTotal(rates)}%</span></p>
            : <>
              <p className="sv-big">חסרים <span className="sv-nw">כ-<Sourced src={gapProv}><b className="sv-ils num">{ilsRound(audit.totalGap)}</b></Sourced></span> ב-{N} החודשים.</p>
              <ul className="sv-lines">
                {audit.missing.length > 0 && <li className="t-bad"><span className="sv-dot" aria-hidden="true" /><span>בלי הפקדה: {audit.missing.map((m) => ymHe(m.ym)).join(', ')} (כ-{ilsRound(audit.missing[0].exp.total)} לחודש).</span></li>}
                {audit.short.map((m) => <li key={m.ym} className="t-bad"><span className="sv-dot" aria-hidden="true" /><span>{ymHe(m.ym)}: הופקדו {ilsRound(m.got ?? 0)} במקום כ-{ilsRound(m.exp.total)}, חסרים כ-{ilsRound(m.gap)}.</span></li>)}
                {audit.late.map((m) => <li key={`l${m.ym}`} className="t-mid"><span className="sv-dot" aria-hidden="true" /><span>{ymHe(m.ym)} הגיעה ב-{dateHe(m.paid!)}, {m.lateDays} ימים אחרי המועד האחרון ({dateHe(`${addMonths(m.ym, 1)}-${DEADLINE_DAY}`)}). על איחור מגיעה לקופה ריבית פיגורים מה-16 בחודש העוקב.</span></li>)}
              </ul>
            </>}
          <p className="sv-note">הפקדה שירדה מהשכר ולא הגיעה לקרן נחשבת כאילו לא הועברה. פנייה ראשונה למעסיק ולקרן; אם ההפקדות לא מושלמות, תלונה על המעסיק ל<a href={SRC.complain.url} target="_blank" rel="noreferrer">מינהל הסדרה ואכיפת חוקי עבודה במשרד העבודה</a> (מוקד 1-800-354-354); על התנהלות הקרן עצמה, ל<a href={SRC.authority.url} target="_blank" rel="noreferrer">יחידה לפניות הציבור ברשות שוק ההון</a> (*3002).</p>
          {letter && <>
            <h4 className="sv-dep-h4">מכתב למעסיק, להעתקה</h4>
            <Script text={letter} label="מכתב למעסיק" note="עובדות ומספרים מהדוח שלכם; כדאי לבדוק מול התלושים לפני השליחה." />
          </>}
        </div>
      )}
    </section>
  );
}
