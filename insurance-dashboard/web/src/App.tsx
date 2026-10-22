import { lazy, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';

/** A page loaded the first time its route is visited: each route group is its own file, so the shell carries no page it does not show. */
const page = <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) => lazy(async () => ({ default: (await load())[name] as ComponentType }));
const mHome = () => import('./pages/Home');
const Home = page(mHome, 'Home');
const mLens = () => import('./pages/SavingsLens');
const SavingsLens = page(mLens, 'SavingsLens');
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
const DocSearch = page(mDocSearch, 'DocSearch');
const mFunds = () => import('./pages/Funds');
const FundCard = page(mFunds, 'FundCard');
const FundMakers = page(mFunds, 'FundMakers');
const Funds = page(mFunds, 'Funds');
const mValuation = () => import('./pages/Valuation');
const ValuationLayout = page(mValuation, 'ValuationLayout');
const ValuationPb = page(mValuation, 'ValuationPb');
const mValuationModels = () => import('./pages/ValuationModels');
const ValuationRi = page(mValuationModels, 'ValuationRi');
const ValuationCsm = page(mValuationModels, 'ValuationCsm');
const Sotp = page(mValuationModels, 'Sotp');
const Dcf = page(mValuationModels, 'Dcf');
const mManagers = () => import('./pages/Managers');
const Managers = page(mManagers, 'Managers');
const mCalendar = () => import('./pages/Calendar');
const Calendar = page(mCalendar, 'Calendar');
const mNotFound = () => import('./pages/NotFound');
const NotFound = page(mNotFound, 'NotFound');

/** /market/* and /industry/econ became views of the Savings Lens: an old link lands on the same figures */
function LensRedirect({ to, view }: { to?: 'funds'; view?: string }) {
  const loc = useLocation(), { name } = useParams();
  const q = new URLSearchParams(loc.search);
  if (to === 'funds') return <Navigate to={`/funds${loc.search}`} replace />;
  if (view) q.set('v', view);
  if (name) q.set('g', name);
  const qs = q.toString();
  return <Navigate to={`/industry/savings${qs ? '?' + qs : ''}`} replace />;
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
          <Route path="savings" element={<SavingsLens />} />
          <Route path="ifrs" element={<CsmRedirect view="facts" />} />
          <Route path="sectors" element={<FromSectors />} />
          <Route path="matrix" element={<FromMatrix />} />
          <Route path="lines" element={<FromLines />} />
          <Route path="csm" element={<IndustryCsm />} />
          <Route path="econ" element={<LensRedirect view="econ" />} />
          <Route path="capital" element={<CsmRedirect view="capital" />} />
          <Route path="headline" element={<FromHeadline />} />
          <Route path="search" element={<DocSearch />} />
        </Route>
        <Route path="funds" element={<Funds />} />
        <Route path="funds/makers" element={<FundMakers />} />
        <Route path="funds/:k" element={<FundCard />} />
        <Route path="managers" element={<Managers />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="valuation" element={<ValuationLayout />} />
        <Route path="valuation/:id" element={<ValuationLayout />}>
          <Route index element={<ValuationPb />} />
          <Route path="ri" element={<ValuationRi />} />
          <Route path="csm" element={<ValuationCsm />} />
          <Route path="sotp" element={<Sotp />} />
          <Route path="dcf" element={<Dcf />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
