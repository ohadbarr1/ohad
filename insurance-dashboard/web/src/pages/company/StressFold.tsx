import { Link } from 'react-router-dom';
import { StressTable, useBufferParam, useCapitalBase, useCapitalOne } from '../../components/CapitalPanel';
import { useLoad } from '../../lib/useData';
import { driversPath, type DriverFile } from '../../lib/drivers';
import { isOk } from '../../lib/capital';

/* P6-2e, lens ניתוח: CapitalPanel (frozen, unchanged) ends with its A2 stress table; in the lens that table is folded under one line
   (company-lenses.css hides the in-panel copy) and drawn here by the same exported component from the same calls, so no figure is lost. */
export default function StressFold({ id }: { id: string }) {
  const B = useCapitalBase();
  const D = useLoad<DriverFile>(B.file ? driversPath(id) : null);
  const [pp] = useBufferParam();
  const co = B.file?.companies.find((x) => x.id === id) ?? null;
  const c = co && isOk(co) ? co : null;
  const one = useCapitalOne(c, D.data, B.P, B.NCm, B.ncAt, pp);
  if (!c || !one || !one.St.length) return null;
  return (
    <details className="p6-fold p6-stress" id="stress">
      <summary><span>העודף אחרי תרחישי לחץ · <span className="num">{one.St.length}</span> תרחישים ›</span><small className="muted">הון בר-חלוקה ונשאר מהעודף אחרי כל תרחיש (A2), SCR קבוע · <Link to="/scenarios">חדר התרחישים</Link></small></summary>
      <StressTable c={c} S={one.St} base={one.R.dist} />
    </details>
  );
}
