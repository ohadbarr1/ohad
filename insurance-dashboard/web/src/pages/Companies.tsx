import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel, Seg } from '../components/ui';
import { Sourced } from '../components/Source';
import type { MetricKey } from '../lib/market';
import type { Prov } from '../lib/prov';
import { cls, nf, pct } from '../lib/format';
import { useMarket, useRegistry } from '../lib/useData';
import '../styles/market.css';

export function Companies() {
  const reg = useRegistry();
  const { market: m } = useMarket();
  const [kind, setKind] = useState<'all' | 'insurance_group' | 'fund_house'>('all');
  const L = m?.LAST ?? 0;
  const all = reg.data ?? [];
  // a subsidiary shares its holding's market group and carries its id as a prefix (more_gemel under more): one entry for the holding, the subsidiary beneath it
  const holdingOf = (c: (typeof all)[number]) => all.find((x) => x.id !== c.id && c.id.startsWith(`${x.id}_`) && x.market_group === c.market_group);
  const list = all.filter((c) => !holdingOf(c) && (kind === 'all' || c.kind === kind));
  return (
    <>
      <div className="pagehead"><div><h1>חברות</h1><div className="sub">קבוצות ביטוח ובתי השקעות · נתוני שוק עד {m?.plabel(L)}</div></div>
        <Seg label="סוג" value={kind} onChange={setKind} options={[['all', 'הכול'], ['insurance_group', 'קבוצות ביטוח'], ['fund_house', 'בתי השקעות']]} /></div>
      <Panel>
        <div className="scroll"><table>
          <thead><tr><th>חברה</th><th>נכסים (מיליארד ש"ח)</th><th>נתח שוק</th><th>שינוי YoY</th><th>צבירה אורגנית, LTM</th><th>דמי ניהול, פנסיה</th><th>דמי ניהול, גמל</th><th>מסמכים</th></tr></thead>
          <tbody>{list.map((c) => {
            const g = m ? m.groupIndex(c.market_group ?? '') : -1;
            const v = (k: Parameters<NonNullable<typeof m>['value']>[0]) => (m && g >= 0 ? m.value(k, L, 'ltm', 'all', g) : null);
            const regP = (metric: MetricKey, set = 'all'): Prov => ({ k: 'reg', metric, pi: L, w: 'ltm', set, g });
            const fee = (set: string) => { const x = m && g >= 0 ? m.value('fee', L, 'm', set, g) : null; return x == null ? <span className="num">–</span> : <Sourced className="num" src={() => regP('fee', set)}>{pct(x, 2)}</Sourced>; };
            const growthP = (): Prov => {
              const b = L - 12, a1 = m ? m.cell(L, 'all', g).a / 1000 : 0, a0 = m && b >= 0 ? m.cell(b, 'all', g).a / 1000 : 0, title = `שינוי נכסים YoY · ${c.name_he} · ${m?.plabel(L)}`;
              if (!m || b < 0 || !(a0 > 0)) return { k: 'none', title, why: 'אין נכסי הקבוצה לפני 12 חודשים' };
              return { k: 'calc', title, value: pct(v('growth'), 1, true), formula: 'נכסים בחודש האחרון ÷ נכסים 12 חודשים קודם, פחות 1', inputs: [
                { label: m.plabel(L), v: nf(a1, 1), src: () => ({ k: 'reg', metric: 'assets', pi: L, w: 'm', set: 'all', g }) }, { label: m.plabel(b), v: nf(a0, 1), src: () => ({ k: 'reg', metric: 'assets', pi: b, w: 'm', set: 'all', g }) }] };
            };
            const num = (metric: MetricKey, text: string, cn = '') => (v(metric) == null ? <span className="num">{text}</span> : <Sourced className={`num ${cn}`} src={() => (metric === 'growth' ? growthP() : regP(metric))}>{text}</Sourced>);
            const subs = all.filter((x) => holdingOf(x)?.id === c.id);
            return (
              <Fragment key={c.id}>
                <tr>
                  <td><Link to={`/company/${c.id}`}>{c.name_he}</Link> <span className="muted">{c.name_en}</span></td>
                  <td>{num('assets', v('assets') == null ? '–' : nf(v('assets')!, 1))}</td>
                  <td>{num('share', pct(v('share'), 1))}</td>
                  <td>{num('growth', pct(v('growth'), 1, true), cls(v('growth')))}</td>
                  <td>{num('organic', v('organic') == null ? '–' : nf(v('organic')!, 1), cls(v('organic')))}</td>
                  <td>{fee('fam:pension')}</td>
                  <td>{fee('fam:gemel')}</td>
                  <td>{c.docs ? <Link className="num" to={`/company/${c.id}/filings`}>{c.docs}</Link> : <span className="num">–</span>}</td>
                </tr>
                {subs.map((x) => (
                  <tr key={x.id} className="subrow">
                    <td><Link to={`/company/${x.id}`}>{x.name_he}</Link><span className="dim">חברה בת, נכללת בנתוני {c.name_he}</span></td>
                    <td colSpan={6} />
                    <td>{x.docs ? <Link className="num" to={`/company/${x.id}/filings`}>{x.docs}</Link> : <span className="num">–</span>}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}</tbody>
        </table></div>
        <div className="src">נכסים: פנסיה, גמל, ביטוחי מנהלים ופוליסות חיסכון · צבירה: פנסיה וגמל · מקור: רשות שוק ההון</div>
      </Panel>
    </>
  );
}
