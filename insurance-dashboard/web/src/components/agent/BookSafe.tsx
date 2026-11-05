import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Icon } from '../Icon';
import { BACKUP_KEY, mergeClients, normClients, isShareFile, useClients } from '../../lib/clients';
import { BACKUP2_KEY, CALLS_KEY, bookHash, normCalls, normMark, whenText, type BackupMark } from '../../lib/agentDesk';
import { backupName, decryptBook, encryptBook, isBookBackup, restoreInto } from '../../lib/bookBackup';
import { hasBrand, normBranding, useBranding } from '../../lib/branding';
import { useStored } from '../../lib/local';
import { today } from '../../lib/visits';
import '../../styles/agentDesk.css';

/* fox 3.0 phase 2 · keeping the agent's book without a server (agent door only: /clients and /clients/new).
   - install: on an iPhone or iPad, Safari may erase a site's storage after 7 days without a visit; a site added to the home screen is
     not subject to that. So the agent is told how to add fox to the home screen, and that the home-screen app keeps its own storage
     (separate from Safari's): after adding it, open fox from the home screen and restore the backup there. Chrome / Edge: the
     browser's install prompt when it offers one. The browser is also asked to keep the storage (navigator.storage.persist).
   - backup: the whole book (folders, the agent's branding, the call-list marks) as one AES-GCM encrypted file under a passphrase
     (lib/bookBackup); the page notices every change since the last backup and offers one; with "אוטומטי" on, a change downloads a new
     file by itself while this tab is open (the passphrase is kept in this tab's memory only, never stored). Restore merges.
   The service worker (public/sw.js) is the site's existing one: network first for /data, the HTML only as the offline shell. */

/* the install prompt Chrome / Edge fire once per load, captured while this module is loaded */
interface BIP extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: BIP | null = null;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());
if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIP; ping(); });
  addEventListener('appinstalled', () => { deferred = null; ping(); });
}
const useDeferred = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => deferred, () => null);

