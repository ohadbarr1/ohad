import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, Kpi, Loading, Panel, Seg } from '../components/ui';
import { GroupPanel } from './Market';
import { chartBase, palette } from '../lib/theme';
import { CompanyStore, shiftYear, sheetName } from '../lib/company';
import { SCALES, fmtCell, nf, pct, periodLong, scaleValue, sn, type Scale } from '../lib/format';
import { useCompanyNotes, useCompanyStore, useMarket, useRegistry } from '../lib/useData';
import type { Market } from '../lib/market';
import type { RegistryCompany } from '../lib/types';

interface Ctx { entry: RegistryCompany; store: CompanyStore | null; storeError: string | null; market: Market | null }
const useCtx = () => useOutletContext<Ctx>();

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
          <h1>{entry.name_he}{entry.name_en && <span className="muted" style={{ fontWeight: 400 }}> · {entry.name_en}</span>}</h1>
          <div className="sub row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{KIND[entry.kind]}</span>
            <span className={`chip ${entry.has_financials ? 'loaded' : 'pending'}`}>{entry.has_financials ? `דוחות כספיים: ${latest}` : 'דוחות כספיים: טרם נקלטו'}</span>
            {market && <span className="chip loaded">נתוני שוק: {market.plabel(market.LAST)}</span>}
          </div>
        </div>
      </div>
      <nav className="subnav" aria-label="חברה">
        <NavLink to="." end>סקירה</NavLink>
        <NavLink to="financials">דוחות כספיים</NavLink>
        <NavLink to="ifrs17">IFRS 17 · CSM</NavLink>
        <NavLink to="savings">פנסיה, גמל ופוליסות</NavLink>
        <NavLink to="filings">מסמכי מקור</NavLink>
      </nav>
      <Outlet context={{ entry, store, storeError, market } satisfies Ctx} />
    </>
  );
}

function NoFinancials({ entry }: { entry: RegistryCompany }) {
  return (
    <Empty title={`הדוחות הכספיים של ${entry.name_he} טרם נקלטו`}>
      נתוני השוק (פנסיה, גמל ופוליסות חיסכון) זמינים בלשונית "פנסיה, גמל ופוליסות". כדי לקלוט דוח כספי יש להניח את קובץ ה-PDF בתיקיית הקלט ולהריץ את צינור החילוץ. ראה "כיסוי נתונים".{' '}
      <Link to="/coverage">לטבלת הכיסוי</Link>
    </Empty>
  );
}

/* ---------- overview ---------- */
export function CompanyOverview() {
  const { entry, store, market, storeError } = useCtx();
  if (storeError) return <ErrorBox what="נתוני החברה" error={storeError} />;
  return (
    <>
      {entry.market_group && market && <MarketKpis m={market} group={entry.market_group} />}
      {entry.has_financials ? (store ? <FinancialOverview store={store} /> : <Loading what="דוחות כספיים" />) : <NoFinancials entry={entry} />}
    </>
  );
}

function MarketKpis({ m, group }: { m: Market; group: string }) {
  const L = m.LAST, g = m.groupIndex(group);
  if (g < 0) return null;
  const org = m.value('organic', L, 'ltm', 'all', g), ret = m.value('ret', L, 'ltm', 'fam:pension', g);
  return (
    <section>
      <div className="src" style={{ marginBottom: 6 }}>שוק הפנסיה, הגמל ופוליסות החיסכון · {m.plabel(L)}</div>
      <div className="kpis">
        <Kpi label="נכסים מנוהלים" value={nf(m.value('assets', L, 'm', 'all', g) ?? 0, 1)} sub='מיליארד ש"ח (פנסיה, גמל ופוליסות)' />
        <Kpi label="נתח שוק" value={pct(m.value('share', L, 'm', 'all', g), 1)} sub="מכלל הנכסים" />
        <Kpi label="שינוי בנכסים, 12 חודשים" value={pct(m.value('growth', L, 'ltm', 'all', g), 1, true)} tone={(m.value('growth', L, 'ltm', 'all', g) ?? 0) >= 0 ? 'pos' : 'neg'} />
        <Kpi label="צבירה אורגנית, 12 חודשים" value={org == null ? '–' : sn(org, 1)} sub='מיליארד ש"ח (פנסיה וגמל)' tone={(org ?? 0) >= 0 ? 'pos' : 'neg'} />
        <Kpi label="תשואה בפנסיה, 12 חודשים" value={pct(ret, 1, true)} sub="משוקללת בנכסים" />
      </div>
    </section>
  );
}

