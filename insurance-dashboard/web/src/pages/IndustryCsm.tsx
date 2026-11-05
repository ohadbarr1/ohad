import { useEffect, useRef } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { useRegistry } from '../lib/useData';
import { useLedger } from '../lib/csmData';
import { LedgerView } from './csm/LedgerView';
import { EconView } from './csm/EconView';
import { SensView } from './csm/SensView';
import { CurveView } from './csm/CurveView';
import { StdView } from './csm/StdView';
import { IndustryIfrs } from './IndustryIfrs';
import { IndustryTools } from './Industry';
import { usePhone } from '../lib/useMedia';
import '../styles/csm.css';

/** The views of the ledger, in the order an analyst reads an IFRS 17 quarter: the movement, its economics, what moves it, the rates under it,
 *  every printed row. Wave 2b: the standardised IFRS 17 view is a tab of its own in the industry row ("IFRS 17"); the stress lab moved to
 *  /scenarios?view=solvency and capital and dividends to /capital (old ?view= links land there with their settings). */
export const CSM_VIEWS = [
  ['ledger', 'גשר CSM'], ['std', 'IFRS 17 מתוקנן'], ['econ', 'כלכלת CSM'], ['sens', 'רגישויות'], ['curve', 'עקום ריבית'], ['facts', 'כל השורות'],
] as const;
/** the views that left the ledger: where an old link lands */
const MOVED: Record<string, string> = { stress: '/scenarios', capital: '/capital' };
export type CsmView = (typeof CSM_VIEWS)[number][0];

/** IFRS 17 and the CSM ledger across the listed insurers: one page, six views, every figure linked to its filing page. */
export function IndustryCsm() {
  const [sp] = useSearchParams();
  const moved = MOVED[sp.get('view') ?? ''];
  const view = (CSM_VIEWS.find(([k]) => k === sp.get('view'))?.[0] ?? 'ledger') as CsmView;
  const reg = useRegistry();
  const { data: L, error } = useLedger();
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  // on a phone the tab row scrolls: the view in force is brought into it
  const nav = useRef<HTMLElement>(null);
  const phone = usePhone();
  useEffect(() => { const el = nav.current, a = el?.querySelector<HTMLElement>('[aria-current="page"]'); if (el && a && el.scrollWidth > el.clientWidth) { const r = a.getBoundingClientRect(), n = el.getBoundingClientRect(); el.scrollLeft += (r.left + r.width / 2) - (n.left + n.width / 2); } }, [view]);
  if (moved) {
    // the stress lab keeps its sliders, basis and metric (?r= &eq= &b= &m= …); capital keeps the solvency basis toggle (?sr=)
    const n = new URLSearchParams(sp); n.delete('view');
    if (moved === '/scenarios') n.set('view', 'solvency');
    const qs = n.toString();
    return <Navigate to={`${moved}${qs ? `?${qs}` : ''}${moved === '/capital' ? '#reported' : ''}`} replace />;
  }
  return (
    <div className="csmpage">
      {view !== 'std' && (() => { const tabs = <nav ref={nav} className={phone ? 'csm-views' : 'subnav sub2 csm-tabs'} aria-label="CSM">
        {CSM_VIEWS.filter(([k]) => k !== 'std').map(([k, l]) => <Link key={k} className={k === view ? 'active' : undefined} to={k === 'ledger' ? '?' : `?view=${k}`} replace aria-current={k === view ? 'page' : undefined}>{l}</Link>)}
      </nav>; return phone ? tabs : <IndustryTools at="lead">{tabs}</IndustryTools>; })()}
      {view === 'facts' ? <IndustryIfrs />
        : view === 'std' ? <StdView name={name} />
        : error ? <ErrorBox what="נתוני CSM" error={error} />
        : !L || !reg.data ? <Loading what="ספר ה-CSM" />
        : view === 'econ' ? <EconView L={L} name={name} />
        : view === 'sens' ? <SensView L={L} name={name} />
        : view === 'curve' ? <CurveView L={L} name={name} />
        : <LedgerView L={L} name={name} />}
    </div>
  );
}
