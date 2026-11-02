import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../Icon';
import type { FundX } from '../../lib/funds';
import type { MyProduct } from '../../lib/mine';
import { FEE_HOW, applyRows, decodeXml, parseMaslaka, readTree, rowsOf, sniff, type MFund, type Row } from '../../lib/maslaka';
import { pcf } from '../../lib/verdict';

/* W3 · "ייבוא מהמסלקה" on /my (בטא): the reader picks the XML files of their clearing-house report; they are read here (FileReader +
   DOMParser through lib/maslaka), matched to the regulator's tracks, shown for review, and only then saved into "המוצרים שלי"
   (localStorage). The files never leave the device, and nothing but the track, the balance, the monthly deposit and the fees is kept. */

export const SWIFTNESS = 'https://www.swiftness.co.il/savers/';
export const KZ_MASLAKA = 'https://www.kolzchut.org.il/he/%D7%9E%D7%99%D7%93%D7%A2_%D7%A2%D7%9C_%D7%94%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA_%D7%94%D7%A4%D7%A0%D7%A1%D7%99%D7%95%D7%A0%D7%99%D7%99%D7%9D_%D7%95%D7%A7%D7%A8%D7%A0%D7%95%D7%AA_%D7%94%D7%A9%D7%AA%D7%9C%D7%9E%D7%95%D7%AA_%D7%91%D7%90%D7%9E%D7%A6%D7%A2%D7%95%D7%AA_%D7%94%D7%9E%D7%A1%D7%9C%D7%A7%D7%94_%D7%94%D7%A4%D7%A0%D7%A1%D7%99%D7%95%D7%A0%D7%99%D7%AA';
const MAX_BYTES = 20_000_000;
const ils = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const ymd = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
const BY: Record<string, string> = { id: 'לפי מספר הקופה', track: 'לפי מספר הקופה והמסלול', name: 'לפי שם המסלול, לבדיקה', manual: 'בחירה שלך' };

/** an iPhone or iPad (iPadOS reports a Mac with touch) */
const isIOS = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
/** W5 (red team 3): the clearing house sends a password-protected zip, and the iPhone's Files app opens a plain zip but not one with a
 *  password (no Apple page found that says otherwise, 02.11.26). The honest way: open it on a computer. */
const IOS_ZIP = 'באייפון, אפליקציית "קבצים" לא פותחת קובץ zip שמוגן בסיסמה. פתחו את הקובץ במחשב, ושם בחרו כאן את קובצי ה-XML; או העבירו את קובצי ה-XML מהמחשב לאייפון (למשל ב-iCloud Drive) ובחרו אותם מ"קבצים".';

interface Read { name: string; rows: Row[]; error?: string; warn: string[] }

