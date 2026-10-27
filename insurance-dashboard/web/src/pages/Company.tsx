import { CsmEconomics } from '../components/CsmEconomics';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CompanyIfrs } from './CompanyIfrs';
import { CompanyReview } from './CompanyReview';
import { CompanySop } from './CompanySop';
import { CompanySeries } from './CompanySeries';
import { Link, Navigate, NavLink, Outlet, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, Loading, Menu, Panel, Pick, Seg, Toolbar } from '../components/ui';
import { createPortal } from 'react-dom';
import { GroupPanel } from './Market';
import { CHART_FONT, chartBase, palette } from '../lib/theme';
import { foxOption, type FoxSeries } from '../lib/foxchart';
import { CompanyStore, shiftYear, sheetName } from '../lib/company';
import { useStored } from '../lib/local';
import { useMarkVisit } from '../lib/visits';
import { SinceChip } from '../components/SinceBadge';
import { SCALES, dateLabel, fmtCell, nf, periodLabel, periodLong, scaleValue, sn, type Scale } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import { useCompanyNotes, useCompanyStore, useKpiData, useLoad, useMarket, useRegistry } from '../lib/useData';
import { keepPeriod } from '../lib/period';
import { idCss } from '../lib/identity';
import { NotFound } from './NotFound';
import '../styles/company.css';
import type { Market } from '../lib/market';
import { useSource, type Prov } from '../lib/prov';
import { Sourced } from '../components/Source';
import { calc, printed, report, docOf } from './companyProv';
import '../styles/prov-company.css';
import '../styles/sheet.css';
import { ContextBar, Sheet } from '../components/Sheet';
import { usePhone } from '../lib/useMedia';
import { countChanged, useVintage, VintageMark, VintageToggle, vintageProv } from '../components/VintageToggle';
import { FL, parsePolicy, policyLabel, policyParam, type Line, type Policy } from '../lib/facts';
import type { RegistryCompany } from '../lib/types';

export interface Ctx { entry: RegistryCompany; store: CompanyStore | null; storeError: string | null; market: Market | null;
  /** the end of the company toolbar row: a view renders its own controls there (design lane: one toolbar row, lead first) */
  tools: HTMLElement | null }
/** A view's controls, placed in the company toolbar row beside the tabs (null until the row has mounted). */
export function CompanyTools({ children }: { children: ReactNode }) { const { tools } = useCtx(); return tools ? createPortal(children, tools) : null; }
export const useCtx = () => useOutletContext<Ctx>();
export const DOC_TYPE: Record<string, string> = { annual: 'שנתי', quarterly: 'רבעוני', presentation: 'מצגת', solvency: 'כושר פירעון' };

const KIND: Record<string, string> = { insurance_group: 'קבוצת ביטוח ופיננסים', fund_house: 'בית השקעות / מנהל קופות' };

export function CompanyLayout() {
  const { id } = useParams();
  const reg = useRegistry();
  const entry = reg.data?.find((c) => c.id === id) ?? null;
  const { store, error: storeError } = useCompanyStore(id ?? null, !!entry?.has_financials);
  // the regulator's fund data serves the numbers and the savings tab only (the thesis panels load their own files)
  const loc = useLocation();
  // the numbers read the latest month and twelve-month sums only: the light slice; the savings tab charts the full history
  const { market } = useMarket(!!entry && /\/(overview|numbers|savings)\/?$/.test(loc.pathname), !/\/savings\/?$/.test(loc.pathname));
  const kpi = useKpiData(!!entry);
  const phone = usePhone();
  const [noteOpen, setNoteOpen] = useState(false);
  useMarkVisit(entry?.id);  // lane S2: the visit date moves when the reader leaves the company
  const [tools, setTools] = useState<HTMLElement | null>(null);
  if (reg.error) return <ErrorBox what="רשימת החברות" error={reg.error} />;
  if (!reg.data) return <Loading what="חברה" />;
  if (!entry) return <NotFound />;
  const latest = entry.filings[0]?.end ? dateLabel(entry.filings[0].end) : entry.filings[0]?.period;  // the latest report, named like every other period
  const fund = entry.kind === 'fund_house';
  const inStatements = /\/(financials|review|profit|ifrs17)\/?$/.test(loc.pathname);
  const inThesis = /^\/company\/[^/]+(\/thesis)?\/?$/.test(loc.pathname);
  const keep = keepPeriod(loc.search);  // the report and window travel with the reader between the report day and the statement views
  // a listed holding company files the figures of a company it holds part of (Yelin Lapidot: Atrao, 50%): said once, in the header
  const filer = kpi.data?.companies[entry.id]?.filer;
  // the statement views under "דוחות": the full statements, then (insurers) the review, sources of profit and IFRS 17
  const views: [string, string, string][] = [
    ...(entry.has_financials ? [['financials', 'דוחות כספיים', 'כספיים'] as [string, string, string]] : []),
    ...(!fund ? [['review', 'סקירת דוח', 'סקירה'], ['profit', 'מקורות רווח וענפים', 'מקורות רווח'], ['ifrs17', 'IFRS 17', 'IFRS 17']] as [string, string, string][] : []),
  ];
  return (
    <>
      <div className="pagehead company-head">
        <div className="ch-id">
          <h1><span className="iddot" style={{ background: idCss(entry.id), color: idCss(entry.id) }} aria-hidden="true" />{entry.name_he}{entry.name_en && <> <span className="muted en"><span className="sep">· </span><bdi>{entry.name_en}</bdi></span></>}</h1>
          <div className="sub row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="kind">{KIND[entry.kind]}</span>
            {entry.has_financials && <span className="chip loaded" title="הדוח האחרון שנקרא">דוח אחרון <span className="num">{latest}</span></span>}
            {entry.docs > 0 && <span className="chip loaded docs"><span className="num">{entry.docs}</span> מסמכים</span>}
            <SinceChip id={entry.id} />
            {market && entry.market_group && <span className="chip mkt">שוק: {market.plabel(market.LAST)}</span>}
            {phone && entry.has_price && <Link className="chip valchip ph" to={`/valuation/${entry.id}`}>שווי ›</Link>}
          </div>
          {filer && <p className={`filer-note${noteOpen ? ' open' : ''}`} title={filer.note} onClick={() => setNoteOpen((o) => !o)}><span className="chip est">{filer.name} · <span className="num">{filer.stake}%</span></span> {filer.note}</p>}
        </div>
        <div className="head-acts">
          <CompanyActions id={entry.id} valuation={entry.has_price} />
        </div>
      </div>
      {/* one toolbar row: the thesis (the default view), then the evidence: the numbers (the report day), the statements with their views,
          long-term savings, documents; then the view's own controls */}
      <Toolbar className="cotools" lead={<>
        <nav className="subnav cnav" aria-label="חברה">
          <NavLink to="." end className={() => (inThesis ? 'active' : '')} title="תזה: עמדה, ציפיות השוק, גשר ROE, שבריריות והון">תזה</NavLink>
          <NavLink to={`numbers${keep}`} title="מספרים: מה הדוח הדפיס, מול שנה ורבעון קודמים, ונתוני המפתח לאורך זמן">מספרים</NavLink>
          {(entry.has_financials || !fund) && <NavLink to={`${views[0]?.[0] ?? 'financials'}${keep}`} className={() => (inStatements ? 'active' : '')}>דוחות</NavLink>}
          {entry.market_group && <NavLink to="savings"><span className="lg">חיסכון ארוך טווח</span><span className="sm">חיסכון</span></NavLink>}
          <NavLink to="filings">מסמכים{entry.docs > 0 && <span className="count num">{entry.docs}</span>}</NavLink>
        </nav>
        {inStatements && views.length > 1 && (
          <nav className="subnav sub2 cnav2" aria-label="דוחות">
            {views.map(([to, lg, sm]) => <NavLink key={to} to={`${to}${keep}`}><span className="lg">{lg}</span><span className="sm">{sm}</span></NavLink>)}
          </nav>
        )}
      </>}><span ref={setTools} className="cotools-slot" /></Toolbar>
      <Outlet context={{ entry, store, storeError, market, tools } satisfies Ctx} />
    </>
  );
}

/** The company's actions in one menu: the workbook ("הורד את חוברת החברה": every statement, KPI, IFRS 17 fact, source of profit and savings
    metric, each value with its page, lane G) and the way to the valuation. The menu shows the workbook's progress while it is being built. */
function CompanyActions({ id, valuation }: { id: string; valuation: boolean }) {
  const [state, setState] = useState<string | null>(null);
  const run = async () => {
    setState('מכין…');
    try { const { exportCompany } = await import('../lib/exportCompany'); await exportCompany(id, (s) => setState(`${s}…`)); setState(null); }
    catch { setState('שגיאה'); setTimeout(() => setState(null), 2000); }
  };
  return <Menu label="פעולות" summary={state ?? 'פעולות'} align="end" className="coacts" items={[
    { key: 'wb', label: 'חוברת Excel', hint: 'כל הדוחות והנתונים, עם מקור לכל ערך', disabled: !!state, run: () => void run() },
    ...(valuation ? [{ key: 'val', label: 'הערכת שווי', hint: 'P/B מוצדק · הכנסה שיורית · SOTP', to: `/valuation/${id}` }] : []),
  ]} />;
}

function NoFinancials({ entry }: { entry: RegistryCompany }) {
  return <Empty title="הנתונים מהדוחות טרם חולצו">{entry.docs > 0 && <Link to="../filings">{entry.docs} מסמכי מקור</Link>}</Empty>;
}

