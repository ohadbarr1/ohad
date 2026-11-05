import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../Icon';
import type { FundX } from '../../lib/funds';
import { heldOf, MATCH_BY, type MFund, type Row } from '../../lib/maslaka';
import { folderFromImport, upsert, useClients, type Folder, type Held } from '../../lib/clients';
import { ACCEPT, NeedPassword, PW_HINT, readClientFiles, readSum, type Read } from '../../lib/clientRead';
import { today } from '../../lib/visits';
import { nf } from '../../lib/format';
import { track } from '../../lib/track';
import { HARB_ACCEPT, HARB_WARN, heldFromHarb, looksHarb, readHarb, type HarbRow } from '../../lib/harb';
import { riskOf, shortIns } from '../../lib/harbRisk';
import { HARB_HOW } from './RiskSide';

/* W4 · the agent's clearing-house import: the client's files are read in this browser (lib/clientRead → lib/maslaka), shown for
   review, and saved as a NEW client folder: the products with their balances, the client's own fees and the insurance cover; the
   products matched to a published track become the folder's tracks (tagged "קיים"). Nothing leaves the device, and the reader never
   opens the holder's name, ID number, account number, employer or the insured person's details.
   fox 3.0 phase 2 (A2): the zip as the clearing house sent it is read too (password from the clearing house's e-mail); the review
   says how many products matched, how many by the 30-digit unified code (חוזר 2015-231), and that the unmatched ones stay in the
   folder and in the document (א.1, חלק ד'). On the agent's home (`toWizard`, the default with `startOpen`) the saved folder opens the
   wizard at step 2 (/clients/new); inside the wizard the parent takes it from `onDone`.
   fox 3.0 A6: the client's הר הביטוח file (Excel / CSV, lib/harb) is taken next to the clearing-house file, in the same pick or a
   second one: its policies are reviewed here and saved into the folder as its risk side (components/agent/RiskSide). */
interface HarbRead { name: string; rows: HarbRow[]; warn: string[]; asof: string | null; error?: string }

