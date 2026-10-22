import { DividendCapacity } from '../components/DividendCapacity';
import { Link } from 'react-router-dom';
import { MetricCard, type MetricCardProps } from '../components/MetricCard';
import { ErrorBox, Panel } from '../components/ui';
import { nf, pct, pubLabel, sn } from '../lib/format';
import type { CompanyStore } from '../lib/company';
import type { Market, MetricKey, Win } from '../lib/market';
import { METRIC_BY_KEY } from '../lib/market';
import { useCompanyDocs, useKpis } from '../lib/useData';
import { periodLabelShort, type CompanyKpi } from '../lib/kpi';
import { mayaReport } from '../lib/sources';
import { printed } from './companyProv';
import type { DocEntry } from '../lib/types';
import { DOC_TYPE, useCtx } from './Company';

const tone = (v: number | null | undefined) => (v == null || v === 0 ? undefined : v > 0 ? ('pos' as const) : ('neg' as const));
const chg = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? (a / b - 1) * 100 : null);

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
    return { title, unit: def.unit === '%' ? (def.win ? '%, LTM' : '%') : `מיליארד ש"ח${def.win ? ', LTM' : ''}`, value: now == null ? '–' : nf(now, dec), delta: key === 'assets' || ((key === 'share' || key === 'fee') && Math.abs(now! - prev!) >= 0.5 / 10 ** dec) ? d : undefined, x, src: now == null ? undefined : () => ({ k: 'reg', metric: key, pi: L, w, set, g }), series: [{ name: title, data }], color, dec, to };
  };
  const fams: [string, string][] = [['fam:pension', 'פנסיה'], ['fam:gemel', 'גמל והשתלמות'], ['fam:insurance', 'ביטוחי מנהלים ופוליסות חיסכון']];
  const stack: MetricCardProps = {
    title: 'נכסים לפי מוצר', unit: 'מיליארד ש"ח', value: nf(m.value('assets', L, 'm', 'all', g) ?? 0, 1), x, kind: 'stack', to, src: () => ({ k: 'reg', metric: 'assets', pi: L, w: 'm', set: 'all', g }),
    series: fams.map(([s, name], i) => ({ name, color: [0, 2, 4][i], data: pts.map((pi) => +(m.cell(pi, s, g).a / 1000).toFixed(2)) })),
  };
  return [one('assets', 'all', 'נכסים מנוהלים', 0), stack, one('share', 'all', 'נתח שוק', 7), one('organic', 'all', 'צבירה אורגנית', 3), one('transfers', 'all', 'ניוד נטו', 4),
    one('fee', 'fam:pension', 'דמי ניהול, פנסיה', 6, 2), one('fee', 'fam:gemel', 'דמי ניהול, גמל', 6, 2), one('ret', 'fam:pension', 'תשואה, פנסיה', 9)];
}

