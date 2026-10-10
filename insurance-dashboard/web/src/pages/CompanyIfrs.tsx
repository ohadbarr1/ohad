import { foxOption } from '../lib/foxchart';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, IncChip, Loading, Panel, Seg } from '../components/ui';
import { palette } from '../lib/theme';
import { nf, byPeriodDesc } from '../lib/format';
import { useIfrsData, useIfrsFacts } from '../lib/useData';
import type { IfrsFact } from '../lib/types';
import { BUCKET_HE, EFFECT_HE, METRIC_HE, SEGMENT_HE, TEXT_HE } from '../lib/labels';
import { BASIS, METRICS, SEGS, Src, WF, WINS, endOf, startOf, val } from './IndustryIfrs';

const HE: Record<string, string> = {
  ...METRIC_HE,
  ...Object.fromEntries(METRICS),
  own_funds: 'הון עצמי לעניין SCR', scr: 'הון נדרש (SCR)', mcr: 'סף הון (MCR)', own_funds_mcr: 'הון עצמי לעניין MCR', solvency_surplus: 'עודף הון',
  solvency_ratio_with_transitional: 'יחס כושר פירעון, עם הוראות מעבר', solvency_ratio_without_transitional: 'יחס כושר פירעון, ללא הוראות מעבר',
  target_solvency_ratio: 'יעד יחס כושר פירעון', surplus_vs_target: 'עודף מעל היעד', solvency_surplus_over_target: 'עודף מעל היעד',
  csm_expected_release: 'שחרור CSM צפוי', discount_rate: 'שיעור היוון', ra_opening: 'RA: יתרת פתיחה', ra_confidence_level: 'RA: רמת ביטחון',
  aum_total: 'נכסים מנוהלים, סך הכול', aum_pension: 'נכסים מנוהלים: פנסיה', aum_gemel: 'נכסים מנוהלים: גמל', aum_nostro: 'נכסי נוסטרו', contributions_pension: 'הפקדות: פנסיה', contributions_gemel: 'הפקדות: גמל',
  insurance_finance_accrued_interest: 'מימון ביטוח: צבירת ריבית', insurance_finance_rate_effect: 'מימון ביטוח: השפעת שינויי ריבית', rev_paa: 'הכנסות: PAA', rev_other: 'הכנסות: אחר', rev_acquisition_cashflow_recovery: 'הכנסות: השבת עלויות רכישה',
  reins_expense_csm_release: 'ביטוח משנה: שחרור CSM', reins_expense_ra_release: 'ביטוח משנה: שחרור RA', profit_before_tax: 'רווח לפני מס', profit_for_year: 'רווח לשנה', comprehensive_income_total: 'רווח כולל', comprehensive_income_attributable: 'רווח כולל לבעלי המניות',
  dividend_declared: 'דיבידנד שהוכרז', dividend_paid: 'דיבידנד ששולם', roe_reported: 'תשואה להון, כפי שדווחה', combined_ratio: 'Combined ratio',
  profit_attributable: 'רווח נקי לבעלי המניות', equity_attributable: 'הון לבעלי המניות', total_assets: 'סך נכסים', operating_profit_before_tax: 'רווח תפעולי לפני מס',
  net_reinsurance_result: 'תוצאות ביטוח משנה, נטו', insurance_service_expense: 'הוצאות שירותי ביטוח', net_investment_and_finance_result: 'תוצאות השקעה ומימון, נטו',
};
const FAMILIES: [string, string, RegExp][] = [
  ['all', 'הכול', /./], ['csm', 'CSM', /^(csm|note17d)/], ['ra', 'RA ורכיב הפסד', /^(ra_|risk_adj|loss|losses)/], ['rev', 'הכנסות והוצאות שירותי ביטוח', /^(rev_|insurance_(revenue|service)|ise_|reins)/],
  ['fin', 'מימון והשקעות', /^(insurance_finance|net_investment|investment_|total_investment|excess_financial|discount)/], ['cap', 'הון, כושר פירעון ודיבידנד', /^(own_funds|scr|mcr|solvency|surplus|dividend|capital_)/],
  ['tgt', 'יעדי הנהלה', /^target_/], ['sens', 'רגישויות והנחות', /^(sensitivity|assumption)/], ['sav', 'חיסכון ונכסים מנוהלים', /^(aum_|management_fees|contributions|pension_gemel|yield_)/], ['ic', 'פוליסות חיסכון (IFRS 9)', /^future_profit_|investment_contract|receipts_investment|proceeds_investment/],
  ['pl', 'רווח והון', /^(profit|comprehensive|net_income|income_|equity|total_assets|roe|core_|operating|combined|gross_written|new_business|one_time)/],
];
const CAPITAL = /^(own_funds|scr|mcr|solvency|surplus|target_.*(solvency|dividend|capital))/;
export const isPct = (m: string) => /ratio|_pct|payout|confidence|discount_rate|roe_reported|threshold|target_solvency/.test(m);
export const he = (m: string) => { const [k, rest] = m.split(/:(.*)/); return (HE[k] ?? k) + (rest ? `: ${TEXT_HE[rest] ?? rest}` : ''); };
const HEB = /[\u0590-\u05FF]/;
/** Secondary row label: keep when Hebrew, hide an English-only label once the metric has a Hebrew name. */
const subLabel = (f: IfrsFact) => (HEB.test(f.l) || !HE[f.m.split(':')[0]] ? f.l : '');
export const bkName = (b: string) => BUCKET_HE[b] ?? b;
const fmt = (f: IfrsFact, v = f.v) => nf(v, isPct(f.m) || Math.abs(v) < 100 ? 1 : 0) + (isPct(f.m) ? '%' : '');
const SUB: [RegExp, string][] = [[/^pension(_funds)?$/i, 'פנסיה'], [/^(provident(_funds)?|gemel)$/i, 'גמל'], [/^pension_gemel$/i, 'פנסיה וגמל'], [/^pc_incl_overseas$/, 'כללי כולל חו"ל'], [/insurer_subsidiary|_insurance$| Insurance$/i, 'חברת הביטוח'],
  [/^Life Insurance and Long-Term Savings$/, 'חיים וחיסכון'], [/^Health Insurance$/, 'בריאות'], [/^P&C Insurance$/, 'כללי'], [/^life\+health\+pc$/, 'חיים, בריאות וכללי'], [/^(life\+health|life_and_health|Life and Health Segments)$/, 'חיים ובריאות'],
  [/^Long-Term Savings$/, 'חיסכון ארוך טווח'], [/^Life and Health Risks$/, 'סיכוני חיים ובריאות'], [/^financial_services$/, 'שירותים פיננסיים'], [/^credit(_cards)?$/i, 'אשראי'], [/^(Non-segmented|not_attributed)$/, 'לא מיוחס'], [/^Adjustments and offsets$/, 'התאמות וקיזוזים'], [/^insurance_companies_overseas$/, 'חברות ביטוח בחו"ל']];
