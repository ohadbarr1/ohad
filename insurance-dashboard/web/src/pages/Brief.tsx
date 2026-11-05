import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Loading } from '../components/ui';
import { Tokens } from '../components/Answer';
import { useRegistry } from '../lib/useData';
import { pubLabel } from '../lib/format';
import { TYPE_SHORT } from '../lib/feed';
import type { Fig, IndexFile } from '../lib/answers';
import { useAnswerIndex } from '../lib/answersLoad';
import {
  buildBrief, CADENCE_HE, daysBetween, demoMeeting, dmy, EVENT_RULE, fragSt, fromTemplate, isDate, localToday, markHeld, mergeMeetings, parseMeetingsFile,
  Q_RULE, TEMPLATES, THREE_RULE, TYPE_ORDER, type Brief as BriefModel, type BriefData, type Cadence, type Flag, type Meeting, type MeetingType,
} from '../lib/brief';
import { useBriefData, useMeetings } from '../lib/briefLoad';
import { briefDoc } from '../lib/briefDoc';
import '../styles/feed.css';
import '../styles/answers.css';
import '../styles/brief.css';

/* S3 · the Briefing Builder. /brief is the meeting registry (add / edit / remove, export / import as a file); /brief/<id> is the one-page
   brief generated for a meeting: since the last meeting · the three numbers · likely questions with answers · lead with this · flag.
   PRIVATE: the registry lives only in this browser (localStorage 'meetings'); nothing about a meeting reaches the site or anyone else.
   /brief/demo renders a built-in demo meeting. Every number is a Sourced figure (Tokens, the Answer Ladder's renderer). */

const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const one = (f: Fig) => <Tokens text="{x}" figs={{ x: f }} />;

/* ---------------------------------------------------------------------------------------------------------- the form */
function Checks({ legend, all, value, onChange }: { legend: string; all: [string, string][]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="br-checks">
      <legend>{legend}</legend>
      {all.map(([k, l]) => (
        <label key={k} className={value.includes(k) ? 'on' : ''}>
          <input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />{l}
        </label>
      ))}
    </fieldset>
  );
}

