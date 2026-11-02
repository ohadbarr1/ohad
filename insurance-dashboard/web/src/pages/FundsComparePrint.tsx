import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { useFunds } from '../lib/useData';
import { useStored } from '../lib/local';
import { useHists, useOptional } from '../lib/fundsLoad';
import type { DefaultFile } from '../lib/fundsTools';
import { nf, sn } from '../lib/format';
import { NET_LABEL, TRAY_MAX, ym, type FundX, type FundsFile, type HistX } from '../lib/funds';
import { ACT_F } from '../lib/pensionPack';
import { RULES_NOTE, rulesOf } from '../lib/productRules';
import { PENSION_MISSING } from '../components/agent/PensionPack';
import { BM_HREF, DECISION_PATH, OLD_FEE_NOTE, OLD_FEE_SRC, OLD_WARN, SELF_REPORT, claimsWhy, companyOf, srcOf, type DecisionFile } from '../lib/decision';  // W2
import { BOTTOM_CAP, bottomLines, dmyIso, docRow, metricsOf, pagesOf, shortUrl, snapDiff, snapOf } from '../lib/compareDoc';
import { ClientSave } from '../components/agent/ClientSave';
import { folderOfState, useClients, type Folder, type Held, type SnapRow } from '../lib/clients';
import { today as todayIso } from '../lib/visits';
import '../styles/agentDoc.css';

/* W1 · agent door: the client document, /funds/compare/print?k=…&b=net|gross. An A4 page set, right to left, unbranded: the tracks
   compared with every figure's source and data month, the bottom line (descriptive), the tax and liquidity rule of each product, a
   disclaimer; then a worksheet for the הנמקה in the order of the regulator's Annex A (חוזר סוכנים ויועצים 2018-10-11), with the data
   the site has filled in and the agent's fields left to type. The client's name and every typed field live in this page only (never
   stored); the agent's name and licence number are kept in this browser (localStorage), never sent anywhere. window.print() makes the
   PDF.
   W4: the table is transposed (metrics down, tracks across, at most four tracks a table) so it fits A4 portrait with 8 tracks; the
   bottom line compares only within a category (lib/compareDoc); an old-generation managers' insurance track opens a warning and is kept
   out of every comparison line; a folder opens on the figures frozen when it was saved ("צילום"), with today's data one click away. */

type Tag = 'קיים' | 'מומלץ' | 'נבחן';
const TAGS: Tag[] = ['קיים', 'מומלץ', 'נבחן'];
const HNM_SRC = { url: 'https://www.chamber.org.il/media/159038/h_2018-10-11-changes.pdf', title: 'חוזר סוכנים ויועצים 2018-10-11 "מסמך הנמקה – תיקון" (18.07.2018; בתוקף מ-01.07.2019), נספח א\'' };
const HNM_DRAFT = { url: 'https://www.gov.il/BlobFolder/dynamiccollectorresultitem/notice_2025_65/he/Draft%20explanatory%20Document%20-%20PDF.pdf', title: 'טיוטת חוזר סוכנים ויועצים 2025-3 (30.11.2025): תוספת סעיף 7א ונספח ה\'1; טרם נכנסה לתוקף' };
const LAW = 'סעיף 14 לחוק הפיקוח על שירותים פיננסיים (ייעוץ, שיווק ומערכת סליקה פנסיוניים), התשס"ה-2005';
const todayHe = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

/** W3: the typed fields of a client folder, by field id; a field with an id (`fk`) is saved by "שמור ללקוח" and refilled on load */
const Draft = createContext<Record<string, string>>({});
/** a field the agent types into: it grows with its text and prints as typed (an empty one prints as a ruled box) */
function Fill({ label, lines = 2, inline = false, value, fk }: { label: string; lines?: number; inline?: boolean; value?: string; fk?: string }) {
  const draft = useContext(Draft);
  return <div className={`fill${inline ? ' in' : ''}`} style={{ minHeight: inline ? undefined : `${lines * 1.6}em` }} contentEditable suppressContentEditableWarning role="textbox" aria-multiline={!inline} aria-label={label} data-ph={label} data-fk={fk}>{(fk && draft[fk]) || value}</div>;
}
/** the typed text of every saved field on the page, over what the folder had (a field not on the page now, e.g. with the annex
 *  hidden, keeps its stored text; a field emptied on the page is dropped) */
