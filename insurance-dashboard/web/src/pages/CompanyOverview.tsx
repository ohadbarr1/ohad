import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { DividendCapacity } from '../components/DividendCapacity';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorBox, Panel } from '../components/ui';
import { nf, periodLabel, pubLabel } from '../lib/format';
import type { CompanyStore } from '../lib/company';
import type { Market, MetricKey, Win as MWin } from '../lib/market';
import { METRIC_BY_KEY } from '../lib/market';
import { useCompanyDocs, useKpis } from '../lib/useData';
import { KPI_BY_KEY, periodLabelShort, type CompanyKpi } from '../lib/kpi';
import { mayaReport } from '../lib/sources';
import { printed } from './companyProv';
const DebtStrip = lazy(() => import('./Debt').then((m) => ({ default: m.DebtStrip })));
const ScrComposition = lazy(() => import('./csm/ScrComposition').then((m) => ({ default: m.ScrComposition })));
const TargetsCompact = lazy(() => import('../components/TargetsTracker').then((m) => ({ default: m.TargetsCompact })));
const AttributionPanel = lazy(() => import('../components/Attribution').then((m) => ({ default: m.AttributionPanel })));
const PositionsBlock = lazy(() => import('./Positions').then((m) => ({ default: m.PositionsBlock })));  // module A6: only when the company has a position
const FragilityPanel = lazy(() => import('../components/FragilityPanel').then((m) => ({ default: m.FragilityPanel })));  // module A10: the company's signals
const AdjustedPanel = lazy(() => import('../components/AdjustedPanel').then((m) => ({ default: m.AdjustedPanel })));
const CapitalPanel = lazy(() => import('../components/CapitalPanel').then((m) => ({ default: m.CapitalPanel })));  // module A7: insurers only
import type { Prov } from '../lib/prov';
import type { DocEntry } from '../lib/types';
import { usePeriodParam, useWindowParam, type Win } from '../lib/period';
import { usePhone } from '../lib/useMedia';
import { DOC_TYPE, useCtx } from './Company';
import { CompanyTear } from './CompanyTear';
import { FundHouseStrip } from '../components/FundHouseStrip';
import { KpiLedger, KpiTiles, type LedgerGroup, type LedgerPoint, type LedgerRow } from '../components/KpiLedger';
import { SinceBlock } from '../components/SinceBadge';
import { ReportDay, ROLES, YTD, endOf, figAt, figProv, flowAt, qShift, reportsOf, resolve, type Fig } from './ReportDay';

const MN = 'מיליוני ש"ח';
/** Every quarter end from the first to the last, so that "a quarter back" and "a year back" are always one and four points. */
function quarterEnds(first: string, last: string): string[] {
  const out: string[] = [];
  for (let e = first; e <= last && out.length < 200; e = qShift(e, 1)) out.push(e);
  return out;
}
/** How a flow's period is named in a window: Q2'26, H1'26, LTM Q2'26. */
const winLabel = (end: string, win: Win, flow: boolean) => (!flow ? periodLabel('Q', end) : win === 'ltm' ? `LTM ${periodLabel('Q', end)}` : periodLabel(win === 'q' ? 'Q' : YTD[end.slice(5)], end));
const WIN_HE: Record<Win, string> = { q: 'רבעון', ytd: 'מתחילת השנה', ltm: 'LTM' };

