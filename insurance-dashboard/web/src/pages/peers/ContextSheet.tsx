import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { DeeperSheet } from '../../components/DeeperSheet';
import { idCss } from '../../lib/identity';
import { useStored } from '../../lib/local';
import { useAddressWrite } from '../../lib/sheetHost';
import { CARRY_RULE, TAX } from '../../lib/peerBoard';
import { nf } from '../../lib/format';
import { qlab } from '../../lib/quarters';
import type { PeerSet, Registry } from '../../lib/registry';
import { viewHref } from './ViewStrip';
import type { BoardData } from './BoardLens';
import '../../styles/peerboard.css';

/* The context sheet (`?sheet=ctx`, the chip "■ 7 המבטחות · הפניקס ▾", spec p6 §3.2 item 2, §3.7): the peer set (the registry's sets and
   the reader's own, stored in this browser as the peer table does), editing a set (pages/peers/SetEditor, shared with the peer table),
   the focus company (a "Q2'26" tag on a company that has not reported the board's quarter), the companies the partial-quarter line
   names when there are more than four, and the peer table's other views (free table, series, savings deck). Plus "איך מחשבים?". */

type SetEditorProps = { reg: Registry; ents: string[]; onChange: (ids: string[]) => void; onSave: (name: string) => void; own: PeerSet | null; onDelete: (id: string) => void };
// the set editor moved out of pages/Peers.tsx (lane P6-2c); loaded when it is there
const EDITORS = import.meta.glob<{ SetEditor: ComponentType<SetEditorProps> }>('./SetEditor.tsx');
const Editor = EDITORS['./SetEditor.tsx'] ? lazy(() => EDITORS['./SetEditor.tsx']().then((m) => ({ default: m.SetEditor }))) : null;

export function ContextSheet({ d, onClose }: { d: BoardData; onClose: () => void }) {
  const { reg, book, status } = d;
  const write = useAddressWrite();
  const [mySets, setMySets] = useStored<PeerSet[]>('peers.sets', []);
  const [edit, setEdit] = useState(false);
  const sp = new URLSearchParams(window.location.search);
  const sid = sp.get('e') ? '' : sp.get('s') ?? 'ins';
  const all = [...reg.sets, ...mySets.map((x) => ({ ...x, own: true }))];
  const own = all.find((x) => x.id === sid && x.own) ?? null;
  const href = (to: 'free' | 'series') => `?${viewHref(sp, to).toString()}`;
  const deck = (() => { const n = viewHref(sp, 'free'); n.set('v', 'deck'); return `?${n.toString()}`; })();
  return (
    <DeeperSheet open onClose={onClose} id="ctx-sheet" title="קבוצה וחברה במיקוד" sub={`${d.setName} · ${d.ents.length} חברות`}>
      <div className="p6-ms-sec">
        <h3>קבוצה</h3>
        <div className="p6-optgrid" id="ctx-sets">
          {sp.get('e') ? <button type="button" aria-pressed>מותאמת ({d.ents.length})</button> : null}
          {all.map((x) => (
            <button key={x.id} type="button" aria-pressed={x.id === sid} onClick={() => write({ s: x.id === 'ins' ? null : x.id, e: null, hl: null, bm: null, rd: null, sec: null, sheet: null })}>{x.n}{x.own ? ' ·' : ''}</button>
          ))}
        </div>
        <button type="button" className="btn p6-edit" aria-expanded={edit} onClick={() => setEdit(!edit)}>{edit ? 'סגירת העריכה' : 'עריכת הקבוצה'}</button>
        {edit ? (Editor ? (
          <Suspense fallback={null}>
            <Editor reg={reg} ents={d.ents} onChange={(ids) => write({ e: ids.join(','), s: null })}
              onSave={(n) => { const id = `u${Date.now().toString(36)}`; setMySets([...mySets, { id, n, ids: d.ents }]); write({ s: id, e: null }); }}
              own={own} onDelete={(id) => { setMySets(mySets.filter((x) => x.id !== id)); write({ s: null, e: null }); }} />
          </Suspense>
        ) : <p className="p6-sh-note">עריכת קבוצה: <Link to={href('free')}>בטבלה החופשית ›</Link></p>) : null}
      </div>
      <div className="p6-ms-sec">
        <h3>במיקוד</h3>
        <div className="p6-optrows" id="ctx-focus">
          {d.order.map((e) => (
            <button key={e} type="button" className="p6-optrow" aria-pressed={e === d.focus} onClick={() => write({ hl: e, sheet: null })}>
              <i className="sq" style={{ background: idCss(e) }} />{book.name(e)}
              {status.last[e] && status.last[e]! < status.bq ? <span className="p6-tag warn"><bdi dir="ltr">{qlab(status.last[e])}</bdi></span> : null}
              {!status.last[e] && d.kindOf(e) === 'ins' ? <span className="p6-tag">אין דוחות בקובץ</span> : null}
            </button>
          ))}
        </div>
      </div>
      {status.waiting.length ? (
        <div className="p6-ms-sec">
          <h3>טרם דיווחו <bdi dir="ltr">{qlab(status.bq)}</bdi></h3>
          <p className="p6-sh-note" id="ctx-waiting">{status.waiting.map((e) => `${book.short(e)} (${qlab(status.last[e])})`).join(', ')}. לפי הדוח האחרון של כל אחת, מסומנות ונספרות; רבעון בודד, YoY ו-QoQ של הרבעון: רק מי שדיווח.</p>
        </div>
      ) : null}
      <div className="p6-ms-sec">
        <h3>תצוגות של טבלת העמיתים</h3>
        <div className="p6-optrows">
          <Link className="p6-optrow" to={href('free')} id="ctx-free">טבלה חופשית ›</Link>
          <Link className="p6-optrow" to={href('series')} id="ctx-series">סדרה ›</Link>
          <Link className="p6-optrow" to={deck} id="ctx-deck">מצגת חיסכון ›</Link>
        </div>
      </div>
    </DeeperSheet>
  );
}

