import { Scene3D } from '../components/Icon3D';
import { Link } from 'react-router-dom';
import { Search } from '../components/Search';
import { Logo } from '../components/Logo';
import { Count } from '../components/Count';
import { Sourced } from '../components/Source';
import type { Prov } from '../lib/prov';
import { nf, pct, pubLabel } from '../lib/format';
import { useKpis, useLoad, useMarket, useRegistry } from '../lib/useData';
import type { DocEntry } from '../lib/types';
import { useStored, useWatchlist } from '../lib/local';
import { Star } from '../components/Follow';
import { Fragment, useEffect, useMemo } from 'react';
import { periodLabelShort, periodTag } from '../lib/kpi';
import '../styles/market.css';

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
  const latest = useLoad<{ docs: (DocEntry & { company: string })[] }>('filings_latest.json');
  const filings = useMemo(() => (latest.data?.docs ?? []).filter((x) => !x.en).slice(0, 10), [latest.data]);
  const TYPE: Record<string, string> = { annual: 'דוח שנתי', quarterly: 'דוח רבעוני', presentation: 'מצגת', solvency: 'כושר פירעון' };
  const L = m?.LAST ?? 0;
  const fam = (s: string) => (m ? m.cell(L, s, -1).a / 1000 : null);
  // a subsidiary (more_gemel under more) shares its holding's market group: it gets a sub-row, not a second company with the same figures
  const holdingOf = (c: { id: string; market_group: string | null }) => (reg.data ?? []).find((x) => x.id !== c.id && c.id.startsWith(`${x.id}_`) && x.market_group === c.market_group);
  const rows = (reg.data ?? []).filter((c) => !holdingOf(c)).map((c) => {
    const k = kpis?.get(c.id);
    const q = k?.latest('profit', 'q') ?? null;
    const prior = q && k ? k.series('profit', 'q').find((p) => p.period === `${Number(q.period.slice(0, 4)) - 1}${q.period.slice(4)}`)?.v ?? null : null;
    const g = m ? m.groupIndex(c.market_group ?? '') : -1;
    return { c, k, g, qprior: prior, q, yoy: q?.v != null && prior != null && prior > 0 && q.v > 0 ? (q.v / prior - 1) * 100 : null, ltm: k?.latest('profit', 'ltm') ?? null, eq: k?.latest('equity') ?? null, roe: k?.latest('roe') ?? null,
      aum: m && g >= 0 ? m.value('assets', L, 'm', 'all', g) : null };
  }).sort((a, b) => Number(watch.has(b.c.id)) - Number(watch.has(a.c.id)) || (b.eq?.v ?? -1) - (a.eq?.v ?? -1) || (b.aum ?? 0) - (a.aum ?? 0));
  const growthProv = (label: string, s: string): Prov => {
    const g = m!.growth(L, 'ltm', s, -1), b = L - 12, title = `${label} · שינוי YoY · ${m!.plabel(L)}`;
    if (g == null || b < 0) return { k: 'none', title, why: 'אין נתון לפני 12 חודשים' };
    return { k: 'calc', title, value: pct(g, 1, true), formula: 'נכסים בחודש האחרון ÷ נכסים 12 חודשים קודם, פחות 1', inputs: [
      { label: m!.plabel(L), v: nf(m!.value('assets', L, 'm', s, -1) ?? 0, 1), src: () => ({ k: 'reg', metric: 'assets', pi: L, w: 'm', set: s, g: -1 }) },
      { label: m!.plabel(b), v: nf(m!.value('assets', b, 'm', s, -1) ?? 0, 1), src: () => ({ k: 'reg', metric: 'assets', pi: b, w: 'm', set: s, g: -1 }) }] };
  };
  return (
    <>
      <header className="mast">
        <div>
          <h1>fox<span>.</span></h1>
          <p className="tagline">ביטוח, פנסיה וגמל. מהדוח, עם עמוד המקור.</p>
          <Search big />
        </div>
        <div className="mark"><Logo size={170} animated /></div>
        <Scene3D />
      </header>

      {m && (
        <section className="kpis">
          {([['סך נכסים מנוהלים', 'all'], ['פנסיה', 'fam:pension'], ['גמל והשתלמות', 'fam:gemel'], ['ביטוחי מנהלים ופוליסות חיסכון', 'fam:insurance']] as const).map(([label, s]) => (
            <div className="kpi" key={s}>
              <div className="l">{label}</div>
              <div className="v num"><Sourced src={() => ({ k: 'reg', metric: 'assets', pi: L, w: 'm', set: s, g: -1 })}><Count value={fam(s)} /></Sourced></div>
              <div className="s">מיליארד ש"ח · <Sourced className={`num ${(m.growth(L, 'ltm', s, -1) ?? 0) >= 0 ? 'pos' : 'neg'}`} src={() => growthProv(label, s)}>{pct(m.growth(L, 'ltm', s, -1), 1, true)}</Sourced> YoY · {m.plabel(L)}</div>
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
                <td>{f.pages != null && <Sourced className="num muted" src={() => ({ k: 'report', title: `מספר עמודים · ${TYPE[f.type] ?? f.type}`, value: String(f.pages), unit: 'עמודים', url: f.url, pg: null, doc: TYPE[f.type] ?? f.type, period: f.period.endsWith('FY') ? `FY'${f.period.slice(2, 4)}` : `${f.period.slice(4)}'${f.period.slice(2, 4)}` })}>{f.pages} עמ׳</Sourced>}</td>
                <td><span className="num">{pubLabel(f.date)}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      <section className="panel">
        <div className="hd"><h2>חברות</h2><div className="aside"><span>מיליוני ש"ח, מהדוח האחרון</span><Link to="/industry/matrix">מטריצת עמיתים</Link><Link to="/funds/makers">יצרן מול השוק</Link></div></div>
        <div className="scroll"><table className="rank">
          <thead><tr><th>חברה</th><th>דוח אחרון</th><th>רווח נקי, QTD</th><th>YoY</th><th>רווח נקי, LTM</th><th>הון</th><th>ROE, LTM <span className="chip est">נגזר</span></th><th>נכסים מנוהלים, מיליארד</th><th>מסמכים</th></tr></thead>
          <tbody>{rows.map(({ c, k, g, qprior, q, yoy, ltm, eq, roe, aum }) => (
            <Fragment key={c.id}>
            <tr>
              <td><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Star id={c.id} name={c.name_he} /><span><Link to={`/company/${c.id}`}>{c.name_he}</Link><span className="dim">{KIND[c.kind] ?? ''}</span></span></span></td>
              <td>{q ? <span className="num">{periodLabelShort(q.period)}</span> : <span className="muted">–</span>}</td>
              <td>{q?.v != null ? <Sourced className={`num ${q.v < 0 ? 'neg' : ''}`} src={() => k!.explain('profit', 'q', q.period)}>{nf(q.v, 0)}</Sourced> : <span className="muted">–</span>}</td>
              <td>{yoy != null ? <Sourced className={`num ${yoy < 0 ? 'neg' : 'pos'}`} src={() => { const pp = `${Number(q!.period.slice(0, 4)) - 1}${q!.period.slice(4)}`; return { k: 'calc', title: `רווח נקי, YoY · ${c.name_he} · ${periodTag(q!.period)}`, value: pct(yoy, 1, true), formula: 'רווח נקי ברבעון ÷ הרווח באותו רבעון בשנה הקודמת, פחות 1', inputs: [{ label: periodTag(q!.period), v: nf(q!.v!, 0), src: () => k!.explain('profit', 'q', q!.period) }, { label: periodTag(pp), v: nf(qprior!, 0), src: () => k!.explain('profit', 'q', pp) }] } as Prov; }}>{pct(yoy, 1, true)}</Sourced> : <span className="muted">–</span>}</td>
              <td>{ltm?.v != null ? <Sourced className="num" src={() => k!.explain('profit', 'ltm', ltm.period)}>{nf(ltm.v, 0)}</Sourced> : <span className="muted">–</span>}</td>
              <td>{eq?.v != null ? <Sourced className="num" src={() => k!.explain('equity', 'ltm', eq.period)}>{nf(eq.v, 0)}</Sourced> : <span className="muted">–</span>}</td>
              <td>{roe?.v != null ? <Sourced className="num" src={() => k!.explain('roe', 'ltm', roe.period)}>{pct(roe.v, 1)}</Sourced> : <span className="muted">–</span>}</td>
              <td>{aum != null ? <Sourced className="num" src={() => ({ k: 'reg', metric: 'assets', pi: L, w: 'm', set: 'all', g })}>{nf(aum, 0)}</Sourced> : <span className="muted">–</span>}</td>
              <td>{c.docs > 0 ? <Link className="num" to={`/company/${c.id}/filings`}>{c.docs}</Link> : <span className="muted">–</span>}</td>
            </tr>
            {(reg.data ?? []).filter((x) => holdingOf(x)?.id === c.id).map((x) => (
              <tr key={x.id} className="subrow">
                <td><Link to={`/company/${x.id}`}>{x.name_he}</Link><span className="dim">חברה בת, נכללת בנתוני {c.name_he}</span></td>
                <td colSpan={7} />
                <td>{x.docs > 0 ? <Link className="num" to={`/company/${x.id}/filings`}>{x.docs}</Link> : <span className="muted">–</span>}</td>
              </tr>
            ))}
            </Fragment>
          ))}</tbody>
        </table></div>
      </section>
    </>
  );
}