/* ---------- financials: the metric table that drives the chart ---------- */
const ENTITIES: [string, string][] = [['F', 'חברת האם (מאוחד)'], ['I', 'חברת הביטוח'], ['P', 'פנסיה וגמל']];
/** the address parameters the statements page writes itself; any other (the source sheet's `src`) is left as it is */
const OWN = new Set(['sheet', 'm', 't', 'u', 'v', 'r', 'g', 'k', 'all', 's', 'f', 'e', 'fl', 'gr', 'vin']);
const ownOf = (sp: URLSearchParams) => { const n = new URLSearchParams(); sp.forEach((v, k) => { if (OWN.has(k)) n.append(k, v); }); return n.toString(); };
const GROUP_ORDER = ['income', 'balance', 'cashflow', 'oci', 'segments', 'life', 'health', 'general', 'pension', 'insurance_services', 'investments', 'instruments', 'capital', 'other'];

export function CompanyFinancials() {
  const { entry, store, storeError } = useCtx();
  if (storeError) return <ErrorBox what="נתוני החברה" error={storeError} />;
  if (!entry.has_financials) return <NoFinancials entry={entry} />;
  if (!store) return <Loading what="דוחות כספיים" />;
  return <FinancialsView store={store} companyId={entry.id} fund={entry.kind === 'fund_house'} />;
}

/** A link pasted while the page is open changes the address from outside: the view is rebuilt from the address instead of overwriting it. */
function FinancialsView(props: { store: CompanyStore; companyId: string; fund: boolean }) {
  const [gen, setGen] = useState(0);
  return <FinancialsInner key={gen} {...props} onOutsideLink={() => setGen((g) => g + 1)} />;
}

