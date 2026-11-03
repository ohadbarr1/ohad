import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from './Source';
import { Panel } from './ui';
import { fmt, fmtS } from '../lib/drivers';
import { idCss } from '../lib/identity';
import { useLoad } from '../lib/useData';
import { vintLabel } from '../lib/capital';
import { FORWARD_PATH, SHOCKS, STEP_SHORT, WALK_STEPS, bindOf, fp, fwdOk, mortalitySign, sensFor, worstShock, type FwdFile, type FwdOk } from '../lib/forward';

/* W10 · /capital, below the ranking: the latest economic-solvency report of every insurer. Three tables, each figure opening its page:
   forward distribution capacity (after what was declared since the report), the ratio walk as the report prints it, and the disclosed
   sensitivities on one vintage. */

const amt = (v: number | null | undefined) => (v == null ? '–' : `⁦${fmt(v, 0)}⁩`);
const pp = (v: number | null | undefined, d = 1) => (v == null ? '–' : `⁦${fmtS(v, d)}⁩`);
const pc = (v: number | null | undefined, d = 0) => (v == null ? '–' : `⁦${fmt(v, d)}%⁩`);
const BH = { w: 'עם הוראות מעבר', wo: 'ללא הוראות מעבר' } as const;
const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;
const Who = ({ c }: { c: FwdOk }) => (
  <th scope="row" className="who"><i className="scn-dot" style={{ background: idCss(c.id) }} aria-hidden="true" /><Link to={`/company/${c.id}`}>{c.name}</Link>
    <span className="s">דוח <a href={c.url ?? undefined} target="_blank" rel="noreferrer"><span className="num">{vintLabel(c.date)}</span></a> · פורסם <span className="num">{dmy(c.pub)}</span></span></th>
);

