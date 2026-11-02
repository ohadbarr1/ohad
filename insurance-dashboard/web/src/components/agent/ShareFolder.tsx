import { useId, useState } from 'react';
import { Icon } from '../Icon';
import { decryptShare, encryptFolder, mergeClients, useClients, type Folder } from '../../lib/clients';
import { today } from '../../lib/visits';

/* W7 · /clients, "שיתוף תיק": one folder as an encrypted file (AES-256-GCM, a key derived from a passphrase the agent types, PBKDF2
   310,000 rounds), made and opened in this browser only. The passphrase travels by another channel (a call, a message); the file alone
   opens nothing. */
const download = (text: string, name: string) => {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const safeName = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 40) || 'folder';

export function ShareFolder({ f }: { f: Folder }) {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const id = useId();
  const go = async () => {
    try { download(await encryptFolder(f, pass, today()), `fox-client-${safeName(f.label)}-${today()}.share.json`); setMsg('הקובץ נשמר אצלכם; מסרו את הסיסמה בערוץ אחר'); setPass(''); setOpen(false); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <span className="share">
      <button type="button" className="chip" onClick={() => { setOpen(!open); setMsg(null); }} aria-expanded={open}><Icon name="shield" /> שיתוף תיק</button>
      {open && <form className="share-form" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <label htmlFor={`${id}-p`}>סיסמה לקובץ (8 תווים לפחות)</label>
        <input id={`${id}-p`} type="password" value={pass} onChange={(e) => setPass(e.target.value)} minLength={8} maxLength={200} autoComplete="new-password" />
        <div className="csave-acts"><button type="submit" className="btn primary" disabled={pass.length < 8}>הורדת קובץ מוצפן</button><button type="button" className="btn" onClick={() => setOpen(false)}>ביטול</button></div>
        <p className="csave-priv">התיק מוצפן בדפדפן הזה (AES-256-GCM, מפתח מהסיסמה ב-PBKDF2) ונשמר כקובץ אצלכם; שום דבר לא נשלח לשרת. בלי הסיסמה הקובץ אינו נפתח, ואין דרך לשחזר אותה. הקובץ מכיל את התיק כפי שהוא: שם הלקוח כפי שהקלדתם, המוצרים מהמסלקה וטיוטת ההנמקה.</p>
      </form>}
      {msg && <span role="status" className="csave-msg">{msg}</span>}
    </span>
  );
}

/** the other side: a share file and its passphrase, merged into this browser's folders */
export function ShareImport() {
  const [file, setFile] = useClients();
  const [pending, setPending] = useState<File | null>(null);
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const id = useId();
  const go = async () => {
    if (!pending) return;
    try {
      const f = await decryptShare(await pending.text(), pass);
      const r = mergeClients(file, { kind: 'fox-clients', v: 2, folders: [f] });
      setFile(r.file);
      setMsg(r.added ? `התיק "${f.label}" נוסף` : r.updated ? `התיק "${f.label}" עודכן (העותק בקובץ חדש יותר)` : `התיק "${f.label}" כבר קיים בגרסה חדשה יותר: לא שונה`);
      setPending(null); setPass('');
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="share-imp">
      <label className="chip cl-imp"><Icon name="shield" /> ייבוא תיק משותף (קובץ מוצפן)<input type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size > 4_000_000) { setMsg('הקובץ גדול מדי'); } else if (f) { setPending(f); setMsg(null); } e.target.value = ''; }} /></label>
      {pending && <form className="share-form" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <label htmlFor={`${id}-p`}>הסיסמה לקובץ {pending.name}</label>
        <input id={`${id}-p`} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" autoFocus />
        <div className="csave-acts"><button type="submit" className="btn primary" disabled={!pass}>פתיחה</button><button type="button" className="btn" onClick={() => { setPending(null); setPass(''); }}>ביטול</button></div>
      </form>}
      {msg && <span role="status" className="csave-msg">{msg}</span>}
    </div>
  );
}