/* ---------- the statements: the same lines, resolved the same way, as the report-day table above ---------- */
const ST_KEYS = ['net', 'comp', 'isr', 'inv', 'pbt', 'eq', 'assets'];
const SHORT: Record<string, string> = { net: 'רווח נקי', comp: 'רווח כולל', isr: 'רווח משירותי ביטוח', inv: 'רווח מהשקעות', pbt: 'רווח לפני מס', eq: 'הון עצמי', assets: 'סך הנכסים', profit: 'רווח נקי', oci: 'רווח כולל', equity: 'הון עצמי', eps: 'רווח למניה' };
function statementRows(store: CompanyStore, win: Win): LedgerRow[] {
  const reps = reportsOf(store).map(endOf).sort();
  if (!reps.length) return [];
  const ends = quarterEnds(reps[0], reps[reps.length - 1]).slice(-24);
  return ST_KEYS.flatMap((key) => {
    const role = ROLES.find((r) => r.key === key)!, r = resolve(store, role);
    // attribution rows the filer stopped printing: the report's bottom line, named on the row (as on the report-day table)
    const alt = role.alt && !r.alt ? resolve(store, role, true).rows : null;
    let usedAlt = r.alt;
    const pts: LedgerPoint[] = ends.map((e) => {
      let f: Fig | null = role.flow ? flowAt(store, r.rows, e, win) : figAt(store, r.rows, 'I', e);
      if (!f && alt && role.flow) { f = flowAt(store, alt, e, win); if (f) usedAlt = true; }
      const label = winLabel(e, win, role.flow);
      return { end: e, label, v: f ? (f.unit === 'k' ? f.v / 1e3 : f.v) : null, src: f ? () => figProv(f!, role.label, label) : undefined, href: f && !f.calc ? f.href : null, der: !!f?.der };
    });
    if (!pts.some((p) => p.v != null)) return [];
    const mi = r.rows[0]?.mi, sheet = mi != null ? store.d.metrics[mi].sheet : '';
    return [{ key: `st:${key}`, title: role.label, short: SHORT[key], stride: role.flow && win === 'ytd' ? 4 : 1, tag: usedAlt ? role.altChip : key === 'isr' ? 'IFRS 17' : undefined, unit: MN, dec: 1, pts, step: 4, source: 'דוחות כספיים',
      color: role.flow ? 1 : 7, to: mi != null ? `financials?sheet=${encodeURIComponent(sheet)}&m=${mi}&g=1` : undefined }];
  });
}

/* ---------- XBRL: the tagged headline figures, with what the statements do not give (ROE, EPS, leverage) ---------- */
function kpiRows(k: CompanyKpi, win: Win, keys: string[]): LedgerRow[] {
  const q = k.quarters;
  if (!q.length) return [];
  const ends = quarterEnds(q[0].end, q[q.length - 1].end).slice(-24), byEnd = new Map(q.map((x) => [x.end, x]));
  const unitOf = (u: string) => (u === 'm' ? MN : u === 'nis' ? 'ש"ח' : u === '%' ? '%' : 'מכפיל');
  return keys.flatMap((key) => {
    const def = KPI_BY_KEY[key];
    if (!def) return [];
    const flow = def.flow, qs = k.series(key, 'q'), lt = flow ? k.series(key, 'ltm') : [];
    const iOf = new Map(qs.map((p, i) => [p.period, i]));
    const pts: LedgerPoint[] = ends.map((e) => {
      const t = byEnd.get(e), label = winLabel(e, win, flow);
      if (!t) return { end: e, label, v: null };
      const i = iOf.get(t.period)!;
      if (!flow || win === 'q') return { end: e, label, v: qs[i]?.v ?? null, src: () => k.explain(key, 'q', t.period), der: !!def.derived };
      if (win === 'ltm') return { end: e, label, v: lt[i]?.v ?? null, src: () => k.explain(key, 'ltm', t.period), der: true };
      // the year to date: the annual figure at a year end, otherwise the quarters of the year added (derived)
      if (t.q === 4) return { end: e, label, v: k.series(key, 'fy').find((p) => p.period === t.period)?.v ?? null, src: () => k.explain(key, 'fy', t.period) };
      const ps = q.filter((x) => x.y === t.y && x.q <= t.q).map((x) => ({ x, v: qs[iOf.get(x.period)!]?.v ?? null }));
      if (ps.length !== t.q || ps.some((p) => p.v == null)) return { end: e, label, v: null };
      const v = ps.reduce((s, p) => s + p.v!, 0);
      const src = (): Prov => (t.q === 1 ? k.explain(key, 'q', t.period) : { k: 'calc', title: `${def.label}, ${label}`, value: nf(v, def.unit === 'nis' ? 2 : 1), unit: unitOf(def.unit), formula: `${label} = ${ps.map((p) => periodLabelShort(p.x.period)).join(' + ')}`,
        inputs: ps.map((p) => ({ label: periodLabelShort(p.x.period), v: nf(p.v!, def.unit === 'nis' ? 2 : 1), src: () => k.explain(key, 'q', p.x.period) })) });
      return { end: e, label, v, src, der: t.q > 1 };
    });
    if (!pts.some((p) => p.v != null)) return [];
    const rid = (i: number) => { const t = byEnd.get(ends[i]); return t && k.reportId(t.period); };
    pts.forEach((p, i) => { const r = rid(i); if (p.v != null && r && (!flow || win === 'q') && !def.derived) p.href = mayaReport(r); });
    const title = key === 'roe' ? 'ROE, LTM' : key === 'leverage' ? 'נכסים להון' : def.label;
    return [{ key: `kpi:${key}`, title, short: SHORT[key], stride: flow && win === 'ytd' ? 4 : 1, tag: def.derived ? 'נגזר' : undefined, unit: unitOf(def.unit), dec: def.unit === 'nis' ? 2 : def.unit === '%' || def.unit === 'x' ? 1 : 0, ratio: def.unit === '%' || def.unit === 'x',
      pts, step: 4, source: k.filer ? `XBRL · ${k.filer.name}` : 'XBRL', color: 0, to: `/industry/headline?k=${key}&b=${flow && win === 'ltm' ? 'ltm' : 'q'}`, filer: !!k.filer }];
  });
}

