import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { Icon } from '../components/Icon';
import { useFunds } from '../lib/useData';
import { useStored } from '../lib/local';
import { useHists, useOptional } from '../lib/fundsLoad';
import type { DefaultFile } from '../lib/fundsTools';
import { nf, sn } from '../lib/format';
import { NET_LABEL, TRAY_MAX, netSeries, selfDirected, stats, ym, type FundX, type FundsFile, type HistX } from '../lib/funds';
import { TIE_NOTE } from '../lib/fundsTie';
import { compareSummary, type Lead } from '../lib/compareSummary';
import { ACT_F, defaultNow, isPension, periodText } from '../lib/pensionPack';
import { RULES_NOTE, rulesOf } from '../lib/productRules';
import { PENSION_MISSING } from '../components/agent/PensionPack';
import '../styles/agentDoc.css';

/* W1 · agent door: the client document, /funds/compare/print?k=…&b=net|gross. An A4 page set, right to left, unbranded: the tracks
   compared with every figure's source and data month, the bottom line (descriptive), the tax and liquidity rule of each product, a
   disclaimer; then a worksheet for the הנמקה in the order of the regulator's Annex A (חוזר סוכנים ויועצים 2018-10-11), with the data
   the site has filled in and the agent's fields left to type. The client's name and every typed field live in this page only (never
   stored); the agent's name and licence number are kept in this browser (localStorage), never sent anywhere. window.print() makes the
   PDF. */

