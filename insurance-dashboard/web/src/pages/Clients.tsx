import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Panel } from '../components/ui';
import { Icon } from '../components/Icon';
import { useFunds } from '../lib/useData';
import type { FundsFile } from '../lib/funds';
import { exportText, mergeClients, removeFolder, sorted, useClients, type Folder } from '../lib/clients';
import { today } from '../lib/visits';
import '../styles/agent.css';

/* W3 · /clients, "תיקי לקוחות" (agent door): the comparisons an agent saved per client, in this browser only, with a JSON file to move
   them between devices. A folder opens by the router's state (its random id), never by its label in the address. */

const dmy = (iso: string) => iso.split('-').reverse().join('.');

export function Clients() {
  const [file, setFile] = useClients();
  const data = useFunds().data as FundsFile | undefined;
  const nav = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const nameOf = (k: string) => data?.funds.find((f) => f.k === k)?.name ?? k;
  const list = sorted(file);
  const openCmp = (f: Folder) => nav(`/funds/compare?k=${f.keys.join(',')}&b=${f.b}`, { state: { folder: f.id } });
  const openDoc = (f: Folder) => nav(`/funds/compare/print?k=${f.keys.join(',')}&b=${f.b}`, { state: { folder: f.id } });
  const exportFile = () => {
    const blob = new Blob([exportText(file, today())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fox-clients-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) { setMsg('הקובץ גדול מדי לתיקי לקוחות'); return; }
    f.text().then((t) => { const r = mergeClients(file, JSON.parse(t)); setFile(r.file); setMsg(r.added || r.updated ? `נוספו ${r.added} תיקים, עודכנו ${r.updated}` : 'לא נמצאו בקובץ תיקים חדשים'); }).catch(() => setMsg('הקובץ אינו קובץ תיקי לקוחות תקין'));
  };
  return (
    <div className="clients">
      <div className="pagehead"><div>
        <span className="eyebrow">סוכן</span>
        <h1><span className="icotile"><Icon name="inbox" /></span>תיקי לקוחות</h1>
        <div className="sub">השוואות ששמרתם ללקוחות: המסלולים, הסיווג בנספח וטיוטת ההנמקה. נשמר בדפדפן הזה בלבד.</div>
      </div></div>
      <Panel title={`${list.length} תיקים`} aside={<span>פרטי לדפדפן הזה</span>}>
        {!list.length ? (
          <Empty title="עוד אין תיקים" icon="inbox">בהשוואת מסלולים ובמסמך ללקוח יש כפתור "שמור ללקוח". אפשר גם לייבא קובץ שיוצא ממכשיר אחר.</Empty>
        ) : (
          <ul className="cl-list">
            {list.map((f) => (
              <li key={f.id} className="cl-item">
                <div className="cl-h"><b>{f.label}</b><span className="cl-meta">{f.keys.length} מסלולים · {f.b === 'net' ? 'נטו' : 'ברוטו'} · עודכן {dmy(f.updated)}{Object.keys(f.fields).length ? ` · ${Object.keys(f.fields).length} שדות בטיוטת ההנמקה` : ''}</span></div>
                <div className="cl-tracks">{f.keys.map((k) => <Link key={k} to={`/funds/${k}`} className="chip">{f.tags[k] ? `${f.tags[k]} · ` : ''}{nameOf(k)}</Link>)}</div>
                {f.note && <p className="cl-note">{f.note}</p>}
                <div className="cl-acts">
                  <button type="button" className="cmp-doc" onClick={() => openCmp(f)}><Icon name="compare" />להשוואה</button>
                  <button type="button" className="chip" onClick={() => openDoc(f)}><Icon name="statement" /> מסמך ללקוח</button>
                  <button type="button" className="chip" onClick={() => { if (confirm(`למחוק את התיק "${f.label}" מהדפדפן הזה?`)) setFile(removeFolder(file, f.id)); }}>מחיקה</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="העברה בין מכשירים" aside={<span>קובץ JSON</span>}>
        <div className="cl-io">
          <button type="button" className="chip" onClick={exportFile} disabled={!list.length}><Icon name="download" /> ייצוא לקובץ</button>
          <label className="chip cl-imp">ייבוא מקובץ<input type="file" accept="application/json,.json" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          {msg && <span role="status" className="muted">{msg}</span>}
        </div>
        <div className="fnote">שום דבר מהתיקים לא נשלח לשרת ולא נכנס לכתובת העמוד. הקובץ כולל את שמות הלקוחות כפי שהקלדתם ואת טיוטות ההנמקה: שמרו אותו כמו כל מסמך לקוח. בייבוא, תיק שכבר קיים מתעדכן רק כשהעותק בקובץ חדש יותר.</div>
      </Panel>
    </div>
  );
}
