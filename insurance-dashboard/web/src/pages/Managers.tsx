import { lazy, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { MgrChip } from '../components/MgrChip';
import { ErrorBox, Loading, Panel, Pick, Seg } from '../components/ui';
import { Sourced } from '../components/Source';
import { fundCell, fundRef, listP, warmHist } from '../lib/market';
import type { Prov } from '../lib/prov';
import '../styles/prov-market.css';
import { cls, fmt, nf, pct, sn } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { useMarketData } from '../lib/useData';
import type { Family, Fund } from '../lib/types';

type Fam = 'all' | Family;
const wavg = (fs: Fund[], k: keyof Fund) => { let n = 0, d = 0; fs.forEach((f) => { const v = f[k] as number | null, a = f.assets ?? 0; if (v != null && a > 0) { n += v * a; d += a; } }); return d ? n / d : null; };
const sum = (fs: Fund[], k: keyof Fund) => fs.reduce((s, f) => s + ((f[k] as number | null) ?? 0), 0);

const LensRank = lazy(async () => ({ default: (await import('./SavingsLens')).LensRank }));
const Makers = lazy(async () => ({ default: (await import('./Funds')).MakersBody }));
type View = '' | 'rank' | 'makers';
const VIEWS: [View, string][] = [['', 'לפי חברה מנהלת'], ['rank', 'דירוג לאורך זמן'], ['makers', 'יצרן מול השוק']];

/** The managers' ranking, one home for it: the managing companies today (regulator snapshot), their rank over time (savings lens),
 *  and each manager's biggest track against its category (fund ranks). /funds/makers and the lens's old ?v=rank land here. */
export function Managers() {
  const [sp, setSp] = useSearchParams();
  const view = (VIEWS.map(([v]) => v).find((v) => v && v === sp.get('v')) ?? '') as View;
  const pick = (v: View) => setSp(() => { const n = new URLSearchParams(); if (v) n.set('v', v); return n; }, { replace: true });
  const views = <Seg<View> label="דירוג מנהלים" value={view} onChange={pick} options={VIEWS} />;
  if (view === '') return <ManagersTable views={views} />;
  return (
    <>
      <FundsHead sub={view === 'rank' ? 'דירוג מנהלים · לאורך זמן · רשות שוק ההון ודוחות החברות המנהלות' : 'דירוג מנהלים · המסלול הגדול של כל יצרן מול הקטגוריה שלו'} tools={views} />
      <Suspense fallback={<Loading what="הדירוג" />}>{view === 'rank' ? <LensRank /> : <Makers />}</Suspense>
    </>
  );
}

function ManagersTable({ views }: { views: React.ReactNode }) {
  const { data, error } = useMarketData();
  const [fam, setFam] = useState<Fam>('all');
  const [grp, setGrp] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    const fs = (data?.funds ?? []).filter((f) => (fam === 'all' || f.fam === fam) && (grp === 'all' || f.grp === grp));
    const by = new Map<string, Fund[]>();
    fs.forEach((f) => by.set(f.mgr, [...(by.get(f.mgr) ?? []), f]));
    return [...by.entries()].map(([mgr, list]) => ({ mgr, grp: list[0].grp, list, assets: sum(list, 'assets') / 1000, fee: wavg(list, 'fee'), dep: wavg(list, 'depfee'), y12: wavg(list, 'y12'), a5: wavg(list, 'a5'), net: list.some((f) => f.net12 != null) ? sum(list, 'net12') / 1000 : null, tr: list.some((f) => f.tr12 != null) ? sum(list, 'tr12') / 1000 : null }))
      .sort((a, b) => b.assets - a.assets);
  }, [data, fam, grp]);
  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="מנהלים וקופות" />;
  const groups = [...new Set(data.funds.map((f) => f.grp))].sort((a, b) => a.localeCompare(b, 'he'));
  const max = Math.max(...rows.map((r) => r.assets), 1e-9), total = rows.reduce((s, r) => s + r.assets, 0);
  const A = data.meta.asof;
  type Row = (typeof rows)[number];
  const byAssets = (l: Fund[]) => [...l].sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0));
  /** a manager's figure: the list of its tracks, each with the source of its own value */
  const agg = (r: Row, k: keyof Fund, label: string, formula: string, value: string, unit: string | undefined, fmt: (f: Fund) => string, weighted = false): Prov =>
    listP(`${label} · ${r.mgr}`, value, unit, formula,
      byAssets(r.list).filter((f) => f[k] != null).map((f) => ({ label: weighted ? `${f.name} · נכסים ${f.assets == null ? '–' : nf(f.assets, 0)}` : f.name, v: fmt(f), src: () => fundCell(A, f, k)! })));
  const S = Sourced;
  const stop = (e: React.MouseEvent, fn: () => void) => { if (!(e.target as HTMLElement).closest('.src')) fn(); };
  const asof = `${String(data.meta.asof).slice(4)}/${String(data.meta.asof).slice(2, 4)}`;
  return (
    <>
      <FundsHead sub={<>דירוג מנהלים · <S src={() => listP('חברות מנהלות', nf(rows.length, 0), undefined, 'ספירת החברות המנהלות שיש להן מסלולים בבחירה', rows.map((r) => ({ label: r.mgr, v: nf(r.assets, 1), src: () => agg(r, 'assets', 'נכסים', 'סכום TOTAL_ASSETS של המסלולים, חלקי 1,000', nf(r.assets, 1), 'מיליארד ש"ח', (f) => nf(f.assets!, 1)) })))}><span className="num">{rows.length}</span></S> חברות מנהלות · <S src={() => listP('סך נכסים, החברות המנהלות', nf(total, 0), 'מיליארד ש"ח', 'סכום הנכסים של כל החברות המנהלות בבחירה', rows.map((r) => ({ label: r.mgr, v: nf(r.assets, 1), src: () => agg(r, 'assets', 'נכסים', 'סכום TOTAL_ASSETS של המסלולים, חלקי 1,000', nf(r.assets, 1), 'מיליארד ש"ח', (f) => nf(f.assets!, 1)) })))}><span className="num">{nf(total, 0)}</span></S> מיליארד ש"ח · <span className="num">{asof}</span></>} tools={<>
        {views}<span className="sep" />
        <Seg<Fam> label="מוצר" value={fam} onChange={setFam} options={[['all', 'הכול'], ['pension', 'פנסיה'], ['gemel', 'גמל והשתלמות'], ['insurance', 'ביטוח: מנהלים וחיסכון']]} />
        <Pick label="קבוצה" cap="קבוצה" value={grp} onChange={setGrp} options={[['all', 'כל הקבוצות'], ...groups.map((g) => [g, g] as [string, string])]} />
      </>} />
      <Panel aside={<span>דמי ניהול ותשואות משוקללים בנכסים · צבירה וניוד: LTM, מיליארדי ש"ח</span>}>
        <DataTable caption="חברות מנהלות" rows={rows} rowKey={(r) => r.mgr} export={{ name: `fox-managers-${data.meta.asof}`, title: 'חברות מנהלות', note: `רשות שוק ההון · ${asof} · נכסים, צבירה וניוד: מיליארדי ש"ח` }}
          rowClass={(r) => (open === r.mgr ? 'lead' : undefined)}
          rowProps={(r) => ({ style: { cursor: 'pointer' }, onPointerEnter: () => r.list.slice(0, 40).forEach((f) => warmHist(fundRef(f))), onClick: (e) => stop(e, () => setOpen(open === r.mgr ? null : r.mgr)) })}
          after={(r) => open === r.mgr && byAssets(r.list).map((f) => (
            <tr key={f.id} className="sec">
              <td style={{ paddingInlineStart: 26, fontWeight: 400, color: 'var(--fg)' }}>{f.name}</td>
              <td>{f.assets == null ? '–' : <S src={() => fundCell(A, f, 'assets')!}><span className="num">{fmt(f.assets / 1000, 'n', { d: 2 })}</span></S>}</td><td />
              <td>{f.stock == null ? '' : <S src={() => fundCell(A, f, 'stock')!}><span className="num muted">{`מניות ${fmt(f.stock, 'int')}%`}</span></S>}</td>
              <td>{f.fee == null ? '–' : <S src={() => fundCell(A, f, 'fee')!}><span className="num">{fmt(f.fee, 'pct', { d: 2 })}</span></S>}</td><td>{f.depfee == null ? '–' : <S src={() => fundCell(A, f, 'depfee')!}><span className="num">{fmt(f.depfee, 'pct', { d: 2 })}</span></S>}</td>
              <td onPointerEnter={() => warmHist(fundRef(f))}>{f.y12 == null ? '–' : <S src={() => fundCell(A, f, 'y12')!}><span className="num">{fmt(f.y12, 'pct', { signed: true })}</span></S>}</td><td>{f.a5 == null ? '–' : <S src={() => fundCell(A, f, 'a5')!}><span className="num">{fmt(f.a5, 'pct')}</span></S>}</td>
              <td onPointerEnter={() => warmHist(fundRef(f))}>{f.net12 == null ? '–' : <S src={() => fundCell(A, f, 'net12')!}><span className={`num ${cls(f.net12)}`}>{fmt(f.net12 / 1000, 'n', { d: 2 })}</span></S>}</td><td onPointerEnter={() => warmHist(fundRef(f))}>{f.tr12 == null ? '–' : <S src={() => fundCell(A, f, 'tr12')!}><span className={`num ${cls(f.tr12)}`}>{fmt(f.tr12 / 1000, 'n', { d: 2 })}</span></S>}</td>
            </tr>
          ))}
          columns={[
            { key: 'mgr', head: 'חברה מנהלת', value: (r) => r.mgr, tdClass: () => 'lbl', cell: (r) => <>{r.mgr}<span className="fund-mgr"><MgrChip grp={r.grp} /></span></> },
            { key: 'assets', head: 'נכסים, מיליארד', value: (r) => r.assets, d: 1, src: (r) => agg(r, 'assets', 'נכסים', 'סכום TOTAL_ASSETS של מסלולי החברה, חלקי 1,000 (מיליוני ש"ח למיליארדי ש"ח)', nf(r.assets, 1), 'מיליארד ש"ח', (f) => nf(f.assets!, 1)) },
            { key: 'bar', head: '', width: 120, noExport: true, cell: (r) => <div className="bar"><i style={{ width: `${(r.assets / max) * 100}%` }} /></div> },
            { key: 'n', head: 'מסלולים', value: (r) => r.list.length, unit: 'int', src: (r) => agg(r, 'assets', 'מסלולים', 'ספירת מסלולי החברה בחודש האחרון', nf(r.list.length, 0), undefined, (f) => nf(f.assets!, 1)) },
            { key: 'fee', head: 'דמי ניהול מצבירה', value: (r) => r.fee, unit: 'pct', d: 2, src: (r) => agg(r, 'fee', 'דמי ניהול מצבירה', 'AVG_ANNUAL_MANAGEMENT_FEE משוקלל ב-TOTAL_ASSETS, רק מסלולים עם דמי ניהול', pct(r.fee, 2), undefined, (f) => pct(f.fee, 2), true) },
            { key: 'dep', head: 'מהפקדה', value: (r) => r.dep, unit: 'pct', d: 2, src: (r) => agg(r, 'depfee', 'דמי ניהול מהפקדה', 'AVG_DEPOSIT_FEE משוקלל ב-TOTAL_ASSETS, רק מסלולים עם נתון', pct(r.dep, 2), undefined, (f) => pct(f.depfee, 2), true) },
            { key: 'y12', head: 'תשואה, LTM', value: (r) => r.y12, unit: 'pct', signed: true, src: (r) => agg(r, 'y12', 'תשואה LTM', 'תשואת LTM של כל מסלול, משוקללת ב-TOTAL_ASSETS', pct(r.y12, 1), undefined, (f) => pct(f.y12, 1), true) },
            { key: 'a5', head: '5 שנים, שנתי', value: (r) => r.a5, unit: 'pct', src: (r) => agg(r, 'a5', 'תשואה שנתית ממוצעת, 5 שנים', 'AVG_ANNUAL_YIELD_TRAILING_5YRS משוקלל ב-TOTAL_ASSETS, רק מסלולים עם נתון', pct(r.a5, 1), undefined, (f) => pct(f.a5, 1), true) },
            { key: 'net', head: 'צבירה נטו', value: (r) => r.net, d: 2, tone: true, src: (r) => agg(r, 'net12', 'צבירה נטו, LTM', 'סכום צבירה אורגנית LTM של המסלולים (מיליוני ש"ח), חלקי 1,000. ביטוח-נט אינו מפרסם תזרימים', nf(r.net!, 2), 'מיליארד ש"ח', (f) => sn(f.net12!, 1)) },
            { key: 'tr', head: 'ניוד נטו', value: (r) => r.tr, d: 2, tone: true, src: (r) => agg(r, 'tr12', 'ניוד נטו, LTM', 'סכום העברות נטו LTM של המסלולים (מיליוני ש"ח), חלקי 1,000. ביטוח-נט אינו מפרסם תזרימים', nf(r.tr!, 2), 'מיליארד ש"ח', (f) => sn(f.tr12!, 1)) },
          ]} />
        <div className="fnote">מקור: רשות שוק ההון, גמל-נט, פנסיה-נט וביטוח-נט. למסלולי הביטוח (ביטוחי מנהלים ופוליסות חיסכון) אין נתוני צבירה.</div>
      </Panel>
    </>
  );
}
