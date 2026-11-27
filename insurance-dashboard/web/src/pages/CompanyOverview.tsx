import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/ui';
import { LensTabs } from '../components/LensTabs';
import { useKpiData, useLoad } from '../lib/useData';
import { usePeriodParam, useWindowParam, type Win } from '../lib/period';
import { usePhone } from '../lib/useMedia';
import { useSheetHost } from '../lib/sheetHost';
import { useChanges } from '../lib/changes';
import { reportStatus, type Kind } from '../lib/peerBoard';
import { useBook, usePeerRegistry } from '../lib/registry';
import { useCtx } from './Company';
import { reportsOf } from './ReportDay';
import { coCtx, coNeedIds, type CoKey } from './company/rows';
import { parseCp, QuarterLens, type CoData } from './company/QuarterLens';
import { RowSheet } from './company/RowSheet';
import '../styles/company-p6.css';
// the lenses past the first load when they open (spec 9.7: lazy chunks); P6-2e's depth lenses by the agreed names (default exports)
const ChangesLens = lazy(() => import('./company/ChangesLens'));
const QuartersLens = lazy(() => import('./company/QuartersLens'));
const AnalysisLens = lazy(() => import('./company/AnalysisLens'));
const CapitalLens = lazy(() => import('./company/CapitalLens'));
const TargetsLens = lazy(() => import('./company/TargetsLens'));

type Lens = 'q' | 'chg' | 'qs' | 'an' | 'cap' | 'tg';
const LENSES: Lens[] = ['q', 'chg', 'qs', 'an', 'cap', 'tg'];
/** the lens in the address (`cl`); the old anchors land on theirs: #review and ?row= → רבעונים, #analysis → ניתוח (5.2) */
function lensOf(cl: string | null, hash: string, row: string | null): Lens {
  if (cl && LENSES.includes(cl as Lens)) return cl as Lens;
  if (hash === '#analysis') return 'an';
  if (hash === '#review' || row) return 'qs';
  return 'q';
}
interface CalNext { companies: { id: string; next?: { period: string; expected?: string } }[] }

/** The company overview ("מספרים", spec 5): one question (what happened in the quarter, against a year and a quarter earlier), one
 *  sentence, seven rows; everything else of today's page one tap away in six lenses (D7): הרבעון · שינויים · רבעונים · ניתוח · הון וחוב ·
 *  יעדים. The figures are the board's (lib/peerBoard on the peer files), so a number opens the same source on both pages. */
