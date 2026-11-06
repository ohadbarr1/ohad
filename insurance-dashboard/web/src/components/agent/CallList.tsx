import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../Icon';
import { Ico } from '../home/glyphs';
import { copyText } from '../ui';
import { load, useFunds } from '../../lib/useData';
import { useOptional } from '../../lib/fundsLoad';
import type { FundX, FundsFile } from '../../lib/funds';
import type { DefaultFile } from '../../lib/fundsTools';
import { DECISION_PATH, type DecisionFile } from '../../lib/decision';
import type { FeesFile } from '../../lib/flows';
import { pickSet, slugOf, type RankFile, type StatsIndex } from '../../lib/fundsTime';
import { upsert, useClients } from '../../lib/clients';
import { CALLS_KEY, CALLS_SUM_KEY, REVIEW_KEY, TRIG_HE, callList, type Trigger, callMsg, isFreshMonth, markHandled, my, normCalls, rankCats, reviewMsg, reviewsDue, rollCalls, signOff, waLink, ymShort, type RankSeries } from '../../lib/agentDesk';
import { useBranding } from '../../lib/branding';
import { useStored, writeStored } from '../../lib/local';
import { today } from '../../lib/visits';
import '../../styles/agentDesk.css';

/* fox 3.0 phase 2 · A4 "למי להתקשר החודש" and A5 "סקירות שנתיות" on /clients (agent door). Pure in-browser: the folders of this
   browser against files the site already publishes (funds.json, flows/fees.json, funds/default.json, funds/decision.json, and the
   rank file of each category a client holds); lib/agentDesk does the arithmetic. The draft messages carry no name, balance or ID. */

/** a draft message: the text, copy, the system share sheet when there is one, and a WhatsApp link */
export function MsgBox({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <div className="msgbox">
      <pre className="msg" aria-label={label}>{text}</pre>
      <div className="msg-acts">
        <button type="button" className="chip" onClick={() => copyText(text, (v) => setOk(v ? 'הועתק' : 'ההעתקה נכשלה'))}><Icon name="statement" /> העתקה</button>
        {canShare && <button type="button" className="chip" onClick={() => { navigator.share({ text }).catch(() => undefined); }}><Icon name="download" /> שיתוף</button>}
        <a className="chip" href={waLink(text)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        {ok && <span role="status" className="csave-msg">{ok}</span>}
      </div>
    </div>
  );
}

/** the rank files of the held tracks' categories (funds/stats/index.json → funds/rank/<slug>.json), as y12-net series by track */
function useRanks(cats: string[], keys: string[]): { ranks: Record<string, RankSeries> | null; done: boolean } {
  const idx = useOptional<StatsIndex>('funds/stats/index.json');
  const [files, setFiles] = useState<Record<string, RankFile | null>>({});
  const sig = cats.join('|');
  useEffect(() => {
    if (!idx) return;
    let on = true;
    const want = cats.map((c) => ({ c, row: slugOf(idx, c) })).filter((x) => x.row && x.row.rank !== false && !(x.c in files));
    if (!want.length) return;
    void Promise.all(want.map((x) => load<RankFile>(`funds/rank/${x.row!.slug}.json`).then((r) => [x.c, r] as const, () => [x.c, null] as const)))
      .then((got) => { if (on) setFiles((f) => ({ ...f, ...Object.fromEntries(got) })); });
    return () => { on = false; };
  }, [idx, sig]);  // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    if (idx === undefined) return { ranks: null, done: false };
    const out: Record<string, RankSeries> = {};
    for (const [c, r] of Object.entries(files)) {
      const s = r ? pickSet(r, 'y12', 'net') : null;
      if (!r || !s) continue;
      for (const k of keys) if (s.tracks[k]) out[k] = { cat: c, months: r.months, v: s.tracks[k], n: s.n };
    }
    const done = !idx || cats.every((c) => c in files || !slugOf(idx, c) || slugOf(idx, c)!.rank === false);
    return { ranks: out, done };
  }, [files, keys.join(), idx, sig]);  // eslint-disable-line react-hooks/exhaustive-deps
}

