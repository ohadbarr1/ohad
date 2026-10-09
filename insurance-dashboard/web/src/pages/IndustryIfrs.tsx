import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { CHART_FONT, chartBase, palette } from '../lib/theme';
import { nf } from '../lib/format';
import { useIfrsData, useIfrsFacts, useRegistry } from '../lib/useData';
import type { IfrsData, IfrsFact } from '../lib/types';

export const METRICS: [string, string][] = [
  ['csm_closing', 'CSM: יתרת סגירה'], ['csm_new_business', 'CSM: עסק חדש'], ['csm_release', 'CSM: שחרור לרווח'], ['csm_interest_accretion', 'CSM: צבירת ריבית'],
  ['csm_changes_in_estimates', 'CSM: שינויי אומדן'], ['csm_opening', 'CSM: יתרת פתיחה'], ['risk_adjustment', 'התאמת סיכון (RA)'], ['ra_closing', 'RA: יתרת סגירה'], ['ra_release', 'RA: שחרור'], ['loss_component', 'רכיב הפסד'], ['losses_on_onerous_contracts', 'הפסדים מחוזים מכבידים'],
  ['rev_csm_release', 'הכנסות: שחרור CSM'], ['rev_ra_release', 'הכנסות: שחרור RA'], ['rev_expected_claims_and_expenses', 'הכנסות: תביעות והוצאות צפויות'], ['insurance_finance_result', 'הכנסות (הוצאות) מימון ביטוח'],
  ['insurance_revenue', 'הכנסות משירותי ביטוח'], ['insurance_service_result', 'תוצאות שירותי ביטוח'], ['comprehensive_income_before_tax', 'רווח כולל לפני מס'],
  ['gross_written_premiums', 'פרמיות ברוטו'], ['new_business_annualized_premiums', 'פרמיה משונתת, עסק חדש'], ['management_fees', 'דמי ניהול'], ['pension_gemel_profit_before_tax', 'רווח לפני מס, פנסיה וגמל'],
];
export const SEGS: [string, string][] = [['group', 'קבוצה'], ['life', 'חיים וחיסכון'], ['health', 'בריאות'], ['life_health', 'חיים ובריאות'], ['pc', 'כללי'], ['savings', 'פנסיה וגמל'], ['investment_contracts', 'חוזי השקעה']];
export const WINS: [string, string][] = [['instant', 'יתרה'], ['q', 'רבעון'], ['ytd', 'מצטבר'], ['fy', 'שנתי']];
export const BASIS: Record<string, string> = { net: 'נטו', gross: 'ברוטו', reinsurance: 'ביטוח משנה', na: 'לא צוין' };
export const val = (f: IfrsFact) => f.dv ?? f.v;
const INSTANT = ['csm_closing', 'csm_opening', 'risk_adjustment', 'ra_closing', 'loss_component'];
export const WF: [string, string, 1 | -1 | 0][] = [['csm_opening', 'פתיחה', 0], ['csm_new_business', 'עסק חדש', 1], ['csm_interest_accretion', 'ריבית', 1], ['csm_changes_in_estimates', 'שינויי אומדן', 1], ['csm_economic_interest_and_other_effects', 'ריבית והשפעות אחרות', 1], ['csm_experience_adjustments', 'סטיות ניסיון', 1], ['csm_fx_and_other', 'אחר', 1], ['csm_release', 'שחרור', -1], ['csm_closing', 'סגירה', 0]];
export const endOf = (p: string) => `${p.slice(0, 4)}-${({ Q1: '03-31', Q2: '06-30', Q3: '09-30', FY: '12-31' } as Record<string, string>)[p.slice(4)]}`;
export const startOf = (p: string, w: string) => (w === 'q' ? ({ Q1: `${Number(p.slice(0, 4)) - 1}-12-31`, Q2: `${p.slice(0, 4)}-03-31`, Q3: `${p.slice(0, 4)}-06-30` } as Record<string, string>)[p.slice(4)] : `${Number(p.slice(0, 4)) - 1}-12-31`);

export function pick(facts: IfrsFact[], pref: string): IfrsFact | null {
  const order = [pref, 'net', 'gross', 'na'];
  return [...facts].sort((a, b) => (order.indexOf(a.b) + 9) % 9 - (order.indexOf(b.b) + 9) % 9 || (a.s === a.g ? -1 : 1))[0] ?? null;
}
export function Src({ f, d, p }: { f: IfrsFact; d: IfrsData; p: string }) {
  const url = f.u !== undefined ? f.u : d.files.find((x) => x.company === f.c && x.period === p)?.url;
  return f.pg == null ? <>–</> : url ? <a href={`${url}#page=${f.pg}`} target="_blank" rel="noreferrer" className="num">{f.u !== undefined ? 'מצגת ' : ''}עמ׳ {f.pg}</a> : <span className="num">עמ׳ {f.pg}</span>;
}

