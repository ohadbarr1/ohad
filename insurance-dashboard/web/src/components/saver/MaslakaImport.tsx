import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../Icon';
import type { FundX } from '../../lib/funds';
import type { MyProduct } from '../../lib/mine';
import { FEE_HOW, MATCH_BY, applyRows, decodeXml, mergeMFiles, parseMaslaka, readTree, rowsOf, sniff, type MFile, type MFund, type Row } from '../../lib/maslaka';
import { pcf } from '../../lib/verdict';

/* W3 · "ייבוא מהמסלקה" on /my (בטא): the reader picks their clearing-house report; it is read here (lib/maslaka), matched to the
   regulator's tracks, shown for review, and only then saved into "המוצרים שלי" (localStorage). The files never leave the device.
   W7 · the zip the clearing house sends is opened here too (lib/zipRead: ZipCrypto and AES, with the password from the clearing
   house's e-mail), so the import works on a phone; several provider files in one zip become one review; the review says how each
   track was matched and how many deposit months and covers the file carries. `useMaslakaFiles` and `ZipPassword` are exported for
   the agent door's import (components/agent/ClientImport) to reuse. The password lives in component state for the one attempt. */

export const SWIFTNESS = 'https://www.swiftness.co.il/savers/';
export const KZ_MASLAKA = 'https://www.kolzchut.org.il/he/%D7%9E%D7%99%D7%93%D7%A2_%D7%A2%D7%9C_%D7%94%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA_%D7%94%D7%A4%D7%A0%D7%A1%D7%99%D7%95%D7%A0%D7%99%D7%99%D7%9D_%D7%95%D7%A7%D7%A8%D7%A0%D7%95%D7%AA_%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA_%D7%91%D7%90%D7%9E%D7%A6%D7%A2%D7%95%D7%AA_%D7%94%D7%9E%D7%A1%D7%9C%D7%A7%D7%94_%D7%94%D7%A4%D7%A0%D7%A1%D7%99%D7%95%D7%A0%D7%99%D7%AA';
const MAX_BYTES = 40_000_000;
const ils = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const ymd = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
/** what the picker accepts: the zip as it came, or the XML files from inside it */
export const ACCEPT = '.zip,.xml,application/zip,application/x-zip-compressed,text/xml,application/xml';
/** W7 · where the zip password comes from (no public rule was found, 02.11.26: swiftness.co.il FAQ and guide, כל זכות; see lib/zipRead) */
export const PW_HINT = 'הסיסמה כתובה במייל שבו הגיע הקובץ מהמסלקה הפנסיונית. לא מצאנו כלל פומבי לסיסמה; אם המייל לא מציין אותה, אפשר לנסות את מספר תעודת הזהות, שהוא הנוהג בקבצים כאלה, או לפנות למסלקה.';

/** an iPhone or iPad (iPadOS reports a Mac with touch) */
const isIOS = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export interface Read { name: string; rows: Row[]; error?: string; warn: string[]; /** W7: provider files inside a zip */ parts?: number }

/** W7 · picked files → review rows: XML files as before; a zip is opened here (nested zips too), its provider XMLs merged into one
 *  file; PDFs and Excel are never read. Throws ZipError('need-password') when the zip needs the password, so the caller can ask. */