export function MaslakaImport({ funds, mine, onSave, today }: { funds: FundX[]; mine: MyProduct[]; onSave: (next: MyProduct[], msg: string) => void; today: string }) {
  const [open, setOpen] = useState(false);
  const [reads, setReads] = useState<Read[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const inp = useRef<HTMLInputElement>(null);
  const byK = useMemo(() => new Map(funds.map((f) => [f.k, f])), [funds]);
  const have = new Set(mine.map((m) => m.k));
  const ios = useMemo(isIOS, []);

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const out: Read[] = [];
    let n = 0;
    for (const file of Array.from(files)) {
      n++;
      try {
        if (file.size > MAX_BYTES) throw new Error('הקובץ גדול מדי לקובץ מסלקה');
        const buf = new Uint8Array(await file.arrayBuffer());
        const kind = sniff(buf);
        if (kind === 'zip') throw new Error(ios ? `זה קובץ zip (או Excel). ${IOS_ZIP}` : 'זה קובץ zip (או Excel). פתחו אותו קודם במחשב (הסיסמה מגיעה מהמסלקה), ובחרו כאן את קובצי ה-XML שבתוכו.');
        if (kind === 'pdf') throw new Error('זה קובץ PDF. הייבוא קורא רק את קובצי ה-XML שבחבילה מהמסלקה');
        if (kind !== 'xml') throw new Error('זה לא נראה כמו קובץ מהמסלקה הפנסיונית: הייבוא קורא את קובצי ה-XML שבחבילה מהמסלקה.');
        const parsed = parseMaslaka(readTree(decodeXml(buf)));
        out.push({ name: file.name, rows: rowsOf(parsed, funds as MFund[], `f${n}`), warn: parsed.warn });
      } catch (e) {
        out.push({ name: file.name, rows: [], warn: [], error: e instanceof Error ? e.message : String(e) });
      }
    }
    const p: Record<string, boolean> = {};
    out.forEach((r) => r.rows.forEach((x) => { if (x.k && !x.skip) p[x.key] = true; }));
    setPick(p); setManual({}); setReads(out); setBusy(false);
  };

  const rows = (reads ?? []).flatMap((r) => r.rows);
  const eff = (r: Row): Row => (manual[r.key] ? { ...r, k: manual[r.key], by: 'manual' } : r);
  const chosen = rows.map(eff).filter((r) => r.k && !r.skip && pick[r.key]);
  const matched = rows.filter((r) => r.k && !r.skip), unmatched = rows.filter((r) => !r.k && !r.skip), skipped = rows.filter((r) => r.skip);
  const save = () => {
    const res = applyRows(mine, chosen, today);
    onSave(res.list as MyProduct[], `נשמרו ${res.added + res.updated} מוצרים מהמסלקה${res.added ? `: ${res.added} חדשים` : ''}${res.updated ? `${res.added ? ',' : ':'} ${res.updated} עודכנו` : ''}. הקובץ עצמו לא נשמר.`);
    setReads(null); setOpen(false);
  };
  const reset = () => { setReads(null); setPick({}); setManual({}); if (inp.current) inp.current.value = ''; };

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
          {r.k && !r.skip && <span className={`mk-by${r.by === 'name' ? ' warn' : ''}`}>{BY[r.by ?? ''] ?? ''}{have.has(r.k) ? ' · יעודכן' : ' · חדש'}</span>}
        </div>
        {r.skip ? <p className="mk-why">{r.why}</p> : !r.k && <p className="mk-why">לא הותאם: {r.why}.</p>}
        {!r.skip && <dl className="mk-kv">
          <div><dt>יתרה (שלך)</dt><dd className="num">{ils(r.balance)}</dd></div>
          <div><dt>הפקדה חודשית (שלך)</dt><dd className="num">{ils(r.monthly)}</dd></div>
          <div><dt>דמי ניהול מצבירה (שלך)</dt><dd><span className="num">{pcf(r.fee)}</span>{r.feeHow && <span className="mk-how">{FEE_HOW[r.feeHow]}</span>}</dd></div>
          <div><dt>דמי ניהול מהפקדה (שלך)</dt><dd><span className="num">{pcf(r.depfee)}</span>{r.depHow && <span className="mk-how">{FEE_HOW[r.depHow]}</span>}</dd></div>
        </dl>}
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
          <p>טוענים את הדוח מהמסלקה הפנסיונית, ורואים את המוצרים, היתרות ודמי הניהול <b>שלכם</b> לאישור לפני שמירה.</p>
          <button type="button" className="btn" onClick={() => setOpen(true)}>לייבוא קובץ מהמסלקה</button>
        </div>
      ) : (
        <div className="mk-body">
          <p className="sv-privacy mk-priv"><Icon name="shield" /> הקובץ נקרא בדפדפן הזה בלבד ולא יוצא מהמכשיר. לא נשמרים ממנו שם, תעודת זהות, מספר חשבון או מעסיק: רק המסלול, היתרה, ההפקדה ודמי הניהול, וגם זה רק אחרי שתאשרו.</p>
          <ol className="mk-steps">
            <li>מזמינים דוח ב<a href={SWIFTNESS} target="_blank" rel="noreferrer">אתר המסלקה הפנסיונית</a> (<a href={KZ_MASLAKA} target="_blank" rel="noreferrer">איך, בכל זכות</a>).</li>
            <li>החבילה מגיעה כקובץ zip מוגן בסיסמה. {ios ? <b>באייפון: פתחו את הקובץ במחשב.</b> : 'פותחים אותו במחשב.'}</li>
            <li>בוחרים כאן את קובצי ה-XML שבתוכו (קובץ לכל חברה; אפשר כמה בבת אחת).</li>
          </ol>
          {ios && <p className="sv-note mk-ios">{IOS_ZIP}</p>}
          <label className="btn primary mk-file">
            {busy ? 'קורא…' : 'בחירת קובצי XML'}
            <input ref={inp} type="file" accept=".xml,text/xml,application/xml" multiple onChange={(e) => void readFiles(e.target.files)} />
          </label>
          {reads && (
            <div className="mk-review" role="region" aria-label="סקירה לפני שמירה" aria-live="polite">
              <h3>נמצאו {matched.length + unmatched.length} מוצרים{matched.length ? `, ${matched.length} הותאמו למסלולים בנתוני הרשות` : ''}{unmatched.length ? `, ${unmatched.length} לא הותאמו` : ''}</h3>
              {reads.filter((r) => r.error || r.warn.length).map((r) => <p key={r.name} className={r.error ? 'mk-err' : 'mk-warn'}><b>{r.name}:</b> {r.error ?? r.warn.join(' · ')}</p>)}
              {matched.length > 0 && <ul className="mk-list">{matched.map((r) => rowLine(r))}</ul>}
              {unmatched.length > 0 && <><h4>לא הותאמו</h4><ul className="mk-list">{unmatched.map((r) => rowLine(r))}</ul></>}
              {skipped.length > 0 && <><h4>לא נכללים</h4><ul className="mk-list">{skipped.map((r) => rowLine(r))}</ul></>}
              <div className="mk-acts">
                <button type="button" className="btn primary" disabled={!chosen.length} onClick={save}>שמירה ב"המוצרים שלי" ({chosen.length})</button>
                <button type="button" className="btn" onClick={reset}>ביטול</button>
              </div>
              <p className="sv-note">היתרה, ההפקדה ודמי הניהול הם שלכם, כפי שהם בקובץ. דמי הניהול מצבירה נלקחים מתנאי החשבון (שיעור שנתי); כשאין, מהחודש האחרון בקובץ כפול 12 (אומדן). ההפקדה החודשית: ההפקדה האחרונה, לפני עלות הביטוח.</p>
            </div>
          )}
          <p className="sv-note">בטא: ייתכן שחלק מהקבצים לא ייקראו; אז אפשר להקליד את המספרים בכרטיס. הקובץ לא יוצא מהמכשיר.</p>
          <details className="mk-tech">
            <summary>פרטים טכניים</summary>
            <p className="sv-note mk-spec">שמות השדות לפי מבנה ה-XML האחיד של רשות שוק ההון ("ממשק אחזקות", גרסה 008). קובצי המסלקה היום בגרסה 009, שעוד לא נבדקה מול מקור, ולכן ייתכן ששדה לא ייקרא. ההתאמה למסלול: לפי מספר הקופה שבקוד המסלול בקובץ, ואם אין, לפי שם המסלול. באתר "הר הכסף" לא מצאנו הורדה בפורמט XML.</p>
          </details>
        </div>
      )}
    </section>
  );
}
