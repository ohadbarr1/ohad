import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import { pubLabel } from '../../lib/format';
import { idCss } from '../../lib/identity';
import type { Prov } from '../../lib/prov';
import { mayaReport } from '../../lib/sources';
import { useLoad } from '../../lib/useData';
import { FILING_TYPE, filingPeriod as pl } from './RecentFilings';
import { SinceStrip } from '../SinceBadge';

interface CalCo { id: string; name: string; inactive?: boolean; last: { period: string; date: string; type: string; rid: number };
  next: { period: string; end: string; expected?: string; lo?: string; hi?: string }; history: { period: string; date: string; lag: number }[] }
interface Cal { built: string; basis: string; companies: CalCo[] }

const pk = (p: string) => Number(p.slice(0, 4)) * 4 + (p.endsWith('FY') ? 4 : Number(p.slice(5)));
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

const expectProv = (c: CalCo): Prov => ({ k: 'calc', est: true, title: `דוח ${pl(c.next.period)} צפוי · ${c.name}`, value: c.next.expected ? pubLabel(c.next.expected) : '–',
  formula: 'סוף התקופה + חציון הימים עד הפרסום, אותו דוח, שלוש השנים האחרונות (אומדן, לא מועד סטטוטורי)',
  inputs: [{ label: `סוף התקופה ${pl(c.next.period)}`, v: pubLabel(c.next.end) }, ...c.history.filter((h) => h.period.slice(4) === c.next.period.slice(4)).slice(-3).map((h) => ({ label: `${pl(h.period)} פורסם ${pubLabel(h.date)}`, v: `${h.lag} ימים` }))] });
const filedProv = (c: CalCo): Prov => ({ k: 'report', title: `${FILING_TYPE[c.last.type] ?? 'דוח'} ${pl(c.last.period)} · ${c.name}`, value: pubLabel(c.last.date), url: mayaReport(c.last.rid), pg: null, doc: 'MAYA', period: pl(c.last.period), note: `פורסם ${pubLabel(c.last.date)}` });

/** The season in one line: which period is current, who has filed it, when the next report is due; and, per company, what arrived since the
 *  reader last opened it (lane S2: one visit date per company, not one global date). */
export function SeasonStrip() {
  const cal = useLoad<Cal>('calendar.json');
  const today = new Date().toISOString().slice(0, 10);
  if (!cal.data) return <section className="hm-season" aria-busy="true" />;
  const active = cal.data.companies.filter((c) => !c.inactive);
  if (!active.length) return null;
  const season = active.reduce((m, c) => (pk(c.last.period) > pk(m) ? c.last.period : m), active[0].last.period);
  const done = active.filter((c) => c.last.period === season).sort((a, b) => a.last.date.localeCompare(b.last.date));
  const waiting = active.filter((c) => c.last.period !== season);
  const lastIn = done[done.length - 1];
  // the next report due: of a company still owing this season, else the first of the next season
  const due = (waiting.length ? waiting : active).filter((c) => c.next.expected).sort((a, b) => a.next.expected!.localeCompare(b.next.expected!))[0];
  const left = due?.next.expected ? days(due.next.expected, today) : null;
  const name = (id: string) => cal.data!.companies.find((c) => c.id === id)?.name ?? id;
  const countProv = (): Prov => ({ k: 'calc', title: `דיווחו ${pl(season)}`, value: `${done.length}/${active.length}`, formula: 'חברות שהדוח התקופתי האחרון שלהן ב-MAYA הוא לתקופה, מתוך החברות המדווחות',
    inputs: [...done.map((c) => ({ label: c.name, v: pubLabel(c.last.date), src: () => filedProv(c) })), ...waiting.map((c) => ({ label: `${c.name} (אחרון ${pl(c.last.period)})`, v: 'טרם', src: () => filedProv(c) }))] });
  return (
    <section className="hm-season" aria-label="עונת הדוחות">
      <div className="hm-s-main">
        <span className="hm-s-per num">{pl(season)}</span>
        <span className="hm-s-ticks" aria-hidden="true">{active.map((c) => <i key={c.id} title={c.name} className={c.last.period === season ? 'on' : ''} style={c.last.period === season ? { background: idCss(c.id) } : undefined} />)}</span>
        <span className="hm-s-k"><Sourced src={countProv}>{`${done.length}/${active.length}`}</Sourced> דיווחו</span>
        {lastIn && <span className="hm-s-k hm-s-last muted">אחרון <Sourced src={() => filedProv(lastIn)}><span className="num">{pubLabel(lastIn.last.date)}</span></Sourced></span>}
        {due?.next.expected && (
          <span className="hm-s-k">
            {waiting.length ? 'הבא' : <>הבא <span className="num">{pl(due.next.period)}</span></>} <Sourced src={() => expectProv(due)}><span className="num">{pubLabel(due.next.expected)}</span></Sourced>
            <span className="muted"><span className="hm-s-who"> {name(due.id)} ·</span>{left != null && left > 0 ? <> בעוד <span className="num">{left}</span> ימים</> : null}</span> <span className="chip est">אומדן</span>
          </span>
        )}
      </div>
      <div className="hm-s-aside">
        <SinceStrip />
        <Link to="/calendar">לוח דיווחים</Link>
      </div>
    </section>
  );
}
