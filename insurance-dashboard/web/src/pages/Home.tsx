import { Link } from 'react-router-dom';
import { Sourced } from '../components/Source';
import { Seg } from '../components/ui';
import { Icon } from '../components/Icon';
import type { Prov } from '../lib/prov';
import type { MetricKey } from '../lib/market';
import { cls, nf, pct } from '../lib/format';
import { useKpis, useMarket, useRegistry } from '../lib/useData';
import { useStored, useWatchlist } from '../lib/local';
import { Star } from '../components/Follow';
import { SinceDot } from '../components/SinceBadge';
import { usePhone } from '../lib/useMedia';
import { SeasonStrip } from '../components/home/SeasonStrip';
import { CompanyList, type ListRow } from '../components/home/CompanyList';
import { DataTable } from '../components/DataTable';
import { periodLabelShort, periodTag } from '../lib/kpi';
import { MacroPanel } from '../components/MacroPanel';
import { DensityToggle } from '../components/MacroDensity';
import '../lib/density';
import '../styles/market.css';
import '../styles/home.css';

const KIND: Record<string, string> = { insurance_group: 'ביטוח', fund_house: 'בית השקעות' };
/** where an analyst goes next from the season desk (docs/HOME.md §5) */
const JUMP: [string, string][] = [['/industry/peers', 'טבלת עמיתים'], ['/industry/csm', 'IFRS 17 · CSM'], ['/industry/savings', 'עדשת חיסכון'], ['/valuation', 'הערכת שווי'], ['/restatements', 'הצגות מחדש'], ['/calendar', 'לוח דיווחים']];
type View = 'fin' | 'mkt';
type Kind = 'all' | 'insurance_group' | 'fund_house';

/** The season desk (docs/HOME.md): the season in one line, every company's latest quarter (a ranked list on a phone, the full table on a
 *  desktop), the long-term-savings market in four numbers and the macro inputs. Filings themselves live on the calendar and the company pages. */
