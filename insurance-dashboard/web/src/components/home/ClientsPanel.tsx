import { Link, useNavigate } from 'react-router-dom';
import { sorted, useClients } from '../../lib/clients';
import { CALLS_KEY, CALLS_SUM_KEY, normCalls, normSummary, ymShort } from '../../lib/agentDesk';
import { useStored } from '../../lib/local';
import { useLoad } from '../../lib/useData';
import '../../styles/agent.css';

/* W3 · the agent home's compact panel of client folders (the full list is /clients). Private: this browser only.
   fox 3.0 phase 2 (A4): one line on the call list: the count /clients last computed, or "a new regulator month landed" when alerts.json
   names a month newer than the one the agent last opened (no data is loaded for it beyond that 2 KB file). */
const dmy = (iso: string) => iso.split('-').reverse().join('.');

/** the agent home's compact panel: the latest folders, and the way in */
export function ClientsPanel() {
  const [file] = useClients();
  const nav = useNavigate();
  const [sumRaw] = useStored<unknown>(CALLS_SUM_KEY, null);
  const [callsRaw] = useStored<unknown>(CALLS_KEY, null);
  const reg = useLoad<{ reg?: { ym?: number } }>(file.folders.length ? 'alerts.json' : null).data?.reg?.ym ?? null;
  const sum = normSummary(sumRaw), seen = normCalls(callsRaw).month;
  const list = sorted(file).slice(0, 4);
  const fresh = reg != null && (seen == null || reg > seen);
  return (
    <section className="panel cl-panel" aria-labelledby="cl-panel-h">
      <div className="hd"><h2 id="cl-panel-h">תיקי לקוחות</h2><div className="aside"><Link to="/clients">{file.folders.length ? `לכל התיקים (${file.folders.length})` : 'ייבוא מקובץ'}</Link></div></div>
      {file.folders.length > 0 && (fresh || (sum != null && sum.open > 0)) && <Link className="cl-calls" to="/clients#calls">
        <b>למי להתקשר החודש</b>
        <span>{fresh ? `חודש חדש של הרשות: נתוני ${ymShort(reg!)}` : `${sum!.clients === 1 ? 'לקוח אחד' : `${sum!.clients} לקוחות`}, ${sum!.open} נושאים פתוחים · נתוני ${ymShort(sum!.asof)}`}</span>
      </Link>}
      {!list.length ? <p className="cl-empty">בהשוואה ובמסמך ללקוח: "שמור ללקוח". נשמר בדפדפן הזה בלבד.</p> : (
        <ul className="cl-mini">
          {list.map((f) => <li key={f.id}><button type="button" onClick={() => nav(`/funds/compare?k=${f.keys.join(',')}&b=${f.b}`, { state: { folder: f.id } })}><b>{f.label}</b><span>{f.keys.length} מסלולים · {dmy(f.updated)}</span></button></li>)}
        </ul>
      )}
    </section>
  );
}
