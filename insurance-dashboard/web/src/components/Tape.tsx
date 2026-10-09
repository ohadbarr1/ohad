import { Link } from 'react-router-dom';
import { nf, pct } from '../lib/format';
import { useCompanyPrice, useRegistry } from '../lib/useData';
import type { RegistryCompany } from '../lib/types';

function Tick({ c }: { c: RegistryCompany }) {
  const { data: p } = useCompanyPrice(c.id, true);
  if (!p) return null;
  const prev = p.close[p.close.length - 2] ?? p.last;
  const d = prev ? (p.last / prev - 1) * 100 : 0;
  return <Link to={`/company/${c.id}`}><b>{c.name_en}</b><span className="num">{nf(p.last / 100, 2)}</span><span className={`num ${d >= 0 ? 'pos' : 'neg'}`}>{pct(d, 1, true)}</span></Link>;
}

/** Last close and week-on-week change for the listed groups. */
export function Tape() {
  const reg = useRegistry();
  const listed = (reg.data ?? []).filter((c) => c.has_price);
  if (!listed.length) return null;
  return (
    <div className="tape" aria-label="מחירי סגירה אחרונים, שינוי שבועי">
      <div className="tape-run">{[0, 1, 2, 3].map((k) => listed.map((c) => <Tick key={`${k}${c.id}`} c={c} />))}</div>
    </div>
  );
}
