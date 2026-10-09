import { Link } from 'react-router-dom';
import { Search } from '../components/Search';
import { Logo } from '../components/Logo';
import { Count } from '../components/Count';
import { nf, pct } from '../lib/format';
import { useDocsOf, useKpis, useMarket, useRegistry } from '../lib/useData';
import { useStored, useWatchlist } from '../lib/local';
import { Star } from '../components/Follow';
import { useEffect, useMemo } from 'react';
import { periodLabelShort } from '../lib/kpi';

const KIND: Record<string, string> = { insurer: 'ביטוח', manager: 'בית השקעות', group: 'ביטוח' };

/** Front page: the search, the market in four numbers, and every company on one line with its latest reported figures. */
export function Home() {
  const { market: m } = useMarket();
  const reg = useRegistry();
  const { kpis } = useKpis();
  const watch = useWatchlist();
  // filings published since the previous visit are marked; the visit date moves forward when the page is left
  const [seen, setSeen] = useStored<string>('seen', '');
  const today = new Date().toISOString().slice(0, 10);
  useEffect(() => () => setSeen(today), [setSeen, today]);
  const withDocs = useMemo(() => (reg.data ?? []).filter((c) => c.docs > 0).map((c) => c.id), [reg.data]);
  const filings = useDocsOf(withDocs).filter((x) => !x.en).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 10);
  const TYPE: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'כושר פירעון' };
  const L = m?.LAST ?? 0;
  const fam = (s: string) => (m ? m.cell(L, s, -1).a / 1000 : null);
  const rows = (reg.data ?? []).map((c) => {
    const k = kpis?.get(c.id);
    const q = k?.latest('profit', 'q') ?? null;
    const prior = q && k ? k.series('profit', 'q').find((p) => p.period === `${Number(q.period.slice(0, 4)) - 1}${q.period.slice(4)}`)?.v ?? null : null;
    const g = m ? m.groupIndex(c.market_group ?? '') : -1;
    return { c, q, yoy: q?.v != null && prior != null && prior > 0 && q.v > 0 ? (q.v / prior - 1) * 100 : null, ltm: k?.latest('profit', 'ltm') ?? null, eq: k?.latest('equity') ?? null, roe: k?.latest('roe') ?? null,
      aum: m && g >= 0 ? m.value('assets', L, 'm', 'all', g) : null };
  }).sort((a, b) => Number(watch.has(b.c.id)) - Number(watch.has(a.c.id)) || (b.eq?.v ?? -1) - (a.eq?.v ?? -1) || (b.aum ?? 0) - (a.aum ?? 0));
  return (
    <>
      <header className="mast">
        <div>
          <h1>fox<span>.</span></h1>
          <p className="tagline">ביטוח, פנסיה וגמל. מהדוח, עם עמוד המקור.</p>
          <Search big />
        </div>
        <div className="mark"><Logo size={170} animated /></div>
      </header>

      {m && (
        <section className="kpis">
          {([['סך נכסים מנוהלים', 'all'], ['פנסיה', 'fam:pension'], ['גמל והשתלמות', 'fam:gemel'], ['ביטוחי מנהלים ופוליסות חיסכון', 'fam:insurance']] as const).map(([label, s]) => (
            <div className="kpi" key={s}>
              <div className="l">{label}</div>
              <div className="v num"><Count value={fam(s)} /></div>
              <div className="s">מיליארד ש"ח · <span className={`num ${(m.growth(L, 'ltm', s, -1) ?? 0) >= 0 ? 'pos' : 'neg'}`}>{pct(m.growth(L, 'ltm', s, -1), 1, true)}</span> YoY · {m.plabel(L)}</div>
            </div>
          ))}
        </section>
      )}

      {filings.length > 0 && (
        <section className="panel">
          <div className="hd"><h2>דיווחים אחרונים</h2><div className="aside"><span>MAYA · עברית</span></div></div>
          <div className="scroll"><table>
            <tbody>{filings.map((f) => (
              <tr key={f.id}>
                <td><Link to={`/company/${f.company}/review`}>{reg.data?.find((c) => c.id === f.company)?.name_he ?? f.company}</Link>{seen && f.date > seen && <span className="chip loaded" style={{ marginInlineStart: 8 }}>חדש</span>}</td>
                <td style={{ textAlign: 'start' }}><a href={f.url} target="_blank" rel="noreferrer">{TYPE[f.type] ?? f.type}</a> <span className="muted">{f.period.endsWith('FY') ? `FY'${f.period.slice(2, 4)}` : `${f.period.slice(4)}'${f.period.slice(2, 4)}`}</span></td>
                <td>{f.pages != null && <span className="num muted">{f.pages} עמ׳</span>}</td>
                <td><span className="num">{f.date}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      <section className="panel">
        <div className="hd"><h2>חברות</h2><div className="aside"><span>מיליוני ש"ח, מהדוח האחרון</span><Link to="/industry/matrix">מטריצת עמיתים</Link></div></div>
        <div className="scroll"><table className="rank">
          <thead><tr><th>חברה</th><th>דוח אחרון</th><th>רווח נקי, QTD</th><th>YoY</th><th>רווח נקי, LTM</th><th>הון</th><th>ROE, LTM <span className="chip est">נגזר</span></th><th>נכסים מנוהלים, מיליארד</th><th>מסמכים</th></tr></thead>
          <tbody>{rows.map(({ c, q, yoy, ltm, eq, roe, aum }) => (
            <tr key={c.id}>
              <td><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Star id={c.id} name={c.name_he} /><span><Link to={`/company/${c.id}`}>{c.name_he}</Link><span className="dim">{KIND[c.kind] ?? ''}</span></span></span></td>
              <td>{q ? <span className="num">{periodLabelShort(q.period)}</span> : <span className="muted">–</span>}</td>
              <td>{q?.v != null ? <span className={`num ${q.v < 0 ? 'neg' : ''}`}>{nf(q.v, 0)}</span> : <span className="muted">–</span>}</td>
              <td>{yoy != null ? <span className={`num ${yoy < 0 ? 'neg' : 'pos'}`}>{pct(yoy, 1, true)}</span> : <span className="muted">–</span>}</td>
              <td>{ltm?.v != null ? <span className="num">{nf(ltm.v, 0)}</span> : <span className="muted">–</span>}</td>
              <td>{eq?.v != null ? <span className="num">{nf(eq.v, 0)}</span> : <span className="muted">–</span>}</td>
              <td>{roe?.v != null ? <span className="num">{pct(roe.v, 1)}</span> : <span className="muted">–</span>}</td>
              <td>{aum != null ? <span className="num">{nf(aum, 0)}</span> : <span className="muted">–</span>}</td>
              <td>{c.docs > 0 ? <Link className="num" to={`/company/${c.id}/filings`}>{c.docs}</Link> : <span className="muted">–</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}