/** Reported IFRS 17 figures side by side, each with its basis and source page. */
export function IndustryIfrs() {
  const { data: d, error } = useIfrsData();
  const reg = useRegistry();
  const [sp, setSp] = useSearchParams();
  const periods = useMemo(() => [...new Set((d?.files ?? []).map((f) => f.period))].sort().reverse(), [d]);
  const [period, setPeriod] = useState(sp.get('p') ?? '');
  const [metric, setMetric] = useState(sp.get('m') ?? 'csm_closing');
  const [seg, setSeg] = useState(sp.get('s') ?? 'group');
  const [win, setWin] = useState(sp.get('w') ?? 'instant');
  const [basis, setBasis] = useState(sp.get('b') ?? 'net');
  const [co, setCo] = useState(sp.get('c') ?? 'harel');
  const P = periods.includes(period) ? period : periods[0] ?? '';
  useEffect(() => { if (P) setSp({ p: P, m: metric, s: seg, w: win, b: basis, c: co }, { replace: true }); }, [P, metric, seg, win, basis, co, setSp]);
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;

  const facts = useIfrsFacts(P || null);
  const cur = useMemo(() => (facts.data ?? []).filter((f) => !f.tr && !f.model && !f.m.startsWith('csm_subtotal')), [facts.data]);
  const end = P ? endOf(P) : '';
  const annual = P.endsWith('FY');
  const isFlow = !INSTANT.includes(metric);
  const W = metric === 'csm_opening' ? null : isFlow ? (annual ? 'fy' : win === 'instant' || win === 'fy' ? 'ytd' : win) : 'instant';
  const rows = useMemo(() => {
    const ids = [...new Set(cur.map((f) => f.c))];
    return ids.map((id) => {
      const at = (g: string) => cur.filter((f) => f.c === id && f.m === metric && f.g === g && (W == null || f.w === W) && (metric === 'csm_opening' ? f.d === startOf(P, 'ytd') : f.d === end));
      // a filer that reports life and health together has no separate group line for CSM
      const m = at(seg).length || seg !== 'group' || !metric.startsWith('csm') ? at(seg) : at('life_health');
      return { id, f: pick(m, basis), n: m.length };
    }).sort((a, b) => (b.f ? val(b.f) : -Infinity) - (a.f ? val(a.f) : -Infinity));
  }, [cur, metric, seg, W, end, basis]);
  const have = rows.filter((r) => r.f);
  const max = Math.max(...have.map((r) => Math.abs(val(r.f!))), 1e-9);

  const wfWin = annual ? 'fy' : win === 'instant' || win === 'fy' ? 'ytd' : win;
  const wf = useMemo(() => {
    const own = cur.filter((f) => f.c === co && f.g === seg);
    const mine = own.some((f) => f.m.startsWith('csm')) || seg !== 'group' ? own : cur.filter((f) => f.c === co && f.g === 'life_health');
    const open = startOf(P || '2026Q2', wfWin);
    const extra: [string, string, 1 | -1 | 0][] = [...new Set(mine.filter((f) => f.m.startsWith('csm_other:') && !f.m.startsWith('csm_other:Balance')).map((f) => f.m))].map((m) => [m, m.slice(10, 34), 1]);
    return [...WF.slice(0, -2), ...extra, ...WF.slice(-2)].map(([m, label, sign]) => {
      const c = mine.filter((f) => f.m === m && (m === 'csm_opening' ? f.d === open : m === 'csm_closing' ? f.d === end : f.w === wfWin && f.d === end));
      const tied = c.filter((x) => x.dv != null);
      const f = pick(tied.length ? tied : c, basis);
      return { m, label, sign, f };
    }).filter((x) => x.f);
  }, [cur, co, seg, P, wfWin, end, basis]);

  if (error) return <ErrorBox what="נתוני IFRS 17" error={error} />;
  if (!d || !reg.data || (P && !facts.data && !facts.error)) return <Loading what="IFRS 17" />;
  if (!P) return <Empty title="אין דוחות מחולצים" />;
  const pal = palette();
  const ids = [...new Set(cur.map((f) => f.c))];
  const detail = (facts.data ?? []).filter((f) => f.m === metric && (f.g === seg || seg === 'group')).filter((f) => W == null || f.w === W).filter((f) => (metric === 'csm_opening' ? true : f.d === end));
  const label = METRICS.find(([k]) => k === metric)?.[1] ?? metric;
  const o = wf.find((x) => x.m === 'csm_opening'), c = wf.find((x) => x.m === 'csm_closing');
  // one table only: same basis as the closing balance, and where the bridge was tied out, only the rows that are part of it
  const steps = wf.filter((x) => x.sign !== 0 && (!c || (x.f!.b === c.f!.b && (c.f!.dv == null || x.f!.dv != null))));

  return (
    <>
      <section className="controls">
        <Field label="דוח"><select value={P} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{p.endsWith('FY') ? `שנתי ${p.slice(0, 4)}` : `${p.slice(4)} ${p.slice(0, 4)}`}</option>)}</select></Field>
        <Field label="מדד"><select value={metric} onChange={(e) => setMetric(e.target.value)}>{METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="מגזר"><select value={seg} onChange={(e) => setSeg(e.target.value)}>{SEGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {isFlow && !annual && <div className="field"><span>חלון</span><Seg label="חלון" value={win === 'instant' ? 'ytd' : win} onChange={setWin} options={WINS.filter(([k]) => k === 'q' || k === 'ytd')} /></div>}
        <div className="field"><span>בסיס מועדף</span><Seg label="בסיס" value={basis} onChange={setBasis} options={[['net', 'נטו'], ['gross', 'ברוטו'], ['reinsurance', 'ביטוח משנה']]} /></div>
      </section>

      <div className="grid21">
        <Panel title={`${label} · ${SEGS.find(([k]) => k === seg)?.[1]}`} aside={<span>מיליוני ש"ח · כפי שדווח</span>}>
          {have.length === 0 ? <Empty title="המדד לא נמצא בדוחות לתקופה ולמגזר שנבחרו" /> : (
            <table><tbody>{rows.map((r, i) => (
              <tr key={r.id} className={r.id === co ? 'lead' : ''} style={{ cursor: 'pointer' }} onClick={() => setCo(r.id)}>
                <td><span className="num muted">{r.f ? i + 1 : ''}</span> <Link to={`/company/${r.id}`} onClick={(e) => e.stopPropagation()}>{name(r.id)}</Link>{r.f && r.f.s !== r.f.g && <span className="dim">{r.f.s}</span>}</td>
                <td style={{ width: '36%' }}>{r.f && <div className="bar"><i style={{ width: `${(Math.abs(val(r.f)) / max) * 100}%`, background: val(r.f) < 0 ? 'var(--down)' : pal[ids.indexOf(r.id) % pal.length] }} /></div>}</td>
                <td><span className={`num ${r.f && val(r.f) < 0 ? 'neg' : ''}`}>{r.f ? nf(val(r.f), Math.abs(val(r.f)) < 100 ? 1 : 0) : 'לא דווח'}</span></td>
                <td>{r.f && <span className={`chip ${r.f.b === basis ? '' : 'est'}`}>{BASIS[r.f.b] ?? r.f.b}</span>}{r.f?.src === 'chart' && <span className="chip est">מגרף</span>}{r.f?.sn === 1 && <span className="chip" title="הסימן הותאם כך שהגשר נסגר">סימן מנורמל</span>}</td>
                <td>{r.f && <Src f={r.f} d={d} p={P} />}</td>
              </tr>
            ))}</tbody></table>
          )}
          <div className="src">הבסיס (ברוטו או נטו מביטוח משנה) שונה בין חברות; התג מסומן כשהוא אינו הבסיס שביקשת. לחיצה על שורה בוחרת חברה לפירוק ה-CSM.</div>
        </Panel>
        <Panel title={`פירוק CSM · ${name(co)}`} aside={<Field label=""><select value={co} onChange={(e) => setCo(e.target.value)} aria-label="חברה">{ids.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select></Field>}>
          {!o || !c || steps.length === 0 ? <Empty title="אין גשר CSM מלא לחברה, למגזר ולחלון שנבחרו">{wf.length > 0 && `נמצאו: ${wf.map((x) => x.label).join(', ')}`}</Empty> : (
            <Chart label="גשר CSM" height={300} deps={[co, seg, P, wfWin, basis, wf.length]} build={() => {
              const b = chartBase();
              const step = (x: typeof steps[number]) => (x.f!.dv != null ? x.f!.dv : x.sign === -1 ? -Math.abs(x.f!.v) : x.f!.v);
              const pts = [{ l: o.label, v: val(o.f!), t: 0 }, ...steps.map((x) => ({ l: x.label, v: step(x), t: 1 })), { l: c.label, v: val(c.f!), t: 0 }];
              let run = 0; const baseArr: number[] = [], up: (number | null)[] = [], down: (number | null)[] = [], tot: (number | null)[] = [];
              pts.forEach((p) => { if (p.t === 0) { baseArr.push(0); tot.push(p.v); up.push(null); down.push(null); run = p.v; } else { const nx = run + p.v; baseArr.push(Math.min(run, nx)); up.push(p.v >= 0 ? p.v : null); down.push(p.v < 0 ? -p.v : null); tot.push(null); run = nx; } });
              const lab = { show: true, position: 'top' as const, color: b.fg, fontSize: 10.5 };
              return { animationDuration: 650, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 4, right: 4, top: 22, bottom: 4, containLabel: true },
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, formatter: (ps: { dataIndex: number }[]) => `${pts[ps[0].dataIndex].l}: <b>${nf(pts[ps[0].dataIndex].v, 0)}</b>` },
                xAxis: { type: 'category', data: pts.map((p) => p.l), axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } }, axisLabel: { color: b.mu, fontSize: 10.5, interval: 0, rotate: 30 } },
                yAxis: { type: 'value', scale: true, axisLabel: { color: b.mu, fontSize: 10 }, splitLine: { lineStyle: { color: b.ln, opacity: 0.5 } } },
                series: [{ type: 'bar', stack: 'w', data: baseArr, itemStyle: { color: 'transparent' }, silent: true },
                  { type: 'bar', stack: 'w', data: tot, itemStyle: { color: b.accent, borderRadius: [2, 2, 0, 0] }, label: { ...lab, formatter: (p: { value: number }) => nf(p.value, 0) } },
                  { type: 'bar', stack: 'w', data: up, itemStyle: { color: b.up, borderRadius: [2, 2, 0, 0] }, label: { ...lab, formatter: (p: { value: number }) => `+${nf(p.value, 0)}` } },
                  { type: 'bar', stack: 'w', data: down, itemStyle: { color: b.down, borderRadius: [2, 2, 0, 0] }, label: { ...lab, formatter: (p: { value: number }) => `−${nf(p.value, 0)}` } }] };
            }} />
          )}
          {o && c && steps.length > 0 && (() => { const sum = val(o.f!) + steps.reduce((t, x) => t + (x.f!.dv != null ? x.f!.dv : x.sign === -1 ? -Math.abs(x.f!.v) : x.f!.v), 0), gap = val(c.f!) - sum; return <div className="src">{wfWin === 'q' ? 'רבעון' : wfWin === 'fy' ? 'שנה' : 'מצטבר מתחילת השנה'} · בסיס: {BASIS[c.f!.b]} · פער בין הרכיבים לסגירה: <span className="num">{nf(gap, 0)}</span>{Math.abs(gap) > 2 && ' (שורות שלא חולצו או בסיס מעורב)'}</div>; })()}
        </Panel>
      </div>

      <Panel title={`${label}: כל השורות שדווחו`} aside={<span>{detail.length} שורות · מיליוני ש"ח</span>}>
        <div className="scroll" style={{ maxHeight: 520 }}><table>
          <thead><tr><th>חברה</th><th>מגזר כפי שדווח</th><th>שורה בדוח</th><th>בסיס</th><th>גישת מעבר</th><th>חלון</th><th>תאריך</th><th>ערך</th><th>מקור</th></tr></thead>
          <tbody>{detail.sort((a, b) => a.c.localeCompare(b.c) || a.s.localeCompare(b.s)).map((f, i) => (
            <tr key={i}><td>{name(f.c)}</td><td>{f.s}</td><td className="lbl">{f.l}{f.n && <span className="dim">{f.n}</span>}</td><td>{BASIS[f.b] ?? f.b}</td><td>{f.tr ?? ''}</td><td>{WINS.find(([k]) => k === f.w)?.[1]}</td><td><span className="num">{f.d}</span></td><td><span className={`num ${f.v < 0 ? 'neg' : ''}`}>{nf(f.v, Math.abs(f.v) < 100 ? 1 : 0)}</span></td><td><Src f={f} d={d} p={P} /></td></tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </>
  );
}
