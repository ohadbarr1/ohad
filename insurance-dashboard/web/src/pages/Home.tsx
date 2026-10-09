import { Link } from 'react-router-dom';
import { Search } from '../components/Search';
import { Logo } from '../components/Logo';
import { Count } from '../components/Count';
import { nf, pct } from '../lib/format';
import { useKpis, useMarket, useRegistry } from '../lib/useData';
import type { CompanyKpi } from '../lib/kpi';
import type { RegistryCompany } from '../lib/types';
import type { Market } from '../lib/market';

function CompanyCard({ c, m, k, i }: { c: RegistryCompany; m: Market | null; k: CompanyKpi | undefined; i: number }) {
  const g = m ? m.groupIndex(c.market_group ?? '') : -1;
  const pb = k?.latest('pb'), roe = k?.latest('roe');
  return (
    <Link to={`/company/${c.id}`} className="card" style={{ ['--i' as string]: i }}>
      <h3>{c.name_he} <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>{c.name_en}</span></h3>
      <div className="row">
        {pb?.v != null && <span className="chip est" title="נגזר: מחיר כפול מספר מניות משוער, חלקי הון">P/B <span className="num">{nf(pb.v, 2)}</span></span>}
        {roe?.v != null && <span className="chip">ROE <span className="num">{pct(roe.v, 1)}</span></span>}
      </div>
      <div className="row muted" style={{ fontSize: 12 }}>
        {m && g >= 0 && <span>נכסים <span className="num">{nf(m.value('assets', m.LAST, 'm', 'all', g) ?? 0, 0)}</span> מיליארד</span>}
        {c.docs > 0 && <span>· <span className="num">{c.docs}</span> מסמכים</span>}
      </div>
    </Link>
  );
}

export function Home() {
  const { market: m } = useMarket();
  const reg = useRegistry();
  const { kpis } = useKpis();
  const L = m?.LAST ?? 0;
  const fam = (s: string) => (m ? m.cell(L, s, -1).a / 1000 : null);
  return (
    <>
      <section className="hero">
        <div>
          <h1>fox<span>.</span></h1>
          <p className="tagline">ביטוח, פנסיה וגמל. מהדוח, עם עמוד המקור.</p>
          <Search big />
        </div>
        <div className="mark"><Logo size={168} animated /></div>
      </section>

      {m && (
        <section className="kpis">
          {([['סך נכסים', 'all'], ['פנסיה', 'fam:pension'], ['גמל והשתלמות', 'fam:gemel'], ['פוליסות חיסכון', 'fam:insurance']] as const).map(([label, s]) => (
            <div className="kpi" key={s}>
              <div className="l">{label}</div>
              <div className="v num"><Count value={fam(s)} /></div>
              <div className="s">מיליארד ש"ח · <span className={`num ${(m.growth(L, 'ltm', s, -1) ?? 0) >= 0 ? 'pos' : 'neg'}`}>{pct(m.growth(L, 'ltm', s, -1), 1, true)}</span> בשנה</div>
            </div>
          ))}
          <div className="kpi"><div className="l">קופות ומסלולים</div><div className="v num"><Count value={m.d.meta.funds_latest} /></div><div className="s">{m.plabel(L)} · רשות שוק ההון</div></div>
        </section>
      )}

      <section>
        <h2 className="band">חברות</h2>
        <div className="grid3 stagger">{reg.data?.map((c, i) => <CompanyCard key={c.id} c={c} m={m} k={kpis?.get(c.id)} i={i} />)}</div>
      </section>
    </>
  );
}
