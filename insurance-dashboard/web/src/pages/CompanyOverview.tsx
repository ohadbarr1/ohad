import { Link } from 'react-router-dom';
import { MetricCard, type MetricCardProps } from '../components/MetricCard';
import { ErrorBox, Panel } from '../components/ui';
import { nf, pct, sn } from '../lib/format';
import type { CompanyStore } from '../lib/company';
import type { Market, MetricKey, Win } from '../lib/market';
import { METRIC_BY_KEY } from '../lib/market';
import { useCompanyDocs, useCompanyPrice, useKpis } from '../lib/useData';
import { periodLabelShort, type CompanyKpi } from '../lib/kpi';
import type { DocEntry, PriceData } from '../lib/types';
import { DOC_TYPE, useCtx } from './Company';

const tone = (v: number | null | undefined) => (v == null || v === 0 ? undefined : v > 0 ? ('pos' as const) : ('neg' as const));
const chg = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? (a / b - 1) * 100 : null);

function priceCards(p: PriceData): MetricCardProps[] {
  const from = p.dates.findIndex((d) => d >= '2019-01-01');
  const x = p.dates.slice(from).map((d) => d.slice(0, 4)), close = p.close.slice(from).map((v) => +(v / 100).toFixed(2));
  const yearAgo = p.close[Math.max(0, p.close.length - 53)];
  const byYear = new Map<string, number>();
  p.dividends.forEach(([d, v]) => { if (d >= '2019-01-01') byYear.set(d.slice(0, 4), (byYear.get(d.slice(0, 4)) ?? 0) + v); });
  const years = [...byYear.keys()].sort();
  const ttm = p.dividends.filter(([d]) => d > shiftIso(p.asof, -1)).reduce((s, [, v]) => s + v, 0);
  const cards: MetricCardProps[] = [{
    title: 'מחיר מניה', unit: 'ש"ח', value: nf(p.last / 100, 2), delta: { text: pct(chg(p.last, yearAgo), 1, true) + ' בשנה', tone: tone(chg(p.last, yearAgo)) },
    x, series: [{ name: 'סגירה שבועית', data: close }], kind: 'area', color: 2, dec: 2, foot: `${p.ticker} · ${p.source} · ${p.asof}`,
  }];
  if (years.length) cards.push({
    title: 'דיבידנד למניה', unit: 'ש"ח, 12 חודשים', value: nf(ttm / 100, 2), delta: ttm ? { text: `תשואה ${pct(ttm / p.last * 100, 1)}` } : undefined,
    x: years.map((y) => `'${y.slice(2)}`), series: [{ name: 'דיבידנד בשנה', data: years.map((y) => +((byYear.get(y) ?? 0) / 100).toFixed(2)) }], color: 5, dec: 2, foot: `${p.source} · לפי יום האקס`,
  });
  return cards;
}
function shiftIso(iso: string, years: number) { return `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`; }

function marketCards(m: Market, group: string): MetricCardProps[] {
  const g = m.groupIndex(group);
  if (g < 0) return [];
  const L = m.LAST;
  const pts = m.P.map((p, i) => ((p % 100 === 12 || i === L) && p >= 201012 ? i : -1)).filter((i) => i >= 0);
  const x = pts.map((i) => (i === L ? m.plabel(i) : `'${String(m.P[i]).slice(2, 4)}`));
  const to = `savings`;
  const one = (key: MetricKey, set: string, title: string, color: number, dec = 1): MetricCardProps => {
    const def = METRIC_BY_KEY[key], w: Win = def.win ? 'ltm' : 'm';
    const data = pts.map((i) => { const v = m.value(key, i, w, set, g); return v == null ? null : +v.toFixed(3); });
    const now = data[data.length - 1], prev = data[data.length - 2];
    const d = now != null && prev != null ? (def.unit === '%' ? { text: `${sn(now - prev, dec)} נק׳`, tone: key === 'fee' ? undefined : tone(now - prev) } : { text: pct(chg(now, prev), 1, true), tone: tone(chg(now, prev)) }) : undefined;
    return { title, unit: def.unit === '%' ? (def.win ? '%, 12 חודשים' : '%') : `מיליארד ש"ח${def.win ? ', 12 חודשים' : ''}`, value: now == null ? '–' : nf(now, dec), delta: key === 'assets' || ((key === 'share' || key === 'fee') && Math.abs(now! - prev!) >= 0.5 / 10 ** dec) ? d : undefined, x, series: [{ name: title, data }], color, dec, to };
  };
  const fams: [string, string][] = [['fam:pension', 'פנסיה'], ['fam:gemel', 'גמל והשתלמות'], ['fam:insurance', 'פוליסות חיסכון']];
  const stack: MetricCardProps = {
    title: 'נכסים לפי מוצר', unit: 'מיליארד ש"ח', value: nf(m.value('assets', L, 'm', 'all', g) ?? 0, 1), x, kind: 'stack', to,
    series: fams.map(([s, name], i) => ({ name, color: [0, 2, 4][i], data: pts.map((pi) => +(m.cell(pi, s, g).a / 1000).toFixed(2)) })),
  };
  return [one('assets', 'all', 'נכסים מנוהלים', 0), stack, one('share', 'all', 'נתח שוק', 7), one('organic', 'all', 'צבירה אורגנית', 3), one('transfers', 'all', 'ניוד נטו', 4),
    one('fee', 'fam:pension', 'דמי ניהול, פנסיה', 6, 2), one('fee', 'fam:gemel', 'דמי ניהול, גמל', 6, 2), one('ret', 'fam:pension', 'תשואה, פנסיה', 9)];
}