function Capacity({ cos }: { cos: FwdOk[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel title="קיבולת חלוקה אחרי הדוח האחרון" aside={<span>מיליוני ש״ח · האילוץ המחמיר מחייב</span>} className="fwd-panel">
      <div className="scroll"><table className="fwd">
        <thead><tr><th scope="col">מבטחת</th><th scope="col">יחס עם / ללא הוראות מעבר</th><th scope="col">אילוץ מחייב</th><th scope="col">עודף מעל הסף</th><th scope="col">חלוקות אחרי הפרסום</th><th scope="col">קיבולת שנותרה</th><th scope="col">בנקודות יחס</th><th scope="col">בזעזוע החמור שגולה</th><th scope="col"><span className="sr">פירוט</span></th></tr></thead>
        <tbody>{cos.map((c) => {
          const b = bindOf(c), w = worstShock(c), sw = c.lines.sra_w ?? c.lines.sr_w, swo = c.lines.sra_wo ?? c.lines.sr_wo;
          return (
            <Fragment key={c.id}>
              <tr>
                <Who c={c} />
                <td>{sw ? <Sourced className="v num" src={() => fp(sw.prov)}>{pc(sw.v, sw.v % 1 ? 1 : 0)}</Sourced> : '–'} <span className="s">/</span> {swo ? <Sourced className="v num" src={() => fp(swo.prov)}>{pc(swo.v, swo.v % 1 ? 1 : 0)}</Sourced> : '–'}
                  {(c.lines.sra_w || c.lines.sra_wo) && <span className="s">לאחר פעולות הוניות עד הפרסום</span>}</td>
                <td><span className="v">{b.he.split(',')[0]} <Sourced className="num" src={() => fp(b.t_prov)}>{pc(b.t, b.t % 1 ? 1 : 0)}</Sourced></span><span className="s">{BH[b.basis]}</span></td>
                <td><Sourced className={`v num ${b.head.v < 0 ? 'neg' : ''}`} src={() => fp(b.head.prov)}>{amt(b.head.v)}</Sourced></td>
                <td>{c.after.items.length ? <Sourced className="v num" src={() => fp(c.after.prov)}>{amt(-c.after.v)}</Sourced> : <span className="na">אין</span>}
                  {c.after.items.some((x) => x.kind === 'pending') && <span className="chip est" title="חלוקה בעין שאושרה בדצמבר 2024 וטרם בוצעה (בית הורד); החברה בוחנת אותה מחדש. נוכתה כהנחה שמרנית">כולל חלוקה תלויה</span>}</td>
                <td><Sourced className={`v num ${b.rem.v < 0 ? 'neg' : ''}`} src={() => fp(b.rem.prov)}>{amt(b.rem.v)}</Sourced> <span className="chip est" title="אומדן: אין יחס מאוחר מ-31.12.2025; רווח, שוק ו-SCR מאז לא נכללו">אומדן</span></td>
                <td><Sourced className={`v num ${b.pp.v < 0 ? 'neg' : ''}`} src={() => fp(b.pp.prov)}>{pp(b.pp.v)}</Sourced><span className="s">נ״א מעל הסף</span></td>
                <td>{w ? <><Sourced className={`v num ${w.after[w.bind] < 0 ? 'neg' : ''}`} src={() => fp(w.prov)}>{amt(w.after[w.bind])}</Sourced><span className="s">{w.l.replace(/\s*\([א-ת]\)\s*$/, '')}</span></> : <span className="na">לא גולו</span>}</td>
                <td><button type="button" className="chip" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'סגירה' : 'כל האילוצים'}</button></td>
              </tr>
              {open === c.id && (
                <tr className="sub"><td colSpan={9}>
                  <div className="fwd-cons">{c.constraints.map((k) => (
                    <span key={k.id} className={k.id === c.binding ? 'bind' : ''}><b>{k.he}</b> <Sourced className="num" src={() => fp(k.t_prov)}>{pc(k.t, k.t % 1 ? 1 : 0)}</Sourced>: עודף <Sourced className="num" src={() => fp(k.head.prov)}>{amt(k.head.v)}</Sourced>, נותר <Sourced className="num" src={() => fp(k.rem.prov)}>{amt(k.rem.v)}</Sourced> ({pp(k.pp.v)} נ״א){k.of_after_actions ? ' · הון לאחר פעולות הוניות' : ''}</span>))}</div>
                  <div className="fwd-cons">{c.after.items.map((x, i) => <span key={i}>{x.kind === 'div' ? 'דיבידנד' : 'חלוקה בעין תלויה'} <span className="num">{dmy(x.d)}</span>: <Sourced className="num" src={() => fp(x.prov)}>{amt(x.v)}</Sourced></span>)}
                    {c.deducted_in_report.map((x, i) => <span key={`d${i}`}>כבר נוכה בדוח: <Sourced className="num" src={() => fp(x.prov)}>{amt(x.v)}</Sourced></span>)}</div>
                  <div className="fwd-cons">{c.sens_capacity.map((s, i) => <span key={i}>{s.l.replace(/\s*\([א-ת]\)\s*$/, '')}: <Sourced className={`num ${s.after[s.bind] < 0 ? 'neg' : ''}`} src={() => fp(s.prov)}>{amt(s.after[s.bind])}</Sourced></span>)}</div>
                </td></tr>
              )}
            </Fragment>
          );
        })}</tbody>
      </table></div>
      <div className="src">קיבולת = הון עצמי (לאחר פעולות הוניות עד פרסום הדוח, כשהודפסו) − SCR × סף − דיבידנדים שחברת הביטוח הכריזה אחרי פרסום הדוח. הספים: 100% ללא הוראות מעבר (הממונה), יעד הדירקטוריון ללא הוראות מעבר, יעד מינימלי עם הוראות מעבר; כל סף מהדוח עצמו, בעמוד שלו. הדוח כבר מנכה את מה שהוכרז עד פרסומו. דיבידנדים ורכישה עצמית של החברה האם אינם מנוכים: הם ממומנים מהחזקה. בזעזוע: הרגישות שגולתה × SCR עם הוראות מעבר, SCR קבוע, אותו סכום בש״ח על כל סף (אומדן). מספרים אנליטיים, לא המלצה.</div>
    </Panel>
  );
}

