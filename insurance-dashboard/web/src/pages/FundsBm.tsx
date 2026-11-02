import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { Sourced } from '../components/Source';
import { MgrChip } from '../components/MgrChip';
import { Empty, Field, Kpi, Loading, Panel, Seg } from '../components/ui';
import { NEW_COEF_SRC, bmCompare, bmLine, coefOk, newCoefDefault, COEF_MIN, COEF_MAX } from '../lib/bmCalc';
import type { Sex } from '../lib/retire';
import { useOptional } from '../lib/fundsLoad';
import { BM_CUTOFF, DECISION_PATH, bmProv, rankHe, srcOf, svcProv, type DecisionFile } from '../lib/decision';
import '../styles/agent.css';

/* W2 · /funds/bm: "ביטוחי מנהלים ישנים: מה בודקים לפני שעוזבים". The checklist of decision.json (bm_checklist): what a saver may
   lose when leaving an old managers'-insurance policy, each item with its source (Kol Zchut, written with the regulator; the uniform
   bylaws where a clause adds to it) and the quoted words. The two cutoffs the source gives for the guaranteed coefficient (before
   2013, before 2012) are both shown. The ticks are the reader's, on this page only. Descriptive, not advice. */

const OLD_PRODS = ['ביטוחי מנהלים 1990-1991', 'ביטוחי מנהלים 1992-2003'];
const screen = (p: string) => `/funds/screen?prod=${encodeURIComponent(p)}&track=all`;
const dateHe = (iso?: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

const numIn = (s: string): number | null => { const t = s.replace(/[,\s₪%]/g, ''); if (t === '') return null; const x = Number(t); return Number.isFinite(x) ? x : null; };
const ilsF = (v: number) => `₪${Math.round(v).toLocaleString('en-US')}`;

/** W5 · red team 3: the guaranteed coefficient of an old policy against a new pension fund, on the same balance. The policy's numbers
 *  are the reader's; the new fund's coefficient is an assumption (the site's, by sex), editable. Nothing is stored. */
function BmCalc() {
  const [bal, setBal] = useState('');
  const [cg, setCg] = useState('');
  const [sex, setSex] = useState<Sex | 'x'>('x');
  const [cn, setCn] = useState('');
  const [fee, setFee] = useState('');
  const [feeN, setFeeN] = useState('');
  const dflt = newCoefDefault(sex === 'x' ? null : sex);
  const B = numIn(bal), G = numIn(cg), N = numIn(cn) ?? dflt.v;
  const o = B != null && G != null ? bmCompare({ balance: B, coefG: G, coefNew: N, fee: numIn(fee), feeNew: numIn(feeN) }) : null;
  const bad = G != null && !coefOk(G) ? `מקדם ${G} מחוץ לטווח הסביר (${COEF_MIN}–${COEF_MAX}): לבדוק בפוליסה` : numIn(cn) != null && !coefOk(numIn(cn)) ? `מקדם ${numIn(cn)} לקרן חדשה מחוץ לטווח הסביר (${COEF_MIN}–${COEF_MAX})` : null;
  return (
    <Panel title="מחשבון: המקדם המובטח מול קרן פנסיה חדשה" aside={<span>הנתונים שלכם · לא נשמרים</span>}>
      <div className="bm-calc">
        <div className="bm-calc-in">
          <Field label="יתרה צבורה בפוליסה (ש&quot;ח)"><input inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} placeholder="למשל 640,000" /></Field>
          <Field label="מקדם המרה מובטח בפוליסה"><input inputMode="decimal" value={cg} onChange={(e) => setCg(e.target.value)} placeholder="מהפוליסה, למשל 160" /></Field>
          <div className="field"><span>מקדם בקרן פנסיה חדשה (הנחה)</span>
            <Seg label="מין, לברירת המחדל של המקדם" value={sex} onChange={(v) => { setSex(v); setCn(''); }} options={[['x', 'לא צוין'], ['m', 'גבר'], ['f', 'אישה']]} />
            <input inputMode="decimal" value={cn} onChange={(e) => setCn(e.target.value)} placeholder={`${dflt.v}`} aria-label="מקדם בקרן פנסיה חדשה" />
            <small className="muted">ברירת מחדל {dflt.v}: {dflt.why}; אפשר להקליד מקדם אחר</small></div>
          <Field label="ד&quot;נ מצבירה בפוליסה, % (לא חובה)"><input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="למשל 1.05" /></Field>
          <Field label="ד&quot;נ מצבירה בקרן החדשה, % (לא חובה)"><input inputMode="decimal" value={feeN} onChange={(e) => setFeeN(e.target.value)} placeholder="למשל 0.22" /></Field>
        </div>
        <div className="bm-calc-out" aria-live="polite">
          {bad ? <p className="bm-n">{bad}</p> : !o ? <p className="muted">מקלידים יתרה ומקדם מובטח מהפוליסה, ומקבלים את הקצבה החודשית בשני המקדמים על אותה יתרה.</p> : <>
            <div className="kpis bm-kpis">
              <Kpi label="קצבה חודשית, המקדם המובטח" value={<span className="num">{ilsF(o.annG)}</span>} sub={<>יתרה ÷ <span className="num">{G}</span></>} />
              <Kpi label="קצבה חודשית, קרן חדשה (הנחה)" value={<span className="num">{ilsF(o.annNew)}</span>} sub={<>יתרה ÷ <span className="num">{N}</span></>} />
              <Kpi label="ההפרש בחודש" value={<span className="num">{o.diff >= 0 ? '+' : '−'}{ilsF(Math.abs(o.diff))}</span>} sub={<span className="num">{o.pct >= 0 ? '+' : '−'}{Math.abs(o.pct).toFixed(1)}%</span>} tone={o.diff >= 0 ? 'pos' : 'neg'} />
            </div>
            <p className="bm-line"><b>{bmLine(o, G!, N)}</b></p>
            {(o.feeG != null || o.feeN != null) && <p className="bm-fee">דמי ניהול על היתרה של היום, בשנה: {o.feeG != null && <>בפוליסה <span className="num">{ilsF(o.feeG)}</span></>}{o.feeG != null && o.feeN != null && ' · '}{o.feeN != null && <>בקרן החדשה <span className="num">{ilsF(o.feeN)}</span></>}{o.feeG != null && o.feeN != null && <> · הפרש <span className="num">{ilsF(Math.abs(o.feeG - o.feeN))}</span> {o.feeG > o.feeN ? 'לטובת הקרן החדשה' : 'לטובת הפוליסה'}</>}. דמי הניהול אינם משנים את המקדם; הם מקטינים את היתרה עד הפרישה.</p>}
          </>}
        </div>
      </div>
      <div className="fnote">
        <b>איפה מוצאים את המקדם המובטח:</b> בתנאי הפוליסה (דף פרטי הביטוח), ובחלק מחברות הביטוח גם בדוח השנתי למבוטח. אם אינו מופיע, מבקשים אותו בכתב מחברת הביטוח, ובאותה פנייה שואלים לאיזה גיל פרישה ולאיזה מסלול קצבה הוא מובטח (שארים, תקופת הבטחת תשלומים), והאם הוא חל על כל הכספים בפוליסה.
        {' '}<b>החישוב:</b> קצבה חודשית = יתרה ÷ מקדם, על היתרה של היום, בלי תשואה ודמי ניהול עד הפרישה ובלי הבדלי מסלול הקצבה. המקדם בקרן חדשה אינו מובטח: הקרן קובעת אותו בפרישה לפי התקנון ולוחות תוחלת החיים. ברירת המחדל כאן היא הנחה של האתר בגיל 67, לפי <a href={NEW_COEF_SRC.url} target="_blank" rel="noreferrer">{NEW_COEF_SRC.title}</a>. חישוב, לא ייעוץ: ההחלטה תלויה גם ביתר הפריטים ברשימה למטה.
      </div>
    </Panel>
  );
}

