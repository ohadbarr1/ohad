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

/* /data/autopilot (lane AP; ws7 W7-R1, ws3 W3-R1/R4, ws5 W5-R4): the report-day autopilot's own page. What MAYA filed last per company,
   what the site publishes from it, which periods are still the unverified XBRL skeleton, the headline changes a report-day push would
   carry (each with both sources), and the run's steps. Read from autopilot/status.json (pipeline/autopilot/run.py). Nothing here
   deploys or notifies: the deploy command is shown for a human. */

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
}

const pl = (p?: string | null) => (!p ? '–' : /^\d{4}-\d{2}-\d{2}$/.test(p) ? pubLabel(p) : p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : p.endsWith('Q4') ? `Q4'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
const TYPE_HE: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'סולבנסי', liabilities: 'מצבת התחייבויות' };
const ST_HE: Record<string, string> = { verified: 'אומת', fy: 'שנתי', corrected: 'תוקן', unverified: 'לא מאומת', withheld: 'הושמט' };
const BASIS: Record<string, string> = { yoy: 'YoY', qoq: 'QoQ', prev: 'מול הקודם' };
const STEP_HE: Record<string, string> = { poll: 'בדיקה ב-MAYA', skeleton: 'שלד XBRL', extraction: 'חילוץ מה-PDF', build: 'בנייה מחדש', xbrl: 'XBRL למחסן', kpi: 'kpi.json', gate: 'שער איכות' };
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
        <div className="kpi"><div className="l">בדיקה אחרונה ב-MAYA</div><div className="v num">{s.poll ? pubLabel(s.poll.at.slice(0, 10)) : '–'}</div>
          <div className="s">{!s.poll ? 'לא הורץ בבנייה זו' : s.poll.blocked ? <span className="chip bad">נחסם · נעצר</span> : <><span className="num">{s.poll.seen}</span> דיווחים נסרקו</>}</div></div>
        <div className="kpi"><div className="l">דוחות חדשים</div><div className="v num">{s.poll ? s.poll.new : '–'}</div><div className="s">תקופתיים, מצגות, סולבנסי, מצבות</div></div>
        <div className="kpi"><div className="l">לא מאומתים</div><div className={`v num ${unv.length ? 'warn' : ''}`}>{unv.length}</div><div className="s">תקופות משלד ה-XBRL</div></div>
        <div className="kpi"><div className="l">שער איכות</div><div className={`v ${s.gate.ok === false ? 'neg' : ''}`}>{!s.gate.ran ? '–' : s.gate.ok ? 'עבר' : 'נכשל'}</div>
          <div className="s">{!s.gate.ran ? 'לא הורץ' : s.gate.fails.length ? s.gate.fails.join(' · ') : <span className="chip pass">ללא כשל חוסם</span>}</div></div>
        <div className="kpi"><div className="l">חילוץ ו-Push</div><div className="v">כבוי</div><div className="s"><span className="chip">דורש אישור הבעלים</span></div></div>
      </section>

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
        <div className="ap-deploy">
          <code className="mono" dir="ltr">{s.deploy.command}</code>
          <button type="button" className="btn" onClick={() => copyText(s.deploy.command, setCopied)}>{copied ? 'הועתק' : copied === false ? 'ההעתקה נכשלה' : 'העתקה'}</button>
        </div>
        <div className="src">{s.source}. הפרסום ידני: הפקודה רצה רק אחרי שער האיכות. <a href={pdfPage('https://maya.tase.co.il/', null)} target="_blank" rel="noreferrer">MAYA</a> · תנאי השימוש של הבורסה חלים על המסמכים.</div>
      </Panel>
    </div>
  );
}
