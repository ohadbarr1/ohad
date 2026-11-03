import { Link } from 'react-router-dom';
import { Est } from './figs';
import { useOptional } from '../../lib/fundsLoad';
import type { FundX } from '../../lib/funds';
import { UNDER_PATH, saverProv, saverUnder, ym, type UnderFile } from '../../lib/under';
import { nf } from '../../lib/format';
import '../../styles/under.css';

/* Wave 11 · the saver's one line on her product card: only when her track is in the bottom quartile of its category on the 5-year net
   return AND its gap to the category median is at least 25bp (under.json saver_bp). ₪ on her balance when she entered one, else on
   ₪100,000. Otherwise nothing. Factual, sourced; past returns, not a forecast. Mount after <FlowLine> in components/saver/ProductCard.tsx:
   {!example && <UnderLine f={f} balance={my?.balance} />} */
export function UnderLine({ f, balance }: { f: Pick<FundX, 'k'>; balance?: number | null }) {
  const U = useOptional<UnderFile>(UNDER_PATH);
  const s = saverUnder(U, f.k, balance);
  if (!U || !s) return null;
  const ils = `₪${Math.round(s.ils).toLocaleString('en-US')}`;
  return (
    <p className="sv-under" data-testid="under-line">
      ב-5 השנים: <Est src={() => saverProv(U, s, null)}>{`${nf(s.gap, 2)}%`}</Est> בשנה מתחת לחציון בקטגוריה (נטו, אומדן), כ-<Est src={() => saverProv(U, s, null)}>{ils}</Est> בשנה {s.own ? 'על יתרה כמו שלך' : 'על כל ₪100,000'}.
      {' '}<span className="sv-src">עד {ym(U.asof)}; תשואות עבר, לא תחזית · <Link to="/funds/under?v=all">המקור</Link></span>
    </p>
  );
}