/* ---------- IFRS 17 balances from the statements' notes: CSM by segment, gross ---------- */
const CSM_ROWS: { key: string; title: string; sheet: string }[] = [
  { key: 'csm_life', title: 'CSM ברוטו, ביטוח חיים', sheet: 'F.N03_חיים_מאזן' },
  { key: 'csm_health', title: 'CSM ברוטו, ביטוח בריאות', sheet: 'F.N03_בריאות_מאזן' },
];
function csmRows(store: CompanyStore): LedgerRow[] {
  return CSM_ROWS.flatMap(({ key, title, sheet }) => {
    const mi = store.find(sheet, 'מרווח השירות החוזי', { dim: 'סך הכל' });
    if (mi == null) return [];
    const at = new Map<string, number>();
    store.d.periods.forEach((p, i) => { if (p.type === 'I' && store.val(mi, i) != null) at.set(p.end, i); });
    const have = [...at.keys()].sort();
    if (!have.length) return [];
    const entity = store.d.sheets.find((x) => x.code === sheet)?.entity ?? 'F';
    const pts: LedgerPoint[] = quarterEnds(have[0], have[have.length - 1]).map((e) => {
      const pi = at.get(e), label = periodLabel('Q', e);
      if (pi == null) return { end: e, label, v: null };
      const v = store.val(mi, pi)! / 1000, fact = store.byMetric.get(mi)?.get(pi);
      return { end: e, label, v, src: () => printed(store, mi, pi, { value: nf(v, 1), unit: MN, entity, title }), href: fact ? store.sourceUrl(entity, store.page(mi, pi), fact.u) : null, der: !!fact?.der };
    });
    return [{ key: `csm:${key}`, title, tag: 'IFRS 17', unit: MN, dec: 1, pts, step: 4, source: 'ביאור מגזרים', color: 3, to: `ifrs17` }];
  });
}

