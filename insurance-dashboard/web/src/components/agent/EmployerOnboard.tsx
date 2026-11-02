import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel } from '../ui';
import { Icon } from '../Icon';
import { nf } from '../../lib/format';
import type { FundX } from '../../lib/funds';
import { priceOf, type Tender } from '../../lib/fundsTools';
import { winnerTrack } from '../../lib/pensionPack';
import { allocOf } from '../../lib/nyud';
import { DEFAULT_RULE, DOC_B } from '../../lib/hanmaka';
import { AGE_DEFAULT, BALANCE_EX, GROWTH_DEFAULT, INFL_DEFAULT, RETIRE_AGE, RET_FALLBACK, exampleMonthly, horizon, project, type Plan } from '../../lib/retire';
import { feeError } from '../../lib/feeCaps';
import { upsert, useClients } from '../../lib/clients';
import { today } from '../../lib/visits';
import '../../styles/agent.css';

/* W7 · /funds/default, agent door: employer onboarding. The employer's size (the 50-employee threshold of the regulator's clarification
   שה.2025-1264, footnote 1) and the employee's ID check digit give the default fund the mechanism assigns (the tender's `alloc`, parsed
   by lib/nyud allocOf) at the tender price; against a fund the agent picks at its actual average fee and at a fee the agent types; ₪
   over 10 years and to retirement on lib/retire's projection, today's ₪. "Add both to a client folder" saves the two tracks, tagged
   "נבחן", with the figures in the folder's note. Arithmetic on stated inputs; not a recommendation. */