export function CallList() {
  const [file] = useClients();
  const data = useFunds().data as FundsFile | undefined;
  const funds = useMemo(() => (data?.funds ?? []) as FundX[], [data]);
  const fees = useOptional<FeesFile>('flows/fees.json');
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dec = useOptional<DecisionFile>(DECISION_PATH);
  const [brand] = useBranding();
  const [raw, setRaw] = useStored<unknown>(CALLS_KEY, null);
  const calls = normCalls(raw);
  const [showDone, setShowDone] = useState(false);
  // red team 06.11.26: every folder with savings products from the file (the client-level lines need no matched track)
  const withHeld = file.folders.filter((f) => f.held.some((h) => !h.risk && (h.k || h.balance != null)));
  const cats = useMemo(() => (funds.length ? rankCats(withHeld, funds) : []), [withHeld.map((f) => f.id + f.updated).join(), funds]);  // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useMemo(() => [...new Set(withHeld.flatMap((f) => f.held.map((h) => h.k).filter((k): k is string => !!k)))], [withHeld.map((f) => f.id + f.updated).join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const { ranks, done } = useRanks(cats, keys);
  const asof = data?.asof ?? null;
  // a new data month moves the agent's look forward (the handled marks stay: their keys name the data)
  useEffect(() => { if (asof && calls.month !== asof && (calls.month == null || asof > calls.month)) setRaw(rollCalls(calls, asof, today())); }, [asof, calls.month]);  // eslint-disable-line react-hooks/exhaustive-deps
  const ready = !!data && fees !== undefined && dfile !== undefined && dec !== undefined && done;
  const rows = useMemo(() => (ready && asof ? callList({ folders: withHeld, funds, asof, today: today(), ranks, fees, dfile, dec }) : []),
    [ready, asof, withHeld.map((f) => f.id + f.updated).join(), funds, ranks, fees, dfile, dec]);  // eslint-disable-line react-hooks/exhaustive-deps
  const open = rows.map((r) => ({ ...r, open: r.triggers.filter((t) => !calls.handled[t.key]) }));
  const nOpen = open.filter((r) => r.open.length).length, nTrig = open.reduce((t, r) => t + r.open.length, 0);
  const nMoney = open.reduce((t, r) => t + r.open.filter((x) => x.level === 'client').length, 0);
  // the agent's home reads this summary (components/home/ClientsPanel) without loading the data again
  useEffect(() => { if (ready && asof) writeStored(CALLS_SUM_KEY, { asof, clients: nOpen, open: nTrig, at: today() }); }, [ready, asof, nOpen, nTrig]);
  const fresh = asof != null && isFreshMonth(calls, asof, today());
  const set = (keys2: string[], on: boolean) => setRaw(markHandled(calls, keys2, today(), on));
  const sign = signOff(brand);
  const shown = open.filter((r) => showDone || r.open.length);

  return (
    <section className="panel calls" id="calls" aria-labelledby="calls-h">
      <div className="hd">
        <h2 id="calls-h"><span className="icotile"><Ico name="clients" /></span>למי להתקשר החודש</h2>
        <div className="aside">{asof ? <span className={`calls-month${fresh ? ' fresh' : ''}`}>{fresh ? 'חודש חדש · ' : ''}נתוני {ymShort(asof)}{calls.prev && calls.month === asof ? ` · הקודם שנבדק: ${ymShort(calls.prev)}` : ''}</span> : null}</div>
      </div>
      {!withHeld.length ? <p className="calls-empty">כשיש תיקים עם קובץ מסלקה, כאן מופיעה רשימת הלקוחות שכדאי להתקשר אליהם: קודם מה שבקובץ שלהם (דמי ניהול מעל מחיר המכרז או החציון, חשבונות מאותו סוג לאיחוד, מקדם קצבה מובטח), ומתחת נתוני שוק על המסלולים שלהם. <Link className="sv-u" to="/clients/new">לקוח חדש מקובץ מסלקה</Link></p>
        : !ready ? <p className="calls-empty" aria-busy="true">בודק את {withHeld.length} התיקים מול נתוני החודש…</p>
        : <>
          <p className="calls-sum" role="status">{nOpen ? <><b>{nOpen === 1 ? 'לקוח אחד' : `${nOpen} לקוחות`}</b> עם {nTrig === 1 ? 'נושא פתוח אחד' : `${nTrig} נושאים פתוחים`}{nMoney ? ` (${nMoney} מהקובץ של הלקוח: דמי ניהול, איחוד, מקדם)` : ''}, מתוך {withHeld.length} תיקים עם קובץ מסלקה.</> : <><Icon name="check" /> אין נושא פתוח החודש ב-{withHeld.length} התיקים.</>}
            {rows.length > nOpen && <> <button type="button" className="chip" aria-pressed={showDone} onClick={() => setShowDone(!showDone)}>{showDone ? 'הסתרת מה שטופל' : `הצגת מה שטופל (${rows.length - nOpen})`}</button></>}</p>
          {shown.length > 0 && <ul className="calls-l">{shown.map((r) => (
            <li key={r.folder} className={`call${r.open.length ? '' : ' handled'}`}>
              <div className="call-h"><b>{r.label}</b><span className="call-n">{r.open.length ? `${r.open.length} פתוחים` : 'טופל'}</span>
                {r.open.length > 0 && <button type="button" className="chip" onClick={() => set(r.open.map((t) => t.key), true)}><Icon name="check" /> סימון הכול כטופל</button>}</div>
              {(() => { const cl = r.triggers.filter((t) => t.level === 'client'), mk = r.triggers.filter((t) => t.level === 'market');
                const item = (t: Trigger) => { const h = !!calls.handled[t.key]; return (
                  <li key={t.key} className={h ? 'done' : undefined}>
                    <label className="call-chk"><input type="checkbox" checked={h} onChange={(e) => set([t.key], e.target.checked)} /><span className="sr-only">טופל: {t.title}</span></label>
                    <div>
                      <span className={`trig trig-${t.id}`}>{TRIG_HE[t.id]}</span> <b>{t.title}</b>
                      <span className="call-what">{t.what}</span>
                      <span className="call-d">{t.detail}</span>
                      <span className="src">מקור: {t.src}</span>
                    </div>
                  </li>); };
                return <>
                  {cl.length > 0 && <ul className="call-t">{cl.map(item)}</ul>}
                  {mk.length > 0 && <details className="call-mkt" open={!cl.length}><summary>נתוני שוק על המסלולים של הלקוח ({mk.length})</summary><ul className="call-t">{mk.map(item)}</ul></details>}
                </>; })()}
              {r.open.length > 0 && <details className="call-msg"><summary>טיוטת הודעה ללקוח</summary><MsgBox text={callMsg(r.open.some((t) => t.level === 'client') ? r.open.filter((t) => t.level === 'client') : r.open, asof!, sign)} label={`טיוטת הודעה: ${r.label}`} /></details>}
            </li>))}</ul>}
          <p className="fnote">קודם השורות מקובץ המסלקה של הלקוח מול נתון שפורסם (מחיר המכרז, חציון הקטגוריה); אחריהן נתוני שוק על המסלול. כל שורה מתארת נתון, לא המלצה. "טופל" נשמר בדפדפן הזה, וחוזר רק כשהנתון עצמו משתנה (רבעון חדש, חודש חדש של דמי ניהול, הליך חדש). ההודעה אינה כוללת שם, יתרה או מספר זהות, ולכן אפשר לשלוח אותה בקישור. דמי ניהול: הממוצע בפועל של המסלול, לא בהכרח של הלקוח.</p>
        </>}
    </section>
  );
}

