import { useId, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '../Icon';
import { readStored, storedKeys, writeStored } from '../../lib/local';
import { isoDay } from '../../lib/checkup';
import { decryptSaver, encryptSaver, saverBackupName, saverKeys } from '../../lib/saverBackup';
import { saveBlob } from './ShareCard';

/* Red team 06.11.26 (bring-back) · the saver's encrypted backup and restore, folded: everything /my and the check-up keep in this
   browser, as one file under a passphrase (lib/saverBackup, the agent's AES-GCM envelope). A restore replaces the saver's data in this
   browser with the file's (after a confirm). The passphrase is never stored. */
export function SaverSafe() {
  const id = useId();
  const { hash } = useLocation();
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const short = pass.length > 0 && pass.length < 8;
  const backup = async () => {
    setBusy(true); setMsg(null);
    try {
      const values = Object.fromEntries(saverKeys(storedKeys()).map((k) => [k, readStored<unknown>(k, null)]));
      const text = await encryptSaver(values, pass, isoDay(new Date()));
      saveBlob(saverBackupName(isoDay(new Date())), new Blob([text], { type: 'application/json' }));
      setMsg({ ok: true, t: 'נשמר קובץ גיבוי מוצפן. שמרו אותו (למשל ב"קבצים") וזכרו את הסיסמה: בלעדיה אי אפשר לפתוח אותו.' });
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); }
    setBusy(false);
  };
  const restore = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const { values, exported } = await decryptSaver(await file.text(), pass);
      const keys = Object.keys(values);
      if (!keys.length) throw new Error('בקובץ אין נתונים של החיסכון שלי');
      if (!confirm('לשחזר מהגיבוי? מה שנשמר עכשיו בדפדפן הזה (המוצרים, הגיל והבדיקה) יוחלף בתוכן הקובץ.')) { setBusy(false); return; }
      saverKeys(storedKeys()).filter((k) => !(k in values)).forEach((k) => writeStored(k, undefined));
      keys.forEach((k) => writeStored(k, values[k]));
      setMsg({ ok: true, t: `שוחזר מהגיבוי${exported ? ` מ-${exported.slice(8, 10)}.${exported.slice(5, 7)}.${exported.slice(2, 4)}` : ''}.` });
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); }
    setBusy(false);
  };
  return (
    <details className="panel sv-safe" id="sv-safe" open={hash === '#sv-safe' || undefined}>
      <summary><h2><Icon name="shield" /> גיבוי מוצפן</h2></summary>
      <p className="sv-note">Safari עלול למחוק נתונים של אתר שלא נכנסו אליו 7 ימים. קובץ גיבוי מוצפן שומר את המוצרים, הגיל והבדיקה; פותחים אותו כאן, באותה סיסמה. הקובץ נוצר בדפדפן ולא נשלח.</p>
      <div className="sv-form">
        <label htmlFor={`${id}-p`}><span>סיסמה, 8 תווים לפחות</span>
          <input id={`${id}-p`} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} aria-invalid={short} />
        </label>
        <button type="button" className="btn primary" disabled={busy || pass.length < 8} onClick={backup}>שמירת גיבוי</button>
        <label className="btn" aria-disabled={busy || pass.length < 8}>שחזור מקובץ
          <input type="file" accept=".json,application/json" hidden disabled={busy || pass.length < 8} onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      {short && <p className="sv-err">סיסמה של 8 תווים לפחות</p>}
      {msg && <p className={msg.ok ? 'sv-done' : 'sv-err'} role="status">{msg.t}</p>}
    </details>
  );
}
