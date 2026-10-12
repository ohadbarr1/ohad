import { foxOption } from '../lib/foxchart';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, IncChip, Loading, Panel, Seg } from '../components/ui';
import { palette } from '../lib/theme';
import { nf, byPeriodDesc, dateLabel } from '../lib/format';
import { useIfrsData, useIfrsFactsOf } from '../lib/useData';
import type { IfrsFact } from '../lib/types';
import { BUCKET_HE, EFFECT_HE, METRIC_HE, TEXT_HE } from '../lib/labels';
import { BASIS, METRICS, SEGS, Src, SegLabel, TR_HE, WF, WINS, Orig, capHe, endOf, heb, latin, lineHe, origOf, segName, startOf, val } from './IndustryIfrs';
import { Sourced } from '../components/Source';
import { useSource, type Prov } from '../lib/prov';
import { calc, factUrl, ifrsProv } from './companyProv';
import '../styles/ifrs.css';

export { segName };

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
  reinsurance_finance_result: 'תוצאות מימון ביטוח משנה', new_business_single_premiums: 'פרמיות חד פעמיות, עסק חדש', investment_contracts_liability: 'התחייבות בגין פוליסות חיסכון (חוזי השקעה)', total_assets_yield_linked: 'נכסים צמודי תשואה',
  income_tax: 'מס הכנסה', income_tax_benefit: 'הטבת מס', capital_instruments_issued_redeemed: 'מכשירי הון שהונפקו ונפדו', own_funds_with_transitional_after_capital_actions: 'הון עצמי לעניין SCR, עם הוראות מעבר, אחרי פעולות הון',
  shortfall_vs_board_target: 'חסר מול יעד הדירקטוריון', surplus_vs_board_target: 'עודף מעל יעד הדירקטוריון', aum_managed_for_insureds_and_members: 'נכסים מנוהלים עבור מבוטחים וחברים', loss_ratio: 'יחס נזקים', loss_recovery_component: 'רכיב השבת הפסד',
  aum_investment_contracts: 'נכסים מנוהלים: פוליסות חיסכון (חוזי השקעה)', aum_mutual_funds: 'נכסים מנוהלים: קרנות נאמנות', aum_customer_portfolios: 'נכסים מנוהלים: תיקי לקוחות', text_csm_release_net: 'שחרור CSM, נטו (מהטקסט)', pres_csm_release_net: 'שחרור CSM, נטו (מהמצגת)', pres_ra_release_net: 'שחרור RA, נטו (מהמצגת)',
  own_funds_after_capital_raise: 'הון עצמי לעניין SCR, אחרי גיוס הון', own_funds_with_transitional_after_capital_raise: 'הון עצמי לעניין SCR, עם הוראות מעבר, אחרי גיוס הון', solvency_surplus_without_transitional_after_capital_raise: 'עודף הון, ללא הוראות מעבר, אחרי גיוס הון', solvency_surplus_with_transitional_after_capital_raise: 'עודף הון, עם הוראות מעבר, אחרי גיוס הון',
  investment_contracts_yield_component: 'פוליסות חיסכון (חוזי השקעה): רכיב תשואה', payments_investment_contracts: 'תשלומים בגין פוליסות חיסכון (חוזי השקעה)', investment_contracts_profit: 'רווח מפוליסות חיסכון (חוזי השקעה)', capital_actions_redemptions: 'פעולות הון: פדיונות', capital_actions_total: 'פעולות הון, סך הכול',
  target_dividend_threshold_without_transitional: 'סף לחלוקת דיבידנד, ללא הוראות מעבר', target_solvency_ratio_min_stability_with_transitional: 'יעד יחס כושר פירעון מינימלי, יציבות, עם הוראות מעבר', target_solvency_ratio_min_without_transitional_after_dividend: 'יעד יחס כושר פירעון מינימלי, ללא הוראות מעבר, אחרי דיבידנד',
  target_comprehensive_income: 'יעד רווח כולל', target_roe: 'יעד תשואה להון', capital_raise_effect: 'השפעת גיוס הון', capital_instruments_excess_over_quantitative_limits: 'מכשירי הון מעל המגבלה הכמותית', quantitative_limit_excess: 'חריגה מהמגבלה הכמותית',
  note12_pl_effect_interest_rate_and_yield: 'ביאור 12: השפעה על הרווח, ריבית ותשואה', note12_csm_effect_interest_rate_and_yield: 'ביאור 12: השפעה על CSM, ריבית ותשואה', note13_csm_effect_discount_rate_change: 'ביאור 13: השפעה על CSM, שינוי בריבית ההיוון', note12_csm_effect_demographic_and_other: 'ביאור 12: השפעה על CSM, דמוגרפיה ואחר', note12_pl_effect_demographic_and_other: 'ביאור 12: השפעה על הרווח, דמוגרפיה ואחר',
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
/** A sensitivity shock printed in English, rebuilt as Hebrew (risk, direction, size) when it is not in the label map. */
const shockHe = (r: string) => {
  const risk = /morbid|תחלוא/i.test(r) ? 'שיעור תחלואה' : /mortal|תמותה/i.test(r) ? 'שיעור תמותה' : /interest/i.test(r) ? 'שיעור ריבית' : /equity|share/i.test(r) ? 'מחיר מניות' : '';
  const n = r.match(/(\d+(?:\.\d+)?)/);
  if (!risk || !n) return '';
  const up = /increase|\+|higher|rise/i.test(r), down = /decrease|reduc|-\d|−|lower|fall/i.test(r);
  return `${risk}, ${up && !down ? 'עלייה' : down && !up ? 'ירידה' : 'שינוי'} של ${n[1]}${risk === 'שיעור ריבית' ? ' נקודות אחוז' : '%'}${/second/i.test(r) ? ' (עמודה שנייה)' : ''}`;
};
/** Metric name for display: an unmapped key or English tail never shows as text, only a Hebrew name with the original behind a "מקור" mark. */
function MetricName({ m }: { m: string }) {
  const [k, rest] = m.split(/:(.*)/);
  if (!HE[k]) return <>שורה בדוח<Orig t={m} /></>;
  const r = rest ? TEXT_HE[rest] ?? rest : '';
  if (!rest || !latin(r)) return <>{he(m)}</>;
  const h = k === 'sensitivity' ? shockHe(rest) : '';
  return <>{HE[k]}{h ? `: ${h}` : ''}<Orig t={rest} /></>;
}
/** Secondary row label: the report's own Hebrew when it has it, otherwise a short Hebrew qualifier and the original text behind "מקור". */
function SubLabel({ f, always }: { f: IfrsFact; always?: boolean }) {
  if (heb(f.l)) return <>{f.l}</>;
  const q = capHe(f) || lineHe(f);
  return q || always ? <>{q}<Orig t={origOf(f)} /></> : <></>;
}
/** Effect on a target: set for a later year, or in force from a date. */
const targetTag = (f: IfrsFact, end: string) => (f.d > end ? `יעד ל-${f.d.slice(0, 4)}` : `בתוקף ${dateLabel(f.d)}`);
export const bkName = (b: string) => BUCKET_HE[b] ?? b;
const fmt = (f: IfrsFact, v = f.v) => nf(v, isPct(f.m) || Math.abs(v) < 100 ? 1 : 0) + (isPct(f.m) ? '%' : '');
export const periodName = (p: string) => (p.endsWith('FY') ? `FY'${p.slice(2, 4)}` : `${p.slice(4)}'${p.slice(2, 4)}`);