// Lines of the full statements (the quarterly history where it exists, otherwise the latest report). One period type per card: quarters first.
const FIN: { title: string; sheets: string[]; label: string; dim?: string; exact?: boolean; flow: boolean; color: number; tag?: string }[] = [
  { title: 'רווח לבעלי המניות', sheets: ['X.רווח_והפסד', 'F.D2_רווח_הפסד'], label: 'בעלי המניות של החברה', exact: true, flow: true, color: 1 },
  { title: 'רווח משירותי ביטוח', sheets: ['X.רווח_והפסד', 'F.D2_רווח_הפסד'], label: 'רווח משירותי ביטוח', exact: true, flow: true, color: 1, tag: 'IFRS 17' },
  { title: 'רווח מהשקעות ומימון, נטו', sheets: ['X.רווח_והפסד', 'F.D2_רווח_הפסד'], label: 'רווח מהשקעות ומימון, נטו', exact: true, flow: true, color: 9 },
  { title: 'הכנסות מדמי ניהול', sheets: ['X.רווח_והפסד', 'F.D2_רווח_הפסד'], label: 'הכנסות מדמי ניהול', exact: true, flow: true, color: 5 },
  { title: 'הון לבעלי המניות', sheets: ['X.מאזן', 'F.D1_מצב_כספי'], label: 'סך הכל הון המיוחס לבעלי המניות של החברה', exact: true, flow: false, color: 7 },
  { title: 'CSM ברוטו, ביטוח חיים', sheets: ['F.N03_חיים_מאזן'], label: 'מרווח השירות החוזי', dim: 'סך הכל', flow: false, color: 3, tag: 'IFRS 17' },
  { title: 'CSM ברוטו, ביטוח בריאות', sheets: ['F.N03_בריאות_מאזן'], label: 'מרווח השירות החוזי', dim: 'סך הכל', flow: false, color: 3, tag: 'IFRS 17' },
];
function financialCards(store: CompanyStore): MetricCardProps[] {
  const out: MetricCardProps[] = [];
  for (const f of FIN) {
    const sheet = f.sheets.find((x) => store.find(x, f.label, { exact: f.exact, dim: f.dim }) != null);
    const mi = sheet ? store.find(sheet, f.label, { exact: f.exact, dim: f.dim }) : null;
    if (mi == null || !sheet) continue;
    const all = store.d.periods.map((p, i) => ({ p, i })).filter(({ i }) => store.val(mi, i) != null);
    const type = f.flow ? (['Q', 'H', 'FY'].find((t) => all.filter((a) => a.p.type === t).length > 1) ?? 'H') : 'I';
    const ps = all.filter((a) => a.p.type === type).sort((a, b) => a.p.end.localeCompare(b.p.end)).slice(-12);
    if (!ps.length) continue;
    const data = ps.map(({ i }) => +(store.val(mi, i)! / 1000).toFixed(1));
    const now = data[data.length - 1], yoy = type === 'Q' || type === 'I', prev = data[data.length - (yoy ? 5 : 2)];  // quarters and balance dates are compared with the same point a year earlier
    const last = ps[ps.length - 1].i, page = store.page(mi, last);
    const entity = store.d.sheets.find((x) => x.code === sheet)?.entity ?? '', fact = store.byMetric.get(mi)?.get(last);
    const href = fact ? store.sourceUrl(entity, page, fact.u) : null;
    out.push({ title: f.title, tag: f.tag, unit: 'מיליוני ש"ח', value: nf(now, 0), delta: prev ? { text: `${pct(chg(now, prev), 1, true)}${yoy && data.length >= 5 ? ' YoY' : ''}`, tone: tone(chg(now, prev)) } : undefined,
      x: ps.map(({ i }) => store.plabel(i)), series: [{ name: f.title, data }], color: f.color, dec: 0, to: `financials?sheet=${encodeURIComponent(sheet)}&m=${mi}${sheet.startsWith('X.') ? '&g=1' : ''}`, foot: page ? `דוח כספי, עמ׳ ${page}` : undefined,
      src: () => printed(store, mi, last, { value: nf(now, 0), unit: 'מיליוני ש"ח', entity, title: f.title }), href });
  }
  return out;
}

function kpiCards(k: CompanyKpi): MetricCardProps[] {
  const from = 2019;
  const card = (key: string, basis: 'q' | 'ltm', title: string, unit: string, color: number, dec: number, tag?: string): MetricCardProps => {
    const s = k.series(key, basis).filter((p) => Number(p.period.slice(0, 4)) >= from && p.v != null);
    const last = s[s.length - 1], now = last?.v ?? null, prev = s[s.length - 5]?.v ?? null;
    const isRatio = unit === '%' || unit === 'מכפיל';
    const d = now != null && prev != null ? (isRatio ? { text: `${sn(now - prev, dec)} YoY`, tone: tone(now - prev) } : prev > 0 ? { text: pct(chg(now, prev), 1, true) + ' YoY', tone: tone(chg(now, prev)) } : undefined) : undefined;
    return { title, tag, unit, value: now == null ? '–' : nf(now, dec), delta: d, x: s.map((p) => periodLabelShort(p.period)), series: [{ name: title, data: s.map((p) => +p.v!.toFixed(3)) }], color, dec, kind: isRatio ? 'area' : 'bar', to: `/industry/headline?k=${key}&b=${basis}`, foot: 'XBRL, דוחות תקופתיים',
      src: last ? () => k.explain(key, basis, last.period) : undefined, href: last && k.explain(key, basis, last.period).k === 'xbrl' && k.reportId(last.period) ? mayaReport(k.reportId(last.period)!) : null };
  };
  return [
    card('profit', 'q', 'רווח נקי לבעלי המניות, QTD', 'מיליוני ש"ח', 0, 0),
    card('profit', 'ltm', 'רווח נקי, LTM', 'מיליוני ש"ח', 0, 0),
    card('oci', 'q', 'רווח כולל, QTD', 'מיליוני ש"ח', 3, 0),
    card('equity', 'q', 'הון לבעלי המניות', 'מיליוני ש"ח', 7, 0),
    card('roe', 'q', 'ROE, LTM', '%', 1, 1, 'נגזר'),
    card('eps', 'q', 'רווח למניה, QTD', 'ש"ח', 4, 2),
    card('assets', 'q', 'סך הנכסים', 'מיליוני ש"ח', 9, 0),
  ];
}

