import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { useFunds } from '../lib/useData';
import { useHists, useOptional } from '../lib/fundsLoad';
import type { DefaultFile } from '../lib/fundsTools';
import { nf, sn } from '../lib/format';
import { TRAY_MAX, ym, type FundX, type FundsFile, type HistX } from '../lib/funds';
import { ACT_F } from '../lib/pensionPack';
import { RULES_NOTE, rulesOf } from '../lib/productRules';
import { PENSION_MISSING } from '../components/agent/PensionPack';
import { BM_HREF, DECISION_PATH, OLD_FEE_NOTE, OLD_FEE_SRC, OLD_WARN, SELF_REPORT, claimsWhy, companyOf, srcOf, type DecisionFile } from '../lib/decision';  // W2
import { BOTTOM_CAP, bottomLines, dmyIso, docRow, metricsOf, pagesOf, shortUrl, snapDiff, snapOf } from '../lib/compareDoc';
import { ClientSave } from '../components/agent/ClientSave';
import { coverOnly, folderOfState, heldCost, heldForDoc, heldOne, heldSum, useClients, type Folder, type Held, type SnapRow } from '../lib/clients';
import { today as todayIso } from '../lib/visits';
import { COEF_PATH, birthYearOf, coefFor, type CoefFile } from '../lib/coef';  // W6
import { AGE_DEFAULT, BALANCE_EX, GROWTH_DEFAULT, INFL_DEFAULT, RETIRE_AGE, RET_FALLBACK, exampleMonthly, project } from '../lib/retire';
import { brandLine, hasBrand, useBranding } from '../lib/branding';  // W7
import { nyudTable, type Basis } from '../lib/nyud';  // W7
import { NyudTable } from '../components/agent/NyudTable';  // W7
import { track } from '../lib/track';
import * as H from '../lib/hanmaka';  // W7: the binding wording
import '../styles/agentDoc.css';

/* W1 · agent door: the client document, /funds/compare/print?k=…&b=net|gross. An A4 page set, right to left: the tracks compared with
   every figure's source and data month, the bottom line (descriptive), the tax and liquidity rule of each product, a disclaimer; then
   the הנמקה. The client's name and every typed field live in this page only (never stored) unless "שמור ללקוח"; the agent's branding
   (lib/branding) is kept in this browser (localStorage), never sent anywhere. window.print() makes the PDF.
   W4: the table is transposed (metrics down, tracks across, at most four tracks a table); the bottom line compares only within a
   category; an old-generation managers' insurance track opens a warning; a folder opens on the figures frozen when it was saved.
   W6: pension tracks get a table of monthly annuity on one uniform projection ÷ each fund's own coefficient; one methodology line
   (EST_LINE) replaces the "אומדן" badges.
   W7: the הנמקה is in the circular's binding wording (lib/hanmaka: every quoted sentence verbatim with its section, every paraphrase
   marked), the ניוד before/after table (lib/nyud) sits in the document, "מסמך ב'" (the pre-enrolment disclosure of the chosen product)
   follows, the header and the signature block carry the agent's branding, and the footer carries the document version, the date, the
   licence line and the sections followed. */
/** the one line that replaces the "אומדן" badges: what in this document is computed by the site and what is as published */
const EST_LINE = 'אומדנים: תשואה נטו (ברוטו פחות דמי ניהול מצבירה ÷ 12), ירידה מרבית, עלות דמי הניהול לשנה, החיסכון הצפוי בטבלת הניוד וקצבה חודשית הם חישובים של האתר על ההנחות שבהערות ובטבלאות; כל שאר הנתונים כפי שפרסמה הרשות או הגוף המנהל.';
/** W7: the document's version (changes when the structure or the wording changes) */
export const DOC_VERSION = '2026.11 (W7)';

type Tag = 'קיים' | 'מומלץ' | 'נבחן';
const TAGS: Tag[] = ['קיים', 'מומלץ', 'נבחן'];
const todayHe = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

