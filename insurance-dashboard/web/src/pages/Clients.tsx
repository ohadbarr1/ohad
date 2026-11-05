import { Reminders } from '../components/Reminders';  // W8 feeds
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Panel } from '../components/ui';
import { Icon } from '../components/Icon';
import { useFunds } from '../lib/useData';
import type { FundsFile } from '../lib/funds';
import { BACKUP_KEY, LAST_FOLDER_KEY, brandOfFile, exportText, heldCost, heldSum, mergeClients, removeFolder, sorted, useClients, type Folder, type SnapRow } from '../lib/clients';
import { useStored, writeStored } from '../lib/local';
import { BrandPanel } from '../components/agent/BrandPanel';  // W7
import { ShareFolder, ShareImport } from '../components/agent/ShareFolder';  // W7
import { NyudTable } from '../components/agent/NyudTable';  // W7
import { nyudTable, type Basis } from '../lib/nyud';
import { hasBrand, normBranding, useBranding } from '../lib/branding';
import { useOptional } from '../lib/fundsLoad';
import { COEF_PATH, type CoefFile } from '../lib/coef';
import type { DefaultFile } from '../lib/fundsTools';
import { docRow } from '../lib/compareDoc';
import type { FundX } from '../lib/funds';
import { today } from '../lib/visits';
import { CallList, Reviews } from '../components/agent/CallList';  // fox 3.0 phase 2: A4, A5
import { BookSafe } from '../components/agent/BookSafe';  // fox 3.0 phase 2: install, encrypted backup, restore
import { Ico } from '../components/home/glyphs';
import '../styles/agentDesk.css';
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
  const sum = heldSum(f.held);
  return (
    <details className="cl-held">
      <summary>{f.held.length} מוצרים מהמסלקה{covers.length ? ` · ${covers.length} כיסויים ביטוחיים` : ''}{f.held[0]?.asof ? ` · נכון ל-${dmy(f.held[0].asof)}` : ''}</summary>
      <div className="scroll"><table className="fsimple">
        <thead><tr><th>מוצר</th><th>יתרה</th><th>הפקדה חודשית</th><th>ד"נ מצבירה</th><th>ד"נ מהפקדה</th><th>עלות ד"נ לשנה (אומדן)</th></tr></thead>
        <tbody>{f.held.map((h, i) => <tr key={i}><td><b>{h.typeHe}</b><span className="ci-sub">{[h.provider, h.track ?? h.plan].filter(Boolean).join(' · ')}{h.note ? ` · ${h.note}` : ''}</span></td><td><span className="num">{ils(h.balance)}</span></td><td><span className="num">{ils(h.monthly)}</span></td><td title={h.feeHow ?? undefined}><span className="num">{pc(h.fee)}</span></td><td title={h.depHow ?? undefined}><span className="num">{pc(h.depfee)}</span></td><td><span className="num">{ils(heldCost(h).total)}</span></td></tr>)}</tbody>
        <tfoot><tr><th scope="row">סה"כ</th><td><span className="num">{ils(sum.balance)}</span></td><td><span className="num">{sum.monthly ? ils(sum.monthly) : '–'}</span></td><td /><td /><td><span className="num">{sum.total ? ils(sum.total) : '–'}</span></td></tr></tfoot>
      </table></div>
      {covers.length > 0 && <ul className="ci-cov">{covers.map((c, i) => <li key={i}><b>{c.name}</b> ({c.of}){c.sum != null && <> · <span className="num">{ils(c.sum)}</span></>}{c.rate != null && <> · <span className="num">{nf(c.rate, 0)}%</span> מהשכר</>}{c.cost != null && <> · עלות <span className="num">{ils(c.cost)}</span></>}</li>)}</ul>}
      <p className="cl-note">של הלקוח, כפי שהקובץ מהמסלקה מסר אותם; לא נבדק מול הגוף המנהל. עלות דמי הניהול לשנה, אומדן: יתרה × ד"נ מצבירה, ועוד הפקדה חודשית × 12 × ד"נ מהפקדה.</p>
    </details>
  );
}

/** W7 · the ניוד before/after of a folder on /clients: the folder's snapshot rows (or today's rows) against its imported products */
function NyudDetails({ f, data, dfile, coefF }: { f: Folder; data: FundsFile | undefined; dfile: DefaultFile | null | undefined; coefF: CoefFile | null | undefined }) {
  const [basis, setBasis] = useState<Basis>('fox');
  if (!f.held.length || !f.keys.some((k) => f.tags[k] === 'מומלץ' || f.tags[k] === 'נבחן')) return null;
  const rows: SnapRow[] = f.snap?.rows.length ? f.snap.rows : (data ? f.keys.map((k) => data.funds.find((x) => x.k === k)).filter((x): x is FundX => !!x).map((x) => docRow(x, { net: f.b === 'net', asof: data.asof, dfile })) : []);
  if (!rows.length) return null;
  const asof = f.snap?.asof ?? data?.asof ?? 0;
  const out = nyudTable(f.held, rows, f.tags, coefF, { basis }, ym(asof));
  return <details className="cl-nyud"><summary>ניוד: לפני ואחרי ({out.rows.length} זוגות) · {f.snap ? 'על הצילום' : 'על נתוני היום'}</summary><NyudTable out={out} basis={basis} onBasis={setBasis} asofText={ym(asof)} /></details>;
}

