import { Link, useNavigate } from 'react-router-dom';
import { sorted, useClients } from '../../lib/clients';
import '../../styles/agent.css';

/* W3 · the agent home's compact panel of client folders (the full list is /clients). Private: this browser only. */
const dmy = (iso: string) => iso.split('-').reverse().join('.');

/** the agent home's compact panel: the latest folders, and the way in */
export function ClientsPanel() {
  const [file] = useClients();
  const nav = useNavigate();
  const list = sorted(file).slice(0, 4);
  return (
    <section className="panel cl-panel" aria-labelledby="cl-panel-h">
      <div className="hd"><h2 id="cl-panel-h">תיקי לקוחות</h2><div className="aside"><Link to="/clients">{file.folders.length ? `לכל התיקים (${file.folders.length})` : 'ייבוא מקובץ'}</Link></div></div>
      {!list.length ? <p className="cl-empty">בהשוואה ובמסמך ללקוח: "שמור ללקוח". נשמר בדפדפן הזה בלבד.</p> : (
        <ul className="cl-mini">
          {list.map((f) => <li key={f.id}><button type="button" onClick={() => nav(`/funds/compare?k=${f.keys.join(',')}&b=${f.b}`, { state: { folder: f.id } })}><b>{f.label}</b><span>{f.keys.length} מסלולים · {dmy(f.updated)}</span></button></li>)}
        </ul>
      )}
    </section>
  );
}