/** W3: the typed fields of a client folder, by field id; a field with an id (`fk`) is saved by "שמור ללקוח" and refilled on load */
const Draft = createContext<Record<string, string>>({});
/** a field the agent types into: it grows with its text and prints as typed (an empty one prints as a ruled box) */
function Fill({ label, lines = 2, inline = false, value, fk }: { label: string; lines?: number; inline?: boolean; value?: string; fk?: string }) {
  const draft = useContext(Draft);
  return <div className={`fill${inline ? ' in' : ''}`} style={{ minHeight: inline ? undefined : `${lines * 1.6}em` }} contentEditable suppressContentEditableWarning role="textbox" aria-multiline={!inline} aria-label={label} data-ph={label} data-fk={fk}>{(fk && draft[fk]) || value}</div>;
}
/** the typed text of every saved field on the page, over what the folder had */
const collectFields = (had: Record<string, string> = {}): Record<string, string> => {
  const out = { ...had };
  document.querySelectorAll<HTMLElement>('.adoc [data-fk]').forEach((el) => { const k = el.dataset.fk; if (!k) return; const t = (el.innerText ?? el.textContent ?? '').trim(); if (t) out[k] = t; else delete out[k]; });
  return out;
};
/** W7: a verbatim line of the circular, its section in small type; a paraphrase is marked "בניסוח האתר" */
function Q({ l, as = 'p', className }: { l: H.Line; as?: 'p' | 'span' | 'h3' | 'h4' | 'li'; className?: string }) {
  const Tag = as as keyof JSX.IntrinsicElements;
  return <Tag className={className ?? (as === 'p' ? 'hnm-q' : undefined)}>{l.text}<span className="hnm-sec" title={l.kind === 'q' ? `ציטוט, ${l.sec}` : `בניסוח האתר, לפי ${l.sec}`}>{l.kind === 'q' ? '' : 'בניסוח האתר · '}{l.sec}</span></Tag>;
}

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
  const coefF = useOptional<CoefFile>(COEF_PATH);  // W6
  const [client, setClient] = useState('');
  const [brand] = useBranding();  // W7
  const [annex, setAnnex] = useState(true);
  const [docB, setDocB] = useState(true);  // W7
  const [kind, setKind] = useState<H.DocKind>('full');  // W7: §4
  const [basis, setBasis] = useState<Basis>('fox');  // W7
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
    if (folder.fields['doc:kind'] === 'focused' || folder.fields['doc:kind'] === 'summary') setKind(folder.fields['doc:kind']);
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
  const held = folder?.held ?? [];
  // W5: a folder of imported products alone (none matched a published track) still makes a document: the current state and the annex
  if (!rows.length && !held.length) return <div className="adoc-wrap"><p>אין מסלולים במסמך. <Link to="/funds/compare">חזרה להשוואה</Link></p></div>;

  const anyPen = rows.some((r) => r.pen);
  const olds = rows.filter((r) => r.old);
  const bottom = useSnap ? snap!.bottom : bottomLines(rows, net);
  const rules = rulesOf(rows.map((r) => r.prod));
  const lbl = net ? 'נטו' : 'ברוטו';
  const metrics = metricsOf(rows);
  const pages = pagesOf(rows, 4);
  const diffs = snap && live ? snap.rows.map((t) => { const n = liveRows.find((r) => r.k === t.k); return n ? { r: n, d: snapDiff(t, n, data.asof) } : null; }).filter((x): x is { r: SnapRow; d: ReturnType<typeof snapDiff> } => !!x && x.d.length > 0) : [];
  // W7: the ניוד table of the folder's imported products against the candidate tracks
  const tagMap = Object.fromEntries(rows.map((r) => [r.k, tagOf(r.k)]));
  const ny = held.length ? nyudTable(held, rows, tagMap, coefF, { basis }, ym(asof)) : null;
  const next = rows.filter((r) => tagOf(r.k) === 'מומלץ');
  const brandTxt = hasBrand(brand) ? brandLine(brand) : '';
  const kindOf = H.DOC_KINDS.find((d) => d.k === kind)!;

  // the notes: one per metric group, numbered as the table cites them; plain words, no field names, no %-encoded addresses
  const notes: string[] = [
    `${data.source}, נתוני ${ym(asof)}. תשואות ${net ? 'נטו: התשואה החודשית שפורסמה (ברוטו) פחות דמי הניהול מצבירה של אותו חודש ÷ 12, בריבית דריבית' : 'ברוטו (לפני דמי ניהול), כפי שפורסמו'}; 3Y ו-5Y: ממוצע שנתי; LTM: 12 החודשים האחרונים.`,
    `דמי ניהול: הממוצע בפועל שגבה המסלול מכלל עמיתיו, מצבירה ומהפקדה, ${ym(asof)}; דמי הניהול של הלקוח יכולים להיות שונים.${olds.length ? ` ${OLD_FEE_NOTE} (${OLD_FEE_SRC.title}, עמ' ${OLD_FEE_SRC.pg}).` : ''}`,
    'שארפ וסטיית תקן: כפי שהרשות מפרסמת למסלול. מסלול בניהול אישי או בלי תנודתיות: אין שארפ.',
    `ירידה מרבית: מחושבת מ-60 התשואות החודשיות האחרונות (${lbl}), מהשיא לשפל שאחריו.`,
    `חשיפה למניות: כאחוז מנכסי המסלול, כפי שדווח לרשות, ${ym(asof)}.`,
    ...(anyPen ? [`${ACT_F}.`, `קרן ברירת מחדל: ההליך שבתוקף ב-${ym(asof)} לפי הודעות רשות שוק ההון; דמי הניהול בהליך: מהפקדה / מצבירה, לעמית שהצטרף דרכו.`] : []),
    ...(anyPen ? [(() => { const g = dec?.segments.pension, s = g ? srcOf(dec, g.src) : null; return `מדד השירות: ${s?.title ?? 'רשות שוק ההון, מדד השירות 2025'}, ${g?.label ?? 'קרנות פנסיה'}, עמ' ${g?.pg ?? '–'}${s ? ` (${shortUrl(s.url)})` : ''}. ציון 0-100 ומקום מתוך החברות במדד, ברמת החברה המנהלת; מודד שירות, לא תשואה.`; })(),
      `תביעות נכות שאושרו: ${SELF_REPORT}, נספח ב3 לחוזר איסוף מידע סטטיסטי ${dec?.fund_claims?.year ?? 2025}; שולמו ושולמו חלקית, באחוזים מהתביעות שנסגרו בשנה, כל קרנות הפנסיה של החברה יחד; לא נבדק על ידי הרשות.${[...new Set(rows.filter((r) => r.pen).map((r) => r.grp))].map((g) => { const c = companyOf(dec, g)?.claims, s = c ? srcOf(dec, c.src) : null; return c ? ` ${g}: ${s ? `${s.title} (${shortUrl(s.url)})` : ''}${c.pg != null ? `, עמ' ${c.pg}` : c.sheet ? `, גיליון "${c.sheet}"` : ''}.` : dec ? ` ${g}: ${claimsWhy(dec, g)}.` : ''; }).join('')}`] : []),
  ];
  const N = (i: number) => <sup className="fn">{i}</sup>;

  return (
    <div className="adoc-wrap">
      <div className="adoc-tools" role="region" aria-label="הגדרות המסמך">
        <Link to={`/funds/compare?k=${keys.join(',')}`} state={folder ? { folder: folder.id } : undefined} className="chip"><span aria-hidden="true">→</span> חזרה להשוואה</Link>
        <label>שם הלקוח <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="לא חובה" maxLength={60} /></label>
        <span className="adoc-priv" style={{ flexBasis: 'auto' }}>בעל הרישיון: {brandTxt || 'לא הוגדר'} · <Link to="/clients">עריכה בתיקי לקוחות</Link></span>
        <label className="chk"><input type="checkbox" checked={annex} onChange={(e) => setAnnex(e.target.checked)} /> מסמך הנמקה</label>
        <label className="chk"><input type="checkbox" checked={docB} onChange={(e) => setDocB(e.target.checked)} /> מסמך ב'</label>
        <button type="button" className="cmp-doc" onClick={() => { if (annex) track('hanmaka_pdf'); window.print(); }}><Icon name="download" />הדפסה / PDF</button>
        <ClientSave keys={rows.map((r) => r.k)} b={net ? 'net' : 'gross'} folder={folder} onSaved={(f) => { setFolderId(f.id); setLive(false); }} suggest={client} busy={!useSnap && pending > 0}
          collect={() => ({ tags: Object.fromEntries(rows.map((r) => [r.k, tagOf(r.k)])),
            ...(useSnap ? {} : { snap: snapOf(rows, bottom, todayIso(), data.asof, net ? 'net' : 'gross') }),
            fields: (() => { const x = collectFields(folder?.fields); if (client.trim()) x['doc:client'] = client.trim(); else delete x['doc:client']; x['doc:kind'] = kind; return x; })() })} />
        {snap && <div className="adoc-snap" role="group" aria-label="צילום הנתונים">
          <span><b>{useSnap ? 'מוצג הצילום' : 'מוצגים נתוני היום'}</b> · התיק נשמר עם צילום מ-{dmyIso(snap.at)}, נתונים עד {ym(snap.asof)}</span>
          <button type="button" className="chip" aria-pressed={live} onClick={() => setLive(!live)}>{live ? 'חזרה לצילום' : `השוואה לנתוני היום (${ym(data.asof)})`}</button>
        </div>}
        {folder && !snap && folder.keys.length > 0 && <p className="adoc-priv">התיק נשמר בגרסה קודמת, בלי צילום של הנתונים שהוצגו: מוצגים נתוני היום. שמירה עכשיו תשמור גם צילום.</p>}
        {dropped > 0 && <p className="adoc-priv adoc-warn" role="status">עד {TRAY_MAX} מסלולים במסמך; {dropped === 1 ? 'מסלול אחד הושמט' : `${dropped} מסלולים הושמטו`} (האחרונים בכתובת).</p>}
        <p className="adoc-priv">שם הלקוח והשדות שתקלידו נשארים בעמוד הזה ולא נשמרים, אלא אם לוחצים "שמור ללקוח": אז הם נשמרים בדפדפן הזה בלבד (בלי תעודת זהות), עד שתמחקו אותם ב<Link to="/clients">תיקי לקוחות</Link>. פרטי בעל הרישיון והלוגו נשמרים בדפדפן הזה בלבד. המסמך יוצא בלי שם האתר. {!useSnap && pending > 0 ? `טוען היסטוריה ל-${pending} מסלולים…` : ''}</p>
        {annex && <div className="adoc-tags" role="group" aria-label="סיווג המסלולים במסמך ההנמקה">{rows.map((r) => <label key={r.k}><span>{r.name}</span><select value={tagOf(r.k)} onChange={(e) => setTags({ ...tags, [r.k]: e.target.value as Tag })} aria-label={`סיווג: ${r.name}`}>{TAGS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>)}</div>}
        {annex && <div className="hnm-kind" role="group" aria-label="סוג מסמך ההנמקה">
          <label>סוג המסמך (§4) <select value={kind} onChange={(e) => setKind(e.target.value as H.DocKind)} aria-label="סוג מסמך ההנמקה">{H.DOC_KINDS.map((d) => <option key={d.k} value={d.k}>{d.label} ({d.sec})</option>)}</select></label>
          {ny && ny.rows.length > 0 && <label>בסיס טבלת הניוד <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)} aria-label="בסיס טבלת הניוד"><option value="fox">הנחות האתר</option><option value="annexB">הנחות נספח ב'</option></select></label>}
          <span className="why">{kindOf.label}: {kindOf.when}.</span>
        </div>}
        {diffs.length > 0 && <div className="adoc-diff" aria-label="מה השתנה מאז הצילום"><b>מה השתנה מאז הצילום ({dmyIso(snap!.at)}, נתונים עד {ym(snap!.asof)}):</b><ul>{diffs.map(({ r, d }) => <li key={r.k}><b>{r.name}</b>: {d.map((x) => <span key={x.label}>{x.label} <bdi dir="ltr">{x.then}</bdi> ← <bdi dir="ltr">{x.now}</bdi></span>)}</li>)}</ul></div>}
        {snap && live && !diffs.length && <p className="adoc-priv">אין שינוי בנתוני המסמך מאז הצילום.</p>}
      </div>

      <Draft.Provider value={draft}>
      <article className="adoc" dir="rtl" lang="he" key={gen}>
        <header className="adoc-h">
          <div className="adoc-brand">{brand.logo && <img src={brand.logo} alt="" />}<div><h1>השוואת מסלולי חיסכון</h1>
            <p className="adoc-sub">{rows.length} מסלולים{held.length ? ` · ${held.length} מוצרים קיימים מהמסלקה` : ''} · נתוני {ym(asof)} · תשואות {lbl} · {useSnap ? <>צילום מ-{dmyIso(snap!.at)}, נתונים עד {ym(snap!.asof)}</> : <>הופק {todayHe()}</>}</p></div></div>
          <dl className="adoc-meta">
            {client.trim() && <><dt>עבור</dt><dd>{client.trim()}</dd></>}
            {brandTxt && <><dt>הוכן על ידי</dt><dd>{brandTxt}</dd></>}
          </dl>
        </header>

        {olds.length > 0 && <section className="adoc-old" role="note">
          <h2>לפני השוואה: ביטוח מנהלים מדור ישן</h2>
          <p>{OLD_WARN}. המסלולים: <b>{olds.map((r) => r.name).join(' · ')}</b>.</p>
          <p>דמי הניהול במסלולים האלה משתנים משנה לשנה (השתתפות ברווחים, הערה 2), ולכן אינם מחיר קבוע להשוואה.</p>
          <p className="adoc-cap">רשימת בדיקה לפני מעבר (מקדם מובטח, הסדר ריסק, חיתום, ותק, כספים הוניים): <Link to={BM_HREF}>ביטוחי מנהלים ישנים</Link>, לפי כל זכות (נכתב בסיוע רשות שוק ההון). מקדמי הקצבה של פוליסה מסוימת אינם פומביים: יש לקבל אותם מחברת הביטוח.</p>
        </section>}

        {held.length > 0 && <HeldNow held={held} rowKeys={rows.map((r) => r.k)} />}

        {rows.length > 0 && <section>
          <h2>המסלולים</h2>
          {pages.map((pg, pi) => (
            <table className="adoc-t tx" key={pi} aria-label={`המסלולים ${pi + 1} מתוך ${pages.length}`}>
              <colgroup><col className="m" />{pg.map((r) => <col key={r.k} />)}</colgroup>
              <thead><tr><th scope="col">{pages.length > 1 ? `חלק ${pi + 1} מתוך ${pages.length}` : 'מדד'}</th>{pg.map((r) => <th key={r.k} scope="col"><b>{r.name}</b><span>{r.prod} · {r.track}{r.id != null ? ` · מס' ${r.id}` : ''}</span>{r.old && <span className="old">דור ישן: ראו האזהרה</span>}</th>)}</tr></thead>
              <tbody>{metrics.map((m) => <tr key={m.key}><th scope="row">{m.label}{N(m.fn)}</th>{pg.map((r) => { const c = m.cell(r, asof); return <td key={r.k}>{c.t}{c.q && <span className="q">{c.q}</span>}</td>; })}</tr>)}</tbody>
            </table>
          ))}
          <p className="adoc-cap">3Y ו-5Y: תשואה שנתית ממוצעת. {net ? 'נטו: אומדן אחרי דמי ניהול מצבירה בלבד; דמי ניהול מהפקדה פועלים על ההפקדות ואינם נכללים.' : 'ברוטו: לפני דמי ניהול.'} "–": אין נתון.</p>
        </section>}

        {rows.length > 0 && <section>
          <h2>בשורה התחתונה</h2>
          <ul className="adoc-bl">{bottom.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <p className="adoc-cap">{BOTTOM_CAP}</p>
        </section>}

        {anyPen && <AnnuityTable rows={rows.filter((r) => r.pen)} coefF={coefF} />}

        {ny && ny.rows.length > 0 && <NyudTable out={ny} print basis={basis} asofText={ym(asof)} />}

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
          <p>{EST_LINE}</p>
          <p className="disc">המסמך מציג נתונים שפרסמה רשות שוק ההון, ביטוח וחיסכון, כפי שהם, ותיאור עובדתי שלהם. אין בו ייעוץ השקעות, ייעוץ פנסיוני, שיווק פנסיוני או ייעוץ מס, ואין בו התחשבות בנתונים ובצרכים של לקוח מסוים. תשואות העבר אינן מבטיחות תשואות בעתיד. דמי הניהול המוצגים הם ממוצע בפועל של המסלול. לפני החלטה יש לבדוק את תנאי המוצר מול הגוף המנהל ואת המידע האישי במסלקה הפנסיונית.</p>
        </section>

        {annex && <Hanmaka rows={rows} tagOf={tagOf} client={client.trim()} asof={asof} held={held} kind={kindOf} brandTxt={brandTxt} logo={brand.logo} />}
        {docB && next.length > 0 && <DocB rows={next} held={held} asof={asof} />}
        <footer className="adoc-foot">
          <span>מסמך גרסה {DOC_VERSION} · הופק {todayHe()} · נתוני הרשות עד {ym(asof)}{useSnap ? ` · צילום מ-${dmyIso(snap!.at)}` : ''}</span>
          <span>{brandTxt ? `בעל הרישיון: ${brandTxt}` : 'בעל הרישיון: לא הוגדר (תיקי לקוחות)'}</span>
          <span>הנוסח והסדר: {H.CIRCULAR.title} ({shortUrl(H.CIRCULAR.url)}); הסעיפים שיושמו: {H.FOLLOWED.join('; ')}. {H.DRAFT_LINE} ({shortUrl(H.CIRCULAR.draft.url)}).</span>
        </footer>
      </article>
      </Draft.Provider>
    </div>
  );
}

const ILS = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const PC = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 2)}%`);
/** the fee-cost method, in words (the same on the current-state table and in the document) */
const COST_HOW = 'עלות דמי הניהול לשנה: יתרה × דמי ניהול מצבירה, ועוד הפקדה חודשית × 12 × דמי ניהול מהפקדה (כשההפקדה ידועה); בלי תשואה עתידית ובלי שינוי בהפקדות';

/** W5 · the client's products as the clearing-house file gives them, every one, matched to a published track or not */
function HeldNow({ held, rowKeys }: { held: Held[]; rowKeys: string[] }) {
  const s = heldSum(held), asof = held.find((h) => h.asof)?.asof;
  return (
    <section className="adoc-held">
      <h2>מצב קיים: המוצרים של הלקוח</h2>
      <table className="adoc-t held">
        <thead><tr><th scope="col">מוצר</th><th scope="col">יתרה</th><th scope="col">הפקדה חודשית</th><th scope="col">ד"נ מצבירה</th><th scope="col">ד"נ מהפקדה</th><th scope="col">עלות ד"נ לשנה</th></tr></thead>
        <tbody>{held.map((h, i) => { const c = heldCost(h); return (
          <tr key={i}><th scope="row"><b>{h.typeHe}</b><span>{[h.provider, h.track ?? h.plan].filter(Boolean).join(' · ')}{h.coefGuaranteed ? ` · מקדם מובטח ${h.coefGuaranteed.v}` : ''}</span>
            {!h.k ? <span className="nomatch">{coverOnly(h) ? 'כיסוי ביטוחי בלבד, בלי חיסכון' : 'לא נמצא מסלול תואם ב-fox: הנתונים מהקובץ בלבד'}</span> : !rowKeys.includes(h.k) ? <span className="nomatch">המסלול לא נכלל בהשוואה</span> : null}</th>
            <td>{ILS(h.balance)}</td><td>{ILS(h.monthly)}</td><td>{PC(h.fee)}</td><td>{PC(h.depfee)}</td>
            <td>{ILS(c.total)}{c.dep != null && c.dep > 0 && <span className="q">מזה מההפקדות {ILS(c.dep)}</span>}</td></tr>); })}</tbody>
        <tfoot><tr><th scope="row">סה"כ</th><td>{ILS(s.balance)}</td><td>{s.monthly ? ILS(s.monthly) : '–'}</td><td /><td /><td>{s.total ? ILS(s.total) : '–'}</td></tr></tfoot>
      </table>
      <p className="adoc-cap">מקובץ המסלקה הפנסיונית של הלקוח{asof ? `, נכון ליום ${dmyIso(asof)}` : ''}: היתרות, ההפקדות ודמי הניהול <b>של הלקוח</b>, כפי שהקובץ מוסר אותם; לא נבדקו מול הגוף המנהל. {COST_HOW}.{s.noFee ? ` ${s.noFee === 1 ? 'מוצר אחד עם יתרה אין לו' : `ל-${s.noFee} מוצרים עם יתרה אין`} דמי ניהול מצבירה בקובץ: לא נכלל בסכום.` : ''}</p>
    </section>
  );
}

/** W6 · the monthly annuity each pension track would pay on one uniform projection ÷ the fund's own coefficient from its bylaws */
function AnnuityTable({ rows, coefF }: { rows: SnapRow[]; coefF: CoefFile | null | undefined }) {
  const plan = { age: AGE_DEFAULT, retire: RETIRE_AGE, balance: BALANCE_EX, monthly: exampleMonthly('פנסיה מקיפה').v, growth: GROWTH_DEFAULT, ret: RET_FALLBACK, infl: INFL_DEFAULT };
  const cell = (r: SnapRow, sex: 'm' | 'f') => {
    const pick = coefFor(coefF, r.grp, sex, RETIRE_AGE, birthYearOf(AGE_DEFAULT));
    const out = project({ ...plan, coef: pick.v }, { fee: r.fee ?? 0, depfee: r.depfee ?? 0 });
    return { ann: out.pensionReal, bal: out.balReal, pick };
  };
  const cells = rows.map((r) => ({ r, m: cell(r, 'm'), f: cell(r, 'f') }));
  const srcs = [...new Map(cells.filter((c) => c.m.pick.src).map((c) => [c.r.grp, c.m.pick.src!])).values()];
  return (
    <section>
      <h2>קצבה חודשית בגיל {RETIRE_AGE}, על הנחות אחידות</h2>
      <table className="adoc-t annex-t small">
        <thead><tr><th scope="col">מסלול</th><th scope="col">חיסכון בגיל {RETIRE_AGE}</th><th scope="col">מקדם, גבר</th><th scope="col">קצבה, גבר</th><th scope="col">מקדם, אישה</th><th scope="col">קצבה, אישה</th><th scope="col">המקור למקדם</th></tr></thead>
        <tbody>{cells.map(({ r, m, f }) => <tr key={r.k}><th scope="row"><b>{r.name}</b></th><td>{ILS(m.bal)}</td><td><bdi dir="ltr">{m.pick.v}</bdi></td><td>{ILS(m.ann)}</td><td><bdi dir="ltr">{f.pick.v}</bdi></td><td>{ILS(f.ann)}</td>
          <td className="src">{m.pick.real ? <span>{m.pick.label}{m.pick.src ? ` (${m.pick.src.edition})` : ''}</span> : <span>לפי הנחה: {m.pick.why}</span>}</td></tr>)}</tbody>
      </table>
      <p className="adoc-cap">הנחות אחידות לכל המסלולים: יתרה של {ILS(plan.balance)} היום והפקדה של {ILS(plan.monthly)} לחודש (סכומי הדוגמה של מחשבון דמי הניהול), גיל {plan.age} היום ופרישה בגיל {plan.retire}, תשואה {plan.ret}% ברוטו, הפקדה שעולה {plan.growth}% בשנה, אינפלציה {plan.infl}%; דמי הניהול הממוצעים של כל מסלול. קצבה = החיסכון ÷ מקדם ההמרה של הקרן לפרישה בגיל {plan.retire}, ילידי {birthYearOf(plan.age)} בקירוב, קצבה לבן/בת זוג 60% בלי הבטחת תשלומים (או הטבלה הקרובה שהקרן מפרסמת); הטבלאות מחושבות לדמי ניהול של 0.3%. ההבדל בין המסלולים נובע מדמי הניהול וממקדם ההמרה בלבד; לא תחזית ולא ייעוץ. המקדם בפועל נקבע בפרישה לפי התקנון שבתוקף אז ומסלול הקצבה שנבחר.
        {srcs.length > 0 && <> מקורות המקדמים: {srcs.map((s) => `${s.title}${s.kind === 'mirror' ? ' (עותק באתר צד שלישי)' : ''} (${shortUrl(s.url)})`).join('; ')}.</>}</p>
    </section>
  );
}

/** W7 · the הנמקה in the circular's wording: נספח א' parts א–ה in its order, every sentence the circular prints verbatim (lib/hanmaka),
 *  the data fox has filled in, and the agent's fields as inline blanks. Field ids are W3's (a folder's saved text refills them). */
function Hanmaka({ rows, tagOf, client, asof, held, kind, brandTxt, logo }: { rows: SnapRow[]; tagOf: (k: string) => Tag; client: string; asof: number; held: Held[]; kind: (typeof H.DOC_KINDS)[number]; brandTxt: string; logo: string | null }) {
  const [brand] = useBranding();
  const own = (k: string) => { const hs = held.filter((h) => h.k === k); return hs.length ? heldOne(hs) : undefined; };
  const pcv = (v: number | null | undefined) => (v == null ? undefined : `${nf(v, 2)}%`);
  const ilsv = (v: number | null | undefined) => (v == null ? undefined : `₪${Math.round(v).toLocaleString('en-US')}`);
  const covers = held.flatMap((h) => h.covers.map((c) => ({ c, h })));
  const a2 = Math.max(3, covers.length);
  const exist = rows.filter((r) => tagOf(r.k) === 'קיים'), next = rows.filter((r) => tagOf(r.k) === 'מומלץ'), seen = rows.filter((r) => tagOf(r.k) === 'נבחן');
  const { onRow, loose } = heldForDoc(held, rows.map((r) => r.k), exist.map((r) => r.k));
  const looseA1 = loose.filter((x) => !coverOnly(x.h));
  const sum = heldSum(held);
  const expOf = (b: number | null | undefined, at: string | null | undefined) => (b == null ? undefined : `יתרת חיסכון ${ilsv(b)}${at ? ` (${dmyIso(at)})` : ''}`);
  const heldName = (h: Held) => [h.typeHe, h.provider].filter(Boolean).join(' · ');
  const guarOf = (h: Held | undefined) => (h?.coefGuaranteed ? `מקדם קצבה מובטח ${h.coefGuaranteed.v}${h.coefGuaranteed.at ? ` לגיל ${h.coefGuaranteed.at}` : ''} (${h.coefGuaranteed.src === 'file' ? 'מהקובץ' : 'לפי הסוכן'}); הבטחת תשואה: להשלים` : undefined);
  /** A.1, one block per product (existing first): the ten columns of §5א(2) in order, two to a line so the page stays portrait */
  const row = (f: SnapRow): ReactNode => {
    const hs = held.filter((h) => h.k === f.k);
    return (
    <div className="a1" key={f.k}>
      <div className="a1-h"><b>{tagOf(f.k) === 'קיים' ? 'מוצר קיים' : 'מוצר מומלץ'}</b> · {f.name}</div>
      <dl className="a1-g">
        <div><dt>המלצה</dt><dd><Fill label={`המלצה: ${f.name}`} inline fk={`a1:${f.k}:rec`} /></dd></div>
        <div><dt>שם המוצר הפנסיוני ומספרו</dt><dd>{f.prod} · {f.mgr}{f.id != null && <span className="q">מס' אישור {f.id}</span>}</dd></div>
        <div><dt>השם המסחרי של מסלול ההשקעה ומספרו</dt><dd>{f.name}{f.id != null && <span className="q">מס' {f.id}</span>}</dd></div>
        <div><dt>הבטחת תשואה</dt><dd><Fill label="הבטחת תשואה" inline fk={`a1:${f.k}:guar`} value={tagOf(f.k) === 'קיים' ? guarOf(hs.find((h) => h.coefGuaranteed)) : undefined} />{f.old && <span className="q">דור ישן: לבדוק בפוליסה</span>}</dd></div>
        <div><dt>תשואה ברוטו</dt><dd><bdi dir="ltr">{f.a3g == null ? '–' : `${sn(f.a3g, 2)}%`}</bdi><span className="q">ממוצע שנתי, 36 חודשים (הרשות, {ym(asof)})</span></dd></div>
        <div><dt>דמי ניהול מהפקדות</dt><dd><Fill label="דמי ניהול מהפקדות ללקוח" inline fk={`a1:${f.k}:dep`} value={tagOf(f.k) === 'קיים' ? pcv(own(f.k)?.depfee) : f.dflt?.depfee != null ? `${nf(f.dflt.depfee, 2)}% (מחיר המכרז, הליך ${f.dflt.t})` : undefined} /><span className="q">ממוצע בפועל במסלול: <bdi dir="ltr">{f.depfee == null ? '–' : `${nf(f.depfee, 2)}%`}</bdi></span></dd></div>
        <div><dt>דמי ניהול מחיסכון מצטבר</dt><dd><Fill label="דמי ניהול מחיסכון מצטבר ללקוח" inline fk={`a1:${f.k}:acc`} value={tagOf(f.k) === 'קיים' ? pcv(own(f.k)?.fee) : f.dflt?.fee != null ? `${nf(f.dflt.fee, 2)}% (מחיר המכרז, הליך ${f.dflt.t})` : undefined} /><span className="q">{f.old ? 'משתנים (השתתפות ברווחים); ' : ''}ממוצע בפועל במסלול: <bdi dir="ltr">{f.fee == null ? '–' : `${nf(f.fee, 2)}%`}</bdi></span></dd></div>
        <div><dt>רמת הסיכון של מסלול ההשקעה</dt><dd><Fill label="רמת הסיכון של המסלול" inline fk={`a1:${f.k}:risk`} /><span className="q">חשיפה למניות: <bdi dir="ltr">{f.st == null ? '–' : `${nf(f.st, 0)}%`}</bdi>{f.sd != null ? <>; סטיית תקן <bdi dir="ltr">{nf(f.sd, 2)}</bdi></> : null}</span></dd></div>
        <div><dt>סכום צפוי (יתרת חסכון ואומדן קצבה צפויה)</dt><dd><Fill label="סכום צפוי" inline fk={`a1:${f.k}:exp`} value={tagOf(f.k) === 'קיים' ? expOf(own(f.k)?.balance, own(f.k)?.asof) : undefined} />{tagOf(f.k) === 'קיים' && onRow.has(f.k) && <span className="q">היתרה מקובץ המסלקה; החיסכון הצפוי: בטבלת הניוד</span>}</dd></div>
        <div><dt>השיקולים העיקריים</dt><dd><Fill label={`השיקולים העיקריים: ${f.name}`} inline fk={`a1:${f.k}:why`} /></dd></div>
      </dl>
    </div>);
  };
  /** W5 · A.1 for a product with no fox track (or one the document leaves out): the fields the file gives, the rest to type */
  const looseRow = ({ h, i, why }: { h: Held; i: number; why: string }): ReactNode => (
    <div className="a1 loose" key={`h${i}`}>
      <div className="a1-h"><b>מוצר קיים</b> · {heldName(h)}{h.track ?? h.plan ? ` · ${h.track ?? h.plan}` : ''} <span className="nomatch">{why}</span></div>
      <dl className="a1-g">
        <div><dt>המלצה</dt><dd><Fill label={`המלצה: ${heldName(h)}`} inline fk={`a1:h${i}:rec`} /></dd></div>
        <div><dt>שם המוצר הפנסיוני ומספרו</dt><dd>{heldName(h)}{h.plan && <span className="q">{h.plan}</span>}<span className="q">מספר המוצר: להשלים מהדוח השנתי</span></dd></div>
        <div><dt>השם המסחרי של מסלול ההשקעה ומספרו</dt><dd><Fill label={`מסלול ההשקעה: ${heldName(h)}`} inline fk={`a1:h${i}:trk`} value={h.track ?? undefined} /></dd></div>
        <div><dt>הבטחת תשואה</dt><dd><Fill label="הבטחת תשואה" inline fk={`a1:h${i}:guar`} value={guarOf(h)} />{/ביטוח מנהלים/.test(h.typeHe) && !h.coefGuaranteed && <span className="q">ביטוח מנהלים: לבדוק בפוליסה מקדם מובטח והבטחת תשואה</span>}</dd></div>
        <div><dt>תשואה ברוטו</dt><dd><Fill label="תשואה ברוטו" inline fk={`a1:h${i}:ret`} /><span className="q">אין נתון באתר למוצר הזה</span></dd></div>
        <div><dt>דמי ניהול מהפקדות</dt><dd><Fill label="דמי ניהול מהפקדות ללקוח" inline fk={`a1:h${i}:dep`} value={pcv(h.depfee)} />{h.depfee != null && <span className="q">של הלקוח, מהקובץ{h.depHow ? ` (${h.depHow})` : ''}</span>}</dd></div>
        <div><dt>דמי ניהול מחיסכון מצטבר</dt><dd><Fill label="דמי ניהול מחיסכון מצטבר ללקוח" inline fk={`a1:h${i}:acc`} value={pcv(h.fee)} />{h.fee != null && <span className="q">של הלקוח, מהקובץ{h.feeHow ? ` (${h.feeHow})` : ''}</span>}</dd></div>
        <div><dt>רמת הסיכון של מסלול ההשקעה</dt><dd><Fill label="רמת הסיכון של המסלול" inline fk={`a1:h${i}:risk`} /></dd></div>
        <div><dt>סכום צפוי (יתרת חסכון ואומדן קצבה צפויה)</dt><dd><Fill label="סכום צפוי" inline fk={`a1:h${i}:exp`} value={expOf(h.balance, h.asof)} />{h.balance != null && <span className="q">היתרה מקובץ המסלקה; החיסכון הצפוי: בטבלת הניוד</span>}</dd></div>
        <div><dt>השיקולים העיקריים</dt><dd><Fill label={`השיקולים העיקריים: ${heldName(h)}`} inline fk={`a1:h${i}:why`} /></dd></div>
      </dl>
    </div>
  );
  const sigBrand = <div className="adoc-sig-brand">{logo && <img src={logo} alt="" />}<span>{brandTxt || 'בעל הרישיון: להשלים'}</span></div>;
  return (
    <section className="annex">
      <header className="annex-h">
        <div className="adoc-brand">{logo && <img src={logo} alt="" />}<h2>{H.TITLE.text}</h2></div>
        <p>{kind.label} ({kind.sec} ל{H.CIRCULAR.title}), מכוח {LAW_SHORT}. הנוסח והסדר של נספח א' כפי שהחוזר קובע; משפט עם סימון סעיף הוא ציטוט, "בניסוח האתר" הוא פרפרזה של הוראת החוזר. הנתונים שמולאו: רשות שוק ההון, {ym(asof)}; דמי הניהול של הלקוח: מקובץ המסלקה. שדה ריק: להשלמה על ידי בעל הרישיון.</p>
        <dl className="adoc-meta">
          <dt>{H.HEAD_FIELDS[0]}</dt><dd><Fill label={H.HEAD_FIELDS[0]} inline value={todayHe()} fk="m:date" /></dd>
          <dt>לכבוד, {H.HEAD_FIELDS[1]}</dt><dd><Fill label={H.HEAD_FIELDS[1]} inline value={client || undefined} /></dd>
          <dt>{H.HEAD_FIELDS[2]}</dt><dd><Fill label={H.HEAD_FIELDS[2]} inline /></dd>
        </dl>
        <div className="hnm-letter">{H.LETTER.map((l, i) => <Q key={i} l={l} className={i === 2 ? 'hnm-q em' : 'hnm-q'} />)}</div>
      </header>

      <Q l={H.PART_A} as="h3" />
      <Q l={H.A1.title} as="h4" />
      <div className="hnm-why">{H.A1.intro.map((l, i) => <Q key={i} l={l} />)}</div>
      {exist.length || looseA1.length || next.length ? <div className="a1s">{exist.map(row)}{looseA1.map(looseRow)}{next.map(row)}</div> : <p className="adoc-cap">אין מסלול שסומן "קיים" או "מומלץ". הסיווג נקבע בסרגל שמעל המסמך.</p>}
      <p className="adoc-cap"><Q l={H.A1.order} as="span" /> <Q l={H.A1.rec} as="span" /> <Q l={H.A1.grossRet} as="span" /> <Q l={H.A1.fees} as="span" /> <Q l={H.A1.risk} as="span" /></p>
      <div className="hnm-warn">{H.A1.warning.text}<span className="hnm-sec">{H.A1.warning.sec}</span></div>
      <p className="adoc-cap">{H.A1.glossary.map((l, i) => <Q key={i} l={l} as="span" />)}</p>

      <Q l={H.A2.title} as="h4" />
      <div className="hnm-why">{H.A2.intro.map((l, i) => <Q key={i} l={l} />)}</div>
      <table className="adoc-t annex-t">
        <thead><tr>{H.A2.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{Array.from({ length: a2 }, (_, i) => { const x = covers[i]; const pre = x ? [undefined, `${x.h.typeHe}${x.h.provider ? ` · ${x.h.provider}` : ''}`, x.c.kind ?? x.c.name, x.c.rate != null ? `${nf(x.c.rate, 0)}% מהשכר${x.c.sum != null ? ` · ${ilsv(x.c.sum)}` : ''}` : ilsv(x.c.sum), ilsv(x.c.cost), `כן: ${x.h.typeHe}${x.h.plan ? ` ${x.h.plan}` : ''}`, undefined] : [];
          return <tr key={i}>{Array.from({ length: 7 }, (_, j) => <td key={j}><Fill label={`כיסוי ${i + 1}, ${H.A2.cols[j]}`} inline fk={`a2:${i}:${j}`} value={pre[j]} /></td>)}</tr>; })}</tbody>
      </table>
      <p className="adoc-cap">{covers.length ? 'הכיסויים הקיימים מולאו מקובץ המסלקה של הלקוח; לבדוק מול הגוף המנהל. ' : ''}נתוני הכיסויים הביטוחיים אינם במאגרים הפתוחים של הרשות: להשלים מהמסלקה ומהגוף המנהל. <Q l={H.A2.rules} as="span" /></p>

      <h4>השיקולים העיקריים במתן ההמלצה <span className="hnm-sec">§5א(1)(ט)</span></h4>
      <div className="annex-grid">
        <label><span>{H.A1.considerations[0].text} <span className="hnm-sec">{H.A1.considerations[0].sec}</span></span><Fill label="התאמת המוצר ללקוח" lines={3} fk="r:fit" /></label>
        <label><span>{H.A1.considerations[1].text} <span className="hnm-sec">{H.A1.considerations[1].sec}</span></span><Fill label="בחירת הגוף המנהל" lines={3} fk="r:mgr" /></label>
        <label><span>{H.A1.considerations[2].text} <span className="hnm-sec">{H.A1.considerations[2].sec}</span></span><Fill label="שינויים בחיתום" lines={2} fk="r:uw" /></label>
        <label><span>{H.A1.considerations[3].text} <span className="hnm-sec">{H.A1.considerations[3].sec}</span></span><Fill label="השלכות משיכה" lines={2} fk="r:wd" /></label>
        <label className="wide"><span>{H.A1.considerations[4].text} <span className="hnm-sec">{H.A1.considerations[4].sec}</span></span><Fill label="ניוד: יתרונות וחסרונות" lines={3} fk="r:port" /></label>
      </div>
      <div className="annex-q">
        <span>{H.A1.questionsRule.text} <span className="hnm-sec">{H.A1.questionsRule.sec}</span>. לסמן רק כשהתשובה "כן", ולפרט:</span>
        {H.A1.questions.map((l) => <label key={l.sec}><input type="checkbox" aria-label={l.text} /> {l.text} <span className="hnm-sec">{l.sec}</span></label>)}
        <Fill label="פירוט לשאלות שנענו בחיוב" lines={2} fk="r:q" />
      </div>
      <h4>סך עלות דמי הניהול והביטוח <span className="hnm-sec">{H.A1.considerations[5].sec}, נספח ב'</span></h4>
      <table className="adoc-t annex-t small"><thead><tr><th /><th>מצב קיים</th><th>מצב מומלץ</th></tr></thead>
        <tbody><tr><th scope="row">סך עלות דמי ניהול</th><td><Fill label="סך דמי ניהול, קיים" inline fk="t:fee0" value={held.length && sum.total ? `${ilsv(sum.total)} לשנה` : undefined} /></td><td><Fill label="סך דמי ניהול, מומלץ" inline fk="t:fee1" /></td></tr>
          <tr><th scope="row">סך עלות ביטוח</th><td><Fill label="סך עלות ביטוח, קיים" inline fk="t:ins0" value={sum.ins ? `${ilsv(sum.ins)} לשנה` : undefined} /></td><td><Fill label="סך עלות ביטוח, מומלץ" inline fk="t:ins1" /></td></tr></tbody></table>
      <p className="adoc-cap">{held.length > 0 ? `מצב קיים מולא מקובץ המסלקה של הלקוח (${sum.n} מוצרים, יתרה כוללת ${ilsv(sum.balance)}): ${COST_HOW}.${sum.noFee ? ` ${sum.noFee} מוצרים עם יתרה בלי דמי ניהול בקובץ לא נכללו.` : ''}${sum.ins ? ` עלות הביטוח: עלות חודשית × 12, רק לכיסויים שהקובץ מפרט להם עלות${sum.noCost ? ` (ל-${sum.noCost} כיסויים אין עלות בקובץ)` : ''}.` : ''} ` : ''}העלות הכוללת לפי נספח ב': {H.ANNEX_B.map((l) => `${l.text} (${l.sec})`).join('; ')}. טבלת הניוד שלמעלה מחשבת את היתרה הצפויה ואת ההפחתה בשל דמי הניהול; ההפחתה בשל כיסויי מוות ונכות (§1(ב)(2)–(3)) דורשת את תעריפי הכיסוי של הגוף המנהל ואינה מחושבת כאן.</p>

      <Q l={H.PART_B.title} as="h3" />
      <div className="hnm-why"><Q l={H.PART_B.why} /></div>
      <div className="annex-grid">
        {H.PART_B.items.map((l, i) => <label key={l.sec}><span>{i + 1}. {l.text}</span><Fill label={l.text} lines={1} fk={`b:${i}`} /></label>)}
      </div>
      <p className="adoc-cap"><Q l={H.PART_B.note} as="span" /> <Q l={H.PART_B.onePage} as="span" /></p>
      <div className="annex-grid">{H.PART_B.decl.map((d) => <div key={d.title.text}><h4>{d.title.text}</h4><p className="hnm-q">{d.text.text}</p><div className="annex-sig" style={{ gridTemplateColumns: '1fr' }}><span>{d.sig}</span></div></div>)}</div>

      <Q l={H.PART_C.title} as="h3" />
      <Q l={H.PART_C.sub1} as="h4" />
      <dl className="adoc-meta grid">
        <dt>{H.PART_C.fields[0]}</dt><dd><Fill label="שם בעל הרישיון" inline value={brand.name || undefined} /></dd>
        <dt>{H.PART_C.fields[1]}</dt><dd><Fill label="מספר רישיון" inline value={brand.lic || undefined} /></dd>
        <dt>{H.PART_C.fields[2]}</dt><dd><Fill label="טלפון" inline fk="c:tel" value={brand.phone || undefined} /></dd>
        <dt>{H.PART_C.fields[3]}</dt><dd><Fill label="כתובת" inline fk="c:addr" value={brand.addr || undefined} /></dd>
        <dt>{H.PART_C.fields[4]}</dt><dd><Fill label="דואר אלקטרוני" inline fk="c:mail" value={brand.email || undefined} /></dd>
        <dt>{H.PART_C.fields[5]}</dt><dd><Fill label="פועל במסגרת חברה" inline fk="c:isco" value={brand.co ? 'כן' : undefined} /></dd>
        <dt>{H.PART_C.fields[6]}</dt><dd><Fill label="שם החברה" inline fk="c:co" value={brand.co || undefined} /></dd>
        <dt>{H.PART_C.fields[7]}</dt><dd><Fill label="ח.פ. החברה" inline fk="c:coid" value={brand.coId || undefined} /></dd>
      </dl>
      <Q l={H.PART_C.sub2} as="h4" />
      <div className="hnm-why"><Q l={H.PART_C.why} /></div>
      <div className="annex-grid">
        <label><span>יועץ פנסיוני: {H.PART_C.adviser[0].text}</span><Fill label="תגמול היועץ" lines={2} fk="c:adv" value={`${H.PART_C.adviser[1].text}\n${H.PART_C.adviser[2].text}`} /></label>
        <label><span>סוכן ביטוח פנסיוני / משווק פנסיוני</span><Fill label="תגמול הסוכן" lines={2} fk="c:agent" value={H.PART_C.agent.text} /></label>
      </div>
      <p className="adoc-cap" style={{ marginTop: '1.5mm' }}>1. <Q l={H.PART_C.listIntro} as="span" /> <Q l={H.PART_C.listRule} as="span" /></p>
      <table className="adoc-t annex-t c-list">
        <thead><tr>{H.PART_C.listCols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{[1, 2, 3].map((i) => <tr key={i}><td>{i}</td>{[1, 2, 3, 4].map((j) => <td key={j}><Fill label={`מקום ${i}, ${H.PART_C.listCols[j]}`} inline fk={`c:list:${i}:${j}`} /></td>)}</tr>)}</tbody>
      </table>
      <p className="adoc-cap"><Q l={H.PART_C.listNote} as="span" /></p>
      <label className="annex-wide"><span>{H.PART_C.incentives.text} <Q l={H.PART_C.incentivesRule} as="span" /></span><Fill label="גילוי השתתפות בתוכנית תגמול" lines={2} fk="c:disc" /></label>
      <Q l={H.PART_C.sub3} as="h4" />
      <p className="hnm-q">{H.PART_C.nonPen.text}</p>
      <table className="adoc-t annex-t small"><thead><tr>{H.PART_C.nonPenCols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{[0, 1].map((i) => <tr key={i}>{[0, 1, 2].map((j) => <td key={j}><Fill label={`מוצר ${i + 1}, ${H.PART_C.nonPenCols[j]}`} inline fk={`c:np:${i}:${j}`} /></td>)}</tr>)}</tbody></table>
      <p className="adoc-cap"><Q l={H.PART_C.nonPenNote} as="span" /></p>

      <Q l={H.PART_D.title} as="h3" />
      <div className="annex-grid">
        <div><h4>{H.PART_D.before.text}</h4><ul className="annex-list">{exist.length || loose.length ? <>{exist.map((f) => { const o = onRow.has(f.k) ? own(f.k) : undefined; return <li key={f.k}>{f.prod}, {f.mgr}, {f.name}{f.id != null ? ` (${f.id})` : ''}{o?.balance != null ? ` · ${ilsv(o.balance)}` : ''}</li>; })}{loose.map(({ h, i }) => <li key={`h${i}`}>{heldName(h)}{h.track ?? h.plan ? `, ${h.track ?? h.plan}` : ''}{h.balance != null ? ` · ${ilsv(h.balance)}` : ''}{!h.k ? <span className="nomatch"> (לא נמצא מסלול תואם ב-fox)</span> : null}</li>)}{covers.map(({ c, h }, i) => <li key={`c${i}`}>{h.typeHe}, {h.provider ?? ''}, {c.kind ?? c.name}</li>)}</> : <li><Fill label="מצב קיים" inline /></li>}</ul></div>
        <div><h4>{H.PART_D.after.text}</h4><ul className="annex-list">{next.length ? next.map((f) => <li key={f.k}>{f.prod}, {f.mgr}, {f.name}{f.id != null ? ` (${f.id})` : ''}</li>) : <li><Fill label="מצב חדש" inline /></li>}<li><Fill label="כיסויים ביטוחיים במצב החדש" inline fk="d:cov" /></li></ul></div>
      </div>
      <p className="adoc-cap"><Q l={H.PART_D.rule} as="span" /></p>

      <Q l={H.PART_E.title} as="h3" />
      <p className="hnm-q">{H.PART_E.text.text}</p>
      <div className="annex-sig">{H.PART_E.sigs.map((s) => <span key={s}>{s}{s.startsWith('חתימת הסוכן') ? sigBrand : null}</span>)}</div>
      <p className="adoc-cap"><Q l={H.PART_E.only} as="span" /></p>

      {seen.length > 0 && <>
        <h3>לתיק הסוכן: מסלולים שנבחנו ולא הומלצו</h3>
        <p className="adoc-cap">אינם חלק מנספח א'. נשמרים כאן כתיעוד של החלופות שנבדקו בפגישה, עם הנתונים שבטבלה למעלה ובטבלת הניוד.</p>
        <ul className="annex-list">{seen.map((f) => <li key={f.k}>{f.prod} · {f.name}{f.id != null ? ` · מס' ${f.id}` : ''}</li>)}</ul>
      </>}
      <p className="adoc-cap">{H.RULES.map((l) => `${l.text} (${l.sec}${l.kind === 'p' ? ', בניסוח האתר' : ''})`).join(' ')} מקור הנוסח: {H.CIRCULAR.title} ({shortUrl(H.CIRCULAR.url)}). לפני מסמך מלא: בקשת מידע במסלקה הפנסיונית (§5א(1)(ב)).</p>
    </section>
  );
}
const LAW_SHORT = H.LAW;

