import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { nf, pct } from '../lib/format';
import { useIfrsData, useIfrsFacts } from '../lib/useData';
import type { IfrsData, IfrsFact } from '../lib/types';
import { BASIS, endOf } from './IndustryIfrs';
import { he, isPct, periodName, segName } from './CompanyIfrs';

const SECTIONS: [string, string[]][] = [
  ['רווח והון', ['profit_attributable', 'comprehensive_income_attributable', 'comprehensive_income_before_tax', 'operating_profit_before_tax', 'core_profit', 'roe_reported', 'equity_attributable', 'total_assets', 'dividend_declared', 'dividend_paid']],
  ['שירותי ביטוח', ['insurance_revenue', 'insurance_service_result', 'insurance_finance_result', 'net_investment_and_finance_result', 'gross_written_premiums', 'new_business_annualized_premiums', 'combined_ratio']],
  ['CSM', ['csm_closing', 'csm_new_business', 'csm_release', 'csm_interest_accretion', 'csm_changes_in_estimates', 'risk_adjustment', 'ra_closing', 'loss_component', 'losses_on_onerous_contracts']],
  ['חיסכון וניהול נכסים', ['management_fees', 'pension_gemel_profit_before_tax', 'aum_total', 'aum_pension', 'aum_gemel']],
  ['כושר פירעון', ['solvency_ratio_with_transitional', 'solvency_ratio_without_transitional', 'solvency_surplus', 'own_funds', 'scr']],
];
const SEG_ORDER = ['group', 'life', 'health', 'life_health', 'pc', 'savings', 'investment_contracts', 'insurer', 'other'];
const B_ORDER = ['net', 'na', 'gross', 'reinsurance'];
const prevPeriod = (p: string) => ({ Q1: `${Number(p.slice(0, 4)) - 1}FY`, Q2: `${p.slice(0, 4)}Q1`, Q3: `${p.slice(0, 4)}Q2`, FY: `${p.slice(0, 4)}Q3` } as Record<string, string>)[p.slice(4)];
const yearBack = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;

function Val({ f, d, p }: { f: IfrsFact | null; d: IfrsData; p: string }) {
  if (!f) return <span className="muted">–</span>;
  const url = f.u !== undefined ? f.u : d.files.find((x) => x.company === f.c && x.period === p)?.url;
  const txt = nf(f.v, isPct(f.m) || Math.abs(f.v) < 100 ? 1 : 0) + (isPct(f.m) ? '%' : '');
  return url && f.pg != null ? <a className={`num ${f.v < 0 ? 'neg' : ''}`} href={`${url}#page=${f.pg}`} target="_blank" rel="noreferrer" title={`${f.u !== undefined ? 'מצגת, ' : ''}עמ׳ ${f.pg}`}>{txt}</a> : <span className={`num ${f.v < 0 ? 'neg' : ''}`}>{txt}</span>;
}
function Delta({ a, b }: { a: IfrsFact | null; b: IfrsFact | null }) {
  if (!a || !b) return null;
  let txt: string, x: number;
  if (isPct(a.m)) { x = a.v - b.v; txt = `${x > 0 ? '+' : ''}${nf(x, 1)} נק׳`; }
  else if (b.v === 0 || (a.v < 0) !== (b.v < 0)) { x = a.v - b.v; txt = `${x > 0 ? '+' : ''}${nf(x, 0)}`; }
  else {
    x = (a.v / b.v - 1) * 100 * (b.v < 0 ? -1 : 1);
    // beyond a tripling a percentage stops informing: show the multiple
    txt = Math.abs(x) > 300 && b.v > 0 ? `×${nf(a.v / b.v, 1)}` : pct(x, 1, true);
  }
  return <span className={`chg num ${x < 0 ? 'neg' : x > 0 ? 'pos' : 'muted'}`}>{txt}</span>;
}

