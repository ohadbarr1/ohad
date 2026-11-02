import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../Icon';
import { useClients, upsert, type Folder, type FolderIn } from '../../lib/clients';
import { today } from '../../lib/visits';

/* W3 · "שמור ללקוח" (agent door): saves what is on screen (the tracks, and on the client document the tags and the typed הנמקה draft)
   under a client label, in this browser only. `folder`: the folder this page was opened from, so a save updates it. `collect` reads the
   page's extra state at the moment of saving. */
export function ClientSave({ keys, b, folder, collect, onSaved, compact, suggest, busy }: {
  keys: string[]; b: 'net' | 'gross'; folder?: Folder | null;
  collect?: () => Partial<Pick<Folder, 'tags' | 'fields' | 'snap' | 'held'>>; onSaved?: (f: Folder) => void; compact?: boolean;
  /** W4: a name typed elsewhere on the page (the client document's "שם הלקוח"), offered when the form opens */
  suggest?: string;
  /** W4: the figures to freeze are still loading */
  busy?: boolean;
}) {
  const [file, setFile] = useClients();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(folder?.label ?? '');
  const [note, setNote] = useState(folder?.note ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const id = useId();
  useEffect(() => { setLabel(folder?.label ?? ''); setNote(folder?.note ?? ''); }, [folder?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    const lab = label.trim();
    if (!lab) { setMsg('צריך שם או כינוי ללקוח'); return; }
    const inp: FolderIn = { label: lab, keys, b, note, ...(collect?.() ?? {}), ...(folder && folder.label === lab ? { id: folder.id } : {}) };
    const r = upsert(file, inp, today());
    setFile(r.file); setOpen(false);
    setMsg(`${r.created ? 'נשמר בתיק חדש' : 'התיק עודכן'}: ${r.folder.label} · ${r.folder.keys.length} מסלולים${r.folder.snap ? ` · צילום הנתונים מ-${r.folder.snap.at.split('-').reverse().join('.')}` : ''}`);
    onSaved?.(r.folder);
  };
  return (
    <div className={`csave${compact ? ' compact' : ''}`}>
      {!open ? (
        <span className="csave-row">
          <button type="button" className="chip csave-btn" onClick={() => { if (!label.trim() && suggest?.trim()) setLabel(suggest.trim().slice(0, 80)); setOpen(true); setMsg(null); }} disabled={!keys.length || busy} title={busy ? 'הנתונים עוד נטענים' : undefined}><Icon name="inbox" /> {folder ? `שמירה בתיק: ${folder.label}` : 'שמור ללקוח'}</button>
          {msg && <span role="status" className="csave-msg">{msg} · <Link to="/clients">תיקי לקוחות</Link></span>}
        </span>
      ) : (
        <form className="csave-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label htmlFor={`${id}-l`}>שם או כינוי ללקוח</label>
          <input id={`${id}-l`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} list={`${id}-dl`} autoComplete="off" placeholder="למשל: ד.כ., פגישה 11/26" autoFocus />
          <datalist id={`${id}-dl`}>{file.folders.map((f) => <option key={f.id} value={f.label} />)}</datalist>
          <label htmlFor={`${id}-n`}>הערה (לא חובה)</label>
          <textarea id={`${id}-n`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} />
          <div className="csave-acts">
            <button type="submit" className="btn primary">שמירה</button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>ביטול</button>
          </div>
          <p className="csave-priv">נשמר רק בדפדפן הזה (לא נשלח לשום מקום, ולא נכנס לכתובת העמוד). להעברה למכשיר אחר: ייצוא לקובץ ב<Link to="/clients">תיקי לקוחות</Link>. שם קיים: התיק שלו מתעדכן; שם חדש: תיק חדש. נשמר גם צילום של הנתונים שמוצגים עכשיו, כדי שהתיק יציג בדיוק אותם גם אחרי עדכון הנתונים.</p>
          {msg && <p role="alert" className="csave-msg">{msg}</p>}
        </form>
      )}
    </div>
  );
}
