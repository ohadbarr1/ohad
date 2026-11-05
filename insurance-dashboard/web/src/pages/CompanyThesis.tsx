import { lazy, Suspense } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useCtx } from './Company';
import { SinceBlock } from '../components/SinceBadge';
import { EXPECTATIONS_READY } from '../components/thesisSlots';
import '../styles/thesis.css';

/* The company thesis (/company/<id>/thesis; the company opens on its numbers since phase 0): the advisory layer on top of the evidence.
   In order: the position(s) in the book (A6), the market's expectations (A3), the fragility signals (A10), then a row of links down to the
   evidence (wave 2b: the ROE bridge, A4, and the capital options, A7, are the "ניתוח" section of the numbers, linked from that row). A section with no data for the company does not render (each
   panel returns nothing); the expectations slot is a muted placeholder until A3 merges (components/thesisSlots.ts).
   The report day and the key-figure ledger moved to /company/<id>/numbers: an old deep link into them (?p=, ?w=, ?row=, #rd-…) lands there. */
const PositionsBlock = lazy(() => import('./Positions').then((m) => ({ default: m.PositionsBlock })));  // A6: only when the company has a position
// fox 3.0 wave 2b: the ROE bridge (A4) and the capital options (A7) moved to "ניתוח" in the numbers (/company/<id>/numbers#analysis)
const FragilityPanel = lazy(() => import('../components/FragilityPanel').then((m) => ({ default: m.FragilityPanel })));  // A10
const ExpectationsPanel = lazy(() => import('../components/Expectations').then((m) => ({ default: m.ExpectationsPanel })));  // module A3

/** the report day's own address parameters and anchors: a link carrying them was written for the numbers view */
const NUMBERS_PARAMS = ['p', 'w', 'row'];

export function CompanyThesis() {
  const { entry } = useCtx();
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  if (NUMBERS_PARAMS.some((k) => q.has(k)) || loc.hash.startsWith('#rd-')) return <Navigate to={`/company/${entry.id}/numbers${loc.search}${loc.hash}`} replace />;
  const fund = entry.kind === 'fund_house', base = `/company/${entry.id}`;
  return (
    <div className="thesis">
      <SinceBlock id={entry.id} />
      <Suspense fallback={null}>
        <PositionsBlock id={entry.id} />
        {entry.has_price && (EXPECTATIONS_READY && ExpectationsPanel ? <ExpectationsPanel id={entry.id} /> : (
          <section className="panel th-slot" aria-label="ציפיות השוק: בבנייה">
            <div className="hd"><h2>ציפיות השוק</h2><div className="aside"><span className="chip">בבנייה</span></div></div>
          </section>
        ))}
        <FragilityPanel id={entry.id} />
      </Suspense>
      <nav className="th-ev" aria-label="ראיות">
        <span className="l">ראיות</span>
        <Link to={`${base}/numbers`}>מספרים</Link>
        {entry.has_financials && <Link to={`${base}/numbers#analysis`}>{fund ? 'גשר ROE' : 'גשר ROE והון'}</Link>}
        {!fund && entry.has_financials && <Link to={`${base}/ifrs17`}>IFRS 17</Link>}
        {entry.market_group && <Link to={`${base}/savings`}>חיסכון ארוך טווח</Link>}
        {entry.has_price && <Link to={`/valuation/${entry.id}`}>שווי</Link>}
        <Link to={`/drivers/${entry.id}`}>מנגנונים</Link>
        {entry.docs > 0 && <Link to={`${base}/filings`}>מסמכים <span className="num">{entry.docs}</span></Link>}
      </nav>
    </div>
  );
}
