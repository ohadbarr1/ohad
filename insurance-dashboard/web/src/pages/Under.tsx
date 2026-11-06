import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { NumText } from '../components/NumText';
import { RegSrc } from '../components/RegSrc';
import { DataTable, type Column } from '../components/DataTable';
import { Empty, Kpi, Loading, Panel, Pick } from '../components/ui';
import { useOptional, useClosed } from '../lib/fundsLoad';
import { useFunds, useLoad, load } from '../lib/useData';
import { foxOption } from '../lib/foxchart';
import { cssColor, palette } from '../lib/theme';
import { nf } from '../lib/format';
import { useSource, type Prov } from '../lib/prov';
import { UNDER_PATH, aumProv, costProv, flowProv, gapProv, gflProv, headline, icostProv, ilsM, medProv, pctProv, pointProv, r5Prov, rowsOf, underMonthPath, ym,
  type UnderFile, type UnderMonth, type UnderRow } from '../lib/under';
import '../styles/under.css';

/* Wave 11 · /funds/under "ברבעון התחתון, ועדיין מקבלים כסף" (the address keeps its old word, under) (Pro, journalist): the bottom-quartile tracks (5Y net, in their category) that
   still took in money over 12 months, the intra-group migration taken out, and the shekel cost of their gap to the category median, month
   by month since 2016 (pipeline/build_under.py). Every figure opens its calculation; the methodology is stated on the page and in the file. */

type View = 'head' | 'bq' | 'all';
/** the source line of a chart or a spreadsheet: plain text (the page's own line links the datasets, components/RegSrc) */
const SRC_TXT = 'רשות שוק ההון, ביטוח וחיסכון: גמל-נט, פנסיה-נט, ביטוח-נט (data.gov.il) · עיבוד fox';
const VIEWS: [View, string][] = [['head', 'הרשימה'], ['bq', 'כל הרבעון התחתון'], ['all', 'כל המסלולים המדורגים']];

