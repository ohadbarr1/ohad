import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Empty, Loading } from '../components/ui';
import { Tokens } from '../components/Answer';
import { WatchToggle } from '../components/WatchToggle';
import { pubLabel } from '../lib/format';
import { useAnswerIndex, useFindings, useNames } from '../lib/answersLoad';
import type { IndexFile } from '../lib/answers';
import { KIND_HE, SEV_HE, brief, isFinding, matchSub, normSubs, prepQueue, subCount, type PrepItem, type Subs, type WChange, type WSide } from '../lib/watch';
import { todayIso, useMeetings, useSeen, useSubs, useWatch } from '../lib/watchLoad';
import '../styles/answers.css';
import '../styles/watch.css';

/* S10 · /watch, "מה השתנה בתשובות": the morning brief. Since the last look (kept in this browser), what the answers this browser follows
   now say differently (from → to, the corridor sentence, a link to the ladder), the falsifiers that tripped, the new findings; then
   everything else that changed; then the prep queue: the expected reports, the regulator's next month and this browser's meetings, by
   date with the days to go. What is followed, when it was last seen and the meetings live in this browser only (localStorage). */

const whereTo = (c: Pick<WChange, 'id'>) => (isFinding(c.id) ? `/findings?f=${c.id}` : `/questions/${c.id}`);

function SideText({ c, s, I, live }: { c: WChange; s: WSide; I: IndexFile | null; live: boolean }) {
  // the current side as sourced figures when the published index still carries this very answer (same signature); else the text kept
  const row = live && !isFinding(c.id) ? I?.rows.find((r) => r.id === c.id && r.h && r.h === s.h && r.cs && r.cf) : null;
  if (row?.cs && row.cf) return <Tokens text={row.cs} figs={row.cf} />;
  return <>{s.corr ?? '–'}</>;
}

function ChangeRow({ c, I, subs, names, topics }: { c: WChange; I: IndexFile | null; subs: Subs; names: Record<string, string>; topics: Record<string, string> }) {
  const why = matchSub(c, subs);
  const label = c.sev ? SEV_HE[c.sev] : KIND_HE[c.kind];
  const head = c.q ?? I?.rows.find((r) => r.id === c.id)?.q ?? (c.cos[0] ? `ממצא · ${names[c.cos[0]] ?? c.cos[0]}` : 'ממצא');
  const whyText = !why ? null : why.k === 't' ? `נושא: ${topics[why.id] ?? why.id}` : why.k === 'c' ? `חברה: ${names[why.id] ?? why.id}` : 'במעקב';
  return (
    <li className={`wt-row k-${c.kind}${c.sev ? ` s-${c.sev}` : ''}`}>
      <div className="wt-hd">
        <span className="qi-id mono">{c.id}</span>
        <Link to={whereTo(c)}>{head}</Link>
      </div>
      <div className="wt-tags">
        <span className={`wt-tag k-${c.kind}`}>{label}</span>
        {whyText && <span className="wt-tag why">{whyText}</span>}
        <span className="dim">נראה ב-<span className="num">{pubLabel(c.d)}</span></span>
      </div>
      {c.kind !== 'new' && c.from && <p className="wt-side from"><span className="wt-l">קודם, <span className="num">{pubLabel(c.pd)}</span></span><span className="wt-t">{c.from.corr ?? '–'}</span></p>}
      {c.kind !== 'gone' && c.to && <p className="wt-side to"><span className="wt-l">עכשיו</span><span className="wt-t"><SideText c={c} s={c.to} I={I} live /></span></p>}
      {c.kind === 'gone' && <p className="wt-side to"><span className="wt-l">עכשיו</span><span className="wt-t dim">{isFinding(c.id) ? 'הממצא כבר לא עולה בבנייה הזו' : 'השאלה כבר לא באינדקס'}</span></p>}
      {c.kind !== 'gone' && <p className="wt-go"><Link to={whereTo(c)}>{isFinding(c.id) ? 'לממצא בשלוש רמות' : 'לתשובה בשלוש רמות: מסדרון, מייל, מוצג'}</Link></p>}
    </li>
  );
}