type Tag = 'קיים' | 'מומלץ' | 'נבחן';
const TAGS: Tag[] = ['קיים', 'מומלץ', 'נבחן'];
const HNM_SRC = { url: 'https://www.chamber.org.il/media/159038/h_2018-10-11-changes.pdf', title: 'חוזר סוכנים ויועצים 2018-10-11 "מסמך הנמקה – תיקון" (18.07.2018; בתוקף מ-01.07.2019), נספח א\'' };
const HNM_DRAFT = { url: 'https://www.gov.il/BlobFolder/dynamiccollectorresultitem/notice_2025_65/he/Draft%20explanatory%20Document%20-%20PDF.pdf', title: 'טיוטת חוזר סוכנים ויועצים 2025-3 (30.11.2025): תוספת סעיף 7א ונספח ה\'1; טרם נכנסה לתוקף' };
const LAW = 'סעיף 14 לחוק הפיקוח על שירותים פיננסיים (ייעוץ, שיווק ומערכת סליקה פנסיוניים), התשס"ה-2005';
const pct = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${nf(v, d)}%`);
const spct = (v: number | null | undefined, d = 1) => (v == null ? '–' : `${sn(v, d)}%`);
const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

/** a field the agent types into: it grows with its text and prints as typed (an empty one prints as a ruled box) */
function Fill({ label, lines = 2, inline = false, value }: { label: string; lines?: number; inline?: boolean; value?: string }) {
  return <div className={`fill${inline ? ' in' : ''}`} style={{ minHeight: inline ? undefined : `${lines * 1.6}em` }} contentEditable suppressContentEditableWarning role="textbox" aria-multiline={!inline} aria-label={label} data-ph={label}>{value}</div>;
}

export function FundsComparePrint() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const [sp] = useSearchParams();
  const keys = useMemo(() => (sp.get('k') ?? '').split(',').filter((k) => /^[gip]\d+$/.test(k)).slice(0, TRAY_MAX), [sp]);
  const net = sp.get('b') !== 'gross';
  const { hist } = useHists(keys);
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const [client, setClient] = useState('');
  const [agent, setAgent] = useStored<string>('agent:name', '');
  const [lic, setLic] = useStored<string>('agent:lic', '');
  const [annex, setAnnex] = useState(true);
  const [tags, setTags] = useState<Record<string, Tag>>({});
  const tagOf = (k: string): Tag => tags[k] ?? 'נבחן';

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="המסמך" />;
  const asof = data.asof;
  const fs = keys.map((k) => data.funds.find((f) => f.k === k)).filter((f): f is FundX => !!f);
  if (!fs.length) return <div className="adoc-wrap"><p>אין מסלולים במסמך. <Link to="/funds/compare">חזרה להשוואה</Link></p></div>;

  const ret = (f: FundX, p: 'y12' | 'a3' | 'a5') => (net ? f.net?.[p] ?? null : f[p]);
  const series = (f: FundX) => { const h = hist[f.k] as HistX | undefined; return h ? (net ? netSeries(h).y : h.y) : null; };
  const mdd = (f: FundX) => { const y = series(f); const s = y ? stats(y, 60) : null; return s && s.months >= 60 ? s.dd : null; };
  const sharpe = (f: FundX) => (f.sd != null && f.sd > 0 && !selfDirected(f) ? f.sharpe : null);
  const anyPen = fs.some(isPension);
  const sum = compareSummary(fs.map((f) => ({ k: f.k, name: f.name, prod: f.prod, fee: f.fee, depfee: f.depfee, r5: ret(f, 'a5'), sharpe: sharpe(f) })));
  const rules = rulesOf(fs.map((f) => f.prod));
  const nameOf = (k: string) => fs.find((f) => f.k === k)?.name ?? k;
  const miss = (n: number) => (n === 1 ? 'למסלול אחד אין נתון' : `ל-${n} מסלולים אין נתון`);
  const lead = (l: Lead | null, what: string, v: string) => (!l ? null : l.all ? <li>{what}: כל {l.of} המסלולים צמודים (<bdi dir="ltr">{v}</bdi>).</li> : <li>{what}: <b>{l.ks.map(nameOf).join(' ו')}</b>{l.ks.length > 1 ? ' (צמודים)' : ''}, <bdi dir="ltr">{v}</bdi>{l.missing.length ? `; ${miss(l.missing.length)}` : ''}.</li>);
  const lbl = net ? NET_LABEL : 'ברוטו';
  const pending = keys.length - Object.keys(hist).filter((k) => keys.includes(k)).length;

  // the notes: one per column, numbered in the order of the table
  const notes: string[] = [
    `${data.source}, נתוני ${ym(asof)}. תשואות ${net ? 'נטו, אומדן: התשואה החודשית שפורסמה (ברוטו) פחות דמי הניהול מצבירה של אותו חודש ÷ 12, בריבית דריבית; 3Y ו-5Y: ממוצע שנתי' : 'ברוטו (לפני דמי ניהול) כפי שפורסמו: YEAR_TO_DATE_YIELD, AVG_ANNUAL_YIELD_TRAILING_3YRS/5YRS; LTM: 12 התשואות החודשיות בריבית דריבית'}.`,
    `דמי ניהול: הממוצע בפועל שגבה המסלול מכלל עמיתיו (AVG_ANNUAL_MANAGEMENT_FEE מצבירה, AVG_DEPOSIT_FEE מהפקדה), ${ym(asof)}; דמי הניהול של הלקוח יכולים להיות שונים.`,
    'שארפ וסטיית תקן: כפי שהרשות מפרסמת (SHARPE_RATIO, STANDARD_DEVIATION). מסלול בניהול אישי או בלי תנודתיות: אין שארפ.',
    `ירידה מרבית: מחושבת מ-60 התשואות החודשיות האחרונות (${lbl}), מהשיא לשפל שאחריו.`,
    `חשיפה למניות: STOCK_MARKET_EXPOSURE כאחוז מהנכסים, ${ym(asof)}.`,
    ...(anyPen ? [`${ACT_F}.`, `קרן ברירת מחדל: ההליך שבתוקף ב-${ym(asof)} לפי הודעות רשות שוק ההון (funds/default.json); דמי הניהול בהליך: מהפקדה / מצבירה, לעמית שהצטרף דרכו.`] : []),
  ];
  const N = (i: number) => <sup className="fn">{i}</sup>;

  return (
    <div className="adoc-wrap">
      <div className="adoc-tools" role="region" aria-label="הגדרות המסמך">
        <Link to={`/funds/compare?k=${keys.join(',')}`} className="chip"><span aria-hidden="true">→</span> חזרה להשוואה</Link>
        <label>שם הלקוח <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="לא חובה" maxLength={60} /></label>
        <label>שם הסוכן/היועץ <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="לא חובה" maxLength={60} /></label>
        <label>מס' רישיון <input value={lic} onChange={(e) => setLic(e.target.value)} placeholder="לא חובה" maxLength={20} inputMode="numeric" /></label>
        <label className="chk"><input type="checkbox" checked={annex} onChange={(e) => setAnnex(e.target.checked)} /> נספח הנמקה</label>
        <button type="button" className="cmp-doc" onClick={() => window.print()}><Icon name="download" />הדפסה / PDF</button>
        <p className="adoc-priv">שם הלקוח והשדות שתקלידו נשארים בעמוד הזה בלבד ולא נשמרים. שם הסוכן ומספר הרישיון נשמרים בדפדפן הזה בלבד. המסמך יוצא בלי שם האתר. {pending > 0 ? `טוען היסטוריה ל-${pending} מסלולים…` : ''}</p>
        {annex && <div className="adoc-tags" role="group" aria-label="סיווג המסלולים בנספח">{fs.map((f) => <label key={f.k}><span>{f.name}</span><select value={tagOf(f.k)} onChange={(e) => setTags({ ...tags, [f.k]: e.target.value as Tag })} aria-label={`סיווג: ${f.name}`}>{TAGS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>)}</div>}
      </div>

      <article className="adoc" dir="rtl" lang="he">
        <header className="adoc-h">
          <div><h1>השוואת מסלולי חיסכון</h1>
            <p className="adoc-sub">{fs.length} מסלולים · נתוני {ym(asof)} · תשואות {lbl} · הופק {today()}</p></div>
          <dl className="adoc-meta">
            {client.trim() && <><dt>עבור</dt><dd>{client.trim()}</dd></>}
            {agent.trim() && <><dt>הוכן על ידי</dt><dd>{agent.trim()}{lic.trim() ? `, רישיון ${lic.trim()}` : ''}</dd></>}
          </dl>
        </header>

        <section>
          <h2>המסלולים</h2>
          <table className="adoc-t">
            <thead><tr><th>מסלול</th><th>LTM{N(1)}</th><th>3Y{N(1)}</th><th>5Y{N(1)}</th><th>ד"נ מצבירה{N(2)}</th><th>ד"נ מהפקדה{N(2)}</th><th>שארפ{N(3)}</th><th>סטיית תקן{N(3)}</th><th>ירידה מרבית{N(4)}</th><th>מניות{N(5)}</th>
              {anyPen && <><th>איזון אקטוארי{N(6)}</th><th>ברירת מחדל{N(7)}</th></>}</tr></thead>
            <tbody>{fs.map((f) => { const d = isPension(f) ? defaultNow(f.k, dfile, asof) : null; return (
              <tr key={f.k}>
                <th scope="row"><b>{f.name}</b><span>{f.prod} · {f.track} · מס' {f.id}</span></th>
                <td>{spct(ret(f, 'y12'))}</td><td>{spct(ret(f, 'a3'))}</td><td>{spct(ret(f, 'a5'))}</td>
                <td>{pct(f.fee)}</td><td>{pct(f.depfee)}</td><td>{sharpe(f) == null ? '–' : nf(sharpe(f)!, 2)}</td><td>{f.sd == null ? '–' : nf(f.sd, 2)}</td><td>{spct(mdd(f))}</td><td>{f.st == null ? '–' : `${nf(f.st, 0)}%`}</td>
                {anyPen && <><td>{!isPension(f) ? '–' : f.act == null ? 'לא דווח' : <>{spct(f.act, 2)}<span className="q">{ym(f.act_p ?? asof)}</span></>}</td>
                  <td>{!isPension(f) ? '–' : d ? <>כן<span className="q"><bdi dir="ltr">{periodText(d.t)}</bdi></span><span className="q"><bdi dir="ltr">{pct(d.depfee)} / {pct(d.fee)}</bdi></span></> : dfile ? 'לא' : '–'}</td></>}
              </tr>); })}</tbody>
          </table>
          <p className="adoc-cap">3Y ו-5Y: תשואה שנתית ממוצעת. {net ? 'נטו: אומדן אחרי דמי ניהול מצבירה בלבד; דמי ניהול מהפקדה פועלים על ההפקדות ואינם נכללים.' : 'ברוטו: לפני דמי ניהול.'} "–": אין נתון לחלון.</p>
        </section>

        <section>
          <h2>בשורה התחתונה</h2>
          <ul className="adoc-bl">
            {lead(sum.fee, 'דמי הניהול מצבירה הנמוכים (ממוצע בפועל)', pct(sum.fee?.v))}
            {lead(sum.depfee, 'דמי הניהול מהפקדה הנמוכים (ממוצע בפועל)', pct(sum.depfee?.v))}
            {lead(sum.r5, `התשואה השנתית הגבוהה ב-5Y, ${lbl}`, spct(sum.r5?.v))}
            {lead(sum.sharpe, 'השארפ הגבוה', sum.sharpe ? nf(sum.sharpe.v, 2) : '–')}
          </ul>
          <p className="adoc-cap">תיאור עובדתי של נתוני העבר, לא המלצה ולא תחזית. {TIE_NOTE}.{sum.mixed ? ' המסלולים שייכים למוצרים שונים, עם מיסוי ונזילות שונים; ההשוואה אינה דירוג.' : ''}</p>
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
          <ol>{notes.map((n, i) => <li key={i}>{n}</li>)}</ol>
          {anyPen && <p>{PENSION_MISSING}.</p>}
          <p className="disc">המסמך מציג נתונים שפרסמה רשות שוק ההון, ביטוח וחיסכון, כפי שהם, ותיאור עובדתי שלהם. אין בו ייעוץ השקעות, ייעוץ פנסיוני, שיווק פנסיוני או ייעוץ מס, ואין בו התחשבות בנתונים ובצרכים של לקוח מסוים. תשואות העבר אינן מבטיחות תשואות בעתיד. דמי הניהול המוצגים הם ממוצע בפועל של המסלול. לפני החלטה יש לבדוק את תנאי המוצר מול הגוף המנהל ואת המידע האישי במסלקה הפנסיונית.</p>
        </section>

        {annex && <Annex fs={fs} tagOf={tagOf} ret3={(f) => f.a3} client={client.trim()} agent={agent.trim()} lic={lic.trim()} asof={asof} />}
      </article>
    </div>
  );
}

/** The הנמקה worksheet: Annex A's parts and fields, in its order, with what the site knows filled in. */
function Annex({ fs, tagOf, ret3, client, agent, lic, asof }: { fs: FundX[]; tagOf: (k: string) => Tag; ret3: (f: FundX) => number | null; client: string; agent: string; lic: string; asof: number }) {
  const order = [...fs.filter((f) => tagOf(f.k) === 'קיים'), ...fs.filter((f) => tagOf(f.k) === 'מומלץ'), ...fs.filter((f) => tagOf(f.k) === 'נבחן')];
  /** A.1, one block per product (existing first): Annex A's ten fields in its order, two to a line so the page stays portrait */
  const row = (f: FundX): ReactNode => (
    <div className="a1" key={f.k}>
      <div className="a1-h"><b>{tagOf(f.k)}</b> · {f.name}</div>
      <dl className="a1-g">
        <div><dt>המלצה</dt><dd><Fill label={`המלצה: ${f.name}`} inline /></dd></div>
        <div><dt>שם המוצר הפנסיוני ומספרו</dt><dd>{f.prod} · {f.mgr}<span className="q">מס' {f.id}</span></dd></div>
        <div><dt>השם המסחרי של מסלול ההשקעה ומספרו</dt><dd>{f.name}<span className="q">מס' {f.id}</span></dd></div>
        <div><dt>הבטחת תשואה</dt><dd><Fill label="הבטחת תשואה" inline /></dd></div>
        <div><dt>תשואה ברוטו</dt><dd><bdi dir="ltr">{ret3(f) == null ? '–' : `${sn(ret3(f)!, 2)}%`}</bdi><span className="q">ממוצע שנתי, 36 חודשים (הרשות, {ym(asof)})</span></dd></div>
        <div><dt>דמי ניהול מהפקדות</dt><dd><Fill label="דמי ניהול מהפקדות ללקוח" inline /><span className="q">ממוצע בפועל במסלול: <bdi dir="ltr">{f.depfee == null ? '–' : `${nf(f.depfee, 2)}%`}</bdi></span></dd></div>
        <div><dt>דמי ניהול מחיסכון מצטבר</dt><dd><Fill label="דמי ניהול מחיסכון מצטבר ללקוח" inline /><span className="q">ממוצע בפועל במסלול: <bdi dir="ltr">{f.fee == null ? '–' : `${nf(f.fee, 2)}%`}</bdi></span></dd></div>
        <div><dt>רמת הסיכון של מסלול ההשקעה</dt><dd><Fill label="רמת הסיכון של המסלול" inline /><span className="q">חשיפה למניות: <bdi dir="ltr">{f.st == null ? '–' : `${nf(f.st, 0)}%`}</bdi></span></dd></div>
        <div><dt>סכום צפוי (יתרת חיסכון ואומדן קצבה)</dt><dd><Fill label="סכום צפוי" inline /></dd></div>
        <div><dt>השיקולים העיקריים</dt><dd><Fill label={`השיקולים העיקריים: ${f.name}`} inline /></dd></div>
      </dl>
    </div>
  );
  const exist = fs.filter((f) => tagOf(f.k) === 'קיים'), next = fs.filter((f) => tagOf(f.k) !== 'קיים' && tagOf(f.k) === 'מומלץ');
  return (
    <section className="annex">
      <header className="annex-h">
        <h2>נספח: טיוטת עבודה למסמך ההנמקה</h2>
        <p>לפי המבנה של נספח א' ל{HNM_SRC.title}, מכוח {LAW}. החוזר קובע נוסח וסדר מחייבים ואוסר לשנותם; זהו דף עבודה לאיסוף הנתונים בפגישה, ומסמך ההנמקה עצמו יופק בנוסח המחייב. הנתונים שמולאו: רשות שוק ההון, {ym(asof)}.</p>
        <dl className="adoc-meta">
          <dt>תאריך מתן ההמלצה</dt><dd><Fill label="תאריך מתן ההמלצה" inline value={today()} /></dd>
          <dt>שם הלקוח</dt><dd><Fill label="שם הלקוח" inline value={client || undefined} /></dd>
          <dt>ת"ז</dt><dd><Fill label="תעודת זהות" inline /></dd>
        </dl>
      </header>

      <h3>חלק א – ההמלצה</h3>
      <h4>א.1 הרכב החיסכון הפנסיוני המומלץ עבורך</h4>
      <div className="a1s">{order.map(row)}</div>
      <p className="adoc-cap">סדר השורות לפי החוזר: המוצרים הקיימים, ואחריהם החדשים. מוצר שמשתנה: שורה לפני ושורה אחרי, ו"לא שונה" בשדה שלא השתנה. דמי ניהול: יש להקליד את דמי הניהול של הלקוח; הממוצע בפועל במסלול מוצג להשוואה בלבד.</p>
      <h4>א.2 הכיסויים הביטוחיים המומלצים עבורך</h4>
      <table className="adoc-t annex-t">
        <thead><tr><th>המלצה</th><th>שם המוצר</th><th>סוג הכיסוי הביטוחי / מסלול הביטוח</th><th>סכום הכיסוי הביטוחי</th><th>עלות חודשית</th><th>כיסוי כלול במוצר פנסיוני קיים</th><th>השיקולים העיקריים</th></tr></thead>
        <tbody>{[0, 1, 2].map((i) => <tr key={i}>{Array.from({ length: 7 }, (_, j) => <td key={j}><Fill label={`כיסוי ${i + 1}, שדה ${j + 1}`} inline /></td>)}</tr>)}</tbody>
      </table>
      <p className="adoc-cap">נתוני הכיסויים הביטוחיים אינם במאגרים הפתוחים של הרשות: יש למלא מהמסלקה ומהגוף המנהל.</p>
      <h4>נימוקי ההמלצה</h4>
      <div className="annex-grid">
        <label><span>התאמת המוצר ללקוח, יתרונותיו וחסרונותיו</span><Fill label="התאמת המוצר ללקוח" lines={3} /></label>
        <label><span>בחירת הגוף המנהל: יישוב תביעות, שירות, תפעול</span><Fill label="בחירת הגוף המנהל" lines={3} /></label>
        <label><span>שינויים בחיתום בהחלפת כיסוי ביטוחי</span><Fill label="שינויים בחיתום" lines={2} /></label>
        <label><span>השלכות משיכת כספים</span><Fill label="השלכות משיכה" lines={2} /></label>
        <label className="wide"><span>בהעברת כספים (ניוד): יתרונות וחסרונות של המוצר החדש לעומת הקיים</span><Fill label="ניוד: יתרונות וחסרונות" lines={3} /></label>
      </div>
      <div className="annex-q">
        <span>בניוד, לסמן רק כשהתשובה "כן", ולפרט:</span>
        {['מקדם קצבה מובטח לתוחלת חיים', 'מקדם קצבה עם הבטחת תשואה', 'מוצר שהקצבה ממנו אינה מושפעת מתוחלת החיים', 'מוצר שהקצבה ממנו אינה מושפעת מהתשואה', 'קרן ותיקה שבהסדר'].map((q) => <label key={q}><input type="checkbox" aria-label={q} /> {q}</label>)}
      </div>
      <h4>סך עלות דמי הניהול והביטוח</h4>
      <table className="adoc-t annex-t small"><thead><tr><th /><th>מצב קיים</th><th>מצב מומלץ</th></tr></thead>
        <tbody><tr><th scope="row">סך עלות דמי ניהול</th><td><Fill label="סך דמי ניהול, קיים" inline /></td><td><Fill label="סך דמי ניהול, מומלץ" inline /></td></tr>
          <tr><th scope="row">סך עלות ביטוח</th><td><Fill label="סך עלות ביטוח, קיים" inline /></td><td><Fill label="סך עלות ביטוח, מומלץ" inline /></td></tr></tbody></table>
      <p className="adoc-cap">לפי נספח ב' לחוזר (אופן החישוב).</p>

      <h3>חלק ב – המאפיינים שלך לפיהם נקבעו ההמלצות</h3>
      <div className="annex-grid">
        {['גיל', 'מצב משפחתי', 'מצב תעסוקתי', 'הכנסות קבועות נוספות בפרישה', 'מידת הסיכון המועדפת', 'מטרות החיסכון', 'מטרות הביטוח'].map((x) => <label key={x}><span>{x}</span><Fill label={x} lines={1} /></label>)}
      </div>
      <div className="annex-sig">
        <span>הצהרת בעל הרישיון על שמירת סודיות</span><span>הצהרת הלקוח על מידע שלא נמסר</span><span>הצהרת בעל הרישיון לעניין המידע שלא נמסר</span>
      </div>

      <h3>חלק ג – הכר את הסוכן/יועץ/משווק</h3>
      <dl className="adoc-meta grid">
        <dt>שם מלא</dt><dd><Fill label="שם בעל הרישיון" inline value={agent || undefined} /></dd>
        <dt>מספר רישיון</dt><dd><Fill label="מספר רישיון" inline value={lic || undefined} /></dd>
        <dt>טלפון</dt><dd><Fill label="טלפון" inline /></dd><dt>כתובת</dt><dd><Fill label="כתובת" inline /></dd><dt>דוא"ל</dt><dd><Fill label="דואר אלקטרוני" inline /></dd>
        <dt>פועל באמצעות חברה (שם, ח.פ.)</dt><dd><Fill label="שם החברה ומספרה" inline /></dd>
      </dl>
      <label className="annex-wide"><span>גילוי נאות: עמלות (סוכן: עד שלושה גופים מוסדיים לכל סוג מוצר לפי חלקם בעמלות; יועץ: עמלת הפצה או שכר טרחה), תמריצים, ומוצרים לא פנסיוניים שנמכרו בפגישה</span><Fill label="גילוי נאות" lines={3} /></label>

      <h3>חלק ד – טבלת סיכום</h3>
      <div className="annex-grid">
        <div><h4>מצב קיים</h4><ul className="annex-list">{exist.length ? exist.map((f) => <li key={f.k}>{f.prod} · {f.name} · מס' {f.id}</li>) : <li><Fill label="מצב קיים" inline /></li>}</ul></div>
        <div><h4>מצב חדש</h4><ul className="annex-list">{next.length ? next.map((f) => <li key={f.k}>{f.prod} · {f.name} · מס' {f.id}</li>) : <li><Fill label="מצב חדש" inline /></li>}</ul></div>
      </div>

      <h3>חלק ה – הצהרת הלקוח</h3>
      <p>הלקוח מאשר כי קיבל לידיו את מסמך ההנמקה.</p>
      <div className="annex-sig"><span>תאריך</span><span>חתימת הלקוח</span><span>חתימת בעל הרישיון</span></div>
      <p className="adoc-cap">מקור המבנה: {HNM_SRC.title} ({HNM_SRC.url}). עדכון בתהליך: {HNM_DRAFT.title} ({HNM_DRAFT.url}). מסירה: בסיום הפגישה, ובחתימה ידנית עותק מודפס בתוך 14 ימי עסקים; שמירה 7 שנים לפחות (סעיפים 3, 6 ו-7 לחוזר). לפני מסמך מלא: שאילתה במסלקה הפנסיונית.</p>
    </section>
  );
}
