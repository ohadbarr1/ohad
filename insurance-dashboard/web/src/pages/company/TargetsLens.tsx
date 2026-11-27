import { Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { Panel } from '../../components/ui';
import { pubLabel } from '../../lib/format';
import { useCompanyDocs } from '../../lib/useData';
import { useTargets } from '../../lib/targets';
import type { DocEntry } from '../../lib/types';
import { DOC_TYPE } from '../Company';
import type { CompanyLensProps } from './AnalysisLens';
import '../../styles/company-lenses.css';

/* P6-2e, lens יעדים (`cl=tg`; spec p6 §5.2, §14.1 G2, §14.4 T-C8; tester round 3 "same basis"): the targets table first (target, actual
   on the same basis, status, with document and page), then "מדיניות וספים" (the latest statement of each kind, history in a sheet), the
   credibility record ("אמינות יעדים", from ReportDay), the company's adjusted metrics, and the last seven filings. */

const TargetsTable = lazy(() => import('../../components/TargetsTracker').then((m) => ({ default: m.TargetsTable })));
const PolicyLatest = lazy(() => import('../../components/TargetsTracker').then((m) => ({ default: m.PolicyLatest })));
const CredibilityPanel = lazy(() => import('../Credibility').then((m) => ({ default: m.CredibilityPanel })));
const AdjustedPanel = lazy(() => import('../../components/AdjustedPanel').then((m) => ({ default: m.AdjustedPanel })));

const per = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);
function LatestDocs({ docs }: { docs: DocEntry[] }) {
  return (
    <Panel title="דיווחים אחרונים" aside={<Link to="filings">כל המסמכים</Link>}>
      <div className="scroll"><table className="tight p6-docs" id="docs">
        <tbody>{docs.slice(0, 7).map((d) => (
          <tr key={d.url}><td><a href={d.url} target="_blank" rel="noreferrer" title={d.title}>{DOC_TYPE[d.type]}</a>{d.en && <span className="chip" style={{ marginInlineStart: 6 }}>EN</span>}</td>
            <td><span className="num">{per(d.period)}</span></td><td><span className="num">{d.pages ?? '–'}</span> עמ׳</td><td><span className="num">{pubLabel(d.date)}</span></td></tr>))}</tbody>
      </table></div>
    </Panel>
  );
}

export default function TargetsLens({ entry, phone }: CompanyLensProps) {
  const docs = useCompanyDocs(entry.id, entry.docs > 0);
  // the credibility record exists only when a target of this company has passed its horizon (CredibilityPanel's own rule)
  const cx = useTargets().data?.cred?.companies[entry.id], cred = !!cx && cx.n + cx.nc > 0;
  return (
    <div className="p6-lens" id="targets-lens" data-lens="tg">
      <Suspense fallback={<p className="muted p6-wait">טוען את היעדים…</p>}>
        <TargetsTable id={entry.id} name={entry.name_he} />
        <div className="p6-lens-g">
          <div className="p6-lens-cell"><PolicyLatest id={entry.id} name={entry.name_he} cap={phone ? 6 : 10} /></div>
          <div className="p6-lens-cell" id="credibility">{!cred ? null : phone
            ? <details className="p6-fold"><summary><span>אמינות יעדים ›</span><small className="muted">יעדים שמועדם עבר: הושג, חלקית, לא הושג, מול הדוחות</small></summary><CredibilityPanel id={entry.id} name={entry.name_he} /></details>
            : <CredibilityPanel id={entry.id} name={entry.name_he} />}</div>
        </div>
        <div className="p6-lens-g">
          <div className="p6-lens-cell" id="adjusted"><AdjustedPanel id={entry.id} name={entry.name_he} /></div>
          <div className="p6-lens-cell">{docs.data && docs.data.docs.length > 0 && <LatestDocs docs={docs.data.docs} />}</div>
        </div>
      </Suspense>
    </div>
  );
}
