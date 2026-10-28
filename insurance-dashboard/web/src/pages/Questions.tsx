import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Empty, ErrorBox, Loading, Pick } from '../components/ui';
import { AnswerDetail, Tokens } from '../components/Answer';
import { useStored } from '../lib/local';
import { pubLabel } from '../lib/format';
import { isOk, qScore, RUNGS, topFirst, type Answer, type Finding, type IndexFile, type IndexRow, type Rung } from '../lib/answers';
import { useAnswerIndex, useBodies, useFindings, useNames } from '../lib/answersLoad';
import '../styles/answers.css';

/* S1 · /questions, the Question Index: the standing questions of the industry, filtered by who asks (chair) and topic, with a fast text
   filter; each row carries its corridor answer (every figure opens its source), its as-of and its falsifier when tripped. A question the
   data cannot answer says why. /questions/<id> is one answer on the Answer Ladder (S6). S2 · /findings, the Finding Engine's findings by
   detector, materiality and surprise shown as their two published components (never combined), each on the same ladder.
   "השאלות שלי" is private: kept in this browser only (localStorage), exportable as a file, never sent anywhere. */

const set1 = (sp: URLSearchParams, k: string, v: string) => { const x = new URLSearchParams(sp); if (v) x.set(k, v); else x.delete(k); return x; };
const readRung = (v: string | null): Rung => (RUNGS as readonly string[]).includes(v ?? '') ? (v as Rung) : 'corr';

