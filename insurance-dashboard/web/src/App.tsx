import { lazy, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';

/** A page loaded the first time its route is visited: each route group is its own file, so the shell carries no page it does not show. */
const page = <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) => lazy(async () => ({ default: (await load())[name] as ComponentType }));
const mHome = () => import('./pages/Home');
const Home = page(mHome, 'Home');
const mLens = () => import('./pages/SavingsLens');
const SavingsPage = page(mLens, 'SavingsPage');
const mCompany = () => import('./pages/Company');
const CompanyLayout = page(mCompany, 'CompanyLayout');
const CompanyFinancials = page(mCompany, 'CompanyFinancials');
const CompanyIfrs17 = page(mCompany, 'CompanyIfrs17');
const CompanyReviewTab = page(mCompany, 'CompanyReviewTab');
const CompanySavings = page(mCompany, 'CompanySavings');
const CompanySopTab = page(mCompany, 'CompanySopTab');
const mCompanyOverview = () => import('./pages/CompanyOverview');
const CompanyOverview = page(mCompanyOverview, 'CompanyOverview');
const mCompanyDocs = () => import('./pages/CompanyDocs');
const CompanyDocs = page(mCompanyDocs, 'CompanyDocs');
const mIndustry = () => import('./pages/Industry');
const IndustryLayout = page(mIndustry, 'IndustryLayout');
const mAttribution = () => import('./pages/Attribution');
const AttributionPage = page(mAttribution, 'AttributionPage');
const mPeers = () => import('./pages/Peers');
const Peers = page(mPeers, 'Peers');
const mPeersRedirect = () => import('./pages/PeersRedirect');
const FromMatrix = page(mPeersRedirect, 'FromMatrix');
const FromLines = page(mPeersRedirect, 'FromLines');
const FromHeadline = page(mPeersRedirect, 'FromHeadline');
const FromSectors = page(mPeersRedirect, 'FromSectors');
const mIndustryCsm = () => import('./pages/IndustryCsm');
const IndustryCsm = page(mIndustryCsm, 'IndustryCsm');
const mDocSearch = () => import('./pages/DocSearch');
const DocSearchRedirect = page(mDocSearch, 'DocSearchRedirect');
const mSearchPage = () => import('./pages/SearchPage');
const SearchPage = page(mSearchPage, 'SearchPage');
const mReader = () => import('./pages/Reader');
const Reader = page(mReader, 'Reader');
const mFunds = () => import('./pages/Funds');
const FundCard = page(mFunds, 'FundCard');
const FundMakers = page(mFunds, 'FundMakers');
const Funds = page(mFunds, 'Funds');
const mValuation = () => import('./pages/Valuation');
const ValuationLayout = page(mValuation, 'ValuationLayout');
const ValuationPb = page(mValuation, 'ValuationPb');
const mValuationModels = () => import('./pages/ValuationModels');
const ValuationRi = page(mValuationModels, 'ValuationRi');
const mManagers = () => import('./pages/Managers');
const Managers = page(mManagers, 'Managers');
const mCalendar = () => import('./pages/Calendar');
const Calendar = page(mCalendar, 'Calendar');
const mChartBook = () => import('./pages/ChartBook');
const ChartBook = page(mChartBook, 'ChartBook');
const mDataPage = () => import('./pages/DataPage');
const DataPage = page(mDataPage, 'DataPage');
const mRestatements = () => import('./pages/Restatements');
const Restatements = page(mRestatements, 'Restatements');
const mPresentations = () => import('./pages/Presentations');
const mCredibility = () => import('./pages/Credibility');
const Credibility = page(mCredibility, 'Credibility'); // lane S3
const Nowcast = page(() => import('./pages/Nowcast'), 'Nowcast'); // module M1: unpublished (no link anywhere, noindex)
const Presentations = page(mPresentations, 'Presentations');
const mAutopilot = () => import('./pages/Autopilot');  // lane AP
const Autopilot = page(mAutopilot, 'Autopilot');
const mDebt = () => import('./pages/Debt');  // lane DL
const Debt = page(mDebt, 'Debt');
const mFacts = () => import('./pages/Facts');  // lane FT
const FactsPage = page(mFacts, 'FactsPage');
const mOwnership = () => import('./pages/Ownership');  // lane OW
const Ownership = page(mOwnership, 'Ownership');
const mOwnershipCompany = () => import('./pages/OwnershipCompany');  // lane OW
const OwnershipCompany = page(mOwnershipCompany, 'OwnershipCompany');
const mAssets = () => import('./pages/Assets');  // lane AL
const Assets = page(mAssets, 'Assets');
const mReportCard = () => import('./pages/ReportCard');  // lane S2
const ReportCardPage = page(mReportCard, 'ReportCardPage');
const mFeed = () => import('./pages/Feed');  // module M2: the delta feed
const Feed = page(mFeed, 'Feed');
const mPositions = () => import('./pages/Positions');  // module A6: the position book
const Positions = page(mPositions, 'Positions');
const PositionSheet = page(mPositions, 'PositionSheet');
const Drivers = page(() => import('./pages/Drivers'), 'Drivers'); // module A1: the driver graph's elasticities (not a nav item)
const Scenarios = page(() => import('./pages/Scenarios'), 'Scenarios'); // module A2: the scenario studio (from home and search, not a nav item)
const WarRoomRegulation = page(() => import('./pages/WarRoomRegulation'), 'WarRoomRegulation'); // module A8: the regulatory pipeline (not a nav item)
const WarRoom = page(() => import('./pages/WarRoom'), 'WarRoom'); // module A5: the move simulator (not a nav item; linked from /savings and search)
const Capital = page(() => import('./pages/Capital'), 'Capital'); // module A7: capital and strategic options (from /scenarios, company panels and search, not a nav item)
const Fragility = page(() => import('./pages/Fragility'), 'Fragility'); // module A10: the Fragility Monitor (not a nav item)
const mNotFound = () => import('./pages/NotFound');
const NotFound = page(mNotFound, 'NotFound');

