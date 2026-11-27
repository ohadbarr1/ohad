import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { CompanyReview } from '../CompanyReview';
import { Panel } from '../../components/ui';
import { nf, periodLabel } from '../../lib/format';
import type { CompanyStore } from '../../lib/company';
import type { Market, MetricKey, Win as MWin } from '../../lib/market';
import { METRIC_BY_KEY } from '../../lib/market';
import { useKpis } from '../../lib/useData';
import { KPI_BY_KEY, periodLabelShort, type CompanyKpi } from '../../lib/kpi';
import { mayaReport } from '../../lib/sources';
import { printed } from '../companyProv';
import type { Prov } from '../../lib/prov';
import type { Win } from '../../lib/period';
import { useSource } from '../../lib/prov';
import { chartBase, palette } from '../../lib/theme';
import { foxOption } from '../../lib/foxchart';
import { KpiLedger, type LedgerGroup, type LedgerPoint, type LedgerRow } from '../../components/KpiLedger';
import { ROLES, YTD, endOf, figAt, figProv, flowAt, qShift, reportsOf, resolve, type Fig } from '../ReportDay';
import { CoStamp, QuarterGridPanel, type CoData } from './QuarterLens';
import type { GridRead } from './rows';
const Chart = lazy(() => import('../../components/Chart').then((m) => ({ default: m.Chart })));

/* The ledger of the company (moved unchanged from CompanyOverview, phase 6 P6-2d): statements, XBRL ratios, IFRS 17 CSM by segment and
   long-term savings, 24 quarters, window q / ytd / ltm, a row opens its chart (`?row=`). */
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


/* ---------- the 12-quarter chart (moved from the report day) ---------- */
function TwelveQuarters({ store, P, id }: { store: CompanyStore; P: string; id: string }) {
  const { open } = useSource();
  const end = endOf(P);
  const qEnds = Array.from({ length: 12 }, (_, i) => qShift(end, i - 11));
  const netRows = resolve(store, ROLES[4]).rows, isrRows = resolve(store, ROLES[1]).rows;
  const netQ = qEnds.map((e) => figAt(store, netRows, 'Q', e)), isrQ = qEnds.map((e) => figAt(store, isrRows, 'Q', e));
  if (!netQ.some(Boolean) && !isrQ.some(Boolean)) return null;
  const build = () => {
    const pal = palette(), b = chartBase(), soft = (qs: (Fig | null)[]) => qs.map((q) => !!q && (!!q.der || q.std === '4'));
    const o = foxOption({ x: qEnds.map((e) => periodLabel('Q', e)), unit: 'מיליוני ש"ח', full: true, labels: false, series: [
      { name: 'רווח נקי לבעלי המניות', data: netQ.map((q) => (q ? q.v / 1e3 : null)), color: pal[7], faded: soft(netQ) },
      { name: 'רווח משירותי ביטוח', data: isrQ.map((q) => (q ? q.v / 1e3 : null)), color: pal[1], kind: 'line', faded: soft(isrQ) },
    ] }) as { series: { data: (number | null | { value: number; itemStyle?: Record<string, unknown> })[] }[] };
    const d = o.series[0].data, last = d[11];
    if (last != null) d[11] = { value: typeof last === 'object' ? last.value : last, itemStyle: { ...(typeof last === 'object' ? last.itemStyle : {}), color: b.accent } };
    return o;
  };
  return (
    <Panel className="co6-panel co6-12q" title={<>רווח נקי ורווח משירותי ביטוח · 12 רבעונים <small>· הרבעון המדווח מודגש · בהיר: נגזר (Q4) או IFRS 4</small></>}>
      <Suspense fallback={<div style={{ height: 250 }} />}>
        <Chart build={build} height={236} onPoint={(si, di) => { const f = (si === 0 ? netQ : isrQ)[di]; if (f) open(figProv(f, si === 0 ? ROLES[4].label : ROLES[1].label, periodLabel('Q', qEnds[di]))); }} deps={[id, P, store]}
          label={`רווח נקי ורווח משירותי ביטוח, 12 רבעונים עד ${periodLabel('Q', end)}`} exportName={`fox-${id}-${P}-report-day`} />
      </Suspense>
    </Panel>
  );
}

/** Lens רבעונים (`cl=qs`, spec 5.2): the eight-quarter grid with its reading seg (`cp`), then the ledger (24 quarters, a chart per row,
 *  `?row=`), the 12-quarter chart and the review by chapter (`#review`). */
export default function QuartersLens({ co, cp }: { co: CoData; cp: GridRead }) {
  const { entry, store, market, kind, P } = co;
  const fund = kind === 'fund';
  const { kpis } = useKpis();
  const [sp, setSp] = useSearchParams();
  const loc = useLocation();
  const sel = sp.get('row') ?? '';
  const onSel = (key: string) => setSp((q) => { const n = new URLSearchParams(q); if (key) n.set('row', key); else n.delete('row'); return n; }, { replace: true });
  const k = kpis?.get(entry.id);
  const reports = useMemo(() => (store ? reportsOf(store) : []), [store]);
  const asOf = P ? endOf(P) : null;
  const w = co.win;
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
  // an old /review link (#review) lands on the review once the panels above it have laid out
  useEffect(() => {
    if (loc.hash !== '#review') return;
    const t = setTimeout(() => document.getElementById('review')?.scrollIntoView({ block: 'start' }), 900);
    return () => clearTimeout(t);
  }, [loc.hash, entry.id]);
  const repTag = P ? (P.endsWith('FY') ? `FY'${P.slice(2, 4)}` : `${P.slice(4)}'${P.slice(2, 4)}`) : '';
  return (
    <div className="co6-lens" data-lens="qs">
      <div className="co6-g2">
        <QuarterGridPanel co={co} cp={cp} />
        {store && P && <TwelveQuarters store={store} P={P} id={entry.id} />}
      </div>
      <CoStamp co={co} />
      {groups.length > 0 && (
        <section className="kpi-sec">
          <h2 className="band">נתוני מפתח<span className="muted">{repTag && <><span className="num">{repTag}</span> · </>}{WIN_HE[win]} · {co.phone ? 'לחיצה על שורה פותחת גרף' : 'לחיצה על שורה מציגה אותה בגרף'}</span></h2>
          <KpiLedger groups={groups} asOf={asOf} sel={sel} onSel={onSel} />
        </section>
      )}
      {!fund && entry.has_financials && (
        <section id="review" className="co-sec" aria-labelledby="review-h">
          <h2 className="band" id="review-h">סקירת דוח לפי פרקים<span className="muted">רווח והון · שירותי ביטוח · CSM · חיסכון · כושר פירעון · YoY ו-QoQ, כפי שהודפס</span></h2>
          <CompanyReview id={entry.id} docs={entry.docs} embedded period={P || reports[0]} open={loc.hash === '#review'} />
        </section>
      )}
    </div>
  );
}