function FinancialOverview({ store }: { store: CompanyStore }) {
  const P = (type: string, end: string) => store.periodIndex(type, end);
  const h26 = P('H', '2026-06-30'), h25 = P('H', '2025-06-30'), j26 = P('I', '2026-06-30'), d25 = P('I', '2025-12-31');
  const D2 = 'F.D2_רווח_הפסד', D1 = 'F.D1_מצב_כספי';
  const f = (sheet: string, label: string, dim?: string) => store.find(sheet, label, { exact: true, dim });
  const profit = f(D2, 'בעלי המניות של החברה'), service = f(D2, 'רווח משירותי ביטוח'), invest = f(D2, 'רווח מהשקעות ומימון, נטו');
  const eq = f(D1, 'סך הכל הון המיוחס לבעלי המניות של החברה'), assets = f(D1, 'סה"כ נכסים');
  const eps = store.find(D2, 'רווח בסיסי');
  const csmLife = store.find('F.N03_חיים_מאזן', 'מרווח השירות החוזי', { dim: 'סך הכל' });
  const csmHealth = store.find('F.N03_בריאות_מאזן', 'מרווח השירות החוזי', { dim: 'סך הכל' });
  const mm = (v: number | null) => (v == null ? '–' : nf(v / 1000, 0));
  const yoy = (a: number | null, b: number | null) => (a != null && b ? (a / b - 1) * 100 : null);
  const pNow = store.val(profit, h26), pPrev = store.val(profit, h25);
  const eNow = store.val(eq, j26), eDec = store.val(eq, d25);
  const roe = pNow != null && eNow != null && eDec != null ? (pNow * 2) / ((eNow + eDec) / 2) * 100 : null;
  const cl = store.val(csmLife, j26), clPrev = store.val(csmLife, d25), ch = store.val(csmHealth, j26), chPrev = store.val(csmHealth, d25);
  const tone = (v: number | null) => (v == null ? undefined : v >= 0 ? 'pos' as const : 'neg' as const);

  const lines: [string, number | null][] = [
    ['רווח משירותי ביטוח', service], ['רווח מהשקעות ומימון, נטו', invest], ['הכנסות מדמי ניהול', f(D2, 'הכנסות מדמי ניהול')],
    ['רווח לפני מסים', f(D2, 'רווח לפני מסים על הכנסה')], ['רווח לתקופה', f(D2, 'רווח לתקופה')],
  ];
  return (
    <>
      <section>
        <div className="src" style={{ marginBottom: 6 }}>דוחות כספיים ביניים · 30.6.2026 · הפניקס פיננסים (מאוחד) · מיליוני ש"ח</div>
        <div className="kpis">
          <Kpi label="רווח לבעלי המניות, H1'26" value={mm(pNow)} sub={<>מול <span className="num">{mm(pPrev)}</span> ב-H1'25 · <span className="num">{pct(yoy(pNow, pPrev), 1, true)}</span></>} tone={tone(yoy(pNow, pPrev))} />
          <Kpi label="רווח משירותי ביטוח, H1'26" value={mm(store.val(service, h26))} sub={<>מול <span className="num">{mm(store.val(service, h25))}</span> · <span className="num">{pct(yoy(store.val(service, h26), store.val(service, h25)), 1, true)}</span></>} tone={tone(yoy(store.val(service, h26), store.val(service, h25)))} />
          <Kpi label="הון לבעלי המניות" value={mm(eNow)} sub={<>מול <span className="num">{mm(eDec)}</span> בדצמבר 2025</>} />
          <Kpi label="ROE מחושב (שנתי)" value={pct(roe, 1)} sub="רווח H1 × 2 חלקי הון ממוצע. מחושב כאן ואינו מדד מדווח" />
          <Kpi label={'סה"כ נכסים'} value={mm(store.val(assets, j26))} sub={`מיליוני ש"ח · ${store.val(eps, h26) != null ? 'רווח למניה ' + nf(store.val(eps, h26)!, 2) + ' ש"ח' : ''}`} />
          <Kpi label="CSM חיים" value={mm(cl)} sub={<>מול <span className="num">{mm(clPrev)}</span> בדצמבר 2025 · <span className="num">{pct(yoy(cl, clPrev), 1, true)}</span></>} tone={tone(yoy(cl, clPrev))} />
          <Kpi label="CSM בריאות" value={mm(ch)} sub={<>מול <span className="num">{mm(chPrev)}</span> בדצמבר 2025 · <span className="num">{pct(yoy(ch, chPrev), 1, true)}</span></>} tone={tone(yoy(ch, chPrev))} />
        </div>
      </section>
      <div className="grid21">
        <Panel title="רווח והפסד: H1'26 מול H1'25 (מיליוני ש&quot;ח)">
          <Chart label="השוואת רווח והפסד" height={300} deps={[store]} build={() => {
            const b = chartBase(), pal = palette();
            return {
              animation: false, textStyle: { fontFamily: 'Heebo, sans-serif', color: b.fg }, grid: { left: 52, right: 12, top: 36, bottom: 56 },
              legend: { top: 0, textStyle: { color: b.mu, fontSize: 12 }, itemWidth: 10, itemHeight: 10, icon: 'roundRect' },
              tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: (v: number) => nf(v, 0) },
              xAxis: { type: 'category', data: lines.map((l) => l[0]), axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } }, axisLabel: { color: b.mu, fontSize: 11, interval: 0, width: 80, overflow: 'break' } },
              yAxis: { type: 'value', axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
              series: [["H1'25", h25, pal[7]], ["H1'26", h26, pal[0]]].map(([name, pi, color]) => ({
                name, type: 'bar', barMaxWidth: 30, itemStyle: { color }, label: { show: true, position: 'top', color: b.mu, fontSize: 10.5, formatter: (p: { value: number }) => nf(p.value, 0) },
                data: lines.map((l) => { const v = store.val(l[1], pi as number); return v == null ? null : +(v / 1000).toFixed(1); }),
              })),
            };
          }} />
        </Panel>
        <Panel title="מה נקלט">
          <div className="prose">
            <p>{store.d.stats.sheets_with_facts as number} טבלאות מתוך {store.d.stats.sheets_total as number} גיליונות, {nf(store.d.stats.facts as number, 0)} נתונים, {nf(store.d.stats.metrics as number, 0)} שורות. לכל נתון מצורף עמוד המקור ב-PDF.</p>
            <p>הדוחות כוללים את הפניקס פיננסים (מאוחד) ואת הפניקס חברה לביטוח. גשר CSM, יחס כושר פירעון ומדדי עסק חדש נמצאים בדוח הדירקטוריון ובמצגת המשקיעים ואינם בקובץ הזה.</p>
            <p><Link to="financials">פתח את הדוחות הכספיים</Link> · <Link to="ifrs17">CSM לפי קבוצת תיק</Link></p>
          </div>
        </Panel>
      </div>
    </>
  );
}

