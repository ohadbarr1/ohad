import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FundsHead } from '../components/FundsNav';
import { ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { Sourced } from '../components/Source';
import { fundCell, fundRef, listP, warmHist } from '../lib/market';
import type { Prov } from '../lib/prov';
import '../styles/prov-market.css';
import { cls, nf, pct, sn } from '../lib/format';
import { useMarketData, useRegistry } from '../lib/useData';
import type { Family, Fund } from '../lib/types';

type Fam = 'all' | Family;
const wavg = (fs: Fund[], k: keyof Fund) => { let n = 0, d = 0; fs.forEach((f) => { const v = f[k] as number | null, a = f.assets ?? 0; if (v != null && a > 0) { n += v * a; d += a; } }); return d ? n / d : null; };
const sum = (fs: Fund[], k: keyof Fund) => fs.reduce((s, f) => s + ((f[k] as number | null) ?? 0), 0);

/** Managing companies and their funds, from the regulator's latest monthly snapshot. */
export function Managers() {
  const { data, error } = useMarketData();
  const reg = useRegistry();
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
  const co = (g: string) => reg.data?.find((c) => c.market_group === g)?.id;
  const asof = `${String(data.meta.asof).slice(4)}/${String(data.meta.asof).slice(2, 4)}`;
  return (
    <>
      <FundsHead sub={<>מנהלים · <S src={() => listP('חברות מנהלות', nf(rows.length, 0), undefined, 'ספירת החברות המנהלות שיש להן מסלולים בבחירה', rows.map((r) => ({ label: r.mgr, v: nf(r.assets, 1), src: () => agg(r, 'assets', 'נכסים', 'סכום TOTAL_ASSETS של המסלולים, חלקי 1,000', nf(r.assets, 1), 'מיליארד ש"ח', (f) => nf(f.assets!, 1)) })))}><span className="num">{rows.length}</span></S> חברות מנהלות · <S src={() => listP('סך נכסים, החברות המנהלות', nf(total, 0), 'מיליארד ש"ח', 'סכום הנכסים של כל החברות המנהלות בבחירה', rows.map((r) => ({ label: r.mgr, v: nf(r.assets, 1), src: () => agg(r, 'assets', 'נכסים', 'סכום TOTAL_ASSETS של המסלולים, חלקי 1,000', nf(r.assets, 1), 'מיליארד ש"ח', (f) => nf(f.assets!, 1)) })))}><span className="num">{nf(total, 0)}</span></S> מיליארד ש"ח · <span className="num">{asof}</span></>} />
      <section className="controls">
        <div className="field"><span>מוצר</span><Seg<Fam> label="מוצר" value={fam} onChange={setFam} options={[['all', 'הכול'], ['pension', 'פנסיה'], ['gemel', 'גמל והשתלמות'], ['insurance', 'ביטוח: מנהלים וחיסכון']]} /></div>
        <Field label="קבוצה"><select value={grp} onChange={(e) => setGrp(e.target.value)}><option value="all">כל הקבוצות</option>{groups.map((g) => <option key={g}>{g}</option>)}</select></Field>
      </section>
      <Panel aside={<span>דמי ניהול ותשואות משוקללים בנכסים · צבירה וניוד: LTM, מיליארדי ש"ח</span>}>
        <div className="scroll"><table>
          <thead><tr><th>חברה מנהלת</th><th>נכסים, מיליארד</th><th /><th>מסלולים</th><th>דמי ניהול מצבירה</th><th>מהפקדה</th><th>תשואה, LTM</th><th>5Y, שנתי</th><th>צבירה נטו</th><th>ניוד נטו</th></tr></thead>
          <tbody>{rows.map((r) => (
            <Fragment key={r.mgr}>
              <tr style={{ cursor: 'pointer' }} className={open === r.mgr ? 'lead' : ''} onPointerEnter={() => r.list.slice(0, 40).forEach((f) => warmHist(fundRef(f)))} onClick={(e) => stop(e, () => setOpen(open === r.mgr ? null : r.mgr))}>
                <td>{r.mgr}<span className="dim">{co(r.grp) ? <Link to={`/company/${co(r.grp)}`} onClick={(e) => e.stopPropagation()}>{r.grp}</Link> : r.grp}</span></td>
                <td><S src={() => agg(r, 'assets', 'נכסים', 'סכום TOTAL_ASSETS של מסלולי החברה, חלקי 1,000 (מיליוני ש"ח למיליארדי ש"ח)', nf(r.assets, 1), 'מיליארד ש"ח', (f) => nf(f.assets!, 1))}><span className="num">{nf(r.assets, 1)}</span></S></td>
                <td style={{ width: 120 }}><div className="bar"><i style={{ width: `${(r.assets / max) * 100}%` }} /></div></td>
                <td><S src={() => agg(r, 'assets', 'מסלולים', 'ספירת מסלולי החברה בחודש האחרון', nf(r.list.length, 0), undefined, (f) => nf(f.assets!, 1))}><span className="num">{r.list.length}</span></S></td>
                <td>{r.fee == null ? '–' : <S src={() => agg(r, 'fee', 'דמי ניהול מצבירה', 'AVG_ANNUAL_MANAGEMENT_FEE משוקלל ב-TOTAL_ASSETS, רק מסלולים עם דמי ניהול', pct(r.fee, 2), undefined, (f) => pct(f.fee, 2), true)}><span className="num">{pct(r.fee, 2)}</span></S>}</td>
                <td>{r.dep == null ? '–' : <S src={() => agg(r, 'depfee', 'דמי ניהול מהפקדה', 'AVG_DEPOSIT_FEE משוקלל ב-TOTAL_ASSETS, רק מסלולים עם נתון', pct(r.dep, 2), undefined, (f) => pct(f.depfee, 2), true)}><span className="num">{pct(r.dep, 2)}</span></S>}</td>
                <td>{r.y12 == null ? '–' : <S src={() => agg(r, 'y12', 'תשואה LTM', 'תשואת LTM של כל מסלול, משוקללת ב-TOTAL_ASSETS', pct(r.y12, 1), undefined, (f) => pct(f.y12, 1), true)}><span className={`num ${cls(r.y12)}`}>{pct(r.y12, 1)}</span></S>}</td>
                <td>{r.a5 == null ? '–' : <S src={() => agg(r, 'a5', 'תשואה שנתית ממוצעת, 5 שנים', 'AVG_ANNUAL_YIELD_TRAILING_5YRS משוקלל ב-TOTAL_ASSETS, רק מסלולים עם נתון', pct(r.a5, 1), undefined, (f) => pct(f.a5, 1), true)}><span className="num">{pct(r.a5, 1)}</span></S>}</td>
                <td>{r.net == null ? '–' : <S src={() => agg(r, 'net12', 'צבירה נטו, LTM', 'סכום צבירה אורגנית LTM של המסלולים (מיליוני ש"ח), חלקי 1,000. ביטוח-נט אינו מפרסם תזרימים', nf(r.net!, 2), 'מיליארד ש"ח', (f) => sn(f.net12!, 1))}><span className={`num ${cls(r.net)}`}>{nf(r.net, 2)}</span></S>}</td>
                <td>{r.tr == null ? '–' : <S src={() => agg(r, 'tr12', 'ניוד נטו, LTM', 'סכום העברות נטו LTM של המסלולים (מיליוני ש"ח), חלקי 1,000. ביטוח-נט אינו מפרסם תזרימים', nf(r.tr!, 2), 'מיליארד ש"ח', (f) => sn(f.tr12!, 1))}><span className={`num ${cls(r.tr)}`}>{nf(r.tr, 2)}</span></S>}</td>
              </tr>
              {open === r.mgr && [...r.list].sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0)).map((f) => (
                <tr key={f.id} className="sec">
                  <td style={{ paddingInlineStart: 26, fontWeight: 400, color: 'var(--fg)' }}>{f.name}</td>
                  <td>{f.assets == null ? '–' : <S src={() => fundCell(A, f, 'assets')!}><span className="num">{nf(f.assets / 1000, 2)}</span></S>}</td><td />
                  <td>{f.stock == null ? '' : <S src={() => fundCell(A, f, 'stock')!}><span className="num muted">{`מניות ${nf(f.stock, 0)}%`}</span></S>}</td>
                  <td>{f.fee == null ? '–' : <S src={() => fundCell(A, f, 'fee')!}><span className="num">{pct(f.fee, 2)}</span></S>}</td><td>{f.depfee == null ? '–' : <S src={() => fundCell(A, f, 'depfee')!}><span className="num">{pct(f.depfee, 2)}</span></S>}</td>
                  <td onPointerEnter={() => warmHist(fundRef(f))}>{f.y12 == null ? '–' : <S src={() => fundCell(A, f, 'y12')!}><span className={`num ${cls(f.y12)}`}>{pct(f.y12, 1)}</span></S>}</td><td>{f.a5 == null ? '–' : <S src={() => fundCell(A, f, 'a5')!}><span className="num">{pct(f.a5, 1)}</span></S>}</td>
                  <td onPointerEnter={() => warmHist(fundRef(f))}>{f.net12 == null ? '–' : <S src={() => fundCell(A, f, 'net12')!}><span className={`num ${cls(f.net12)}`}>{nf(f.net12 / 1000, 2)}</span></S>}</td><td onPointerEnter={() => warmHist(fundRef(f))}>{f.tr12 == null ? '–' : <S src={() => fundCell(A, f, 'tr12')!}><span className={`num ${cls(f.tr12)}`}>{nf(f.tr12 / 1000, 2)}</span></S>}</td>
                </tr>
              ))}
            </Fragment>
          ))}</tbody>
        </table></div>
        <div className="fnote">מקור: רשות שוק ההון, גמל-נט, פנסיה-נט וביטוח-נט. למסלולי הביטוח (ביטוחי מנהלים ופוליסות חיסכון) אין נתוני צבירה.</div>
      </Panel>
    </>
  );
}
