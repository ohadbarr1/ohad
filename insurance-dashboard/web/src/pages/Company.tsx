import { useEffect, useMemo, useState } from 'react';
import { CompanyIfrs } from './CompanyIfrs';
import { CompanyReview } from './CompanyReview';
import { CompanySop } from './CompanySop';
import { CompanySeries } from './CompanySeries';
import { Link, NavLink, Outlet, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { GroupPanel } from './Market';
import { CHART_FONT, chartBase, palette } from '../lib/theme';
import { CompanyStore, shiftYear, sheetName } from '../lib/company';
import { SCALES, fmtCell, nf, periodLong, scaleValue, sn, type Scale } from '../lib/format';
import { useCompanyNotes, useCompanyStore, useMarket, useRegistry } from '../lib/useData';
import type { Market } from '../lib/market';
import type { RegistryCompany } from '../lib/types';

export interface Ctx { entry: RegistryCompany; store: CompanyStore | null; storeError: string | null; market: Market | null }
export const useCtx = () => useOutletContext<Ctx>();
export const DOC_TYPE: Record<string, string> = { annual: 'שנתי', quarterly: 'רבעוני', presentation: 'מצגת', solvency: 'כושר פירעון' };

const KIND: Record<string, string> = { insurance_group: 'קבוצת ביטוח ופיננסים', fund_house: 'בית השקעות / מנהל קופות' };

export function CompanyLayout() {
  const { id } = useParams();
  const reg = useRegistry();
  const entry = reg.data?.find((c) => c.id === id) ?? null;
  const { store, error: storeError } = useCompanyStore(id ?? null, !!entry?.has_financials);
  const { market } = useMarket();
  if (reg.error) return <ErrorBox what="רשימת החברות" error={reg.error} />;
  if (!reg.data) return <Loading what="חברה" />;
  if (!entry) return <Empty title="החברה לא נמצאה">בדוק את הכתובת או חפש בשורת החיפוש.</Empty>;
  const latest = entry.filings[0]?.period;
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{entry.name_he}{entry.name_en && <> <span className="muted en"><span className="sep">· </span><bdi>{entry.name_en}</bdi></span></>}</h1>
          <div className="sub row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{KIND[entry.kind]}</span>
            {entry.has_financials && <span className="chip loaded">נתונים: {latest}</span>}
            {entry.docs > 0 && <span className="chip loaded">{entry.docs} מסמכים</span>}
            {market && entry.market_group && <span className="chip">שוק: {market.plabel(market.LAST)}</span>}
          </div>
        </div>
        <Link className="chip" to={`/valuation/${entry.id}/dcf`}>הערכת שווי</Link>
      </div>
      <nav className="subnav" aria-label="חברה">
        <NavLink to="." end>סקירה</NavLink>
        <NavLink to="review">סקירת דוח</NavLink>
        {entry.has_financials && <NavLink to="financials">דוחות כספיים</NavLink>}
        <NavLink to="profit">מקורות רווח וענפים</NavLink>
        <NavLink to="ifrs17">IFRS 17</NavLink>
        <NavLink to="savings">חיסכון ארוך טווח</NavLink>
        <NavLink to="filings">מסמכים{entry.docs > 0 && <span className="count num">{entry.docs}</span>}</NavLink>
      </nav>
      <Outlet context={{ entry, store, storeError, market } satisfies Ctx} />
    </>
  );
}

function NoFinancials({ entry }: { entry: RegistryCompany }) {
  return <Empty title="הנתונים מהדוחות טרם חולצו">{entry.docs > 0 && <Link to="../filings">{entry.docs} מסמכי מקור</Link>}</Empty>;
}

/* ---------- financials: the metric table that drives the chart ---------- */
const ENTITIES: [string, string][] = [['F', 'חברת האם (מאוחד)'], ['I', 'חברת הביטוח'], ['P', 'פנסיה וגמל']];
const GROUP_ORDER = ['income', 'balance', 'cashflow', 'oci', 'segments', 'life', 'health', 'general', 'pension', 'insurance_services', 'investments', 'instruments', 'capital', 'other'];