/* ---------- financials: the metric table that drives the chart ---------- */
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
  const initMetric = sp.get('m') != null ? Number(sp.get('m')) : null;
  const initSheet = sp.get('sheet') ?? (initMetric != null ? d.metrics[initMetric]?.sheet : null) ?? 'F.D2_רווח_הפסד';
  const [entity, setEntity] = useState<'F' | 'I'>(initSheet.startsWith('I.') ? 'I' : 'F');
  const [sheetCode, setSheetCode] = useState(initSheet);
  const [type, setType] = useState<string>('');
  const [scale, setScale] = useState<Scale>('m');
  const [mode, setMode] = useState<'value' | 'yoy'>('value');
  const [dim, setDim] = useState('all');
  const [sel, setSel] = useState<number[]>(initMetric != null ? [initMetric] : []);
  const [kind, setKind] = useState<Record<number, 'bar' | 'line'>>({});
  const [explain, setExplain] = useState<number | null>(null);
  const notes = useCompanyNotes(companyId, explain != null);

  const sv = useMemo(() => store.sheet(sheetCode), [store, sheetCode]);
  const types = useMemo(() => {
    if (!sv) return [] as string[];
    const order = ['H', 'Q', 'FY', 'I'];
    return order.filter((t) => sv.periods.some((p) => p.type === t));
  }, [sv]);
  const curType = types.includes(type) ? type : types[0] ?? '';

  const cols = useMemo(() => (sv ? sv.periodIdx.filter((pi) => d.periods[pi].type === curType) : []), [sv, d, curType]);
  const colsDesc = useMemo(() => [...cols].reverse(), [cols]);

  const rows = useMemo(() => {
    if (!sv) return [];
    const out: typeof sv.rows = [];
    let pendingHeader: (typeof sv.rows)[number] | null = null;
    for (const r of sv.rows) {
      if (r.m.header) { pendingHeader = r; continue; }
      if (dim !== 'all' && (r.m.dim ?? '') !== dim) continue;
      if (!cols.some((pi) => r.values.has(pi))) continue;
      if (pendingHeader) { out.push(pendingHeader); pendingHeader = null; }
      out.push(r);
    }
    return out;
  }, [sv, dim, cols]);

  // reset the selection when the sheet changes, unless it came from a deep link
  useEffect(() => {
    const first = rows.find((r) => !r.m.header);
    setSel((cur) => {
      const valid = cur.filter((i) => rows.some((r) => r.idx === i));
      return valid.length ? valid : first ? [first.idx] : [];
    });
  }, [rows]);
  useEffect(() => { setDim('all'); }, [sheetCode]);

  const prior = (pi: number): number => { const p = d.periods[pi]; return d.periods.findIndex((q) => q.type === p.type && q.end === shiftYear(p.end, -1) && q.months === p.months); };
  const cell = (mi: number, pi: number): number | null => {
    const m = d.metrics[mi], v = store.val(mi, pi);
    if (mode === 'value') return v;
    const pp = prior(pi), pv = pp >= 0 ? store.val(mi, pp) : null;
    return v != null && pv ? (v / pv - 1) * 100 : null;
    void m;
  };
  const shown = (mi: number, pi: number): string => {
    const v = cell(mi, pi);
    if (mode === 'yoy') return v == null ? '–' : `${sn(v, 1)}%`;
    return fmtCell(v, d.metrics[mi].unit, scale);
  };

  const sheets = useMemo(() => d.sheets.filter((s) => s.entity === entity), [d, entity]);
  const optGroups = GROUP_ORDER.map((g) => ({ g, items: sheets.filter((s) => s.group === g) })).filter((x) => x.items.length);

  const series = sel.filter((i) => rows.some((r) => r.idx === i)).map((mi, k) => {
    const m = d.metrics[mi];
    const vals = cols.map((pi) => cell(mi, pi));
    const first = vals.findIndex((v) => v != null), lastI = vals.length - 1 - [...vals].reverse().findIndex((v) => v != null);
    let total: number | null = null, cagr: number | null = null;
    if (mode === 'value' && first >= 0 && lastI > first && vals[first]) {
      total = (vals[lastI]! / vals[first]! - 1) * 100;
      const yrs = (Date.parse(d.periods[cols[lastI]].end) - Date.parse(d.periods[cols[first]].end)) / (365.25 * 864e5);
      if (yrs >= 1 && vals[first]! > 0 && vals[lastI]! > 0) cagr = (Math.pow(vals[lastI]! / vals[first]!, 1 / yrs) - 1) * 100;
    }
    return { mi, m, k, vals, total, cagr, name: m.dim ? `${m.label.replace(/\s+\(.*?\)\s*$/, '')} · ${m.dim}` : m.label };
  });

  const pal = palette();
  const unitLabel = mode === 'yoy' ? 'שינוי שנתי %' : (SCALES.find((s) => s.id === scale)!.label);

  const toggle = (mi: number) => setSel((cur) => (cur.includes(mi) ? cur.filter((x) => x !== mi) : [...cur, mi]));
  const open = (page: number | null) => store.sourceUrl(entity, page);

  const explainText = explain != null ? notes.data?.[String(explain)] : null;

  return (
    <>
      <section className="controls">
        <div className="field"><span>ישות מדווחת</span><Seg<'F' | 'I'> label="ישות" value={entity} onChange={(e) => { setEntity(e); const first = d.sheets.find((s) => s.entity === e && s.group === 'income'); if (first) { setSheetCode(first.code); setSp({}); } }} options={[['F', 'הפניקס פיננסים (מאוחד)'], ['I', 'הפניקס חברה לביטוח']]} /></div>
        <Field label="דוח / ביאור">
          <select value={sheetCode} onChange={(e) => { setSheetCode(e.target.value); setSel([]); setSp({}); }}>
            {optGroups.map(({ g, items }) => <optgroup key={g} label={d.groups[g]}>{items.map((s) => <option key={s.code} value={s.code}>{sheetName(s.code)}</option>)}</optgroup>)}
          </select>
        </Field>
        <div className="field"><span>תקופה</span><Seg<string> label="תקופה" value={curType} onChange={setType} options={types.map((t) => [t, periodLong(t)] as [string, string])} /></div>
        <Field label="יחידות"><select value={scale} onChange={(e) => setScale(e.target.value as Scale)} disabled={mode === 'yoy'}>{SCALES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
        <div className="field"><span>תצוגה</span><Seg<'value' | 'yoy'> label="תצוגה" value={mode} onChange={setMode} options={[['value', 'ערך'], ['yoy', '% שינוי שנתי']]} /></div>
        {sv && sv.dims.length > 1 && <Field label="פילוח"><select value={dim} onChange={(e) => setDim(e.target.value)}><option value="all">כל הפילוחים</option>{sv.dims.map((x) => <option key={x}>{x}</option>)}</select></Field>}
      </section>

      <Panel title={series.length ? 'השוואה בין התקופות' : 'בחר שורות בטבלה כדי להציג אותן בגרף'} aside={<span>{unitLabel}</span>}>
        {series.length === 0 || cols.length === 0 ? <Empty title="אין שורה נבחרת">סמן שורות בטבלה למטה.</Empty> : (
          <>
            <Chart label="גרף שורות נבחרות" height={320} deps={[sel, cols, mode, scale, sheetCode, kind, series.length]} build={() => {
              const b = chartBase();
              const secondary = mode === 'value' && series.some((s) => s.m.unit !== 'k') && series.some((s) => s.m.unit === 'k');
              return {
                animation: false, textStyle: { fontFamily: 'Heebo, sans-serif', color: b.fg }, grid: { left: 56, right: secondary ? 56 : 14, top: 18, bottom: 30 },
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 } },
                xAxis: { type: 'category', data: cols.map((pi) => store.plabel(pi)), axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false }, axisLabel: { color: b.mu, fontSize: 12 } },
                yAxis: [
                  { type: 'value', axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
                  ...(secondary ? [{ type: 'value', axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { show: false } }] : []),
                ],
                series: series.map((s) => {
                  const t = kind[s.mi] ?? 'bar', color = pal[s.k % pal.length];
                  const data = s.vals.map((v) => (v == null ? null : +(mode === 'yoy' ? v : scaleValue(v, s.m.unit, scale)).toFixed(3)));
                  return { name: s.name, type: t, data, yAxisIndex: secondary && s.m.unit !== 'k' ? 1 : 0, barMaxWidth: 46, symbolSize: 7, itemStyle: { color }, lineStyle: { color, width: 2.5 },
                    label: { show: series.length <= 3, position: 'top', color: b.mu, fontSize: 11, formatter: (p: { value: number | null }) => (p.value == null ? '' : nf(p.value, mode === 'yoy' || s.m.unit === 'nis' ? 1 : scale === 'k' ? 0 : 1)) } };
                }),
              };
            }} />
            <div className="legend">
              {series.map((s) => (
                <div className="li" key={s.mi}>
                  <span className="dot" style={{ background: pal[s.k % pal.length] }} />
                  <span>{s.name}{s.total != null && <span className="muted"> (שינוי כולל: <span className="num">{sn(s.total, 1)}%</span>{s.cagr != null && <> · CAGR: <span className="num">{sn(s.cagr, 1)}%</span></>})</span>}</span>
                  <button type="button" title="החלפת סוג גרף" onClick={() => setKind((k) => ({ ...k, [s.mi]: (k[s.mi] ?? 'bar') === 'bar' ? 'line' : 'bar' }))}>{(kind[s.mi] ?? 'bar') === 'bar' ? 'עמודות' : 'קו'}</button>
                  <button type="button" aria-label="הסר" onClick={() => toggle(s.mi)}>×</button>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>

      {explain != null && (
        <div className="explain">
          <b>{d.metrics[explain].label}</b>
          <div>{notes.error ? 'לא ניתן לטעון הסברים.' : explainText ?? (notes.data ? 'אין הסבר לשורה זו.' : 'טוען הסבר…')}</div>
          <div className="src">ההערות נכתבו בעת חילוץ הדוח. תגית [חישוב] מציינת חישוב מתוך הטבלה, [הסבר כללי] ידע כללי שאינו בדוח, [הערכה] פרשנות.</div>
        </div>
      )}

      <Panel title={sv ? (sheetName(sheetCode).startsWith(d.groups[sv.group]) ? sheetName(sheetCode) : `${d.groups[sv.group]} · ${sheetName(sheetCode)}`) : ''} aside={<span>{sv ? `עמודים ${d.sheets.find((s) => s.code === sheetCode)?.pages} ב-PDF` : ''}</span>}>
        <div className="scroll" style={{ maxHeight: 640 }}>
          <table>
            <thead><tr><th>שורה</th>{colsDesc.map((pi) => <th key={pi}>{store.plabel(pi)}</th>)}<th>עמ׳</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                if (r.m.header) return <tr key={r.idx} className="sec"><td colSpan={colsDesc.length + 2}>{r.m.label}</td></tr>;
                const on = sel.includes(r.idx), k = sel.indexOf(r.idx);
                const page = colsDesc.map((pi) => r.values.get(pi)?.page).find((p) => p != null) ?? null;
                const link = open(page ?? null);
                return (
                  <tr key={r.idx}>
                    <td className="lbl"><div className="mrow">
                      <input type="checkbox" checked={on} onChange={() => toggle(r.idx)} aria-label={`הצג בגרף: ${r.m.label}`} />
                      {on && <span className="dot" style={{ background: pal[k % pal.length] }} />}
                      <span>{r.m.label}{r.m.dim && <span className="dim">{r.m.dim}</span>}</span>
                      <button type="button" className="info" onClick={() => setExplain(explain === r.idx ? null : r.idx)} aria-label="הסבר">i</button>
                    </div></td>
                    {colsDesc.map((pi) => <td key={pi}><span className={`num ${mode === 'yoy' ? (cell(r.idx, pi) ?? 0) >= 0 ? 'pos' : 'neg' : ''}`}>{shown(r.idx, pi)}</span></td>)}
                    <td>{page != null ? (link ? <a href={link} target="_blank" rel="noreferrer" className="num">{page}</a> : <span className="num">{page}</span>) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="src">הערכים כפי שהודפסו בדוח (אלפי ש"ח), מוצגים ביחידה שנבחרה. מקף בדוח מוצג כאפס. לחיצה על מספר העמוד פותחת את הדוח המקורי באותו עמוד.</div>
      </Panel>
    </>
  );
}

/* ---------- IFRS 17: CSM by portfolio group ---------- */
export function CompanyIfrs17() {
  const { entry, store, storeError } = useCtx();
  if (storeError) return <ErrorBox what="נתוני החברה" error={storeError} />;
  if (!entry.has_financials) return <NoFinancials entry={entry} />;
  if (!store) return <Loading what="דוחות כספיים" />;
  return <CsmExplorer store={store} />;
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
  const shortDim = (s: string) => s.replace(/\s*\(\d+\)\s*$/, '');
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
              animation: false, textStyle: { fontFamily: 'Heebo, sans-serif', color: b.fg }, grid: { left: 50, right: 14, top: 40, bottom: 30 },
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
          <div className="src">יתרות בתאריכי מאזן, כפי שדווחו בביאור 3 (מגזרי פעילות). חוזי ביטוח ישירים. סכום הקבוצות נבדק מול הסה"כ המודפס.</div>
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
      <Panel title="מה אפשר ומה אי אפשר לראות מכאן">
        <div className="prose">
          <ul>
            <li><b>יתרות בלבד.</b> הדוח הביניים אינו כולל גשר CSM (פתיחה, עסק חדש, ריבית, שחרור, שינוי הנחות, סגירה) לפי קבוצת תיק. הגשר נמצא בדוח הדירקטוריון ובמצגת המשקיעים, ולכן אי אפשר להסביר מכאן למה היתרה השתנתה.</li>
            <li><b>שחרור CSM לרווח</b> מפורסם לכל מגזר החיים יחד, לא לפי קבוצה. ראה "דוחות כספיים" ← רווח משירותי ביטוח.</li>
          </ul>
          <p><Link to={`../financials?sheet=${encodeURIComponent(seg)}`}>פתח את הטבלה המלאה בדוחות הכספיים</Link></p>
        </div>
      </Panel>
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

/* ---------- filings ---------- */
export function CompanyFilings() {
  const { entry, store } = useCtx();
  const nav = useNavigate();
  if (!entry.has_financials) return <NoFinancials entry={entry} />;
  return (
    <>
      <Panel title="מסמכי מקור שנקלטו">
        <div className="scroll"><table>
          <thead><tr><th>ישות</th><th>תקופה</th><th>מסמך</th><th>עמודים</th><th>קישור</th></tr></thead>
          <tbody>{entry.filings.map((f) => (
            <tr key={f.entity}><td>{f.name}</td><td>{f.period}</td><td>{f.doc}</td><td><span className="num">{f.pages ?? '–'}</span></td><td>{f.url ? <a href={f.url} target="_blank" rel="noreferrer">פתח PDF</a> : '–'}</td></tr>
          ))}</tbody>
        </table></div>
      </Panel>
      {store && (
        <Panel title="מפת המסמך: איפה כל טבלה" aside={<span>לחיצה על שורה פותחת את הדוח הכספי</span>}>
          <div className="scroll" style={{ maxHeight: 560 }}><table>
            <thead><tr><th>ישות</th><th>קבוצה</th><th>טבלה</th><th>עמודים ב-PDF</th></tr></thead>
            <tbody>{store.d.sheets.map((s) => {
              const first = Number(String(s.pages).split('-')[0]);
              const url = store.sourceUrl(s.entity, Number.isFinite(first) ? first : null);
              return (
                <tr key={s.code} style={{ cursor: 'pointer' }} onClick={() => nav(`../financials?sheet=${encodeURIComponent(s.code)}`)}>
                  <td>{s.entity === 'F' ? 'פיננסים' : 'ביטוח'}</td><td>{store.d.groups[s.group]}</td><td>{sheetName(s.code)}</td>
                  <td>{url ? <a href={url} target="_blank" rel="noreferrer" className="num" onClick={(e) => e.stopPropagation()}>{s.pages}</a> : <span className="num">{s.pages}</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </Panel>
      )}
    </>
  );
}
