import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Kpi, Panel } from '../components/ui';
import { Icon } from '../components/Icon';
import { CoverPrice } from '../components/agent/CoverPrice';
import { useFunds } from '../lib/useData';
import { useOptional } from '../lib/fundsLoad';
import type { FundsFile, FundX } from '../lib/funds';
import type { DefaultFile } from '../lib/fundsTools';
import { folderFromImport, upsert, useClients, type Folder, type Held } from '../lib/clients';
import { decodeXml, heldOf, parseMaslaka, readTree, rowsOf, sniff, type MFund } from '../lib/maslaka';
import { bookOf, hhiText, sliceItems, type BookItem, type Slice } from '../lib/agentBook';
import { today } from '../lib/visits';
import '../styles/agent.css';
import '../styles/agent-book.css';

/* W11 · /clients/book, "מבחן לחץ לתיק" (agent door): every client folder in this browser, and any clearing-house files the agent drops
   here, as one book (lib/agentBook): totals, exposure by manager group and product, concentration, and the lines that need a look (a
   negative actuarial balance, a fee above the category median, a default-fund price that may end, a closed generation or a guaranteed
   coefficient). Each line opens the folders behind it. Then the cover price of every comprehensive fund, by its bylaws and by its claims
   report. All of it runs in this browser: nothing is sent, the dropped files are read into memory and kept only if the agent saves them. */