export function CompanyFinancials() {
  const { entry, store, storeError } = useCtx();
  if (storeError) return <ErrorBox what="נתוני החברה" error={storeError} />;
  if (!entry.has_financials) return <NoFinancials entry={entry} />;
  if (!store) return <Loading what="דוחות כספיים" />;
  return <FinancialsInner store={store} companyId={entry.id} />;
}

function FinancialsInner({ store, companyId }: { store: CompanyStore; companyId: string }) {
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
  const [type, setType] = useState<string>(sp.get('t') ?? '');
  const [scale, setScale] = useState<Scale>((['k', 'm', 'b'] as Scale[]).find((x) => x === sp.get('u')) ?? 'm');
  const [mode, setMode] = useState<'value' | 'yoy'>(sp.get('v') === 'yoy' ? 'yoy' : 'value');
  const [showChart, setShowChart] = useState(sp.get('g') === '1');
  const [stack, setStack] = useState(sp.get('k') === '1');
  const [flip, setFlip] = useState<Record<number, boolean>>({});
  const [growth, setGrowth] = useState<Record<number, 'yoy' | 'qoq' | undefined>>({});
  const [q, setQ] = useState('');
  const [oldestFirst, setOldestFirst] = useState(sp.get('r') === '1');
  const [dim, setDim] = useState('all');
  const [sel, setSel] = useState<number[]>(initSel);
  const [kind, setKind] = useState<Record<number, 'bar' | 'line'>>({});
  const [explain, setExplain] = useState<number | null>(null);
  const notes = useCompanyNotes(companyId, explain != null);

  const sv = useMemo(() => store.sheet(sheetCode), [store, sheetCode]);
  const types = useMemo(() => {
    if (!sv) return [] as string[];
    const order = ['Q', 'H', 'FY', 'I'];  // nine-month columns are kept in the data only to derive the fourth quarter
    return order.filter((t) => sv.periods.some((p) => p.type === t));
  }, [sv]);
  const curType = types.includes(type) ? type : types[0] ?? '';

  // A statement that changed accounting standard is read one structure at a time: IFRS 17 as reported from 2024, IFRS 4 as reported until 2024,
  // or only the lines that exist under both and so run through the break.
  const [stdPick, setStdTab] = useState<'17' | '4' | 'c'>((['17', '4', 'c'] as const).find((x) => x === sp.get('s')) ?? 'c');  // the page opens on the lines that run through the whole history
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
  const val = (mi: number | null, pi: number): number | null => { if (mi == null || pi < 0) return null; const f = store.byMetric.get(mi)?.get(pi); return f && seen(f) ? f.v : null; };
  const inTab = (idx: number) => !hasStd || tabRows[stdTab].has(idx);
  const colsOf = (tab: '17' | '4' | 'c') => (sv ? sv.periodIdx.filter((pi) => d.periods[pi].type === curType && sv.rows.some((r) => tabRows[tab].has(r.idx) && (() => { const f = r.values.get(pi); return !!f && !(tab === '17' && f.old); })())) : []);
  const allCols = useMemo(() => (!sv ? [] : hasStd ? colsOf(stdTab) : sv.periodIdx.filter((pi) => d.periods[pi].type === curType)), [sv, d, curType, hasStd, stdTab, tabRows]);  // eslint-disable-line react-hooks/exhaustive-deps
  // the period window: kept as dates, so it survives a change of table or of period type
  const [range, setRange] = useState<[string | null, string | null]>([sp.get('f'), sp.get('e')]);
  const cols = useMemo(() => allCols.filter((pi) => { const e = d.periods[pi].end; return (!range[0] || e >= range[0]) && (!range[1] || e <= range[1]); }), [allCols, d, range]);
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
      if (!cols.some((pi) => seen(r.values.get(pi)))) continue;
      out.push(...pending); pending = [];
      out.push(r);
    }
    return out;
  }, [sv, dim, cols, needle, stdTab, hasStd]);  // eslint-disable-line react-hooks/exhaustive-deps

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
    const q: Record<string, string> = { sheet: sheetCode };
    if (sel.length) q.m = sel.join(',');
    if (curType) q.t = curType;
    if (scale !== 'm') q.u = scale;
    if (mode !== 'value') q.v = mode;
    if (oldestFirst) q.r = '1';
    if (showChart) q.g = '1';
    if (stack) q.k = '1';
    if (hasStd && stdTab !== 'c') q.s = stdTab;
    if (range[0]) q.f = range[0];
    if (range[1]) q.e = range[1];
    setSp(q, { replace: true });
  }, [sheetCode, sel, curType, scale, mode, oldestFirst, showChart, stack, range, stdTab, hasStd, setSp]);

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
  const curGroup = sheets.filter((x) => x.group === sv?.group);
  const optGroups = GROUP_ORDER.map((g) => ({ g, items: sheets.filter((s) => s.group === g) })).filter((x) => x.items.length);

  const series = sel.filter((i) => rows.some((r) => r.idx === i)).map((mi, k) => {
    const m = d.metrics[mi];
    const sign = flip[mi] ? -1 : 1;
    const vals = cols.map((pi) => { const v = cell(mi, pi); return v == null ? null : v * sign; });
    // growth of the row itself, as printed: against the same period a year earlier, or against the previous column
    const g = mode === 'value' ? growth[mi] : undefined;
    const gvals = !g ? null : cols.map((pi, ci) => { const v = val(mi, pi), pp = g === 'yoy' ? prior(pi) : ci > 0 ? cols[ci - 1] : -1, pv = pp >= 0 ? val(mi, pp) : null; return v != null && pv ? ((v - pv) / Math.abs(pv)) * 100 : null; });
    const first = vals.findIndex((v) => v != null), lastI = vals.length - 1 - [...vals].reverse().findIndex((v) => v != null);
    let total: number | null = null, cagr: number | null = null;
    if (mode === 'value' && first >= 0 && lastI > first && vals[first]) {
      total = (vals[lastI]! / vals[first]! - 1) * 100;
      const yrs = (Date.parse(d.periods[cols[lastI]].end) - Date.parse(d.periods[cols[first]].end)) / (365.25 * 864e5);
      if (yrs >= 1 && vals[first]! > 0 && vals[lastI]! > 0) cagr = (Math.pow(vals[lastI]! / vals[first]!, 1 / yrs) - 1) * 100;
    }
    return { mi, m, k, vals, g, gvals, total, cagr, name: m.dim ? `${m.label.replace(/\s+\(.*?\)\s*$/, '')} · ${m.dim}` : m.label };
  });

  const pal = palette();
  const unitLabel = mode === 'yoy' ? 'YoY %' : (SCALES.find((s) => s.id === scale)!.label);

  const toggle = (mi: number) => setSel((cur) => (cur.includes(mi) ? cur.filter((x) => x !== mi) : [...cur, mi]));
  const fromReports = sheetCode.startsWith('X.');
  // a figure from the periodic reports links only to its own report; the entity's single source file would be the wrong document
  const open = (page: number | null, u?: number | null) => (fromReports && u == null ? null : store.sourceUrl(entity, page, u));

  const explainText = explain != null ? notes.data?.[String(explain)] : null;

  return (
    <>
      <section className="controls">
        {entities.length > 1 && <div className="field"><span>ישות מדווחת</span><Seg<string> label="ישות מדווחת" value={entity} onChange={(e) => { setEntity(e); const own = d.sheets.filter((s) => s.entity === e), first = own.find((s) => s.code.startsWith('X.') && s.group === 'income') ?? own.find((s) => s.code.startsWith('X.')) ?? own.find((s) => s.group === 'income') ?? own[0]; if (first) { setSheetCode(first.code); setSel([]); } }} options={entities} /></div>}
        <div className="field"><span>דוח</span><div className="seg wrap" role="group" aria-label="דוח">
          {optGroups.map(({ g, items }) => <button key={g} type="button" aria-pressed={sv?.group === g} onClick={() => { setSheetCode(items[0].code); setSel([]); }}>{d.groups[g]}</button>)}
        </div></div>
        {curGroup.length > 1 && <Field label="טבלה"><select value={sheetCode} onChange={(e) => { setSheetCode(e.target.value); setSel([]); }}>{curGroup.map((x) => <option key={x.code} value={x.code}>{sheetName(x.code)}{span(x.code)}</option>)}</select></Field>}
        <div className="field"><span>תקופה</span><Seg<string> label="תקופה" value={curType} onChange={setType} options={types.map((t) => [t, periodLong(t)] as [string, string])} /></div>
        <Field label="יחידות"><select value={scale} onChange={(e) => setScale(e.target.value as Scale)} disabled={mode === 'yoy'}>{SCALES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
        <div className="field"><span>תצוגה</span><Seg<'value' | 'yoy'> label="תצוגה" value={mode} onChange={setMode} options={[['value', 'ערך'], ['yoy', 'YoY %']]} /></div>
        <div className="field"><span>סדר</span><Seg<'new' | 'old'> label="סדר עמודות" value={oldestFirst ? 'old' : 'new'} onChange={(v) => setOldestFirst(v === 'old')} options={[['new', 'חדש ← ישן'], ['old', 'ישן ← חדש']]} /></div>
        <div className="field"><span>גרף</span><button type="button" className={`btn${showChart ? ' primary' : ''}`} aria-pressed={showChart} onClick={() => setShowChart((v) => !v)}>{showChart ? 'מוצג' : 'הצגת גרף'}</button></div>
        {nAll > 2 && <div className="field"><span>טווח תקופות: <b className="num">{store.plabel(allCols[loI])}</b> עד <b className="num">{store.plabel(allCols[hiI])}</b>{(range[0] || range[1]) && <button type="button" className="linkbtn" onClick={() => setRange([null, null])}>כל התקופות</button>}</span>
          <div className="range2" style={{ ['--lo' as string]: `${(loI / (nAll - 1)) * 100}%`, ['--hi' as string]: `${(hiI / (nAll - 1)) * 100}%` }}>
            <input type="range" min={0} max={nAll - 1} step={1} value={loI} onChange={(e) => setLo(Number(e.target.value))} aria-label="מתקופה" />
            <input type="range" min={0} max={nAll - 1} step={1} value={hiI} onChange={(e) => setHi(Number(e.target.value))} aria-label="עד תקופה" />
          </div></div>}
        <Field label="חיפוש שורה"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="רווח, פרמיות, CSM" /></Field>
        {sv && sv.dims.length > 1 && <Field label="פילוח"><select value={dim} onChange={(e) => setDim(e.target.value)}><option value="all">כל הפילוחים</option>{sv.dims.map((x) => <option key={x}>{x}</option>)}</select></Field>}
      </section>

      {showChart && <Panel title={series.length === 1 ? series[0].name : 'גרף'} aside={<>
        <span>{unitLabel}</span>
        <button type="button" className={`btn${stack ? ' primary' : ''}`} aria-pressed={stack} onClick={() => setStack((v) => !v)} title="עמודות נערמות זו על זו; ערכים שליליים נערמים מתחת לאפס">ערימה</button>
        <button type="button" className="btn" onClick={() => setShowChart(false)}>סגירת הגרף</button>
      </>}>
        {series.length === 0 || cols.length === 0 ? <Empty title="סמנו שורה בטבלה כדי להציג אותה בגרף" /> : (
          <>
            <Chart label="גרף שורות נבחרות" height={340} deps={[sel, cols, mode, scale, sheetCode, kind, series.length, stack, flip, growth]} build={() => {
              const b = chartBase();
              // amounts on the main axis; percentages (ratio rows and growth lines) on the second one when both are drawn
              const isPct = (u: string) => mode === 'value' && u === 'pct';
              const hasAmt = mode === 'yoy' || series.some((s) => !isPct(s.m.unit));
              const second = mode === 'value' && hasAmt && series.some((s) => isPct(s.m.unit) || s.gvals);
              const pctAxis = second ? 1 : 0;
              const has = cols.map((_, ci) => series.some((x) => x.vals[ci] != null || x.gvals?.[ci] != null));
              const lo = Math.max(0, has.indexOf(true)), hi = has.lastIndexOf(true) + 1, xs = cols.slice(lo, hi);
              const out: Record<string, unknown>[] = [];
              series.forEach((s) => {
                const t = kind[s.mi] ?? (isPct(s.m.unit) ? 'line' : 'bar'), color = pal[s.k % pal.length], pct = isPct(s.m.unit);
                const data = s.vals.slice(lo, hi).map((v) => (v == null ? null : +(mode === 'yoy' ? v : scaleValue(v, s.m.unit, scale)).toFixed(3)));
                out.push({ name: s.name, type: t, data, yAxisIndex: pct ? pctAxis : 0, stack: stack && t === 'bar' && !pct ? 'total' : undefined, barMaxWidth: 46, symbolSize: 6, itemStyle: { color }, lineStyle: { color, width: 2.5 },
                  label: { show: !stack && series.length <= 2 && xs.length <= 14, position: 'top', color: b.mu, fontSize: 11, formatter: (p: { value: number | null }) => (p.value == null ? '' : nf(p.value, mode === 'yoy' || pct || s.m.unit === 'nis' ? 1 : scale === 'k' ? 0 : 1)) } });
                if (s.gvals) out.push({ name: `${s.name} · ${s.g === 'yoy' ? 'YoY' : 'QoQ'} %`, type: 'line', data: s.gvals.slice(lo, hi).map((v) => (v == null ? null : +v.toFixed(2))), yAxisIndex: pctAxis, symbolSize: 5, connectNulls: false, itemStyle: { color }, lineStyle: { color, width: 2, type: 'dashed' }, z: 5 });
              });
              return {
                animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 56, right: second ? 56 : 14, top: 18, bottom: xs.length > 14 ? 44 : 30 },
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 } },
                xAxis: { type: 'category', data: xs.map((pi) => store.plabel(pi)), axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false }, axisLabel: { color: b.mu, fontSize: 12, rotate: xs.length > 14 ? 45 : 0 } },
                yAxis: [
                  { type: 'value', axisLabel: { color: b.mu, fontSize: 11, formatter: (v: number) => `\u200E${v}${!hasAmt && mode === 'value' ? '%' : ''}` }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
                  ...(second ? [{ type: 'value', axisLabel: { color: b.mu, fontSize: 11, formatter: (v: number) => `\u200E${v}%` }, splitLine: { show: false } }] : []),
                ],
                series: out,
              };
            }} />
            <div className="legend">
              {series.map((s) => {
                const t = kind[s.mi] ?? (mode === 'value' && s.m.unit === 'pct' ? 'line' : 'bar');
                return (
                  <div className="li" key={s.mi}>
                    <span className="dot" style={{ background: pal[s.k % pal.length] }} />
                    <span>{flip[s.mi] ? '(−) ' : ''}{s.name}{s.total != null && <span className="muted"> (שינוי כולל: <span className="num">{sn(s.total, 1)}%</span>{s.cagr != null && <> · CAGR: <span className="num">{sn(s.cagr, 1)}%</span></>})</span>}</span>
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
      {hasStd && <div className="stdtabs" role="tablist" aria-label="תקן חשבונאי">
        {([['c', 'שורות רציפות', 'שורות שקיימות בשני התקנים; עד 2023 לפי IFRS 4'], ['17', 'IFRS 17', 'כפי שדווח, לרבות מספרי השוואה שהוצגו מחדש'], ['4', 'IFRS 4', 'כפי שדווח במקור']] as const).map(([k, name, note]) => {
          const cs = colsOf(k);
          if (!cs.length) return null;
          return <button key={k} type="button" role="tab" aria-selected={stdTab === k} onClick={() => { setStdTab(k); setRange([null, null]); setSel([]); }}><b>{name}</b><span className="num">{store.plabel(cs[0])} עד {store.plabel(cs[cs.length - 1])}</span><small>{note}</small></button>;
        })}
      </div>}
      <Panel title={sv ? (sheetName(sheetCode).startsWith(d.groups[sv.group]) ? sheetName(sheetCode) : `${d.groups[sv.group]} · ${sheetName(sheetCode)}`) : ''} aside={<span>{!sv ? '' : fromReports ? 'מהדוחות התקופתיים · נטוי = Q4 או H2 מחושב מהדוח השנתי · כל ערך מקושר לדוח שלו · אפור = לפי IFRS 4 כפי שדווח' : `עמודים ${d.sheets.find((s) => s.code === sheetCode)?.pages} ב-PDF`}</span>}>
        <div className="scroll" style={{ maxHeight: 640 }}>
          <table>
            <thead><tr><th>שורה</th>{colsDesc.map((pi) => <th key={pi}>{store.plabel(pi)}</th>)}<th>עמ׳</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                if (r.m.header) return <tr key={r.idx} className={`sec${r.m.std ? ' std' : ''}`}><td colSpan={colsDesc.length + 2}>{r.m.label}</td></tr>;
                const on = sel.includes(r.idx), k = sel.indexOf(r.idx);
                const src = colsDesc.map((pi) => r.values.get(pi)).find((x) => seen(x) && x?.page != null);
                const page = src?.page ?? null;
                const link = open(page, src?.u);
                return (
                  <tr key={r.idx} className={r.m.total ? 'tot' : undefined}>
                    <td className="lbl"><div className="mrow">
                      <input type="checkbox" checked={showChart && on} onChange={() => { if (!showChart) { setShowChart(true); setSel([r.idx]); } else toggle(r.idx); }} aria-label={`הצג בגרף: ${r.m.label}`} title="הצגה בגרף" />
                      {showChart && on && <span className="dot" style={{ background: pal[k % pal.length] }} />}
                      <span>{r.m.label}{r.m.dim && <span className="dim">{r.m.dim}</span>}</span>
                      <button type="button" className="info" onClick={() => setExplain(explain === r.idx ? null : r.idx)} aria-label="הסבר">i</button>
                    </div></td>
                    {colsDesc.map((pi) => { const f0 = r.values.get(pi), f = seen(f0) ? f0 : undefined, href = f?.u != null ? open(f.page, f.u) : null, body = <span className={`num ${mode === 'yoy' ? (cell(r.idx, pi) ?? 0) >= 0 ? 'pos' : 'neg' : ''}${f?.der ? ' der' : ''}${f?.old ? ' old' : ''}`}>{shown(r.idx, pi)}</span>; return <td key={pi}>{href ? <a href={href} target="_blank" rel="noreferrer" className="cellsrc" title={`${f?.old ? 'לפי IFRS 4, כפי שדווח במקור. ' : ''}${f?.der ? 'מחושב מהדוח השנתי (FY פחות התקופה המצטברת). מקור ה-FY' : 'מקור'}: עמ׳ ${f?.page ?? ''}`}>{body}</a> : f?.der ? <span title="מחושב: FY פחות 9M">{body}</span> : body}</td>; })}
                    <td>{page != null ? (link ? <a href={link} target="_blank" rel="noreferrer" className="num">{page}</a> : <span className="num">{page}</span>) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/* ---------- IFRS 17: CSM by portfolio group ---------- */
export function CompanyReviewTab() {
  const { entry } = useCtx();
  return <CompanyReview id={entry.id} docs={entry.docs} />;
}

export function CompanyHistTab() {
  const { entry } = useCtx();
  return <CompanySeries id={entry.id} docs={entry.docs} />;
}

export function CompanySopTab() {
  const { entry } = useCtx();
  return <CompanySop id={entry.id} docs={entry.docs} />;
}

export function CompanyIfrs17() {
  const { entry, store } = useCtx();
  return <><CompanyIfrs id={entry.id} docs={entry.docs} />{store && <CsmExplorer store={store} />}</>;
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
  const chg = (mi: number, base?: { i: number }) => { const a = base ? val(mi, base.i) : null, b = last ? val(mi, last.i) : null; return a && b != null ? (b / a - 1) * 100 : null; };
  const tot = total?.i ?? null;

  if (!total || dates.length === 0) return <Empty title="אין נתוני CSM בקובץ זה" />;
  return (
    <>
      <section className="controls">
        <div className="field"><span>מגזר</span><Seg label="מגזר" value={seg} onChange={(v) => { setSeg(v); setOn({}); }} options={[['F.N03_חיים_מאזן', 'ביטוח חיים'], ['F.N03_בריאות_מאזן', 'ביטוח בריאות']]} /></div>
        <div className="field"><span>תצוגה</span><Seg<'val' | 'pct'> label="תצוגה" value={mode} onChange={setMode} options={[['val', 'ערך'], ['pct', '% מסך ה-CSM']]} /></div>
      </section>
      <div className="grid2">
        <Panel title="יתרת CSM לפי קבוצת תיק" aside={<span>{mode === 'val' ? 'מיליוני ש"ח' : '% מהסה"כ'}</span>}>
          <Chart label="CSM לפי קבוצת תיק" height={340} deps={[seg, on, mode, store]} build={() => {
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
          <div className="scroll"><table>
            <thead><tr><th>קבוצה</th>{dates.map((x) => <th key={x.i}>{store.plabel(x.i)}</th>)}<th>מול {dec ? store.plabel(dec.i) : ''}</th><th>מול {prevYear ? store.plabel(prevYear.i) : ''}</th></tr></thead>
            <tbody>
              {parts.map(({ i, m }) => (
                <tr key={i}>
                  <td className="lbl"><label className="mrow"><input type="checkbox" checked={defaultOn(i)} onChange={(e) => setOn((o) => ({ ...o, [i]: e.target.checked }))} /><span className="dot" style={{ background: pal[parts.findIndex((x) => x.i === i) % pal.length] }} /><span>{shortDim(m.dim ?? '')}</span></label></td>
                  {dates.map((x) => <td key={x.i}><span className="num">{val(i, x.i) == null ? '–' : val(i, x.i) === 0 ? '–' : nf(val(i, x.i)! / 1000, 1)}</span></td>)}
                  <td><span className={`num ${(chg(i, dec) ?? 0) >= 0 ? 'pos' : 'neg'}`}>{chg(i, dec) == null ? '–' : `${sn(chg(i, dec)!, 1)}%`}</span></td>
                  <td><span className={`num ${(chg(i, prevYear) ?? 0) >= 0 ? 'pos' : 'neg'}`}>{chg(i, prevYear) == null ? '–' : `${sn(chg(i, prevYear)!, 1)}%`}</span></td>
                </tr>
              ))}
              <tr className="tot"><td>סה"כ</td>{dates.map((x) => <td key={x.i}><span className="num">{nf((val(total.i, x.i) ?? 0) / 1000, 1)}</span></td>)}
                <td><span className={`num ${(chg(total.i, dec) ?? 0) >= 0 ? 'pos' : 'neg'}`}>{chg(total.i, dec) == null ? '–' : `${sn(chg(total.i, dec)!, 1)}%`}</span></td>
                <td><span className={`num ${(chg(total.i, prevYear) ?? 0) >= 0 ? 'pos' : 'neg'}`}>{chg(total.i, prevYear) == null ? '–' : `${sn(chg(total.i, prevYear)!, 1)}%`}</span></td></tr>
            </tbody>
          </table></div>
        </Panel>
      </div>
    </>
  );
}

/* ---------- savings (market data for the company group) ---------- */
export function CompanySavings() {
  const { entry, market } = useCtx();
  if (!entry.market_group) return <Empty title="אין שיוך לנתוני שוק" />;
  if (!market) return <Loading what="נתוני שוק" />;
  return <GroupPanel m={market} group={entry.market_group} />;
}