export function Under() {
  const U = useOptional<UnderFile>(UNDER_PATH);
  const [sp, setSp] = useSearchParams();
  const view: View = (VIEWS.some(([v]) => v === sp.get('v')) ? sp.get('v') : 'head') as View;
  const F = useFunds().data, C = useClosed();
  const names = useMemo(() => { const m = new Map<string, string>(); F?.funds.forEach((f) => m.set(f.k, f.name)); C?.forEach((f) => m.set(f.k, f.name)); return m; }, [F, C]);
  const rows = useMemo(() => (U ? rowsOf(U) : []), [U]);
  const { open } = useSource();
  const M = useLoad<UnderMonth>(U ? underMonthPath(U.asof) : null).data;

  if (U === undefined) return <Loading what="פער מהחציון" />;
  if (U === null) return <Empty title="קובץ הפער מהחציון לא פורסם עדיין" icon="funds" />;
  const S = U.series, j = U.months.length - 1;
  const shown = (view === 'head' ? rows.filter((r) => r.head) : view === 'bq' ? rows.filter((r) => r.pct <= U.bq && r.gap > 0) : rows).slice().sort((a, b) => b.cost - a.cost);
  const line = headline(U, rows);
  const name = (k: string) => names.get(k) ?? rows.find((r) => r.k === k)?.name ?? k;
  const pointAt = (q: number, what: 'cost' | 'icost' | 'a' | 'fl') => () => load<UnderMonth>(underMonthPath(q)).then((M) => open(pointProv(U, M, name, what)));
  const kpi = (what: 'cost' | 'icost' | 'a' | 'fl', text: string) => (M && M.p === U.asof ? <Sourced src={() => pointProv(U, M, name, what)}><span className="num">{text}</span></Sourced> : <span className="num">{text}</span>);
  const num = (v: number | null, src: () => Prov, d = 1, tone = false) => (v == null ? <span className="muted">–</span>
    : <Sourced src={src}><span className={`num${tone ? (v > 0 ? ' pos' : v < 0 ? ' neg' : '') : ''}`}>{nf(v, d)}</span></Sourced>);
  const columns: Column<UnderRow>[] = [
    { key: 'name', head: 'מסלול', value: (r) => r.name, tdClass: () => 'lbl', cell: (r) => <><Link to={`/funds/${r.k}`}>{r.name}</Link>{r.mig ? <span className="chip est mig" title={U.method.mig}>נדידה</span> : null}</> },
    { key: 'grp', head: 'קבוצה', value: (r) => r.grp, className: 'wide-only' },
    { key: 'cat', head: 'קטגוריה', value: (r) => r.cat, className: 'wide-only' },
    { key: 'a', head: 'נכסים', title: 'מיליוני ש"ח, סוף החודש', value: (r) => r.a, cell: (r) => num(r.a, () => aumProv(U, r), 0), total: 'sum' },
    { key: 'r5', head: '5Y נטו', title: U.method.net, value: (r) => r.r5, cell: (r) => num(r.r5, () => r5Prov(U, r), 2) },
    { key: 'med', head: 'חציון', title: U.method.med, value: (r) => r.med, cell: (r) => num(r.med, () => medProv(U, r.cat, rows), 2) },
    { key: 'pct', head: 'אחוזון', title: U.method.pct, value: (r) => r.pct, firstDir: 'asc', cell: (r) => num(r.pct, () => pctProv(U, r), 0) },
    { key: 'gap', head: 'פער, נ"א', title: U.method.gap, value: (r) => r.gap, cell: (r) => num(r.gap, () => gapProv(U, r, rows), 2) },
    { key: 'cost', head: 'עלות הפער בשנה', title: U.method.cost, lead: true, value: (r) => r.cost, cell: (r) => num(r.cost, () => costProv(U, r, rows), 1), total: 'sum' },
    { key: 'nd12', head: 'צבירה נטו 12M, פורסם', title: 'Σ NET_MONTHLY_DEPOSITS, 12 חודשים', className: 'wide-only', value: (r) => r.nd12, cell: (r) => num(r.nd12, () => flowProv(U, r), 0, true), total: 'sum' },
    { key: 'c12', head: 'בלי נדידה פנימית', title: U.method.flow, value: (r) => r.c12, cell: (r) => num(r.c12, () => flowProv(U, r), 0, true), total: 'sum' },
    { key: 'gfl12', head: 'הקבוצה במוצר', title: U.method.mig, className: 'wide-only', value: (r) => r.gfl12, cell: (r) => (r.mig ? num(r.gfl12, () => gflProv(U, r), 0, true) : <span className="muted">–</span>) },
    { key: 'icost', head: 'עלות על הכסף החדש', title: U.method.icost, value: (r) => r.icost, cell: (r) => num(r.icost, () => icostProv(U, r, rows), 1), total: 'sum' },
  ];
  const pal = palette();
  const pids = Object.keys(U.byp);
  const fullAt = U.full_from ? U.months.indexOf(U.full_from) : -1;
  const covText = U.flow_prods.map((pid) => `${U.prods[pid]} מ-${U.cov_from[pid] ? ym(U.cov_from[pid]!) : '–'}`).join(' · ');
  const viewOpts: [View, string][] = VIEWS.map(([v, l]) => [v, `${l} (${v === 'head' ? rows.filter((r) => r.head).length : v === 'bq' ? rows.filter((r) => r.pct <= U.bq && r.gap > 0).length : rows.length})`]);
  const ci = S.cost.indexOf(Math.max(...S.cost)), cl = S.cost.indexOf(Math.min(...S.cost));

  return (
    <div className="under">
      <FundsHead title="ברבעון התחתון, ועדיין מקבלים כסף" sub={<>מסלולים ברבע התחתון של הקטגוריה (אחוזון <span className="num">{U.bq}</span> ומטה, 5 שנים, נטו, אומדן) שקיבלו כסף ב-12 החודשים; הפער נמדד מחציון הקטגוריה · נתוני <span className="num">{ym(U.asof)}</span> · מיליוני ש"ח · <Link to="/flows">תזרימים לפי קבוצה</Link></>}
        tools={<Pick label="מה מוצג" cap="טבלה" value={view} onChange={(v) => setSp((cur) => { const n = new URLSearchParams(cur); if (v === 'head') n.delete('v'); else n.set('v', v); return n; }, { replace: true })} options={viewOpts} />} />
      <Panel className="under-top" aside={<span>{ym(U.asof)}</span>}>
        <div className="flowdef under-def" data-testid="under-def">
          <span>עלות הפער: נכסים × (חציון הקטגוריה − תשואת המסלול, 5 שנים נטו) בשנה; פער של פחות מ-{nf(U.band_bp / 100, 2)} נ"א = 0</span>
          <span>צבירה נטו 12M בלי נדידה פנימית: הפקדות − משיכות + ניוד חיצוני משוער</span>
          <Link to="/methodology#flows">הגדרות התזרימים</Link>
          <a href="#under-method">שיטה ומגבלות</a>
        </div>
        {line && <p className="under-line" data-testid="under-headline"><NumText t={line} /></p>}
        <section className="kpis">
          <Kpi label="מסלולים ברשימה" value={kpi('cost', String(S.n[j]))} sub={<>מתוך {S.n_rk[j]} מדורגים ב-{S.n_cat[j]} קטגוריות</>} />
          <Kpi label="נכסים" value={kpi('a', ilsM(S.a[j]))} sub="סוף החודש" />
          <Kpi label="עלות הפער בשנה" value={kpi('cost', ilsM(S.cost[j]))} sub="נכסים × פער, אומדן" />
          <Kpi label="נכנס ב-12 החודשים" value={kpi('fl', ilsM(S.fl[j]))} sub="בלי נדידה פנימית" />
          <Kpi label="עלות על הכסף החדש" value={kpi('icost', ilsM(S.icost[j]))} sub="בשנה, אומדן" />
        </section>
        <p className="under-past">{U.method.past}.</p>
      </Panel>

      <Panel title="הסדרה החודשית: עלות הפער של מסלולי הרשימה" aside={<span>{ym(U.months[0])}–{ym(U.asof)}</span>}>
        <Chart label="עלות הפער בשנה, מסלולי הרשימה" height={300} deps={[U.asof, U.months.length]} exportName="fox-under-series" asof={ym(U.asof)}
          source={SRC_TXT}
          onPoint={(_si, di) => { const q = U.months[di]; if (q) void pointAt(q, 'cost')(); }}
          build={() => foxOption({ x: U.months.map(ym), unit: 'מיליוני ש"ח לשנה', dense: true, full: true, total: true, legend: true,
            breakAt: fullAt > 0 ? fullAt : undefined, breakLabel: 'מכאן: כל המוצרים',
            series: pids.map((pid, i) => ({ name: U.prods[pid], kind: 'bar' as const, stack: true, color: pid === 'pm' ? cssColor('--accent') : pal[(i + 1) % pal.length], dec: 1, data: U.byp[pid] })) })} />
        <p className="fnote">
          סכום עלות הפער של מסלולי הרשימה בכל חודש; לחיצה על עמודה פותחת את המסלולים שלה. הגבוה: <span className="num">{ilsM(S.cost[ci])}</span> ב-<span className="num">{ym(U.months[ci])}</span>; הנמוך: <span className="num">{ilsM(S.cost[cl])}</span> ב-<span className="num">{ym(U.months[cl])}</span>.
          {' '}מסלול גדול שחוצה את קו הרבעון או את פס השוויון מזיז את הסכום בחודש אחד. כניסת מוצרים לסדרה: {covText}.
        </p>
      </Panel>

      <Panel title={view === 'head' ? `הרשימה · ${ym(U.asof)}` : view === 'bq' ? `כל הרבעון התחתון, עם פער · ${ym(U.asof)}` : `כל המסלולים המדורגים · ${ym(U.asof)}`}>
        <DataTable caption={`ברבעון התחתון · ${ym(U.asof)}`} rows={shown} rowKey={(r) => r.k} columns={columns} totalLabel="סה״כ" sort={{ key: 'cost', dir: 'desc' }}
          rowClass={(r) => (view !== 'head' && r.head ? 'lead' : undefined)}
          export={{ name: `fox-under-${view}-${U.asof}`, title: `ברבעון התחתון, ועדיין מקבלים כסף · ${ym(U.asof)}`, note: `${SRC_TXT} · נתוני ${ym(U.asof)} · מיליוני ש"ח · ${U.method.head} · ${U.method.past}` }}
          empty={<p className="muted">אין מסלולים בתצוגה הזאת בחודש הזה.</p>} />
        {view !== 'head' && <div className="fnote">מסלולי הרשימה מודגשים. מסלול ברבעון התחתון שאינו ברשימה: הצבירה נטו שלו 12M אינה חיובית (כפי שפורסמה או בלי נדידה פנימית), אין לו תזרים מפורסם (ביטוח-נט), או שסומן נדידה והקבוצה במוצר אינה בצבירה חיובית.</div>}
      </Panel>

      <Panel title="שיטה ומגבלות" className="under-method">
        <ul id="under-method" className="under-list">
          <li><b>מה נמדד.</b> {U.method.what}.</li>
          <li><b>תשואות עבר.</b> {U.method.past}.</li>
          <li><b>למה 5 שנים.</b> {U.method.why5}.</li>
          <li><b>נטו.</b> {U.method.net}.</li>
          <li><b>קטגוריה.</b> {U.method.cat}.</li>
          <li><b>אחוזון וחציון.</b> {U.method.pct}. {U.method.med}.</li>
          <li><b>פער.</b> {U.method.gap}.</li>
          <li><b>עלות.</b> {U.method.cost}. {U.method.icost}.</li>
          <li><b>תזרים.</b> {U.method.flow}.</li>
          <li><b>נדידה פנימית.</b> {U.method.mig}.</li>
          <li><b>הרשימה.</b> {U.method.head}.</li>
          <li><b>הסדרה.</b> {U.method.series}.</li>
          <li><b>מה לא נמדד.</b> {U.method.not}.</li>
        </ul>
        <div className="fnote" data-testid="under-src"><RegSrc table={['/funds/under?v=all', 'כל המסלולים המדורגים']} />.</div>
      </Panel>
    </div>
  );
}