/** One report against the same period a year earlier and the previous quarter. Every figure is as printed and opens its source page. */
export function CompanyReview({ id, docs }: { id: string; docs: number }) {
  const { data: d, error } = useIfrsData();
  const periods = useMemo(() => (d?.files ?? []).filter((f) => f.company === id).map((f) => f.period).sort().reverse(), [d, id]);
  const [period, setPeriod] = useState('');
  const [win, setWin] = useState<'q' | 'ytd'>('q');
  const P = periods.includes(period) ? period : periods[0] ?? '';
  const PP = P && periods.includes(prevPeriod(P)) ? prevPeriod(P) : null;
  const cur = useIfrsFacts(P || null), prev = useIfrsFacts(PP);
  const annual = P.endsWith('FY'), end = P ? endOf(P) : '', pend = P ? endOf(prevPeriod(P)) : '';

  const sections = useMemo(() => {
    const clean = (fs: IfrsFact[] | null) => (fs ?? []).filter((f) => f.c === id && !f.tr && !f.model && !f.bk);
    const A = clean(cur.data), B = clean(prev.data);
    const key = (f: IfrsFact) => `${f.m}|${f.s}|${f.b}`;
    const find = (pool: IfrsFact[], k: string, w: string, dt: string) => pool.filter((f) => key(f) === k && f.w === w && f.d === dt);
    return SECTIONS.map(([title, metrics]) => {
      const rows = metrics.flatMap((m) => {
        const mine = A.filter((f) => f.m === m);
        const flow = mine.some((f) => f.w !== 'instant');
        // a filer that prints only cumulative columns for this row falls back to the cumulative window
        const W = !flow ? 'instant' : annual ? 'fy' : mine.some((f) => f.w === win && f.d === end) ? win : mine.some((f) => f.w === 'q' && f.d === end) ? 'q' : 'ytd';
        const dates = [...new Set(mine.filter((f) => f.w === W).map((f) => f.d))].sort().reverse();
        const at = W === 'instant' && !dates.includes(end) ? dates[0] ?? end : end;  // solvency is published with a lag
        const keys = [...new Set(mine.filter((f) => f.w === W && f.d === at).map(key))];
        return keys.map((k) => {
          const c = find(A, k, W, at), f = c[0];
          const yoy = find(A, k, W, yearBack(at))[0] ?? null;
          const qoqW = W === 'instant' ? 'instant' : 'q';
          const qoq = annual || W === 'ytd' || at !== end ? null : find(A, k, qoqW, pend)[0] ?? find(B, k, qoqW, pend)[0] ?? null;
          return { k, f, n: new Set(c.map((x) => x.v)).size, yoy, qoq, qoqIn: qoq && A.includes(qoq) ? P : PP ?? P, W, at };
        });
      }).sort((a, b) => metrics.indexOf(a.f.m) - metrics.indexOf(b.f.m) || SEG_ORDER.indexOf(a.f.g) - SEG_ORDER.indexOf(b.f.g) || B_ORDER.indexOf(a.f.b) - B_ORDER.indexOf(b.f.b));
      return { title, rows };
    }).filter((s) => s.rows.length);
  }, [cur.data, prev.data, id, win, annual, end, pend, P, PP]);

  if (error) return <ErrorBox what="נתוני הדוחות" error={error} />;
  if (!d) return <Loading what="סקירת דוח" />;
  if (!P) return <Empty title="הדוחות של החברה טרם חולצו">{docs > 0 && <Link to="../filings">{docs} מסמכי מקור</Link>}</Empty>;
  if (cur.error) return <ErrorBox what="נתוני הדוח" error={cur.error} />;
  if (!cur.data || (PP && !prev.data && !prev.error)) return <Loading what="נתוני הדוח" />;
  const file = d.files.find((x) => x.company === id && x.period === P);

  return (
    <>
      <section className="controls">
        <div className="field"><span>דוח</span><Seg label="דוח" value={P} onChange={setPeriod} options={periods.map((p) => [p, periodName(p)])} /></div>
        {!annual && <div className="field"><span>חלון</span><Seg label="חלון" value={win} onChange={setWin} options={[['q', 'QTD'], ['ytd', 'YTD']]} /></div>}
        <span className="chip">מיליוני ש"ח · כפי שדווח</span>
        {file?.url && <a className="chip" href={file.url} target="_blank" rel="noreferrer">הדוח המלא</a>}
        {!annual && !PP && <span className="chip est">QoQ: {periodName(prevPeriod(P))} טרם חולץ</span>}
      </section>
      {sections.map((s) => (
        <Panel key={s.title} title={s.title}>
          <div className="scroll"><table className="tight">
            <thead><tr><th>שורה</th><th>{periodName(P)}</th><th>{periodName(`${Number(P.slice(0, 4)) - 1}${P.slice(4)}`)} · YoY</th>{!annual && <th>{periodName(prevPeriod(P))} · QoQ</th>}</tr></thead>
            <tbody>{s.rows.map((r, i) => { const multi = (k: number) => s.rows.filter((x) => x.f.m === s.rows[k].f.m).length > 1; return (
              <Fragment key={r.k + r.W}>
                {multi(i) && (i === 0 || s.rows[i - 1].f.m !== r.f.m) && <tr className="sec"><td colSpan={annual ? 3 : 4}>{he(r.f.m)}</td></tr>}
                <tr>
                  <td className="lbl">{multi(i) ? segName(r.f.s) : <>{he(r.f.m)}{r.f.g !== 'group' && <span className="muted"> · {segName(r.f.s)}</span>}</>}
                    {(r.f.b !== 'na' || r.W === 'ytd' && win === 'q' || r.at !== end || r.n > 1 || r.f.src === 'chart') && <span className="dim">{r.f.b !== 'na' && <span className="chip">{BASIS[r.f.b]}</span>}{r.W === 'ytd' && win === 'q' && <span className="chip est">YTD</span>}{r.at !== end && <span className="chip est">{r.at}</span>}{r.n > 1 && <span className="chip est" title="אותה שורה מופיעה בדוח בכמה ערכים; ראו לשונית IFRS 17">{r.n} ערכים</span>}{r.f.src === 'chart' && <span className="chip est">מגרף</span>}</span>}</td>
                  <td><Val f={r.f} d={d} p={P} /></td>
                  <td><Val f={r.yoy} d={d} p={P} /><Delta a={r.f} b={r.yoy} /></td>
                  {!annual && <td><Val f={r.qoq} d={d} p={r.qoqIn} /><Delta a={r.f} b={r.qoq} /></td>}
                </tr>
              </Fragment>
            ); })}</tbody>
          </table></div>
        </Panel>
      ))}
    </>
  );
}
