/* STUB (P6-2d): P6-2e owns this file and replaces it on merge. Contract: default export, props `CompanyLensProps`.
   Until then it renders the shipped targets, credibility, adjusted-metrics and latest-filings blocks, unchanged. */
import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Panel } from '../../components/ui';
import { pubLabel } from '../../lib/format';
import { useCompanyDocs } from '../../lib/useData';
import { CredibilityPanel } from '../Credibility';
import { DOC_TYPE } from '../Company';
import type { CompanyLensProps } from './AnalysisLens';
const TargetsCompact = lazy(() => import('../../components/TargetsTracker').then((m) => ({ default: m.TargetsCompact })));
const AdjustedPanel = lazy(() => import('../../components/AdjustedPanel').then((m) => ({ default: m.AdjustedPanel })));

export default function TargetsLens({ entry }: CompanyLensProps) {
  const docs = useCompanyDocs(entry.id, entry.docs > 0);
  return (
    <section className="co-sec">
      <Suspense fallback={null}>
        <TargetsCompact id={entry.id} name={entry.name_he} />
        {entry.has_financials && <CredibilityPanel id={entry.id} name={entry.name_he} />}
        <AdjustedPanel id={entry.id} name={entry.name_he} />
      </Suspense>
      {docs.data && (
        <Panel title="דיווחים אחרונים" aside={<Link to="filings">כל המסמכים</Link>}>
          <div className="scroll"><table><tbody>{docs.data.docs.slice(0, 7).map((d) => (
            <tr key={d.url}><td><a href={d.url} target="_blank" rel="noreferrer" title={d.title}>{DOC_TYPE[d.type]}</a></td><td><span className="num">{d.period}</span></td><td><span className="num">{d.pages ?? '–'}</span> עמ׳</td><td><span className="num">{pubLabel(d.date)}</span></td></tr>
          ))}</tbody></table></div>
        </Panel>
      )}
    </section>
  );
}
