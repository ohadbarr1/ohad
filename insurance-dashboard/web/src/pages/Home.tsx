import { Link } from 'react-router-dom';
import { Search } from '../components/Search';
import { Kpi, Panel } from '../components/ui';
import { nf, pct } from '../lib/format';
import { useMarket, useRegistry } from '../lib/useData';

export function Home() {
  const { market: m } = useMarket();
  const reg = useRegistry();
  const L = m?.LAST ?? 0;
  const tot = m ? m.cell(L, 'all', -1).a : 0;
  return (
    <>
      <section className="hero">
        <h1>ביטוח, פנסיה וגמל</h1>
        <Search big />
      </section>

      {m && (
        <section className="kpis">
          <Kpi label="סך נכסים בשוק" value={nf(tot / 1000, 0)} sub={`מיליארד ש"ח · ${m.plabel(L)}`} />
          <Kpi label="פנסיה" value={nf(m.cell(L, 'fam:pension', -1).a / 1000, 0)} sub={<>מיליארד ש"ח · <span className="num">{pct(m.growth(L, 'ltm', 'fam:pension', -1), 1, true)}</span> בשנה</>} />
          <Kpi label="גמל והשתלמות" value={nf(m.cell(L, 'fam:gemel', -1).a / 1000, 0)} sub={<>מיליארד ש"ח · <span className="num">{pct(m.growth(L, 'ltm', 'fam:gemel', -1), 1, true)}</span> בשנה</>} />
          <Kpi label="פוליסות חיסכון" value={nf(m.cell(L, 'fam:insurance', -1).a / 1000, 0)} sub={<>מיליארד ש"ח · <span className="num">{pct(m.growth(L, 'ltm', 'fam:insurance', -1), 1, true)}</span> בשנה</>} />
          <Kpi label="קופות במאגר" value={nf(m.d.meta.funds_latest, 0)} sub="פעילות בחודש האחרון" />
        </section>
      )}

      <Panel title="חברות" aside={<Link to="/companies">כל החברות</Link>}>
        <div className="grid3">
          {reg.data?.slice(0, 15).map((c) => {
            const g = m ? m.groupIndex(c.market_group ?? '') : -1;
            return (
              <Link key={c.id} to={`/company/${c.id}`} className="card">
                <h3>{c.name_he} {c.name_en && <span className="muted" style={{ fontWeight: 400 }}>{c.name_en}</span>}</h3>
                <div className="row">{c.has_financials && <span className="chip loaded">נתונים: {c.filings[0]?.period}</span>}{c.docs > 0 && <span className="chip">{c.docs} מסמכים</span>}</div>
                {m && g >= 0 && <div className="row"><span className="big num">{nf(m.value('assets', L, 'm', 'all', g) ?? 0, 0)}</span><span className="muted">מיליארד ש"ח נכסים · נתח <span className="num">{pct(m.value('share', L, 'm', 'all', g), 1)}</span></span></div>}
              </Link>
            );
          })}
        </div>
      </Panel>

    </>
  );
}
