import { Suspense, lazy } from 'react';
import type { RegistryCompany } from '../../lib/types';
import '../../styles/company-lenses.css';

/* P6-2e, lens ניתוח (`cl=an`; spec p6 §5.2, §14.1 G4, §14.4 T-C6): the ROE bridge, one view at a time with its own period, then the
   capital the insurer can distribute and what each use of it does (CapitalPanel: own funds, SCR, the binding constraint, headroom, the
   management buffer marked "הנחה", distributable capital marked "אומדן", the four uses ranked), then the dividend capacity as the reports
   print it (DividendCapacity: both bases, targets and thresholds, dividends declared and paid by quarter). The panels are the shipped ones,
   unchanged inside; this file decides their order and headings. On the phone the printed-history panel folds under one line. */

/** The props every company depth lens takes (P6-2d's shell lazy-imports AnalysisLens, CapitalLens, TargetsLens by these names). */
export interface CompanyLensProps {
  entry: RegistryCompany;
  /** the report on screen, e.g. '2026Q3' or '2025FY'; '' or undefined = the latest */
  report?: string;
  phone?: boolean;
}

const AttributionPanel = lazy(() => import('../../components/Attribution').then((m) => ({ default: m.AttributionPanel })));
const CapitalPanel = lazy(() => import('../../components/CapitalPanel').then((m) => ({ default: m.CapitalPanel })));
const DividendCapacity = lazy(() => import('../../components/DividendCapacity').then((m) => ({ default: m.DividendCapacity })));
const StressFold = lazy(() => import('./StressFold'));

export default function AnalysisLens({ entry, report, phone }: CompanyLensProps) {
  const ins = entry.kind !== 'fund_house';
  return (
    <div className="p6-lens" id="analysis" data-lens="an">
      <Suspense fallback={<p className="muted p6-wait">טוען את הגשר…</p>}>
        {entry.has_financials && <AttributionPanel id={entry.id} report={report || undefined} />}
        {ins && (
          <div className="p6-lens-g">
            <div className="p6-lens-cell p6-cap" id="divcap"><CapitalPanel id={entry.id} /><StressFold id={entry.id} /></div>
            {phone ? (
              <details className="p6-fold p6-lens-cell" id="divhist">
                <summary><span>כושר חלוקה כפי שהודפס ›</span><small className="muted">יחס על שני הבסיסים · יעד וסף · דיבידנד לפי רבעון</small></summary>
                <DividendCapacity id={entry.id} />
              </details>
            ) : <div className="p6-lens-cell" id="divhist"><DividendCapacity id={entry.id} /></div>}
          </div>
        )}
      </Suspense>
      {!entry.has_financials && !ins && <p className="muted">לבית ההשקעות אין גשר ROE מחולץ מהדוחות.</p>}
    </div>
  );
}