function Section({ id, h, sub, cs, ...p }: { id: string; h: string; sub?: string; cs: WChange[]; I: IndexFile | null; subs: Subs; names: Record<string, string>; topics: Record<string, string> }) {
  if (!cs.length) return null;
  return (
    <section className="panel wt-sec" aria-labelledby={`wt-${id}`}>
      <div className="hd"><h2 id={`wt-${id}`}>{h} <span className="num dim">{cs.length}</span></h2></div>
      {sub && <p className="wt-sub">{sub}</p>}
      <ol className="wt-list">{cs.map((c) => <ChangeRow key={`${c.id}|${c.d}`} c={c} {...p} />)}</ol>
    </section>
  );
}

const KIND_UP: Record<PrepItem['kind'], string> = { report: 'דוח', regmonth: 'רשות', qend: 'סוף רבעון', meeting: 'פגישה' };
function daysText(n: number) { return n === 0 ? 'היום' : n === 1 ? 'מחר' : n < 0 ? `לפני ${-n} ימים` : `בעוד ${n} ימים`; }

function Prep({ items, names, meetings }: { items: PrepItem[]; names: Record<string, string>; meetings: number }) {
  return (
    <section className="panel wt-sec" aria-labelledby="wt-prep">
      <div className="hd"><h2 id="wt-prep">לפני הבאים <span className="num dim">{items.length}</span></h2><div className="aside"><Link to="/calendar">לוח הדיווחים</Link></div></div>
      <p className="wt-sub">הדוחות הצפויים, חודש הנתונים הבא של הרשות וסופי רבעון{meetings > 0 ? ', והפגישות שרשמת בדפדפן הזה' : ''}, לפי תאריך. מועד דוח הוא אומדן: חציון ימי הפרסום של אותו דוח בשלוש השנים האחרונות, עם החלון.</p>
      {!items.length ? <p className="dim">אין אירוע צפוי ב-75 הימים הקרובים.</p> : (
        <ol className="wt-prep">{items.map((p) => (
          <li key={p.id} className={`k-${p.kind}`}>
            <span className="wt-when"><b className="num">{pubLabel(p.d)}</b><span className="dim">{daysText(p.days)}</span></span>
            <span className={`wt-tag k-${p.kind}`}>{KIND_UP[p.kind]}</span>
            <span className="wt-what">
              {p.c ? <><Link to={`/company/${p.c}`}>{names[p.c] ?? p.c}</Link> · </> : null}{p.what}
              {p.est && <span className="chip est">אומדן</span>}
              {p.lo && p.hi && p.lo !== p.hi && <span className="dim"> · חלון <span className="num">{pubLabel(p.lo)}–{pubLabel(p.hi)}</span></span>}
              {p.src && p.kind !== 'report' && <span className="wt-src">{p.src}</span>}
            </span>
          </li>
        ))}</ol>
      )}
    </section>
  );
}

