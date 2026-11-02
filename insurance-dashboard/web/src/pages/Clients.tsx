import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Panel } from '../components/ui';
import { Icon } from '../components/Icon';
import { useFunds } from '../lib/useData';
import type { FundsFile } from '../lib/funds';
import { exportText, mergeClients, removeFolder, sorted, useClients, type Folder } from '../lib/clients';
import { today } from '../lib/visits';
import { ClientImport } from '../components/agent/ClientImport';
import { nf } from '../lib/format';
import { ym } from '../lib/funds';
import '../styles/agent.css';

/* W3 · /clients, "תיקי לקוחות" (agent door): the comparisons an agent saved per client, in this browser only, with a JSON file to move
   them between devices. A folder opens by the router's state (its random id), never by its label in the address. */

const dmy = (iso: string) => iso.split('-').reverse().join('.');
const ils = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const pc = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 2)}%`);

/** W4: a folder's products from a clearing-house file: the client's balances, fees and cover, as the file gave them */
function HeldList({ f }: { f: Folder }) {
  if (!f.held.length) return null;
  const covers = f.held.flatMap((h) => h.covers.map((c) => ({ ...c, of: `${h.typeHe}${h.provider ? ` · ${h.provider}` : ''}` })));
  return (
    <details className="cl-held">
      <summary>{f.held.length} מוצרים מהמסלקה{covers.length ? ` · ${covers.length} כיסויים ביטוחיים` : ''}{f.held[0]?.asof ? ` · נכון ל-${dmy(f.held[0].asof)}` : ''}</summary>
      <div className="scroll"><table className="fsimple">
        <thead><tr><th>מוצר</th><th>יתרה</th><th>הפקדה חודשית</th><th>ד"נ מצבירה</th><th>ד"נ מהפקדה</th></tr></thead>
        <tbody>{f.held.map((h, i) => <tr key={i}><td><b>{h.typeHe}</b><span className="ci-sub">{[h.provider, h.track ?? h.plan].filter(Boolean).join(' · ')}{h.note ? ` · ${h.note}` : ''}</span></td><td><span className="num">{ils(h.balance)}</span></td><td><span className="num">{ils(h.monthly)}</span></td><td title={h.feeHow ?? undefined}><span className="num">{pc(h.fee)}</span></td><td title={h.depHow ?? undefined}><span className="num">{pc(h.depfee)}</span></td></tr>)}</tbody>
      </table></div>
      {covers.length > 0 && <ul className="ci-cov">{covers.map((c, i) => <li key={i}><b>{c.name}</b> ({c.of}){c.sum != null && <> · <span className="num">{ils(c.sum)}</span></>}{c.rate != null && <> · <span className="num">{nf(c.rate, 0)}%</span> מהשכר</>}{c.cost != null && <> · עלות <span className="num">{ils(c.cost)}</span></>}</li>)}</ul>}
      <p className="cl-note">של הלקוח, כפי שהקובץ מהמסלקה מסר אותם; לא נבדק מול הגוף המנהל.</p>
    </details>
  );
}

export function Clients() {
  const [file, setFile] = useClients();
  const data = useFunds().data as FundsFile | undefined;
  const nav = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const [impMsg, setImpMsg] = useState<string | null>(null);
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
                <div className="cl-h"><b>{f.label}</b><span className="cl-meta">{f.keys.length} מסלולים · {f.b === 'net' ? 'נטו' : 'ברוטו'} · עודכן {dmy(f.updated)}{Object.keys(f.fields).length ? ` · ${Object.keys(f.fields).length} שדות בטיוטת ההנמקה` : ''}</span>
                  {f.snap ? <span className="chip cl-snap" title="המסמך ללקוח נפתח על הנתונים שהוצגו בשמירה; נתוני היום בלחיצה">צילום מ-{dmy(f.snap.at)}, נתונים עד {ym(f.snap.asof)}</span> : f.keys.length > 0 && <span className="chip est" title="תיק מגרסה קודמת: נפתח על נתוני היום. שמירה מהמסמך תוסיף צילום">בלי צילום</span>}</div>
                <div className="cl-tracks">{f.keys.map((k) => <Link key={k} to={`/funds/${k}`} className="chip">{f.tags[k] ? `${f.tags[k]} · ` : ''}{nameOf(k)}</Link>)}</div>
                {f.note && <p className="cl-note">{f.note}</p>}
                <HeldList f={f} />
                <div className="cl-acts">
                  <button type="button" className="cmp-doc" onClick={() => openCmp(f)} disabled={!f.keys.length}><Icon name="compare" />להשוואה</button>
                  <button type="button" className="chip" onClick={() => openDoc(f)} disabled={!f.keys.length}><Icon name="statement" /> {f.snap ? 'מסמך ללקוח (הצילום)' : 'מסמך ללקוח'}</button>
                  <button type="button" className="chip" onClick={() => { if (confirm(`למחוק את התיק "${f.label}" מהדפדפן הזה?`)) setFile(removeFolder(file, f.id)); }}>מחיקה</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="ייבוא מהמסלקה ללקוח" aside={<span>בטא · בדפדפן בלבד</span>}>
        {data ? <ClientImport funds={data.funds} onDone={(_, m) => setImpMsg(m)} /> : <span className="muted">טוען…</span>}
        {impMsg && <p role="status" className="csave-msg">{impMsg}</p>}
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