function MeetingForm({ init, I, onSave, onCancel }: { init: Meeting; I: IndexFile; onSave: (m: Meeting) => void; onCancel: () => void }) {
  const [m, setM] = useState<Meeting>(init);
  const [agenda, setAgenda] = useState(init.agenda.join('\n'));
  const reg = useRegistry();
  const set = <K extends keyof Meeting>(k: K, v: Meeting[K]) => setM((x) => ({ ...x, [k]: v }));
  const preset = (t: MeetingType) => { const p = TEMPLATES[t]; setM((x) => ({ ...x, type: t, name: !x.name || Object.values(TEMPLATES).some((y) => y.he === x.name) ? p.he : x.name, chairs: [...p.chairs], topics: [...p.topics], cadence: p.cadence, n: p.n })); };
  const topics: [string, string][] = Object.entries({ ...I.topics, ...Object.fromEntries(m.topics.filter((t) => !I.topics[t]).map((t) => [t, t === 'channel' ? 'ערוצי הפצה' : t])) });
  const cos: [string, string][] = (reg.data ?? []).map((c) => [c.id, c.name_he]);
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!m.name.trim() || !isDate(m.date)) return;
    onSave({ ...m, name: m.name.trim(), audience: m.audience.trim(), agenda: agenda.split('\n').map((s) => s.trim()).filter(Boolean) });
  };
  return (
    <form className="panel br-form" onSubmit={save} aria-label={init.name ? `עריכת ${init.name}` : 'פגישה חדשה'}>
      <fieldset className="br-types">
        <legend>סוג הפגישה (קובע מושבים, נושאים, מספר שאלות ותדירות; אפשר לשנות אחר כך)</legend>
        {TYPE_ORDER.map((t) => <button key={t} type="button" className="an-btn quiet" aria-pressed={m.type === t} onClick={() => preset(t)} title={TEMPLATES[t].hint}>{TEMPLATES[t].he}</button>)}
      </fieldset>
      <div className="br-row">
        <label className="field br-wide"><span>שם הפגישה</span><input type="text" required value={m.name} maxLength={160} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field"><span>תאריך הפגישה הבאה</span><input type="date" required value={m.date} onChange={(e) => set('date', e.target.value)} /></label>
        <label className="field"><span>תדירות</span>
          <select value={m.cadence} onChange={(e) => set('cadence', e.target.value as Cadence)}>{(Object.keys(CADENCE_HE) as Cadence[]).map((c) => <option key={c} value={c}>{CADENCE_HE[c]}</option>)}</select></label>
        <label className="field br-n"><span>שאלות צפויות</span><input type="number" min={1} max={20} value={m.n ?? TEMPLATES[m.type].n} onChange={(e) => set('n', Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
      </div>
      <div className="br-row">
        <label className="field br-wide"><span>קהל (טקסט חופשי)</span><input type="text" value={m.audience} maxLength={300} onChange={(e) => set('audience', e.target.value)} placeholder="מי יושב בחדר" /></label>
        <label className="field"><span>הפגישה הקודמת (רשות)</span><input type="date" value={m.last ?? ''} onChange={(e) => setM((x) => { const { last: _drop, ...rest } = x; void _drop; return e.target.value ? { ...rest, last: e.target.value } : rest; })} /></label>
      </div>
      <label className="field"><span>סדר יום קבוע (שורה לכל נושא)</span><textarea rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} /></label>
      <Checks legend="מי שואל (מושבים)" all={Object.entries(I.chairs)} value={m.chairs} onChange={(v) => set('chairs', v)} />
      <Checks legend="נושאים במוקד" all={topics} value={m.topics} onChange={(v) => set('topics', v)} />
      {cos.length > 0 ? <Checks legend="חברות במוקד (בלי בחירה: כל הענף)" all={cos} value={m.cos} onChange={(v) => set('cos', v)} /> : <Loading what="רשימת החברות" />}
      <div className="an-tools">
        <button type="submit" className="an-btn" disabled={!m.name.trim() || !isDate(m.date)}>שמירה בדפדפן</button>
        <button type="button" className="an-btn quiet" onClick={onCancel}>ביטול</button>
        <span className="dim">נשמר רק בדפדפן הזה</span>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------------------------------------------- /brief */
export function Brief() {
  const { data: I, error } = useAnswerIndex();
  const [list, setList] = useMeetings();
  const [edit, setEdit] = useState<Meeting | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const today = useMemo(localToday, []);
  const sorted = useMemo(() => [...list].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)), [list]);
  const nav = useNavigate();
  if (error) return <ErrorBox what="אינדקס השאלות" error={error} />;
  if (!I) return <Loading what="התדריכים" />;
  const save = (m: Meeting) => { setList(mergeMeetings(list, [m])); setEdit(null); nav(`/brief/${encodeURIComponent(m.id)}`); };
  const remove = (m: Meeting) => { if (window.confirm(`להסיר את "${m.name}" מהדפדפן הזה?`)) setList(list.filter((x) => x.id !== m.id)); };
  const exportFile = () => {
    const blob = new Blob([JSON.stringify({ v: 1, kind: 'meetings', exported: new Date().toISOString(), meetings: list }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `meetings-${pubLabel(today)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const importFile = (f: File | undefined) => {
    if (!f) return;
    void f.text().then((t) => {
      const got = parseMeetingsFile(t);
      if (!got) { setMsg('הקובץ אינו קובץ פגישות'); return; }
      setList(mergeMeetings(list, got));
      setMsg(`נטענו ${got.length} פגישות`);
    });
    if (file.current) file.current.value = '';
  };
  return (
    <div className="qi br">
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="calendar" /></span>תדריכים</h1>
        <div className="sub"><span>פגישה קבועה ← תדריך של עמוד אחד, מוכן לפני כל פגישה</span><span>·</span><span className="chip">פרטי לדפדפן הזה</span><span>·</span><Link to="/brief/demo">תדריך לדוגמה</Link></div></div></div>
      <p className="qi-priv">רשימת הפגישות (שמות, קהל, סדר יום, מוקד) נשמרת רק בדפדפן הזה (localStorage): לא נשלחת לשום מקום ולא מגיעה לאתר. ייצוא לקובץ שומר עותק אצלך; ייבוא מחזיר אותו, גם בדפדפן אחר.</p>

      {edit ? <MeetingForm key={edit.id} init={edit} I={I} onSave={save} onCancel={() => setEdit(null)} />
        : <div className="an-tools"><button type="button" className="an-btn" onClick={() => setEdit(fromTemplate('exec', today, newId()))}>+ פגישה חדשה</button></div>}

      {!sorted.length ? <Empty title="אין עדיין פגישות בדפדפן הזה" icon="calendar">מוסיפים פגישה קבועה (פורום הנהלה, דירקטוריון, הכנה לדוחות...) ומקבלים תדריך. <Link to="/brief/demo">לתדריך לדוגמה</Link></Empty>
        : <ol className="qi-list br-list" aria-label={`${sorted.length} פגישות`}>{sorted.map((m) => {
          const dd = daysBetween(today, m.date);
          return (
            <li key={m.id} className="qi-row">
              <div className="qi-q"><Link to={`/brief/${encodeURIComponent(m.id)}`}>{m.name}</Link></div>
              <div className="qi-meta">
                <span><span className="num">{dmy(m.date)}</span>{dd >= 0 ? <> · בעוד <span className="num">{dd}</span> ימים</> : <> · עברה</>}</span>
                <span>{TEMPLATES[m.type].he}</span><span>{CADENCE_HE[m.cadence]}</span>
                {m.audience && <span className="qi-ch">{m.audience}</span>}
                {m.last && <span>הקודמת: <span className="num">{dmy(m.last)}</span></span>}
              </div>
              <div className="an-tools">
                <Link className="an-btn" to={`/brief/${encodeURIComponent(m.id)}`}>לתדריך</Link>
                <button type="button" className="an-btn quiet" onClick={() => setEdit(m)} aria-label={`עריכת ${m.name}`}>עריכה</button>
                <button type="button" className="an-btn quiet" onClick={() => remove(m)} aria-label={`הסרת ${m.name}`}>הסרה</button>
              </div>
            </li>
          );
        })}</ol>}

      <div className="an-tools">
        <button type="button" className="an-btn" onClick={exportFile} disabled={!list.length}>ייצוא לקובץ JSON</button>
        <label className="an-btn br-import">ייבוא מקובץ<input ref={file} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => importFile(e.target.files?.[0])} /></label>
        {msg && <span className="dim" role="status">{msg}</span>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------- /brief/<id> */
function Sec({ id, title, rule, children }: { id: string; title: ReactNode; rule?: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <section className="panel br-sec" aria-labelledby={`br-${id}`}>
      <div className="br-hd">
        <h2 id={`br-${id}`} className="an-h">{title}</h2>
        {rule && <button type="button" className="br-rule" title={rule} aria-label="הכלל של הסעיף" aria-expanded={show} aria-controls={`br-${id}-rule`} onClick={() => setShow(!show)}>ⓘ</button>}
      </div>
      {rule && show && <p id={`br-${id}-rule`} className="br-sub br-why">{rule}</p>}
      {children}
    </section>
  );
}
const none = (t: ReactNode) => <p className="br-none">{t}</p>;

function FlagLine({ fl, name }: { fl: Flag; name: (c: string) => string }) {
  switch (fl.k) {
    case 'tripped': return <li className="br-flag warn"><span className="an-st tripped">סף נחצה</span> <Link to={`/questions/${fl.row.id}`}>{fl.row.q}</Link> {fl.row.cs && fl.row.cf && <Tokens text={fl.row.cs} figs={fl.row.cf} />}</li>;
    case 'frag': return <li className={`br-flag ${fl.st === 'alert' ? 'warn' : ''}`}><span className={`chip fd-t fs-${fl.st}`}>{fragSt(fl.st)}</span> <Link to={fl.to}>{name(fl.c)}: {fl.sigHe}</Link>{fl.fig && <> · {one(fl.fig)}{fl.fig.asof && <span className="dim"> · <span className="num">{fl.fig.asof}</span></span>}</>}</li>;
    case 'saydo': return <li className="br-flag"><span className="chip">אמירה–עשייה</span> <Tokens text={fl.f.corr} figs={fl.f.figs} /> <Link to={`/findings?f=${fl.f.id}`}>לממצא</Link></li>;
    case 'target': return <li className="br-flag warn"><span className="chip">{fl.e.st === 'missed' ? 'יעד הוחמץ' : 'יעד הושג חלקית'}</span> <Link to={fl.e.to}>{name(fl.e.c)}: {fl.e.h}</Link>{fl.fig && <> · בפועל {one(fl.fig)}</>} <span className="dim num">{dmy(fl.e.d)}</span></li>;
    case 'report': return <li className="br-flag"><span className="chip">דוח צפוי</span> <Link to="/calendar">{fl.name}: {fl.period}</Link> · <span className="num">{dmy(fl.expected)}</span>{fl.lo && fl.hi && fl.lo !== fl.hi && <span className="dim"> (טווח <span className="num">{dmy(fl.lo)}–{dmy(fl.hi)}</span>)</span>} · {fl.before ? 'לפני הפגישה' : 'עד הפגישה הבאה'}</li>;
  }
}

function BriefBody({ b, d }: { b: BriefModel; d: BriefData }) {
  const name = (c: string) => d.names[c] ?? d.feed?.cos[c] ?? c;
  const m = b.m;
  return (
    <>
      <Sec id="since" title={<>מאז הפגישה הקודמת <span className="dim">(<span className="num">{b.days}</span> ימים)</span></>} rule={EVENT_RULE}>
        <p className="br-sub">{b.sinceIsLast ? 'מהפגישה הקודמת' : `אין פגישה קודמת רשומה: ${b.days} הימים האחרונים לפי התדירות`}, <span className="num">{dmy(b.since)}</span>–<span className="num">{dmy(b.today)}</span>{m.cos.length ? <>, על {m.cos.map(name).join(', ')}</> : ', כל הענף לפי הנושאים'}</p>
        {b.feedMissing ? none('יומן האירועים לא נטען, אין אירועים להציג.')
          : !b.events.length ? none('לא היה אירוע על החברות או הנושאים שבמוקד בתקופה הזו.')
          : <ul className="br-ev">{b.events.map((x) => (
            <li key={x.e.id} className={x.focus ? 'focus' : ''}>
              <span className="num dim br-d">{pubLabel(x.e.d)}</span>
              <span className={`chip fd-t t-${x.e.t}${x.e.st ? ` st-${x.e.st}` : ''}${x.e.fs ? ` fs-${x.e.fs}` : ''}`}>{TYPE_SHORT[x.e.t]}{x.e.fs ? ` · ${fragSt(x.e.fs)}` : ''}</span>
              <span className="br-co">{name(x.e.c)}</span>
              <Link to={x.e.to}>{x.e.h}</Link>
              {x.fig && <span className="br-fig">{one(x.fig)}{x.dfig && <span className="dim"> (שינוי {one(x.dfig)})</span>}</span>}
            </li>))}</ul>}
        {b.eventsMore > 0 && <p className="br-sub">ועוד <span className="num">{b.eventsMore}</span> אירועים פחות מהותיים · <Link to="/feed">ליומן המלא</Link></p>}
        <h3 className="br-h3">תשובות שהשתנו</h3>
        {b.watch === 'absent' ? none('מעקב שינויי התשובות עדיין לא פורסם בבנייה הזו: אין השוואה של תשובות בין בניות.')
          : !b.changes.length ? none('אף תשובה על החברות או הנושאים שבמוקד לא השתנתה בתקופה.')
          : <ul className="br-ev">{b.changes.map(({ c, row }) => (
            <li key={`${c.id}${c.d}`}>
              <span className="num dim br-d">{pubLabel(c.d)}</span>
              <span className="chip">{c.kind === 'tripped' ? 'סף נחצה' : c.kind === 'finding' ? 'ממצא' : 'תשובה'}</span>
              <Link to={c.kind === 'finding' ? `/findings?f=${c.id}` : `/questions/${c.id}`}>{row?.q ?? c.id}</Link>
              {row?.cs && row.cf ? <span className="br-now">עכשיו: <Tokens text={row.cs} figs={row.cf} /></span> : null}
            </li>))}</ul>}
      </Sec>

      <Sec id="three" title="שלושת המספרים" rule={THREE_RULE}>
        {!b.three.length ? none(b.indexMissing ? 'אינדקס השאלות לא נטען, אין מספרים לבחור.' : 'אין שאלה עם תשובה שמתאימה למוקד הפגישה.')
          : <ol className="br-three">{b.three.map((x) => (
            <li key={x.row.id + x.id}>
              <span className="br-big">{one(x.f)}</span>
              <span className="br-l">{x.f.l}</span>
              <span className="dim">נכון ל-<span className="num">{x.f.asof}</span> · <Link to={`/questions/${x.row.id}`}>{x.row.id}</Link></span>
            </li>))}</ol>}
      </Sec>

      <Sec id="qs" title="שאלות צפויות, עם תשובות" rule={Q_RULE}>
        {!b.questions.length ? none(b.indexMissing ? 'אינדקס השאלות לא נטען.' : 'אין שאלה באינדקס שמתאימה למושבים, לנושאים ולחברות של הפגישה.')
          : <>
            <ol className="qi-list br-qs">{b.questions.map((q) => (
              <li key={q.row.id} className={`qi-row${q.row.chg === 'tripped' ? ' tripped' : ''}`}>
                <div className="qi-q"><span className="qi-id mono">{q.row.id}</span><Link to={`/questions/${q.row.id}`}>{q.row.q}</Link></div>
                <p className="qi-a">{q.row.cs && q.row.cf && <Tokens text={q.row.cs} figs={q.row.cf} />}</p>
                <div className="qi-meta">
                  {q.row.asof && <span>נכון ל-<span className="num">{q.row.asof}</span></span>}
                  {q.why.length > 0 && <span className="qi-ch">{q.why.join(' · ')}</span>}
                  {q.row.chg === 'tripped' && <span className="an-st tripped">הסף נחצה: התשובה משתנה</span>}
                  {q.changed && <span>השתנתה ב-<span className="num">{dmy(q.changed)}</span></span>}
                  <Link to={`/questions/${q.row.id}?r=email`}>למייל ולמוצג</Link>
                </div>
              </li>))}</ol>
            <p className="br-sub"><span className="num">{b.qPool}</span> שאלות מתאימות למוקד, <span className="num">{b.questions.length}</span> מוצגות</p>
          </>}
      </Sec>

      <Sec id="lead" title="לפתוח עם זה">
        {!b.lead ? none(b.findingsMissing ? 'מנוע הממצאים לא פרסם קובץ בבנייה הזו.' : 'אין ממצא עם תשובה בבנייה הזו.')
          : <>
            {b.lead.scope === 'industry' && m.cos.length > 0 && <p className="br-sub">אין ממצא על החברות שבמוקד; הממצא המוביל בענף:</p>}
            <p className="an-corr br-lead"><Tokens text={b.lead.f.corr} figs={b.lead.f.figs} /></p>
            <p className="br-sub">מהותיות <b className="num">{b.lead.f.mat?.t ?? '–'}</b> · הפתעה <b className="num">{b.lead.f.sur?.t ?? '–'}</b>{b.lead.f.asof && <> · נכון ל-<span className="num">{b.lead.f.asof}</span></>} · <Link to={`/findings?f=${b.lead.f.id}`}>לממצא המלא</Link></p>
          </>}
      </Sec>

      <Sec id="flag" title="דגל" rule="מה שאף אחד עוד לא העלה: שאלה של הפגישה שהסף שלה נחצה, אות שבריריות במעקב או בהתראה על חברה שבמוקד (בלי מוקד: התראות בלבד), פער אמירה–עשייה (גלאי הממצאים ויעד שהוחמץ או הושג חלקית), ודוח שצפוי להתפרסם עד הפגישה הבאה">
        {!b.flags.length ? none('אין דגל: אף סף לא נחצה, אין אות שבריריות על החברות שבמוקד, אין פער אמירה–עשייה ואין דוח צפוי בחלון הפגישה.')
          : <ul className="br-flags">{b.flags.map((fl, i) => <FlagLine key={i} fl={fl} name={name} />)}</ul>}
      </Sec>
    </>
  );
}

export function BriefPage() {
  const { id = '' } = useParams();
  const [list, setList] = useMeetings();
  const today = useMemo(localToday, []);
  const demo = id === 'demo';
  const demoM = useMemo(() => demoMeeting(today), [today]);
  const m = demo ? demoM : list.find((x) => x.id === id) ?? null;
  const { data, ready } = useBriefData(!!m);
  const b = useMemo(() => (m && ready ? buildBrief(m, data) : null), [m, ready, data]);
  const [busy, setBusy] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const back = <Link className="qi-back" to="/brief">← כל התדריכים</Link>;
  if (!m) return <div className="qi br">{back}<Empty title="הפגישה אינה בדפדפן הזה" icon="calendar">רשימת הפגישות נשמרת רק בדפדפן שבו נוצרה. אפשר לייבא אותה מקובץ ב<Link to="/brief">דף התדריכים</Link>, או לפתוח את <Link to="/brief/demo">התדריך לדוגמה</Link>.</Empty></div>;
  if (!b) return <div className="qi br">{back}<Loading what="התדריך" /></div>;
  const held = () => setList(list.map((x) => (x.id === m.id ? markHeld(x) : x)));
  const exp = async (fmt: 'pptx' | 'docx' | 'pdf') => {
    setBusy(fmt);
    try {
      const { exportDoc } = await import('../lib/deliver');
      await exportDoc(briefDoc(m, data, { asof: data.index?.rows.find((r) => r.asof)?.asof ?? undefined }), fmt);
    } catch (e) { setErr(e instanceof Error ? e.message : 'הייצוא נכשל'); setTimeout(() => setErr(null), 3000); }
    setBusy(null);
  };
  return (
    <div className="qi br brp">
      {back}
      <div className="pagehead"><div>
        <span className="eyebrow">{TEMPLATES[m.type].he} · {CADENCE_HE[m.cadence]}{demo && ' · דוגמה'}</span>
        <h1 className="qp-h1">{m.name}</h1>
        <div className="sub"><span className="num">{dmy(m.date)}</span>{m.audience && <><span>·</span><span>{m.audience}</span></>}{m.last && <><span>·</span><span>הקודמת: <span className="num">{dmy(m.last)}</span></span></>}</div>
      </div></div>
      {m.agenda.length > 0 && <div className="br-agenda"><b>סדר היום הקבוע:</b><ul>{m.agenda.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
      <div className="an-tools br-tools">
        {!demo && <button type="button" className="an-btn" onClick={held} title={`הפגישה הקודמת תהיה ${dmy(m.date)}; התאריך הבא לפי התדירות`}>סימון כהתקיימה</button>}
        {(['pptx', 'docx', 'pdf'] as const).map((f) => <button key={f} type="button" className="an-btn quiet" disabled={!!busy} onClick={() => void exp(f)}>{busy === f ? '…' : f.toUpperCase()}</button>)}
        <span className="dim" role="status">{err ?? ''}</span>
        <span className="dim">כל מספר נפתח במקור · בלי שם האתר במסמך</span>
      </div>
      <BriefBody b={b} d={data} />
      <p className="src">כל מספר מחושב מהקבצים שהאתר מפרסם ונפתח במקור שלו · הפגישה עצמה פרטית לדפדפן הזה</p>
    </div>
  );
}