// Phoenix workbook labels. Replaced by the standard taxonomy once more companies are extracted.
const FIN: { title: string; sheet: string; label: string; dim?: string; exact?: boolean; flow: boolean; color: number; tag?: string }[] = [
  { title: 'רווח לבעלי המניות', sheet: 'F.D2_רווח_הפסד', label: 'בעלי המניות של החברה', exact: true, flow: true, color: 1 },
  { title: 'רווח משירותי ביטוח', sheet: 'F.D2_רווח_הפסד', label: 'רווח משירותי ביטוח', exact: true, flow: true, color: 1, tag: 'IFRS 17' },
  { title: 'רווח מהשקעות ומימון, נטו', sheet: 'F.D2_רווח_הפסד', label: 'רווח מהשקעות ומימון, נטו', exact: true, flow: true, color: 9 },
  { title: 'הכנסות מדמי ניהול', sheet: 'F.D2_רווח_הפסד', label: 'הכנסות מדמי ניהול', exact: true, flow: true, color: 5 },
  { title: 'הון לבעלי המניות', sheet: 'F.D1_מצב_כספי', label: 'סך הכל הון המיוחס לבעלי המניות של החברה', exact: true, flow: false, color: 7 },
  { title: 'CSM, ביטוח חיים', sheet: 'F.N03_חיים_מאזן', label: 'מרווח השירות החוזי', dim: 'סך הכל', flow: false, color: 3, tag: 'IFRS 17' },
  { title: 'CSM, ביטוח בריאות', sheet: 'F.N03_בריאות_מאזן', label: 'מרווח השירות החוזי', dim: 'סך הכל', flow: false, color: 3, tag: 'IFRS 17' },
];
function financialCards(store: CompanyStore): MetricCardProps[] {
  const out: MetricCardProps[] = [];
  for (const f of FIN) {
    const mi = store.find(f.sheet, f.label, { exact: f.exact, dim: f.dim });
    if (mi == null) continue;
    const all = store.d.periods.map((p, i) => ({ p, i })).filter(({ i }) => store.val(mi, i) != null);
    const type = f.flow ? (['H', 'FY', 'Q'].find((t) => all.filter((a) => a.p.type === t).length > 1) ?? 'H') : 'I';
    const ps = all.filter((a) => a.p.type === type).sort((a, b) => a.p.end.localeCompare(b.p.end));
    if (!ps.length) continue;
    const data = ps.map(({ i }) => +(store.val(mi, i)! / 1000).toFixed(1));
    const now = data[data.length - 1], prev = data[data.length - 2];
    const page = store.page(mi, ps[ps.length - 1].i);
    out.push({ title: f.title, tag: f.tag, unit: 'מיליוני ש"ח', value: nf(now, 0), delta: prev ? { text: pct(chg(now, prev), 1, true), tone: tone(chg(now, prev)) } : undefined,
      x: ps.map(({ i }) => store.plabel(i)), series: [{ name: f.title, data }], color: f.color, dec: 0, to: `financials?sheet=${encodeURIComponent(f.sheet)}&m=${mi}`, foot: page ? `דוח כספי, עמ׳ ${page}` : undefined });
  }
  return out;
}