function Walk({ cos }: { cos: FwdOk[] }) {
  const rows = cos.filter((c) => c.ratio_walk);
  return (
    <Panel title="גשר יחס כושר הפירעון, 31.12.24 ← 31.12.25" aside={<span>נקודות יחס ללא הוראות מעבר, בסדר שהדוח מדפיס</span>}>
      <div className="scroll"><table className="fwd">
        <thead><tr><th scope="col">מבטחת</th><th scope="col">פתיחה</th>{WALK_STEPS.map((s) => <th key={s} scope="col">{STEP_SHORT[s]}</th>)}<th scope="col">לא מפורט</th><th scope="col">סגירה</th><th scope="col">הוראות המעבר</th><th scope="col">עודף הון, סגירה</th></tr></thead>
        <tbody>{rows.map((c) => {
          const W = c.ratio_walk!, tr = c.walk.find((x) => x.step === 'transitional'), close = c.walk.find((x) => x.step === 'close');
          const rest = W.close - W.open - W.steps.reduce((t, s) => t + s.pp, 0);
          const trPp = close?.of && close.scr ? close.of.v / close.scr.v * 100 - W.close : null;
          return (
            <tr key={c.id}>
              <Who c={c} />
              <td><span className="v num">{pc(W.open, 1)}</span></td>
              {WALK_STEPS.map((k) => { const s = W.steps.find((x) => x.step === k); const r = c.walk.find((x) => x.step === k);
                return <td key={k}>{s ? <><Sourced className={`v num ${s.pp < 0 ? 'neg' : ''}`} src={() => fp(s.prov)}>{pp(s.pp)}</Sourced>{r?.su && <span className="s">עודף <Sourced className="num" src={() => fp(r.su!.prov)}>{amt(r.su.v)}</Sourced></span>}</> : <span className="na">לא מפורט</span>}</td>; })}
              <td><span className="v num">{pp(Math.abs(rest) < 0.05 ? 0 : rest)}</span></td>
              <td><span className="v num">{pc(W.close, 1)}</span></td>
              <td>{tr?.su && trPp != null ? <><span className="v num">{pp(trPp)}</span><span className="s">עודף <Sourced className="num" src={() => fp(tr.su!.prov)}>{amt(tr.su.v)}</Sourced></span></> : '–'}</td>
              <td>{close?.su ? <Sourced className="v num" src={() => fp(close.su!.prov)}>{amt(close.su.v)}</Sourced> : '–'}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <div className="src">טבלת התנועה בעודף ההון שהממונה מחייב (סעיף 7 / 8 בכל דוח): הון עצמי, SCR ועודף לכל שורה, כפי שהודפסו. כל צעד מתורגם לנקודות יחס בסדר ההדפסה (היחס אחרי הצעד פחות היחס לפניו); הסדר משפיע על הפירוק. "לא מפורט" הוא מה שהצעדים שגולו אינם מסבירים: אפס כשהטבלה סוגרת. הוראות המעבר: היחס המדווח פחות היחס ללא הוראות מעבר. פעולות הוניות כוללות דיבידנד שהוכרז עד פרסום הדוח והנפקות / פדיונות של מכשירי הון.</div>
    </Panel>
  );
}

function Sensitivities({ cos }: { cos: FwdOk[] }) {
  const vint = [...new Set(cos.map((c) => vintLabel(c.date)))];
  return (
    <Panel title="רגישויות יחס כושר הפירעון, כפי שגולו" aside={<span>נקודות יחס · {vint.length === 1 ? <>כולן ליום <span className="num">{vint[0]}</span></> : 'בציון תאריך לכל חברה'}</span>}>
      <div className="scroll"><table className="fwd">
        <thead><tr><th scope="col">מבטחת</th><th scope="col">יחס מדווח</th>{SHOCKS.map((s) => <th key={s.id} scope="col">{s.he}</th>)}</tr></thead>
        <tbody>{cos.map((c) => {
          const sr = c.lines.sr_w;
          return (
            <tr key={c.id}>
              <Who c={c} />
              <td>{sr ? <Sourced className="v num" src={() => fp(sr.prov)}>{pc(sr.v, sr.v % 1 ? 1 : 0)}</Sourced> : '–'}</td>
              {SHOCKS.map((s) => { const x = sensFor(c, s.id);
                return <td key={s.id}>{x ? <><Sourced className={`v num ${x.v < 0 ? 'neg' : ''}`} src={() => fp(x.prov)}>{pp(x.v, x.v % 1 ? 1 : 0)}</Sourced>
                  {s.id === 'mortality' && <span className="s">{mortalitySign(x.l)}</span>}{s.id === 'other' && <span className="s">{x.l.replace(/\s*\([א-ת]\)\s*$/, '')}</span>}</> : <span className="na">לא גולה</span>}</td>; })}
            </tr>
          );
        })}</tbody>
      </table></div>
      <div className="src">כל חברה מדפיסה בסעיף מבחני הרגישות את ההשפעה על היחס המדווח (עם הוראות מעבר), בלי השפעה על סכום הניכוי; הנוסח והתרחישים אינם אחידים. תמותה: ירידה של 5% אצל רוב החברות, עלייה של 5% באיילון. הכשרה מגלה גם ירידה של 10% בנדל״ן. דוחות 31.12.2025, מצורפים לדוח הרבעון הראשון 2026 (הראל ומגדל: דוח נפרד).</div>
    </Panel>
  );
}

/** the three tables, from capital/forward.json */
export function CapitalForward() {
  const { data, error } = useLoad<FwdFile>(FORWARD_PATH);
  if (error) return <div className="src">קובץ כושר הפירעון לא נטען: {error}</div>;
  if (!data) return null;
  const cos = data.companies.filter(fwdOk);
  const na = data.companies.filter((c) => !fwdOk(c));
  return (
    <>
      <Capacity cos={cos} />
      <Walk cos={cos} />
      <Sensitivities cos={cos} />
      {na.length > 0 && <div className="src">לא חושב: {na.map((c) => `${c.name} (${'why' in c ? c.why : ''})`).join(' · ')}</div>}
    </>
  );
}