export function FundsBm() {
  const d = useOptional<DecisionFile>(DECISION_PATH);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const head = <FundsHead title="ביטוחי מנהלים ישנים: מה בודקים לפני שעוזבים" sub="רשימת בדיקה לפני ניוד או פדיון של פוליסת ביטוח מנהלים ישנה · לפי כל זכות (נכתב בסיוע רשות שוק ההון) ותקנון קרן הפנסיה · מידע כללי, לא ייעוץ" />;
  if (d === undefined) return <>{head}<Loading what="רשימת הבדיקה" /></>;
  if (d === null || !d.bm_checklist?.length) return <>{head}<Empty title="רשימת הבדיקה לא פורסמה" /></>;
  const items = d.bm_checklist;
  const disc = items.find((x) => x.note && /2012|2013/.test(x.note));
  const coefMiss = d.missing.find((m) => m.what === 'bm_coefficients');
  const ls = d.segments.life_savings;
  const lsRows = Object.values(d.companies).filter((c) => c.service?.life_savings).map((c) => ({ grp: c.grp, r: c.service!.life_savings! })).sort((a, b) => a.r.rank - b.r.rank);
  const used = [...new Set(items.flatMap((x) => [x.src, x.src2].filter((s): s is string => !!s)))].map((id) => srcOf(d, id)).filter((s): s is NonNullable<typeof s> => !!s);
  const n = Object.values(done).filter(Boolean).length;
  return (
    <>
      {head}
      <Panel title="למי זה רלוונטי">
        <div className="bm-intro">
          <p>פוליסת ביטוח מנהלים היא חוזה עם חברת ביטוח. בפוליסות ישנות יש לעיתים תנאים שאינם נמכרים היום, ובראשם מקדם קצבה מובטח שנקבע ביום ההצטרפות. מעבר לקרן פנסיה, לפוליסה אחרת או לחברה אחרת עשוי לוותר עליהם, ומעבר אינו הפיך. הרשימה מסכמת מה כדאי לברר בפוליסה עצמה ומול חברת הביטוח לפני שמחליטים.</p>
          <p>בביטוח-נט, הפוליסות הישנות מופיעות בדורות {OLD_PRODS.map((p, i) => <span key={p}>{i ? ' ו' : ''}<Link to={screen(p)}>{p}</Link></span>)}. מקדם מובטח נמכר גם בפוליסות מאוחרות יותר, {BM_CUTOFF}. פוליסת חיסכון (בלי רכיב פנסיוני) אינה ביטוח מנהלים.</p>
          {disc?.note && <p className="bm-disc"><b>אי-התאמה במקור:</b> {disc.note}</p>}
        </div>
      </Panel>

      <BmCalc />

      <Panel title={<>מה עלול ללכת לאיבוד <span className="w2d num">· {items.length} פריטים</span></>} aside={<span aria-live="polite">סימנתם <span className="num">{n}</span> מתוך <span className="num">{items.length}</span> · נשאר בעמוד בלבד</span>}>
        <ol className="bm-list">
          {items.map((it) => { const s = srcOf(d, it.src), s2 = it.src2 ? srcOf(d, it.src2) : null; return (
            <li key={it.id} className={done[it.id] ? 'done' : undefined}>
              <label className="bm-chk"><input type="checkbox" checked={!!done[it.id]} onChange={(e) => setDone({ ...done, [it.id]: e.target.checked })} /><span className="sr-only">בדקתי: </span><b>{it.title}</b></label>
              <p>{it.detail}</p>
              {it.q && <blockquote className="bm-q">"{it.q}…"</blockquote>}
              {it.note && it !== disc && <p className="bm-n"><b>הערה:</b> {it.note}</p>}
              <div className="bm-src">
                <Sourced src={() => bmProv(d, it)}>{s?.kind === 'consumer' ? 'כל זכות' : s?.publisher ?? 'מקור'}: {s?.title ?? it.src}</Sourced>
                {s?.updated && <span className="w2d"> · עודכן {dateHe(s.updated)}</span>}
                {s && <> · <a href={s.url} target="_blank" rel="noreferrer">לדף המקור</a></>}
                {s2 && <> · <Sourced src={() => bmProv(d, it, true)}>תקנון, עמ' {it.pg2}</Sourced></>}
              </div>
            </li>); })}
        </ol>
        <div className="fnote">{coefMiss ? `${coefMiss.reason}: את המקדם של פוליסה מסוימת יש לבקש מחברת הביטוח או לראות בדוח השנתי. ` : ''}המסלקה הפנסיונית מציגה את כל המוצרים של חוסך במקום אחד. זה מידע כללי ולא ייעוץ פנסיוני: ההחלטה תלויה בתנאי הפוליסה ובמצב האישי. בעל רישיון שממליץ על ניוד מסמן במסמך ההנמקה אם במוצר הקיים יש מקדם קצבה מובטח (נספח א' לחוזר מסמך ההנמקה).</div>
      </Panel>

      {ls && lsRows.length > 0 && <Panel title={<>שירות בחברות הביטוח · {ls.label} · <span className="num">{ls.year}</span></>} aside={<Link to="/managers?v=svc&seg=life_savings">כל הרכיבים</Link>}>
        <div className="scroll"><table className="bm-svc">
          <caption className="sr-only">מדד השירות של רשות שוק ההון, {ls.label}</caption>
          <thead><tr><th>חברה</th><th>המדד</th><th>מקום</th></tr></thead>
          <tbody>{lsRows.map((x) => <tr key={x.grp}><td><MgrChip grp={x.grp} /></td><td><Sourced src={() => svcProv(d, x.grp, 'life_savings', 'total')}><span className="num">{x.r.total}</span></Sourced></td><td><Sourced src={() => svcProv(d, x.grp, 'life_savings', 'rank')}>{rankHe(x.r)}</Sourced></td></tr>)}</tbody>
        </table></div>
        <div className="fnote">רשות שוק ההון, מדד השירות {ls.year}, עמ' {ls.pg}: ביטוחי מנהלים ופוליסות חיסכון של חברת הביטוח יחד. מודד שירות (שביעות רצון, תלונות, מענה, שיוך כספים, דיגיטל), לא תשואה ולא את תנאי הפוליסה.</div>
      </Panel>}

      <Panel title="מקורות">
        <ul className="bm-srcs">{used.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> · {s.publisher}{s.revision ? ` · גרסה ${s.revision}` : ''}{s.updated ? ` · עודכן ${dateHe(s.updated)}` : ''} · נקרא {dateHe(s.retrieved)}</li>)}</ul>
      </Panel>
    </>
  );
}
