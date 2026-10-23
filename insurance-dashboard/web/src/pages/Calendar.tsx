import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ErrorBox, Loading, Panel } from '../components/ui';
import { Sourced } from '../components/Source';
import { DataTable } from '../components/DataTable';
import { pubLabel } from '../lib/format';
import { mayaReport } from '../lib/sources';
import { useLoad } from '../lib/useData';
import type { Prov } from '../lib/prov';
import { RecentFilingsPanel } from '../components/home/RecentFilings';

interface Cal { built: string; basis: string; companies: { id: string; name: string; inactive?: boolean; last: { period: string; date: string; type: string; rid: number };
  next: { period: string; end: string; expected?: string; lo?: string; hi?: string; n?: number; lags?: number[] }; history: { period: string; date: string; lag: number }[] }[] }

const pl = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

/** When the next report of each company is due, from its own record of the last three years; an estimate, never a deadline. */
export function Calendar() {
  const { data, error } = useLoad<Cal>('calendar.json');
  if (error) return <ErrorBox what="לוח הדיווחים" error={error} />;
  if (!data) return <Loading what="לוח הדיווחים" />;
  const today = new Date().toISOString().slice(0, 10);
  const prov = (c: Cal['companies'][number]): Prov => {
    const n = c.next;
    return { k: 'calc', title: `דוח ${pl(n.period)} צפוי · ${c.name}`, value: n.expected ? pubLabel(n.expected) : '–', formula: 'סוף התקופה + חציון הימים עד הפרסום, אותו דוח, שלוש השנים האחרונות (אומדן, לא מועד סטטוטורי)',
      inputs: [{ label: `סוף התקופה ${pl(n.period)}`, v: pubLabel(n.end) }, ...c.history.filter((h) => h.period.slice(4) === n.period.slice(4)).slice(-3).map((h) => ({ label: `${pl(h.period)} פורסם ${pubLabel(h.date)}`, v: `${h.lag} ימים` }))] };
  };
  const active = data.companies.filter((c) => !c.inactive), idle = data.companies.filter((c) => c.inactive);
  return (
    <>
      <div className="pagehead"><div><h1><span className="icotile"><Icon name="calendar" /></span>לוח דיווחים</h1><div className="sub">הדוח הבא של כל חברה · אומדן מהרקורד של החברה עצמה · <a href="/data/calendar.ics" download>הוספה ליומן (ICS)</a></div></div></div>
      <RecentFilingsPanel />
      <Panel title="הדוח הבא" aside={<span>{data.basis}</span>}>
        <DataTable caption="הדוח הבא של כל חברה" rows={active} rowKey={(c) => c.id} export={{ name: 'fox-calendar', title: 'לוח דיווחים', note: data.basis }} columns={[
          { key: 'co', head: 'חברה', value: (c) => c.name, cell: (c) => <Link to={`/company/${c.id}`}>{c.name}</Link> },
          { key: 'last', head: 'דוח אחרון', value: (c) => c.last.period, text: (c) => pl(c.last.period), cell: (c) => <a className="num" href={mayaReport(c.last.rid)} target="_blank" rel="noreferrer">{pl(c.last.period)}</a> },
          { key: 'pub', head: 'פורסם', value: (c) => c.last.date, text: (c) => pubLabel(c.last.date), cell: (c) => <span className="num">{pubLabel(c.last.date)}</span> },
          { key: 'next', head: 'הדוח הבא', value: (c) => c.next.period, text: (c) => pl(c.next.period), cell: (c) => <span className="num">{pl(c.next.period)}</span> },
          { key: 'exp', head: 'צפוי', value: (c) => c.next.expected, text: (c) => pubLabel(c.next.expected), firstDir: 'asc',
            cell: (c) => <>{c.next.expected ? <Sourced src={() => prov(c)}><span className="num">{pubLabel(c.next.expected)}</span></Sourced> : '–'} <span className="chip est">אומדן</span></> },
          { key: 'win', head: 'חלון', cell: (c) => (c.next.lo && c.next.hi ? <span className="num muted">{pubLabel(c.next.lo)} – {pubLabel(c.next.hi)}</span> : '–') },
          { key: 'left', head: 'עוד', value: (c) => (c.next.expected ? days(c.next.expected, today) : null), firstDir: 'asc', cell: (c) => {
            const n = c.next, left = n.expected ? days(n.expected, today) : null, late = !!n.hi && today > n.hi;
            return late ? <span className="chip est">באיחור לעומת הרקורד</span> : left != null ? <span className="num">{left > 0 ? `${left} ימים` : left === 0 ? 'היום' : 'עבר'}</span> : '–';
          } },
        ]} />
        {idle.length > 0 && <div className="src">ללא דוח תקופתי בשנה האחרונה: {idle.map((c) => `${c.name} (אחרון ${pl(c.last.period)})`).join(' · ')}</div>}
      </Panel>
    </>
  );
}
