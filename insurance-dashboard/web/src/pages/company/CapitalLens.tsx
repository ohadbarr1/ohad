/* STUB (P6-2d): P6-2e owns this file and replaces it on merge. Contract: default export, props `CompanyLensProps`.
   Until then it renders the shipped solvency and debt panels, unchanged. */
import { lazy, Suspense } from 'react';
import type { CompanyLensProps } from './AnalysisLens';
const ScrComposition = lazy(() => import('../csm/ScrComposition').then((m) => ({ default: m.ScrComposition })));
const DebtStrip = lazy(() => import('../Debt').then((m) => ({ default: m.DebtStrip })));

export default function CapitalLens({ entry }: CompanyLensProps) {
  return (
    <section className="co-sec">
      <Suspense fallback={null}>
        {entry.kind !== 'fund_house' && entry.has_financials && <ScrComposition ids={[entry.id]} name={() => entry.name_he} company={entry.id} />}
        <DebtStrip id={entry.id} />
      </Suspense>
    </section>
  );
}