function kpiCards(k: CompanyKpi): MetricCardProps[] {
  const from = 2019;
  const card = (key: string, basis: 'q' | 'ltm', title: string, unit: string, color: number, dec: number, tag?: string): MetricCardProps => {
    const s = k.series(key, basis).filter((p) => Number(p.period.slice(0, 4)) >= from && p.v != null);
    const now = s[s.length - 1]?.v ?? null, prev = s[s.length - 5]?.v ?? null;
    const isRatio = unit === '%' || unit === 'מכפיל';
    const d = now != null && prev != null ? (isRatio ? { text: `${sn(now - prev, dec)} בשנה`, tone: tone(now - prev) } : prev > 0 ? { text: pct(chg(now, prev), 1, true) + ' בשנה', tone: tone(chg(now, prev)) } : undefined) : undefined;
    return { title, tag, unit, value: now == null ? '–' : nf(now, dec), delta: d, x: s.map((p) => periodLabelShort(p.period)), series: [{ name: title, data: s.map((p) => +p.v!.toFixed(3)) }], color, dec, kind: isRatio ? 'area' : 'bar', to: `/industry/headline?k=${key}&b=${basis}`, foot: 'XBRL, דוחות תקופתיים' };
  };
  return [
    card('profit', 'q', 'רווח נקי לבעלי המניות, רבעוני', 'מיליוני ש"ח', 0, 0),
    card('profit', 'ltm', 'רווח נקי, 12 חודשים', 'מיליוני ש"ח', 0, 0),
    card('oci', 'q', 'רווח כולל, רבעוני', 'מיליוני ש"ח', 3, 0),
    card('equity', 'q', 'הון לבעלי המניות', 'מיליוני ש"ח', 7, 0),
    card('roe', 'q', 'ROE, 12 חודשים', '%', 1, 1, 'נגזר'),
    card('pb', 'q', 'מכפיל הון (P/B)', 'מכפיל', 2, 2, 'נגזר'),
    card('eps', 'q', 'רווח למניה, רבעוני', 'ש"ח', 4, 2),
    card('assets', 'q', 'סך הנכסים', 'מיליוני ש"ח', 9, 0),
  ];
}

function LatestDocs({ docs }: { docs: DocEntry[] }) {
  return (
    <Panel title="דיווחים אחרונים" aside={<Link to="filings">כל המסמכים</Link>}>
      <div className="scroll"><table>
        <tbody>{docs.slice(0, 7).map((d) => (
          <tr key={d.url}><td><a href={d.url} target="_blank" rel="noreferrer">{d.title}</a></td><td>{DOC_TYPE[d.type]}</td><td><span className="num">{d.period}</span></td><td><span className="num">{d.pages ?? '–'}</span> עמ׳</td><td><span className="num">{d.date}</span></td></tr>
        ))}</tbody>
      </table></div>
    </Panel>
  );
}

export function CompanyOverview() {
  const { entry, store, market, storeError } = useCtx();
  const price = useCompanyPrice(entry.id, entry.has_price);
  const docs = useCompanyDocs(entry.id, entry.docs > 0);
  if (storeError) return <ErrorBox what="נתוני החברה" error={storeError} />;
  const { kpis } = useKpis();
  const k = kpis?.get(entry.id);
  const kc = k ? kpiCards(k) : [];
  const fin = store ? financialCards(store).filter((c) => c.tag === 'IFRS 17') : [];
  const px = price.data ? priceCards(price.data) : [];
  const mk = market && entry.market_group ? marketCards(market, entry.market_group) : [];
  return (
    <>
      {(kc.length > 0 || px.length > 0) && (
        <section>
          <h2 className="band">מניה ודוחות<span className="muted">31 רבעונים</span></h2>
          <div className="mgrid stagger">{[...px, ...kc].map((c, i) => <MetricCard key={c.title} {...c} i={i} wide={i === 0} />)}</div>
        </section>
      )}
      {fin.length > 0 && (
        <section>
          <h2 className="band">IFRS 17<span className="muted">{store?.d.sources[0]?.doc}</span></h2>
          <div className="mgrid stagger">{fin.map((c, i) => <MetricCard key={c.title} {...c} i={i} />)}</div>
        </section>
      )}
      {mk.length > 0 && market && (
        <section>
          <h2 className="band">חיסכון ארוך טווח<span className="muted">רשות שוק ההון · דצמבר של כל שנה ו-{market.plabel(market.LAST)}</span></h2>
          <div className="mgrid stagger">{mk.map((c, i) => <MetricCard key={c.title} {...c} i={i} />)}</div>
        </section>
      )}
      {docs.data && <LatestDocs docs={docs.data.docs} />}
    </>
  );
}