const ILS = (v: number) => `₪${Math.round(v).toLocaleString('en-US')}`;
const sgn = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}₪${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
const PC = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 2)}%`);
const PROD = 'פנסיה מקיפה';
const num = (s: string) => { const v = Number(s.replace(/[^\d.]/g, '')); return Number.isFinite(v) ? v : 0; };

export function EmployerOnboard({ funds, now, asof }: { funds: FundX[]; now: Tender | null; asof: number }) {
  const [big, setBig] = useState<'big' | 'small'>('big');
  const [digit, setDigit] = useState<string>('');
  const [balance, setBalance] = useState(String(BALANCE_EX));
  const [monthly, setMonthly] = useState(String(exampleMonthly(PROD).v));
  const [age, setAge] = useState(String(AGE_DEFAULT));
  const [pick, setPick] = useState('');
  const [negFee, setNegFee] = useState('');
  const [negDep, setNegDep] = useState('');
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [file, setFile] = useClients();
  const alloc = useMemo(() => allocOf(now?.alloc), [now]);
  const tracks = useMemo(() => funds.filter((f) => f.prod === PROD && (f.assets ?? 0) > 0 && !f.closed && !f.gone).sort((a, b) => a.grp.localeCompare(b.grp, 'he') || (b.assets ?? 0) - (a.assets ?? 0)), [funds]);
  const chosen = tracks.find((f) => f.k === pick) ?? null;
  const d = digit === '' ? null : Number(digit);
  const winners = now?.winners ?? [];
  const assigned = big === 'big' && d != null && alloc.size ? winners.find((w) => w.grp === alloc.get(d)) ?? null : null;
  const assignedTrack = assigned ? winnerTrack(assigned, funds) : null;
  const price = (w: typeof winners[number]) => (now ? priceOf(now, w) : { fee: null, depfee: null });
  const plan: Plan = { age: Math.min(Math.max(num(age) || AGE_DEFAULT, 16), RETIRE_AGE - 1), retire: RETIRE_AGE, balance: num(balance), monthly: num(monthly), growth: GROWTH_DEFAULT, infl: INFL_DEFAULT, ret: RET_FALLBACK, coef: 200 };
  const run = (fee: number, depfee: number) => ({ y10: project(horizon(plan, 10), { fee, depfee }), ret: project(plan, { fee, depfee }) });
  const negErr = chosen ? (feeError(PROD, 'fee', negFee ? num(negFee) : null) ?? feeError(PROD, 'depfee', negDep ? num(negDep) : null)) : null;
  interface Line { key: string; who: string; sub: string; fee: number; depfee: number; k: string | null; basis: string }
  const lines: Line[] = [];
  if (assigned && now) { const p = price(assigned); if (p.fee != null && p.depfee != null) lines.push({ key: 'dflt', who: `קרן ברירת המחדל לפי ספרת הביקורת ${d}: ${assigned.grp}`, sub: `מחיר המכרז (${now.label ?? now.id})${assignedTrack ? ` · ${assignedTrack.name}` : ''}`, fee: p.fee, depfee: p.depfee, k: assignedTrack?.k ?? null, basis: 'tender' }); }
  if (big === 'small' && now) for (const w of winners) { const p = price(w); if (p.fee != null && p.depfee != null) lines.push({ key: `w-${w.grp}`, who: `קרן נבחרת: ${w.grp}`, sub: `מחיר המכרז (${now.label ?? now.id}); למעסיק קטן אין שיבוץ לפי ספרה`, fee: p.fee, depfee: p.depfee, k: winnerTrack(w, funds)?.k ?? null, basis: 'tender' }); }
  if (chosen && chosen.fee != null) lines.push({ key: 'avg', who: `${chosen.grp}: ${chosen.name}`, sub: `הממוצע בפועל של המסלול (${Math.floor(asof / 100)}/${String(asof % 100).padStart(2, '0')})`, fee: chosen.fee, depfee: chosen.depfee ?? 0, k: chosen.k, basis: 'avg' });
  if (chosen && negFee && !negErr) lines.push({ key: 'neg', who: `${chosen.grp}: ${chosen.name}`, sub: 'דמי ניהול שהוסכמו (הקלדת הסוכן)', fee: num(negFee), depfee: negDep ? num(negDep) : 0, k: chosen.k, basis: 'neg' });
  const runs = lines.map((l) => ({ l, r: run(l.fee, l.depfee) }));
  const base = runs[0];
  const addBoth = () => {
    const keys = [...new Set(lines.map((l) => l.k).filter((k): k is string => !!k))];
    if (!keys.length) { setMsg('אין מסלולים להוספה (לקרן שנקבעה אין מסלול פתוח שמתפרסם)'); return; }
    const lab = label.trim();
    if (!lab) { setMsg('צריך שם או כינוי ללקוח'); return; }
    const note = `קליטה אצל מעסיק (${today().split('-').reverse().join('.')}): ${big === 'big' ? `מעסיק של ${DEFAULT_RULE.employees} עובדים ומעלה, ספרת ביקורת ${d}` : `מעסיק של פחות מ-${DEFAULT_RULE.employees} עובדים`}. ${runs.map(({ l, r }) => `${l.who} (${PC(l.depfee)} / ${PC(l.fee)}, ${l.sub}): חיסכון צפוי ${ILS(r.ret.balReal)} בגיל ${RETIRE_AGE}`).join('; ')}. יתרה ${ILS(plan.balance)}, הפקדה ${ILS(plan.monthly)} לחודש, גיל ${plan.age}; הנחות האתר. לא המלצה.`;
    const r = upsert(file, { label: lab, keys, b: 'net', tags: Object.fromEntries(keys.map((k) => [k, 'נבחן' as const])), note, fields: { 'onb:neg': negFee ? `${negDep || 0}% / ${negFee}%` : '' } }, today());
    setFile(r.file);
    setMsg(`${r.created ? 'נשמר בתיק חדש' : 'התיק עודכן'}: ${r.folder.label} · ${keys.length} מסלולים`);
  };
  if (!now) return null;
  return (
    <Panel title="קליטת עובד אצל מעסיק: ברירת המחדל מול קרן נבחרת" aside={<span className="chip">סוכן</span>} className="onb">
      <p className="fnote">{DOC_B.defaultNotice[2].text} ({DOC_B.defaultNotice[2].sec}). {DOC_B.defaultNotice[3].text} ({DOC_B.defaultNotice[3].sec}, מ-{DEFAULT_RULE.from.split('-').reverse().join('.')}). {now.alloc ? `המנגנון בהליך ${now.id}: ${now.alloc.split(':').slice(1).join(':').split(';')[0].trim()}.` : 'לתקופה הזו לא נרשם מנגנון חלוקה.'}</p>
      <div className="onb-in">
        <fieldset><legend>המעסיק</legend>
          <label><input type="radio" name="onb-size" checked={big === 'big'} onChange={() => setBig('big')} /> {DEFAULT_RULE.employees} עובדים ומעלה (שיבוץ לפי ספרת הביקורת)</label>
          <label><input type="radio" name="onb-size" checked={big === 'small'} onChange={() => setBig('small')} /> פחות מ-{DEFAULT_RULE.employees} עובדים (כל קרן נבחרת, בהצהרת מעסיק)</label>
        </fieldset>
        {big === 'big' && <label>ספרת הביקורת בת"ז של העובד (האחרונה)<select value={digit} onChange={(e) => setDigit(e.target.value)} aria-label="ספרת הביקורת"><option value="">בחרו</option>{[...Array(10).keys()].map((i) => <option key={i} value={i}>{i}{alloc.get(i) ? ` · ${alloc.get(i)}` : ''}</option>)}</select></label>}
        <label>יתרה היום (₪)<input inputMode="numeric" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
        <label>הפקדה חודשית (₪)<input inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></label>
        <label>גיל<input inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} maxLength={2} /></label>
        <label>קרן להשוואה<select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="קרן להשוואה"><option value="">בחרו מסלול פנסיה מקיפה</option>{tracks.map((f) => <option key={f.k} value={f.k}>{f.grp} · {f.name}</option>)}</select></label>
        {chosen && <><label>ד"נ מצבירה שהוסכמו (%)<input inputMode="decimal" value={negFee} onChange={(e) => setNegFee(e.target.value)} placeholder={chosen.fee != null ? `ממוצע ${nf(chosen.fee, 2)}` : ''} /></label>
          <label>ד"נ מהפקדה שהוסכמו (%)<input inputMode="decimal" value={negDep} onChange={(e) => setNegDep(e.target.value)} placeholder={chosen.depfee != null ? `ממוצע ${nf(chosen.depfee, 2)}` : ''} /></label></>}
      </div>
      {negErr && <p role="alert" className="ci-err">{negErr}</p>}
      {lines.length > 0 ? <div className="scroll"><table className="fsimple onb-t">
        <caption className="sr-only">ברירת המחדל מול הקרן שנבחרה</caption>
        <thead><tr><th scope="col">קרן</th><th scope="col">ד"נ מהפקדה / מצבירה</th><th scope="col">ד"נ לשנה היום</th><th scope="col">חיסכון אחרי 10 שנים</th><th scope="col">חיסכון בגיל {RETIRE_AGE}</th><th scope="col">מול השורה הראשונה</th></tr></thead>
        <tbody>{runs.map(({ l, r }) => <tr key={l.key}>
          <td><b>{l.who}</b><span className="ci-sub">{l.sub}{l.k ? <> · <Link to={`/funds/${l.k}`}>כרטיס המסלול</Link></> : ''}</span></td>
          <td><span className="num">{PC(l.depfee)} / {PC(l.fee)}</span></td>
          <td><span className="num">{ILS((plan.balance * l.fee + plan.monthly * 12 * l.depfee) / 100)}</span></td>
          <td><span className="num">{ILS(r.y10.balReal)}</span></td>
          <td><span className="num">{ILS(r.ret.balReal)}</span></td>
          <td>{base && l !== base.l ? <span className={`num ${r.ret.balReal - base.r.ret.balReal >= 0 ? 'pos' : 'neg'}`}>{sgn(r.ret.balReal - base.r.ret.balReal)}</span> : <span className="muted">בסיס</span>}</td>
        </tr>)}</tbody>
      </table></div> : <p className="fnote">{big === 'big' ? 'בחרו ספרת ביקורת, ואפשר גם קרן להשוואה.' : 'בחרו קרן להשוואה.'}</p>}
      <div className="fnote">שקלים של היום, על יתרה {ILS(plan.balance)} והפקדה {ILS(plan.monthly)} לחודש מגיל {plan.age} עד {RETIRE_AGE}; הנחות האתר: תשואה {RET_FALLBACK}% ברוטו, הפקדה שעולה {GROWTH_DEFAULT}% בשנה, אינפלציה {INFL_DEFAULT}%; ההבדל נובע מדמי הניהול בלבד (תשואה זהה לכולן). מחיר המכרז מובטח למצטרף דרך ההליך ל-10 שנים לפחות ({DOC_B.defaultNotice[1].sec}); דמי ניהול "שהוסכמו" הם הקלדה של הסוכן, לא הצעה של הגוף המנהל. לא המלצה.</div>
      {lines.length > 0 && <div className="onb-save">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="שם או כינוי ללקוח" maxLength={80} aria-label="שם או כינוי ללקוח" />
        <button type="button" className="chip" onClick={addBoth}><Icon name="inbox" /> הוספת המסלולים לתיק לקוח</button>
        {msg && <span role="status" className="csave-msg">{msg} · <Link to="/clients">תיקי לקוחות</Link></span>}
      </div>}
    </Panel>
  );
}