/** W7 · "מסמך ב'": the pre-enrolment disclosure of the recommended product(s): what the institution must tell a joining member and the
 *  default-fund notice, with the data fox has (fees, tender terms, track) and blanks for what only the institution knows (covers). */
function DocB({ rows, held, asof }: { rows: SnapRow[]; held: Held[]; asof: number }) {
  const ilsv = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
  return (
    <section className="docb">
      <h2>{H.DOC_B.title}</h2>
      <p className="adoc-cap">{H.DOC_B.fox}.</p>
      {rows.map((r) => {
        const hs = held.filter((h) => h.k === r.k), cov = hs.flatMap((h) => h.covers);
        return (
        <div className="a1" key={r.k}>
          <div className="a1-h"><b>{r.prod}</b> · {r.mgr} · {r.name}{r.id != null ? ` · מס' אישור ${r.id}` : ''}</div>
          <dl className="a1-g">
            <div><dt>החברה המנהלת, הקרן/הקופה וקודה <span className="hnm-sec">§13(1)</span></dt><dd>{r.mgr} · {r.name}{r.id != null ? ` (${r.id})` : ''}</dd></div>
            <div><dt>מסלול ההשקעה <span className="hnm-sec">§13(5)</span></dt><dd>{r.track}{r.pen && /עד 50|50-60|60 ומעלה/.test(r.track) ? ' (מסלול תלוי גיל: המודל החכ"ם)' : ''}</dd></div>
            <div><dt>דמי ניהול מהפקדות / מצבירה <span className="hnm-sec">§13(6)</span></dt><dd><Fill label="דמי ניהול שהוסכמו" inline fk={`db:${r.k}:fee`} value={r.dflt?.fee != null && r.dflt.depfee != null ? `${nf(r.dflt.depfee, 2)}% / ${nf(r.dflt.fee, 2)}% (מחיר המכרז, הליך ${r.dflt.t})` : undefined} /><span className="q">ממוצע בפועל במסלול, {ym(asof)}: <bdi dir="ltr">{r.depfee == null ? '–' : `${nf(r.depfee, 2)}%`} / {r.fee == null ? '–' : `${nf(r.fee, 2)}%`}</bdi>; דמי הניהול ללקוח: לפי ההסכם</span></dd></div>
            <div><dt>הוצאות ישירות <span className="hnm-sec">§13(7)</span></dt><dd>{H.DOC_B.items[4].text}<span className="q">שיעור ההוצאות הישירות: באתר החברה המנהלת ובדוח השנתי</span></dd></div>
            <div><dt>הכיסוי הביטוחי <span className="hnm-sec">§13(3)</span></dt><dd><Fill label="מסלול הביטוח והכיסויים" inline fk={`db:${r.k}:cov`} value={cov.length ? cov.map((c) => `${c.kind ?? c.name}${c.rate != null ? ` ${nf(c.rate, 0)}%` : ''}${c.cost != null ? `, ${ilsv(c.cost)} לחודש` : ''}`).join('; ') : undefined} /><span className="q">{r.pen ? 'בקרן פנסיה: מסלול הביטוח, שיעורי הכיסוי לנכות ולשאירים, והאפשרות לוותר על כיסוי שאירים (תקפה 24 חודשים)' : 'לפי תנאי המוצר'}; אינו במאגרי הרשות</span></dd></div>
            <div><dt>מועד ההצטרפות; המעסיק <span className="hnm-sec">§13(8)–(9)</span></dt><dd><Fill label="מועד ההצטרפות והמעסיק" inline fk={`db:${r.k}:join`} /><span className="q">{H.DOC_B.items[5].text}</span></dd></div>
            <div><dt>מוקד השירות; בעל הרישיון <span className="hnm-sec">§13(10)–(11)</span></dt><dd><Fill label="מוקד השירות" inline fk={`db:${r.k}:svc`} />{r.svc && <span className="q">מדד השירות של הרשות: ציון {r.svc.total}, מקום {r.svc.rank} מתוך {r.svc.of}</span>}</dd></div>
          </dl>
          {r.pen && <div className="hnm-why">
            <b>הודעת ברירת המחדל</b>
            {r.dflt && r.dflt.fee != null ? <p className="q">הקרן היא קרן נבחרת בהליך {r.dflt.t}; מחיר המכרז למצטרף דרך ההליך: {nf(r.dflt.depfee ?? 0, 2)}% מהפקדה / {nf(r.dflt.fee, 2)}% מצבירה.</p> : <p className="q">הקרן אינה קרן נבחרת (ברירת מחדל) בהליך שבתוקף ב-{ym(asof)}.</p>}
            {H.DOC_B.defaultNotice.map((l, i) => <Q key={i} l={l} />)}
          </div>}
        </div>);
      })}
      <p className="adoc-cap">מקורות: {H.DOC_B.src.map((s) => `${s.title} (${shortUrl(s.url)})${s.note ? `; ${s.note}` : ''}`).join('. ')}.</p>
    </section>
  );
}
