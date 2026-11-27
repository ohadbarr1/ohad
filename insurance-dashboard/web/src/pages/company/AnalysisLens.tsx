/* STUB (P6-2d): P6-2e owns this file and replaces it on merge. Contract: default export, props `CompanyLensProps`; root id="analysis".
   Until then it renders the shipped panels of today's "ניתוח" section, unchanged. */
import { lazy, Suspense } from 'react';
import type { RegistryCompany } from '../../lib/types';
import { DividendCapacity } from '../../components/DividendCapacity';
const AttributionPanel = lazy(() => import('../../components/Attribution').then((m) => ({ default: m.AttributionPanel })));
const CapitalPanel = lazy(() => import('../../components/CapitalPanel').then((m) => ({ default: m.CapitalPanel })));

export interface CompanyLensProps { entry: RegistryCompany; report?: string; phone?: boolean }
export default function AnalysisLens({ entry }: CompanyLensProps) {
  const fund = entry.kind === 'fund_house';
  return (
    <section id="analysis" className="co-sec">
      <Suspense fallback={null}>
        {entry.has_financials && <AttributionPanel id={entry.id} />}
        {!fund && <DividendCapacity id={entry.id} />}
        {!fund && entry.has_financials && <CapitalPanel id={entry.id} />}
      </Suspense>
    </section>
  );
}