/** "איך מחשבים?" (`?sheet=why`): the board's rules in one place (spec p6 §3.7 sources footer, §13.2) */
export function WhySheet({ onClose }: { onClose: () => void }) {
  const kv: [string, string][] = [
    ['LTM', 'סכום ארבעת הרבעונים האחרונים'],
    ['YoY · QoQ', 'הרבעון מול הרבעון המקביל לפני שנה · מול הרבעון הקודם. הבסיס כתוב ליד כל שינוי'],
    ['LTM YoY', 'LTM מול LTM לפני שנה; זה ה-YoY שמופיע ליד רמת LTM בטבלאות'],
    ['יחסים', 'שינוי בנקודות אחוז (CSM / הון: במכפיל)'],
    ['צבירה נטו, ניוד נטו', 'שינוי במיליארדי ש"ח, לא באחוזים (הזרם מחליף סימן)'],
    ['שינוי באחוזים', 'על בסיס שלילי או אפס אינו מוצג ("בסיס שלילי")'],
    ['מכפילים', 'שווי שוק בסגירה האחרונה ÷ הנתון המדווח האחרון של כל חברה (אומדן). ברשת הרבעונים: שווי השוק בסגירת סוף הרבעון'],
    ['P/(B+CSM)', `CSM נטו ממס ${nf(TAX, 2)}% (הנחה, כמו בדפי הערכת השווי)`],
    ['משוקלל', 'סך שווי השוק ÷ סך המכנים (בעדשת הטבלה)'],
    ['תשואה כוללת', 'דיבידנד מושקע מחדש בשער הסגירה ביום האקס'],
    ['חברה שטרם דיווחה', CARRY_RULE],
    ['קריאה שנקראת על שם הרבעון', 'רבעון בודד, YoY ו-QoQ של הרבעון: רק מי שדיווח את הרבעון בדירוג ובחציון; היתר מוצגות בנפרד עם הרבעון שלהן'],
    ['המספר הקטן ליד חציון', 'כמה חברות בחציון. הלוח מציג חציון, לא ממוצע (הממוצע בטבלה וב-Excel)'],
    ['מקום משותף', 'ערכים שההפרש ביניהם קטן מהרצועה (מכפיל: שתי יחידות תצוגה; שינוי באחוזים: 0.2 נק׳; סכום: 0.5% מהחציון) חולקים מקום (1, 1, 3)'],
    ['†', 'CSM שהודפס על בסיס אחר (נטו / ברוטו) מהבסיס הנוכחי של החברה; שינוי מולו אינו מחושב'],
  ];
  return (
    <DeeperSheet open onClose={onClose} id="why-sheet" title="איך מחשבים?">
      <dl className="p6-why">{kv.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </DeeperSheet>
  );
}
