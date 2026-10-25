import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { Sourced } from '../components/Source';
import { ErrorBox, Loading, Panel, copyText } from '../components/ui';
import { Unverified } from '../components/Unverified';
import { fmt, pubLabel } from '../lib/format';
import type { Prov } from '../lib/prov';
import { mayaReport, pdfPage } from '../lib/sources';
import { useLoad } from '../lib/useData';
import '../styles/autopilot.css';
import '../styles/autopilot-run.css';

/* /data/autopilot (lane AP; ws7 W7-R1, ws3 W3-R1/R4, ws5 W5-R4): the report-day autopilot's own page. What MAYA filed last per company,
   what the site publishes from it, which periods are still the unverified XBRL skeleton, the headline changes a report-day push would
   carry (each with both sources), and the run's steps. Read from autopilot/status.json (pipeline/autopilot/run.py). Nothing here
   deploys or notifies: the deploy command is shown for a human. Lane S4: the schedule (ops/autopilot.toml, launchd), the permitted
   channels, the last runs that changed something, and what waits for publication. */

type Src = { k: 'xbrl' | 'report'; rid?: number | null; concept?: string; period?: string; status?: string; pg?: number | null; url?: string | null; note?: string };
interface Delta { key: string; label: string; period: string; prev_period: string; basis: 'yoy' | 'qoq' | 'prev'; unit: 'm' | 'pp'; v: number; prev: number; chg: number; pct: number | null; src: [Src, Src] }
interface Filing { rid: number; type: string; period: string | null; date: string; title: string; xbrl: boolean; new?: boolean }
interface Unv { period: string; status: string; rid: number | null; t0: boolean; how?: string; conflict?: { printed: number; tagged: number | null; pg?: number | null; by?: string } }
interface Co {
  id: string; name: string; kind: string; maya_id: number | null; latest: Filing | null; recent: Filing[]; inactive: boolean; note: string | null;
  published: { kpi?: { period: string; status: string; rid: number | null }; statements?: string; csm?: string; solvency?: string };
  unverified: Unv[]; deltas: { period: string; items: Delta[]; push: { title: string; body: string } } | null;
  next: { period: string; expected: string; lo?: string; hi?: string } | null;
}
interface Status {
  built: string; mode: 'apply' | 'dry-run'; source: string;
  poll: { at: string; mode: string; blocked: string | null; seen: number; new: number; errors: number } | null;
  steps: { step: string; ok: boolean; note?: string; planned?: string[]; script?: string; tail?: string }[];
  gate: { ran: boolean; ok: boolean | null; fails: string[]; built?: string | null; note?: string };
  llm: { enabled: boolean; approved_by: string | null }; push: { enabled: boolean }; deploy: { command: string; auto: boolean };
  companies: Co[];
  schedule?: Sched; discovery?: Discovery; regulator?: Reg | null; runs?: Run[]; publish?: Publish; llm_budget?: LlmBudget; extracted_pending?: string[];
}
interface Win { start: string; end: string; companies: number; periods: string[] }
interface Sched {
  timezone: string; days: string[]; hours: [string, string]; in_window_minutes: number; outside_minutes: number; regulator_hours: number;
  window_days: number; now: 'window' | 'season-off'; current: Win | null; next: Win | null;
  due: { id: string; name: string; period: string | null; expected: string; late: boolean }[];
}
interface Discovery { regulator: boolean; maya_scheduled: boolean; maya_permission_ref: string | null; maya_manual: string; maya_interval_seconds: number; finding: string; checked: string }
interface Reg { datasets: { id: string; fox: number | null; upstream: number | null; new: boolean; last_modified?: string }[]; new: boolean; errors: { id: string }[] }
interface Run { at: string; trigger: 'schedule' | 'manual' | 'maya-once'; mode: string; landed: string[]; problems: string[]; gate: boolean | null }
interface Publish { pending: { files: string[]; count: number; ahead: number | null; head: string | null } | null; commands: string[]; auto: false; note: string }
interface LlmBudget { season: string; budget: number; spent: number; calls: number; per_filing: number; per_run: number; enabled: boolean }