/** A5 · the annual reviews due this month, one branded document each (the client document in review mode), with a draft message */
export function Reviews() {
  const [file, setFile] = useClients();
  const data = useFunds().data as FundsFile | undefined;
  const [brand] = useBranding();
  const nav = useNavigate();
  const due = reviewsDue(file.folders, today());
  if (!due.length) return null;
  const queue = due.map((d) => d.folder.id);
  const openDoc = (id: string) => { const f = file.folders.find((x) => x.id === id); if (f) nav(`/funds/compare/print?k=${f.keys.join(',')}&b=${f.b}`, { state: { folder: f.id, mode: 'review', queue } }); };
  const mark = (id: string) => { const f = file.folders.find((x) => x.id === id); if (f) setFile(upsert(file, { id: f.id, label: f.label, keys: f.keys, fields: { ...f.fields, [REVIEW_KEY]: today() } }, today()).file); };
  const sign = signOff(brand);
  return (
    <section className="panel revs" aria-labelledby="revs-h">
      <div className="hd"><h2 id="revs-h"><span className="icotile"><Icon name="calendar" /></span>{due.length === 1 ? 'לקוח אחד לסקירה החודש' : `${due.length} לקוחות לסקירה החודש`}</h2>
        <div className="aside"><button type="button" className="cmp-doc" onClick={() => openDoc(queue[0])}><Icon name="statement" />כל המסמכים ברצף</button></div></div>
      <ul className="revs-l">{due.map((d) => (
        <li key={d.folder.id} className={d.late ? 'late' : undefined}>
          <div className="rev-h"><b>{d.folder.label}</b><span>{d.by === 'meet' ? 'פגישה' : 'ייבוא'}: {my(d.anchor)}{d.late ? ' · באיחור' : ''}{d.last ? ` · סקירה קודמת: ${my(d.last)}` : ''}</span></div>
          <div className="rev-acts">
            <button type="button" className="chip" onClick={() => openDoc(d.folder.id)}><Icon name="statement" /> מסמך סקירה (PDF)</button>
            <button type="button" className="chip" onClick={() => mark(d.folder.id)}><Icon name="check" /> סומן: נשלח</button>
          </div>
          {data && <details className="call-msg"><summary>טיוטת הודעה</summary><MsgBox text={reviewMsg(d, data.asof, sign)} label={`טיוטת הודעה: ${d.folder.label}`} /></details>}
        </li>))}</ul>
      <p className="fnote">לפי תאריך הפגישה שנשמר באשף, ואם אין, לפי תאריך הייבוא; כולל מועדים שעברו בחודשיים האחרונים בלי סקירה. המסמך: המסמך ללקוח על נתוני היום, עם המיתוג שלכם, בלי מסמך ההנמקה (אפשר להוסיף אותו בסרגל המסמך).</p>
    </section>
  );
}

