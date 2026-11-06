import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Ico } from '../components/home/glyphs';
import { useFunds } from '../lib/useData';
import { useHists, useOptional } from '../lib/fundsLoad';
import { ym, type FundsFile, type FundX, type HistX } from '../lib/funds';
import type { DefaultFile } from '../lib/fundsTools';
import { DECISION_PATH, type DecisionFile } from '../lib/decision';
import { COEF_PATH, type CoefFile } from '../lib/coef';
import { upsert, useClients, coverOnly, type Folder } from '../lib/clients';
import { bottomLines, docRow, snapOf } from '../lib/compareDoc';
import { ageOk, nyudTable, pairsOf, type Basis, type NyudPairs } from '../lib/nyud';
import { brandLine, hasBrand, useBranding } from '../lib/branding';
import { useStored } from '../lib/local';
import { today } from '../lib/visits';
import { nf } from '../lib/format';
import * as H from '../lib/hanmaka';
import { F, MAX_CANDS, TIMES_KEY, WIZ_STEPS, candOptions, fmtDur, medianMs, prodsFor, pushTime, whyLines, whyText, wizardKeys, wizardSave } from '../lib/wizard';
import { ClientImport } from '../components/agent/ClientImport';
import { NyudTable } from '../components/agent/NyudTable';
import { NyudPairsPick } from '../components/agent/NyudPairs';
import { BrandPanel } from '../components/agent/BrandPanel';
import { BookSafeLine } from '../components/agent/BookSafe';
import '../styles/agent.css';
import '../styles/agentDoc.css';
import '../styles/agentDesk.css';

/* fox 3.0 phase 2 · A2, /clients/new "לקוח חדש" (agent door): the client's clearing-house file to a הנמקה document in one flow of
   three steps (lib/wizard). 1: the import (components/agent/ClientImport; the agent's home starts it and lands here at step 2). 2: the
   candidate tracks the agent picks, the ניוד before/after (lib/nyud, components/agent/NyudTable) and the sourced "why" lines under each
   pair. 3: the document's settings, then the folder is saved (candidates "מומלץ", a snapshot of the figures, the meeting date) and the
   client document (/funds/compare/print) opens on it and prints. Everything stays in this browser. */