const pl = (p?: string | null) => (!p ? '–' : /^\d{4}-\d{2}-\d{2}$/.test(p) ? pubLabel(p) : p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : p.endsWith('Q4') ? `Q4'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
const TYPE_HE: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'סולבנסי', liabilities: 'מצבת התחייבויות' };
const ST_HE: Record<string, string> = { verified: 'אומת', fy: 'שנתי', corrected: 'תוקן', unverified: 'לא מאומת', withheld: 'הושמט' };
const BASIS: Record<string, string> = { yoy: 'YoY', qoq: 'QoQ', prev: 'מול הקודם' };
const STEP_HE: Record<string, string> = { regulator: 'רשות שוק ההון', 'regulator-fetch': 'שליפת נתוני הרשות', pickup: 'קליטה מקומית', poll: 'בדיקה ב-MAYA', skeleton: 'שלד XBRL', extraction: 'חילוץ מה-PDF', build: 'בנייה מחדש', xbrl: 'XBRL למחסן', kpi: 'kpi.json', gate: 'שער איכות' };
const val = (u: Delta['unit'], v: number) => (u === 'pp' ? `${fmt(v, 'n', { d: 0 })}%` : fmt(v, 'm'));

function srcProv(s: Src, d: Delta, v: number, co: Co, which: string): Prov {
  const title = `${d.label} · ${co.name} · ${pl(which)}`;
  if (s.k === 'xbrl') return { k: 'xbrl', title, value: val(d.unit, v), unit: 'מיליוני ש״ח', company: co.id, period: s.period ?? which, rid: s.rid ?? null, concept: s.concept ?? '', status: s.status, note: s.note };
  return { k: 'report', title, value: val(d.unit, v), unit: d.unit === 'pp' ? '%' : 'מיליוני ש״ח', url: s.url ?? null, pg: s.pg ?? null, period: s.period, note: s.note };
}
function deltaProv(d: Delta, co: Co): Prov {
  const chg = d.unit === 'pp' ? `${fmt(d.chg, 'pp', { d: 0 })}` : d.pct != null ? fmt(d.pct, 'pct', { signed: true }) : fmt(d.chg, 'm', { signed: true });
  return { k: 'calc', title: `${d.label} · ${co.name} · ${pl(d.period)} ${BASIS[d.basis]}`, value: chg,
    formula: d.unit === 'pp' ? 'שינוי = יחס נוכחי − יחס קודם (נקודות אחוז)' : d.pct != null ? 'שינוי = (נוכחי − קודם) ÷ |קודם| × 100' : 'שינוי = נוכחי − קודם (אחוז לא מוצג כשהסימן מתהפך או הבסיס אפס)',
    inputs: [{ label: pl(d.period), v: val(d.unit, d.v), src: () => srcProv(d.src[0], d, d.v, co, d.period) }, { label: pl(d.prev_period), v: val(d.unit, d.prev), src: () => srcProv(d.src[1], d, d.prev, co, d.prev_period) }] };
}

const DAY_HE: Record<string, string> = { sun: 'א׳', mon: 'ב׳', tue: 'ג׳', wed: 'ד׳', thu: 'ה׳', fri: 'ו׳', sat: 'ש׳' };
const TRIG_HE: Record<Run['trigger'], string> = { schedule: 'מתוזמן', manual: 'ידני', 'maya-once': 'MAYA ידני' };
const REG_HE: Record<string, string> = { gemel: 'גמל-נט', pensia: 'פנסיה-נט', insurance: 'ביטוח-נט' };
/** 202609 -> 09/26 (regulator months). */
const month = (m?: number | null) => (m ? `${String(m).slice(4, 6)}/${String(m).slice(2, 4)}` : '–');
/** An ISO time stamp -> "25.10.26 14:15", Israel time. */
function stamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}
const days = (d: string[]) => (d.length === 6 && !d.includes('sat') ? 'א׳–ו׳' : d.map((x) => DAY_HE[x] ?? x).join(' '));

/** The push body in a right-to-left line: each "(+28.1% YoY)" isolated left-to-right so its sign and suffix stay in place. */
const pushBody = (body: string) => body.split(/(\([^)]*\))/).map((x, i) => (x.startsWith('(') ? <bdi key={i} dir="ltr" className="num">{x}</bdi> : x));

export function Autopilot() {
  const { data, error } = useLoad<Status>('autopilot/status.json');
  if (error) return <ErrorBox what="סטטוס הטייס האוטומטי" error={error} />;
  if (!data) return <Loading what="טייס אוטומטי" />;
  return <Inner s={data} />;
}

function Inner({ s }: { s: Status }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const active = s.companies.filter((c) => c.maya_id && !c.inactive);
  const unv = s.companies.flatMap((c) => c.unverified.filter((u) => u.t0).map((u) => ({ c, u })));
  const withDeltas = active.filter((c) => c.deltas && c.deltas.items.length);
  const skipped = s.companies.filter((c) => !c.maya_id || c.inactive);
  return (
    <div className="ap wide-page">
      <div className="pagehead"><div>
        <h1>טייס אוטומטי · יום הדוח</h1>
        <div className="sub"><span className="ap-flow">{['MAYA', 'XBRL', 'בדיקות', 'אתר'].map((x, i) => <span key={x}>{i > 0 && ' ← '}<bdi>{x}</bdi></span>)}</span> · נבנה <span className="num">{pubLabel(s.built.slice(0, 10))}</span>{s.mode === 'dry-run' ? ' · הרצת ניסיון' : ''} · <Link to="/data">נתונים ואיכות</Link></div>
      </div></div>

      <section className="kpis">
        {s.schedule && <div className="kpi"><div className="l">לוח זמנים</div>
          <div className="v">{s.schedule.current ? <>כל <span className="num">{s.schedule.in_window_minutes}</span> דק׳</> : <>כל שעה</>}</div>
          <div className="s">{s.schedule.current ? <>חלון דיווח עד <span className="num">{pubLabel(s.schedule.current.end)}</span></>
            : s.schedule.next ? <>חלון הבא <span className="num">{pubLabel(s.schedule.next.start)}</span></> : 'אין חלון צפוי'}</div></div>}
        <div className="kpi"><div className="l">בדיקה אחרונה ב-MAYA</div><div className="v num">{s.poll ? pubLabel(s.poll.at.slice(0, 10)) : '–'}</div>
          <div className="s">{!s.poll ? 'ידני בלבד' : s.poll.blocked ? <span className="chip bad">נחסם · נעצר</span> : <><span className="num">{s.poll.seen}</span> דיווחים נסרקו{s.discovery && !s.discovery.maya_scheduled ? ' · ידני' : ''}</>}</div></div>
        <div className="kpi"><div className="l">דוחות חדשים</div><div className="v num">{s.poll ? s.poll.new : '–'}</div><div className="s">תקופתיים, מצגות, סולבנסי, מצבות</div></div>
        <div className="kpi"><div className="l">לא מאומתים</div><div className={`v num ${unv.length ? 'warn' : ''}`}>{unv.length}</div><div className="s">תקופות משלד ה-XBRL</div></div>
        <div className="kpi"><div className="l">שער איכות</div><div className={`v ${s.gate.ok === false ? 'neg' : ''}`}>{!s.gate.ran ? '–' : s.gate.ok ? 'עבר' : 'נכשל'}</div>
          <div className="s">{!s.gate.ran ? 'לא הורץ' : s.gate.fails.length ? s.gate.fails.join(' · ') : <span className="chip pass">ללא כשל חוסם</span>}</div></div>
        <div className="kpi"><div className="l">ממתין לפרסום</div><div className={`v num ${s.publish?.pending?.count ? 'warn' : ''}`}>{s.publish?.pending ? s.publish.pending.count : '–'}</div>
          <div className="s">{s.publish?.pending ? <>קבצי נתונים{s.publish.pending.ahead ? <> · <span className="num">{s.publish.pending.ahead}</span> commits לא נדחפו</> : ''}</> : 'מחוץ ל-git'}</div></div>
        <div className="kpi"><div className="l">חילוץ ו-Push</div><div className="v">{s.llm.enabled ? 'חילוץ פעיל' : 'כבוי'}</div>
          <div className="s">{s.llm_budget ? <><span className="num">{fmt(s.llm_budget.spent, 'n', { d: 0 })}</span> / <span className="num">{fmt(s.llm_budget.budget, 'n', { d: 0 })}</span> טוקנים</> : <span className="chip">דורש אישור הבעלים</span>}</div></div>
      </section>

      {s.schedule && s.discovery && <Schedule s={s} sc={s.schedule} d={s.discovery} />}

      <Panel title="לפי חברה" aside={<span>{active.length} מדווחות ב-MAYA</span>}>
        <DataTable caption="מצב הטייס האוטומטי לפי חברה" rows={active} rowKey={(c) => c.id} export={{ name: 'fox-autopilot', title: 'טייס אוטומטי · יום הדוח', note: s.source }} columns={[
          { key: 'co', head: 'חברה', value: (c) => c.name, cell: (c) => <Link to={`/company/${c.id}`}>{c.name}</Link> },
          { key: 'last', head: 'דוח אחרון', value: (c) => c.latest?.date ?? '', text: (c) => (c.latest ? `${pl(c.latest.period)} ${pubLabel(c.latest.date)}` : ''),
            cell: (c) => (c.latest ? <span className="ap-filing"><a className="num" href={mayaReport(c.latest.rid)} target="_blank" rel="noreferrer">{pl(c.latest.period)}</a>
              <small>{TYPE_HE[c.latest.type] ?? c.latest.type} · <span className="num">{pubLabel(c.latest.date)}</span>{c.latest.xbrl ? ' · XBRL' : ''}</small>{c.latest.new && <span className="chip pass">חדש</span>}</span> : '–') },
          { key: 'site', head: 'באתר', value: (c) => c.published.kpi?.period ?? '', text: (c) => pl(c.published.kpi?.period),
            cell: (c) => (c.published.kpi ? <span className="ap-filing"><span className="num">{pl(c.published.kpi.period)}</span>
              <small>{ST_HE[c.published.kpi.status] ?? c.published.kpi.status}{c.published.statements ? <> · דוחות <span className="num">{pl(c.published.statements)}</span></> : ''}</small></span> : '–') },
          { key: 'unv', head: 'לא מאומת', value: (c) => c.unverified.filter((u) => u.t0).length,
            cell: (c) => { const t = c.unverified.filter((u) => u.t0); return t.length ? <span className="ap-chips">{t.map((u) => <span key={u.period} className="ap-unv"><span className="num">{pl(u.period)}</span><Unverified info={{ ...u, pub: c.latest?.period === u.period ? c.latest.date : null }} compact /></span>)}</span> : <span className="muted">–</span>; } },
          { key: 'next', head: 'הבא צפוי', value: (c) => c.next?.expected ?? null, firstDir: 'asc', text: (c) => (c.next ? `${pl(c.next.period)} ${pubLabel(c.next.expected)}` : ''),
            cell: (c) => (c.next ? <span className="ap-filing"><span><span className="num">{pl(c.next.period)}</span> · <span className="num">{pubLabel(c.next.expected)}</span></span><small>אומדן</small></span> : '–') },
        ]} />
        {skipped.length > 0 && <div className="src">ללא מעקב: {skipped.map((c) => `${c.name} (${c.maya_id ? 'ללא דוח תקופתי בשנה האחרונה' : 'לא מדווחת ב-MAYA'})`).join(' · ')}</div>}
      </Panel>

      <Panel title="שינויים עיקריים" aside={<span>מה שהתראת יום הדוח תישא · מיליוני ש״ח</span>}>
        <div className="ap-grid">
          {withDeltas.map((c) => (
            <article key={c.id} className="ap-card">
              <header><Link to={`/company/${c.id}`}>{c.name}</Link> <span className="num">{pl(c.deltas!.period)}</span>
                {c.unverified.some((u) => u.t0 && u.period === c.deltas!.period) && <Unverified info={c.unverified.find((u) => u.period === c.deltas!.period)} />}</header>
              <ul>{c.deltas!.items.map((d) => (
                <li key={d.key}><span className="l">{d.label}</span>
                  <span className="v num">{val(d.unit, d.v)}</span>
                  <Sourced src={() => deltaProv(d, c)} className={`d ${d.chg > 0 ? 'pos' : d.chg < 0 ? 'neg' : ''}`}>{d.unit === 'pp' ? fmt(d.chg, 'pp', { d: 0 }) : d.pct != null ? fmt(d.pct, 'pct', { signed: true }) : fmt(d.chg, 'm', { signed: true })}</Sourced>
                  <span className="b">{d.basis === 'prev' ? <>מול <span className="num">{pl(d.prev_period)}</span></> : BASIS[d.basis]}</span></li>))}
              </ul>
              <footer title="נוסח התראת Push (כבוי)"><b>{c.deltas!.push.title}</b> {pushBody(c.deltas!.push.body)}</footer>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="הריצה" aside={<span>{s.mode === 'apply' ? 'הרצה' : 'הרצת ניסיון'} · לא מפרסם לבד</span>}>
        <ol className="ap-steps">
          {s.steps.map((x, i) => <li key={i} className={x.ok ? '' : 'bad'}><b>{STEP_HE[x.step] ?? x.step}</b>{x.script ? <span className="mono">{x.script}</span> : null}<span>{x.note ?? x.tail ?? (x.planned ? x.planned.join(' · ') : x.ok ? 'תקין' : 'נכשל')}</span></li>)}
          {!s.steps.length && <li><b>ללא דוחות חדשים</b><span>הסטטוס נבנה מהנתונים שבאתר</span></li>}
        </ol>
        {!s.publish && <div className="ap-deploy">
          <code className="mono" dir="ltr">{s.deploy.command}</code>
          <button type="button" className="btn" onClick={() => copyText(s.deploy.command, setCopied)}>{copied ? 'הועתק' : copied === false ? 'ההעתקה נכשלה' : 'העתקה'}</button>
        </div>}
        <div className="src">{s.source}. הפרסום ידני: הפקודה רצה רק אחרי שער האיכות. <a href={pdfPage('https://maya.tase.co.il/', null)} target="_blank" rel="noreferrer">MAYA</a> · תנאי השימוש של הבורסה חלים על המסמכים.</div>
      </Panel>

      {s.runs && <Runs runs={s.runs} />}
      {s.publish && <PublishPanel p={s.publish} pending={s.extracted_pending ?? []} />}
    </div>
  );
}

function Schedule({ s, sc, d }: { s: Status; sc: Sched; d: Discovery }) {
  const win = sc.current ?? sc.next;
  const reg = s.regulator;
  return (
    <Panel title="לוח זמנים וערוצים" aside={<span>launchd במחשב הבעלים · <span className="mono" dir="ltr">ops/autopilot.toml</span></span>}>
      <div className="ap-sched">
        <dl className="ap-cad">
          <div><dt>בחלון דיווח</dt><dd>כל <span className="num">{sc.in_window_minutes}</span> דק׳ · {days(sc.days)} <span className="num">{sc.hours[0]}–{sc.hours[1]}</span></dd></div>
          <div><dt>מחוץ לחלון</dt><dd>{sc.outside_minutes === 60 ? 'כל שעה' : <>כל <span className="num">{sc.outside_minutes}</span> דק׳</>}</dd></div>
          <div><dt>רשות שוק ההון</dt><dd>פעם ב-<span className="num">{sc.regulator_hours}</span> שעות</dd></div>
          <div><dt>{sc.current ? 'החלון הנוכחי' : 'החלון הבא'}</dt><dd>{win ? <><span className="num">{pubLabel(win.start)}–{pubLabel(win.end)}</span> · <span className="num">{win.companies}</span> חברות{win.periods.length ? <> · <span className="num">{win.periods.map((x) => pl(x)).join(', ')}</span></> : ''}</> : '–'}</dd></div>
        </dl>
        <table className="ap-chan">
          <caption className="sr-only">ערוצי הגילוי של הטייס האוטומטי</caption>
          <thead><tr><th>ערוץ</th><th>מצב</th><th>פירוט</th></tr></thead>
          <tbody>
            <tr><td>data.gov.il · רשות שוק ההון</td><td>{d.regulator ? <span className="chip pass">אוטומטי</span> : <span className="chip">כבוי</span>}</td>
              <td>{reg ? reg.datasets.map((x) => <span key={x.id} className="ap-reg">{REG_HE[x.id] ?? x.id} <span className="num">{month(x.fox)}</span>{x.new ? <> ← <b className="num">{month(x.upstream)}</b></> : ''}</span>) : 'טרם נבדק'}</td></tr>
            <tr><td>MAYA · דיווחי חברות</td><td>{d.maya_scheduled ? <span className="chip pass">אוטומטי</span> : <span className="chip">ידני</span>}</td>
              <td>{d.maya_scheduled ? <>באישור הבורסה: {d.maya_permission_ref}</> : <><code className="mono" dir="ltr">{d.maya_manual}</code> · בקשה לבורסה ממתינה</>}</td></tr>
            <tr><td>חילוץ מה-PDF · <span dir="ltr">claude -p</span></td><td>{s.llm.enabled ? <span className="chip pass">פעיל</span> : <span className="chip">כבוי</span>}</td>
              <td>{s.llm_budget ? <>עונה <span className="num">{pl(s.llm_budget.season)}</span> · <span className="num">{fmt(s.llm_budget.spent, 'n', { d: 0 })}</span> מתוך <span className="num">{fmt(s.llm_budget.budget, 'n', { d: 0 })}</span> טוקנים · עד <span className="num">{fmt(s.llm_budget.per_filing, 'n', { d: 0 })}</span> לדוח</> : '–'}</td></tr>
          </tbody>
        </table>
        {sc.due.length > 0 && <div className="ap-due"><b>צפויים ועדיין לא ב-fox</b>{sc.due.map((x) => <span key={x.id} className={`chip ${x.late ? 'bad' : ''}`}>{x.name} <span className="num">{pl(x.period)}</span> · <span className="num">{pubLabel(x.expected)}</span>{x.late ? ' · באיחור' : ''}</span>)}</div>}
      </div>
      <div className="src">{d.finding} · נבדק <span className="num">{pubLabel(d.checked)}</span></div>
    </Panel>
  );
}

function Runs({ runs }: { runs: Run[] }) {
  return (
    <Panel title="ריצות אחרונות" aside={<span>רק ריצות ששינו משהו · <span className="num">{runs.length}</span></span>}>
      {runs.length ? <ol className="ap-runs">
        {runs.map((r) => (
          <li key={r.at} className={r.problems.length ? 'bad' : ''}>
            <span className="t num">{stamp(r.at)}</span>
            <span className="chip">{TRIG_HE[r.trigger] ?? r.trigger}</span>
            <span className="w">{r.landed.length ? r.landed.join(' · ') : 'ללא נתונים חדשים'}{r.problems.length ? <b> · {r.problems.join(' · ')}</b> : null}</span>
            <span className={`chip ${r.gate === false ? 'bad' : r.gate ? 'pass' : ''}`}>{r.gate == null ? 'ללא שער' : r.gate ? 'שער עבר' : 'שער נכשל'}</span>
          </li>))}
      </ol> : <div className="muted">עוד לא רצה ריצה מתוזמנת ששינתה נתונים.</div>}
    </Panel>
  );
}

function PublishPanel({ p, pending }: { p: Publish; pending: string[] }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const all = p.commands.join('\n');
  return (
    <Panel title="ממתין לפרסום" aside={<span>{p.note}</span>}>
      {p.pending && p.pending.count > 0 && <details className="ap-files"><summary><span className="num">{p.pending.count}</span> קבצים שהשתנו מאז <span className="mono" dir="ltr">{p.pending.head}</span></summary>
        <ul>{p.pending.files.map((f) => <li key={f} className="mono" dir="ltr">{f}</li>)}</ul></details>}
      <ol className="ap-cmds">{p.commands.map((c, i) => <li key={i}><code className="mono" dir="ltr">{c}</code></li>)}</ol>
      <button type="button" className="btn ap-copy" onClick={() => copyText(all, setCopied)}>{copied ? 'הועתק' : copied === false ? 'ההעתקה נכשלה' : 'העתקת הפקודות'}</button>
      {pending.length > 0 && <div className="src">חילוצים לא מאומתים ממתינים לבדיקה: {pending.map((x) => <span key={x} className="mono" dir="ltr">{x} </span>)}</div>}
    </Panel>
  );
}