/** an iPhone or iPad (iPadOS reports a Mac with touch) */
export const isIOS = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
/** opened from the home screen / as an installed app */
export const isStandalone = () => typeof window !== 'undefined' && ((navigator as Navigator & { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches);

/** the passphrase of this tab's session (memory only: a reload forgets it) */
let sessionPass: string | null = null;
const download = (text: string, name: string) => {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
const nowLocal = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

/** the shared state: the book, its fingerprint, the last backup, and the backup action */
function useBackup() {
  const [file, setFile] = useClients();
  const [brand, setBrand] = useBranding();
  const [callsRaw, setCalls] = useStored<unknown>(CALLS_KEY, null);
  const [markRaw, setMark] = useStored<unknown>(BACKUP2_KEY, null);
  const [, setLegacy] = useStored<string>(BACKUP_KEY, '');
  const [auto, setAuto] = useStored<boolean>('clients:autobackup', false);
  const mark = normMark(markRaw);
  const hash = bookHash(file.folders);
  const changed = file.folders.length > 0 && (!mark || mark.hash !== hash);
  const run = async (pass: string) => {
    const text = await encryptBook(file, hasBrand(brand) ? brand : undefined, normCalls(callsRaw), pass, today());
    download(text, backupName(today()));
    const m: BackupMark = { at: nowLocal(), hash, n: file.folders.length };
    setMark(m); setLegacy(today());
  };
  return { file, setFile, brand, setBrand, callsRaw, setCalls, mark, hash, changed, run, auto, setAuto };
}

/** the passphrase form: twice the first time in this tab, once after; "זכירה" keeps it in this tab's memory */
function PassForm({ onDone, onCancel, confirm }: { onDone: (pass: string, remember: boolean) => Promise<void>; onCancel: () => void; confirm: boolean }) {
  const [p1, setP1] = useState(''), [p2, setP2] = useState(''), [rem, setRem] = useState(true), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const id = useId();
  const ok = p1.length >= 8 && (!confirm || p1 === p2);
  return (
    <form className="bk-form" onSubmit={async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); setErr(null); try { await onDone(p1, rem); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } finally { setBusy(false); } }}>
      <label htmlFor={`${id}-1`}>סיסמה לקובץ הגיבוי (8 תווים לפחות)</label>
      <input id={`${id}-1`} type="password" value={p1} onChange={(e) => setP1(e.target.value)} minLength={8} maxLength={200} autoComplete="new-password" autoFocus />
      {confirm && <><label htmlFor={`${id}-2`}>שוב, לאימות</label><input id={`${id}-2`} type="password" value={p2} onChange={(e) => setP2(e.target.value)} maxLength={200} autoComplete="new-password" /></>}
      <label className="chk"><input type="checkbox" checked={rem} onChange={(e) => setRem(e.target.checked)} /> לזכור את הסיסמה עד סגירת הלשונית (בזיכרון בלבד)</label>
      {confirm && p2 && p1 !== p2 && <p className="ci-err" role="alert">הסיסמאות שונות</p>}
      {err && <p className="ci-err" role="alert">{err}</p>}
      <div className="csave-acts"><button type="submit" className="btn primary" disabled={!ok || busy}>{busy ? 'מצפין…' : 'הורדת גיבוי מוצפן'}</button><button type="button" className="btn" onClick={onCancel}>ביטול</button></div>
      <p className="csave-priv">אין דרך לשחזר סיסמה שנשכחה: בלי הסיסמה הקובץ אינו נפתח. שמרו את הקובץ במקום שמגובה (iCloud Drive, Google Drive או המחשב).</p>
    </form>
  );
}

/** the compact line (the wizard): the last backup, and a backup when something changed */
export function BookSafeLine() {
  const b = useBackup();
  const [open, setOpen] = useState(false);
  useAuto(b);
  if (!b.file.folders.length) return null;
  return (
    <div className={`bk-line${b.changed ? ' nudge' : ''}`} role="status">
      <Icon name="shield" />
      <span>{b.mark ? `גיבוי אחרון: ${whenText(b.mark.at, today())}` : 'עוד לא נשמר גיבוי של התיקים'}{b.changed ? ' · יש שינויים שלא גובו' : ''}</span>
      {b.changed && !open && <button type="button" className="chip" onClick={() => (sessionPass ? void b.run(sessionPass) : setOpen(true))}>גיבוי מוצפן</button>}
      {open && <PassForm confirm onCancel={() => setOpen(false)} onDone={async (p, rem) => { await b.run(p); if (rem) sessionPass = p; setOpen(false); }} />}
    </div>
  );
}

/** a change downloads a new encrypted backup by itself, when the agent turned it on and the passphrase is in this tab's memory */
function useAuto(b: ReturnType<typeof useBackup>) {
  useEffect(() => {
    if (!b.auto || !b.changed || !sessionPass) return;
    const t = setTimeout(() => { if (sessionPass) void b.run(sessionPass); }, 2500);
    return () => clearTimeout(t);
  }, [b.auto, b.changed, b.hash]);  // eslint-disable-line react-hooks/exhaustive-deps
}

/** /clients: install guidance, the storage the browser keeps, the last backup, backup and restore */
export function BookSafe() {
  const b = useBackup();
  const bip = useDeferred();
  const [open, setOpen] = useState(false);
  const [rest, setRest] = useState<{ name: string; text: string } | null>(null);
  const [rp, setRp] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [hide, setHide] = useStored<string>('clients:installhint', '');
  const id = useId();
  useAuto(b);
  useEffect(() => { let on = true; void navigator.storage?.persisted?.().then((v) => on && setPersisted(v), () => undefined); return () => { on = false; }; }, []);
  const ios = isIOS(), sa = isStandalone();
  const askPersist = async () => { try { const v = await navigator.storage?.persist?.(); setPersisted(!!v); setMsg(v ? 'הדפדפן אישר לשמור את התיקים גם כשחסר מקום' : 'הדפדפן לא אישר (הוא מחליט לפי השימוש באתר). גיבוי מוצפן הוא ההגנה שבידיכם'); } catch { setMsg('הדפדפן אינו תומך בבקשה הזו'); } };

  const pickRestore = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    if (f.size > 20_000_000) { setMsg('הקובץ גדול מדי לגיבוי תיקים'); return; }
    const text = await f.text();
    let x: unknown;
    try { x = JSON.parse(text); } catch { setMsg('הקובץ אינו קובץ גיבוי של fox'); return; }
    if (isBookBackup(x)) { if (sessionPass) void openBackup(text, sessionPass, f.name, true); else setRest({ name: f.name, text }); return; }
    if (isShareFile(x)) { setMsg('זה קובץ שיתוף של תיק אחד: פותחים אותו ב"ייבוא תיק משותף" למטה'); return; }
    const inc = normClients(x);
    if (!inc.folders.length) { setMsg('בקובץ אין תיקים'); return; }
    const r = mergeClients(b.file, inc); b.setFile(r.file);
    setMsg(`שוחזר מקובץ לא מוצפן: נוספו ${r.added} תיקים, עודכנו ${r.updated}`);
  };
  const openBackup = async (text: string, pass: string, name: string, silent = false) => {
    try {
      const o = await decryptBook(text, pass);
      const r = restoreInto(b.file, normCalls(b.callsRaw), o);
      b.setFile(r.file); b.setCalls(r.calls);
      const gotBrand = !!o.brand && !hasBrand(b.brand) && hasBrand(normBranding(o.brand));
      if (gotBrand) b.setBrand(normBranding(o.brand));
      setMsg(`שוחזר מ-${name}: נוספו ${r.added} תיקים, עודכנו ${r.updated}${gotBrand ? ' · פרטי בעל הרישיון נקלטו' : ''}`);
      setRest(null); setRp('');
    } catch (e) { if (silent) setRest({ name, text }); else setMsg(e instanceof Error ? e.message : String(e)); }
  };

  const showInstall = !sa && hide !== today().slice(0, 7);
  return (
    <section className="panel bk" aria-labelledby={`${id}-h`}>
      <div className="hd"><h2 id={`${id}-h`}><span className="icotile"><Icon name="shield" /></span>שמירת התיקים</h2><div className="aside"><span>בלי שרת: הכול בדפדפן הזה ובקבצים שלכם</span></div></div>
      <div className="bk-grid">
        <div className={`bk-card${b.changed ? ' nudge' : ''}`}>
          <h3>גיבוי מוצפן</h3>
          <p className="bk-big" role="status">{b.mark ? `גיבוי אחרון: ${whenText(b.mark.at, today())}` : 'עוד לא נשמר גיבוי'}</p>
          <p>{b.file.folders.length ? (b.changed ? `יש שינויים שלא גובו (${b.file.folders.length} תיקים בדפדפן).` : 'אין שינויים מאז הגיבוי האחרון.') : 'אין עדיין תיקים בדפדפן הזה.'} קובץ אחד מוצפן (AES-256-GCM) עם כל התיקים, פרטי בעל הרישיון והסימונים ברשימת השיחות.</p>
          {!open ? <div className="csave-acts">
            <button type="button" className={`btn${b.changed ? ' primary' : ''}`} disabled={!b.file.folders.length} onClick={() => (sessionPass ? void b.run(sessionPass).then(() => setMsg('הגיבוי ירד לתיקיית ההורדות')) : setOpen(true))}><Icon name="download" /> גיבוי עכשיו</button>
            <label className="chk"><input type="checkbox" checked={b.auto} onChange={(e) => b.setAuto(e.target.checked)} /> גיבוי אוטומטי אחרי כל שינוי (בלשונית הזו, אחרי סיסמה אחת)</label>
          </div> : <PassForm confirm onCancel={() => setOpen(false)} onDone={async (p, rem) => { await b.run(p); if (rem) sessionPass = p; setOpen(false); setMsg('הגיבוי ירד לתיקיית ההורדות'); }} />}
          <div className="bk-rest">
            <label className="chip cl-imp"><Icon name="inbox" /> שחזור מגיבוי<input type="file" accept="application/json,.json" onChange={(e) => { void pickRestore(e.target.files?.[0]); e.target.value = ''; }} /></label>
            {rest && <form className="bk-form" onSubmit={(e) => { e.preventDefault(); void openBackup(rest.text, rp, rest.name); }}>
              <label htmlFor={`${id}-rp`}>הסיסמה של {rest.name}</label>
              <input id={`${id}-rp`} type="password" value={rp} onChange={(e) => setRp(e.target.value)} autoComplete="off" autoFocus />
              <div className="csave-acts"><button type="submit" className="btn primary" disabled={!rp}>שחזור</button><button type="button" className="btn" onClick={() => { setRest(null); setRp(''); }}>ביטול</button></div>
              <p className="csave-priv">תיק שכבר קיים מתעדכן רק כשהעותק בגיבוי חדש יותר; שום תיק לא נמחק בשחזור.</p>
            </form>}
          </div>
        </div>
        <div className="bk-card">
          <h3>שהדפדפן לא ימחק</h3>
          {showInstall && ios && <div className="bk-ios">
            <p className="bk-big">הוסיפו למסך הבית כדי שהתיקים לא יימחקו</p>
            <ol>
              <li>גבו קודם (בכרטיס הגיבוי): לאפליקציה במסך הבית יש אחסון משלה, נפרד מ-Safari.</li>
              <li>ב-Safari: כפתור השיתוף <span className="bk-k" aria-label="שיתוף">⬆︎</span>, ואז "הוספה למסך הבית".</li>
              <li>פתחו את fox מהאייקון במסך הבית, ושם: "שחזור מגיבוי".</li>
            </ol>
            <p>Safari עלול למחוק נתוני אתר אחרי 7 ימים בלי ביקור; אתר שנוסף למסך הבית אינו נמחק כך.</p>
          </div>}
          {showInstall && !ios && <div>
            <p className="bk-big">התקנה כאפליקציה</p>
            {bip ? <button type="button" className="btn primary" onClick={async () => { await bip.prompt(); deferred = null; }}><Icon name="download" /> התקנת fox במכשיר</button>
              : <p>בתפריט הדפדפן: "התקנת האפליקציה" או "הוספה למסך הבית". בטלפון אנדרואיד ובמחשב התיקים נשארים באותו אחסון.</p>}
          </div>}
          {sa && <p className="bk-big"><Icon name="check" /> fox פתוח מהמסך הבית: האחסון אינו נמחק אחרי 7 ימים.</p>}
          <p>{persisted === true ? 'הדפדפן התחייב לשמור את האחסון של fox גם כשחסר מקום.' : persisted === false ? 'הדפדפן עדיין לא התחייב לשמור את האחסון.' : ''}{' '}
            {persisted === false && <button type="button" className="chip" onClick={() => void askPersist()}>בקשה מהדפדפן לשמור</button>}</p>
          {showInstall && <button type="button" className="chip bk-hide" onClick={() => setHide(today().slice(0, 7))}>הסתרה לחודש</button>}
        </div>
      </div>
      {msg && <p role="status" className="csave-msg">{msg}</p>}
    </section>
  );
}