const ils = (v: number | null | undefined) => (v == null ? '–' : `₪${Math.round(v).toLocaleString('en-US')}`);
const pc = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 2)}%`);
interface WizState { folder?: string; step?: number; t0?: number }

export function ClientsNew() {
  const loc = useLocation();
  const nav = useNavigate();
  const st = (loc.state ?? {}) as WizState;
  const [clients, setClients] = useClients();
  const data = useFunds().data as FundsFile | undefined;
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dec = useOptional<DecisionFile>(DECISION_PATH);
  const coefF = useOptional<CoefFile>(COEF_PATH);
  const [brand] = useBranding();
  const [times, setTimes] = useStored<number[]>(TIMES_KEY, []);
  const [folderId, setFolderId] = useState<string | null>(typeof st.folder === 'string' ? st.folder : null);
  const [step, setStep] = useState<number>(typeof st.folder === 'string' ? (st.step === 3 ? 3 : 2) : 1);
  const t0 = useRef<number | null>(typeof st.t0 === 'number' ? st.t0 : null);
  const folder: Folder | null = folderId ? clients.folders.find((f) => f.id === folderId) ?? null : null;
  const funds = useMemo(() => (data?.funds ?? []) as FundX[], [data]);
  const byK = useMemo(() => new Map(funds.map((f) => [f.k, f])), [funds]);

  // step 2 and 3 state, from the folder when it has them
  const [cands, setCands] = useState<string[]>([]);
  const [prod, setProd] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [basis, setBasis] = useState<Basis>('fox');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'' | 'm' | 'f'>('');
  const [kind, setKind] = useState<H.DocKind>('full');
  const [client, setClient] = useState('');
  const [meet, setMeet] = useState(today());
  const [pairs, setPairs] = useState<NyudPairs>({});
  useEffect(() => {
    if (!folder) return;
    setCands(folder.keys.filter((k) => folder.tags[k] === 'מומלץ').slice(0, MAX_CANDS));
    setAge(folder.fields[F.age] ?? ''); setSex(folder.fields[F.sex] === 'm' || folder.fields[F.sex] === 'f' ? folder.fields[F.sex] as 'm' | 'f' : '');
    const k = folder.fields[F.kind]; setKind(k === 'focused' || k === 'summary' ? k : 'full');
    setClient(folder.fields[F.client] ?? ''); setMeet(folder.fields[F.meet] ?? today()); setProd(null); setPairs(pairsOf(folder.fields));
  }, [folder?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  // a step change scrolls to the top and moves focus to the step's heading
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => { head.current?.focus(); window.scrollTo?.({ top: 0 }); }, [step]);

  const prods = useMemo(() => (folder ? prodsFor(folder.held, byK) : []), [folder, byK]);
  const prodNow = prod ?? prods[0] ?? null;
  const opts = useMemo(() => (folder && prodNow && data ? candOptions(funds, prodNow, folder.held, dfile, data.asof, q, 40) : []), [folder, prodNow, data, funds, dfile, q]);
  const plan = folder ? wizardKeys(folder, cands) : { keys: [], tags: {} };
  const { hist, pending } = useHists(step >= 2 ? plan.keys : []);
  // red team 06.11.26: the age comes from the file (lib/maslaka, at import) or is typed; no projection without it
  const ageN = age.trim() ? ageOk(+age) : null;
  const ageFile = folder?.fields[F.ageSrc] === 'file' && folder.fields[F.age] === age.trim();
  const rows = useMemo(() => (data && folder ? plan.keys.map((k) => byK.get(k)).filter((x): x is FundX => !!x).map((x) => docRow(x, { net: true, asof: data.asof, hist: hist[x.k] as HistX | undefined, dfile, dec })) : []),
    [data, folder, plan.keys.join(), byK, hist, dfile, dec]);  // eslint-disable-line react-hooks/exhaustive-deps
  const asofText = data ? ym(data.asof) : '';
  const ny = folder && rows.length ? nyudTable(folder.held, rows, plan.tags, coefF, { basis, age: ageN, sex: sex || null }, asofText, pairs) : null;
  const needAge = !!ny && ny.rows.length > 0 && ageN == null;

  if (!data) return <div className="wiz"><p className="muted" aria-busy="true">טוען את נתוני המסלולים…</p></div>;
  const elapsed = t0.current ? Date.now() - t0.current : null;
  const med = medianMs(times);
  const toggle = (k: string) => setCands(cands.includes(k) ? cands.filter((x) => x !== k) : cands.length >= MAX_CANDS ? cands : [...cands, k]);
  const loose = folder ? folder.held.filter((h) => !h.k || !plan.keys.includes(h.k)) : [];

  const finish = (print: boolean) => {
    if (!folder) return;
    const why: Record<string, string> = {};
    for (const c of cands) { const rs = (ny?.rows ?? []).filter((r) => r.cand.k === c); if (rs.length) why[c] = whyText(rs.flatMap((r) => whyLines(r, r.exist.k ? byK.get(r.exist.k) : null, byK.get(c), dec, asofText))); }
    const ms = t0.current ? Date.now() - t0.current : null;
    const inp = wizardSave(folder, cands, { snap: rows.length ? snapOf(rows, bottomLines(rows, true), today(), data.asof, 'net') : null, kind, client, meet, age: ageN, sex: sex || null, ms, today: today(), why, pairs });
    if (!ageFile) delete inp.fields?.[F.ageSrc];
    const r = upsert(clients, inp, today());
    setClients(r.file);
    if (ms != null) setTimes(pushTime(times, ms));
    nav(`/funds/compare/print?k=${r.folder.keys.join(',')}&b=net`, { state: { folder: r.folder.id, mode: 'wizard', print, t0: t0.current } });
  };

  return (
    <div className="wiz">
      <div className="pagehead"><div>
        <span className="eyebrow">סוכן · לקוח חדש</span>
        <h1><span className="icotile"><Ico name="clients" /></span>מקובץ המסלקה למסמך הנמקה</h1>
        <div className="sub">שלושה צעדים, בדפדפן הזה בלבד. {med != null ? `הזמן החציוני שלכם מהקובץ למסמך: ${fmtDur(med)}.` : ''}</div>
      </div></div>
      <ol className="wiz-steps" aria-label="צעדי האשף">
        {WIZ_STEPS.map((s, i) => <li key={s} className={i + 1 === step ? 'on' : i + 1 < step ? 'done' : undefined} aria-current={i + 1 === step ? 'step' : undefined}>
          <span className="n">{i + 1 < step ? <Icon name="check" /> : i + 1}</span><span>{s}</span></li>)}
      </ol>
      <BookSafeLine />

      {step === 1 && <section className="panel wiz-card" aria-labelledby="wiz-h1">
        <h2 id="wiz-h1" ref={head} tabIndex={-1}>1. קובץ המסלקה של הלקוח</h2>
        <ClientImport funds={funds} startOpen toWizard={false} nextLabel="יצירת תיק והמשך לניוד" onDone={(f, _m, start) => { t0.current = start ?? Date.now(); setFolderId(f.id); setStep(2); }} />
        {clients.folders.some((f) => f.held.length) && <div className="wiz-or">
          <label htmlFor="wiz-old">או המשך עם תיק קיים</label>
          <select id="wiz-old" value="" onChange={(e) => { if (e.target.value) { t0.current = Date.now(); setFolderId(e.target.value); setStep(2); } }}>
            <option value="">בחירת תיק…</option>
            {clients.folders.filter((f) => f.held.length).map((f) => <option key={f.id} value={f.id}>{f.label} ({f.held.length} מוצרים)</option>)}
          </select>
        </div>}
      </section>}

      {step >= 2 && !folder && <section className="panel wiz-card"><p>התיק לא נמצא בדפדפן הזה. <button type="button" className="chip" onClick={() => { setFolderId(null); setStep(1); }}>חזרה לייבוא</button></p></section>}

      {step === 2 && folder && <section className="panel wiz-card" aria-labelledby="wiz-h2">
        <h2 id="wiz-h2" ref={head} tabIndex={-1}>2. ניוד: לפני ואחרי · {folder.label}</h2>
        <div className="wiz-held">
          <h3>המוצרים של הלקוח ({folder.held.length})</h3>
          <ul>{folder.held.map((h, i) => { const x = h.k ? byK.get(h.k) : undefined; return <li key={i}>
            <b>{h.typeHe}</b>{h.provider ? ` · ${h.provider}` : ''} · <span className="num">{ils(h.balance)}</span>
            {x ? <span className="wiz-m ok">{x.name}</span> : <span className="wiz-m">{coverOnly(h) ? 'כיסוי ביטוחי בלבד: בחלק א.2' : 'בלי מסלול באתר: במסמך מהנתונים בקובץ (א.1, חלק ד\')'}</span>}
          </li>; })}</ul>
        </div>
        <div className="wiz-who" role="group" aria-label="פרטי החישוב">
          <label>גיל הלקוח{ageFile ? ' (מקובץ המסלקה)' : ' (חובה)'} <input type="number" inputMode="numeric" min={16} max={80} required aria-required="true" aria-invalid={needAge || undefined} value={age} onChange={(e) => setAge(e.target.value)} placeholder="16–80" /></label>
          <label>מין (לטבלאות המקדמים) <select value={sex} onChange={(e) => setSex(e.target.value as '' | 'm' | 'f')}><option value="">לא צוין</option><option value="m">גבר</option><option value="f">אישה</option></select></label>
          <span className="wiz-note">{ageFile ? 'הגיל חושב מתאריך הלידה בקובץ המסלקה (התאריך עצמו לא נשמר). ' : 'בקובץ לא נמצא תאריך לידה: בלי גיל אין תחזית בשקלים. '}לחישוב בלבד: גיל הפרישה 67, ומקדם הקצבה של הקרן המוצעת לפי התקנון. נשמר בתיק, לא נשלח.</span>
        </div>
        <div className="wiz-pick">
          <h3>מסלולים מוצעים <span className="wiz-cnt">{cands.length} מתוך {MAX_CANDS}</span></h3>
          {cands.length > 0 && <ul className="wiz-chosen">{cands.map((k) => <li key={k}><span>{byK.get(k)?.name ?? k}</span><button type="button" className="chip" onClick={() => toggle(k)} aria-label={`הסרה: ${byK.get(k)?.name ?? k}`}><Icon name="x" /></button></li>)}</ul>}
          {prods.length ? <>
            <div className="wiz-filt">
              <label>מוצר <select value={prodNow ?? ''} onChange={(e) => setProd(e.target.value)}>{prods.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
              <label>חיפוש <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם הגוף או המסלול" /></label>
            </div>
            <ul className="wiz-opts" aria-label="מסלולים לבחירה">{opts.map((o) => { const on = cands.includes(o.k); return <li key={o.k}>
              <button type="button" className={`wiz-opt${on ? ' on' : ''}`} aria-pressed={on} disabled={!on && cands.length >= MAX_CANDS} onClick={() => toggle(o.k)}>
                <span className="t"><b>{o.name}</b>{o.same && <span className="tag">אותו מסלול השקעה</span>}{o.dflt && <span className="tag">ברירת מחדל בתוקף</span>}</span>
                <span className="f">ד"נ <bdi dir="ltr">{pc(o.depfee)} / {pc(o.fee)}</bdi> · נטו 3Y <bdi dir="ltr">{pc(o.a3)}</bdi></span>
              </button></li>; })}</ul>
            <p className="wiz-note">כל המסלולים הפתוחים של המוצר, מסודרים: אותו מסלול השקעה כמו של הלקוח, אחר כך קרנות ברירת מחדל, אחר כך לפי גודל. ד"נ: מהפקדה / מצבירה, הממוצע בפועל ({asofText}); נטו 3Y: ממוצע שנתי. הבחירה של בעל הרישיון.</p>
          </> : <p className="wiz-note">אין בתיק מוצר עם יתרה או הפקדה שאפשר לנייד (למשל: רק כיסויים ביטוחיים). אפשר להמשיך למסמך.</p>}
        </div>
        {ny && cands.length > 0 && <NyudPairsPick slots={ny.slots} rows={ny.rows} pairs={pairs} onPairs={setPairs} />}
        {needAge ? <p className="wiz-warn" role="alert">כדי לחשב את הניוד בשקלים צריך את גיל הלקוח: הזינו אותו למעלה.</p>
        : ny && ny.rows.length > 0 ? <>
          <NyudTable out={ny} basis={basis} onBasis={setBasis} asofText={asofText} />
          <div className="wiz-whys">
            <h3>למה: השורות מתחת לכל זוג, עם המקור</h3>
            {ny.rows.map((r, i) => { const ws = whyLines(r, r.exist.k ? byK.get(r.exist.k) : null, byK.get(r.cand.k), dec, asofText); return (
              <div className="wiz-why" key={i}>
                <h4>{r.existName} <span aria-hidden="true">←</span> {r.cand.name}</h4>
                <ul>{ws.map((w, j) => <li key={j}><span>{w.text}</span><span className="src">מקור: {w.src}</span></li>)}</ul>
              </div>); })}
            <p className="wiz-note">השורות נכנסות כטיוטה לשדה "השיקולים העיקריים" של המסלול המוצע במסמך (רק כשהשדה ריק), ובעל הרישיון עורך אותן. תיאור של נתונים שפורסמו וחישוב על ההנחות שבטבלה, לא המלצה.</p>
          </div>
        </> : cands.length > 0 && ny ? <NyudTable out={ny} basis={basis} onBasis={setBasis} asofText={asofText} /> : null}
        {loose.length > 0 && <p className="wiz-note">במסמך גם {loose.length === 1 ? 'מוצר אחד' : `${loose.length} מוצרים`} מהקובץ בלי מסלול באתר (או שלא נכנס לשמונת המסלולים): {loose.map((h) => `${h.typeHe}${h.provider ? ` · ${h.provider}` : ''}`).join('; ')}.</p>}
        <div className="wiz-acts">
          <button type="button" className="btn primary" onClick={() => setStep(3)} disabled={needAge}>המשך: מסמך ההנמקה <Icon name="statement" /></button>
          <button type="button" className="btn" onClick={() => { setFolderId(null); setStep(1); }}>תיק אחר</button>
          {cands.length === 0 && <span className="wiz-note">לא נבחר מסלול מוצע: המסמך יכלול את המצב הקיים בלבד (מתאים לסיכום שיחה).</span>}
        </div>
      </section>}

      {step === 3 && folder && <section className="panel wiz-card" aria-labelledby="wiz-h3">
        <h2 id="wiz-h3" ref={head} tabIndex={-1}>3. מסמך ההנמקה · {folder.label}</h2>
        <div className="wiz-brand">
          {hasBrand(brand) ? <p><Icon name="check" /> בעל הרישיון במסמך: <b>{brandLine(brand)}</b></p> : <p className="wiz-warn">הפרטים שלכם (שם, רישיון, לוגו) מודפסים בכותרת המסמך ובחתימה. ממלאים פעם אחת, בדפדפן הזה:</p>}
          <BrandPanel />
        </div>
        <div className="wiz-doc">
          <label>סוג המסמך (§4) <select value={kind} onChange={(e) => setKind(e.target.value as H.DocKind)}>{H.DOC_KINDS.map((d) => <option key={d.k} value={d.k}>{d.label} ({d.sec})</option>)}</select></label>
          <label>שם הלקוח במסמך <input value={client} onChange={(e) => setClient(e.target.value)} maxLength={60} placeholder="לא חובה" autoComplete="off" /></label>
          <label>תאריך הפגישה <input type="date" value={meet} onChange={(e) => setMeet(e.target.value)} /></label>
          <p className="wiz-note">{H.DOC_KINDS.find((d) => d.k === kind)!.when}. תאריך הפגישה קובע את מועד הסקירה השנתית בתיקי הלקוחות.</p>
        </div>
        <ul className="wiz-sum">
          <li><b>{folder.held.length}</b> מוצרים מהמסלקה{loose.length ? `, ${loose.length} מהם מהקובץ בלי מסלול באתר` : ''}: כולם בחלק א.1 ובחלק ד' (מצב קיים){folder.held.some((h) => h.covers.length) ? '; הכיסויים בחלק א.2' : ''}</li>
          <li><b>{cands.length}</b> מסלולים מוצעים{cands.length ? `: ${cands.map((k) => byK.get(k)?.name ?? k).join('; ')}` : ''}</li>
          <li>טבלת הניוד: <b>{ny?.rows.length ?? 0}</b> זוגות, {basis === 'fox' ? 'הנחות האתר' : 'הנחות נספח ב\''}{pending > 0 ? ` · טוען היסטוריה (${pending})…` : ''}</li>
          <li>נוסח נספח א' המחייב (חוזר סוכנים ויועצים "מסמך הנמקה – תיקון", 18.07.2018); הסיווג, השדות והצילום נשמרים בתיק בדפדפן הזה</li>
        </ul>
        <div className="wiz-acts">
          <button type="button" className="cmp-doc wiz-go" onClick={() => finish(true)} disabled={pending > 0}><Icon name="download" />שמירה בתיק והפקת PDF</button>
          <button type="button" className="btn" onClick={() => finish(false)} disabled={pending > 0}>שמירה ופתיחת המסמך בלי הדפסה</button>
          <button type="button" className="btn" onClick={() => setStep(2)}>חזרה לניוד</button>
          {elapsed != null && <span className="wiz-clock" role="status">מהקובץ עד כאן: {fmtDur(elapsed)}</span>}
        </div>
        <p className="wiz-note">PDF: בחלון ההדפסה בוחרים "שמירה כ-PDF". המסמך נפתח על התיק; אפשר להשלים בו את השדות לפני ההדפסה. <Link className="sv-u" to="/clients">תיקי לקוחות</Link></p>
      </section>}
    </div>
  );
}