/** Everything extracted from one company's report: capital, CSM movement by segment, expected CSM release, sensitivities, and the full fact list. Every figure links to its page. */
export function CompanyIfrs({ id, docs }: { id: string; docs: number }) {
  const { data: d, error } = useIfrsData();
  const periods = useMemo(() => (d?.files ?? []).filter((f) => f.company === id).map((f) => f.period).sort(byPeriodDesc), [d, id]);
  const [period, setPeriod] = useState('');
  const P = periods.includes(period) ? period : periods[0] ?? '';
  const facts = useIfrsFactsOf(id, P || null);
  const all = useMemo(() => (facts.data ?? []).filter((f) => f.c === id), [facts.data, id]);
  const [basis, setBasis] = useState('');
  const [win, setWin] = useState<'q' | 'ytd'>('q');
  const [fam, setFam] = useState('all');
  const [q, setQ] = useState('');
  const [sb, setSb] = useState('net');
  const { open: openSrc } = useSource();

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

  const [openAll, setOpenAll] = useState(false);
  const capital = useMemo(() => all.filter((f) => CAPITAL.test(f.m)).sort((a, b) => b.d.localeCompare(a.d) || a.m.localeCompare(b.m) || (a.pg ?? 0) - (b.pg ?? 0)), [all]);
  // 216 extracted sensitivity rows: one line per shock and segment, the effect on CSM, profit and equity side by side (annual reports only print them)
  const sens = useMemo(() => {
    const all2 = all.filter((f) => f.m.startsWith('sensitivity:') && f.d === end);
    const bases = ['net', 'gross'].filter((b) => all2.some((f) => f.b === b || (b === 'net' && f.b === 'na')));
    const B2 = bases.includes(sb) ? sb : bases[0] ?? 'net';
    const rows = new Map<string, { m: string; s: string; k: Record<string, IfrsFact> }>();
    all2.filter((f) => f.b === B2 || (B2 === 'net' && f.b === 'na')).forEach((f) => {
      const key = `${f.m}|${f.s}`, r = rows.get(key) ?? { m: f.m, s: f.s, k: {} };
      const k = /csm/i.test(f.fx ?? '') ? 'csm' : /profit.*equity|equity.*profit/i.test(f.fx ?? '') ? 'pe' : /equity/i.test(f.fx ?? '') ? 'eq' : /profit|income|loss/i.test(f.fx ?? '') ? 'pl' : 'x';
      r.k[k] ??= f; rows.set(key, r);
    });
    return { bases, B: B2, rows: [...rows.values()] };
  }, [all, end, sb]);
  const list = useMemo(() => {
    const re = FAMILIES.find(([k]) => k === fam)![2], t = q.trim().toLowerCase();
    return all.filter((f) => re.test(f.m) && (!t || `${he(f.m)} ${f.m} ${f.l} ${f.s}`.toLowerCase().includes(t))).sort((a, b) => a.m.localeCompare(b.m) || a.g.localeCompare(b.g) || b.d.localeCompare(a.d));
  }, [all, fam, q]);

  if (error) return <ErrorBox what="נתוני IFRS 17" error={error} />;
  if (!d) return <Loading what="IFRS 17" />;
  if (!P) return <Empty title="הדוחות של החברה טרם חולצו">{docs > 0 && <Link to="../filings">{docs} מסמכי מקור</Link>}</Empty>;
  if (facts.error) return <ErrorBox what="נתוני הדוח" error={facts.error} />;
  if (!facts.data) return <Loading what="נתוני הדוח" />;
  /* every figure opens the page it was printed on; the bridge's own arithmetic (the gap to closing, sums of buckets) lists its inputs */
  const unit = (f: IfrsFact) => (isPct(f.m) ? '%' : 'מיליוני ש"ח');
  const prov = (f: IfrsFact, title: string, v = f.v): Prov => ifrsProv(f, d, P, { title, value: fmt(f, v), unit: unit(f), note: v !== f.v ? `ערך בפירוק התנועה · בעמוד: ${fmt(f)}` : undefined });
  const link = (f: IfrsFact) => { const url = factUrl(f, d, P); return url && f.pg != null ? `${url}#page=${f.pg}` : null; };
  const num = (f: IfrsFact, title: string, v = f.v, cls = '') => <Sourced src={() => prov(f, title, v)} href={link(f)} title={f.pg != null ? `עמ׳ ${f.pg}` : undefined}><span className={`num ${v < 0 ? 'neg' : ''} ${cls}`}>{fmt(f, v)}</span></Sourced>;
  const cell = (f: IfrsFact | null, title: string, v?: number) => (f ? <>{num(f, title, v ?? val(f))} <span className="dim"><Src f={f} d={d} p={P} /></span><IncChip f={f} /></> : <span className="muted">–</span>);

  const fig = (f: IfrsFact | undefined, title: string) => {
    if (!f) return <span className="muted">–</span>;
    const t = nf(f.v, Math.abs(f.v) < 100 ? 1 : 0);
    return <Sourced src={() => ifrsProv(f, d, P, { title, value: t, unit: 'מיליוני ש"ח' })} href={link(f)} title={f.pg != null ? `עמ׳ ${f.pg}` : undefined}><span className={`num ${f.v < 0 ? 'neg' : ''}`}>{t}</span></Sourced>;
  };
  const gapProv = (i: number, g: number): Prov => {
    const ins = bridge.rows.flatMap((r) => { const f = r.cells[i]; return f ? [{ label: r.label, v: nf(r.sign === 0 ? val(f) : bridge.step(f, r.sign), 0), src: () => prov(f, `${r.label} · ${segName(bridge.cols[i])}`, r.sign === 0 ? val(f) : bridge.step(f, r.sign)) }] : []; });
    return calc(`פער לסגירה · ${segName(bridge.cols[i])}`, nf(Math.round(g) || 0, 0), 'סגירה − פתיחה − סכום התנועות', ins, 'מיליוני ש"ח');
  };
  const bucketSum = (g: string): Prov => {
    const fs = runoff.buckets.flatMap((bk) => { const f = runoff.at(g, bk); return f ? [{ bk, f }] : []; });
    return calc(`שחרור CSM צפוי · ${segName(g)} · סה"כ`, nf(fs.reduce((t, x) => t + x.f.v, 0), 0), 'סכום טווחי הזמן', fs.map(({ bk, f }) => ({ label: bkName(bk), v: nf(f.v, 0), src: () => prov(f, `שחרור CSM צפוי · ${segName(g)} · ${bkName(bk)}`) })), 'מיליוני ש"ח');
  };
  const onRunoff = (si: number, di: number) => {
    const g = runoff.segs[si], bk = runoff.buckets[di], f = g && bk != null ? runoff.at(g, bk) : null;
    if (g && f) openSrc(prov(f, `שחרור CSM צפוי · ${segName(g)} · ${bkName(bk)}`));
  };
  const shockTxt = (m: string) => { const rest = m.slice(m.indexOf(':') + 1), r = TEXT_HE[rest] ?? rest; return !latin(r) ? r : shockHe(rest) || 'תרחיש'; };
  const sensTitle = (r: { m: string; s: string }, eff: string) => `רגישות: ${shockTxt(r.m)} · ${segName(r.s)} · ${eff}`;
  const shock = (m: string) => { const rest = m.slice(m.indexOf(':') + 1), r = TEXT_HE[rest] ?? rest; return !latin(r) ? <>{r}</> : <>{shockHe(rest) || 'תרחיש'}<Orig t={rest} /></>; };

  return (
    <>
      <section className="controls">
        <div className="field"><span>דוח</span><Seg label="דוח" value={P} onChange={setPeriod} options={periods.map((p) => [p, periodName(p)])} /></div>
        {bases.length > 1 && <div className="field"><span>בסיס</span><Seg label="בסיס" value={B} onChange={setBasis} options={bases.map((b) => [b, BASIS[b] ?? b])} /></div>}
        {!annual && <div className="field"><span>חלון</span><Seg label="חלון" value={win} onChange={setWin} options={[['q', 'QTD'], ['ytd', 'YTD']]} /></div>}
        <span className="chip">{all.length} נתונים מהדוח · מיליוני ש"ח</span>
      </section>

      <Panel title="תנועה ב-CSM לפי מגזר" aside={<><span className="chip">{BASIS[B] ?? B}</span><span className="chip">{annual ? 'FY' : win === 'q' ? 'QTD' : 'YTD'}</span><span>עד {dateLabel(end)}</span></>}>
        {bridge.cols.length === 0 ? <Empty title="לא נמצאה תנועת CSM בדוח לבסיס ולחלון שנבחרו" /> : (
          <div className="scroll"><table>
            <thead><tr><th>שורה</th>{bridge.cols.map((g) => <th key={g}>{segName(g)}</th>)}</tr></thead>
            <tbody>
              {bridge.rows.map((r) => <tr key={r.m} className={r.sign === 0 ? 'lead' : ''}><td className="lbl">{r.label}</td>{r.cells.map((f, i) => <td key={i}>{cell(f, `${r.label} · ${segName(bridge.cols[i])}`, f && r.sign !== 0 ? bridge.step(f, r.sign) : undefined)}{f?.n === 'sum' && <span className="chip est" title="סכום של כמה שורות באותה טבלה">{f.l}</span>}</td>)}</tr>)}
              <tr><td className="lbl muted">פער לסגירה</td>{bridge.gap.map((g, i) => <td key={i}><span className={`num ${g != null && Math.abs(g) > 2 ? 'neg' : 'muted'}`}>{g == null ? '–' : <Sourced src={() => gapProv(i, g)}>{nf(Math.round(g) || 0, 0)}</Sourced>}</span></td>)}</tr>
            </tbody>
          </table></div>
        )}
      </Panel>

      <div className="grid21">
        <Panel title="שחרור CSM צפוי לרווח" aside={runoff.buckets.length > 0 && <><span className="chip">{BASIS[runoff.rb] ?? runoff.rb}</span>{runoff.pg && <Src f={runoff.pg} d={d} p={P} />}</>}>
          {runoff.buckets.length === 0 ? <Empty title={annual ? 'לוח השחרור לא נמצא בדוח' : 'לוח השחרור מתפרסם בדוח השנתי'} /> : (
            <>
              <Chart label="שחרור CSM צפוי לפי שנים" height={280} onPoint={onRunoff} deps={[id, P, runoff.rb, runoff.buckets.length]} build={() => {
                const pal = palette();
                return foxOption({ x: runoff.buckets.map(bkName), unit: 'מיליוני ש"ח', full: true, total: true, rotate: 30, labels: false,
                  series: runoff.segs.map((g, i) => ({ name: segName(g), kind: 'bar' as const, stack: true, color: pal[i % pal.length], dec: 0, data: runoff.buckets.map((bk) => runoff.at(g, bk)?.v ?? null) })) });
            }} />
              <div className="scroll"><table>
                <thead><tr><th>מגזר</th>{runoff.buckets.map((bk) => <th key={bk}>{bkName(bk)}</th>)}<th>סה"כ</th></tr></thead>
                <tbody>{runoff.segs.map((g) => { const vs = runoff.buckets.map((bk) => runoff.at(g, bk)?.v ?? null); return <tr key={g}><td>{segName(g)}</td>{vs.map((v, i) => { const f = runoff.at(g, runoff.buckets[i]); return <td key={i}><span className="num">{v == null || !f ? '–' : num(f, `שחרור CSM צפוי · ${segName(g)} · ${bkName(runoff.buckets[i])}`, f.v)}</span></td>; })}<td><span className="num">{vs.some((v) => v != null) ? <Sourced src={() => bucketSum(g)}>{nf(vs.reduce((t: number, v) => t + (v ?? 0), 0), 0)}</Sourced> : nf(0, 0)}</span></td></tr>; })}</tbody>
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
                  <td className="lbl"><MetricName m={f.m} /><span className="dim">{heb(f.l) ? f.l : capHe(f)}{!heb(f.l) && <Orig t={origOf(f)} />}{f.s !== f.g && <>{' · '}<SegLabel s={f.s} /></>}</span></td>
                  <td>{cell(f, he(f.m), f.v)}{f.src === 'text' && <span className="chip est">מטקסט</span>}<span className={`chip ${f.m.startsWith('target_') && f.d > end ? 'est' : ''}`}>{f.m.startsWith('target_') ? targetTag(f, end) : dateLabel(f.d)}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>
      </div>

      {sens.rows.length > 0 && (
        <Panel title="רגישויות" aside={<><span>השפעה במיליוני ש"ח, כפי שהודפס · {dateLabel(end)}</span>{sens.bases.length > 1 && <Seg label="בסיס" value={sens.B} onChange={setSb} options={sens.bases.map((b) => [b, BASIS[b] ?? b])} />}</>}>
          <div className="scroll"><table className="sens">
            <thead><tr><th>תרחיש</th><th>מגזר</th><th>השפעה על CSM</th><th>על הרווח</th><th>על ההון</th>{sens.rows.some((r) => r.k.x) && <th>אחר</th>}</tr></thead>
            <tbody>{sens.rows.map((r) => (
              <tr key={`${r.m}|${r.s}`}><td className="lbl">{shock(r.m)}</td><td><SegLabel s={r.s} /></td><td>{fig(r.k.csm, sensTitle(r, 'השפעה על CSM'))}</td>
                {r.k.pe && !r.k.pl && !r.k.eq ? <td colSpan={2}>{fig(r.k.pe, sensTitle(r, 'השפעה על הרווח וההון'))}<span className="chip">רווח והון יחד</span></td> : <><td>{fig(r.k.pl, sensTitle(r, 'השפעה על הרווח'))}</td><td>{fig(r.k.eq, sensTitle(r, 'השפעה על ההון'))}</td></>}
                {sens.rows.some((x) => x.k.x) && <td>{r.k.x ? <>{fig(r.k.x, sensTitle(r, EFFECT_HE[r.k.x.fx ?? ''] ?? 'אחר'))}<span className="chip">{EFFECT_HE[r.k.x.fx ?? ''] ?? 'אחר'}</span></> : <span className="muted">–</span>}</td>}</tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      <Panel title="כל הנתונים שחולצו מהדוח" aside={<><span>{list.length} שורות</span><button type="button" className="btn" aria-expanded={openAll} onClick={() => setOpenAll((v) => !v)}>{openAll ? 'סגירה' : 'הצגה'}</button></>}>
        {openAll && <><section className="controls">
          <Field label="נושא"><select value={fam} onChange={(e) => setFam(e.target.value)}>{FAMILIES.map(([k, l, re]) => <option key={k} value={k}>{l} ({all.filter((f) => re.test(f.m)).length})</option>)}</select></Field>
          <Field label="חיפוש"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם שורה, מגזר" /></Field>
        </section>
        <div className="scroll" style={{ maxHeight: 560 }}><table>
          <thead><tr><th>מדד</th><th>מגזר</th><th>בסיס</th><th>חלון</th><th>תאריך</th><th>ערך</th><th>מקור</th></tr></thead>
          <tbody>{list.slice(0, 600).map((f, i) => (
            <tr key={i}><td className="lbl"><MetricName m={f.m} /><span className="dim"><SubLabel f={f} always />{f.bk ? ` ${heb(f.l) || capHe(f) || lineHe(f) ? '· ' : ''}${bkName(f.bk)}` : ''}{f.tr ? ` · ${TR_HE[f.tr] ?? 'אחר'}` : ''}{f.model ? ` · ${f.model}` : ''}</span></td><td>{segName(f.g)}{f.s !== f.g && <span className="dim">{segName(f.s)}</span>}</td>
              <td><span className="chip">{BASIS[f.b] ?? f.b}</span></td><td>{WINS.find(([k]) => k === f.w)?.[1] ?? f.w}</td><td><span className="num">{dateLabel(f.d)}</span></td>
              <td>{num(f, heb(f.l) ? `${he(f.m)} · ${f.l}` : he(f.m))}<IncChip f={f} />{f.src && f.src !== 'table' && <span className="chip est">{f.src === 'chart' ? 'מגרף' : 'מטקסט'}</span>}</td><td><Src f={f} d={d} p={P} /></td></tr>
          ))}</tbody>
        </table></div></>}
      </Panel>
    </>
  );
}