export function Clients() {
  const [file, setFile] = useClients();
  const data = useFunds().data as FundsFile | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');  // W7
  const coefF = useOptional<CoefFile>(COEF_PATH);  // W7
  const [brand, setBrand] = useBranding();  // W7
  const nav = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const nameOf = (k: string) => data?.funds.find((f) => f.k === k)?.name ?? k;
  const list = sorted(file);
  const openCmp = (f: Folder) => { writeStored(LAST_FOLDER_KEY, f.id); nav(`/funds/compare?k=${f.keys.join(',')}&b=${f.b}`, { state: { folder: f.id } }); };
  const openDoc = (f: Folder) => { writeStored(LAST_FOLDER_KEY, f.id); nav(`/funds/compare/print?k=${f.keys.join(',')}&b=${f.b}`, { state: { folder: f.id } }); };
  // W5: the folders live in this browser only; the page says when they were last exported (no cloud copy: owner decision pending)
  const [, setLastBackup] = useStored<string>(BACKUP_KEY, '');
  const exportFile = () => {
    const blob = new Blob([exportText(file, today(), hasBrand(brand) ? brand : undefined)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fox-clients-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setLastBackup(today());
  };
  const importFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) { setMsg('הקובץ גדול מדי לתיקי לקוחות'); return; }
    f.text().then((t) => { const x = JSON.parse(t); const r = mergeClients(file, x); setFile(r.file);
      // W7: the branding in the file fills an empty one here (never overwrites what this browser has)
      const b = brandOfFile(x); const gotBrand = b && !hasBrand(brand) && hasBrand(normBranding(b)); if (gotBrand) setBrand(normBranding(b));
      setMsg(`${r.added || r.updated ? `נוספו ${r.added} תיקים, עודכנו ${r.updated}` : 'לא נמצאו בקובץ תיקים חדשים'}${gotBrand ? ' · פרטי בעל הרישיון נקלטו מהקובץ' : ''}`); }).catch(() => setMsg('הקובץ אינו קובץ תיקי לקוחות תקין'));
  };
  return (
    <div className="clients">
      <div className="pagehead"><div>
        <span className="eyebrow">סוכן</span>
        <h1><span className="icotile"><Icon name="inbox" /></span>תיקי לקוחות</h1>
        <div className="sub">השוואות ששמרתם ללקוחות: המסלולים, הסיווג בנספח וטיוטת ההנמקה. נשמר בדפדפן הזה בלבד.</div>
      </div><Link to="/clients/new" className="cmp-doc cl-new"><Ico name="clients" />לקוח חדש: מקובץ מסלקה להנמקה</Link></div>
      <CallList />
      <Reviews />
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
                <NyudDetails f={f} data={data} dfile={dfile} coefF={coefF} />
                <div className="cl-acts">
                  <button type="button" className="cmp-doc" onClick={() => openCmp(f)} disabled={!f.keys.length}><Icon name="compare" />להשוואה</button>
                  <button type="button" className="chip" onClick={() => openDoc(f)} disabled={!f.keys.length && !f.held.length}><Icon name="statement" /> {f.snap ? 'מסמך ללקוח (הצילום)' : 'מסמך ללקוח'}</button>
                  <ShareFolder f={f} />
                  <button type="button" className="chip" onClick={() => { if (confirm(`למחוק את התיק "${f.label}" מהדפדפן הזה?`)) setFile(removeFolder(file, f.id)); }}>מחיקה</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="פרטי בעל הרישיון במסמך ללקוח" aside={<span>כותרת, חתימה ולוגו · בדפדפן בלבד</span>}>
        <BrandPanel />
      </Panel>
      <section className="panel cl-wiz" aria-labelledby="cl-wiz-h">
        <span className="icotile lg"><Ico name="clients" /></span>
        <div><h2 id="cl-wiz-h">ייבוא מהמסלקה ללקוח</h2><p>שלושה צעדים: הקובץ (zip או XML, גם עם סיסמה), ניוד לפני ואחרי עם המקורות, ומסמך הנמקה בנוסח המחייב עם הפרטים שלכם. בדפדפן הזה בלבד.</p></div>
        <Link to="/clients/new" className="cmp-doc">פתיחת האשף</Link>
      </section>
      <BookSafe />
      <Panel title="העברה בין מכשירים" aside={<span>קובץ JSON</span>}>
        <div className="cl-io">
          <button type="button" className="chip" onClick={exportFile} disabled={!list.length}><Icon name="download" /> ייצוא לקובץ לא מוצפן</button>
          <label className="chip cl-imp">ייבוא מקובץ / שחזור<input type="file" accept="application/json,.json" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          {msg && <span role="status" className="muted">{msg}</span>}
        </div>
        <ShareImport />
        <div className="fnote">שום דבר מהתיקים לא נשלח לשרת ולא נכנס לכתובת העמוד. הקובץ כולל את שמות הלקוחות כפי שהקלדתם, את טיוטות ההנמקה ואת פרטי בעל הרישיון: שמרו אותו כמו כל מסמך לקוח. "שיתוף תיק" (בכל תיק) מייצא תיק אחד כקובץ מוצפן בסיסמה, לסוכן אחר או למכשיר אחר. בייבוא, תיק שכבר קיים מתעדכן רק כשהעותק בקובץ חדש יותר.</div>
      </Panel>
      <Reminders door="agent" />
    </div>
  );
}
