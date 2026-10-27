import { Link } from 'react-router-dom';
import { Sourced } from './Source';
import { Spark } from './Spark';
import { Panel } from './ui';
import { SEG_HE, SIG_ORDER, ST_HE, headline, isData, type SigId } from '../lib/fragility';
import { fprov, useFragility } from '../lib/fragilityLoad';
import '../styles/fragility.css';

/** module A10 on the company home: the company's seven signals, those in watch / alert first, each figure opening its source. No score. */
export function FragilityPanel({ id }: { id: string }) {
  const { data: F } = useFragility();
  const r = F?.rows.find((x) => x.c === id);
  if (!F || !r) return null;
  const rank = (s: SigId) => ({ alert: 0, watch: 1, ok: 2, nodata: 3, na: 4 })[r.sig[s].st];
  const sigs = [...SIG_ORDER].filter((s) => r.sig[s].st !== 'na').sort((a, b) => rank(a) - rank(b) || SIG_ORDER.indexOf(a) - SIG_ORDER.indexOf(b));
  return (
    <Panel title="מוניטור שבריריות" className="frp" aside={<Link to={`/fragility?c=${id}`}>כל המנהלים</Link>}>
      <ul className="frp-list">{sigs.map((s) => {
        const c = r.sig[s], d = F.sigs.find((x) => x.id === s)!, x = c.seg ? c.segs[c.seg] : undefined;
        return (
          <li key={s} className={`st-${c.st}`}>
            <span className="l">{d.he}{c.seg && SEG_HE[c.seg] ? ` · ${SEG_HE[c.seg]}` : ''}</span>
            <span className={`fr-st st-${c.st} sm`}><i aria-hidden="true" />{ST_HE[c.st]}</span>
            {x && isData(c.st) ? <span className="v"><Sourced src={() => fprov(x.prov!)}>{headline(s, x)}</Sourced><small>{x.asof}</small></span> : <span className="dim">{c.stale ? 'נתון ישן' : 'אין נתונים'}</span>}
            {x && isData(c.st) && <Spark data={(x.ser ?? []).map((p) => p[1])} w={80} h={18} />}
            <Link to={`/fragility?c=${id}&s=${s}`}>הכלל והמקורות</Link>
          </li>
        );
      })}</ul>
      <p className="frp-note">{r.flags.length ? `${r.flags.length} אותות במעקב או בהתראה` : 'אין אותות במעקב או בהתראה'}; אין ציון מצרפי. הספים הם הנחות.</p>
    </Panel>
  );
}
