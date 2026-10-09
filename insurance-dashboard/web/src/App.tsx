import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { MarketLayout, MarketOverview, MarketRanking, MarketFunds, MarketGroup } from './pages/Market';
import { Companies } from './pages/Companies';
import { CompanyLayout, CompanyFinancials, CompanyIfrs17, CompanySavings } from './pages/Company';
import { CompanyOverview } from './pages/CompanyOverview';
import { CompanyDocs } from './pages/CompanyDocs';
import { Compare } from './pages/Compare';
import { Dcf, Sotp, ValuationLayout } from './pages/Valuation';
import { Managers } from './pages/Managers';

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
          <Route path="financials" element={<CompanyFinancials />} />
          <Route path="ifrs17" element={<CompanyIfrs17 />} />
          <Route path="savings" element={<CompanySavings />} />
          <Route path="filings" element={<CompanyDocs />} />
        </Route>
        <Route path="compare" element={<Compare />} />
        <Route path="managers" element={<Managers />} />
        <Route path="valuation" element={<ValuationLayout />} />
        <Route path="valuation/:id" element={<ValuationLayout />}>
          <Route index element={<Navigate to="dcf" replace />} />
          <Route path="dcf" element={<Dcf />} />
          <Route path="sotp" element={<Sotp />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
