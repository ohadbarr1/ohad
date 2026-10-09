import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { MarketLayout, MarketOverview, MarketRanking, MarketFunds, MarketGroup } from './pages/Market';
import { Companies } from './pages/Companies';
import { CompanyLayout, CompanyOverview, CompanyFinancials, CompanyIfrs17, CompanySavings, CompanyFilings } from './pages/Company';
import { Coverage } from './pages/Coverage';
import { Methodology } from './pages/Methodology';

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
          <Route path="filings" element={<CompanyFilings />} />
        </Route>
        <Route path="coverage" element={<Coverage />} />
        <Route path="methodology" element={<Methodology />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