const ils = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const pc = (v: number | null | undefined, d = 1) => (v == null ? '–' : `${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
const MAX_BYTES = 20_000_000;
type Sel = { k: 'line'; id: string } | { k: 'g' | 'p'; key: string } | null;
interface Extra { f: Folder; warn: string[]; error?: string }

export function Book() {
  const [file, setFile] = useClients();
  const data = useFunds().data as FundsFile | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const [extra, setExtra] = useState<Extra[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const drill = useRef<HTMLDivElement>(null);
  const funds: FundX[] = useMemo(() => data?.funds ?? [], [data]);
  const extraOk = useMemo(() => extra.filter((x) => !x.error && x.f.held.length), [extra]);
  const folders = useMemo(() => [...file.folders.filter((f) => f.held.length), ...extraOk.map((x) => x.f)], [file, extraOk]);
  const noHeld = file.folders.length - file.folders.filter((f) => f.held.length).length;
  const book = useMemo(() => (data ? bookOf(folders, funds, dfile, today(), extraOk.length) : null), [folders, funds, dfile, data, extraOk.length]);
  const isExtra = (id: string) => id.startsWith('x-');

  const readFiles = async (list: FileList | null) => {
    if (!list?.length || !data) return;
    const out: Extra[] = [];
    let n = extra.length;
    for (const f of Array.from(list)) {
      n++;
      const id = `x-${n}-${Math.random().toString(36).slice(2, 7)}`;
      try {
        if (f.size > MAX_BYTES) throw new Error('הקובץ גדול מדי לקובץ מסלקה');
        const buf = new Uint8Array(await f.arrayBuffer());
        const kind = sniff(buf);
        if (kind === 'zip') throw new Error('קובץ zip: פותחים אותו קודם במכשיר ובוחרים את קובצי ה-XML שבתוכו');
        if (kind !== 'xml') throw new Error('זה לא קובץ XML של המסלקה');
        const parsed = parseMaslaka(readTree(decodeXml(buf)));
        const held = heldOf(rowsOf(parsed, funds as MFund[], `b${n}`)) as Held[];
        const f2 = folderFromImport(f.name.replace(/\.xml$/i, ''), held);
        out.push({ f: { id, label: f2.label, keys: f2.keys, tags: f2.tags, held: f2.held, b: 'net', fields: {}, note: '', created: today(), updated: today(), snap: null }, warn: parsed.warn });
      } catch (e) {
        out.push({ f: { id, label: f.name, keys: [], tags: {}, held: [], b: 'net', fields: {}, note: '', created: today(), updated: today(), snap: null }, warn: [], error: e instanceof Error ? e.message : String(e) });
      }
    }
    setExtra([...extra, ...out]);
  };
  const saveExtra = (x: Extra) => {
    const taken = file.folders.some((f) => f.label.trim().toLowerCase() === x.f.label.trim().toLowerCase());
    const label = taken ? `${x.f.label} (${today().split('-').reverse().join('.')})` : x.f.label;
    const r = upsert(file, { ...folderFromImport(label, x.f.held), b: 'net', note: `ייבוא מהמסלקה דרך תיק הלקוחות, ${today().split('-').reverse().join('.')}` }, today());
    setFile(r.file);
    setExtra(extra.filter((e) => e !== x));
    setMsg(`נשמר תיק "${r.folder.label}" בדפדפן הזה (${x.f.held.length} מוצרים). הקובץ עצמו לא נשמר.`);
  };
  const open = (s: Sel) => { setSel(s); requestAnimationFrame(() => drill.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); };
  const same = (s: Sel) => JSON.stringify(s) === JSON.stringify(sel);

  let drillItems: BookItem[] = [], drillTitle = '';
  if (book && sel) {
    if (sel.k === 'line') { const l = book.lines.find((x) => x.id === sel.id); drillItems = l?.items ?? []; drillTitle = l?.title ?? ''; }
    else { drillItems = sliceItems(folders, funds, sel.k, sel.key); drillTitle = `${sel.k === 'g' ? 'גוף מנהל' : 'מוצר'}: ${(sel.k === 'g' ? book.byGroup : book.byProduct).find((s) => s.key === sel.key)?.label ?? ''}`; }
  }
  const byFolder = new Map<string, BookItem[]>();
  drillItems.forEach((i) => byFolder.set(i.folder, [...(byFolder.get(i.folder) ?? []), i]));

  return (
    <div className="clients abook">
      <div className="pagehead"><div>
        <span className="eyebrow">סוכן · <Link to="/clients">תיקי לקוחות</Link></span>
        <h1><span className="icotile"><Icon name="inbox" /></span>מבחן לחץ לתיק הלקוחות</h1>
        <div className="sub">כל תיקי הלקוחות שבדפדפן הזה, יחד: חשיפה לפי גוף מנהל ומוצר, ריכוזיות, והשורות שכדאי לבדוק. כל שורה נפתחת לרשימת התיקים שמאחוריה.</div>
      </div></div>
      <p className="ab-priv" role="note"><Icon name="shield" /><span><b>שום דבר לא יוצא מהדפדפן.</b> החישוב רץ כאן, על התיקים השמורים בדפדפן הזה ועל קבצים שתוסיפו למטה; לא נשלח דבר לשרת ולא נכנס לכתובת העמוד. קובץ שמוסיפים כאן נקרא לזיכרון בלבד, ונעלם כשסוגרים את העמוד, אלא אם תבחרו לשמור אותו כתיק.</span></p>

      <Panel title="קבצי מסלקה נוספים" aside={<span>לא נשמרים, אלא אם תבחרו</span>}>
        <div className="ab-drop">
          <label className="btn">{data ? 'הוספת קובצי XML של לקוחות' : 'טוען…'}<input type="file" accept=".xml,text/xml,application/xml" multiple disabled={!data} onChange={(e) => { void readFiles(e.target.files); e.target.value = ''; }} /></label>
          <span className="muted">כל קובץ נחשב תיק זמני בניתוח. הקורא אינו פותח שם, תעודת זהות, מספר חשבון או מעסיק.</span>
        </div>
        {extra.length > 0 && <ul className="ab-extra">{extra.map((x) => <li key={x.f.id}>
          <b>{x.f.label}</b>{x.error ? <span className="ci-err"> · {x.error}</span> : <span> · {x.f.held.length} מוצרים{x.warn.length ? ` · ${x.warn.join(' · ')}` : ''} · <span className="chip est">זמני, לא נשמר</span></span>}
          <span className="ab-acts">{!x.error && x.f.held.length > 0 && <button type="button" className="chip" onClick={() => saveExtra(x)}>שמירה כתיק</button>}
            <button type="button" className="chip" onClick={() => setExtra(extra.filter((e) => e !== x))}>הסרה</button></span>
        </li>)}</ul>}
        {msg && <p role="status" className="csave-msg">{msg}</p>}
      </Panel>

      {!data ? <p className="muted">טוען את נתוני המסלולים…</p> : !book || !folders.length ? (
        <Panel><Empty title="אין עדיין מוצרים בתיקים" icon="inbox">מבחן הלחץ עובד על המוצרים שבתיקים (מייבוא מהמסלקה). ייבאו קובץ ב<Link to="/clients">תיקי לקוחות</Link>, או הוסיפו כאן קובץ לניתוח בלבד.{noHeld ? ` ${noHeld} תיקים בדפדפן הם השוואות בלי מוצרים מהמסלקה.` : ''}</Empty></Panel>
      ) : <>
        <div className="kpis ab-kpis">
          <Kpi label="תיקים" value={book.folders.toLocaleString('en-US')} sub={`${book.extra ? `${book.extra} מהם קבצים זמניים · ` : ''}${noHeld ? `${noHeld} תיקים בלי מוצרים לא נכללים` : 'כל התיקים עם מוצרים'}`} />
          <Kpi label="מוצרים" value={book.products.toLocaleString('en-US')} sub={`${book.matched} הותאמו למסלול שפורסם`} />
          <Kpi label="יתרות" value={ils(book.balance)} sub="סך היתרות בקבצים" />
          <Kpi label="הפקדות לחודש" value={ils(book.monthly)} sub="ההפקדה האחרונה בקובץ" />
          <Kpi label="דמי ניהול לשנה (אומדן)" value={ils(book.feeYear)} sub={`יתרה × ד"נ מצבירה + 12 × הפקדה × ד"נ מהפקדה${book.noFee ? `; ${book.noFee} מוצרים בלי ד"נ בקובץ` : ''}`} />
        </div>

        <Panel title="שורות לבדיקה" aside={<span>לחיצה פותחת את התיקים</span>}>
          <ul className="ab-lines">{book.lines.map((l) => <li key={l.id}>
            <button type="button" className="ab-line" aria-expanded={same({ k: 'line', id: l.id })} aria-controls="ab-drill" disabled={!l.items.length} onClick={() => open(same({ k: 'line', id: l.id }) ? null : { k: 'line', id: l.id })}>
              <span className="ab-l-t">{l.title}</span>
              <span className="ab-l-v">{l.value}</span>
              <span className="ab-l-n">{l.items.length ? `${l.folders} ${l.folders === 1 ? 'תיק' : 'תיקים'}` : 'אין'}</span>
              <span className="ab-l-s">{l.sub}</span>
            </button>
          </li>)}</ul>
        </Panel>

        <div className="ab-two">
          <Panel title="חשיפה לפי גוף מנהל" aside={<span>{hhiText(book.hhi, book.byGroup.length)}</span>}>
            <Slices rows={book.byGroup} axis="g" open={open} same={same} />
            {book.top && <p className="fnote">הגוף הגדול בתיק: {book.top.label}, {pc(book.top.share)} מהיתרות. גוף שלא הותאם מוצג בשם שבקובץ.</p>}
          </Panel>
          <Panel title="חשיפה לפי מוצר">
            <Slices rows={book.byProduct} axis="p" open={open} same={same} />
          </Panel>
        </div>

        <div id="ab-drill" ref={drill} className="ab-drill" aria-live="polite">
          {sel && <Panel title={drillTitle} aside={<button type="button" className="chip" onClick={() => setSel(null)}>סגירה</button>}>
            {!drillItems.length ? <p className="muted">אין תיקים בשורה הזו.</p> : <ul className="ab-dl">{[...byFolder].map(([id, items]) => <li key={id}>
              <div className="ab-dl-h"><b>{items[0].label}</b>{isExtra(id) ? <span className="chip est">קובץ זמני</span> : <Link to="/clients">בתיקי לקוחות</Link>}</div>
              <ul>{items.map((i) => <li key={i.held}><span>{i.what}</span>{i.amount != null && <span className="num"> · {ils(i.amount)}</span>}<span className="ab-dl-d">{i.detail}</span></li>)}</ul>
            </li>)}</ul>}
          </Panel>}
        </div>
      </>}

      <Panel title="מחיר הכיסוי לנכות ולשאירים: לפי התקנון ולפי התביעות" aside={<span>קרנות פנסיה מקיפות · תיאור, לא דירוג</span>}>
        <CoverPrice />
      </Panel>
    </div>
  );
}

function Slices({ rows, axis, open, same }: { rows: Slice[]; axis: 'g' | 'p'; open: (s: Sel) => void; same: (s: Sel) => boolean }) {
  if (!rows.length) return <p className="muted">אין יתרות.</p>;
  const max = Math.max(...rows.map((r) => r.share));
  return (
    <div className="scroll"><table className="fsimple ab-sl">
      <thead><tr><th scope="col">{axis === 'g' ? 'גוף' : 'מוצר'}</th><th scope="col">יתרות</th><th scope="col">%</th><th scope="col" className="ab-bar"><span className="sr-only">חלק</span></th><th scope="col">תיקים</th></tr></thead>
      <tbody>{rows.map((r) => { const s: Sel = { k: axis, key: r.key }; return (
        <tr key={r.key}>
          <th scope="row"><button type="button" className="ab-sl-b" aria-expanded={same(s)} aria-controls="ab-drill" onClick={() => open(same(s) ? null : s)}>{r.label}</button>{!r.matched && <span className="ab-um"> (לא הותאם)</span>}</th>
          <td><span className="num">{ils(r.balance)}</span></td>
          <td><span className="num">{pc(r.share)}</span></td>
          <td className="ab-bar"><i style={{ width: `${Math.max(2, (r.share / (max || 1)) * 100)}%` }} /></td>
          <td><span className="num">{r.folders.length}</span></td>
        </tr>); })}</tbody>
    </table></div>
  );
}