/* ---------- long-term savings: the regulator's monthly figures for the company's group ---------- */
function marketRows(m: Market, group: string): LedgerRow[] {
  const g = m.groupIndex(group);
  if (g < 0) return [];
  const months = m.P.map((p, i) => ({ p, i })).filter((x) => x.p >= 201012 && x.i <= m.LAST);
  const end = (p: number) => `${Math.floor(p / 100)}-${String(p % 100).padStart(2, '0')}-01`;
  const one = (key: MetricKey, set: string, title: string, color: number, dec = 1): LedgerRow | null => {
    const def = METRIC_BY_KEY[key], w: MWin = def.win ? 'ltm' : 'm';
    const pts: LedgerPoint[] = months.map(({ p, i }) => { const v = m.value(key, i, w, set, g); return { end: end(p), label: m.plabel(i), v: v == null ? null : +v.toFixed(4), src: v == null ? undefined : () => ({ k: 'reg', metric: key, pi: i, w, set, g }) as Prov }; });
    if (!pts.some((x) => x.v != null)) return null;
    return { key: `mkt:${key}:${set}`, title, unit: def.unit === '%' ? '%' : 'מיליארד ש"ח', dec, ratio: def.unit === '%', pts, step: 12, source: 'רשות שוק ההון', color, kind: def.unit === '%' ? 'area' : 'bar', to: 'savings', tag: def.win ? 'LTM' : undefined };
  };
  const fams: [string, string][] = [['fam:pension', 'פנסיה'], ['fam:gemel', 'גמל והשתלמות'], ['fam:insurance', 'ביטוחי מנהלים ופוליסות חיסכון']];
  const assets = one('assets', 'all', 'נכסים מנוהלים', 0);
  // the managed-assets chart splits by product
  if (assets) { assets.stack = fams.map(([s, name], k) => ({ name, color: [0, 2, 4][k], data: months.map(({ i }) => +(m.cell(i, s, g).a / 1000).toFixed(2)) })); assets.kind = 'stack'; }
  return [assets, one('share', 'all', 'נתח שוק', 7), one('organic', 'all', 'צבירה אורגנית', 3), one('transfers', 'all', 'ניוד נטו', 4),
    one('fee', 'fam:pension', 'דמי ניהול, פנסיה', 6, 2), one('fee', 'fam:gemel', 'דמי ניהול, גמל', 6, 2), one('ret', 'fam:pension', 'תשואה, פנסיה', 9)].filter((r): r is LedgerRow => !!r);
}