function LatestDocs({ docs }: { docs: DocEntry[] }) {
  return (
    <Panel title="דיווחים אחרונים" aside={<Link to="filings">כל המסמכים</Link>}>
      <div className="scroll"><table>
        <tbody>{docs.slice(0, 7).map((d) => (
          <tr key={d.url}><td><a href={d.url} target="_blank" rel="noreferrer" title={d.title}>{DOC_TYPE[d.type]}</a>{d.en && <span className="chip" style={{ marginInlineStart: 6 }}>EN</span>}</td><td><span className="num">{d.period.endsWith('FY') ? `FY'${d.period.slice(2, 4)}` : `${d.period.slice(4)}'${d.period.slice(2, 4)}`}</span></td><td><span className="num">{d.pages ?? '–'}</span> עמ׳</td><td><span className="num">{pubLabel(d.date)}</span></td></tr>
        ))}</tbody>
      </table></div>
    </Panel>
  );
}

import { CompanyTear } from './CompanyTear';
import { Notes, Star } from '../components/Follow';

export function CompanyOverview() {
  const { entry, store, market, storeError } = useCtx();
  const docs = useCompanyDocs(entry.id, entry.docs > 0);
  const { kpis } = useKpis();
  if (storeError) return <ErrorBox what="נתוני החברה" error={storeError} />;
  const k = kpis?.get(entry.id);
  const kc = k ? kpiCards(k) : [];
  const fin = store ? financialCards(store).filter((c) => c.tag === 'IFRS 17') : [];
  const mk = market && entry.market_group ? marketCards(market, entry.market_group) : [];
  return (
    <>
      <CompanyTear id={entry.id} />
      {kc.length > 0 && (
        <section>
          <h2 className="band">דוחות<span className="muted">{k ? `${periodLabelShort(k.quarters[0].period)} עד ${periodLabelShort(k.quarters[k.quarters.length - 1].period)}` : ''}</span></h2>
          <div className="mgrid stagger">{kc.map((c, i) => <MetricCard key={c.title} {...c} i={i} />)}</div>
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
          <h2 className="band">חיסכון ארוך טווח<span className="muted">רשות שוק ההון · דצמבר של כל שנה ו-{market.plabel(market.LAST)} · <Link to={`/funds/makers?mk=${encodeURIComponent(entry.market_group ?? '')}`}>החברה מול השוק, לפי מסלול</Link> · <Link to={`/funds?q=${encodeURIComponent(entry.market_group ?? '')}`}>המסלולים של החברה</Link></span></h2>
          <div className="mgrid stagger">{mk.map((c, i) => <MetricCard key={c.title} {...c} i={i} />)}</div>
        </section>
      )}
      {docs.data && <LatestDocs docs={docs.data.docs} />}
      {entry.kind !== 'fund_house' && <DividendCapacity id={entry.id} />}
      <Panel title="הערות" aside={<><span>מעקב</span><Star id={entry.id} name={entry.name_he} /></>}><Notes id={entry.id} /></Panel>
    </>
  );
}
