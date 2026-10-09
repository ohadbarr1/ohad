import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel, Seg } from '../components/ui';
import { cls, nf, pct } from '../lib/format';
import { useMarket, useRegistry } from '../lib/useData';

export function Companies() {
  const reg = useRegistry();
  const { market: m } = useMarket();
  const [kind, setKind] = useState<'all' | 'insurance_group' | 'fund_house'>('all');
  const L = m?.LAST ?? 0;
  const list = (reg.data ?? []).filter((c) => kind === 'all' || c.kind === kind);
  return (
    <>
      <div className="pagehead"><div><h1>חברות</h1><div className="sub">קבוצות ביטוח ובתי השקעות · נתוני שוק עד {m?.plabel(L)}</div></div>
        <Seg label="סוג" value={kind} onChange={setKind} options={[['all', 'הכול'], ['insurance_group', 'קבוצות ביטוח'], ['fund_house', 'בתי השקעות']]} /></div>
      <Panel>
        <div className="scroll"><table>
          <thead><tr><th>חברה</th><th>נכסים (מיליארד ש"ח)</th><th>נתח שוק</th><th>שינוי 12 חודשים</th><th>צבירה אורגנית 12 ח׳</th><th>דמי ניהול</th><th>דוחות כספיים</th></tr></thead>
          <tbody>{list.map((c) => {
            const g = m ? m.groupIndex(c.market_group ?? '') : -1;
            const v = (k: Parameters<NonNullable<typeof m>['value']>[0]) => (m && g >= 0 ? m.value(k, L, 'ltm', 'all', g) : null);
            return (
              <tr key={c.id}>
                <td><Link to={`/company/${c.id}`}>{c.name_he}</Link> <span className="muted">{c.name_en}</span></td>
                <td><span className="num">{v('assets') == null ? '–' : nf(v('assets')!, 1)}</span></td>
                <td><span className="num">{pct(v('share'), 1)}</span></td>
                <td><span className={`num ${cls(v('growth'))}`}>{pct(v('growth'), 1, true)}</span></td>
                <td><span className={`num ${cls(v('organic'))}`}>{v('organic') == null ? '–' : nf(v('organic')!, 1)}</span></td>
                <td><span className="num">{pct(v('fee'), 2)}</span></td>
                <td><span className={`chip ${c.has_financials ? 'loaded' : 'pending'}`}>{c.has_financials ? c.filings[0]?.period : 'טרם נקלטו'}</span></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <div className="src">צבירה אורגנית כוללת פנסיה וגמל בלבד. נכסים כוללים גם פוליסות חיסכון של חברות הביטוח.</div>
      </Panel>
    </>
  );
}