/** The phone card's tiles: the headline metrics a reader looks for first, never another company's figures (a listed holding company's tags). */
function tilesOf(rows: LedgerRow[], fund: boolean): LedgerRow[] {
  const pref = fund ? ['st:net|kpi:profit', 'kpi:roe', 'st:eq|kpi:equity', 'mkt:assets:all', 'mkt:share:all', 'mkt:organic:all', 'kpi:eps']
    : ['st:net|kpi:profit', 'kpi:roe', 'st:eq|kpi:equity', 'st:isr', 'st:comp|kpi:oci', 'kpi:eps'];
  const ok = rows.filter((r) => !r.filer), out: LedgerRow[] = [];
  for (const alts of pref) { const r = alts.split('|').map((k) => ok.find((x) => x.key === k)).find(Boolean); if (r && out.length < 6) out.push(r); }
  for (const r of ok) if (out.length < 6 && !out.includes(r) && !r.key.startsWith('mkt:fee')) out.push(r);
  return out.slice(0, 6);
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

export function CompanyOverview() {
  const { entry, store, market, storeError } = useCtx();
  const docs = useCompanyDocs(entry.id, entry.docs > 0);
  const { kpis } = useKpis();
  const phone = usePhone();
  const [p] = usePeriodParam();
  const [w] = useWindowParam();
  const [sp, setSp] = useSearchParams();
  const sel = sp.get('row') ?? '';
  const onSel = (key: string) => setSp((q) => { const n = new URLSearchParams(q); if (key) n.set('row', key); else n.delete('row'); return n; }, { replace: true });
  const k = kpis?.get(entry.id);
  const fund = entry.kind === 'fund_house';
  // the report on screen: the one in the address when the company has it, otherwise the latest (each row then shows its own latest)
  const reports = useMemo(() => (store ? reportsOf(store) : []), [store]);
  const P = reports.includes(p) ? p : '';
  const asOf = P ? endOf(P) : null;
  // the window: the address's, or the report day's default (an annual report on the year, an interim one on the quarter)
  const win: Win = w === 'ltm' ? 'ltm' : (P || reports[0] || '').endsWith('Q1') ? 'q' : w || ((P || reports[0] || '').endsWith('FY') ? 'ytd' : 'q');

  const groups = useMemo<LedgerGroup[]>(() => {
    const st = store ? statementRows(store, win) : [];
    const kk = k ? kpiRows(k, win, st.length ? ['roe', 'eps', 'leverage'] : ['profit', 'oci', 'equity', 'assets', 'roe', 'eps', 'leverage']) : [];
    const cs = store && !fund ? csmRows(store) : [];
    const mk = market && entry.market_group ? marketRows(market, entry.market_group) : [];
    const out: LedgerGroup[] = [];
    if (st.length) out.push({ key: 'st', title: 'מהדוחות הכספיים', note: <>כפי שדווח · {WIN_HE[win]}</>, rows: st });
    if (kk.length) out.push({ key: 'kpi', title: k?.filer ? `יחסים · ${k.filer.name} (${k.filer.stake}%)` : st.length ? 'יחסים' : 'רווחיות והון', note: <>XBRL, דוחות תקופתיים{k?.filer ? ' · נתוני החברה המדווחת' : ''}</>, rows: kk });
    if (cs.length) out.push({ key: 'csm', title: 'IFRS 17', note: store?.d.sources[0]?.doc, rows: cs });
    if (mk.length) out.push({ key: 'mkt', title: 'חיסכון ארוך טווח', note: <>רשות שוק ההון · <Link to={`/funds/makers?mk=${encodeURIComponent(entry.market_group ?? '')}`}>מול השוק, לפי מסלול</Link></>, rows: mk });
    return out;
  }, [store, k, win, fund, market, entry.market_group]);

  if (storeError) return <ErrorBox what="נתוני החברה" error={storeError} />;
  const allRows = groups.flatMap((g) => g.rows);
  const tiles: ReactNode = phone && allRows.length ? <section className="ccard" aria-label="נתוני מפתח"><KpiTiles rows={tilesOf(allRows, fund)} asOf={asOf} /></section> : null;
  const repTag = P ? (P.endsWith('FY') ? `FY'${P.slice(2, 4)}` : `${P.slice(4)}'${P.slice(2, 4)}`) : '';
  return (
    <>
      <SinceBlock id={entry.id} />
      {entry.has_financials && <ReportDay card={tiles} />}
      {!entry.has_financials && tiles}
      {entry.has_financials && <Suspense fallback={null}><AttributionPanel id={entry.id} /></Suspense>}
      {fund && <FundHouseStrip id={entry.id} name={entry.name_he} market={market} group={entry.market_group} />}
      {!entry.has_financials && !fund && <CompanyTear id={entry.id} />}
      {groups.length > 0 && (
        <section className="kpi-sec">
          <h2 className="band">נתוני מפתח<span className="muted">{repTag && <><span className="num">{repTag}</span> · </>}{WIN_HE[win]} · {phone ? 'לחיצה על שורה פותחת גרף' : 'לחיצה על שורה מציגה אותה בגרף'}</span></h2>
          <KpiLedger groups={groups} asOf={asOf} sel={sel} onSel={onSel} />
        </section>
      )}
      {!fund && <DividendCapacity id={entry.id} />}
      {!fund && <Suspense fallback={null}><CapitalPanel id={entry.id} /></Suspense>}
      <Suspense fallback={null}>
        <PositionsBlock id={entry.id} />
        <FragilityPanel id={entry.id} />
        <TargetsCompact id={entry.id} name={entry.name_he} />
        <AdjustedPanel id={entry.id} name={entry.name_he} />
        {!fund && entry.has_financials && <ScrComposition ids={[entry.id]} name={() => entry.name_he} company={entry.id} />}
      </Suspense>
      <Suspense fallback={null}><DebtStrip id={entry.id} /></Suspense>
      {docs.data && <LatestDocs docs={docs.data.docs} />}
    </>
  );
}
