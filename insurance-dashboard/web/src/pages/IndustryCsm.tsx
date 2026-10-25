import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { useRegistry } from '../lib/useData';
import { useLedger } from '../lib/csmData';
import { LedgerView } from './csm/LedgerView';
import { EconView } from './csm/EconView';
import { SensView } from './csm/SensView';
import { CapitalView } from './csm/CapitalView';
import { CurveView } from './csm/CurveView';
import { IndustryIfrs } from './IndustryIfrs';
import { IndustryTools } from './Industry';
import { usePhone } from '../lib/useMedia';
import '../styles/csm.css';

/** The views of the ledger, in the order an analyst reads an IFRS 17 quarter: the movement, its economics, what moves it, what it pays out, the rates under it, every printed row. */
export const CSM_VIEWS = [
  ['ledger', 'גשר CSM'], ['econ', 'כלכלת CSM'], ['sens', 'רגישויות'], ['capital', 'הון ודיבידנד'], ['curve', 'עקום ריבית'], ['facts', 'כל השורות'],
] as const;
export type CsmView = (typeof CSM_VIEWS)[number][0];

/** IFRS 17 · CSM · capital across the listed insurers: one page, six views, every figure linked to its filing page. */
export function IndustryCsm() {
  const [sp] = useSearchParams();
  const view = (CSM_VIEWS.find(([k]) => k === sp.get('view'))?.[0] ?? 'ledger') as CsmView;
  const reg = useRegistry();
  const { data: L, error } = useLedger();
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  // on a phone the tab row scrolls: the view in force is brought into it
  const nav = useRef<HTMLElement>(null);
  const phone = usePhone();
  useEffect(() => { const el = nav.current, a = el?.querySelector<HTMLElement>('[aria-current="page"]'); if (el && a && el.scrollWidth > el.clientWidth) { const r = a.getBoundingClientRect(), n = el.getBoundingClientRect(); el.scrollLeft += (r.left + r.width / 2) - (n.left + n.width / 2); } }, [view]);
  return (
    <div className="csmpage">
      {(() => { const tabs = <nav ref={nav} className={phone ? 'csm-views' : 'subnav sub2 csm-tabs'} aria-label="IFRS 17 · CSM · הון">
        {CSM_VIEWS.map(([k, l]) => <Link key={k} className={k === view ? 'active' : undefined} to={k === 'ledger' ? '?' : `?view=${k}`} replace aria-current={k === view ? 'page' : undefined}>{l}</Link>)}
      </nav>; return phone ? tabs : <IndustryTools at="lead">{tabs}</IndustryTools>; })()}
      {view === 'facts' ? <IndustryIfrs />
        : error ? <ErrorBox what="נתוני CSM" error={error} />
        : !L || !reg.data ? <Loading what="ספר ה-CSM" />
        : view === 'capital' ? <CapitalView L={L} name={name} />
        : view === 'econ' ? <EconView L={L} name={name} />
        : view === 'sens' ? <SensView L={L} name={name} />
        : view === 'curve' ? <CurveView L={L} name={name} />
        : <LedgerView L={L} name={name} />}
    </div>
  );
}