const collectFields = (had: Record<string, string> = {}): Record<string, string> => {
  const out = { ...had };
  document.querySelectorAll<HTMLElement>('.adoc [data-fk]').forEach((el) => { const k = el.dataset.fk; if (!k) return; const t = (el.innerText ?? el.textContent ?? '').trim(); if (t) out[k] = t; else delete out[k]; });
  return out;
};

export function FundsComparePrint() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const [sp] = useSearchParams();
  const asked = useMemo(() => (sp.get('k') ?? '').split(',').filter((k) => /^[gip]\d+$/.test(k)), [sp]);
  const keys = useMemo(() => [...new Set(asked)].slice(0, TRAY_MAX), [asked]);
  const dropped = [...new Set(asked)].length - keys.length;
  const netAsked = sp.get('b') !== 'gross';
  const { hist, pending } = useHists(keys);
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dec = useOptional<DecisionFile>(DECISION_PATH);  // W2: the service index and claims columns
  const [client, setClient] = useState('');
  const [agent, setAgent] = useStored<string>('agent:name', '');
  const [lic, setLic] = useStored<string>('agent:lic', '');
  const [annex, setAnnex] = useState(true);
  const [tags, setTags] = useState<Record<string, Tag>>({});
  const tagOf = (k: string): Tag => tags[k] ?? 'נבחן';
  // W3: a client folder opened from /clients or the compare page (its id rides in the router's state, never in the URL)
  const loc = useLocation();
  const [clients] = useClients();
  const [folderId, setFolderId] = useState<string | null>(() => folderOfState(loc.state));
  const folder: Folder | null = folderId ? clients.folders.find((f) => f.id === folderId) ?? null : null;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [gen, setGen] = useState(0);
  // W4: a folder with a snapshot of the same tracks opens on it; "נתוני היום" shows today's figures
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!folder) return;
    setTags(folder.tags); setClient(folder.fields['doc:client'] ?? ''); setDraft(folder.fields); setGen((g) => g + 1);
  }, [folder?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="המסמך" />;
  const fs = keys.map((k) => data.funds.find((f) => f.k === k)).filter((f): f is FundX => !!f);
  const snap = folder?.snap && folder.snap.rows.length && keys.every((k) => folder.snap!.rows.some((r) => r.k === k)) ? folder.snap : null;
  const useSnap = !!snap && !live;
  const net = useSnap ? snap!.b === 'net' : netAsked;
  const asof = useSnap ? snap!.asof : data.asof;
  const liveRows: SnapRow[] = fs.map((f) => docRow(f, { net, asof: data.asof, hist: hist[f.k] as HistX | undefined, dfile, dec }));
  const rows: SnapRow[] = useSnap ? keys.map((k) => snap!.rows.find((r) => r.k === k)!).filter(Boolean) : liveRows;
  if (!rows.length) return <div className="adoc-wrap"><p>אין מסלולים במסמך. <Link to="/funds/compare">חזרה להשוואה</Link></p></div>;

  const anyPen = rows.some((r) => r.pen);
  const olds = rows.filter((r) => r.old);
  const bottom = useSnap ? snap!.bottom : bottomLines(rows, net);
  const rules = rulesOf(rows.map((r) => r.prod));
  const lbl = net ? NET_LABEL : 'ברוטו';
  const metrics = metricsOf(rows);
  const pages = pagesOf(rows, 4);
  const diffs = snap && live ? snap.rows.map((t) => { const n = liveRows.find((r) => r.k === t.k); return n ? { r: n, d: snapDiff(t, n, data.asof) } : null; }).filter((x): x is { r: SnapRow; d: ReturnType<typeof snapDiff> } => !!x && x.d.length > 0) : [];

  // the notes: one per metric group, numbered as the table cites them; plain words, no field names, no %-encoded addresses
  const notes: string[] = [
    `${data.source}, נתוני ${ym(asof)}. תשואות ${net ? 'נטו, אומדן: התשואה החודשית שפורסמה (ברוטו) פחות דמי הניהול מצבירה של אותו חודש ÷ 12, בריבית דריבית' : 'ברוטו (לפני דמי ניהול), כפי שפורסמו'}; 3Y ו-5Y: ממוצע שנתי; LTM: 12 החודשים האחרונים.`,
    `דמי ניהול: הממוצע בפועל שגבה המסלול מכלל עמיתיו, מצבירה ומהפקדה, ${ym(asof)}; דמי הניהול של הלקוח יכולים להיות שונים.${olds.length ? ` ${OLD_FEE_NOTE} (${OLD_FEE_SRC.title}, עמ' ${OLD_FEE_SRC.pg}).` : ''}`,
    'שארפ וסטיית תקן: כפי שהרשות מפרסמת למסלול. מסלול בניהול אישי או בלי תנודתיות: אין שארפ.',
    `ירידה מרבית: מחושבת מ-60 התשואות החודשיות האחרונות (${lbl}), מהשיא לשפל שאחריו.`,
    `חשיפה למניות: כאחוז מנכסי המסלול, כפי שדווח לרשות, ${ym(asof)}.`,
    ...(anyPen ? [`${ACT_F}.`, `קרן ברירת מחדל: ההליך שבתוקף ב-${ym(asof)} לפי הודעות רשות שוק ההון; דמי הניהול בהליך: מהפקדה / מצבירה, לעמית שהצטרף דרכו.`] : []),
    // W2
    ...(anyPen ? [(() => { const g = dec?.segments.pension, s = g ? srcOf(dec, g.src) : null; return `מדד השירות: ${s?.title ?? 'רשות שוק ההון, מדד השירות 2025'}, ${g?.label ?? 'קרנות פנסיה'}, עמ' ${g?.pg ?? '–'}${s ? ` (${shortUrl(s.url)})` : ''}. ציון 0-100 ומקום מתוך החברות במדד, ברמת החברה המנהלת; מודד שירות, לא תשואה.`; })(),
      `תביעות נכות שאושרו: ${SELF_REPORT}, נספח ב3 לחוזר איסוף מידע סטטיסטי ${dec?.fund_claims?.year ?? 2025}; שולמו ושולמו חלקית, באחוזים מהתביעות שנסגרו בשנה, כל קרנות הפנסיה של החברה יחד; לא נבדק על ידי הרשות.${[...new Set(rows.filter((r) => r.pen).map((r) => r.grp))].map((g) => { const c = companyOf(dec, g)?.claims, s = c ? srcOf(dec, c.src) : null; return c ? ` ${g}: ${s ? `${s.title} (${shortUrl(s.url)})` : ''}${c.pg != null ? `, עמ' ${c.pg}` : c.sheet ? `, גיליון "${c.sheet}"` : ''}.` : dec ? ` ${g}: ${claimsWhy(dec, g)}.` : ''; }).join('')}`] : []),
  ];
  const N = (i: number) => <sup className="fn">{i}</sup>;
  const docFor = (r: SnapRow) => ({ ...r });

  return (
    <div className="adoc-wrap">
      <div className="adoc-tools" role="region" aria-label="הגדרות המסמך">
        <Link to={`/funds/compare?k=${keys.join(',')}`} state={folder ? { folder: folder.id } : undefined} className="chip"><span aria-hidden="true">→</span> חזרה להשוואה</Link>
        <label>שם הלקוח <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="לא חובה" maxLength={60} /></label>
        <label>שם הסוכן/היועץ <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="לא חובה" maxLength={60} /></label>
        <label>מס' רישיון <input value={lic} onChange={(e) => setLic(e.target.value)} placeholder="לא חובה" maxLength={20} inputMode="numeric" /></label>
        <label className="chk"><input type="checkbox" checked={annex} onChange={(e) => setAnnex(e.target.checked)} /> נספח הנמקה</label>
        <button type="button" className="cmp-doc" onClick={() => window.print()}><Icon name="download" />הדפסה / PDF</button>
        <ClientSave keys={rows.map((r) => r.k)} b={net ? 'net' : 'gross'} folder={folder} onSaved={(f) => { setFolderId(f.id); setLive(false); }} suggest={client} busy={!useSnap && pending > 0}
          collect={() => ({ tags: Object.fromEntries(rows.map((r) => [r.k, tagOf(r.k)])),
            // the figures shown are frozen with the folder: today's when today's are on the page, else the snapshot already there
            ...(useSnap ? {} : { snap: snapOf(rows, bottom, todayIso(), data.asof, net ? 'net' : 'gross') }),
            fields: (() => { const x = collectFields(folder?.fields); if (client.trim()) x['doc:client'] = client.trim(); else delete x['doc:client']; return x; })() })} />
        {snap && <div className="adoc-snap" role="group" aria-label="צילום הנתונים">
          <span><b>{useSnap ? 'מוצג הצילום' : 'מוצגים נתוני היום'}</b> · התיק נשמר עם צילום מ-{dmyIso(snap.at)}, נתונים עד {ym(snap.asof)}</span>
          <button type="button" className="chip" aria-pressed={live} onClick={() => setLive(!live)}>{live ? 'חזרה לצילום' : `השוואה לנתוני היום (${ym(data.asof)})`}</button>
        </div>}
        {folder && !snap && folder.keys.length > 0 && <p className="adoc-priv">התיק נשמר בגרסה קודמת, בלי צילום של הנתונים שהוצגו: מוצגים נתוני היום. שמירה עכשיו תשמור גם צילום.</p>}
        {dropped > 0 && <p className="adoc-priv adoc-warn" role="status">עד {TRAY_MAX} מסלולים במסמך; {dropped === 1 ? 'מסלול אחד הושמט' : `${dropped} מסלולים הושמטו`} (האחרונים בכתובת).</p>}
        <p className="adoc-priv">שם הלקוח והשדות שתקלידו נשארים בעמוד הזה ולא נשמרים, אלא אם לוחצים "שמור ללקוח": אז הם נשמרים בדפדפן הזה בלבד (בלי תעודת זהות), עד שתמחקו אותם ב<Link to="/clients">תיקי לקוחות</Link>. שם הסוכן ומספר הרישיון נשמרים בדפדפן הזה בלבד. המסמך יוצא בלי שם האתר. {!useSnap && pending > 0 ? `טוען היסטוריה ל-${pending} מסלולים…` : ''}</p>
        {annex && <div className="adoc-tags" role="group" aria-label="סיווג המסלולים בנספח">{rows.map((r) => <label key={r.k}><span>{r.name}</span><select value={tagOf(r.k)} onChange={(e) => setTags({ ...tags, [r.k]: e.target.value as Tag })} aria-label={`סיווג: ${r.name}`}>{TAGS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>)}</div>}
        {diffs.length > 0 && <div className="adoc-diff" aria-label="מה השתנה מאז הצילום"><b>מה השתנה מאז הצילום ({dmyIso(snap!.at)}, נתונים עד {ym(snap!.asof)}):</b><ul>{diffs.map(({ r, d }) => <li key={r.k}><b>{r.name}</b>: {d.map((x) => <span key={x.label}>{x.label} <bdi dir="ltr">{x.then}</bdi> ← <bdi dir="ltr">{x.now}</bdi></span>)}</li>)}</ul></div>}
        {snap && live && !diffs.length && <p className="adoc-priv">אין שינוי בנתוני המסמך מאז הצילום.</p>}
      </div>

      <Draft.Provider value={draft}>
      <article className="adoc" dir="rtl" lang="he" key={gen}>
        <header className="adoc-h">
          <div><h1>השוואת מסלולי חיסכון</h1>
            <p className="adoc-sub">{rows.length} מסלולים · נתוני {ym(asof)} · תשואות {lbl} · {useSnap ? <>צילום מ-{dmyIso(snap!.at)}, נתונים עד {ym(snap!.asof)}</> : <>הופק {todayHe()}</>}</p></div>
          <dl className="adoc-meta">
            {client.trim() && <><dt>עבור</dt><dd>{client.trim()}</dd></>}
            {agent.trim() && <><dt>הוכן על ידי</dt><dd>{agent.trim()}{lic.trim() ? `, רישיון ${lic.trim()}` : ''}</dd></>}
          </dl>
        </header>

        {olds.length > 0 && <section className="adoc-old" role="note">
          <h2>לפני השוואה: ביטוח מנהלים מדור ישן</h2>
          <p>{OLD_WARN}. המסלולים: <b>{olds.map((r) => r.name).join(' · ')}</b>.</p>
          <p>דמי הניהול במסלולים האלה משתנים משנה לשנה (השתתפות ברווחים, הערה 2), ולכן אינם מחיר קבוע להשוואה.</p>
          <p className="adoc-cap">רשימת בדיקה לפני מעבר (מקדם מובטח, הסדר ריסק, חיתום, ותק, כספים הוניים): <Link to={BM_HREF}>ביטוחי מנהלים ישנים</Link>, לפי כל זכות (נכתב בסיוע רשות שוק ההון). מקדמי הקצבה של פוליסה מסוימת אינם פומביים: יש לקבל אותם מחברת הביטוח.</p>
        </section>}

        <section>
          <h2>המסלולים</h2>
          {pages.map((pg, pi) => (
            <table className="adoc-t tx" key={pi} aria-label={`המסלולים ${pi + 1} מתוך ${pages.length}`}>
              <colgroup><col className="m" />{pg.map((r) => <col key={r.k} />)}</colgroup>
              <thead><tr><th scope="col">{pages.length > 1 ? `חלק ${pi + 1} מתוך ${pages.length}` : 'מדד'}</th>{pg.map((r) => <th key={r.k} scope="col"><b>{r.name}</b><span>{r.prod} · {r.track}{r.id != null ? ` · מס' ${r.id}` : ''}</span>{r.old && <span className="old">דור ישן: ראו האזהרה</span>}</th>)}</tr></thead>
              <tbody>{metrics.map((m) => <tr key={m.key}><th scope="row">{m.label}{N(m.fn)}</th>{pg.map((r) => { const c = m.cell(r, asof); return <td key={r.k}>{c.t}{c.q && <span className="q">{c.q}</span>}</td>; })}</tr>)}</tbody>
            </table>
          ))}
          <p className="adoc-cap">3Y ו-5Y: תשואה שנתית ממוצעת. {net ? 'נטו: אומדן אחרי דמי ניהול מצבירה בלבד; דמי ניהול מהפקדה פועלים על ההפקדות ואינם נכללים.' : 'ברוטו: לפני דמי ניהול.'} "–": אין נתון.</p>
        </section>

        <section>
          <h2>בשורה התחתונה</h2>
          <ul className="adoc-bl">{bottom.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <p className="adoc-cap">{BOTTOM_CAP}</p>
        </section>

        {rules.length > 0 && <section>
          <h2>מיסוי ונזילות</h2>
          <table className="adoc-t rules">
            <thead><tr><th>מוצר</th><th>נזילות</th><th>מיסוי</th><th>מקור</th></tr></thead>
            <tbody>{rules.map((r) => <tr key={r.key}><th scope="row"><b>{r.name}</b></th><td>{r.liq}</td><td>{r.tax}{r.watch ? <span className="q">{r.watch}</span> : null}</td><td className="src">{r.src.filter((s) => s.kind !== 'press').slice(0, 2).map((s) => <span key={s.url}>{s.title}</span>)}</td></tr>)}</tbody>
          </table>
          <p className="adoc-cap">{RULES_NOTE}. נבדק מול המקורות ב-01.11.2026; סכומים לשנת המס 2026.</p>
        </section>}

        <section className="adoc-notes">
          <h2>מקורות והערות</h2>
          <ol style={{ overflowWrap: 'anywhere', gridTemplateColumns: 'minmax(0, 1fr)' }}>{notes.map((n, i) => <li key={i}>{n}</li>)}</ol>
          {anyPen && <p>{PENSION_MISSING}.</p>}
          <p className="disc">המסמך מציג נתונים שפרסמה רשות שוק ההון, ביטוח וחיסכון, כפי שהם, ותיאור עובדתי שלהם. אין בו ייעוץ השקעות, ייעוץ פנסיוני, שיווק פנסיוני או ייעוץ מס, ואין בו התחשבות בנתונים ובצרכים של לקוח מסוים. תשואות העבר אינן מבטיחות תשואות בעתיד. דמי הניהול המוצגים הם ממוצע בפועל של המסלול. לפני החלטה יש לבדוק את תנאי המוצר מול הגוף המנהל ואת המידע האישי במסלקה הפנסיונית.</p>
        </section>

        {annex && <Annex rows={rows.map(docFor)} tagOf={tagOf} client={client.trim()} agent={agent.trim()} lic={lic.trim()} asof={asof} held={folder?.held ?? []} />}
      </article>
      </Draft.Provider>
    </div>
  );
}

/** The הנמקה worksheet: Annex A's parts and fields, in its order, with what the site knows filled in. Part A.1 holds the products the
 *  circular lists there, the existing ones and the recommended ones; a track tagged "נבחן" (looked at, not recommended) is listed after
 *  the annex's parts, for the agent's file. */
function Annex({ rows, tagOf, client, agent, lic, asof, held }: { rows: SnapRow[]; tagOf: (k: string) => Tag; client: string; agent: string; lic: string; asof: number; held: Held[] }) {
  // W4: a folder imported from the clearing house fills the client's own fees (A.1) and the existing cover (A.2), editable
  const own = (k: string) => held.find((h) => h.k === k);
  const pcv = (v: number | null | undefined) => (v == null ? undefined : `${nf(v, 2)}%`);
  const ilsv = (v: number | null | undefined) => (v == null ? undefined : `₪${Math.round(v).toLocaleString('en-US')}`);
  const covers = held.flatMap((h) => h.covers.map((c) => ({ c, h })));
  const a2 = Math.max(3, covers.length);
  const exist = rows.filter((r) => tagOf(r.k) === 'קיים'), next = rows.filter((r) => tagOf(r.k) === 'מומלץ'), seen = rows.filter((r) => tagOf(r.k) === 'נבחן');
  const order = [...exist, ...next];
  /** A.1, one block per product (existing first): Annex A's ten fields in its order, two to a line so the page stays portrait */
  const row = (f: SnapRow): ReactNode => (
    <div className="a1" key={f.k}>
      <div className="a1-h"><b>{tagOf(f.k)}</b> · {f.name}</div>
      <dl className="a1-g">
        <div><dt>המלצה</dt><dd><Fill label={`המלצה: ${f.name}`} inline fk={`a1:${f.k}:rec`} /></dd></div>
        <div><dt>שם המוצר הפנסיוני ומספרו</dt><dd>{f.prod} · {f.mgr}{f.id != null && <span className="q">מס' {f.id}</span>}</dd></div>
        <div><dt>השם המסחרי של מסלול ההשקעה ומספרו</dt><dd>{f.name}{f.id != null && <span className="q">מס' {f.id}</span>}</dd></div>
        <div><dt>הבטחת תשואה</dt><dd><Fill label="הבטחת תשואה" inline fk={`a1:${f.k}:guar`} />{f.old && <span className="q">דור ישן: לבדוק בפוליסה</span>}</dd></div>
        <div><dt>תשואה ברוטו</dt><dd><bdi dir="ltr">{f.a3g == null ? '–' : `${sn(f.a3g, 2)}%`}</bdi><span className="q">ממוצע שנתי, 36 חודשים (הרשות, {ym(asof)})</span></dd></div>
        <div><dt>דמי ניהול מהפקדות</dt><dd><Fill label="דמי ניהול מהפקדות ללקוח" inline fk={`a1:${f.k}:dep`} value={tagOf(f.k) === 'קיים' ? pcv(own(f.k)?.depfee) : undefined} /><span className="q">ממוצע בפועל במסלול: <bdi dir="ltr">{f.depfee == null ? '–' : `${nf(f.depfee, 2)}%`}</bdi></span></dd></div>
        <div><dt>דמי ניהול מחיסכון מצטבר</dt><dd><Fill label="דמי ניהול מחיסכון מצטבר ללקוח" inline fk={`a1:${f.k}:acc`} value={tagOf(f.k) === 'קיים' ? pcv(own(f.k)?.fee) : undefined} /><span className="q">{f.old ? 'משתנים (השתתפות ברווחים); ' : ''}ממוצע בפועל במסלול: <bdi dir="ltr">{f.fee == null ? '–' : `${nf(f.fee, 2)}%`}</bdi></span></dd></div>
        <div><dt>רמת הסיכון של מסלול ההשקעה</dt><dd><Fill label="רמת הסיכון של המסלול" inline fk={`a1:${f.k}:risk`} /><span className="q">חשיפה למניות: <bdi dir="ltr">{f.st == null ? '–' : `${nf(f.st, 0)}%`}</bdi></span></dd></div>
        <div><dt>סכום צפוי (יתרת חיסכון ואומדן קצבה)</dt><dd><Fill label="סכום צפוי" inline fk={`a1:${f.k}:exp`} /></dd></div>
        <div><dt>השיקולים העיקריים</dt><dd><Fill label={`השיקולים העיקריים: ${f.name}`} inline fk={`a1:${f.k}:why`} /></dd></div>
      </dl>
    </div>
  );
  return (
    <section className="annex">
      <header className="annex-h">
        <h2>נספח: טיוטת עבודה למסמך ההנמקה</h2>
        <p>לפי המבנה של נספח א' ל{HNM_SRC.title}, מכוח {LAW}. החוזר קובע נוסח וסדר מחייבים ואוסר לשנותם; זהו דף עבודה לאיסוף הנתונים בפגישה, ומסמך ההנמקה עצמו יופק בנוסח המחייב. הנתונים שמולאו: רשות שוק ההון, {ym(asof)}.</p>
        <dl className="adoc-meta">
          <dt>תאריך מתן ההמלצה</dt><dd><Fill label="תאריך מתן ההמלצה" inline value={todayHe()} fk="m:date" /></dd>
          <dt>שם הלקוח</dt><dd><Fill label="שם הלקוח" inline value={client || undefined} /></dd>
          <dt>ת"ז</dt><dd><Fill label="תעודת זהות" inline /></dd>
        </dl>
      </header>

      <h3>חלק א – ההמלצה</h3>
      <h4>א.1 הרכב החיסכון הפנסיוני המומלץ עבורך</h4>
      {order.length ? <div className="a1s">{order.map(row)}</div> : <p className="adoc-cap">אין מסלול שסומן "קיים" או "מומלץ". הסיווג נקבע בסרגל שמעל המסמך.</p>}
      <p className="adoc-cap">בחלק הזה, לפי החוזר: המוצרים הקיימים, ואחריהם המוצרים המומלצים. מוצר שמשתנה: שורה לפני ושורה אחרי, ו"לא שונה" בשדה שלא השתנה. דמי ניהול: יש להקליד את דמי הניהול של הלקוח; הממוצע בפועל במסלול מוצג להשוואה בלבד.</p>
      <h4>א.2 הכיסויים הביטוחיים המומלצים עבורך</h4>
      <table className="adoc-t annex-t">
        <thead><tr><th>המלצה</th><th>שם המוצר</th><th>סוג הכיסוי הביטוחי / מסלול הביטוח</th><th>סכום הכיסוי הביטוחי</th><th>עלות חודשית</th><th>כיסוי כלול במוצר פנסיוני קיים</th><th>השיקולים העיקריים</th></tr></thead>
        <tbody>{Array.from({ length: a2 }, (_, i) => { const x = covers[i]; const pre = x ? [undefined, `${x.h.typeHe}${x.h.provider ? ` · ${x.h.provider}` : ''}`, x.c.kind ?? x.c.name, x.c.rate != null ? `${nf(x.c.rate, 0)}% מהשכר${x.c.sum != null ? ` · ${ilsv(x.c.sum)}` : ''}` : ilsv(x.c.sum), ilsv(x.c.cost), 'כן (מצב קיים)', undefined] : [];
          return <tr key={i}>{Array.from({ length: 7 }, (_, j) => <td key={j}><Fill label={`כיסוי ${i + 1}, שדה ${j + 1}`} inline fk={`a2:${i}:${j}`} value={pre[j]} /></td>)}</tr>; })}</tbody>
      </table>
      <p className="adoc-cap">{covers.length ? 'הכיסויים הקיימים מולאו מקובץ המסלקה של הלקוח (בתיק); לבדוק מול הגוף המנהל. ' : ''}נתוני הכיסויים הביטוחיים אינם במאגרים הפתוחים של הרשות: יש למלא מהמסלקה ומהגוף המנהל (ייבוא קובץ מסלקה לתיק לקוח: בתיקי הלקוחות).</p>
      <h4>נימוקי ההמלצה</h4>
      <div className="annex-grid">
        <label><span>התאמת המוצר ללקוח, יתרונותיו וחסרונותיו</span><Fill label="התאמת המוצר ללקוח" lines={3} fk="r:fit" /></label>
        <label><span>בחירת הגוף המנהל: יישוב תביעות, שירות, תפעול</span><Fill label="בחירת הגוף המנהל" lines={3} fk="r:mgr" /></label>
        <label><span>שינויים בחיתום בהחלפת כיסוי ביטוחי</span><Fill label="שינויים בחיתום" lines={2} fk="r:uw" /></label>
        <label><span>השלכות משיכת כספים</span><Fill label="השלכות משיכה" lines={2} fk="r:wd" /></label>
        <label className="wide"><span>בהעברת כספים (ניוד): יתרונות וחסרונות של המוצר החדש לעומת הקיים</span><Fill label="ניוד: יתרונות וחסרונות" lines={3} fk="r:port" /></label>
      </div>
      <div className="annex-q">
        <span>בניוד, לסמן רק כשהתשובה "כן", ולפרט:</span>
        {['מקדם קצבה מובטח לתוחלת חיים', 'מקדם קצבה עם הבטחת תשואה', 'מוצר שהקצבה ממנו אינה מושפעת מתוחלת החיים', 'מוצר שהקצבה ממנו אינה מושפעת מהתשואה', 'קרן ותיקה שבהסדר'].map((q) => <label key={q}><input type="checkbox" aria-label={q} /> {q}</label>)}
      </div>
      <h4>סך עלות דמי הניהול והביטוח</h4>
      <table className="adoc-t annex-t small"><thead><tr><th /><th>מצב קיים</th><th>מצב מומלץ</th></tr></thead>
        <tbody><tr><th scope="row">סך עלות דמי ניהול</th><td><Fill label="סך דמי ניהול, קיים" inline fk="t:fee0" /></td><td><Fill label="סך דמי ניהול, מומלץ" inline fk="t:fee1" /></td></tr>
          <tr><th scope="row">סך עלות ביטוח</th><td><Fill label="סך עלות ביטוח, קיים" inline fk="t:ins0" /></td><td><Fill label="סך עלות ביטוח, מומלץ" inline fk="t:ins1" /></td></tr></tbody></table>
      <p className="adoc-cap">לפי נספח ב' לחוזר (אופן החישוב).</p>

      <h3>חלק ב – המאפיינים שלך לפיהם נקבעו ההמלצות</h3>
      <div className="annex-grid">
        {['גיל', 'מצב משפחתי', 'מצב תעסוקתי', 'הכנסות קבועות נוספות בפרישה', 'מידת הסיכון המועדפת', 'מטרות החיסכון', 'מטרות הביטוח'].map((x, i) => <label key={x}><span>{x}</span><Fill label={x} lines={1} fk={`b:${i}`} /></label>)}
      </div>
      <div className="annex-sig">
        <span>הצהרת בעל הרישיון על שמירת סודיות</span><span>הצהרת הלקוח על מידע שלא נמסר</span><span>הצהרת בעל הרישיון לעניין המידע שלא נמסר</span>
      </div>

      <h3>חלק ג – הכר את הסוכן/יועץ/משווק</h3>
      <dl className="adoc-meta grid">
        <dt>שם מלא</dt><dd><Fill label="שם בעל הרישיון" inline value={agent || undefined} /></dd>
        <dt>מספר רישיון</dt><dd><Fill label="מספר רישיון" inline value={lic || undefined} /></dd>
        <dt>טלפון</dt><dd><Fill label="טלפון" inline fk="c:tel" /></dd><dt>כתובת</dt><dd><Fill label="כתובת" inline fk="c:addr" /></dd><dt>דוא"ל</dt><dd><Fill label="דואר אלקטרוני" inline fk="c:mail" /></dd>
        <dt>פועל באמצעות חברה (שם, ח.פ.)</dt><dd><Fill label="שם החברה ומספרה" inline fk="c:co" /></dd>
      </dl>
      <label className="annex-wide"><span>גילוי נאות: עמלות (סוכן: עד שלושה גופים מוסדיים לכל סוג מוצר לפי חלקם בעמלות; יועץ: עמלת הפצה או שכר טרחה), תמריצים, ומוצרים לא פנסיוניים שנמכרו בפגישה</span><Fill label="גילוי נאות" lines={3} fk="c:disc" /></label>

      <h3>חלק ד – טבלת סיכום</h3>
      <div className="annex-grid">
        <div><h4>מצב קיים</h4><ul className="annex-list">{exist.length ? exist.map((f) => <li key={f.k}>{f.prod} · {f.name}{f.id != null ? ` · מס' ${f.id}` : ''}</li>) : <li><Fill label="מצב קיים" inline /></li>}</ul></div>
        <div><h4>מצב חדש</h4><ul className="annex-list">{next.length ? next.map((f) => <li key={f.k}>{f.prod} · {f.name}{f.id != null ? ` · מס' ${f.id}` : ''}</li>) : <li><Fill label="מצב חדש" inline /></li>}</ul></div>
      </div>

      <h3>חלק ה – הצהרת הלקוח</h3>
      <p>הלקוח מאשר כי קיבל לידיו את מסמך ההנמקה.</p>
      <div className="annex-sig"><span>תאריך</span><span>חתימת הלקוח</span><span>חתימת בעל הרישיון</span></div>

      {seen.length > 0 && <>
        <h3>לתיק הסוכן: מסלולים שנבחנו ולא הומלצו</h3>
        <p className="adoc-cap">אינם חלק מנספח א'. נשמרים כאן כתיעוד של החלופות שנבדקו בפגישה, עם הנתונים שבטבלה למעלה.</p>
        <ul className="annex-list">{seen.map((f) => <li key={f.k}>{f.prod} · {f.name}{f.id != null ? ` · מס' ${f.id}` : ''}</li>)}</ul>
      </>}
      <p className="adoc-cap">מקור המבנה: {HNM_SRC.title} ({shortUrl(HNM_SRC.url)}). עדכון בתהליך: {HNM_DRAFT.title} ({shortUrl(HNM_DRAFT.url)}). מסירה: בסיום הפגישה, ובחתימה ידנית עותק מודפס בתוך 14 ימי עסקים; שמירה 7 שנים לפחות (סעיפים 3, 6 ו-7 לחוזר). לפני מסמך מלא: שאילתה במסלקה הפנסיונית.</p>
    </section>
  );
}
