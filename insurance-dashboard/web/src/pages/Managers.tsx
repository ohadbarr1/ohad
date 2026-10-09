import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { cls, nf, pct } from '../lib/format';
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
  const co = (g: string) => reg.data?.find((c) => c.market_group === g)?.id;
  const asof = `${String(data.meta.asof).slice(4)}/${String(data.meta.asof).slice(0, 4)}`;
  return (
    <>
      <div className="pagehead"><div><h1>מנהלים וקופות</h1><div className="sub"><span className="num">{rows.length}</span> חברות מנהלות · <span className="num">{nf(total, 0)}</span> מיליארד ש"ח · <span className="num">{asof}</span></div></div></div>
      <section className="controls">
        <div className="field"><span>מוצר</span><Seg<Fam> label="מוצר" value={fam} onChange={setFam} options={[['all', 'הכול'], ['pension', 'פנסיה'], ['gemel', 'גמל והשתלמות'], ['insurance', 'פוליסות חיסכון']]} /></div>
        <Field label="קבוצה"><select value={grp} onChange={(e) => setGrp(e.target.value)}><option value="all">כל הקבוצות</option>{groups.map((g) => <option key={g}>{g}</option>)}</select></Field>
      </section>
      <Panel aside={<span>דמי ניהול ותשואות משוקללים בנכסים · צבירה וניוד: LTM, מיליארדי ש"ח</span>}>
        <div className="scroll"><table>
          <thead><tr><th>חברה מנהלת</th><th>נכסים, מיליארד</th><th /><th>מסלולים</th><th>דמי ניהול מצבירה</th><th>מהפקדה</th><th>תשואה, LTM</th><th>5Y, שנתי</th><th>צבירה נטו</th><th>ניוד נטו</th></tr></thead>
          <tbody>{rows.map((r) => (
            <Fragment key={r.mgr}>
              <tr style={{ cursor: 'pointer' }} className={open === r.mgr ? 'lead' : ''} onClick={() => setOpen(open === r.mgr ? null : r.mgr)}>
                <td>{r.mgr}<span className="dim">{co(r.grp) ? <Link to={`/company/${co(r.grp)}`} onClick={(e) => e.stopPropagation()}>{r.grp}</Link> : r.grp}</span></td>
                <td><span className="num">{nf(r.assets, 1)}</span></td>
                <td style={{ width: 120 }}><div className="bar"><i style={{ width: `${(r.assets / max) * 100}%` }} /></div></td>
                <td><span className="num">{r.list.length}</span></td>
                <td><span className="num">{pct(r.fee, 2)}</span></td><td><span className="num">{pct(r.dep, 2)}</span></td>
                <td><span className={`num ${cls(r.y12)}`}>{pct(r.y12, 1)}</span></td><td><span className="num">{pct(r.a5, 1)}</span></td>
                <td><span className={`num ${cls(r.net)}`}>{r.net == null ? '–' : nf(r.net, 2)}</span></td><td><span className={`num ${cls(r.tr)}`}>{r.tr == null ? '–' : nf(r.tr, 2)}</span></td>
              </tr>
              {open === r.mgr && [...r.list].sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0)).map((f) => (
                <tr key={f.id} className="sec">
                  <td style={{ paddingInlineStart: 26, fontWeight: 400, color: 'var(--fg)' }}>{f.name}</td>
                  <td><span className="num">{f.assets == null ? '–' : nf(f.assets / 1000, 2)}</span></td><td />
                  <td><span className="num muted">{f.stock == null ? '' : `מניות ${nf(f.stock, 0)}%`}</span></td>
                  <td><span className="num">{pct(f.fee, 2)}</span></td><td><span className="num">{pct(f.depfee, 2)}</span></td>
                  <td><span className={`num ${cls(f.y12)}`}>{pct(f.y12, 1)}</span></td><td><span className="num">{pct(f.a5, 1)}</span></td>
                  <td><span className={`num ${cls(f.net12)}`}>{f.net12 == null ? '–' : nf(f.net12 / 1000, 2)}</span></td><td><span className={`num ${cls(f.tr12)}`}>{f.tr12 == null ? '–' : nf(f.tr12 / 1000, 2)}</span></td>
                </tr>
              ))}
            </Fragment>
          ))}</tbody>
        </table></div>
        <div className="src">מקור: רשות שוק ההון, גמל-נט, פנסיה-נט וביטוח-נט. לפוליסות חיסכון אין נתוני צבירה.</div>
      </Panel>
    </>
  );
}