function FinancialsInner({ store, companyId, fund, onOutsideLink }: { store: CompanyStore; companyId: string; fund: boolean; onOutsideLink: () => void }) {
  const [sp, setSp] = useSearchParams();
  const d = store.d;
  // the view lives in the URL: sheet, selected rows, period type, units, mode, column order
  const initSel = (sp.get('m') ?? '').split(',').filter(Boolean).map(Number).filter((i) => d.metrics[i]);
  // without a deep link the page opens on the parent's consolidated summary, quarterly from 2021
  const wanted = sp.get('sheet') ?? d.metrics[initSel[0]]?.sheet ?? '';
  const initSheet = d.sheets.some((s) => s.code === wanted) ? wanted : (d.sheets.find((s) => s.code.startsWith('X.') && s.entity === 'F' && s.group === 'income') ?? d.sheets.find((s) => s.group === 'income') ?? d.sheets[0])?.code ?? wanted;
  const entities = useMemo(() => ENTITIES.filter(([e]) => d.sheets.some((x) => x.entity === e)), [d]);
  const [entity, setEntity] = useState<string>(d.sheets.find((s) => s.code === initSheet)?.entity ?? 'F');
  const [sheetCode, setSheetCode] = useState(initSheet);
  // the report and window of the company page (?p=&w=) open the table on that window and end it at that report, unless the link says otherwise
  const pP = sp.get('p') ?? '', pW = sp.get('w') ?? '';
  const [type, setTypeOwn] = useState<string>(sp.get('t') ?? (pW === 'ltm' ? 'LTM' : pW === 'q' ? 'Q' : pW === 'ytd' ? (pP.endsWith('FY') ? 'FY' : pP.endsWith('Q2') ? 'H' : '') : ''));
  // a period type chosen here becomes the company page's window (H and FY are year-to-date columns)
  const setType = (t: string) => { setTypeOwn(t); const w = t === 'Q' ? 'q' : t === 'LTM' ? 'ltm' : t === 'H' || t === 'FY' ? 'ytd' : ''; if (w) setSp((prev) => { const n = new URLSearchParams(prev); n.set('w', w); return n; }, { replace: true }); };
  const [scale, setScale] = useState<Scale>((['k', 'm', 'b'] as Scale[]).find((x) => x === sp.get('u')) ?? 'm');
  const [mode, setMode] = useState<'value' | 'yoy'>(sp.get('v') === 'yoy' ? 'yoy' : 'value');
  const [showChart, setShowChart] = useState(sp.get('g') === '1');
  // a phone opens on the latest period with its changes; the full run of periods is one tap away
  const [compact, setCompact] = useState(() => sp.get('all') !== '1' && window.matchMedia('(max-width: 760px)').matches);
  const [stack, setStack] = useState(sp.get('k') === '1');
  const [flip, setFlip] = useState<Record<number, boolean>>(() => Object.fromEntries((sp.get('fl') ?? '').split(',').filter(Boolean).map((x) => [Number(x), true])));
  const [growth, setGrowth] = useState<Record<number, 'yoy' | 'qoq' | undefined>>(() => Object.fromEntries((sp.get('gr') ?? '').split(',').filter(Boolean).map((x) => { const [i, g] = x.split(':'); return [Number(i), g === 'qoq' ? 'qoq' : 'yoy']; })));
  const wrote = useRef<string | null>(null);
  const [q, setQ] = useState('');
  // units, display, column order, period window, row search and saved views sit behind one button, so the first screen shows figures
  const [more, setMore] = useState(false);
  const phone = usePhone();
  const [oldestFirst, setOldestFirst] = useState(sp.get('r') === '1');
  const [dim, setDim] = useState('all');
  const [sel, setSel] = useState<number[]>(initSel);
  const [kind, setKind] = useState<Record<number, 'bar' | 'line'>>({});
  const [explain, setExplain] = useState<number | null>(null);
  const hasNotes = companyId === 'phoenix' && !sheetCode.startsWith('X.');  // line explanations exist for the Phoenix workbook sheets only
  const notes = useCompanyNotes(companyId, explain != null);

  const sv = useMemo(() => store.sheet(sheetCode), [store, sheetCode]);
  const types = useMemo(() => {
    if (!sv) return [] as string[];
    const order = ['Q', 'H', 'FY', 'I'];  // nine-month columns are kept in the data only to derive the fourth quarter
    const have = order.filter((t) => sv.periods.some((p) => p.type === t));
    return have.includes('Q') ? [...have.filter((t) => t !== 'I'), 'LTM', ...have.filter((t) => t === 'I')] : have;  // trailing twelve months: the last four quarters, summed
  }, [sv]);
  const curType = types.includes(type) ? type : types[0] ?? '';
  const ltm = curType === 'LTM', baseType = ltm ? 'Q' : curType;
  const qAt = useMemo(() => new Map(d.periods.map((x, i) => [x.type === 'Q' ? x.end : `-${i}`, i] as [string, number])), [d]);
  const pl = (pi: number): string => (ltm ? `LTM ${store.plabel(pi)}` : store.plabel(pi));

  // A statement that changed accounting standard is read one structure at a time: IFRS 17 as reported from 2024, IFRS 4 as reported until 2024,
  // or only the lines that exist under both and so run through the break.
  const [stdSaved, saveStd] = useStored<'17' | '4' | 'c'>(`fin.std.${companyId}`, '17');
  // a link says which structure it shows; otherwise the reader's last choice, and for a first visit the full current statement
  const [stdPick, pickStd] = useState<'17' | '4' | 'c'>((['17', '4', 'c'] as const).find((x) => x === sp.get('s')) ?? stdSaved);
  const setStdTab = (t: '17' | '4' | 'c') => { pickStd(t); saveStd(t); };
  const tabRows = useMemo(() => {
    const by: Record<'17' | '4' | 'c', Set<number>> = { 17: new Set(), 4: new Set(), c: new Set() };
    let seg = -1;
    for (const r of sv?.rows ?? []) {
      if (r.m.std) { seg++; continue; }
      if (r.m.header) continue;
      if (seg === 0) { by['17'].add(r.idx); if ([...r.values.values()].some((f) => f.old)) by.c.add(r.idx); }
      if (seg === 1) by['4'].add(r.idx);
    }
    return by;
  }, [sv]);
  // a statement with no line common to both standards opens on the current standard instead
  const stdTab: '17' | '4' | 'c' = tabRows[stdPick].size ? stdPick : '17';
  const hasStd = !!sv?.rows.some((r) => r.m.std);
  const hideOld = hasStd && stdTab === '17';
  const seen = (f: { old?: boolean } | undefined): boolean => !!f && !(hideOld && f.old);
  const fromReports = sheetCode.startsWith('X.');
  // the vintage of the figures (?vin=): the latest print (default), each period as first reported, or as of a report.
  // The fact table loads only once the policy leaves 'latest'; LTM, YoY, the chart and the export follow, all within one vintage.
  const [vinPolicy, setVinPolicy] = useState<Policy>(() => parsePolicy(sp.get('vin')));
  const vin = useVintage(fromReports ? companyId : null);
  const vLine = (mi: number) => vin.facts?.byMi.get(mi) ?? null;
  const vP = (pi: number) => (vin.facts ? vin.facts.periodIndex(d.periods[pi].type, d.periods[pi].end) : -1);
  const vCell = (mi: number, pi: number) => { const l = vLine(mi), p = vP(pi); return l && p >= 0 && vinPolicy !== 'latest' ? vin.facts!.cell(l, p, vinPolicy) : undefined; };
  const raw = (mi: number | null, pi: number): number | null => {
    if (mi == null || pi < 0) return null;
    const c = vCell(mi, pi);
    if (c !== undefined) return c && seen({ old: !!(c.f & FL.IFRS4) }) ? c.v : null;
    const f = store.byMetric.get(mi)?.get(pi); return f && seen(f) ? f.v : null;
  };
  /** the quarter itself and the three before it; one missing quarter and there is no LTM figure */
  const ltmQs = (mi: number, pi: number): number[] | null => {
    if (d.metrics[mi].unit === 'pct') return null;
    const end = d.periods[pi].end, out: number[] = [];
    for (let k = 0; k < 4; k++) {
      const qi = qAt.get(new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 3 * k, 0)).toISOString().slice(0, 10));
      if (qi == null || raw(mi, qi) == null) return null;
      out.push(qi);
    }
    return out;
  };
  const val = (mi: number | null, pi: number): number | null => {
    if (!ltm) return raw(mi, pi);
    if (mi == null || pi < 0) return null;
    const qs = ltmQs(mi, pi);
    return qs ? qs.reduce((t, qi) => t + raw(mi, qi)!, 0) : null;
  };
  const inTab = (idx: number) => !hasStd || tabRows[stdTab].has(idx);
  const colsOf = (tab: '17' | '4' | 'c') => (sv ? sv.periodIdx.filter((pi) => d.periods[pi].type === baseType && sv.rows.some((r) => tabRows[tab].has(r.idx) && (() => { const f = r.values.get(pi); return !!f && !(tab === '17' && f.old); })())) : []);
  const allCols = useMemo(() => (!sv ? [] : hasStd ? colsOf(stdTab) : sv.periodIdx.filter((pi) => d.periods[pi].type === baseType)), [sv, d, baseType, hasStd, stdTab, tabRows]);  // eslint-disable-line react-hooks/exhaustive-deps
  // the period window: kept as dates, so it survives a change of table or of period type
  const pEnd = /^\d{4}(Q[1-3]|FY)$/.test(pP) ? `${pP.slice(0, 4)}-${pP.endsWith('FY') ? '12-31' : ['03-31', '06-30', '09-30'][Number(pP.slice(5)) - 1]}` : null;
  const [range, setRange] = useState<[string | null, string | null]>([sp.get('f'), sp.get('e') ?? (pEnd && d.periods.some((x) => x.end > pEnd) ? pEnd : null)]);
  const cols = useMemo(() => allCols.filter((pi) => { const e = d.periods[pi].end; return (!range[0] || e >= range[0]) && (!range[1] || e <= range[1]); }).filter((pi) => !ltm || (sv?.rows ?? []).some((r) => !r.m.header && inTab(r.idx) && val(r.idx, pi) != null)), [allCols, d, range, ltm, sv, stdTab]);  // eslint-disable-line react-hooks/exhaustive-deps
  const nAll = allCols.length;
  const loI = Math.max(0, range[0] ? allCols.findIndex((pi) => d.periods[pi].end >= range[0]!) : 0);
  const hiI = range[1] ? Math.max(loI, allCols.reduce((a, pi, i) => (d.periods[pi].end <= range[1]! ? i : a), 0)) : nAll - 1;
  const setLo = (i: number) => setRange(([, e]) => [i <= 0 ? null : d.periods[allCols[Math.min(i, hiI)]].end, e]);
  const setHi = (i: number) => setRange(([f]) => [f, i >= nAll - 1 ? null : d.periods[allCols[Math.max(i, loI)]].end]);
  const colsDesc = useMemo(() => (oldestFirst ? cols : [...cols].reverse()), [cols, oldestFirst]);

  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!sv) return [];
    const out: typeof sv.rows = [];
    // a caption is shown only when a row follows it; the accounting-standard band survives the captions under it
    let pending: typeof sv.rows = [];
    for (const r of sv.rows) {
      if (r.m.std) { pending = []; continue; }  // the standard is chosen by the tabs above the table
      if (r.m.header) { pending = [r]; continue; }
      if (!inTab(r.idx)) continue;
      if (dim !== 'all' && (r.m.dim ?? '') !== dim) continue;
      if (needle && !`${r.m.label} ${r.m.dim ?? ''}`.toLowerCase().includes(needle)) continue;
      if (!cols.some((pi) => (ltm ? val(r.idx, pi) != null : seen(r.values.get(pi))))) continue;
      out.push(...pending); pending = [];
      out.push(r);
    }
    return out;
  }, [sv, dim, cols, needle, stdTab, hasStd, ltm]);  // eslint-disable-line react-hooks/exhaustive-deps

  // reset the selection when the sheet changes, unless it came from a deep link
  useEffect(() => {
    const first = rows.find((r) => !r.m.header);
    setSel((cur) => {
      const valid = cur.filter((i) => rows.some((r) => r.idx === i));
      return valid.length ? valid : first ? [first.idx] : [];
    });
  }, [rows]);
  useEffect(() => { setDim('all'); }, [sheetCode]);
  useEffect(() => {
    // the address was changed from outside (a pasted link): rebuild from it, do not write over it
    if (wrote.current != null && ownOf(sp) !== wrote.current) { onOutsideLink(); return; }
    const q: Record<string, string> = { sheet: sheetCode };
    if (sel.length) q.m = sel.join(',');
    if (curType) q.t = curType;
    if (scale !== 'm') q.u = scale;
    if (mode !== 'value') q.v = mode;
    if (oldestFirst) q.r = '1';
    if (showChart) q.g = '1';
    if (stack) q.k = '1';
    if (!compact) q.all = '1';
    if (hasStd) q.s = stdTab;
    if (range[0]) q.f = range[0];
    if (range[1]) q.e = range[1];
    const fl = Object.keys(flip).filter((k) => flip[+k]), gr = Object.entries(growth).filter(([, g]) => g).map(([k, g]) => `${k}:${g}`);
    if (fl.length) q.fl = fl.join(',');
    if (gr.length) q.gr = gr.join(',');
    if (vinPolicy !== 'latest') q.vin = policyParam(vinPolicy);
    wrote.current = new URLSearchParams(q).toString();
    // parameters this page does not own (the source sheet's `src`) survive the rewrite
    setSp((prev) => { const n = new URLSearchParams(q); prev.forEach((v, k) => { if (!OWN.has(k)) n.set(k, v); }); return n; }, { replace: true });
  }, [sheetCode, sel, curType, scale, mode, oldestFirst, showChart, stack, range, stdTab, hasStd, flip, growth, compact, vinPolicy, setSp]);
  useEffect(() => { if (wrote.current != null && ownOf(sp) !== wrote.current) onOutsideLink(); }, [sp, onOutsideLink]);

  const prior = (pi: number): number => { const p = d.periods[pi]; return d.periods.findIndex((q) => q.type === p.type && q.end === shiftYear(p.end, -1) && q.months === p.months); };
  const cell = (mi: number, pi: number): number | null => {
    const m = d.metrics[mi], v = val(mi, pi);
    if (mode === 'value') return v;
    const pp = prior(pi), pv = pp >= 0 ? val(mi, pp) : null;
    return v != null && pv ? (v / pv - 1) * 100 : null;
    void m;
  };
  const shown = (mi: number, pi: number): string => {
    const v = cell(mi, pi);
    if (mode === 'yoy') return v == null ? '–' : `${sn(v, 1)}%`;
    return fmtCell(v, d.metrics[mi].unit, scale);
  };

  const hasFull = entity === 'F' && d.sheets.some((s) => s.code === 'X.רווח_והפסד');
  // how far back a sheet goes, so the choice between the full latest statement and the long series is visible before opening it
  const span = (code: string): string => { const ps = store.sheet(code)?.periods ?? []; if (!ps.length) return ''; const ys = ps.map((x) => x.end.slice(0, 4)).sort(); return ys[0] === ys[ys.length - 1] ? ` · ${ys[0]}` : ` · ${ys[0]} עד ${ys[ys.length - 1]}`; };
  const longSheet = d.sheets.find((x) => x.entity === entity && x.code.startsWith('X.') && x.group === sv?.group) ?? d.sheets.find((x) => x.entity === entity && x.code.startsWith('X.'));
  const sheets = useMemo(() => d.sheets.filter((s) => s.entity === entity && !(hasFull && (s.code.startsWith('X.תמצית') || /^F\.D[1235]_/.test(s.code)))).sort((a, b) => Number(b.code.startsWith('X.')) - Number(a.code.startsWith('X.'))), [d, entity, hasFull]);
  const optGroups = GROUP_ORDER.map((g) => ({ g, items: sheets.filter((s) => s.group === g) })).filter((x) => x.items.length);

  const series = sel.filter((i) => rows.some((r) => r.idx === i)).map((mi, k) => {
    const m = d.metrics[mi];
    const sign = flip[mi] ? -1 : 1;
    const vals = cols.map((pi) => { const v = cell(mi, pi); return v == null ? null : v * sign; });
    // growth of the row itself, as printed: against the same period a year earlier, or against the previous column
    const g = mode === 'value' ? growth[mi] : undefined;
    // a rate against a base near zero says nothing: such points are left out, and the rest is held within ±300%
    const mags = cols.map((pi) => val(mi, pi)).filter((x): x is number => x != null).map(Math.abs).sort((a, b) => a - b), floor = (mags[Math.floor(mags.length / 2)] ?? 0) * 0.1;
    const gvals = !g ? null : cols.map((pi, ci) => { const v = val(mi, pi), pp = g === 'yoy' ? prior(pi) : ci > 0 ? cols[ci - 1] : -1, pv = pp >= 0 ? val(mi, pp) : null; if (v == null || !pv || Math.abs(pv) < floor) return null; return Math.max(-300, Math.min(300, ((v - pv) / Math.abs(pv)) * 100)); });
    const first = vals.findIndex((v) => v != null), lastI = vals.length - 1 - [...vals].reverse().findIndex((v) => v != null);
    let total: number | null = null, cagr: number | null = null;
    // change and CAGR are stated only between two positive figures; from a loss or to a loss they have no meaning
    if (mode === 'value' && first >= 0 && lastI > first && vals[first]! > 0 && vals[lastI]! > 0) {
      total = (vals[lastI]! / vals[first]! - 1) * 100;
      const yrs = (Date.parse(d.periods[cols[lastI]].end) - Date.parse(d.periods[cols[first]].end)) / (365.25 * 864e5);
      if (yrs >= 1 && vals[first]! > 0 && vals[lastI]! > 0) cagr = (Math.pow(vals[lastI]! / vals[first]!, 1 / yrs) - 1) * 100;
    }
    const olds = cols.map((pi) => !!store.byMetric.get(mi)?.get(pi)?.old && !hideOld);
    return { mi, m, k, vals, g, gvals, olds, total, cagr, name: m.dim ? `${m.label.replace(/\s+\(.*?\)\s*$/, '')} · ${m.dim}` : m.label };
  });

  const pal = palette();
  const unitLabel = mode === 'yoy' ? 'YoY %' : (SCALES.find((s) => s.id === scale)!.label);

  const toggle = (mi: number) => setSel((cur) => (cur.includes(mi) ? cur.filter((x) => x !== mi) : [...cur, mi]));
  const [showRe, setShowRe] = useState(false);
  const [dense, setDense] = useStored<boolean>('fin.dense', false);
  // restatements of the statement on screen, in the structure on screen
  const restated = (d.restated ?? []).filter((r) => r[0] === sheetCode && (!hasStd || stdTab === 'c' || r[1] === (stdTab === '17' ? 'IFRS 17' : 'IFRS 4')) && (r[3] === baseType || (baseType === 'Q' && r[3] === 'I')));
  // a figure from the periodic reports links only to its own report; the entity's single source file would be the wrong document
  const open = (page: number | null, u?: number | null) => (fromReports && u == null ? null : store.sourceUrl(entity, page, u));
  const vinLines = vin.facts ? rows.filter((r) => !r.m.header).map((r) => vLine(r.idx)).filter((l): l is Line => !!l) : [];
        // reports to read the statement as of: every report that printed a figure of this sheet, newest first
  const vintages = vin.facts ? (() => { const f = vin.facts, ts = new Set<number>(); vinLines.forEach((l) => { for (let k = l.start; k < l.end; k++) ts.add(f.d.rows.t[k]); }); return [...ts].filter((t) => f.vint[t].pub).sort((a, b) => f.vdate(b).localeCompare(f.vdate(a))).map((t) => [f.vdate(t), f.vlabel(t)] as [string, string]); })() : undefined;
  // restated cells on screen: from the fact table once it is loaded, otherwise the site's restatement list for the sheet
  // one definition: cells in this table whose first print differs from the latest (counted once the fact table is loaded)
  const nRestated = vin.facts ? countChanged(vin.facts, vinLines, cols.map(vP).filter((p) => p >= 0)) : null;

  /* where a figure on the table comes from: printed ones open the report page, computed ones (LTM, YoY, changes) list what they are computed from */
  const { open: openSrc } = useSource();
  const unitTxt = (mi: number) => { const u = d.metrics[mi].unit; return u === 'pct' ? '%' : u === 'nis' ? 'ש"ח' : SCALES.find((x) => x.id === scale)!.label; };
  const titleOf = (mi: number) => { const m = d.metrics[mi]; return m.dim ? `${m.label} · ${m.dim}` : m.label; };
  const fmtAt = (mi: number, v: number | null) => fmtCell(v, d.metrics[mi].unit, scale);
  const printedAt = (mi: number, pi: number): Prov => printed(store, mi, pi, { value: fmtAt(mi, store.byMetric.get(mi)?.get(pi)?.v ?? null), unit: unitTxt(mi), entity, ownOnly: fromReports });
  /** the figure as the table shows it in value mode: printed, or the sum of four printed quarters */
  // the source sheet of a cell under the vintage policy, with both prints when it was restated
  const provAt = (mi: number, pi: number): Prov => { const l = vLine(mi), p = vP(pi); return (l && p >= 0 ? vintageProv(vin.facts!, l, p, vinPolicy, scale) : null) ?? printedAt(mi, pi); };
  const valProv = (mi: number, pi: number): Prov => {
    if (!ltm) return provAt(mi, pi);
    const qs = ltmQs(mi, pi) ?? [];
    return calc(`${titleOf(mi)} · ${pl(pi)}`, fmtAt(mi, val(mi, pi)), `LTM = ${qs.map((qi) => store.plabel(qi)).join(' + ')}`, qs.map((qi) => ({ label: store.plabel(qi), v: fmtAt(mi, raw(mi, qi)), src: () => provAt(mi, qi) })), unitTxt(mi));
  };
  /** change of a row between two columns: % (or points for a rate), each side opens its own source */
  const changeProv = (mi: number, pi: number, pj: number, kind: string, text: string): Prov => {
    const rate = d.metrics[mi].unit === 'pct';
    return calc(`${titleOf(mi)} · ${kind} ${pl(pi)}`, text, rate ? `${pl(pi)} − ${pl(pj)} (נק׳)` : `${pl(pi)} ÷ ${pl(pj)} − 1`,
      [pi, pj].map((x) => ({ label: pl(x), v: fmtAt(mi, val(mi, x)), src: () => valProv(mi, x) })), rate ? 'נק׳' : '%');
  };
  const cellProv = (mi: number, pi: number): Prov => (mode === 'value' ? valProv(mi, pi) : changeProv(mi, pi, prior(pi), 'YoY', shown(mi, pi)));
  // the table as a workbook: figures as numbers in the unit on screen, periods oldest first, every printed figure linked to its PDF page
  const exportXlsx = async () => {
    const { downloadXlsx } = await import('../lib/xlsx');
    const per = [...cols].sort((a, b) => d.periods[a].end.localeCompare(d.periods[b].end));
    const unitTxtAll = mode === 'yoy' ? 'YoY %' : SCALES.find((x) => x.id === scale)!.label;
    const title = `${sheetName(sheetCode)}${hasStd ? ` · ${stdTab === '17' ? 'IFRS 17' : stdTab === '4' ? 'IFRS 4' : 'שורות רציפות'}` : ''}`;
    const body = rows.map((r) => {
      if (r.m.header) return [{ v: r.m.label, bold: true }];
      const u = r.m.unit, dec = mode === 'yoy' ? 'pct1' as const : u === 'nis' ? 'n2' as const : u === 'pct' ? 'pct1' as const : u === 'shares' ? 'n0' as const : scale === 'k' ? 'n0' as const : 'n1' as const;
      return [{ v: r.m.label + (r.m.dim ? ` · ${r.m.dim}` : ''), bold: !!r.m.total }, ...per.map((pi) => {
        const v = cell(r.idx, pi), f = store.byMetric.get(r.idx)?.get(pi);
        const x = v == null ? null : mode === 'yoy' ? +v.toFixed(2) : +scaleValue(v, u, scale).toFixed(4);
        return { v: x, fmt: dec, bold: !!r.m.total, italic: !!f?.der, link: x == null ? undefined : pdfHref(r.idx, pi) ?? undefined };
      })];
    });
    const sheet = { name: sheetName(sheetCode), widths: [52, ...per.map(() => 13)], freeze: { rows: 3, cols: 1 },
      rows: [[{ v: `${store.d.company} · ${title}`, bold: true }], [`יחידה: ${unitTxtAll}`, ...per.map(() => '')], [{ v: 'שורה', bold: true }, ...per.map((pi) => ({ v: pl(pi), bold: true }))], ...body] };
    const about = { name: 'מקור', widths: [28, 90], rows: [
      [{ v: 'מקור', bold: true }, 'דוחות כספיים של החברה (MAYA). כל מספר מודפס בגיליון הראשון מקושר לעמוד שלו ב-PDF.'],
      ['כתובת באתר', location.href], ['נוצר', new Date().toLocaleString('he-IL')], ['יחידה', unitTxtAll],
      ['נטוי', 'מחושב: Q4 = FY פחות 9M, H2 = FY פחות H1'], ['תקופות', `${pl(per[0])} עד ${pl(per[per.length - 1])}`],
      ['הוצג מחדש', 'ערך שדוח מאוחר הדפיס אחרת מוצג כפי שהודפס בדוח המאוחר ביותר'], ['fox', 'fox-research-il.web.app'],
    ] };
    downloadXlsx(`fox-${companyId}-${sheetName(sheetCode)}`.replace(/\s+/g, '-'), [sheet, about]);
  };
  const pdfHref = (mi: number, pi: number) => {
    if (ltm || mode !== 'value') return null;
    const c = vCell(mi, pi); if (c) return vin.facts!.pdf(c);
    const f = store.byMetric.get(mi)?.get(pi); return f && seen(f) ? open(f.page, f.u) : null;
  };
  // the dot on a cell whose first print differs from the latest (replaces the `re` class once the fact table is loaded)
  const vMark = (mi: number, pi: number) => { const l = vLine(mi), p = vP(pi); return vin.facts && l && p >= 0 && !ltm && mode === 'value' ? <VintageMark facts={vin.facts} line={l} p={p} policy={vinPolicy} scale={scale} /> : null; };

  // compact view: the latest column, its change on the year-earlier period and, for quarters, on the previous quarter
  const lastPi = cols.length ? cols[cols.length - 1] : null, qoqPi = !ltm && baseType === 'Q' && cols.length > 1 ? cols[cols.length - 2] : null;
  const change = (now: number | null, then: number | null, unit: string, mi: number, pi: number, pj: number, kind: string) => {
    if (now == null || then == null) return <span className="muted">–</span>;
    if (unit === 'pct') { const t = `${sn(now - then, 1)} נק׳`; return <Sourced src={() => changeProv(mi, pi, pj, kind, t)}><span className={`num ${now - then >= 0 ? 'pos' : 'neg'}`}>{t}</span></Sourced>; }
    if (now <= 0 || then <= 0) return <span className="muted">–</span>;  // no rate of change from or to a loss
    const c = (now / then - 1) * 100, t = Math.abs(c) >= 300 ? `×${nf(now / then, 1)}` : `${sn(c, 1)}%`;
    return <Sourced src={() => changeProv(mi, pi, pj, kind, t)}><span className={`num ${c >= 0 ? 'pos' : 'neg'}`}>{t}</span></Sourced>;
  };
  const compactCells = (mi: number) => {
    const pi = lastPi!, f0 = store.byMetric.get(mi)?.get(pi), f = seen(f0) ? f0 : undefined, v = val(mi, pi), pp = prior(pi), unit = d.metrics[mi].unit;
    const body = <span className={`num${f?.der ? ' der' : ''}${f?.old ? ' old' : ''}${f?.re && !vin.facts ? ' re' : ''}`} title={f?.re && !vin.facts ? 'הוצג מחדש בדוח מאוחר: מוצג הערך המעודכן' : undefined}>{fmtCell(v, unit, scale)}</span>;
    return <>
      <td className="lead">{vMark(mi, pi)}{v == null ? body : <Sourced src={() => valProv(mi, pi)} href={!ltm && f ? pdfHref(mi, pi) ?? open(f.page, f.u) : null}>{body}</Sourced>}</td>
      <td>{change(v, pp >= 0 ? val(mi, pp) : null, unit, mi, pi, pp, 'YoY')}</td>
      {qoqPi != null && <td>{change(v, val(mi, qoqPi), unit, mi, pi, qoqPi, 'QoQ')}</td>}
    </>;
  };

  // a click on a plotted point opens the source of that figure: series are drawn in the order of `series`, a growth line right after its row
  const onPoint = (si: number, di: number) => {
    const plot = series.flatMap((x) => (x.gvals ? [{ x, g: false }, { x, g: true }] : [{ x, g: false }]));
    const lo = Math.max(0, cols.findIndex((_, i) => series.some((x) => x.vals[i] != null || x.gvals?.[i] != null)));
    const e = plot[si], ci = lo + di, pi = cols[ci];
    if (!e || pi == null) return;
    const { mi, name, gvals, g } = e.x;
    if (e.g && gvals && g) {
      const pj = g === 'yoy' ? prior(pi) : ci > 0 ? cols[ci - 1] : -1, t = gvals[ci];
      if (t == null || pj < 0) return;
      openSrc(calc(`${titleOf(mi)} · ${g === 'yoy' ? 'YoY' : 'QoQ'} ${pl(pi)}`, `${sn(t, 1)}%`, `(${pl(pi)} − ${pl(pj)}) ÷ |${pl(pj)}|`,
        [pi, pj].map((x) => ({ label: pl(x), v: fmtAt(mi, val(mi, x)), src: () => valProv(mi, x) })), '%', 'שיעור מוצג בתחום ±300%'));
      return;
    }
    if (e.x.vals[ci] == null) return;
    if (flip[mi]) openSrc(calc(name, `${mode === 'yoy' ? '' : '−'}${shown(mi, pi)}`, 'היפוך סימן (±) של השורה', [{ label: pl(pi), v: shown(mi, pi), src: () => cellProv(mi, pi) }], unitLabel));
    else openSrc(cellProv(mi, pi));
  };

  const explainText = explain != null ? notes.data?.[String(explain)] : null;

  return (
    <>
      {(() => {
        // the pickers, built once and placed twice: a toolbar row on a wide screen, a sheet behind a context bar on a phone
        const entityF = entities.length > 1 && <div className="field"><span>ישות מדווחת</span><Seg<string> label="ישות מדווחת" value={entity} onChange={(e) => { setEntity(e); const own = d.sheets.filter((s) => s.entity === e), first = own.find((s) => s.code.startsWith('X.') && s.group === 'income') ?? own.find((s) => s.code.startsWith('X.')) ?? own.find((s) => s.group === 'income') ?? own[0]; if (first) { setSheetCode(first.code); setSel([]); } }} options={entities} /></div>;
        const sheetF = <Field label="דוח"><select value={sheetCode} onChange={(e) => { setSheetCode(e.target.value); setSel([]); }} aria-label="דוח">
          {optGroups.map(({ g, items }) => <optgroup key={g} label={d.groups[g]}>{items.map((x) => <option key={x.code} value={x.code}>{items.length > 1 || sheetName(x.code) !== d.groups[g] ? sheetName(x.code) : d.groups[g]}{span(x.code)}</option>)}</optgroup>)}
        </select></Field>;
        const sheetM = <Menu label="דוח" cap="דוח" value={sheetCode} className="sheetpick" onPick={(c) => { setSheetCode(c); setSel([]); }}
          items={optGroups.flatMap(({ g, items }) => items.map((x) => ({ key: x.code, group: d.groups[g], label: items.length > 1 || sheetName(x.code) !== d.groups[g] ? sheetName(x.code) : d.groups[g], hint: span(x.code).replace(/^ · /, '') || undefined })))} />;
        const periodF = <div className="field"><span>תקופה</span><Seg<string> label="תקופה" value={curType} onChange={setType} options={types.map((t) => [t, periodLong(t)] as [string, string])} /></div>;
        const stdOpts = hasStd ? ([['17', 'IFRS 17'], ['c', 'שורות רציפות'], ['4', 'IFRS 4']] as const).filter(([k]) => colsOf(k).length).map(([k, n]) => [k, n] as ['17' | '4' | 'c', string]) : [];
        const stdCols = hasStd ? colsOf(stdTab) : [];
        const stdF = hasStd && <div className="field"><span>תקן</span><Seg<'17' | '4' | 'c'> label="תקן חשבונאי" value={stdTab} onChange={(k) => { setStdTab(k); setRange([null, null]); setSel([]); }} options={stdOpts} /></div>;
        const rngTxt = stdCols.length ? <span className="rng num">{pl(stdCols[0])} עד {pl(stdCols[stdCols.length - 1])}</span> : null;
        const chartF = <div className="field"><span>גרף</span><button type="button" className={`btn${showChart ? ' primary' : ''}`} aria-pressed={showChart} onClick={() => setShowChart((v) => !v)}>{showChart ? 'גרף מוצג' : 'הצגת גרף'}</button></div>;
        const stdM = hasStd && <Pick<'17' | '4' | 'c'> label="תקן חשבונאי" value={stdTab} onChange={(k) => { setStdTab(k); setRange([null, null]); setSel([]); }} options={stdOpts} />;
        // the vintage as a menu: the latest print, each period as first reported, or as of one report
        const vinM = fromReports && <Menu label="גרסה" value={policyParam(vinPolicy) || 'latest'} onPick={(k) => setVinPolicy(parsePolicy(k === 'latest' ? null : k))}
          summary={vinPolicy !== 'latest' && !vin.facts && !vin.error ? 'טוען…' : nRestated ? <>{policyLabel(vinPolicy)} <span className="num muted">({nRestated})</span></> : policyLabel(vinPolicy)}
          items={[{ key: 'latest', label: 'מעודכן', hint: 'ההדפסה האחרונה של כל תקופה' }, { key: 'original', label: 'כפי שדווח לראשונה', hint: 'כל תקופה בדוח שלה' },
            ...(vintages ?? []).map(([dt, l]) => ({ key: `asof:${dt}`, group: 'נכון לדוח', label: l }))]} />;
        const colsF = <div className="field"><span>עמודות</span><Seg<'c' | 'a'> label="עמודות" value={compact ? 'c' : 'a'} onChange={(v) => setCompact(v === 'c')} options={[['c', 'אחרונה ושינוי'], ['a', 'כל התקופות']]} /></div>;
        const vinF = fromReports && <div className="field"><span>גרסה</span><VintageToggle value={vinPolicy} onChange={setVinPolicy} busy={vinPolicy !== 'latest' && !vin.facts && !vin.error} vintages={vintages}
          changed={nRestated} /></div>;
        const active = Number(!!(range[0] || range[1])) + Number(!!q) + Number(mode === 'yoy') + Number(dim !== 'all') + Number(scale !== 'm');
        const opts = <>
          <Field label="יחידות"><select value={scale} onChange={(e) => setScale(e.target.value as Scale)} disabled={mode === 'yoy'}>{SCALES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
          <div className="field"><span>תצוגה</span><Seg<'value' | 'yoy'> label="תצוגה" value={mode} onChange={setMode} options={[['value', 'ערך'], ['yoy', 'YoY %']]} /></div>
          <div className="field"><span>סדר</span><Seg<'new' | 'old'> label="סדר עמודות" value={oldestFirst ? 'old' : 'new'} onChange={(v) => setOldestFirst(v === 'old')} options={[['new', 'חדש תחילה'], ['old', 'ישן תחילה']]} /></div>
          {nAll > 2 && <div className="field"><span>טווח תקופות: <b className="num">{pl(allCols[loI])}</b> עד <b className="num">{pl(allCols[hiI])}</b>{(range[0] || range[1]) && <button type="button" className="linkbtn" onClick={() => setRange([null, null])}>כל התקופות</button>}</span>
            <div className="range2" style={{ ['--lo' as string]: `${(loI / (nAll - 1)) * 100}%`, ['--hi' as string]: `${(hiI / (nAll - 1)) * 100}%` }}>
              <input type="range" min={0} max={nAll - 1} step={1} value={loI} onChange={(e) => setLo(Number(e.target.value))} aria-label="מתקופה" />
              <input type="range" min={0} max={nAll - 1} step={1} value={hiI} onChange={(e) => setHi(Number(e.target.value))} aria-label="עד תקופה" />
            </div></div>}
          <div className="field"><span>שורות</span><Seg<'n' | 'd'> label="צפיפות" value={dense ? 'd' : 'n'} onChange={(v) => setDense(v === 'd')} options={[['n', 'רגיל'], ['d', 'צפוף']]} /></div>
          <Field label="חיפוש שורה"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="רווח, פרמיות, CSM" /></Field>
          {sv && sv.dims.length > 1 && <Field label="פילוח"><select value={dim} onChange={(e) => setDim(e.target.value)}><option value="all">כל הפילוחים</option>{sv.dims.map((x) => <option key={x}>{x}</option>)}</select></Field>}
        </>;
        const title = sv ? sheetName(sheetCode) : '';
        if (phone) return <>
          <ContextBar onOpen={() => setMore(true)}>{title} · {periodLong(curType)}{hasStd ? ` · ${stdOpts.find(([k]) => k === stdTab)?.[1] ?? ''}` : ''}{fromReports && vinPolicy !== 'latest' ? ` · ${policyLabel(vinPolicy)}` : ''}{active ? ` · ${active} הגדרות` : ''}</ContextBar>
          <Sheet open={more} onClose={() => setMore(false)} title="הדוח המוצג">{sheetF}{periodF}{stdF}{vinF}{rngTxt}{colsF}{chartF}{entityF}{opts}</Sheet>
        </>;
        return <>
          <CompanyTools>
            {sheetM}
            <Seg<string> label="תקופה" value={curType} onChange={setType} options={types.map((t) => [t, t === 'I' ? periodLong(t) : t] as [string, string])} />
            {stdM}{vinM}
            <button type="button" className={`btn${more ? ' primary' : ''}`} aria-expanded={more} onClick={() => setMore((v) => !v)}>{`אפשרויות${active ? ` · ${active}` : ''}`}</button>
          </CompanyTools>
          {more && <section className="controls opts">{entityF}{chartF}{rngTxt}{opts}</section>}
        </>;
      })()}

      {showChart && <Panel title={series.length === 1 ? series[0].name : 'גרף'} aside={<>
        <span>{unitLabel}</span>
        <button type="button" className={`btn${stack ? ' primary' : ''}`} aria-pressed={stack} onClick={() => setStack((v) => !v)} title="עמודות נערמות זו על זו; ערכים שליליים נערמים מתחת לאפס">ערימה</button>
        <button type="button" className="btn" onClick={() => setShowChart(false)}>סגירת הגרף</button>
      </>}>
        {series.length === 0 || cols.length === 0 ? <Empty title="סמנו שורה בטבלה כדי להציג אותה בגרף" /> : (
          <>
            <Chart label="גרף שורות נבחרות" exportName={`${companyId}-${sheetName(sheetCode)}`} height={340} onPoint={onPoint} deps={[sel, cols, mode, scale, sheetCode, kind, series.length, stack, flip, growth, vinPolicy, vin.facts]} build={() => {
              // rows as printed become series; a rate row or a growth line goes to the percent axis; IFRS 4 figures are drawn lighter and the break is marked
              const isPct = (u: string) => mode === 'yoy' || u === 'pct';
              const fox: FoxSeries[] = [];
              series.forEach((s) => {
                const pct = isPct(s.m.unit), color = pal[s.k % pal.length];
                fox.push({ name: s.name, color, pct, kind: kind[s.mi] ?? (mode === 'value' && s.m.unit === 'pct' ? 'line' : 'bar'), stack: stack && !s.m.total, faded: s.olds,
                  dec: pct || s.m.unit === 'nis' ? 1 : scale === 'k' ? 0 : 1, data: s.vals.map((v) => (v == null ? null : +(mode === 'yoy' ? v : scaleValue(v, s.m.unit, scale)).toFixed(3))) });
                if (s.gvals) fox.push({ name: `${s.name} · ${s.g === 'yoy' ? 'YoY' : 'QoQ'} %`, color, pct: true, kind: 'line', dashed: true, cap: 300, data: s.gvals.map((v) => (v == null ? null : +v.toFixed(2))) });
              });
              const lastOld = cols.reduce((at, _, i) => (series.some((x) => x.olds[i]) ? i : at), -1), first17 = lastOld >= 0 && lastOld < cols.length - 1 ? lastOld + 1 : -1;
              return foxOption({ x: cols.map((pi) => pl(pi)), series: fox, unit: SCALES.find((x) => x.id === scale)!.label, breakAt: first17 > 0 ? first17 : undefined, breakLabel: 'IFRS 17' });
            }} />
            <div className="legend">
              {series.map((s) => {
                const t = kind[s.mi] ?? (mode === 'value' && s.m.unit === 'pct' ? 'line' : 'bar');
                return (
                  <div className="li" key={s.mi}>
                    <span className="dot" style={{ background: pal[s.k % pal.length] }} />
                    <span>{flip[s.mi] ? '(−) ' : ''}{s.name}{s.total != null && <span className="muted"> · שינוי כולל <bdi className="num">{sn(s.total, 1)}%</bdi>{s.cagr != null && <> · CAGR <bdi className="num">{sn(s.cagr, 1)}%</bdi></>}</span>}</span>
                    <button type="button" title="עמודות או קו" onClick={() => setKind((k) => ({ ...k, [s.mi]: t === 'bar' ? 'line' : 'bar' }))}>{t === 'bar' ? 'עמודות' : 'קו'}</button>
                    <button type="button" title="היפוך סימן, למשל כדי להציג הוצאות מתחת לאפס" aria-pressed={!!flip[s.mi]} onClick={() => setFlip((f) => ({ ...f, [s.mi]: !f[s.mi] }))}>±</button>
                    {mode === 'value' && <button type="button" title="קו שיעור צמיחה על אותו גרף, בציר אחוזים" onClick={() => setGrowth((g) => ({ ...g, [s.mi]: g[s.mi] === undefined ? 'yoy' : g[s.mi] === 'yoy' && curType !== 'FY' ? 'qoq' : undefined }))}>{s.g === 'yoy' ? 'קו YoY' : s.g === 'qoq' ? 'קו QoQ' : '+ קו צמיחה'}</button>}
                    <button type="button" aria-label="הסר" onClick={() => toggle(s.mi)}>×</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>}

      {explain != null && (
        <div className="explain">
          <b>{d.metrics[explain].label}</b>
          <div>{notes.error ? 'לא ניתן לטעון הסברים.' : explainText ?? (notes.data ? 'אין הסבר לשורה זו.' : 'טוען הסבר…')}</div>
        </div>
      )}

      {!fromReports && longSheet && <div className="explain">הטבלה הזו היא הדוח המלא מהדוח האחרון בלבד, ולכן יש בה רק תקופת הדוח ותקופת ההשוואה. <button type="button" className="btn" onClick={() => { setSheetCode(longSheet.code); setSel([]); }}>לרצף הרבעוני מ-2021</button></div>}
      <Panel className="finpanel" title={sv ? (sheetName(sheetCode).startsWith(d.groups[sv.group]) ? sheetName(sheetCode) : `${d.groups[sv.group]} · ${sheetName(sheetCode)}`) : ''} aside={<><span className="legend-note">{!sv ? '' : fromReports ? `נטוי = מחושב מהשנתי · אפור = IFRS 4${nRestated ? ` · נקודה = הוצג מחדש (${nRestated})` : ''} · כל ערך מקושר לעמוד המקור` : `עמודים ${d.sheets.find((s) => s.code === sheetCode)?.pages} ב-PDF`}</span>{sv && rows.length > 0 && <button type="button" className="btn" onClick={() => void exportXlsx()} title="גיליון Excel: המספרים כמספרים, כל מספר מודפס מקושר לעמוד שלו">Excel</button>}</>}>
        <div className="scroll" style={{ maxHeight: 640 }}>
          <table className={`fin${dense ? ' dense' : ''}${compact ? ' compact' : ''}`}>
            <thead>{compact && lastPi != null ? <tr><th>שורה</th><th className="lead">{pl(lastPi)}</th><th>YoY</th>{qoqPi != null && <th>QoQ</th>}</tr> : <tr><th>שורה</th>{colsDesc.map((pi) => <th key={pi} className={pi === lastPi ? 'lead' : undefined}>{pl(pi)}</th>)}<th>עמ׳</th></tr>}</thead>
            <tbody>
              {rows.map((r) => {
                if (r.m.header) return <tr key={r.idx} className={`sec${r.m.std ? ' std' : ''}`}><td colSpan={compact ? 4 : colsDesc.length + 2}>{r.m.label}</td></tr>;
                const on = sel.includes(r.idx), k = sel.indexOf(r.idx);
                const src = colsDesc.map((pi) => r.values.get(pi)).find((x) => seen(x) && x?.page != null);
                const page = src?.page ?? null;
                const link = open(page, src?.u);
                return (
                  <tr key={r.idx} className={r.m.total ? 'tot' : undefined}>
                    <td className="lbl"><div className="mrow">
                      <input type="checkbox" checked={showChart && on} onChange={() => { if (!showChart) { setShowChart(true); setSel([r.idx]); } else toggle(r.idx); }} aria-label={`הצג בגרף: ${r.m.label}`} title="הצגה בגרף" />
                      {showChart && on && <span className="dot" style={{ background: pal[k % pal.length] }} />}
                      <span className={hasNotes ? 'expl' : undefined} title={r.m.label} onClick={hasNotes ? () => setExplain(explain === r.idx ? null : r.idx) : undefined}>{r.m.label}{r.m.dim && <span className="dim">{r.m.dim}</span>}</span>
                      {r.m.role && <Link className="peers" to={`/industry/lines?l=${r.m.role}&c=${companyId}&g=${fund ? 'fund' : 'ins'}`} title="אותה שורה בכל החברות, לאורך זמן">מול עמיתים</Link>}
                      

                    </div></td>
                    {compact && lastPi != null ? compactCells(r.idx) : <>{colsDesc.map((pi) => { const f0 = r.values.get(pi), f = seen(f0) ? f0 : undefined, txt = shown(r.idx, pi), body = <span className={`num ${mode === 'yoy' ? (cell(r.idx, pi) ?? 0) >= 0 ? 'pos' : 'neg' : ''}${f?.der ? ' der' : ''}${f?.old ? ' old' : ''}${f?.re && !vin.facts ? ' re' : ''}`} title={f?.der ? 'מחושב: FY פחות 9M' : f?.re && !vin.facts ? 'הוצג מחדש בדוח מאוחר: מוצג הערך המעודכן' : undefined}>{txt}</span>; return <td key={pi} className={pi === lastPi ? 'lead' : undefined}>{vMark(r.idx, pi)}{txt === '–' ? body : <Sourced src={() => cellProv(r.idx, pi)} href={pdfHref(r.idx, pi)}>{body}</Sourced>}</td>; })}
                    <td>{page != null ? (link ? <a href={link} target="_blank" rel="noreferrer" className="num">{page}</a> : <span className="num">{page}</span>) : '–'}</td></>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      {restated.length > 0 && (
        <Panel title="הוצג מחדש" aside={<><span>{restated.length} מספרים שדוח מאוחר הדפיס אחרת</span><button type="button" className="btn" aria-expanded={showRe} onClick={() => setShowRe((v) => !v)}>{showRe ? 'סגירה' : 'הצגה'}</button></>}>
          {showRe && <>
            <DataTable caption="הוצג מחדש" rows={restated.map((r, i) => {
                const [, , label, typ, end, a, pa, ua, b, pb, ub, by] = r;
                const link = (u: number | null, pg: number | null) => (u != null && d.urls?.[u] ? `${d.urls[u]}${pg ? `#page=${pg}` : ''}` : null);
                const per = periodLabel(typ, end), inRep = periodLabel(by.slice(5, 7) === '12' ? 'FY' : 'Q', by), rate = /למניה/.test(label) ? 'nis' : 'k';
                const fv = (v: number) => fmtCell(v, rate, scale), unit = rate === 'nis' ? 'ש"ח' : SCALES.find((x) => x.id === scale)!.label;
                const fact = (v: number, u: number | null, pg: number | null, what: string): Prov => report({ title: label, value: fv(v), unit, url: u != null ? d.urls?.[u] ?? null : null, pg, doc: docOf(store, entity, u != null ? d.urls?.[u] ?? null : null), period: per,
                  note: what, restated: { first: fv(a), last: fv(b), firstHref: link(ua, pa) ?? undefined, lastHref: link(ub, pb) ?? undefined, in: inRep } });
                const flip = Math.abs(a + b) < 0.5, chg = ((b - a) / Math.abs(a)) * 100, chgT = `${sn(chg, 1)}%`;
                const diff = () => calc(`${label} · ${per} · שינוי בין הדפסות`, chgT, 'בהדפסה האחרונה − כפי שדווח לראשונה, ÷ |כפי שדווח לראשונה|', [{ label: 'כפי שדווח לראשונה', v: fv(a), src: () => fact(a, ua, pa, 'כפי שדווח לראשונה') }, { label: `בהדפסה האחרונה (${inRep})`, v: fv(b), src: () => fact(b, ub, pb, `כפי שהודפס בדוח ${inRep}`) }], '%');
                return { i, label, end, per, inRep, by, a, b, fv, flip, chg, chgT, diff, first: () => fact(a, ua, pa, 'כפי שדווח לראשונה'), last: () => fact(b, ub, pb, `כפי שהודפס בדוח ${inRep}`), hrefA: link(ua, pa), hrefB: link(ub, pb), scaled: (v: number) => scaleValue(v, rate, scale) };
              })} rowKey={(r) => String(r.i)} export={{ name: `fox-${companyId}-restated`, title: 'הוצג מחדש', note: `כפי שדווח לראשונה מול ההדפסה האחרונה · ${SCALES.find((x) => x.id === scale)!.label}` }}
              columns={[
                { key: 'l', head: 'שורה', value: (r) => r.label, tdClass: () => 'lbl' },
                { key: 'p', head: 'תקופה', value: (r) => r.end, text: (r) => r.per, cell: (r) => <span className="num">{r.per}</span> },
                { key: 'a', head: 'כפי שדווח לראשונה', value: (r) => r.scaled(r.a), cell: (r) => <Sourced src={r.first} href={r.hrefA}><span className="num">{r.fv(r.a)}</span></Sourced> },
                { key: 'b', head: 'בהדפסה האחרונה', value: (r) => r.scaled(r.b), cell: (r) => <Sourced src={r.last} href={r.hrefB}><span className="num">{r.fv(r.b)}</span></Sourced> },
                { key: 'c', head: 'שינוי', value: (r) => (r.flip ? null : r.chg), unit: 'pct', cell: (r) => (r.flip ? <span className="muted">היפוך סימן בהצגה</span> : <Sourced src={r.diff}><span className={`num ${r.b - r.a >= 0 ? 'pos' : 'neg'}`}>{r.chgT}</span></Sourced>) },
                { key: 'in', head: 'בדוח', value: (r) => r.by, text: (r) => r.inRep, cell: (r) => <span className="num">{r.inRep}</span> },
              ]} />
            <div className="src">הטבלאות למעלה מציגות כל תקופה כפי שדווחה בדוח שלה. כאן: מה השתנה כשדוח מאוחר הדפיס את אותה תקופה כמספר השוואה. נכללות רק שורות שזוהו כאותה שורה (אותו סימן ועד פי שניים, או היפוך סימן בלבד).</div>
          </>}
        </Panel>
      )}

    </>
  );
}

/* ---------- IFRS 17: CSM by portfolio group ---------- */
export function CompanyReviewTab() {
  const { entry, store } = useCtx();
  if (entry.kind === 'fund_house') return <Navigate to="../numbers" replace />;  // a fund house has no IFRS 17 review: its tabs are the ones with content
  return <CompanyReview id={entry.id} docs={entry.docs} store={store} />;
}

export function CompanyHistTab() {
  const { entry } = useCtx();
  return <CompanySeries id={entry.id} docs={entry.docs} />;
}

export function CompanySopTab() {
  const { entry, store } = useCtx();
  if (entry.kind === 'fund_house') return <Navigate to="../numbers" replace />;
  return <CompanySop id={entry.id} docs={entry.docs} store={store} />;
}

export function CompanyIfrs17() {
  const { entry, store } = useCtx();
  if (entry.kind === 'fund_house') return <Navigate to="../numbers" replace />;
  return <><CompanyIfrs id={entry.id} docs={entry.docs} /><CsmEconomics id={entry.id} />{store && <CsmExplorer store={store} />}</>;
}

function CsmExplorer({ store }: { store: CompanyStore }) {
  const [seg, setSeg] = useState<'F.N03_חיים_מאזן' | 'F.N03_בריאות_מאזן'>('F.N03_חיים_מאזן');
  const d = store.d;
  const items = useMemo(() => d.metrics.map((m, i) => ({ m, i })).filter(({ m }) => m.sheet === seg && !m.header && m.label.startsWith('מרווח השירות החוזי (CSM)')), [d, seg]);
  const total = items.find(({ m }) => m.dim === 'סך הכל');
  const parts = items.filter(({ m }) => m.dim !== 'סך הכל');
  const dates = useMemo(() => d.periods.map((p, i) => ({ p, i })).filter(({ p, i }) => p.type === 'I' && parts.some(({ i: mi }) => store.val(mi, i) != null)).sort((a, b) => a.p.end.localeCompare(b.p.end)), [d, parts, store]);
  const [on, setOn] = useState<Record<number, boolean>>({});
  const [mode, setMode] = useState<'val' | 'pct'>('val');
  const pal = palette();
  const shortDim = (s: string) => s.replace(/\s*\(\d+\)\s*$/, '').replace(/^(פוליסות הכוללות רכיב חיסכון.*)$/, '$1 (ביטוחי מנהלים)');
  const defaultOn = (idx: number) => on[idx] ?? (seg === 'F.N03_חיים_מאזן' ? shortDim(d.metrics[idx].dim ?? '') === 'פוליסות ללא רכיב חיסכון' : idx === parts[0]?.i);
  const chosen = parts.filter(({ i }) => defaultOn(i));
  const val = (mi: number, pi: number) => store.val(mi, pi);
  const last = dates[dates.length - 1], prevYear = dates.find((x) => x.p.end === shiftYear(last?.p.end ?? '', -1)), dec = dates.find((x) => x.p.end.endsWith('12-31') && x !== last);
  const chg = (mi: number, base?: { i: number }) => { const a = base ? val(mi, base.i) : null, b = last ? val(mi, last.i) : null; return a && b ? (b / a - 1) * 100 : null; };  // a line absent from either period has no change, it is not a fall to zero
  const tot = total?.i ?? null;
  const { open: openSrc } = useSource();
  const mm = (mi: number, pi: number) => { const v = val(mi, pi); return v == null ? '–' : nf(v / 1000, 1); };
  const pr = (mi: number, pi: number): Prov => printed(store, mi, pi, { value: mm(mi, pi), unit: 'מיליוני ש"ח', entity: 'F' });
  const chgProv = (mi: number, base: { i: number; p: unknown } | undefined, text: string): Prov => calc(`${d.metrics[mi].label} · ${shortDim(d.metrics[mi].dim ?? '')} · שינוי`, text, `${store.plabel(last.i)} ÷ ${store.plabel(base!.i)} − 1`,
    [last.i, base!.i].map((x) => ({ label: store.plabel(x), v: mm(mi, x), src: () => pr(mi, x) })), '%');
  const onPoint = (si: number, di: number) => {
    const c = chosen[si], x = dates[di];
    if (!c || !x || val(c.i, x.i) == null) return;
    if (mode === 'val' || tot == null) { openSrc(pr(c.i, x.i)); return; }
    const t = val(tot, x.i), v = val(c.i, x.i)!;
    openSrc(t ? calc(`${shortDim(c.m.dim ?? '')} · ${store.plabel(x.i)} · % מסך ה-CSM`, `${nf(v / t * 100, 1)}%`, 'קבוצת תיק ÷ סך ה-CSM',
      [{ label: shortDim(c.m.dim ?? ''), v: mm(c.i, x.i), src: () => pr(c.i, x.i) }, { label: 'סך הכל', v: mm(tot, x.i), src: () => pr(tot, x.i) }], '%') : pr(c.i, x.i));
  };
  const chgCell = (mi: number, base?: { i: number; p: unknown }) => { const c = chg(mi, base); return c == null ? '–' : <Sourced src={() => chgProv(mi, base, `${sn(c, 1)}%`)}>{`${sn(c, 1)}%`}</Sourced>; };
  const valCell = (mi: number, pi: number) => (val(mi, pi) ? <Sourced src={() => pr(mi, pi)}>{mm(mi, pi)}</Sourced> : '–');

  if (!total || dates.length === 0) return <Empty title="אין נתוני CSM בקובץ זה" />;
  return (
    <>
      <section className="controls">
        <div className="field"><span>מגזר</span><Seg label="מגזר" value={seg} onChange={(v) => { setSeg(v); setOn({}); }} options={[['F.N03_חיים_מאזן', 'ביטוח חיים'], ['F.N03_בריאות_מאזן', 'ביטוח בריאות']]} /></div>
        <div className="field"><span>תצוגה</span><Seg<'val' | 'pct'> label="תצוגה" value={mode} onChange={setMode} options={[['val', 'ערך'], ['pct', '% מסך ה-CSM']]} /></div>
      </section>
      <div className="grid2">
        <Panel title="יתרת CSM לפי קבוצת תיק" aside={<span>{mode === 'val' ? 'מיליוני ש"ח' : '% מהסה"כ'}</span>}>
          <Chart label="CSM לפי קבוצת תיק" height={340} onPoint={onPoint} deps={[seg, on, mode, store]} build={() => {
            const b = chartBase();
            return {
              animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 50, right: 14, top: 40, bottom: 30 },
              legend: { top: 0, type: 'scroll', textStyle: { color: b.mu, fontSize: 11.5 }, itemWidth: 10, itemHeight: 10, icon: 'roundRect' },
              tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: (v: number) => nf(v, mode === 'val' ? 1 : 1) + (mode === 'pct' ? '%' : '') },
              xAxis: { type: 'category', data: dates.map((x) => store.plabel(x.i)), axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false }, axisLabel: { color: b.mu, fontSize: 12 } },
              yAxis: { type: 'value', max: mode === 'pct' && chosen.length > 1 ? 100 : undefined, axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
              series: chosen.map(({ i, m }, k) => ({
                name: shortDim(m.dim ?? ''), type: 'bar', stack: 'a', barMaxWidth: 70, itemStyle: { color: pal[parts.findIndex((x) => x.i === i) % pal.length] },
                label: { show: true, color: '#fff', fontSize: 11, position: chosen.length > 1 ? 'inside' : 'top', formatter: (p: { value: number }) => (p.value < (mode === 'pct' ? 5 : 150) && chosen.length > 1 ? '' : nf(p.value, 1) + (mode === 'pct' ? '%' : '')) },
                data: dates.map((x) => { const v = val(i, x.i); const t = tot != null ? val(tot, x.i) : null; return v == null ? null : +(mode === 'val' ? v / 1000 : t ? v / t * 100 : 0).toFixed(2); }),
                z: k,
              })),
            };
          }} />
          <div className="src">ביאור 3, מגזרי פעילות · חוזי ביטוח ישירים · <Link to={`../financials?sheet=${encodeURIComponent(seg)}`}>טבלה מלאה</Link></div>
        </Panel>
        <Panel title="קבוצות תיק">
          <DataTable caption="קבוצות תיק" rows={parts} rowKey={(x) => String(x.i)} export={{ name: `fox-csm-${seg.includes('חיים') ? 'life' : 'health'}`, title: 'יתרת CSM לפי קבוצת תיק', note: 'מיליוני ש"ח · ביאור מגזרי פעילות' }}
            foot={<tr className="tot"><td>סה"כ</td>{dates.map((x) => <td key={x.i}><span className="num">{val(total.i, x.i) == null ? '0.0' : <Sourced src={() => pr(total.i, x.i)}>{mm(total.i, x.i)}</Sourced>}</span></td>)}
              <td><span className={`num ${(chg(total.i, dec) ?? 0) >= 0 ? 'pos' : 'neg'}`}>{chgCell(total.i, dec)}</span></td>
              <td><span className={`num ${(chg(total.i, prevYear) ?? 0) >= 0 ? 'pos' : 'neg'}`}>{chgCell(total.i, prevYear)}</span></td></tr>}
            columns={[
              { key: 'g', head: 'קבוצה', value: ({ m }) => shortDim(m.dim ?? ''), tdClass: () => 'lbl', cell: ({ i, m }) => <label className="mrow"><input type="checkbox" checked={defaultOn(i)} onChange={(e) => setOn((o) => ({ ...o, [i]: e.target.checked }))} /><span className="dot" style={{ background: pal[parts.findIndex((x) => x.i === i) % pal.length] }} /><span>{shortDim(m.dim ?? '')}</span></label> },
              ...dates.map((x): Column<(typeof parts)[number]> => ({ key: `d${x.i}`, head: store.plabel(x.i), value: ({ i }) => { const v = val(i, x.i); return v ? v / 1000 : null; }, d: 1, cell: ({ i }) => <span className="num">{valCell(i, x.i)}</span> })),
              { key: 'dec', head: `מול ${dec ? store.plabel(dec.i) : ''}`, value: ({ i }) => chg(i, dec), unit: 'pct', cell: ({ i }) => <span className={`num ${(chg(i, dec) ?? 0) >= 0 ? 'pos' : 'neg'}`}>{chgCell(i, dec)}</span> },
              { key: 'yoy', head: `מול ${prevYear ? store.plabel(prevYear.i) : ''}`, value: ({ i }) => chg(i, prevYear), unit: 'pct', cell: ({ i }) => <span className={`num ${(chg(i, prevYear) ?? 0) >= 0 ? 'pos' : 'neg'}`}>{chgCell(i, prevYear)}</span> },
            ]} />
        </Panel>
      </div>
    </>
  );
}

/* ---------- savings (market data for the company group) ---------- */
const LensForGroup = lazy(async () => ({ default: (await import('./SavingsLens')).LensForGroup }));
export function CompanySavings() {
  const { entry, market } = useCtx();
  const ai = useLoad<{ managers: { id: string; latest: string | null }[] }>('assets/index.json');
  if (!entry.market_group) return <Empty title="אין שיוך לנתוני שוק" />;
  if (!market) return <Loading what="נתוני שוק" />;
  return <>{ai.data?.managers.some((m) => m.id === entry.id && m.latest) && <p><Link className="chip" to={`/holdings/${entry.id}`}>הרכב נכסים</Link></p>}<Suspense fallback={null}><LensForGroup group={entry.market_group} /></Suspense><GroupPanel m={market} group={entry.market_group} /></>;
}