const ils = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const pc = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 2)}%`);

/** the folder an import makes (W5: the pure helper lives in lib/clients, node-testable) */
export { folderFromImport };

export function ClientImport({ funds, onDone, startOpen = false, toWizard, nextLabel }: {
  funds: FundX[]; onDone: (f: Folder, msg: string, t0?: number) => void; startOpen?: boolean;
  /** after the save, open the wizard's step 2 (default: on when the picker starts open, i.e. the agent's home) */
  toWizard?: boolean;
  /** the save button's words (the wizard: "המשך: ניוד") */
  nextLabel?: string;
}) {
  const [file, setFile] = useClients();
  const nav = useNavigate();
  const wiz = toWizard ?? startOpen;
  const [open, setOpen] = useState(startOpen);
  const [over, setOver] = useState(false);
  const [reads, setReads] = useState<Read[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File[] | null>(null);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [manual, setManual] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [harb, setHarb] = useState<HarbRead[] | null>(null);
  const t0 = useRef<number | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  const byK = useMemo(() => new Map(funds.map((f) => [f.k, f])), [funds]);

  const run = async (all: File[], password: string | null) => {
    if (!all.length) return;
    if (t0.current == null) t0.current = Date.now();
    setBusy(true); setPwErr(null);
    // A6: the הר הביטוח lists (xlsx / xls / csv …) go to lib/harb; the rest (zip, XML) to the clearing-house reader. A pick of only
    // one kind keeps what an earlier pick read of the other, so the two files can come one after the other.
    const isH = await Promise.all(all.map(async (x) => looksHarb(x.name, new Uint8Array(await x.slice(0, 2048).arrayBuffer()))));
    const hf = all.filter((_, i) => isH[i]), files = all.filter((_, i) => !isH[i]);
    if (hf.length) {
      const hr: HarbRead[] = [];
      for (const x of hf) {
        try { if (x.size > 10_000_000) throw new Error('הקובץ גדול מדי לרשימת פוליסות'); hr.push({ name: x.name, ...(await readHarb(new Uint8Array(await x.arrayBuffer()))) }); }
        catch (e) { hr.push({ name: x.name, rows: [], warn: [], asof: null, error: e instanceof Error ? e.message : String(e) }); }
      }
      setHarb(hr);
    }
    if (!files.length) { setBusy(false); return; }
    try { setReads(await readClientFiles(files, funds as MFund[], password)); setManual({}); setPending(null); setPw(''); }
    catch (e) { if (e instanceof NeedPassword) { setPending(files); setPwErr(password ? e.message : null); } else setReads([{ name: files[0].name, rows: [], warn: [], error: e instanceof Error ? e.message : String(e) }]); }
    finally { setBusy(false); }
  };
  const rows: Row[] = (reads ?? []).flatMap((r) => r.rows);
  const held = heldOf(rows, manual) as Held[];
  const hRows = (harb ?? []).flatMap((h) => h.rows);
  const hHeld = (harb ?? []).flatMap((h) => heldFromHarb(h.rows, h.asof ?? today()));
  const all = [...held, ...hHeld];
  const risk = hHeld.length ? riskOf(all, today()) : null;
  const sum = readSum(rows, manual);
  const lab = label.trim().replace(/\s+/g, ' ');
  const taken = !!lab && file.folders.some((f) => f.label.trim().replace(/\s+/g, ' ').toLowerCase() === lab.toLowerCase());
  const reset = () => { setReads(null); setHarb(null); setPending(null); setOpen(startOpen); setLabel(''); t0.current = null; if (inp.current) inp.current.value = ''; };
  const save = () => {
    if (!lab) { setErr('צריך שם או כינוי ללקוח'); return; }
    if (taken) { setErr('כבר יש תיק בשם הזה. הייבוא יוצר תיק חדש: בחרו שם אחר'); return; }
    if (!all.length) { setErr('לא נמצאו מוצרים בקבצים'); return; }
    const f = folderFromImport(lab, all);
    const from = held.length && hHeld.length ? 'מהמסלקה ומהר הביטוח' : hHeld.length ? 'מהר הביטוח' : 'מהמסלקה';
    const r = upsert(file, { ...f, b: 'net', note: `ייבוא ${from}, ${today().split('-').reverse().join('.')}` }, today());
    setFile(r.file);
    track('import_done');  // F2: the event name only
    const start = t0.current ?? Date.now();
    onDone(r.folder, `נוצר תיק "${r.folder.label}": ${[held.length ? `${held.length} מוצרים מהמסלקה, ${r.folder.keys.length} מהם מסלולים להשוואה` : null, hHeld.length ? `${hHeld.length} פוליסות מהר הביטוח (צד הסיכון)` : null].filter(Boolean).join('; ')}. הקבצים עצמם לא נשמרו.`, start);
    reset();
    if (wiz) nav('/clients/new', { state: { folder: r.folder.id, step: 2, t0: start } });
  };

  if (!open) return (
    <div className="ci-intro">
      <p>קובץ המסלקה הפנסיונית של הלקוח (zip או XML), ולצידו הקובץ מהר הביטוח (Excel או CSV), נקראים כאן, בדפדפן הזה, ונשמרים כתיק חדש: המוצרים, היתרות, דמי הניהול <b>של הלקוח</b> והכיסויים הביטוחיים, ופוליסות הביטוח כצד הסיכון. לא נשמרים שם, תעודת זהות, מספר חשבון, מספר פוליסה מלא או מעסיק.</p>
      <button type="button" className="btn" onClick={() => setOpen(true)}><Icon name="inbox" /> ייבוא מהמסלקה ללקוח</button>
    </div>
  );
  return (
    <div className={`ci-body${over ? ' ci-over' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setOver(false); void run(Array.from(e.dataTransfer.files), null); }}>
      <p className="csave-priv">גררו לכאן את קובץ ה-zip מהמסלקה (או את קובצי ה-XML שבתוכו), ואם יש, גם את הקובץ מהר הביטוח; או בחרו אותם. {HARB_HOW} הקבצים נקראים בדפדפן הזה בלבד ולא יוצאים מהמכשיר; הקורא אינו פותח את פרטי הלקוח, המעסיק או המבוטח בכיסוי.</p>
      <label className="btn primary ci-file">{busy ? 'קורא…' : reads && !harb ? 'הוספת הקובץ מהר הביטוח' : 'בחירת קובצי הלקוח (מסלקה, הר הביטוח)'}<input ref={inp} type="file" accept={`${ACCEPT},${HARB_ACCEPT}`} multiple onChange={(e) => { void run(Array.from(e.target.files ?? []), null); e.target.value = ''; }} /></label>
      {pending && <form className="csave-form ci-pw" onSubmit={(e) => { e.preventDefault(); if (pw.trim()) void run(pending, pw.trim()); }}>
        <label htmlFor="ci-pw">הסיסמה לקובץ {pending.length === 1 ? pending[0].name : ''}</label>
        <input id="ci-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus aria-describedby="ci-pw-h" />
        <p id="ci-pw-h" className="csave-priv">{PW_HINT}</p>
        {pwErr && <p role="alert" className="ci-err">{pwErr}</p>}
        <div className="csave-acts"><button type="submit" className="btn primary" disabled={!pw.trim() || busy}>{busy ? 'פותח…' : 'פתיחת הקובץ'}</button><button type="button" className="btn" onClick={reset}>ביטול</button></div>
      </form>}
      {(reads || harb) && (
        <div className="ci-review" role="region" aria-label="סקירה לפני שמירה" aria-live="polite">
          {(reads ?? []).filter((r) => r.error || r.warn.length).map((r) => <p key={r.name} className={r.error ? 'ci-err' : 'ci-warn'}><b>{r.name}:</b> {r.error ?? r.warn.join(' · ')}</p>)}
          {rows.length > 0 && <p className="ci-sum" role="status"><b>{sum.rows} מוצרים בקובץ</b> · {sum.matched} הותאמו למסלול שמתפרסם{sum.byCode ? ` (${sum.byCode} לפי הקוד האחיד או מספר הקופה)` : ''}{sum.byName ? ` · ${sum.byName} לפי שם, לבדיקה` : ''}
            {sum.unmatched + sum.skipped > 0 && <> · <b>{sum.unmatched + sum.skipped} בלי מסלול באתר</b>: נשמרים בתיק עם הנתונים מהקובץ ומופיעים במסמך ההנמקה (א.1 וחלק ד')</>}</p>}
          {rows.length > 0 && <div className="scroll"><table className="fsimple ci-t">
            <caption className="sr-only">המוצרים שבקובץ</caption>
            <thead><tr><th>מוצר</th><th>מסלול באתר</th><th>יתרה</th><th>הפקדה חודשית</th><th>ד"נ מצבירה (הלקוח)</th><th>ד"נ מהפקדה (הלקוח)</th><th>כיסויים</th></tr></thead>
            <tbody>{rows.map((r) => { const k = manual[r.key] || r.k, f = k ? byK.get(k) : undefined; return (
              <tr key={r.key}>
                <td><b>{r.typeHe}</b><span className="ci-sub">{[r.providerName, r.trackName ?? r.plan].filter(Boolean).join(' · ')}</span></td>
                <td>{f ? <span>{f.name}<span className="ci-sub">{manual[r.key] ? 'בחירה ידנית' : r.by ? MATCH_BY[r.by] : ''}</span></span>
                  : r.skip ? <span className="ci-sub ci-keep">{r.skip}. נשמר בתיק ובמסמך</span>
                  : r.cands.length ? <select aria-label={`מסלול: ${r.trackName ?? r.plan ?? r.typeHe}`} value={manual[r.key] ?? ''} onChange={(e) => setManual({ ...manual, [r.key]: e.target.value })}><option value="">לא הותאם: לבחור</option>{r.cands.map((c) => byK.get(c)).filter((x): x is FundX => !!x).map((x) => <option key={x.k} value={x.k}>{x.name}</option>)}</select>
                  : <span className="ci-sub ci-keep">לא הותאם ({r.why}). נשמר בתיק ובמסמך</span>}</td>
                <td><span className="num">{ils(r.balance)}</span></td><td><span className="num">{ils(r.monthly)}</span></td><td><span className="num">{pc(r.fee)}</span></td><td><span className="num">{pc(r.depfee)}</span></td>
                <td>{(r.covers ?? []).length ? <ul className="ci-cov">{(r.covers ?? []).map((c, i) => <li key={i}>{c.name}{c.sum != null && <> · <span className="num">{ils(c.sum)}</span></>}{c.rate != null && <> · <span className="num">{nf(c.rate, 0)}%</span> מהשכר</>}{c.cost != null && <> · עלות <span className="num">{ils(c.cost)}</span></>}</li>)}</ul> : <span className="ci-sub">–</span>}</td>
              </tr>); })}</tbody>
          </table></div>}
          {harb && <div className="ci-harb">
            {harb.map((h) => <p key={h.name} className={h.error ? 'ci-err' : 'ci-warn'}><b>{h.name}:</b> {h.error ?? h.warn.filter((w) => w !== HARB_WARN).join(' · ')}</p>)}
            {hRows.length > 0 && <>
              <p className="ci-sum" role="status"><b>צד הסיכון: {hRows.length} פוליסות מהר הביטוח</b>{risk ? ` · ₪${Math.round(risk.monthly).toLocaleString('en-US')} לחודש` : ''}{risk?.flags.length ? ` · ${risk.flags.length} נקודות לבדיקה, מוצגות בתיק` : ''}</p>
              <div className="scroll"><table className="fsimple ci-t">
                <caption className="sr-only">הפוליסות שבקובץ מהר הביטוח</caption>
                <thead><tr><th>חברה</th><th>כיסוי</th><th>תקופה</th><th>פרמיה</th></tr></thead>
                <tbody>{hRows.map((r, i) => <tr key={i}>
                  <td>{shortIns(r.insurer)}</td>
                  <td><b>{r.product ?? r.sub ?? r.main ?? '–'}</b>{(r.sub || r.main) && r.product && <span className="ci-sub">{r.sub ?? r.main}</span>}</td>
                  <td><span className="num">{r.start ? r.start.split('-').reverse().join('.') : '–'}</span>{r.end && <> עד <span className="num">{r.end.split('-').reverse().join('.')}</span></>}</td>
                  <td><span className="num">{ils(r.premium)}</span><span className="ci-sub">{r.premiumPer === 'month' ? 'לחודש' : r.premiumPer === 'year' ? 'לשנה' : 'לא צוין לאיזו תקופה'}</span></td>
                </tr>)}</tbody>
              </table></div>
              <p className="csave-priv">{HARB_WARN}. נשמרים בתיק רק החברה, הענף, התקופה, הפרמיה וארבע הספרות האחרונות של מספר הפוליסה.</p>
            </>}
          </div>}
          <div className="ci-save">
            <label htmlFor="ci-l">שם או כינוי לתיק החדש</label>
            <input id="ci-l" value={label} onChange={(e) => { setLabel(e.target.value); setErr(null); }} maxLength={80} placeholder="למשל: ד.כ., מסלקה 11/26" autoComplete="off" />
            <div className="csave-acts">
              <button type="button" className="btn primary" disabled={(!rows.length && !hRows.length) || !lab || taken} onClick={save}>{nextLabel ?? (wiz ? 'יצירת תיק והמשך לניוד' : 'יצירת תיק לקוח')} ({[rows.length ? `${rows.length} מוצרים` : null, hRows.length ? `${hRows.length} פוליסות` : null].filter(Boolean).join(', ')})</button>
              <button type="button" className="btn" onClick={reset}>ביטול</button>
            </div>
            {(err || taken) && <p role="alert" className="csave-msg">{err ?? 'כבר יש תיק בשם הזה. הייבוא יוצר תיק חדש: בחרו שם אחר'}</p>}
          </div>
          <p className="csave-priv">היתרות, ההפקדות ודמי הניהול הם של הלקוח, כפי שהם בקובץ (דמי ניהול מצבירה: מתנאי החשבון; כשאין, החודש האחרון × 12, אומדן). המוצרים שהותאמו למסלול שמתפרסם נכנסים לתיק כמסלולים "קיים" להשוואה ולמסמך ללקוח. <Link className="sv-u" to="/clients">תיקי לקוחות</Link></p>
        </div>
      )}
    </div>
  );
}
