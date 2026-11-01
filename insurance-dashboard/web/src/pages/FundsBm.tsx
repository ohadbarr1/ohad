import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { Sourced } from '../components/Source';
import { MgrChip } from '../components/MgrChip';
import { Empty, Loading, Panel } from '../components/ui';
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