export async function readPicked(files: File[], funds: MFund[], password: string | null, ios: boolean): Promise<Read[]> {
  const out: Read[] = [];
  let n = 0;
  for (const file of files) {
    n++;
    try {
      if (file.size > MAX_BYTES) throw new Error('הקובץ גדול מדי לקובץ מסלקה');
      const buf = new Uint8Array(await file.arrayBuffer());
      const kind = sniff(buf);
      if (kind === 'pdf') throw new Error('זה קובץ PDF. הייבוא קורא את קובץ ה-zip מהמסלקה או את קובצי ה-XML שבתוכו');
      if (kind === 'zip' && /\.xlsx?$/i.test(file.name)) throw new Error('זה קובץ Excel. הייבוא קורא את קובץ ה-zip מהמסלקה או את קובצי ה-XML שבתוכו');
      if (kind === 'zip') {
        const { unpackZip } = await import('../../lib/zipRead');  // zip.js loads only when a zip is picked (keeps /my light)
        const u = await unpackZip(buf, password);  // ZipError('need-password') travels up to the caller
        if (!u.xml.length) throw new Error(`בקובץ ה-zip אין קובצי XML${u.skipped.length ? ` (יש בו: ${u.skipped.slice(0, 4).join(', ')}${u.skipped.length > 4 ? '…' : ''})` : ''}. זה לא נראה כמו החבילה מהמסלקה.`);
        const parts: { name: string; file: MFile }[] = [], warn: string[] = [];
        for (const x of u.xml) {
          try { parts.push({ name: x.name, file: parseMaslaka(readTree(decodeXml(x.data))) }); }
          catch (e) { warn.push(`${x.path}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        if (!parts.length) throw new Error(warn.join(' · ') || 'לא נקרא אף קובץ מתוך ה-zip');
        const merged = mergeMFiles(parts);
        out.push({ name: file.name, rows: rowsOf(merged, funds, `f${n}`), warn: [...merged.warn, ...warn], parts: parts.length });
        continue;
      }
      if (kind !== 'xml') throw new Error(`זה לא נראה כמו קובץ מהמסלקה הפנסיונית. בוחרים את קובץ ה-zip שהגיע מהמסלקה${ios ? ' (מ"קבצים" או מהמייל)' : ''} או את קובצי ה-XML שבתוכו.`);
      const parsed = parseMaslaka(readTree(decodeXml(buf)));
      out.push({ name: file.name, rows: rowsOf(parsed, funds, `f${n}`), warn: parsed.warn });
    } catch (e) {
      if (zipErr(e, 'need-password', 'wrong-password')) throw e;  // the password box handles both
      out.push({ name: file.name, rows: [], warn: [], error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** a lib/zipRead ZipError of one of these kinds (checked by name, so this component does not import zip.js statically) */
const zipErr = (e: unknown, ...kinds: string[]): e is Error & { kind: string } => e instanceof Error && e.name === 'ZipError' && kinds.includes((e as { kind?: string }).kind ?? '');
/** the sentences lib/zipRead uses (kept here as text so they show without loading zip.js) */
const WRONG_PW = 'הסיסמה לא פתחה את הקובץ. בודקים שוב במייל מהמסלקה (בלי רווחים; אותיות באנגלית לפי גודל).';
const NEED_PW = 'קובץ ה-zip מהמסלקה מוגן בסיסמה. הסיסמה כתובה במייל שבו הגיע הקובץ מהמסלקה הפנסיונית.';

/** W7 · the file-reading state machine shared by the saver's and the agent's import: pick files; if a zip needs a password, hold
 *  the files and ask; read again with the password. The password is kept only until the read ends. */
export function useMaslakaFiles(funds: MFund[]) {
  const [reads, setReads] = useState<Read[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File[] | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const ios = useMemo(isIOS, []);
  const run = useCallback(async (files: File[], password: string | null) => {
    setBusy(true); setPwErr(null);
    try {
      const out = await readPicked(files, funds, password, ios);
      setReads(out); setPending(null);
      return out;
    } catch (e) {
      if (zipErr(e, 'need-password', 'wrong-password')) { setPending(files); setPwErr(password ? WRONG_PW : null); return null; }
      setReads([{ name: files[0]?.name ?? '', rows: [], warn: [], error: e instanceof Error ? e.message : String(e) }]); setPending(null);
      return null;
    } finally { setBusy(false); }
  }, [funds, ios]);
  const pick = useCallback((list: FileList | null) => { if (list?.length) void run(Array.from(list), null); }, [run]);
  const withPassword = useCallback(async (pw: string) => {
    if (!pending) return;
    try {
      const out = await readPicked(pending, funds, pw, ios);
      setReads(out); setPending(null); setPwErr(null);
    } catch (e) {
      if (zipErr(e, 'need-password', 'wrong-password')) setPwErr(WRONG_PW);
      else { setReads([{ name: pending[0]?.name ?? '', rows: [], warn: [], error: e instanceof Error ? e.message : String(e) }]); setPending(null); }
    }
  }, [pending, funds, ios]);
  const reset = useCallback(() => { setReads(null); setPending(null); setPwErr(null); }, []);
  return { reads, busy, pending, pwErr, ios, pick, withPassword, reset, setReads };
}

/** W7 · the password box for a protected zip: the field, the hint about where the password is, and the privacy line */
export function ZipPassword({ files, err, onSubmit, onCancel }: { files: File[]; err: string | null; onSubmit: (pw: string) => void; onCancel: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form className="csave-form mk-pw" onSubmit={async (e) => { e.preventDefault(); if (!pw.trim() || busy) return; setBusy(true); await onSubmit(pw.trim()); setBusy(false); }} aria-labelledby="mk-pw-h">
      <p id="mk-pw-h" className="mk-why"><b>{files.length === 1 ? files[0].name : `${files.length} קבצים`}</b>: {NEED_PW}</p>
      <label htmlFor="mk-pw">הסיסמה לקובץ</label>
      <input id="mk-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="text" autoFocus aria-describedby="mk-pw-hint" />
      <p id="mk-pw-hint" className="csave-priv">{PW_HINT} הסיסמה משמשת לפתיחת הקובץ כאן, בדפדפן, ולא נשמרת ולא נשלחת לשום מקום.</p>
      {err && <p role="alert" className="mk-err">{err}</p>}
      <div className="csave-acts">
        <button type="submit" className="btn primary" disabled={!pw.trim() || busy}>{busy ? 'פותח…' : 'פתיחת הקובץ'}</button>
        <button type="button" className="btn" onClick={onCancel}>ביטול</button>
      </div>
    </form>
  );
}

/** W7 · what else the file carries for this row, in a few words: how it was matched, deposit months, covers, salary, coefficient */
export function rowFacts(r: Row): string[] {
  const f: string[] = [];
  const nd = r.deposits?.length ?? 0, nc = r.covers?.length ?? 0;
  f.push(nd ? `${nd === 1 ? 'חודש הפקדה אחד' : `${nd} חודשי הפקדה`} בקובץ` : 'אין פירוט הפקדות בקובץ');
  f.push(nc ? `${nc === 1 ? 'כיסוי ביטוחי אחד' : `${nc} כיסויים ביטוחיים`}` : 'אין כיסויים בקובץ');
  if (r.salary != null) f.push(`שכר מבוטח ${ils(r.salary)}`);
  if (r.insTrack) f.push(`מסלול ביטוח: ${r.insTrack}`);
  if (r.coefGuaranteed) f.push(`מקדם קצבה מובטח ${r.coefGuaranteed.v}${r.coefGuaranteed.at ? ` (גיל ${r.coefGuaranteed.at})` : ''}`);
  return f;
}

export function MaslakaImport({ funds, mine, onSave, today }: { funds: FundX[]; mine: MyProduct[]; onSave: (next: MyProduct[], msg: string) => void; today: string }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const inp = useRef<HTMLInputElement>(null);
  const byK = useMemo(() => new Map(funds.map((f) => [f.k, f])), [funds]);
  const have = new Set(mine.map((m) => m.k));
  const mf = useMaslakaFiles(funds as MFund[]);
  const { reads, busy, pending, pwErr, ios } = mf;

  const afterRead = (out: Read[] | null) => {
    if (!out) return;
    const p: Record<string, boolean> = {};
    out.forEach((r) => r.rows.forEach((x) => { if (x.k && !x.skip) p[x.key] = true; }));
    setPick(p); setManual({});
  };
  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    mf.pick(list);
  };
  // the picks follow the latest read
  const readsKey = reads ? reads.map((r) => r.name + r.rows.length).join('|') : '';
  const lastKey = useRef('');
  if (readsKey !== lastKey.current) { lastKey.current = readsKey; afterRead(reads); }

  const rows = (reads ?? []).flatMap((r) => r.rows);
  const eff = (r: Row): Row => (manual[r.key] ? { ...r, k: manual[r.key], by: 'manual' } : r);
  const chosen = rows.map(eff).filter((r) => r.k && !r.skip && pick[r.key]);
  const matched = rows.filter((r) => r.k && !r.skip), unmatched = rows.filter((r) => !r.k && !r.skip), skipped = rows.filter((r) => r.skip);
  const nDep = chosen.reduce((t, r) => t + (r.deposits?.length ?? 0), 0), nCov = rows.reduce((t, r) => t + (r.covers?.length ?? 0), 0);
  const save = () => {
    const res = applyRows(mine, chosen, today);
    onSave(res.list as MyProduct[], `נשמרו ${res.added + res.updated} מוצרים מהמסלקה${res.added ? `: ${res.added} חדשים` : ''}${res.updated ? `${res.added ? ',' : ':'} ${res.updated} עודכנו` : ''}${nDep ? `, עם ${nDep} חודשי הפקדה` : ''}. הקובץ עצמו לא נשמר.`);
    mf.reset(); setOpen(false);
  };
  const reset = () => { mf.reset(); setPick({}); setManual({}); if (inp.current) inp.current.value = ''; };

  const rowLine = (r0: Row) => {
    const r = eff(r0), f = r.k ? byK.get(r.k) : undefined;
    const sel = !!pick[r.key];
    return (
      <li key={r0.key} className={`mk-row${r.k ? '' : ' none'}`}>
        <div className="mk-row-h">
          {r.k && !r.skip && <input type="checkbox" checked={sel} onChange={(e) => setPick({ ...pick, [r.key]: e.target.checked })} aria-label={`לשמור: ${f?.name ?? r.trackName ?? r.plan ?? ''}`} />}
          <div className="mk-row-t">
            <b>{f ? <Link to={`/funds/${f.k}`}>{f.name}</Link> : (r.trackName ?? r.plan ?? r.typeHe)}</b>
            <span className="mk-sub">{r.typeHe}{r.providerName ? ` · ${r.providerName}` : ''}{r.trackName && f ? ` · בקובץ: ${r.trackName}` : ''}</span>
          </div>
          {r.k && !r.skip && <span className={`mk-by${r.by === 'name' ? ' warn' : ''}`}>{r.by ? MATCH_BY[r.by] : ''}{have.has(r.k) ? ' · יעודכן' : ' · חדש'}</span>}
        </div>
        {r.skip ? <p className="mk-why">{r.why}</p> : !r.k && <p className="mk-why">לא הותאם: {r.why}.</p>}
        {!r.skip && <dl className="mk-kv">
          <div><dt>יתרה (שלך)</dt><dd className="num">{ils(r.balance)}</dd></div>
          <div><dt>הפקדה חודשית (שלך)</dt><dd className="num">{ils(r.monthly)}</dd></div>
          <div><dt>דמי ניהול מצבירה (שלך)</dt><dd><span className="num">{pcf(r.fee)}</span>{r.feeHow && <span className="mk-how">{FEE_HOW[r.feeHow]}</span>}</dd></div>
          <div><dt>דמי ניהול מהפקדה (שלך)</dt><dd><span className="num">{pcf(r.depfee)}</span>{r.depHow && <span className="mk-how">{FEE_HOW[r.depHow]}</span>}</dd></div>
        </dl>}
        <p className="mk-sub mk-facts">{rowFacts(r).join(' · ')}</p>
        {!r0.k && !r0.skip && r0.cands.length > 0 && (
          <label className="mk-manual"><span>לבחור את המסלול בעצמכם:</span>
            <select value={manual[r.key] ?? ''} onChange={(e) => { const v = e.target.value; setManual({ ...manual, [r.key]: v }); setPick({ ...pick, [r.key]: !!v }); }}>
              <option value="">לא לשמור</option>
              {r0.cands.map((k) => byK.get(k)).filter((x): x is FundX => !!x).map((x) => <option key={x.k} value={x.k}>{x.name} · מס' {x.id}{x.closed ? ' · נסגר' : ''}</option>)}
            </select>
          </label>
        )}
        {r.warn.length > 0 && <p className="mk-warn">{r.warn.join(' · ')}</p>}
        {r.asof && !r.skip && <p className="mk-asof">נכון ל-{ymd(r.asof)}, לפי הקובץ</p>}
      </li>
    );
  };

  return (
    <section className="panel sv-add mk" aria-labelledby="mk-h">
      <div className="hd"><h2 id="mk-h">ייבוא מהמסלקה <span className="sv-tag">בטא</span></h2><div className="aside"><span>במקום להקליד</span></div></div>
      {!open ? (
        <div className="mk-intro">
          <p>טוענים את הדוח מהמסלקה הפנסיונית ורואים את המוצרים, ההפקדות ודמי הניהול <b>שלכם</b> לפני שמירה. עובד גם בטלפון.</p>
          <button type="button" className="btn" onClick={() => setOpen(true)}>לייבוא קובץ מהמסלקה</button>
        </div>
      ) : (
        <div className="mk-body">
          <p className="sv-privacy mk-priv"><Icon name="shield" /> הקובץ והסיסמה שלו נקראים בדפדפן הזה בלבד ולא יוצאים מהמכשיר. לא נשמרים ממנו שם, תעודת זהות, מספר חשבון או מעסיק: רק המסלול, היתרה, ההפקדות ודמי הניהול, וגם זה רק אחרי שתאשרו.</p>
          <ol className="mk-steps">
            <li>מזמינים דוח ב<a href={SWIFTNESS} target="_blank" rel="noreferrer">אתר המסלקה הפנסיונית</a> (<a href={KZ_MASLAKA} target="_blank" rel="noreferrer">איך, בכל זכות</a>). הוא מגיע במייל כקובץ zip מוגן בסיסמה, והסיסמה כתובה באותו מייל.</li>
            <li>{ios ? <>באייפון: שומרים את קובץ ה-zip מהמייל ב"קבצים" (שיתוף ← "שמירה בקבצים"), ובוחרים אותו כאן. אין צורך לפתוח אותו.</> : <>בוחרים כאן את קובץ ה-zip כמו שהגיע (אין צורך לפתוח אותו), או את קובצי ה-XML שבתוכו.</>}</li>
            <li>מקלידים את הסיסמה מהמייל כשנשאלים, בודקים את הרשימה ושומרים.</li>
          </ol>
          <label className="btn primary mk-file">
            {busy ? 'קורא…' : ios ? 'בחירת קובץ מהמסלקה' : 'בחירת קובץ zip או XML'}
            <input ref={inp} type="file" accept={ACCEPT} multiple onChange={(e) => void onFiles(e.target.files)} />
          </label>
          {pending && <ZipPassword files={pending} err={pwErr} onSubmit={mf.withPassword} onCancel={reset} />}
          {reads && !pending && (
            <div className="mk-review" role="region" aria-label="סקירה לפני שמירה" aria-live="polite">
              <h3>נמצאו {matched.length + unmatched.length} מוצרים{matched.length ? `, ${matched.length} הותאמו למסלולים בנתוני הרשות` : ''}{unmatched.length ? `, ${unmatched.length} לא הותאמו` : ''}{nCov ? `, ${nCov} כיסויים ביטוחיים` : ''}</h3>
              {reads.filter((r) => r.parts && r.parts > 1).map((r) => <p key={r.name} className="mk-sub"><b>{r.name}:</b> {r.parts} קובצי חברות נקראו מתוך ה-zip ואוחדו לרשימה אחת.</p>)}
              {reads.filter((r) => r.error || r.warn.length).map((r) => <p key={r.name} className={r.error ? 'mk-err' : 'mk-warn'}><b>{r.name}:</b> {r.error ?? r.warn.join(' · ')}</p>)}
              {matched.length > 0 && <ul className="mk-list">{matched.map((r) => rowLine(r))}</ul>}
              {unmatched.length > 0 && <><h4>לא הותאמו</h4><ul className="mk-list">{unmatched.map((r) => rowLine(r))}</ul></>}
              {skipped.length > 0 && <><h4>לא נכללים</h4><ul className="mk-list">{skipped.map((r) => rowLine(r))}</ul></>}
              <div className="mk-acts">
                <button type="button" className="btn primary" disabled={!chosen.length} onClick={save}>שמירה ב"המוצרים שלי" ({chosen.length})</button>
                <button type="button" className="btn" onClick={reset}>ביטול</button>
              </div>
              <p className="sv-note">היתרה, ההפקדה ודמי הניהול הם שלכם, כפי שהם בקובץ. דמי הניהול מצבירה נלקחים מתנאי החשבון (שיעור שנתי); כשאין, מהחודש האחרון בקובץ כפול 12 (אומדן). ההפקדה החודשית: ההפקדה האחרונה, לפני עלות הביטוח. חודשי ההפקדה נשמרים עם המוצר, למעקב אחר הפקדות שלא הגיעו.</p>
            </div>
          )}
          <p className="sv-note">בטא: ייתכן שחלק מהקבצים לא ייקראו; אז אפשר להקליד את המספרים בכרטיס. הקובץ לא יוצא מהמכשיר.</p>
          <details className="mk-tech">
            <summary>פרטים טכניים</summary>
            <p className="sv-note mk-spec">שמות השדות לפי סכימת השדות של "ממשק אחזקות" של רשות שוק ההון, גרסה 008 (gov.il), בתוספת שמות שנראו בקבצים בגרסה 009; גרסת הקובץ נרשמת מהכותרת שלו. ההתאמה למסלול: קודם לפי הקוד האחיד (חברה, קופה ומסלול), אחר כך לפי מספר הקופה, ורק אז לפי שם המסלול. קובץ ה-zip נפתח בדפדפן (הצפנת ZipCrypto או AES). באתר "הר הכסף" לא מצאנו הורדה בפורמט XML.</p>
          </details>
        </div>
      )}
    </section>
  );
}