/** the private half: topics and companies to follow, the followed questions and findings, export / import of the setup */
function Following({ subs, replace, I, names, findings }: { subs: Subs; replace: (s: Subs) => void; I: IndexFile | null; names: Record<string, string>; findings: Map<string, string> }) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const cos = useMemo(() => Object.entries(names).sort((a, b) => a[1].localeCompare(b[1], 'he')), [names]);
  const exportFile = () => {
    const blob = new Blob([JSON.stringify({ v: 1, kind: 'watch-subscriptions', exported: new Date().toISOString(), subs }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `watch-${pubLabel(todayIso())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const importFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then((t) => {
      const o = JSON.parse(t) as { subs?: unknown };
      const s = normSubs(o.subs ?? o);
      replace(s); setMsg(`נטענו ${subCount(s)} פריטי מעקב`);
    }).catch(() => setMsg('הקובץ לא נקרא: צריך קובץ JSON שיוצא מכאן')).finally(() => { if (file.current) file.current.value = ''; });
  };
  return (
    <details className="panel wt-mine" open={subCount(subs) === 0}>
      <summary><h2 className="an-h">מה במעקב <span className="chip">פרטי לדפדפן הזה</span><span className="num dim">{subCount(subs)}</span></h2></summary>
      <p className="qi-priv">מעקב נשמר רק בדפדפן הזה (localStorage), לא נשלח לשום מקום ולא מגיע לאתר. אפשר לעקוב אחרי שאלה או ממצא (כפתור "עקוב" בעמוד שלהם), אחרי נושא שלם או אחרי חברה.</p>
      {I && <div className="wt-chips" role="group" aria-label="נושאים">
        <span className="wt-l">נושאים</span>{Object.entries(I.topics).map(([k, l]) => <span key={k} className="wt-chip"><span>{l}</span><WatchToggle k="t" id={k} what={`הנושא ${l}`} compact /></span>)}
      </div>}
      <div className="wt-chips" role="group" aria-label="חברות">
        <span className="wt-l">חברות</span>{cos.map(([id, n]) => <span key={id} className="wt-chip"><span>{n}</span><WatchToggle k="c" id={id} what={`החברה ${n}`} compact /></span>)}
      </div>
      {(subs.q.length > 0 || subs.f.length > 0) && <ul className="an-rel wt-followed">
        {subs.q.map((id) => <li key={id}><span className="mono dim">{id}</span> <Link to={`/questions/${id}`}>{I?.rows.find((r) => r.id === id)?.q ?? id}</Link> <WatchToggle k="q" id={id} what={id} compact /></li>)}
        {subs.f.map((id) => <li key={id}><span className="mono dim">{id}</span> <Link to={`/findings?f=${id}`}>{findings.get(id) ?? 'ממצא'}</Link> <WatchToggle k="f" id={id} what={id} compact /></li>)}
      </ul>}
      <div className="an-tools">
        <button type="button" className="an-btn" onClick={exportFile} disabled={!subCount(subs)}>ייצוא המעקב לקובץ JSON</button>
        <label className="an-btn"><input ref={file} type="file" accept="application/json,.json" className="sr-only" onChange={importFile} />טעינת מעקב מקובץ</label>
        {msg && <span className="dim" role="status">{msg}</span>}
      </div>
    </details>
  );
}

export function Watch() {
  const { data: w, done } = useWatch();
  const { data: I } = useAnswerIndex();
  const { data: F } = useFindings();
  const names = useNames();
  const [subs, , replace] = useSubs();
  const [seen, setSeen] = useSeen();
  const meetings = useMeetings();
  // the last look as it was when the page opened: the brief is "since then"; the stored date moves to this build once it has been shown
  const [since] = useState<string | null>(seen);
  useEffect(() => { if (w?.asof && (!seen || w.asof > seen)) setSeen(w.asof); }, [w?.asof]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = useMemo(() => (w ? brief(w, subs, since) : null), [w, subs, since]);
  const prep = useMemo(() => (w ? prepQueue(w.upcoming, meetings, todayIso()) : []), [w, meetings]);
  const fnames = useMemo(() => new Map((F?.rows ?? []).map((r) => [r.id, r.st === 'ok' ? `${names[r.c ?? ''] ?? r.c ?? ''} · ${F?.dets[r.det]?.he ?? r.det}` : r.id])), [F, names]);
  const topics = I?.topics ?? {};
  const head = (
    <div className="pagehead"><div>
      <h1><span className="icotile"><Icon name="inbox" /></span>מה השתנה בתשובות</h1>
      <div className="sub">
        {b && <span>{b.first ? <>מאז הבנייה הקודמת{b.since && <>, <span className="num">{pubLabel(b.since)}</span></>}</> : <>מאז ביקורך הקודם, <span className="num">{pubLabel(b.since)}</span></>}</span>}
        {w && <><span>·</span><span><span className="num">{w.snaps.length}</span> תמונות מצב{w.asof && <>, האחרונה <span className="num">{pubLabel(w.asof)}</span></>}</span></>}
        <span>·</span><Link to="/questions">שאלות</Link><span>·</span><Link to="/findings">ממצאים</Link>
      </div>
    </div></div>
  );
  if (!done) return <Loading what="מה השתנה" />;
  if (!w || !b) return <div className="qi wt">{head}<Empty title="אין עדיין יומן תשובות בבנייה הזו" icon="inbox">הקובץ שמשווה בין בניות לא פורסם. <Link to="/questions">לאינדקס השאלות</Link></Empty></div>;
  const p = { I: I ?? null, subs, names, topics };
  const nothing = !b.mine.length && !b.tripped.length && !b.newFindings.length && !b.mineFig.length && !b.rest.length;
  const tripped = b.tripped.filter((c) => !b.mine.includes(c));
  const newF = b.newFindings.filter((c) => !b.mine.includes(c));
  const restLeft = b.rest.filter((c) => !tripped.includes(c) && !newF.includes(c));
  return (
    <div className="qi wt">
      {head}
      <p className="fd-rule"><b>מה נחשב שינוי:</b> {w.rule}. ספירת המעקב כוללת שינוי פסיקה, סף שנחצה, ושאלה או ממצא שנוספו או ירדו; מספר שזז בלי שהפסיקה זזה מוצג בנפרד.</p>
      {w.snaps.length < 2 ? <Empty title="עד כה נשמרה תמונת מצב אחת" icon="inbox">השינויים יופיעו מהבנייה הבאה: כל בנייה שומרת את מה שכל תשובה אומרת, והעמוד הזה משווה בין שתיים עוקבות.</Empty>
        : nothing && <div className="panel wt-quiet"><p><b>{b.first ? 'בבנייה האחרונה' : 'מאז ביקורך הקודם'} אף תשובה לא השתנתה.</b> {w.snaps.length} תמונות מצב ({w.snaps.map(pubLabel).join(', ')}): {w.changes.length ? `בסך הכול ${w.changes.length} שינויים, כולם לפני כן.` : 'כל התשובות אומרות בדיוק את אותו הדבר בכולן.'}</p></div>}
      {subCount(subs) === 0 && w.snaps.length > 1 && <p className="wt-hint">עוד לא סימנת מה לעקוב. "עקוב" בעמוד של כל שאלה וממצא, או נושא וחברה בתיבה למטה: מה שבמעקב עולה ראשון כאן, וסופר בתג שליד "שאלות".</p>}
      <Section id="mine" h="במעקב: התשובה השתנתה" sub="הפסיקה זזה, סף נחצה, או שאלה או ממצא נוספו או ירדו" cs={b.mine} {...p} />
      <Section id="trip" h="ספים שנחצו" sub="התנאי שהתשובה תלויה בו התקיים מאז הבנייה הקודמת: התשובה משתנה" cs={tripped} {...p} />
      <Section id="newf" h="ממצאים חדשים" cs={newF} {...p} />
      <Section id="fig" h="במעקב: המספר זז, הפסיקה עומדת" cs={b.mineFig} {...p} />
      {restLeft.length > 0 && <details className="panel wt-sec wt-rest"><summary><h2 className="an-h">כל מה שהשתנה, לא במעקב <span className="num dim">{restLeft.length}</span></h2></summary>
        <ol className="wt-list">{restLeft.map((c) => <ChangeRow key={`${c.id}|${c.d}`} c={c} {...p} />)}</ol></details>}
      <Prep items={prep} names={names} meetings={meetings.length} />
      <Following subs={subs} replace={replace} I={I ?? null} names={names} findings={fnames} />
      <p className="src">היומן: תמונת מצב אחת לכל יום בנייה, לא נכתבת מחדש לעולם (data/ledger/answers){Object.values(w.snapsrc).some((s) => s.startsWith('git:')) && <>; תמונת המצב של {Object.entries(w.snapsrc).filter(([, s]) => s.startsWith('git:')).map(([d]) => pubLabel(d)).join(', ')} שוחזרה מהקבצים שפורסמו באותו יום (git)</>} · חודש הרשות הבא: אומדן לפי מועדי ההגעה של החודשים הקודמים</p>
    </div>
  );
}