export function CompanyOverview() {
  const { entry, store, market, storeError } = useCtx();
  const phone = usePhone();
  const [sp] = useSearchParams();
  const loc = useLocation();
  const nav = useNavigate();
  const sheet = useSheetHost();
  const kind: Kind = entry.kind === 'fund_house' ? 'fund' : 'ins';

  // the peer files of the company's set, read by the same engine as the board
  const reg = usePeerRegistry().data ?? null;
  const { book: b0 } = useBook(reg, []);
  const ids = useMemo(() => coNeedIds(b0, kind), [b0, kind]);
  const { book, pending } = useBook(reg, ids);
  const set = reg?.sets.find((s) => s.id === (kind === 'fund' ? 'fund' : 'ins'));
  const ents = useMemo(() => set?.ids ?? [], [set]);
  const status = useMemo(() => (book && !pending && ents.length ? reportStatus(book, ents) : null), [book, pending, ents]);
  const own = useMemo(() => (status ? (ents.includes(entry.id) ? status.last[entry.id] : book ? reportStatus(book, [entry.id]).last[entry.id] : null) : null), [status, ents, entry.id, book]);

  // the report on screen: the address's (?p=) when the company has it, else the latest; an annual report reads as its fourth quarter
  const reports = useMemo(() => (store ? reportsOf(store) : []), [store]);
  const [p] = usePeriodParam();
  const [w] = useWindowParam();
  const P = reports.includes(p) ? p : reports[0] ?? '';
  const asked = reports.includes(p) ? (p.endsWith('FY') ? `${p.slice(0, 4)}Q4` : p) : null;
  const q = asked ?? own ?? (P ? (P.endsWith('FY') ? `${P.slice(0, 4)}Q4` : P) : status?.bq ?? '');
  const win: Win = (w || 'q') as Win;
  const chs = useChanges(entry.id).data ?? null;
  const chr = chs?.reports.find((r) => r.p === P) ?? null;
  const waiting = !!status && !asked && ents.includes(entry.id) && !!own && own < status.bq;
  const cal = useLoad<CalNext>(waiting ? 'calendar.json' : null).data;
  const next = cal?.companies.find((c) => c.id === entry.id)?.next;
  const expected = waiting && next?.expected && next.period === status?.bq ? { date: next.expected, est: true } : null;
  const filer = useKpiData(true).data?.companies[entry.id]?.filer ?? null;

  const lens = lensOf(sp.get('cl'), loc.hash, sp.get('row'));
  const cp = parseCp(sp.get('cp'));
  const put = useCallback((patch: Record<string, string | null>) => {
    const n = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([k, v]) => (v == null ? n.delete(k) : n.set(k, v)));
    const s = n.toString();
    nav({ search: s ? `?${s}` : '', hash: window.location.hash }, { replace: true, state: window.history.state?.usr });
  }, [nav]);
  // a lens tap writes `cl` (never a page in the history) and drops an old anchor (#review, #analysis) and an open ledger row
  const setLens = useCallback((cl: string) => {
    const n = new URLSearchParams(window.location.search);
    if (cl === 'q') n.delete('cl'); else n.set('cl', cl);
    if (cl !== 'qs') n.delete('row');
    const s = n.toString();
    nav({ search: s ? `?${s}` : '', hash: '' }, { replace: true });
  }, [nav]);
  // an old #analysis link lands on the bridge once the lens has laid out
  useEffect(() => {
    if (loc.hash !== '#analysis') return;
    const t = setTimeout(() => document.getElementById('analysis')?.scrollIntoView({ block: 'start' }), 900);
    return () => clearTimeout(t);
  }, [loc.hash, entry.id]);

  if (storeError) return <ErrorBox what="נתוני החברה" error={storeError} />;
  const co: CoData | null = book && status && q && reg ? { entry, kind, phone, ents, setName: set?.n ?? '', book, status,
    ctx: coCtx(book, ents, status, (e) => (reg.entities.find((x) => x.id === e)?.k === 'fund' ? 'fund' : 'ins')),
    q, P, win, store, market, ch: chs, chr, waiting, expected, filer, setLens, put, openSheet: sheet.openSheet } : null;
  const tabs: [string, string][] = [['q', 'הרבעון'], ['chg', chr ? `שינויים ${chr.n}` : 'שינויים'], ['qs', 'רבעונים'], ['an', 'ניתוח'], ['cap', phone ? 'הון' : 'הון וחוב'], ['tg', 'יעדים']];
  const wait = <Loading what="נתוני הרבעון" />;
  const rowKey = sheet.own?.[0] === 'row' ? (sheet.own[1] as CoKey) : null;
  const lensProps = { entry, report: P, phone };
  return (
    <div className="co6" data-lens={lens}>
      <LensTabs tabs={tabs} value={lens} onChange={setLens} label="עדשה" />
      <Suspense fallback={wait}>
        {lens === 'q' && (co ? <QuarterLens co={co} cp={cp} /> : wait)}
        {lens === 'chg' && (co ? <ChangesLens co={co} /> : wait)}
        {lens === 'qs' && (co ? <QuartersLens co={co} cp={cp} /> : wait)}
        {lens === 'an' && <AnalysisLens {...lensProps} />}
        {lens === 'cap' && <CapitalLens {...lensProps} />}
        {lens === 'tg' && <TargetsLens {...lensProps} />}
      </Suspense>
      {co && rowKey && <RowSheet co={co} k={rowKey} onClose={sheet.closeSheet} />}
    </div>
  );
}