/** one row of the index: the question, its corridor answer, as-of, chairs, the falsifier when tripped, or the reason there is no answer */
function QRow({ r, a, I }: { r: IndexRow; a?: Answer; I: IndexFile }) {
  const ok = a && isOk(a) ? a : null;
  return (
    <li className={`qi-row st-${r.st}${r.chg === 'tripped' ? ' tripped' : ''}`}>
      <div className="qi-q"><span className="qi-id mono">{r.id}</span><Link to={`/questions/${r.id}`}>{r.q}</Link></div>
      {r.st === 'ok'
        ? <p className="qi-a">{r.cs && r.cf ? <Tokens text={r.cs} figs={r.cf} /> : ok ? <Tokens text={ok.corr} figs={ok.figs} /> : r.corr}</p>
        : <p className="qi-a qi-nd"><span className="an-st nodata">אין תשובה כרגע</span> {r.why}</p>}
      <div className="qi-meta">
        {r.asof && <span>נכון ל-<span className="num">{r.asof}</span></span>}
        <span>{I.topics[r.topic] ?? r.topic}</span>
        <span className="qi-ch">{r.chairs.map((c) => I.chairs[c] ?? c).join(' · ')}</span>
        {r.chg === 'tripped' && <span className="an-st tripped" title={ok?.chg ? undefined : 'הסף שהתשובה תלויה בו נחצה'}>הסף נחצה: התשובה משתנה</span>}
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------------------------------------------------- my questions (private) */
interface MyQ { id: string; text: string; who: string; date: string }
const today = () => new Date().toISOString().slice(0, 10);
function MyQuestions({ I }: { I: IndexFile }) {
  const [list, setList] = useStored<MyQ[]>('myq', []);
  const [text, setText] = useState(''), [who, setWho] = useState(''), [date, setDate] = useState(today());
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setList([{ id: `${Date.now().toString(36)}`, text: text.trim(), who: who.trim(), date }, ...(list ?? [])]);
    setText(''); setWho('');
  };
  const exportFile = () => {
    const blob = new Blob([JSON.stringify({ v: 1, exported: new Date().toISOString(), questions: list ?? [] }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `my-questions-${pubLabel(today())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const n = list?.length ?? 0;
  return (
    <details className="panel qi-mine">
      <summary><h2 className="an-h">השאלות שלי <span className="chip">פרטי לדפדפן הזה</span>{n > 0 && <span className="num dim">{n}</span>}</h2></summary>
      <p className="qi-priv">שאלה שנשאלת ואין לה מקום באינדקס: נשמרת רק בדפדפן הזה (localStorage), לא נשלחת לשום מקום ולא מגיעה לאתר. ייצוא לקובץ שומר עותק אצלך.</p>
      <form className="qi-form" onSubmit={add}>
        <label className="field qi-f-text"><span>השאלה</span><input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="מה נשאלת?" maxLength={400} /></label>
        <label className="field"><span>מי שאל</span><input type="text" value={who} onChange={(e) => setWho(e.target.value)} list="qi-chairs" maxLength={80} /></label>
        <datalist id="qi-chairs">{Object.values(I.chairs).map((c) => <option key={c} value={c} />)}</datalist>
        <label className="field"><span>תאריך</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button type="submit" className="an-btn" disabled={!text.trim()}>שמירה בדפדפן</button>
      </form>
      {n > 0 && <>
        <ul className="qi-mylist">{list!.map((x) => (
          <li key={x.id}><span className="num dim">{pubLabel(x.date)}</span><span className="qi-mytext">{x.text}</span>{x.who && <span className="dim">{x.who}</span>}
            <button type="button" className="an-btn quiet" aria-label={`הסרת השאלה: ${x.text}`} onClick={() => setList(list!.filter((y) => y.id !== x.id))}>הסרה</button></li>
        ))}</ul>
        <div className="an-tools"><button type="button" className="an-btn" onClick={exportFile}>ייצוא לקובץ JSON</button></div>
      </>}
    </details>
  );
}

/* ---------------------------------------------------------------------------------------------------------- the index */
export function Questions() {
  const { data: I, error } = useAnswerIndex();
  const [sp, setSp] = useSearchParams();
  const ch = sp.get('ch') ?? '', tp = sp.get('t') ?? '', q = sp.get('q') ?? '';
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  const set = (k: string, v: string) => setSp((p) => set1(p, k, v), { replace: true });
  const names = useNames();
  const topics = useMemo(() => (I ? Object.keys(I.topics) : null), [I]);
  // the index rows carry their corridor figure (cs / cf): the topic files load only for an index written before that
  const bodies = useBodies(I && I.rows.some((r) => r.st === 'ok' && !r.cf) ? topics : null);
  const rows = useMemo(() => {
    if (!I) return [];
    return I.rows.filter((r) => (!ch || r.chairs.includes(ch)) && (!tp || r.topic === tp))
      .map((r) => ({ r, s: qScore(r, text, names) })).filter((x) => x.s > 0)
      .sort((a, b) => (text.trim() ? b.s - a.s : 0) || a.r.id.localeCompare(b.r.id)).map((x) => x.r);
  }, [I, ch, tp, text, names]);
  if (error) return <ErrorBox what="אינדקס השאלות" error={error} />;
  if (!I) return <Loading what="אינדקס השאלות" />;
  const nOf = (c: string) => I.rows.filter((r) => (!c || r.chairs.includes(c)) && (!tp || r.topic === tp)).length;
  const tripped = I.rows.filter((r) => r.chg === 'tripped').length;
  return (
    <div className="qi">
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="questions" /></span>שאלות</h1>
        <div className="sub"><span><span className="num">{I.n}</span> שאלות</span><span>·</span><span><span className="num">{I.ok}</span> עם תשובה</span>
          {tripped > 0 && <><span>·</span><span><span className="num">{tripped}</span> שהסף שלהן נחצה</span></>}<span>·</span><span>מחושב מחדש בכל בנייה, כל מספר נפתח במקור</span><span>·</span><Link to="/findings">ממצאים</Link></div></div></div>

      <section className="qi-ctl" aria-label="סינון">
        <div className="qi-chairs" role="group" aria-label="מי שואל">
          <button type="button" aria-pressed={!ch} onClick={() => set('ch', '')}>הכול <span className="num">{nOf('')}</span></button>
          {Object.entries(I.chairs).map(([k, l]) => { const n = nOf(k); return <button key={k} type="button" aria-pressed={ch === k} disabled={!n && ch !== k} onClick={() => set('ch', ch === k ? '' : k)}>{l} <span className="num">{n}</span></button>; })}
        </div>
        <div className="qi-row2">
          <label className="qi-search"><span className="sr-only">סינון השאלות</span><Icon name="search" />
            <input type="search" value={text} placeholder="סינון: מילה מהשאלה, חברה, Q-001" onChange={(e) => setText(e.target.value)} onBlur={() => set('q', text.trim())} onKeyDown={(e) => { if (e.key === 'Enter') set('q', text.trim()); }} /></label>
          <Pick label="נושא" cap="נושא" value={tp} onChange={(v) => set('t', v)} options={[['', 'כל הנושאים'], ...Object.entries(I.topics).map(([k, l]) => [k, l] as [string, string])]} />
        </div>
      </section>

      {!rows.length ? <Empty title="אין שאלה שמתאימה לסינון" icon="questions">אפשר לרשום אותה למטה, ב"השאלות שלי", בדפדפן הזה בלבד.</Empty>
        : <ol className="qi-list" aria-label={`${rows.length} שאלות`}>{rows.map((r) => <QRow key={r.id} r={r} a={bodies?.get(r.id)} I={I} />)}</ol>}
      <p className="src">כל תשובה מחושבת מהקבצים שהאתר מפרסם, בכל בנייה מחדש · אין ציון מצרפי · יעד, צפי ואומדן מסומנים ליד כל נתון</p>
      <MyQuestions I={I} />
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------- one question */
export function QuestionPage() {
  const { id = '' } = useParams();
  const { data: I, error } = useAnswerIndex();
  const row = I?.rows.find((r) => r.id === id) ?? null;
  const bodies = useBodies(row ? [row.topic] : null);
  const [sp, setSp] = useSearchParams();
  const rung = readRung(sp.get('r'));
  const onRung = (r: Rung) => setSp((p) => set1(p, 'r', r === 'corr' ? '' : r), { replace: true });
  if (error) return <ErrorBox what="אינדקס השאלות" error={error} />;
  if (!I) return <Loading what="השאלה" />;
  const back = <Link className="qi-back" to="/questions">← כל השאלות</Link>;
  if (!row) return <div className="qi">{back}<Empty title={`השאלה ${id} אינה באינדקס`} icon="questions">ייתכן שהמספר שגוי. <Link to="/questions">לאינדקס השאלות</Link></Empty></div>;
  const a = bodies?.get(row.id);
  const rel = (a && isOk(a) ? a.rel : []).map((x) => I.rows.find((r) => r.id === x)).filter((r): r is IndexRow => !!r).map((r) => ({ id: r.id, q: r.q }));
  return (
    <div className="qi qp">
      {back}
      <div className="pagehead"><div>
        <span className="eyebrow"><span className="mono">{row.id}</span> · {I.topics[row.topic] ?? row.topic}</span>
        <h1 className="qp-h1">{row.q}</h1>
        <div className="sub"><span>שואלים: {row.chairs.map((c) => I.chairs[c] ?? c).join(' · ')}</span>{row.asof && <><span>·</span><span>נכון ל-<span className="num">{row.asof}</span></span></>}
          {row.h && <><span>·</span><span className="dim" title="חתימת התשובה: משתנה כשהפסיקה או המשפט משתנים">גרסה <span className="mono">{row.h}</span></span></>}</div>
      </div></div>
      {row.st !== 'ok' ? <Empty title="אין תשובה כרגע" icon="questions">{row.why}</Empty>
        : !bodies ? <Loading what="התשובה" />
        : !a || !isOk(a) ? <Empty title="התשובה לא נטענה" icon="questions">{a && a.st === 'nodata' ? a.why : `קובץ הנושא ${row.topic} לא נטען`}</Empty>
        : <AnswerDetail b={a} bookKey={`/questions/${row.id}|${a.ex?.title ?? row.id}`} route={`/questions/${row.id}`} rung={rung} onRung={onRung} rel={rel} />}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------- findings */
function FindingItem({ f, det, open, toggle, names }: { f: Finding; det?: string; open: boolean; toggle: () => void; names: Record<string, string> }) {
  const ok = isOk(f) ? f : null;
  return (
    <li className={`fd-row${f.top ? ' fd-lead' : ''}${open ? ' fd-open' : ''}`} id={`f-${f.id}`}>
      <div className="fd-hd">
        <span className="qi-id mono">{f.id}</span>
        {f.top && <span className="fd-top">מוביל</span>}
        {det && <span className="dim">{det}</span>}
        {f.c && <span className="fd-co">{names[f.c] ?? f.c}</span>}
      </div>
      {ok ? <p className="fd-corr"><Tokens text={ok.corr} figs={ok.figs} /></p> : <p className="fd-corr qi-nd">{f.st === 'nodata' ? f.why : ''}</p>}
      <div className="fd-comp" aria-label="רכיבי הדירוג, כל אחד בנפרד">
        <span className="fd-c" title={f.mat?.why}><span className="l">מהותיות</span><b className="num">{f.mat?.t ?? '–'}</b></span>
        <span className="fd-c" title={f.sur?.why}><span className="l">הפתעה</span><b className="num">{f.sur?.t ?? '–'}</b></span>
        {ok && <button type="button" className="an-btn" aria-expanded={open} onClick={toggle}>{open ? 'סגירה' : 'לתשובה המלאה'}</button>}
      </div>
      {open && ok && <div className="fd-body">
        <p className="fd-why">{f.mat?.why && <><b>מהותיות:</b> {f.mat.why}</>}{f.sur?.why && <> · <b>הפתעה:</b> {f.sur.why}</>}</p>
        <AnswerDetail b={ok} bookKey={`/findings?f=${f.id}|${ok.ex?.title ?? f.id}`} route={`/findings?f=${f.id}`} />
      </div>}
    </li>
  );
}

export function Findings() {
  const { data: F, done } = useFindings();
  const [sp, setSp] = useSearchParams();
  const sel = sp.get('f') ?? '';
  const names = useNames();
  const toggle = (id: string) => setSp((p) => set1(p, 'f', sel === id ? '' : id), { replace: true });
  useEffect(() => { if (sel && F) requestAnimationFrame(() => document.getElementById(`f-${sel}`)?.scrollIntoView({ block: 'start' })); }, [F]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    if (!F) return [];
    const by = new Map<string, Finding[]>();
    for (const r of F.rows) by.set(r.det, [...(by.get(r.det) ?? []), r]);
    const order = [...Object.keys(F.dets).filter((d) => by.has(d)), ...[...by.keys()].filter((d) => !F.dets[d])];
    return order.map((d) => ({ d, rows: topFirst(by.get(d)!) }));
  }, [F]);
  if (!done) return <Loading what="הממצאים" />;
  const head = <div className="pagehead"><div><h1><span className="icotile"><Icon name="spark" /></span>ממצאים</h1>
    <div className="sub"><span>הפתעות שהמנוע מצא בבסיס העובדות, בכל בנייה</span><span>·</span><span>מהותיות והפתעה מוצגות כשני רכיבים נפרדים, בלי ציון מצרפי</span><span>·</span><Link to="/questions">שאלות</Link></div></div></div>;
  if (!F) return <div className="qi fd">{head}<Empty title="אין ממצאים בבנייה הזו" icon="spark">מנוע הממצאים לא פרסם קובץ בבנייה הנוכחית. <Link to="/questions">לאינדקס השאלות</Link></Empty></div>;
  const top = topFirst(F.rows).filter((r) => r.top);
  const asof = typeof F.asof === 'string' ? F.asof : Object.values(F.asof).join(' · ');
  return (
    <div className="qi fd">
      {head}
      <p className="fd-rule"><b>סדר:</b> {F.order_rule} · <span className="num">{F.rows.length}</span> ממצאים · נכון ל-<span className="num">{asof}</span></p>
      {top.length > 0 && <section className="panel fd-sec"><h2 className="an-h">המובילים</h2>
        <ol className="fd-list">{top.map((f) => <FindingItem key={f.id} f={f} det={F.dets[f.det]?.he ?? f.det} open={sel === f.id} toggle={() => toggle(f.id)} names={names} />)}</ol></section>}
      {groups.map(({ d, rows }) => (
        <section key={d} className="panel fd-sec" aria-labelledby={`det-${d}`}>
          <div className="hd"><h2 id={`det-${d}`}>{F.dets[d]?.he ?? d} <span className="num dim">{rows.length}</span></h2></div>
          {F.dets[d]?.rule && <p className="fd-dr">{F.dets[d].rule}</p>}
          <ol className="fd-list">{rows.map((f) => <FindingItem key={f.id} f={f} open={sel === f.id && !f.top} toggle={() => toggle(f.id)} names={names} />)}</ol>
        </section>
      ))}
      {(F.skipped?.length ?? 0) > 0 && <details className="panel fd-skip"><summary><h2 className="an-h">מועמדים שנפסלו <span className="num dim">{F.skipped!.length}</span></h2></summary>
        <ul className="an-rel">{F.skipped!.map((s) => <li key={s.id}><span className="mono dim">{s.id}</span> {F.dets[s.det]?.he ?? s.det}{s.c ? ` · ${names[s.c] ?? s.c}` : ''}: {s.why}</li>)}</ul></details>}
    </div>
  );
}