export const segName = (g: string) => SEGS.find(([k]) => k === g)?.[1] ?? SEGMENT_HE[g] ?? SUB.find(([re]) => re.test(g))?.[1] ?? (g === 'insurer' ? 'חברת הביטוח' : g === 'other' ? 'אחר' : g);
export const periodName = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);

/** Everything extracted from one company's report: capital, CSM movement by segment, expected CSM release, sensitivities, and the full fact list. Every figure links to its page. */
export function CompanyIfrs({ id, docs }: { id: string; docs: number }) {
  const { data: d, error } = useIfrsData();
  const periods = useMemo(() => (d?.files ?? []).filter((f) => f.company === id).map((f) => f.period).sort(byPeriodDesc), [d, id]);
  const [period, setPeriod] = useState('');
  const P = periods.includes(period) ? period : periods[0] ?? '';
  const facts = useIfrsFacts(P || null);
  const all = useMemo(() => (facts.data ?? []).filter((f) => f.c === id), [facts.data, id]);
  const [basis, setBasis] = useState('');
  const [win, setWin] = useState<'q' | 'ytd'>('q');
  const [fam, setFam] = useState('all');
  const [q, setQ] = useState('');

  const annual = P.endsWith('FY'), end = P ? endOf(P) : '', W = annual ? 'fy' : win;
  const csm = useMemo(() => all.filter((f) => f.m.startsWith('csm') && !f.tr && !f.model && !f.m.startsWith('csm_subtotal') && f.m !== 'csm_expected_release'), [all]);
  const bases = useMemo(() => ['net', 'gross', 'reinsurance', 'na'].filter((b) => csm.some((f) => f.b === b && f.m === 'csm_closing' && f.d === end)), [csm, end]);
  const B = bases.includes(basis) ? basis : bases[0] ?? 'gross';
  const bridge = useMemo(() => {
    const own = csm.filter((f) => f.b === B);
    const cols = SEGS.map(([g]) => g).filter((g) => g !== 'investment_contracts').filter((g) => own.some((f) => f.g === g && f.m === 'csm_closing' && f.d === end));
    const extra: [string, string, 1 | -1 | 0][] = [...new Set(own.filter((f) => f.m.startsWith('csm_other:') && !f.m.startsWith('csm_other:Balance') && f.d === end && f.w === W).map((f) => f.m))].map((m) => [m, TEXT_HE[m.slice(10)] ?? m.slice(10), 1]);
    const open = startOf(P || '2026Q2', W);
    const rows = [...WF.slice(0, -2), ...extra, ...WF.slice(-2)].map(([m, label, sign]) => ({ m, label, sign, cells: cols.map((g) => {
      const c = own.filter((f) => f.g === g && f.m === m && (m === 'csm_opening' ? f.d === open : m === 'csm_closing' ? f.d === end : f.w === W && f.d === end));
      const f = c.sort((a, b) => Number(b.dv != null) - Number(a.dv != null) || Number(b.s === b.g) - Number(a.s === a.g))[0] ?? null;
      // a filer may print one movement as several rows (release of run-off and of growth products): rows tied into the same bridge add up
      const parts = f && sign !== 0 && f.dv != null ? c.filter((x) => x.dv != null && x.s === f.s && x.l !== f.l) : [];
      return f && parts.length ? { ...f, dv: f.dv! + parts.reduce((t, x) => t + x.dv!, 0), l: `${parts.length + 1} שורות` , n: 'sum' } : f;
    }) })).filter((r) => r.cells.some(Boolean));
    const step = (f: IfrsFact, sign: number) => (f.dv != null ? f.dv : sign === -1 ? -Math.abs(f.v) : f.v);
    const gap = cols.map((_, i) => {
      const o = rows.find((r) => r.m === 'csm_opening')?.cells[i], c = rows.find((r) => r.m === 'csm_closing')?.cells[i];
      return o && c ? val(c) - val(o) - rows.filter((r) => r.sign !== 0).reduce((t, r) => t + (r.cells[i] ? step(r.cells[i]!, r.sign) : 0), 0) : null;
    });
    return { cols, rows, gap, step };
  }, [csm, B, end, W, P]);

  const runoff = useMemo(() => {
    const r = all.filter((f) => f.m === 'csm_expected_release' && f.d === end && !f.tr && !f.model);
    const rb = ['net', 'gross', 'reinsurance', 'na'].find((b) => (b === B || !r.some((f) => f.b === B)) && r.some((f) => f.b === b)) ?? '';
    const own = r.filter((f) => f.b === rb);
    const buckets = [...new Set(own.map((f) => f.bk ?? ''))];
    const segs = [...new Set(own.map((f) => f.g))];
    return { rb, buckets, segs, at: (g: string, bk: string) => own.find((f) => f.g === g && f.bk === bk) ?? null, pg: own[0] ?? null };
  }, [all, end, B]);

  const capital = useMemo(() => all.filter((f) => CAPITAL.test(f.m)).sort((a, b) => b.d.localeCompare(a.d) || a.m.localeCompare(b.m) || (a.pg ?? 0) - (b.pg ?? 0)), [all]);
  const sens = useMemo(() => {
    const s = all.filter((f) => f.m.startsWith('sensitivity:') && f.d === end);
    const cols = [...new Set(s.map((f) => `${f.fx ?? ''}|${f.b}`))];
    const rows = [...new Set(s.map((f) => `${f.m}|${f.s}`))];
    return { cols, rows, at: (r: string, c: string) => s.find((f) => `${f.m}|${f.s}` === r && `${f.fx ?? ''}|${f.b}` === c) ?? null };
  }, [all, end]);
  const list = useMemo(() => {
    const re = FAMILIES.find(([k]) => k === fam)![2], t = q.trim().toLowerCase();
    return all.filter((f) => re.test(f.m) && (!t || `${he(f.m)} ${f.m} ${f.l} ${f.s}`.toLowerCase().includes(t))).sort((a, b) => a.m.localeCompare(b.m) || a.g.localeCompare(b.g) || b.d.localeCompare(a.d));
  }, [all, fam, q]);

  if (error) return <ErrorBox what="נתוני IFRS 17" error={error} />;
  if (!d) return <Loading what="IFRS 17" />;
  if (!P) return <Empty title="הדוחות של החברה טרם חולצו">{docs > 0 && <Link to="../filings">{docs} מסמכי מקור</Link>}</Empty>;
  if (facts.error) return <ErrorBox what="נתוני הדוח" error={facts.error} />;
  if (!facts.data) return <Loading what="נתוני הדוח" />;
  const cell = (f: IfrsFact | null, v?: number) => (f ? <><span className={`num ${(v ?? val(f)) < 0 ? 'neg' : ''}`}>{fmt(f, v ?? val(f))}</span> <span className="dim"><Src f={f} d={d} p={P} /></span><IncChip f={f} /></> : <span className="muted">–</span>);

  return (
    <>
      <section className="controls">
        <div className="field"><span>דוח</span><Seg label="דוח" value={P} onChange={setPeriod} options={periods.map((p) => [p, periodName(p)])} /></div>
        {bases.length > 1 && <div className="field"><span>בסיס</span><Seg label="בסיס" value={B} onChange={setBasis} options={bases.map((b) => [b, BASIS[b] ?? b])} /></div>}
        {!annual && <div className="field"><span>חלון</span><Seg label="חלון" value={win} onChange={setWin} options={[['q', 'QTD'], ['ytd', 'YTD']]} /></div>}
        <span className="chip">{all.length} נתונים מהדוח · מיליוני ש"ח</span>
      </section>

      <Panel title="תנועה ב-CSM לפי מגזר" aside={<><span className="chip">{BASIS[B] ?? B}</span><span className="chip">{annual ? 'FY' : win === 'q' ? 'QTD' : 'YTD'}</span><span>עד {end}</span></>}>
        {bridge.cols.length === 0 ? <Empty title="לא נמצאה תנועת CSM בדוח לבסיס ולחלון שנבחרו" /> : (
          <div className="scroll"><table>
            <thead><tr><th>שורה</th>{bridge.cols.map((g) => <th key={g}>{segName(g)}</th>)}</tr></thead>
            <tbody>
              {bridge.rows.map((r) => <tr key={r.m} className={r.sign === 0 ? 'lead' : ''}><td className="lbl">{r.label}</td>{r.cells.map((f, i) => <td key={i}>{cell(f, f && r.sign !== 0 ? bridge.step(f, r.sign) : undefined)}{f?.n === 'sum' && <span className="chip est" title="סכום של כמה שורות באותה טבלה">{f.l}</span>}</td>)}</tr>)}
              <tr><td className="lbl muted">פער לסגירה</td>{bridge.gap.map((g, i) => <td key={i}><span className={`num ${g != null && Math.abs(g) > 2 ? 'neg' : 'muted'}`}>{g == null ? '–' : nf(Math.round(g) || 0, 0)}</span></td>)}</tr>
            </tbody>
          </table></div>
        )}
      </Panel>

      <div className="grid21">
        <Panel title="שחרור CSM צפוי לרווח" aside={runoff.buckets.length > 0 && <><span className="chip">{BASIS[runoff.rb] ?? runoff.rb}</span>{runoff.pg && <Src f={runoff.pg} d={d} p={P} />}</>}>
          {runoff.buckets.length === 0 ? <Empty title={annual ? 'לוח השחרור לא נמצא בדוח' : 'לוח השחרור מתפרסם בדוח השנתי'} /> : (
            <>
              <Chart label="שחרור CSM צפוי לפי שנים" height={280} deps={[id, P, runoff.rb, runoff.buckets.length]} build={() => {
                const pal = palette();
                return foxOption({ x: runoff.buckets.map(bkName), unit: 'מיליוני ש"ח', full: true, total: true, rotate: 30, labels: false,
                  series: runoff.segs.map((g, i) => ({ name: segName(g), kind: 'bar' as const, stack: true, color: pal[i % pal.length], dec: 0, data: runoff.buckets.map((bk) => runoff.at(g, bk)?.v ?? null) })) });
            }} />
              <div className="scroll"><table>
                <thead><tr><th>מגזר</th>{runoff.buckets.map((bk) => <th key={bk}>{bkName(bk)}</th>)}<th>סה"כ</th></tr></thead>
                <tbody>{runoff.segs.map((g) => { const vs = runoff.buckets.map((bk) => runoff.at(g, bk)?.v ?? null); return <tr key={g}><td>{segName(g)}</td>{vs.map((v, i) => <td key={i}><span className="num">{v == null ? '–' : nf(v, 0)}</span></td>)}<td><span className="num">{nf(vs.reduce((t: number, v) => t + (v ?? 0), 0), 0)}</span></td></tr>; })}</tbody>
              </table></div>
            </>
          )}
        </Panel>
        <Panel title="הון, כושר פירעון ודיבידנד" aside={<span>{capital.length} שורות</span>}>
          {capital.length === 0 ? <Empty title="לא נמצאו נתוני הון בדוח" /> : (
            <div className="scroll" style={{ maxHeight: 420 }}><table>
              <thead><tr><th>שורה</th><th>ערך</th></tr></thead>
              <tbody>{capital.map((f, i) => (
                <tr key={i}>
                  <td className="lbl">{he(f.m)}<span className="dim">{/[\u0590-\u05ff]/.test(f.l) ? f.l : ''}{f.s !== f.g ? `${/[\u0590-\u05ff]/.test(f.l) ? ' · ' : ''}${segName(f.s)}` : ''}</span></td>
                  <td>{cell(f, f.v)}{f.src === 'text' && <span className="chip est">מטקסט</span>}<span className="dim num">{f.d}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>
      </div>

      {sens.rows.length > 0 && (
        <Panel title="רגישויות" aside={<span>השפעה במיליוני ש"ח · {end}</span>}>
          <div className="scroll"><table>
            <thead><tr><th>תרחיש</th><th>מגזר</th>{sens.cols.map((c) => { const [fx, b] = c.split('|'); return <th key={c}>{EFFECT_HE[fx] ?? fx} · {BASIS[b] ?? b}</th>; })}</tr></thead>
            <tbody>{sens.rows.map((r) => { const [m, s] = r.split('|'); return <tr key={r}><td className="lbl">{he(m).replace(/^[^:]*: /, '')}</td><td>{segName(s)}</td>{sens.cols.map((c) => <td key={c}>{cell(sens.at(r, c))}</td>)}</tr>; })}</tbody>
          </table></div>
        </Panel>
      )}

      <Panel title="כל הנתונים שחולצו מהדוח" aside={<span>{list.length} שורות</span>}>
        <section className="controls">
          <Field label="נושא"><select value={fam} onChange={(e) => setFam(e.target.value)}>{FAMILIES.map(([k, l, re]) => <option key={k} value={k}>{l} ({all.filter((f) => re.test(f.m)).length})</option>)}</select></Field>
          <Field label="חיפוש"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם שורה, מגזר" /></Field>
        </section>
        <div className="scroll" style={{ maxHeight: 560 }}><table>
          <thead><tr><th>מדד</th><th>מגזר</th><th>בסיס</th><th>חלון</th><th>תאריך</th><th>ערך</th><th>מקור</th></tr></thead>
          <tbody>{list.slice(0, 600).map((f, i) => (
            <tr key={i}><td className="lbl">{he(f.m)}<span className="dim">{[subLabel(f), f.bk ? bkName(f.bk) : ''].filter(Boolean).join(' · ')}{f.tr ? ` · ${f.tr}` : ''}{f.model ? ` · ${f.model}` : ''}</span></td><td>{segName(f.g)}{f.s !== f.g && <span className="dim">{segName(f.s)}</span>}</td>
              <td><span className="chip">{BASIS[f.b] ?? f.b}</span></td><td>{WINS.find(([k]) => k === f.w)?.[1] ?? f.w}</td><td><span className="num">{f.d}</span></td>
              <td><span className={`num ${f.v < 0 ? 'neg' : ''}`}>{fmt(f)}</span><IncChip f={f} />{f.src && f.src !== 'table' && <span className="chip est">{f.src === 'chart' ? 'מגרף' : 'מטקסט'}</span>}</td><td><Src f={f} d={d} p={P} /></td></tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </>
  );
}