export function Home() {
  const { market: m } = useMarket(true, true);
  const reg = useRegistry();
  const { kpis } = useKpis();
  const watch = useWatchlist();
  const phone = usePhone();
  const [view, setView] = useStored<View>('home.view', 'fin');
  const [kind, setKind] = useStored<Kind>('home.kind', 'all');
  const L = m?.LAST ?? 0;
  const fam = (s: string) => (m ? m.cell(L, s, -1).a / 1000 : null);
  const all = reg.data ?? [];
  // a subsidiary (more_gemel under more) shares its holding's market group: it gets a sub-row, not a second company with the same figures
  const holdingOf = (c: { id: string; market_group: string | null }) => all.find((x) => x.id !== c.id && c.id.startsWith(`${x.id}_`) && x.market_group === c.market_group);
  const rows = all.filter((c) => !holdingOf(c) && (kind === 'all' || c.kind === kind)).map((c) => {
    // where the listed filer is another entity (Yelin Lapidot, held 50% by Atrao), the row shows the company itself at 100%, from its own statements
    const kf = kpis?.get(c.id), k = kf?.entity ?? kf;
    const q = k?.latest('profit', 'q') ?? null;
    const prior = q && k ? k.series('profit', 'q').find((p) => p.period === `${Number(q.period.slice(0, 4)) - 1}${q.period.slice(4)}`)?.v ?? null : null;
    const g = m ? m.groupIndex(c.market_group ?? '') : -1;
    return { c, k, filer: kf?.filer, g, qprior: prior, q, yoy: q?.v != null && prior != null && prior > 0 && q.v > 0 ? (q.v / prior - 1) * 100 : null, ltm: k?.latest('profit', 'ltm') ?? null, eq: k?.latest('equity') ?? null, roe: k?.latest('roe') ?? null,
      aum: m && g >= 0 ? m.value('assets', L, 'm', 'all', g) : null };
  });
  // the latest report season on the page; a company whose last figures are more than two quarters older is marked and sorted last
  const qi = (p?: string | null) => (p ? Number(p.slice(0, 4)) * 4 + (p.endsWith('FY') ? 4 : Number(p.slice(5))) : null);
  const season = Math.max(...rows.map((r) => qi(r.q?.period) ?? 0));
  const isStale = (r: { q: { period: string } | null }) => { const i = qi(r.q?.period); return i != null && season - i > 2; };
  rows.sort((a, b) => Number(isStale(a)) - Number(isStale(b)) || Number(watch.has(b.c.id)) - Number(watch.has(a.c.id)) || (b.eq?.v ?? -1) - (a.eq?.v ?? -1) || (b.aum ?? 0) - (a.aum ?? 0));
  const growthProv = (label: string, s: string, g = -1): Prov => {
    const gr = m!.growth(L, 'ltm', s, g), b = L - 12, title = `${label} · שינוי YoY · ${m!.plabel(L)}`;
    if (gr == null || b < 0) return { k: 'none', title, why: 'אין נתון לפני 12 חודשים' };
    return { k: 'calc', title, value: pct(gr, 1, true), formula: 'נכסים בחודש האחרון ÷ נכסים 12 חודשים קודם, פחות 1', inputs: [
      { label: m!.plabel(L), v: nf(m!.value('assets', L, 'm', s, g) ?? 0, 1), src: () => ({ k: 'reg', metric: 'assets', pi: L, w: 'm', set: s, g }) },
      { label: m!.plabel(b), v: nf(m!.value('assets', b, 'm', s, g) ?? 0, 1), src: () => ({ k: 'reg', metric: 'assets', pi: b, w: 'm', set: s, g }) }] };
  };
  const dash = <span className="muted">–</span>;
  const regV = (g: number, metric: MetricKey, set = 'all', w: 'ltm' | 'm' = 'ltm') => (m && g >= 0 ? m.value(metric, L, w, set, g) : null);
  const regCell = (g: number, metric: MetricKey, fmt: (v: number) => string, set = 'all', w: 'ltm' | 'm' = 'ltm', tone = false) => {
    const v = m && g >= 0 ? m.value(metric, L, w, set, g) : null;
    if (v == null) return dash;
    return <Sourced className={`num${tone ? ` ${cls(v)}` : ''}`} src={() => (metric === 'growth' ? growthProv('נכסים', 'all', g) : { k: 'reg', metric, pi: L, w, set, g })}>{fmt(v)}</Sourced>;
  };

  // the phone list: the market view ranks by assets; the statements view keeps the table's order (watched first, then by equity)
  const listSrc = view === 'mkt' ? [...rows].sort((a, b) => Number(isStale(a)) - Number(isStale(b)) || Number(watch.has(b.c.id)) - Number(watch.has(a.c.id)) || (b.aum ?? -1) - (a.aum ?? -1)) : rows;
  const listRows: ListRow[] = phone ? listSrc.map((r) => {
    const { c, k, q, filer } = r, stale = isStale(r);
    const yoyProv = (): Prov => { const pp = `${Number(q!.period.slice(0, 4)) - 1}${q!.period.slice(4)}`; return { k: 'calc', title: `רווח נקי, YoY · ${c.name_he} · ${periodTag(q!.period)}`, value: pct(r.yoy, 1, true), formula: 'רווח נקי ברבעון ÷ הרווח באותו רבעון בשנה הקודמת, פחות 1', inputs: [{ label: periodTag(q!.period), v: nf(q!.v!, 0), src: () => k!.explain('profit', 'q', q!.period) }, { label: periodTag(pp), v: nf(r.qprior!, 0), src: () => k!.explain('profit', 'q', pp) }] }; };
    const fin = view === 'fin';
    const fig = fin
      ? (q?.v != null && k ? <Sourced className={`num${q.v < 0 ? ' neg' : ''}`} src={() => k.explain('profit', 'q', q.period)}>{nf(q.v, 0)}</Sourced> : null)
      : (regV(r.g, 'assets') != null ? regCell(r.g, 'assets', (v) => nf(v, 1)) : null);
    const subs = fin
      ? [r.yoy != null && <>YoY <Sourced className={`num ${cls(r.yoy)}`} src={yoyProv}>{pct(r.yoy, 1, true)}</Sourced></>,
        r.roe?.v != null && k && <>ROE <Sourced className="num" src={() => k.explain('roe', 'ltm', r.roe!.period)}>{pct(r.roe.v, 1)}</Sourced></>].filter(Boolean)
      : [regV(r.g, 'share') != null && <>נתח {regCell(r.g, 'share', (v) => pct(v, 1))}</>, regV(r.g, 'growth') != null && <>YoY {regCell(r.g, 'growth', (v) => pct(v, 1, true), 'all', 'ltm', true)}</>].filter(Boolean);
    return { id: c.id, name: c.name_he, stale, figUnit: '', fig, subs,
      meta: [KIND[c.kind] ?? '', fin && q ? periodLabelShort(q.period) : ''].filter(Boolean).join(' · '),
      chips: (filer || (stale && q)) ? <>{filer && <span className="chip est" title={filer.note}>{`${filer.name.split(' ')[0]} מחזיקה ${filer.stake}%`}</span>}{stale && q && <span className="chip stale">{`נתון ישן · ${periodLabelShort(q.period)}`}</span>}</> : undefined,
      children: all.filter((x) => holdingOf(x)?.id === c.id).map((x) => ({ id: x.id, name: x.name_he, note: `חברה בת, נכללת בנתוני ${c.name_he}` })) };
  }) : [];

  return (
    <div className="wide-page home">
      <h1 className="sr-only">fox · ביטוח, פנסיה וגמל</h1>
      <SeasonStrip />
      <div className="home-grid">
        <div className="home-main">
          <section className="panel cos">
            <div className="hd"><h2><span className="icotile"><Icon name="companies" /></span>חברות</h2><div className="aside">{phone ? <Seg label="תצוגה" value={view} onChange={setView} options={[['fin', 'דוחות'], ['mkt', 'שוק']]} /> : <><DensityToggle /><Link to="/industry/peers">טבלת עמיתים</Link><Link to="/valuation">הערכת שווי</Link></>}</div></div>
            <div className="cos-ctl">
              <Seg label="סוג" value={kind} onChange={setKind} options={[['all', 'הכול'], ['insurance_group', 'ביטוח'], ['fund_house', 'בתי השקעות']]} />
              {!phone && <span className="view-seg"><Seg label="תצוגה" value={view} onChange={setView} options={[['fin', 'דוחות'], ['mkt', 'שוק ודמי ניהול']]} /></span>}
              <span className="muted unit">{view === 'fin' ? (phone ? <>רווח נקי ברבעון האחרון, מיליוני ש"ח · ROE, LTM <span className="chip est">נגזר</span></> : 'מיליוני ש"ח, מהדוח האחרון') : `${phone ? 'נכסים, מיליארד ש"ח · ' : ''}רשות שוק ההון · ${m?.plabel(L) ?? ''}`}</span>
            </div>
            {phone ? <CompanyList rows={listRows} label={view === 'fin' ? 'חברות, רווח נקי ברבעון האחרון' : 'חברות, נכסים מנוהלים'} /> : (
              <DataTable className={`rank cos-t v-${view}`} caption="חברות" rows={rows} rowKey={(r) => r.c.id} rowClass={(r) => (isStale(r) ? 'stale' : undefined)}
                export={{ name: `fox-companies-${view}`, title: view === 'fin' ? 'חברות · דוחות' : 'חברות · שוק ודמי ניהול', note: view === 'fin' ? 'מיליוני ש"ח · XBRL של הדוחות התקופתיים' : `רשות שוק ההון · ${m?.plabel(L) ?? ''}` }}
                after={({ c }) => all.filter((x) => holdingOf(x)?.id === c.id).map((x) => (
                  <tr key={x.id} className="subrow">
                    <td><Link to={`/company/${x.id}`}>{x.name_he}</Link><span className="dim">חברה בת, נכללת בנתוני {c.name_he}</span></td>
                    <td className="c-fin" colSpan={6} /><td className="c-mkt" colSpan={6} />
                    <td>{x.docs > 0 ? <Link className="num" to={`/company/${x.id}/filings`}>{x.docs}</Link> : dash}</td>
                  </tr>
                ))}
                columns={[
                  { key: 'co', head: 'חברה', value: ({ c }) => c.name_he, cell: ({ c, filer, q }) => <span className="coname"><Star id={c.id} name={c.name_he} /><span><Link to={`/company/${c.id}`}>{c.name_he}</Link><SinceDot id={c.id} /><span className="dim">{KIND[c.kind] ?? ''}</span>{filer && <span className="chip est" title={filer.note}>{`${filer.name.split(' ')[0]} מחזיקה ${filer.stake}%`}</span>}{q && isStale({ q }) && <span className="chip stale" title="הדוח האחרון בנתונים ישן ביותר משני רבעונים מהעונה האחרונה">{`נתון ישן · ${periodLabelShort(q.period)}`}</span>}</span></span> },
                  { key: 'per', head: 'דוח אחרון', className: 'c-fin', noExport: view !== 'fin', value: ({ q }) => q?.period, text: ({ q }) => (q ? periodLabelShort(q.period) : ''), cell: ({ q }) => (q ? <span className="num">{periodLabelShort(q.period)}</span> : dash) },
                  { key: 'q', head: 'רווח נקי, QTD', className: 'c-fin', noExport: view !== 'fin', value: ({ q }) => q?.v, unit: 'int', tone: 'neg', src: ({ k, q }) => k!.explain('profit', 'q', q!.period) },
                  { key: 'yoy', head: 'YoY', className: 'c-fin', noExport: view !== 'fin', value: ({ yoy }) => yoy, unit: 'pct', signed: true, tone: true, src: ({ c, k, q, qprior, yoy }) => { const pp = `${Number(q!.period.slice(0, 4)) - 1}${q!.period.slice(4)}`; return { k: 'calc', title: `רווח נקי, YoY · ${c.name_he} · ${periodTag(q!.period)}`, value: pct(yoy, 1, true), formula: 'רווח נקי ברבעון ÷ הרווח באותו רבעון בשנה הקודמת, פחות 1', inputs: [{ label: periodTag(q!.period), v: nf(q!.v!, 0), src: () => k!.explain('profit', 'q', q!.period) }, { label: periodTag(pp), v: nf(qprior!, 0), src: () => k!.explain('profit', 'q', pp) }] }; } },
                  { key: 'ltm', head: 'רווח נקי, LTM', className: 'c-fin', noExport: view !== 'fin', value: ({ ltm }) => ltm?.v, unit: 'int', src: ({ k, ltm }) => k!.explain('profit', 'ltm', ltm!.period) },
                  { key: 'eq', head: 'הון', className: 'c-fin', noExport: view !== 'fin', value: ({ eq }) => eq?.v, unit: 'int', src: ({ k, eq }) => k!.explain('equity', 'ltm', eq!.period) },
                  { key: 'roe', head: <>ROE, LTM <span className="chip est">נגזר</span></>, label: 'ROE, LTM (נגזר)', className: 'c-fin', noExport: view !== 'fin', value: ({ roe }) => roe?.v, unit: 'pct', src: ({ k, roe }) => k!.explain('roe', 'ltm', roe!.period) },
                  { key: 'aum', head: 'נכסים, מיליארד', className: 'c-mkt', noExport: view !== 'mkt', value: ({ g }) => regV(g, 'assets'), cell: ({ g }) => regCell(g, 'assets', (v) => nf(v, 1)) },
                  { key: 'share', head: 'נתח שוק', className: 'c-mkt', noExport: view !== 'mkt', value: ({ g }) => regV(g, 'share'), cell: ({ g }) => regCell(g, 'share', (v) => pct(v, 1)) },
                  { key: 'growth', head: 'נכסים YoY', className: 'c-mkt', noExport: view !== 'mkt', value: ({ g }) => regV(g, 'growth'), cell: ({ g }) => regCell(g, 'growth', (v) => pct(v, 1, true), 'all', 'ltm', true) },
                  { key: 'organic', head: 'צבירה אורגנית, LTM', className: 'c-mkt', noExport: view !== 'mkt', value: ({ g }) => regV(g, 'organic'), cell: ({ g }) => regCell(g, 'organic', (v) => nf(v, 1), 'all', 'ltm', true) },
                  { key: 'feep', head: 'דמי ניהול, פנסיה', className: 'c-mkt', noExport: view !== 'mkt', value: ({ g }) => regV(g, 'fee', 'fam:pension', 'm'), cell: ({ g }) => regCell(g, 'fee', (v) => pct(v, 2), 'fam:pension', 'm') },
                  { key: 'feeg', head: 'דמי ניהול, גמל', className: 'c-mkt', noExport: view !== 'mkt', value: ({ g }) => regV(g, 'fee', 'fam:gemel', 'm'), cell: ({ g }) => regCell(g, 'fee', (v) => pct(v, 2), 'fam:gemel', 'm') },
                  { key: 'docs', head: 'מסמכים', value: ({ c }) => c.docs || null, cell: ({ c }) => (c.docs > 0 ? <Link className="num" to={`/company/${c.id}/filings`}>{c.docs}</Link> : dash) },
                ]} />)}
            <div className="src">רווח, הון ו-ROE: XBRL של הדוחות התקופתיים (ילין לפידות: הדוחות הכספיים שלה, 100%) · נכסים, צבירה ודמי ניהול: רשות שוק ההון (פנסיה, גמל, ביטוחי מנהלים ופוליסות חיסכון; צבירה: פנסיה וגמל)</div>
          </section>
        </div>
        <div className="home-side">
          {m && (
            <section className="kpis hm-kpis" aria-label="חיסכון ארוך טווח">
              {([['סך נכסים מנוהלים', 'all'], ['פנסיה', 'fam:pension'], ['גמל והשתלמות', 'fam:gemel'], ['ביטוחי מנהלים ופוליסות חיסכון', 'fam:insurance']] as const).map(([label, s]) => (
                <div className="kpi" key={s}>
                  <div className="l">{label}</div>
                  <div className="v num"><Sourced src={() => ({ k: 'reg', metric: 'assets', pi: L, w: 'm', set: s, g: -1 })}>{fam(s) == null ? '–' : nf(fam(s)!, 0)}</Sourced></div>
                  <div className="s">מיליארד ש"ח · <Sourced className={`num ${(m.growth(L, 'ltm', s, -1) ?? 0) >= 0 ? 'pos' : 'neg'}`} src={() => growthProv(label, s)}>{pct(m.growth(L, 'ltm', s, -1), 1, true)}</Sourced> YoY · {m.plabel(L)}</div>
                </div>
              ))}
            </section>
          )}
          <MacroPanel compact />
          <nav className="hm-jump" aria-label="מעבר מהיר">{JUMP.map(([to, l]) => <Link key={to} to={to}>{l}</Link>)}</nav>
        </div>
      </div>
    </div>
  );
}