/** /market/*, /industry/econ and /industry/savings became the Savings Lens at /savings: an old link lands on the same figures */
function LensRedirect({ to, view }: { to?: 'funds'; view?: string }) {
  const loc = useLocation(), { name } = useParams();
  const q = new URLSearchParams(loc.search);
  if (to === 'funds') return <Navigate to={`/funds${loc.search}`} replace />;
  if (view) q.set('v', view);
  if (name) q.set('g', name);
  const qs = q.toString();
  return <Navigate to={`/savings${qs ? '?' + qs : ''}`} replace />;
}
/** the report day is the company home now: an old link keeps its report (?p=) */
function ReportRedirect() { const loc = useLocation(); return <Navigate to={`..${loc.search}`} replace />; }
/** the IFRS 17 and capital tabs are views of the CSM ledger now: an old link keeps its pickers */
function CsmRedirect({ view }: { view: string }) { const loc = useLocation(); return <Navigate to={`/industry/csm?view=${view}${loc.search ? `&${loc.search.slice(1)}` : ''}`} replace />; }

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="market">
          <Route index element={<LensRedirect view="market" />} />
          <Route path="overview" element={<LensRedirect view="market" />} />
          <Route path="ranking" element={<LensRedirect view="rank" />} />
          <Route path="funds" element={<LensRedirect to="funds" />} />
          <Route path="group/:name" element={<LensRedirect />} />
        </Route>
        <Route path="companies" element={<Navigate to="/" replace />} />
        <Route path="company/:id" element={<CompanyLayout />}>
          <Route index element={<CompanyOverview />} />
          <Route path="review" element={<CompanyReviewTab />} />
          <Route path="financials" element={<CompanyFinancials />} />
          <Route path="report" element={<ReportRedirect />} />
          <Route path="profit" element={<CompanySopTab />} />
          <Route path="ifrs17" element={<CompanyIfrs17 />} />
          <Route path="history" element={<Navigate to="../financials" replace />} />
          <Route path="savings" element={<CompanySavings />} />
          <Route path="filings" element={<CompanyDocs />} />
        </Route>
        <Route path="compare" element={<FromHeadline />} />
        <Route path="industry" element={<IndustryLayout />}>
          <Route index element={<Navigate to="peers" replace />} />
          <Route path="peers" element={<Peers />} />
          <Route path="savings" element={<LensRedirect />} />
          <Route path="ifrs" element={<CsmRedirect view="facts" />} />
          <Route path="sectors" element={<FromSectors />} />
          <Route path="matrix" element={<FromMatrix />} />
          <Route path="lines" element={<FromLines />} />
          <Route path="csm" element={<IndustryCsm />} />
          <Route path="econ" element={<LensRedirect view="econ" />} />
          <Route path="capital" element={<CsmRedirect view="capital" />} />
          <Route path="headline" element={<FromHeadline />} />
          <Route path="search" element={<DocSearchRedirect />} />
        </Route>
        <Route path="savings" element={<SavingsPage />} />
        <Route path="funds" element={<Funds />} />
        <Route path="funds/makers" element={<FundMakers />} />
        <Route path="funds/:k" element={<FundCard />} />
        <Route path="managers" element={<Managers />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="book" element={<ChartBook />} />
        <Route path="data" element={<DataPage />} />
        <Route path="data/autopilot" element={<Autopilot />} />
        <Route path="restatements" element={<Restatements />} />
        <Route path="presentations" element={<Presentations />} />
        <Route path="credibility" element={<Credibility />} />{/* lane S3 */}
        <Route path="nowcast" element={<Nowcast />} />{/* module M1: unpublished draft */}
        <Route path="mine" element={<Navigate to="/book" replace />} />{/* the workspace is gone; the chart book stays */}
        <Route path="debt" element={<Debt />} />
        <Route path="debt/:id" element={<Debt />} />
        <Route path="facts/:id" element={<FactsPage />} />
        <Route path="ownership" element={<Ownership />} />{/* lane OW */}
        <Route path="ownership/:id" element={<OwnershipCompany />} />
        <Route path="holdings" element={<Assets />} />{/* lane AL: not /assets, whose /assets/** immutable cache header (hashed bundles) would pin the HTML shell */}
        <Route path="holdings/:id" element={<Assets />} />
        <Route path="card/:company/:period" element={<ReportCardPage />} />{/* lane S2 */}
        <Route path="attribution" element={<AttributionPage />} />{/* module A4: reached from the company home's attribution panel, not a nav item */}
        <Route path="feed" element={<Feed />} />{/* module M2: reached from the home block and search, not a nav item */}
        <Route path="positions" element={<Positions />} />{/* module A6: reached from the feed and the company homes, not a nav item */}
        <Route path="positions/:id" element={<PositionSheet />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="drivers/:id" element={<Drivers />} />{/* module A1 */}
        <Route path="scenarios" element={<Scenarios />} />{/* module A2 */}
        <Route path="warroom/regulation" element={<WarRoomRegulation />} />{/* module A8: reached from /warroom (A5), /savings and search, not a nav item */}
        <Route path="warroom" element={<WarRoom />} />{/* module A5 */}
        <Route path="capital" element={<Capital />} />{/* module A7 */}
        <Route path="fragility" element={<Fragility />} />{/* module A10: reached from /savings, /scenarios, search and the company homes, not a nav item */}
        <Route path="search" element={<SearchPage />} />
        <Route path="doc/:id" element={<Reader />} />
        <Route path="valuation" element={<ValuationLayout />} />
        <Route path="valuation/:id" element={<ValuationLayout />}>
          <Route index element={<ValuationPb />} />
          <Route path="ri" element={<ValuationRi />} />
          {/* retired models: an old link lands on justified P/B */}
          <Route path="csm" element={<Navigate to=".." replace />} />
          <Route path="sotp" element={<Navigate to=".." replace />} />
          <Route path="dcf" element={<Navigate to=".." replace />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
