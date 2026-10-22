import { lazy, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';

/** A page loaded the first time its route is visited: each route group is its own file, so the shell carries no page it does not show. */
const page = <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) => lazy(async () => ({ default: (await load())[name] as ComponentType }));
const mHome = () => import('./pages/Home');
const Home = page(mHome, 'Home');
const mMarket = () => import('./pages/Market');
const MarketLayout = page(mMarket, 'MarketLayout');
const MarketOverview = page(mMarket, 'MarketOverview');
const MarketRanking = page(mMarket, 'MarketRanking');
const MarketFunds = page(mMarket, 'MarketFunds');
const MarketGroup = page(mMarket, 'MarketGroup');
const mCompanies = () => import('./pages/Companies');
const Companies = page(mCompanies, 'Companies');
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
const mCompare = () => import('./pages/Compare');
const Compare = page(mCompare, 'Compare');
const mIndustry = () => import('./pages/Industry');
const IndustryLayout = page(mIndustry, 'IndustryLayout');
const IndustrySavings = page(mIndustry, 'IndustrySavings');
const mIndustryIfrs = () => import('./pages/IndustryIfrs');
const IndustryIfrs = page(mIndustryIfrs, 'IndustryIfrs');
const mIndustryCapital = () => import('./pages/IndustryCapital');
const IndustryCapital = page(mIndustryCapital, 'IndustryCapital');
const mIndustryEcon = () => import('./pages/IndustryEcon');
const IndustryEcon = page(mIndustryEcon, 'IndustryEcon');
const mIndustryMatrix = () => import('./pages/IndustryMatrix');
const IndustryMatrix = page(mIndustryMatrix, 'IndustryMatrix');
const mIndustryLines = () => import('./pages/IndustryLines');
const IndustryLines = page(mIndustryLines, 'IndustryLines');
const mIndustrySectors = () => import('./pages/IndustrySectors');
const IndustrySectors = page(mIndustrySectors, 'IndustrySectors');
const mIndustryCsm = () => import('./pages/IndustryCsm');
const IndustryCsm = page(mIndustryCsm, 'IndustryCsm');
const mDocSearch = () => import('./pages/DocSearch');
const DocSearch = page(mDocSearch, 'DocSearch');
const mFunds = () => import('./pages/Funds');
const FundCard = page(mFunds, 'FundCard');
const FundMakers = page(mFunds, 'FundMakers');
const Funds = page(mFunds, 'Funds');
const mValuation = () => import('./pages/Valuation');
const Dcf = page(mValuation, 'Dcf');
const Sotp = page(mValuation, 'Sotp');
const ValuationLayout = page(mValuation, 'ValuationLayout');
const mManagers = () => import('./pages/Managers');
const Managers = page(mManagers, 'Managers');
const mCalendar = () => import('./pages/Calendar');
const Calendar = page(mCalendar, 'Calendar');
const mNotFound = () => import('./pages/NotFound');
const NotFound = page(mNotFound, 'NotFound');

/** the report day is the company home now: an old link keeps its report (?p=) */
function ReportRedirect() { const loc = useLocation(); return <Navigate to={`..${loc.search}`} replace />; }

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="market" element={<MarketLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<MarketOverview />} />
          <Route path="ranking" element={<MarketRanking />} />
          <Route path="funds" element={<MarketFunds />} />
          <Route path="group/:name" element={<MarketGroup />} />
        </Route>
        <Route path="companies" element={<Companies />} />
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
        <Route path="compare" element={<Navigate to="/industry/headline" replace />} />
        <Route path="industry" element={<IndustryLayout />}>
          <Route index element={<Navigate to="sectors" replace />} />
          <Route path="savings" element={<IndustrySavings />} />
          <Route path="ifrs" element={<IndustryIfrs />} />
          <Route path="sectors" element={<IndustrySectors />} />
          <Route path="matrix" element={<IndustryMatrix />} />
          <Route path="lines" element={<IndustryLines />} />
          <Route path="csm" element={<IndustryCsm />} />
          <Route path="econ" element={<IndustryEcon />} />
          <Route path="capital" element={<IndustryCapital />} />
          <Route path="headline" element={<Compare />} />
          <Route path="search" element={<DocSearch />} />
        </Route>
        <Route path="funds" element={<Funds />} />
        <Route path="funds/makers" element={<FundMakers />} />
        <Route path="funds/:k" element={<FundCard />} />
        <Route path="managers" element={<Managers />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="valuation" element={<ValuationLayout />} />
        <Route path="valuation/:id" element={<ValuationLayout />}>
          <Route index element={<Navigate to="dcf" replace />} />
          <Route path="dcf" element={<Dcf />} />
          <Route path="sotp" element={<Sotp />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
