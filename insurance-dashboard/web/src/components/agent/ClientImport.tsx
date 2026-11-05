import { useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon';
import type { FundX } from '../../lib/funds';
import { decodeXml, heldOf, parseMaslaka, readTree, rowsOf, sniff, type MFund, type Row } from '../../lib/maslaka';
import { folderFromImport, upsert, useClients, type Folder, type Held } from '../../lib/clients';
import { today } from '../../lib/visits';
import { nf } from '../../lib/format';
import { track } from '../../lib/track';

/* W4 · /clients, "ייבוא מהמסלקה ללקוח" (agent door): the client's clearing-house XML files are read in this browser (lib/maslaka, the
   same reader as the saver's /my import), shown for review, and saved as a NEW client folder: the client's products with their balances,
   their own fees and their insurance cover; the products matched to a published track become the folder's tracks (tagged "קיים"), ready
   for the compare page and the client document. Nothing goes into the saver's "המוצרים שלי", nothing leaves the device, and the reader
   never opens the holder's name, ID number, account number, employer or the insured person's details. */

const MAX_BYTES = 20_000_000;
const ils = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const pc = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 2)}%`);
interface Read { name: string; rows: Row[]; error?: string; warn: string[] }

/** the folder an import makes (W5: the pure helper moved to lib/clients, node-testable) */
export { folderFromImport };

export function ClientImport({ funds, onDone }: { funds: FundX[]; onDone: (f: Folder, msg: string) => void }) {
  const [file, setFile] = useClients();
  const [open, setOpen] = useState(false);
  const [reads, setReads] = useState<Read[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [manual, setManual] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  const byK = useMemo(() => new Map(funds.map((f) => [f.k, f])), [funds]);

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const out: Read[] = [];
    let n = 0;
    for (const f of Array.from(files)) {
      n++;
      try {
        if (f.size > MAX_BYTES) throw new Error('הקובץ גדול מדי לקובץ מסלקה');
        const buf = new Uint8Array(await f.arrayBuffer());
        const kind = sniff(buf);
        if (kind === 'zip') throw new Error('זה קובץ zip. פותחים אותו קודם במכשיר (הסיסמה מגיעה מהמסלקה), ובוחרים כאן את קובצי ה-XML שבתוכו');
        if (kind === 'pdf') throw new Error('זה קובץ PDF. הייבוא קורא רק את קובצי ה-XML שבחבילה מהמסלקה');
        if (kind !== 'xml') throw new Error('זה לא קובץ XML');
        const parsed = parseMaslaka(readTree(decodeXml(buf)));
        out.push({ name: f.name, rows: rowsOf(parsed, funds as MFund[], `f${n}`), warn: parsed.warn });
      } catch (e) {
        out.push({ name: f.name, rows: [], warn: [], error: e instanceof Error ? e.message : String(e) });
      }
    }
    setManual({}); setReads(out); setBusy(false);
  };
  const rows = (reads ?? []).flatMap((r) => r.rows);
  const held = heldOf(rows, manual) as Held[];
  const lab = label.trim().replace(/\s+/g, ' ');
  const taken = !!lab && file.folders.some((f) => f.label.trim().replace(/\s+/g, ' ').toLowerCase() === lab.toLowerCase());
  const save = () => {
    if (!lab) { setErr('צריך שם או כינוי ללקוח'); return; }
    if (taken) { setErr('כבר יש תיק בשם הזה. הייבוא יוצר תיק חדש: בחרו שם אחר'); return; }
    if (!held.length) { setErr('לא נמצאו מוצרים בקבצים'); return; }
    const f = folderFromImport(lab, held);
    const r = upsert(file, { ...f, b: 'net', note: `ייבוא מהמסלקה, ${today().split('-').reverse().join('.')}` }, today());
    setFile(r.file);
    track('import_done');  // F2: the event name only
    onDone(r.folder, `נוצר תיק "${r.folder.label}": ${held.length} מוצרים מהמסלקה, ${r.folder.keys.length} מהם מסלולים להשוואה. הקבצים עצמם לא נשמרו.`);
    setReads(null); setOpen(false); setLabel(''); if (inp.current) inp.current.value = '';
  };

  if (!open) return (
    <div className="ci-intro">
      <p>קובץ המסלקה הפנסיונית של הלקוח (XML) נקרא כאן, בדפדפן הזה, ונשמר כתיק חדש: המוצרים, היתרות, דמי הניהול <b>של הלקוח</b> והכיסויים הביטוחיים, כשהם בקובץ. לא נשמרים שם, תעודת זהות, מספר חשבון או מעסיק.</p>
      <button type="button" className="btn" onClick={() => setOpen(true)}><Icon name="inbox" /> ייבוא מהמסלקה ללקוח</button>
    </div>
  );
  return (
    <div className="ci-body">
      <p className="csave-priv">הקבצים נקראים בדפדפן הזה בלבד ולא יוצאים מהמכשיר. הקורא אינו פותח את פרטי הלקוח, המעסיק או המבוטח בכיסוי; נשמרים רק המוצר, המסלול, היתרה, ההפקדה, דמי הניהול והכיסויים, ורק אחרי שתאשרו. בטא: שמות השדות לפי המבנה האחיד של רשות שוק ההון (ממשק אחזקות, גרסה 008).</p>
      <label className="btn primary ci-file">{busy ? 'קורא…' : 'בחירת קובצי XML של הלקוח'}<input ref={inp} type="file" accept=".xml,text/xml,application/xml" multiple onChange={(e) => void readFiles(e.target.files)} /></label>
      {reads && (
        <div className="ci-review" role="region" aria-label="סקירה לפני שמירה" aria-live="polite">
          {reads.filter((r) => r.error || r.warn.length).map((r) => <p key={r.name} className={r.error ? 'ci-err' : 'ci-warn'}><b>{r.name}:</b> {r.error ?? r.warn.join(' · ')}</p>)}
          {rows.length > 0 && <div className="scroll"><table className="fsimple ci-t">
            <caption className="sr-only">המוצרים שבקובץ</caption>
            <thead><tr><th>מוצר</th><th>מסלול באתר</th><th>יתרה</th><th>הפקדה חודשית</th><th>ד"נ מצבירה (הלקוח)</th><th>ד"נ מהפקדה (הלקוח)</th><th>כיסויים</th></tr></thead>
            <tbody>{rows.map((r) => { const k = manual[r.key] || r.k, f = k ? byK.get(k) : undefined; return (
              <tr key={r.key}>
                <td><b>{r.typeHe}</b><span className="ci-sub">{[r.providerName, r.trackName ?? r.plan].filter(Boolean).join(' · ')}</span></td>
                <td>{f ? <span>{f.name}<span className="ci-sub">{r.by === 'name' && !manual[r.key] ? 'לפי שם המסלול: לבדוק' : manual[r.key] ? 'בחירה ידנית' : 'לפי מספר הקופה'}</span></span>
                  : r.skip ? <span className="muted">{r.skip}</span>
                  : r.cands.length ? <select aria-label={`מסלול: ${r.trackName ?? r.plan ?? r.typeHe}`} value={manual[r.key] ?? ''} onChange={(e) => setManual({ ...manual, [r.key]: e.target.value })}><option value="">לא הותאם: לבחור</option>{r.cands.map((c) => byK.get(c)).filter((x): x is FundX => !!x).map((x) => <option key={x.k} value={x.k}>{x.name}</option>)}</select>
                  : <span className="muted">לא הותאם</span>}</td>
                <td><span className="num">{ils(r.balance)}</span></td><td><span className="num">{ils(r.monthly)}</span></td><td><span className="num">{pc(r.fee)}</span></td><td><span className="num">{pc(r.depfee)}</span></td>
                <td>{(r.covers ?? []).length ? <ul className="ci-cov">{(r.covers ?? []).map((c, i) => <li key={i}>{c.name}{c.sum != null && <> · <span className="num">{ils(c.sum)}</span></>}{c.rate != null && <> · <span className="num">{nf(c.rate, 0)}%</span> מהשכר</>}{c.cost != null && <> · עלות <span className="num">{ils(c.cost)}</span></>}</li>)}</ul> : <span className="muted">–</span>}</td>
              </tr>); })}</tbody>
          </table></div>}
          <div className="ci-save">
            <label htmlFor="ci-l">שם או כינוי לתיק החדש</label>
            <input id="ci-l" value={label} onChange={(e) => { setLabel(e.target.value); setErr(null); }} maxLength={80} placeholder="למשל: ד.כ., מסלקה 11/26" autoComplete="off" />
            <div className="csave-acts">
              <button type="button" className="btn primary" disabled={!rows.length || !lab || taken} onClick={save}>יצירת תיק לקוח ({rows.length} מוצרים)</button>
              <button type="button" className="btn" onClick={() => { setReads(null); setOpen(false); }}>ביטול</button>
            </div>
            {(err || taken) && <p role="alert" className="csave-msg">{err ?? 'כבר יש תיק בשם הזה. הייבוא יוצר תיק חדש: בחרו שם אחר'}</p>}
          </div>
          <p className="csave-priv">היתרות, ההפקדות ודמי הניהול הם של הלקוח, כפי שהם בקובץ (דמי ניהול מצבירה: מתנאי החשבון; כשאין, החודש האחרון × 12, אומדן). הכיסויים: שם הכיסוי, הסכום (בקרן פנסיה: קצבה חודשית) והעלות, כשהקובץ מפרט אותם. המוצרים שהותאמו למסלול שמתפרסם נכנסים לתיק כמסלולים "קיים" להשוואה ולמסמך ללקוח.</p>
        </div>
      )}
    </div>
  );
}
