import { Link } from 'react-router-dom';
import { ErrorBox, Loading, Panel } from '../components/ui';
import { Sourced } from '../components/Source';
import { pubLabel } from '../lib/format';
import { mayaReport } from '../lib/sources';
import { useLoad } from '../lib/useData';
import type { Prov } from '../lib/prov';

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
      <div className="pagehead"><div><h1>לוח דיווחים</h1><div className="sub">הדוח הבא של כל חברה · אומדן מהרקורד של החברה עצמה · <a href="/data/calendar.ics" download>הוספה ליומן (ICS)</a></div></div></div>
      <Panel title="הדוח הבא" aside={<span>{data.basis}</span>}>
        <div className="scroll"><table>
          <thead><tr><th>חברה</th><th>דוח אחרון</th><th>פורסם</th><th>הדוח הבא</th><th>צפוי</th><th>חלון</th><th>עוד</th></tr></thead>
          <tbody>{active.map((c) => {
            const n = c.next, left = n.expected ? days(n.expected, today) : null, late = !!n.hi && today > n.hi;
            return (
              <tr key={c.id}>
                <td><Link to={`/company/${c.id}`}>{c.name}</Link></td>
                <td><a className="num" href={mayaReport(c.last.rid)} target="_blank" rel="noreferrer">{pl(c.last.period)}</a></td>
                <td><span className="num">{pubLabel(c.last.date)}</span></td>
                <td><span className="num">{pl(n.period)}</span></td>
                <td>{n.expected ? <Sourced src={() => prov(c)}><span className="num">{pubLabel(n.expected)}</span></Sourced> : '–'} <span className="chip est">אומדן</span></td>
                <td>{n.lo && n.hi ? <span className="num muted">{pubLabel(n.lo)} – {pubLabel(n.hi)}</span> : '–'}</td>
                <td>{late ? <span className="chip est">באיחור לעומת הרקורד</span> : left != null ? <span className="num">{left > 0 ? `${left} ימים` : left === 0 ? 'היום' : 'עבר'}</span> : '–'}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {idle.length > 0 && <div className="src">ללא דוח תקופתי בשנה האחרונה: {idle.map((c) => `${c.name} (אחרון ${pl(c.last.period)})`).join(' · ')}</div>}
      </Panel>
    </>
  );
}
