import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MgrChip } from '../../components/MgrChip';
import { CompareRisk } from '../../components/FundsTime';
import { Sourced } from '../../components/Source';
import { Chart } from '../../components/Chart';
import { DataTable, type Column } from '../../components/DataTable';
import { Tip } from '../../components/Explain';
import { Empty, Panel, Seg } from '../../components/ui';
import { expP, fundP, monthIn, monthsBack, seedHist } from '../../lib/market';
import { useSource, type Prov } from '../../lib/prov';
import { foxOption } from '../../lib/foxchart';
import { chartBase } from '../../lib/theme';
import { useMacro } from '../../lib/macro';
import { nf, pubLabel } from '../../lib/format';
import { load, useFundCats, useFunds } from '../../lib/useData';
import {
  GROSS_LABEL, PERIODS, PER_LABEL, byYear, catKey, cpiFactor, growth, onAxis, pc, perMonths, refOf, rolling, stats,
  underwater, useReal, winRate, ym, grossProv, type Basis, type CatX, type FundX, type FundsFile, type HistX, type Per,
} from '../../lib/funds';
import { useOptional } from '../../lib/fundsLoad';
import type { DefaultFile } from '../../lib/fundsTools';
import { Icon } from '../../components/Icon';
import { CROSS_HE, LEAD_HE, OLD_HE, compareSummary, type CmpSummary, type Lead } from '../../lib/compareSummary';
import { bottomLines, docRow, snapOf, dmyIso } from '../../lib/compareDoc';
import { defaultNow, isPension, periodText } from '../../lib/pensionPack';
import { rulesOf, RULES_NOTE } from '../../lib/productRules';
import { actProv, ruleProv, tenderProv, pc2 } from '../../lib/agentProv';
import { TIE_NOTE } from '../../lib/fundsTie';
import { COEF_PATH, birthYearOf, coefFor, type CoefFile } from '../../lib/coef';
import { AGE_DEFAULT, BALANCE_EX, GROWTH_DEFAULT, INFL_DEFAULT, RETIRE_AGE, RET_FALLBACK, exampleMonthly, ilsRound, project, type Plan } from '../../lib/retire';
import { BM_HREF, DECISION_PATH, OLD_FEE_HE, OLD_WARN, clmCell, isOldGen, svcCell, type DecisionFile } from '../../lib/decision';
import { ClientSave } from '../../components/agent/ClientSave';
import { folderOfState, useClients } from '../../lib/clients';
import { today as todayIso } from '../../lib/visits';
import { trackRgb } from './tracks';
import '../../components/agent/glossary';
import '../../styles/lens.css';
import '../../styles/market.css';
import '../../styles/agent.css';

/* Track compare: everything the page computed before the redesign, kept whole and reachable for the agent and Pro lenses (C9: cut from
   the default render, never from the code). Moved here from pages/FundsCompare.tsx by lane L2-a; the lanes of "להחלטה" (L3-a) and
   "סיכון" (L3-b) compose these blocks. Nothing here renders in the saver door's default view.
   - useCompareData(keys, basis): funds.json, the category file, each track's history (closed tracks from funds/closed.json), the published gross return,
     nominal or real (CPI), and the sources of every figure (Prov). One load per file: lib/useData caches.
   - useKpiRows(d, mode, win): the KPI rows (periods, both fees, assets, equity, volatility and drawdown in the window, Sharpe and sd as
     published, actuarial balance, default fund, service index, claims, the pension estimate for a man and a woman) and the descriptive
     bottom line (lib/compareSummary: within one category only; ties shared).
   - Blocks: BottomLinePanel, ClientActions (client document, Excel pack, client folder), KpiPanel (the old head-to-head table / phone
     cards), TaxLiqBody / TaxLiqPanel (product rules), GrowthPanel, RollingPanel (B6: an empty window says so), UnderwaterPanel (B7:
     legend wraps, one-decimal axis from lib/foxchart), YearsPanel, PairsPanel, RiskTable (components/FundsTime CompareRisk), WinSeg.
   Every displayed figure opens its source (Sourced / Chart onPoint), as before. */

export type Win = '12' | '36' | '60' | '120' | 'max';
export const WINDOWS: [Win, string][] = [['12', '1Y'], ['36', '3Y'], ['60', '5Y'], ['120', '10Y'], ['max', 'הכול']];
/** a long regulator name cut for a table head (the full name in the tooltip) */
export const shortName = (n: string) => (n.length > 30 ? n.slice(0, 28).trimEnd() + '…' : n);
export interface Item { f: FundX; h: HistX; y: (number | null)[] }
export type Mode = 'saver' | 'agent' | 'pro';

export interface CompareData {
  data: FundsFile; asof: number; cats: Record<string, CatX> | undefined;
  keys: string[]; items: Item[]; unknown: string[]; loadingN: number;
  real: boolean; basis: Basis; lbl: string;
  sameCat: boolean; mixedProd: boolean; cat: CatX | undefined; catY: (number | null)[] | null;
  cpiN: number;
  fundOf: (k: string) => FundX | undefined;
  colorOf: (k: string) => string; nameOf: (k: string) => string;
  /** one month of a track with its source (as published, gross) */
  monthRow: (it: Item, p: number) => ReturnType<typeof monthIn>;
  /** a period return as the page shows it (published gross; real when asked) and its source */
  kret: (it: Item, per: Per) => { v: number | null; src: () => Prov };
}

/** The data of a comparison: null while funds.json loads; { error } when it failed. */
export function useCompareData(keys: string[], basis: Basis): CompareData | { error: string } | null {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cats = useFundCats().data as Record<string, CatX> | undefined;
  const cpi = useMacro().data?.series.cpi;
  const [real] = useReal();
  // closed tracks are not in funds.json: look them up in funds/closed.json when a key is unknown
  const [gone, setGone] = useState<FundX[]>([]);
  const [goneDone, setGoneDone] = useState(false);
  const missing = data ? keys.filter((k) => !data.funds.some((f) => f.k === k)) : [];
  useEffect(() => { if (missing.length && !goneDone) load<{ funds: FundX[] }>('funds/closed.json').then((d) => { setGone((d.funds ?? []).map((f) => ({ ...f, gone: true }))); setGoneDone(true); }, () => setGoneDone(true)); }, [missing.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const fundOf = (k: string) => data?.funds.find((f) => f.k === k) ?? gone.find((f) => f.k === k);
  const [hist, setHist] = useState<Record<string, HistX>>({});
  const [failed, setFailed] = useState<string[]>([]);
  // a history is asked for only for a track the files know (open, or closed): an unknown key in a link costs no 404
  useEffect(() => { keys.filter((k) => !hist[k] && !failed.includes(k) && !!fundOf(k)).forEach((k) => load<HistX>(`funds/${k}.json`).then((h) => setHist((c) => ({ ...c, [k]: h })), () => setFailed((c) => [...c, k]))); }, [keys, hist, failed, data, gone]);  // eslint-disable-line react-hooks/exhaustive-deps
  const items: Item[] = useMemo(() => keys.map((k) => { const f = fundOf(k), h = hist[k]; if (!f || !h) return null; seedHist(refOf(f), h);
    let y = h.y;
    // real: each month deflated by that month's CPI change; months the CPI file does not cover drop out
    if (real) { const at = new Map((cpi?.points ?? []).filter((x) => x.mom != null).map((x) => [Number(x.m.replace('-', '')), x.mom as number])); y = y.map((r, i) => { const c = at.get(h.p[i]); return r == null || c == null ? null : ((1 + r / 100) / (1 + c / 100) - 1) * 100; }); }
    return { f, h, y }; }).filter((x): x is Item => !!x), [keys, hist, data, gone, real, cpi]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return { error };
  if (!data) return null;
  const asof = data.asof;
  const sameCat = items.length > 0 && items.every((it) => catKey(it.f) === catKey(items[0].f));
  const mixedProd = new Set(items.map((it) => it.f.prod)).size > 1;
  const cat = sameCat && cats ? cats[catKey(items[0].f)] : undefined;
  const catY = cat ? cat.y : null;
  const lbl = real ? 'ריאלי' : GROSS_LABEL;
  const unknown = keys.filter((k) => failed.includes(k) || (data.funds.length > 0 && !fundOf(k) && goneDone));
  const monthRow = (it: Item, p: number) => monthIn(refOf(it.f), 'y', p, it.h.y[it.h.p.indexOf(p)]);
  const kret = (it: Item, per: Per): { v: number | null; src: () => Prov } => {
    if (real) { const nom = it.f[per], c = cpiFactor(cpi, asof, perMonths(per, asof));
      const v = nom == null || !c ? null : per === 'a3' || per === 'a5' ? (((1 + nom / 100) ** (perMonths(per, asof) / 12) / c.f) ** (12 / perMonths(per, asof)) - 1) * 100 : ((1 + nom / 100) / c.f - 1) * 100;
      return { v, src: () => ({ k: 'calc', title: `${PER_LABEL[per]}, ${lbl} · ${it.f.name}`, value: pc(v), formula: 'התשואה הנומינלית מנוכה במדד המחירים לצרכן של חודשי החלון', inputs: [{ label: 'נומינלי', v: pc(nom), src: () => grossProv(it.f, per, asof) }, ...(c ? [{ label: 'מדד המחירים בחלון', v: pc((c.f - 1) * 100) }] : [])] }) };
    }
    return { v: it.f[per], src: () => grossProv(it.f, per, asof) };
  };
  const idxOf = (k: string) => Math.max(0, items.findIndex((it) => it.f.k === k));
  return {
    data, asof, cats, keys, items, unknown, loadingN: keys.length - items.length - unknown.length, real, basis, lbl, sameCat, mixedProd, cat, catY,
    cpiN: cpi?.points.length ?? 0, fundOf, colorOf: (k) => trackRgb(idxOf(k)), nameOf: (k) => items.find((it) => it.f.k === k)?.f.name ?? k, monthRow, kret,
  };
}

/** The common axis of a window: from the latest first month among the tracks to the earliest last month; index 0 is the base month. */
export function axisOf(items: Item[], win: Win): number[] {
  if (!items.length) return [];
  const firstOk = (it: Item) => it.h.p.find((_, i) => it.y[i] != null) ?? it.h.p[0];
  const end = Math.min(...items.map((it) => { const ix = it.y.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0); return it.h.p[ix[ix.length - 1] ?? it.h.p.length - 1]; }));
  const start = Math.max(...items.map(firstOk));
  const base = items[0].h.p.filter((p) => p >= start && p <= end);
  const n = win === 'max' ? base.length - 1 : Math.min(Number(win), base.length - 1);
  const from = items[0].h.p.indexOf(base[base.length - 1 - n]);
  return items[0].h.p.slice(Math.max(0, from), items[0].h.p.indexOf(base[base.length - 1]) + 1);
}
export const useAxis = (d: CompareData, win: Win) => useMemo(() => axisOf(d.items, win), [d.items, win]);

/** The window control of the charts and the KPI rows ("1Y 3Y 5Y 10Y הכול") */
export const WinSeg = ({ value, onChange }: { value: Win; onChange: (w: Win) => void }) => <Seg label="חלון" value={value} onChange={onChange} options={WINDOWS} />;

/* ---------------- KPI rows and the bottom line ---------------- */

export type KCell = { v: number | null; t: string; src?: () => Prov; txt?: boolean; sub?: string };
export type KRow = { key: string; label: string; tip?: string; cells: (it: Item) => KCell };
/** a left-to-right figure inside a Hebrew line, isolated so its order holds (LRI … PDI) */
const iso = (x: string) => `⁦${x}⁩`;
/** a Sharpe ratio over a series with no volatility (personally managed tracks report sd 0) says nothing */
export const sharpeOf = (f: FundX) => (f.sd != null && f.sd > 0 ? f.sharpe : null);

export interface KpiRows {
  rows: KRow[];                  // every row (Pro)
  shown: KRow[];                 // the door's rows (the saver's table leaves out LTM, Sharpe, sd and the start date)
  row: (key: string) => KRow | undefined;
  summary: CmpSummary;
  /** marked in its row: the lowest fee or the highest 5Y / Sharpe within the track's own category, never across categories */
  isLead: (row: string, k: string) => boolean;
  anyPension: boolean;
  axis: number[];
  dfile: DefaultFile | null | undefined; dec: DecisionFile | null | undefined;
}

export function useKpiRows(d: CompareData, mode: Mode, win: Win = '60'): KpiRows {
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dec = useOptional<DecisionFile>(DECISION_PATH);  // W2: the service index and the claims rows
  const coefF = useOptional<CoefFile>(COEF_PATH);  // W6: the funds' conversion coefficients
  const axis = useAxis(d, win);
  const { items, asof } = d;
  const ser = (it: Item) => onAxis(axis, it.h.p, it.y);
  const anyPension = items.some((it) => isPension(it.f));
  // W6: one projection for every pension track (the fee tool's example plan), each with its own fees, ÷ the fund's own coefficient
  const uniPlan: Omit<Plan, 'coef'> = { age: AGE_DEFAULT, retire: RETIRE_AGE, balance: BALANCE_EX, monthly: exampleMonthly('פנסיה מקיפה').v, growth: GROWTH_DEFAULT, ret: RET_FALLBACK, infl: INFL_DEFAULT };
  const annuityCell = (it: Item, sex: 'm' | 'f'): KCell => {
    if (!isPension(it.f)) return { v: null, t: '–' };
    const pick = coefFor(coefF, it.f.grp, sex, RETIRE_AGE, birthYearOf(AGE_DEFAULT));
    const out = project({ ...uniPlan, coef: pick.v }, { fee: it.f.fee ?? 0, depfee: it.f.depfee ?? 0 });
    const src = (): Prov => ({ k: 'calc', est: true, title: `קצבה חודשית בגיל ${RETIRE_AGE}, בשקלי היום · ${sex === 'f' ? 'אישה' : 'גבר'} · ${it.f.name}`, value: ilsRound(out.pensionReal),
      formula: `החיסכון בגיל ${RETIRE_AGE} על הנחות אחידות לכל המסלולים (היתרה והפקדה לדוגמה של מחשבון דמי הניהול, תשואה ${RET_FALLBACK}% ברוטו, הפקדה שעולה ${GROWTH_DEFAULT}% בשנה, אינפלציה ${INFL_DEFAULT}%) עם דמי הניהול הממוצעים של המסלול, ÷ מקדם ההמרה של הקרן. ${pick.why}`,
      note: 'אומדן על הנחות אחידות, לא תחזית ולא ייעוץ: ההבדל בין המסלולים נובע מדמי הניהול וממקדם ההמרה של הקרן בלבד. לא מנכה את עלות הכיסוי הביטוחי',
      inputs: [{ label: 'יתרה היום (לדוגמה)', v: ilsRound(uniPlan.balance) }, { label: 'הפקדה חודשית (לדוגמה)', v: ilsRound(uniPlan.monthly) }, { label: 'גיל היום / פרישה (הנחה)', v: `${uniPlan.age} / ${uniPlan.retire}` },
        { label: 'דמי ניהול מצבירה / מהפקדה (ממוצע המסלול)', v: `${pc2(it.f.fee)} / ${pc2(it.f.depfee)}` }, { label: `חיסכון בגיל ${RETIRE_AGE}, בשקלי היום`, v: ilsRound(out.balReal) },
        { label: pick.real ? `מקדם המרה (${pick.label})` : 'מקדם המרה (הנחה)', v: String(pick.v), src: pick.prov }] });
    return { v: out.pensionReal, t: ilsRound(out.pensionReal), src, sub: `מקדם ${pick.v} · ${pick.label}` };
  };
  const rows: KRow[] = [
    ...PERIODS.map(([per, l]): KRow => ({ key: per, label: `${l}${per === 'a3' || per === 'a5' ? ', שנתי' : ''}`, tip: 'gross', cells: (it) => { const r = d.kret(it, per); return { v: r.v, t: pc(r.v, per === 'm1' ? 2 : 1), src: r.src }; } })),
    { key: 'fee', label: 'ד"נ מצבירה, ממוצע בפועל', tip: 'fee', cells: (it) => ({ v: it.f.fee, t: it.f.fee == null ? '–' : nf(it.f.fee, 2) + '%' + (isOldGen(it.f) ? ` · ${OLD_FEE_HE}` : ''), txt: isOldGen(it.f) || undefined, src: () => fundP(refOf(it.f), it.f.end ?? asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', nf(it.f.fee ?? 0, 2) + '%') }) },
    { key: 'depfee', label: 'ד"נ מהפקדה, ממוצע בפועל', tip: 'depfee', cells: (it) => ({ v: it.f.depfee, t: it.f.depfee == null ? '–' : nf(it.f.depfee, 2) + '%', src: () => fundP(refOf(it.f), it.f.end ?? asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', nf(it.f.depfee ?? 0, 2) + '%') }) },
    { key: 'assets', label: 'נכסים, מ׳ ש"ח', cells: (it) => ({ v: it.f.assets, t: it.f.assets == null ? '–' : nf(it.f.assets, 0), src: () => fundP(refOf(it.f), it.f.end ?? asof, 'TOTAL_ASSETS', 'נכסים', nf(it.f.assets ?? 0, 1), 'מיליוני ש"ח') }) },
    { key: 'st', label: 'חשיפה למניות', tip: 'equity', cells: (it) => ({ v: it.f.st, t: it.f.st == null ? '–' : nf(it.f.st, 0) + '%', src: () => expP(refOf(it.f), it.f.end ?? asof, 'STOCK_MARKET_EXPOSURE', 'חשיפה למניות', it.f.st, it.f.assets) }) },
    { key: 'vol', label: 'תנודתיות בחלון', tip: 'vol', cells: (it) => { const s = stats(ser(it), axis.length - 1); return { v: s?.vol ?? null, t: s ? nf(s.vol, 1) + '%' : '–', src: s ? () => ({ k: 'calc', title: `תנודתיות שנתית · ${it.f.name}`, value: nf(s.vol, 1) + '%', formula: 'סטיית תקן של התשואות החודשיות בחלון כפול שורש 12', inputs: axis.slice(1).map((p) => d.monthRow(it, p)) }) : undefined }; } },
    { key: 'dd', label: 'ירידה מרבית בחלון', tip: 'dd', cells: (it) => { const s = stats(ser(it), axis.length - 1); return { v: s?.dd ?? null, t: pc(s?.dd, 1), src: s ? () => ({ k: 'calc', title: `ירידה מרבית · ${it.f.name}`, value: pc(s.dd), formula: 'הירידה הגדולה ביותר ממדד התשואה המצטברת, משיאו לשפל שאחריו', inputs: axis.slice(1).map((p) => d.monthRow(it, p)) }) : undefined }; } },
    { key: 'age', label: 'מועד הקמה', cells: (it) => ({ v: null, t: it.f.since ? pubLabel(it.f.since) : '–' }) },
    // W1-agent: the regulator's own risk figures, and the pension decision rows
    { key: 'sharpe', label: 'שארפ (הרשות, כפי שפורסם)', tip: 'sharpe', cells: (it) => { const v = sharpeOf(it.f); return { v, t: v == null ? '–' : nf(v, 2), src: () => fundP(refOf(it.f), it.f.end ?? asof, 'SHARPE_RATIO', 'שארפ', nf(v ?? 0, 2)) }; } },
    { key: 'sd', label: 'סטיית תקן (הרשות)', tip: 'sd', cells: (it) => ({ v: it.f.sd, t: it.f.sd == null ? '–' : nf(it.f.sd, 2), src: () => fundP(refOf(it.f), it.f.end ?? asof, 'STANDARD_DEVIATION', 'סטיית תקן', nf(it.f.sd ?? 0, 2)) }) },
    ...(anyPension ? [
      { key: 'act', label: 'איזון אקטוארי, רבעון אחרון', tip: 'actuarial', cells: (it: Item) => (isPension(it.f) && it.f.act != null ? { v: it.f.act, t: `${iso(pc2(it.f.act))} · ${iso(ym(it.f.act_p ?? asof))}`, src: () => actProv(it.f), txt: true } : { v: null, t: isPension(it.f) ? 'לא דווח' : '–' }) },
      { key: 'dflt', label: 'קרן ברירת מחדל', tip: 'default', cells: (it: Item) => { if (!isPension(it.f)) return { v: null, t: '–' }; const dn = defaultNow(it.f.k, dfile, asof); return dn ? { v: null, t: `כן · ${iso(periodText(dn.t))}`, sub: `${iso(pc2(dn.depfee))} / ${iso(pc2(dn.fee))}`, src: () => tenderProv(dn.t, 'קרן ברירת מחדל', `${pc2(dn.depfee)} / ${pc2(dn.fee)}`), txt: true } : { v: null, t: dfile ? 'לא' : '–' }; } },
      // W2: the company's service index (the regulator's, 2025) and its own claims report
      { key: 'svc', label: 'מדד השירות 2025 (החברה)', tip: 'svcidx', cells: (it: Item) => (isPension(it.f) ? svcCell(dec, it.f) : { v: null, t: '–' }) },
      { key: 'clm', label: 'תביעות נכות שאושרו, דיווח החברה 2025', tip: 'claims', cells: (it: Item) => (isPension(it.f) ? clmCell(dec, it.f.grp) : { v: null, t: '–' }) },
      // W6: the annuity on one projection, by the fund's own coefficient (agent and Pro only: O10)
      { key: 'annM', label: `קצבה חודשית בגיל ${RETIRE_AGE}, גבר, אומדן`, cells: (it: Item) => annuityCell(it, 'm') },
      { key: 'annF', label: `קצבה חודשית בגיל ${RETIRE_AGE}, אישה, אומדן`, cells: (it: Item) => annuityCell(it, 'f') },
    ] as KRow[] : []),
  ];
  // the saver's rows leave out the agent's and the analyst's rows and, approved O10, the pension estimate
  const SAVER_OUT = new Set(['y12', 'sharpe', 'sd', 'age', 'annM', 'annF', 'act']);
  const shown = mode === 'saver' ? rows.filter((r) => !SAVER_OUT.has(r.key)) : rows;
  const summary: CmpSummary = compareSummary(items.map((it) => ({ k: it.f.k, name: it.f.name, prod: it.f.prod, track: it.f.track, cat: catKey(it.f), fee: it.f.fee, depfee: it.f.depfee, r5: d.kret(it, 'a5').v, sharpe: sharpeOf(it.f), st: it.f.st, old: isOldGen(it.f) })));
  const ROW_LEAD: Record<string, 'fee' | 'depfee' | 'r5' | 'sharpe'> = { fee: 'fee', depfee: 'depfee', a5: 'r5', sharpe: 'sharpe' };
  const isLead = (row: string, k: string) => { const m = ROW_LEAD[row]; if (!m) return false; const c = summary.cats.find((x) => x.ks.includes(k)); const l = c?.[m]; return !!l && !l.all && l.ks.includes(k); };
  return { rows, shown, row: (key) => rows.find((r) => r.key === key), summary, isLead, anyPension, axis, dfile, dec };
}

/** The agent's tools: the client document (/funds/compare/print, unchanged), the Excel pack, the client folder (W3). */
export function ClientActions({ d, kp }: { d: CompareData; kp: KpiRows }) {
  const loc = useLocation();
  const [clients] = useClients();
  const [folderId, setFolderId] = useState<string | null>(() => folderOfState(loc.state));
  const folder = folderId ? clients.folders.find((f) => f.id === folderId) ?? null : null;
  const { items, keys, asof, basis, real } = d;
  const printHref = `/funds/compare/print?k=${keys.join(',')}${real ? '&real=1' : ''}`;
  // W4: the figures a client folder freezes (the client document's rows, from the histories on this page)
  const snapNow = () => { const rows = items.map((it) => docRow(it.f, { asof, hist: it.h, dfile: kp.dfile, dec: kp.dec })); return snapOf(rows, bottomLines(rows), todayIso(), asof); };
  return (
    <>
      <div className="cmp-actions">
        <Link className="cmp-doc" to={printHref} state={folder ? { folder: folder.id } : undefined}><Icon name="statement" />{folder?.snap ? 'מסמך ללקוח (הצילום)' : 'מסמך ללקוח'}</Link>
        <button type="button" className="chip fpack" onClick={() => void exportPack(d)}><Icon name="download" /> Excel: חבילת השוואה (נוסחאות חיות)</button>
        <span className="cmp-bl-note">מסמך A4 עם נספח הנמקה; שם הלקוח והסוכן נשארים בדפדפן הזה.</span>
      </div>
      <div className="cmp-actions">
        {folder && <span className="cmp-folder">תיק: <b>{folder.label}</b>{folder.snap && <span className="muted"> · צילום מ-{dmyIso(folder.snap.at)}, נתונים עד {ym(folder.snap.asof)}. כאן: נתוני היום</span>}</span>}
        <ClientSave keys={keys} b={basis} folder={folder} onSaved={(f) => setFolderId(f.id)} busy={items.length < keys.length - d.unknown.length} collect={() => ({ snap: snapNow() })} />
      </div>
    </>
  );
}

/** the compare pack (plan #22): per track the monthly gross return and the published fee, indices and drawdowns; a summary; sources */
export async function exportPack(d: CompareData) {
  const [{ downloadXlsxAsync }, { comparePack, fillFee }] = await Promise.all([import('../../lib/xlsx'), import('../../lib/fundsPack')]);
  const ts = d.items.map((it) => { const ff = fillFee(it.h.fee);
    return { k: it.f.k, name: it.f.name, mgr: it.f.mgr, grp: it.f.grp, prod: it.f.prod, track: it.f.track, p: it.h.p, y: it.h.y, fee: ff.fee, filled: ff.filled, feeNow: it.f.fee, depfee: it.f.depfee, assets: it.f.assets, gone: it.f.gone, end: it.f.end }; });
  await downloadXlsxAsync(`השוואת-מסלולים-${ym(d.asof).replace('/', '-')}.xlsx`, comparePack(ts, d.asof), { title: 'השוואת מסלולים', author: '' });
}

/** The descriptive bottom line (W1/W4): one tile per measure, inside one category; ties shared, never crowned. `mode` saver drops Sharpe. */
export function BottomLinePanel({ d, kp, mode, actions }: { d: CompareData; kp: KpiRows; mode: Mode; actions?: ReactNode }) {
  const { items, asof, lbl, real } = d, { summary } = kp, saver = mode === 'saver';
  const who = (l: Lead) => l.ks.map((k) => <span key={k} className="cmpn"><i className="sw" style={{ background: d.colorOf(k) }} aria-hidden="true" />{d.nameOf(k)}</span>);
  const outOf = (l: Lead) => `${l.of} מסלולים${l.missing.length ? `; ${l.missing.length} בלי נתון` : ''}`;
  const tile = (key: string, label: string, l: Lead | null, val: (l: Lead) => ReactNode, src?: (l: Lead) => () => Prov) => (
    <div className={`cmp-bl-i${l && l.ks.length > 1 ? ' tie' : ''}`} key={key}>
      <span className="l">{label}</span>
      {!l ? <span className="s">אין נתון לשני מסלולים לפחות</span> : l.all ? <><span className="w">אין הבדל: כל {l.of} המסלולים</span><span className="s">{val(l)}</span></> : <>
        <span className="w">{l.ks.length > 1 && <span className="chip">{saver ? 'כמעט שווים' : 'צמודים'}</span>}{who(l)}</span>
        <span className="s">{src ? <Sourced src={src(l)}>{val(l)}</Sourced> : val(l)} · מתוך {outOf(l)}</span>
      </>}
    </div>
  );
  const itemOf = (k: string) => items.find((it) => it.f.k === k)!;
  const catTiles = (c: CmpSummary['cats'][number]) => [
    tile(`fee:${c.cat}`, LEAD_HE.fee, c.fee, (l) => <span className="num">{pc2(l.v)}</span>, (l) => () => fundP(refOf(itemOf(l.ks[0]).f), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', pc2(l.v))),
    tile(`depfee:${c.cat}`, LEAD_HE.depfee, c.depfee, (l) => <span className="num">{pc2(l.v)}</span>, (l) => () => fundP(refOf(itemOf(l.ks[0]).f), asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', pc2(l.v))),
    tile(`a5:${c.cat}`, `${LEAD_HE.r5} (${lbl})`, c.r5, (l) => <><span className="num">{pc(l.v, 1)}</span>{c.r5?.gap != null && <> · פער מהתשואה הבאה: <span className="num">{nf(c.r5.gap * 100, 0)}</span> נ"ב לשנה</>}</>, (l) => d.kret(itemOf(l.ks[0]), 'a5').src),
    ...(saver ? [] : [tile(`sharpe:${c.cat}`, LEAD_HE.sharpe, c.sharpe, (l) => <span className="num">{nf(l.v, 2)}</span>, (l) => () => fundP(refOf(itemOf(l.ks[0]).f), asof, 'SHARPE_RATIO', 'שארפ', nf(l.v, 2)))]),
  ];
  return (
    <Panel title="השורה התחתונה" aside={<><span className={`chip${real ? ' est' : ''}`}>{lbl}</span><span className="num">{ym(asof)}</span></>}>
      {summary.old && <div className="cmp-old" role="note"><b>ביטוח מנהלים מדור ישן.</b> {OLD_WARN}. <Link to={BM_HREF}>רשימת הבדיקה לביטוחי מנהלים ישנים</Link></div>}
      {summary.cross && <div className="cmp-cross" role="note">
        <p>{CROSS_HE}.</p>
        <ul className="cmp-cross-l">{items.map((it) => <li key={it.f.k}><i className="sw" style={{ background: d.colorOf(it.f.k) }} aria-hidden="true" /><b>{it.f.name}</b><span className="muted">{it.f.prod} · {it.f.track}</span><span>מניות <Sourced src={() => expP(refOf(it.f), it.f.end ?? asof, 'STOCK_MARKET_EXPOSURE', 'חשיפה למניות', it.f.st, it.f.assets)}><span className="num">{it.f.st == null ? '–' : nf(it.f.st, 0) + '%'}</span></Sourced></span><span>5Y <span className="num">{pc(d.kret(it, 'a5').v, 1)}</span></span><span>ד"נ <span className="num">{pc2(it.f.fee)}</span>{isOldGen(it.f) ? ` (${OLD_FEE_HE})` : ''}</span></li>)}</ul>
      </div>}
      {summary.cats.map((c) => (
        <div key={c.cat} className="cmp-bl-cat">
          {(summary.cross || summary.old) && <div className="cmp-bl-cath">באותה קטגוריה: <b>{c.label}</b> · <span className="num">{c.ks.length}</span> מסלולים</div>}
          <div className="cmp-bl">{catTiles(c)}</div>
        </div>
      ))}
      {!summary.cats.length && !summary.cross && !summary.old && <div className="cmp-bl-note">אין שני מסלולים עם נתון להשוואה.</div>}
      <div className="cmp-bl-note">תיאור עובדתי של הנתונים, לא המלצה. השוואה רק בין מסלולים מאותה קטגוריה (אותו מוצר ואותו מסלול השקעה). {TIE_NOTE}. דמי ניהול: הממוצע בפועל של המסלול, לא של חוסך מסוים. {summary.mixed ? 'מוצרים שונים: המיסוי והנזילות שונים. ' : ''}{summary.old ? `${OLD_HE}. ` : ''}</div>
      {actions}
    </Panel>
  );
}

/** The old head-to-head: a table on a wide screen, one card per track on a phone (`phone`). */
export function KpiPanel({ d, kp, mode, phone }: { d: CompareData; kp: KpiRows; mode: Mode; phone: boolean }) {
  const { items, asof, lbl, real } = d, saver = mode === 'saver', { axis } = kp;
  if (phone) return (
    <div className="cmp-cards">
      {items.map((it) => { const dn = isPension(it.f) ? defaultNow(it.f.k, kp.dfile, asof) : null; const fig = (row: string, label: string, c: KCell) => (
        <div key={row}><dt>{label}</dt><dd className={kp.isLead(row, it.f.k) ? 'lead' : undefined}>{c.src && (c.v != null || c.txt) ? <Sourced src={c.src}><span className="num">{c.t}</span></Sourced> : <span className="muted">{c.t}</span>}{c.sub && <span className="dim num"> {c.sub}</span>}</dd></div>);
        const K = (key: string) => kp.row(key)!.cells(it);
        return (
          <article className="cmp-card" key={it.f.k}>
            <div className="cmp-card-h"><i className="sw" style={{ background: d.colorOf(it.f.k) }} aria-hidden="true" /><Link to={`/funds/${it.f.k}`} style={{ flex: 1 }}>{it.f.name}</Link></div>
            <div className="cmp-card-sub"><MgrChip grp={it.f.grp} mgr={it.f.mgr} short /><span>{it.f.prod} · {it.f.track}</span>{dn && <Sourced className="chip pass" src={() => tenderProv(dn.t, 'קרן ברירת מחדל', periodText(dn.t))}>ברירת מחדל</Sourced>}{it.f.gone && <span className="chip est">נסגר</span>}</div>
            <dl>
              {fig('a5', '5Y שנתי', K('a5'))}{fig('a3', '3Y שנתי', K('a3'))}{!saver && fig('y12', 'LTM', K('y12'))}
              {fig('fee', 'ד"נ מצבירה*', K('fee'))}{fig('depfee', 'ד"נ מהפקדה*', K('depfee'))}{saver ? fig('st', 'מניות', K('st')) : fig('sharpe', 'שארפ', K('sharpe'))}
              {!saver && isPension(it.f) && fig('act', 'איזון אקטוארי', { ...K('act'), t: it.f.act == null ? 'לא דווח' : pc2(it.f.act) })}
              {isPension(it.f) && <>{fig('svc', 'מדד השירות', K('svc'))}{fig('clm', 'נכות אושרו', K('clm'))}</>}
              {!saver && isPension(it.f) && <>{fig('annM', 'קצבה, גבר*', K('annM'))}{fig('annF', 'קצבה, אישה*', K('annF'))}</>}
            </dl>
          </article>
        ); })}
      <div className="fnote">* ממוצע בפועל של המסלול. תשואות: {lbl}; 3Y ו-5Y שנתי ממוצע. מסומן: הנמוך או הגבוה בשורה, רק בין מסלולים מאותה קטגוריה.{!saver && kp.anyPension ? ` קצבה: אומדן בגיל ${RETIRE_AGE} על הנחות אחידות, ÷ מקדם ההמרה של הקרן מהתקנון (או הנחה), בשקלי היום.` : ''}</div>
    </div>
  );
  return (
    <Panel title="זה מול זה" aside={<><span className={`chip${real ? ' est' : ''}`}>{lbl}</span><span>● הנמוך או הגבוה בשורה, באותה קטגוריה</span></>}>
      <DataTable<KRow> caption="מדדים זה מול זה" className={`fcmp${items.length >= 5 ? ' many' : ''}`} rows={kp.shown} rowKey={(r) => r.key} export={{ name: `השוואת-מסלולים-${ym(asof).replace('/', '-')}`, title: 'השוואת מסלולים', note: `${lbl} · ${ym(asof)} · רשות שוק ההון` }}
        columns={[{ key: 'm', head: 'מדד', sortable: false, value: (r) => r.label, cell: (r) => <>{r.label}{r.tip && <Tip k={r.tip} />}</> },
          ...items.map((it): Column<KRow> => ({ key: it.f.k, sortable: false, label: it.f.name, value: (r) => r.cells(it).v ?? r.cells(it).t, text: (r) => r.cells(it).t,
            head: <><span className="fcmp-sw" style={{ background: d.colorOf(it.f.k) }} aria-hidden="true" /><Link to={`/funds/${it.f.k}`} className="fcmp-n" title={it.f.name}>{it.f.name}</Link><span className="fcmp-sub"><MgrChip grp={it.f.grp} mgr={it.f.mgr} short /> {it.f.prod} · {it.f.track}{it.f.gone && <span className="chip est">נסגר{it.f.end ? ` ${ym(it.f.end)}` : ''}</span>}</span></>,
            tdClass: (r) => (kp.isLead(r.key, it.f.k) ? 'cmp-best' : undefined), cell: (r) => { const c = r.cells(it); return <>{c.src && (c.v != null || c.txt) ? <Sourced src={c.src}><span className={c.txt ? undefined : 'num'}>{c.t}</span></Sourced> : <span className={c.t === '–' || c.txt === undefined && /[א-ת]/.test(c.t) ? 'muted' : 'num'}>{c.t}</span>}{c.sub && <span className="fcmp-q num" title="דמי הניהול בהליך: מהפקדה / מצבירה">{c.sub}</span>}</>; } }))]} />
      <div className="fnote">ברוטו: לפני דמי ניהול, כפי שפורסם. תנודתיות וירידה מרבית: בחלון המשותף {axis.length > 1 ? `${ym(axis[1])}–${ym(axis[axis.length - 1])}` : ''}{saver ? '.' : '; שארפ וסטיית תקן: כפי שהרשות מפרסמת, לא על החלון כאן.'}{!saver && kp.anyPension ? ` קצבה חודשית: אומדן בגיל ${RETIRE_AGE} על הנחות אחידות לכל המסלולים (יתרה והפקדה לדוגמה, תשואה ${RET_FALLBACK}%), עם דמי הניהול של המסלול, ÷ מקדם ההמרה של הקרן מהתקנון שלה ("לפי מקדם מהתקנון, עמ'") או לפי הנחה; בשקלי היום, לא תחזית.` : ''}</div>
    </Panel>
  );
}

/* ---------------- tax and liquidity (different products) ---------------- */

/** The tax and liquidity rule of each product on screen (lib/productRules); each line opens its sources. */
export function TaxLiqBody({ d }: { d: CompareData }) {
  const { items } = d, rules = rulesOf(items.map((it) => it.f.prod));
  if (!rules.length) return null;
  return (
    <>
      <div className="taxliq">
        {rules.map((r) => (
          <div className="taxliq-r" key={r.key}>
            <div className="n">{r.name}<span className="k">{items.filter((it) => rulesOf([it.f.prod]).some((x) => x.key === r.key)).map((it) => it.f.grp).filter((g, i, a) => a.indexOf(g) === i).join(' · ')}</span></div>
            <div><span className="k">נזילות</span><Sourced src={() => ruleProv(r, 'liq')}>{r.liq}</Sourced></div>
            <div><span className="k">מיסוי · {r.year}</span><Sourced src={() => ruleProv(r, 'tax')}>{r.tax}</Sourced>{r.watch && <span className="chip est" title={r.watch}>שינוי מוצע</span>}</div>
          </div>
        ))}
      </div>
      <div className="fnote">{RULES_NOTE}. כל שורה פותחת את מקורותיה. {items.some((it) => !rulesOf([it.f.prod]).length) ? `ל${[...new Set(items.filter((it) => !rulesOf([it.f.prod]).length).map((it) => it.f.prod))].join(', ')} אין כאן שורה מאומתת.` : ''}</div>
    </>
  );
}
export function TaxLiqPanel({ d }: { d: CompareData }) {
  if (!rulesOf(d.items.map((it) => it.f.prod)).length) return null;
  return <Panel title={<>מיסוי ונזילות <Tip k="taxliq" /></>} aside={<><span className="chip est">כללי, לא ייעוץ מס</span><span>כלל עיקרי לכל מוצר</span></>}><TaxLiqBody d={d} /></Panel>;
}

/* ---------------- charts ---------------- */

export function GrowthPanel({ d, win, aside }: { d: CompareData; win: Win; aside?: ReactNode }) {
  const { open } = useSource();
  const axis = useAxis(d, win);
  const { items, keys, real, lbl, asof, cat, catY, sameCat } = d;
  if (axis.length <= 2) return null;
  const ser = (it: Item) => onAxis(axis, it.h.p, it.y);
  const catSer = catY && cat ? onAxis(axis, cat.p, catY) : null;
  const realNote = real ? ' Real: כל חודש מנוכה בשינוי החודשי של מדד המחירים לצרכן (הלמ"ס).' : '';
  const idxSrc = (it: Item | null, di: number, v: number): Prov => ({ k: 'calc', title: `צמיחה של 100 ש"ח · ${it ? it.f.name : `ממוצע ${items[0].f.track}`} · ${ym(axis[di])}`, value: nf(v, 1),
    formula: `100 × (1 + r₁) × … × (1 + rₙ) על התשואות החודשיות (${lbl}) מ-${ym(axis[1])} עד ${ym(axis[di])}. בסיס: סוף ${ym(axis[0])}.${realNote}`,
    inputs: axis.slice(1, di + 1).map((p) => (it ? d.monthRow(it, p) : { label: `ממוצע הקטגוריה · ${ym(p)}`, v: pc(catY![cat!.p.indexOf(p)]) })) });
  return (
    <Panel title={<>צמיחה של 100 ש"ח <Tip k="growth" /></>} aside={aside ?? <><span>{ym(axis[0])}–{ym(axis[axis.length - 1])}</span><span className="chip">{lbl}</span></>}>
      <Chart label="צמיחה של 100 שח" exportName={`השוואה-צמיחה-${ym(asof).replace('/', '-')}`} height={320} deps={[keys.join(), win, real, items.length, !!catSer]}
        onPoint={(si, di) => { if (di < 1) return; if (si < items.length) { const v = growth(axis, ser(items[si]))[di]; if (v != null) open(idxSrc(items[si], di, v)); } else if (catSer) { const v = growth(axis, catSer)[di]; if (v != null) open(idxSrc(null, di, v)); } }}
        build={() => { const b = chartBase(); return foxOption({ x: axis.map(ym), unit: 'ש"ח', dense: true, scale: true, legend: true,
          series: [...items.map((it) => ({ name: it.f.name, data: growth(axis, ser(it)), kind: 'line' as const, color: d.colorOf(it.f.k), dec: 1 })), ...(catSer ? [{ name: `ממוצע ${items[0].f.track}`, data: growth(axis, catSer), kind: 'line' as const, dashed: true, color: b.mu, dec: 1 }] : [])] }); }} />
      <div className="fnote">{sameCat ? (catSer ? 'קו מקווקו: ממוצע הקטגוריה, משוקלל נכסים.' : '') : ''} בלי הפקדות נוספות; לחיצה על נקודה פותחת את החישוב.</div>
    </Panel>
  );
}

/** B6: a window longer than the shared history draws nothing, so it says so instead of an empty canvas */
export const ROLL_EMPTY = 'אין מספיק חודשים לחלון הזה';
export function RollingPanel({ d, win }: { d: CompareData; win: Win }) {
  const { open } = useSource();
  const axis = useAxis(d, win);
  const [roll, setRoll] = useState<'12' | '36'>('36');
  const { items, keys, real, lbl } = d;
  const ser = (it: Item) => onAxis(axis, it.h.p, it.y);
  const has = items.some((it) => rolling(ser(it), Number(roll)).some((v) => v != null));
  const rollSrc = (it: Item, di: number, v: number, n: number): Prov => ({ k: 'calc', title: `תשואה מתגלגלת ${n} חודשים · ${it.f.name} · ${ym(axis[di])}`, value: pc(v), formula: `${n > 12 ? '((1 + r₁) × … × (1 + rₙ)) בחזקת 12 ÷ n, פחות 1 (שנתי)' : '(1 + r₁) × … × (1 + r₁₂) − 1'} על ${n} החודשים שמסתיימים ב-${ym(axis[di])} (${lbl})`,
    inputs: monthsBack(axis[di], n).map((p) => d.monthRow(it, p)) });
  return (
    <Panel title={<>תשואה מתגלגלת <Tip k="rolling" /></>} aside={<Seg label="חלון מתגלגל" value={roll} onChange={setRoll} options={[['12', '12M'], ['36', '36M, שנתי']]} />}>
      {axis.length <= 2 || !has ? <Empty title={ROLL_EMPTY} icon="chart" /> : (
        <Chart label={`תשואה מתגלגלת ${roll} חודשים`} exportName={`השוואה-מתגלגלת-${roll}`} height={260} deps={[keys.join(), win, roll, real, items.length]}
          onPoint={(si, di) => { const it = items[si]; if (!it) return; const v = rolling(ser(it), Number(roll))[di]; if (v != null) open(rollSrc(it, di, v, Number(roll))); }}
          build={() => foxOption({ x: axis.map(ym), unit: '%', dense: true, full: true, legend: true, series: items.map((it) => ({ name: it.f.name, data: rolling(ser(it), Number(roll)), kind: 'line' as const, pct: true, color: d.colorOf(it.f.k), dec: 1 })) })} />
      )}
    </Panel>
  );
}

export function UnderwaterPanel({ d, win }: { d: CompareData; win: Win }) {
  const { open } = useSource();
  const axis = useAxis(d, win);
  const { items, keys, real, lbl } = d;
  if (axis.length <= 2) return null;
  const ser = (it: Item) => onAxis(axis, it.h.p, it.y);
  const ddSrc = (it: Item, di: number, v: number): Prov => ({ k: 'calc', title: `מתחת לשיא · ${it.f.name} · ${ym(axis[di])}`, value: pc(v), formula: `מדד התשואה המצטברת (${lbl}) חלקי השיא שלפניו בחלון, פחות 1`, inputs: axis.slice(1, di + 1).map((p) => d.monthRow(it, p)) });
  return (
    <Panel title={<>מתחת לשיא <Tip k="underwater" /></>} aside={<span>% מהשיא הקודם בחלון</span>}>
      <Chart label="מתחת לשיא" exportName="השוואה-ירידה-מהשיא" height={260} deps={[keys.join(), win, real, items.length]}
        onPoint={(si, di) => { const it = items[si]; if (!it) return; const v = underwater(ser(it).slice(1))[di - 1]; if (v != null && di > 0) open(ddSrc(it, di, v)); }}
        build={() => foxOption({ x: axis.map(ym), unit: '%', dense: true, full: true, legend: true, series: items.map((it) => ({ name: it.f.name, data: [0, ...underwater(ser(it).slice(1))], kind: 'line' as const, pct: true, area: items.length === 1, color: d.colorOf(it.f.k), dec: 1 })) })} />
    </Panel>
  );
}

/* ---------------- calendar years and the pairwise windows ---------------- */

type YRow = { y: number };
export function YearsPanel({ d }: { d: CompareData }) {
  const { items, lbl, asof } = d;
  const yrs = items.map((it) => byYear(it.h.p, it.y));
  const years = [...new Set(yrs.flatMap((m) => [...m.keys()]))].sort((a, b) => b - a).slice(0, 12);
  return (
    <Panel title="לפי שנה" aside={<span className="chip">{lbl} · ריבית דריבית</span>}>
      <DataTable<YRow> caption="תשואה לפי שנה" rows={years.map((y) => ({ y }))} rowKey={(r) => String(r.y)} export={{ name: `השוואה-לפי-שנה-${ym(asof).replace('/', '-')}`, title: 'תשואה לפי שנה', note: `${lbl} · רשות שוק ההון` }}
        columns={[{ key: 'y', head: 'שנה', value: (r) => r.y, cell: (r) => <span className="num">{r.y}</span> }, ...items.map((it, i): Column<YRow> => ({ key: it.f.k, label: it.f.name, title: it.f.name, head: <><span className="fcmp-sw" style={{ background: d.colorOf(it.f.k) }} aria-hidden="true" />{shortName(it.f.name)}</>, value: (r) => yrs[i].get(r.y)?.r ?? null, unit: 'pct', signed: true, d: 1,
          cell: (r) => { const e = yrs[i].get(r.y); if (!e) return <span className="muted">–</span>; return <><Sourced src={() => ({ k: 'calc', title: `תשואה ${r.y} · ${it.f.name}`, value: pc(e.r), formula: `ריבית דריבית על התשואות החודשיות של השנה (${lbl})`, inputs: e.ps.map((p) => d.monthRow(it, p)) })}><span className="num">{pc(e.r, 1)}</span></Sourced>{e.n < 12 && <span className="dim num">{e.n} ח׳</span>}</>; } }))]} />
    </Panel>
  );
}

/** Pair win rates over rolling 36 (and 12) months: Pro "who won"; agent in neutral words behind a disclosure. */
export function PairsPanel({ d, mode }: { d: CompareData; mode: Exclude<Mode, 'saver'> }) {
  const { items, lbl, sameCat } = d;
  const pairs = items.flatMap((a, i) => items.slice(i + 1).map((b) => ({ a, b })));
  const align = (it: Item, ax: number[]) => onAxis(ax, it.h.p, it.y);
  const wrSrc = (a: Item, b: Item, n: number, w: ReturnType<typeof winRate>, ax: number[]): Prov => ({ k: 'calc', title: `${mode === 'pro' ? 'שיעור ניצחון' : 'חלונות שבהם הראשון גבוה יותר'} ${n} חודשים · ${a.f.name} מול ${b.f.name}`, value: w.of ? `${nf(w.won / w.of * 100, 0)}%` : '–',
    formula: `בכמה מחלונות ${n} החודשים המתגלגלים, שבהם לשני המסלולים יש כל התשואות החודשיות (${lbl}), התשואה המצטברת של הראשון הייתה גבוהה יותר`,
    inputs: [{ label: 'חלונות שבהם הראשון גבוה יותר', v: nf(w.won, 0) }, { label: 'חלונות משותפים', v: nf(w.of, 0) }, ...(w.first != null ? [{ label: 'החלון הראשון מסתיים', v: ym(ax[w.first]) }, { label: 'החלון האחרון מסתיים', v: ym(ax[w.last!]) }] : [])] });
  const pairHead = mode === 'pro' ? ['מסלול', 'מול', '36M', '12M'] : ['מסלול א', 'מסלול ב', 'א גבוה מ-ב, 36M', '12M'];
  const table = pairs.length === 0 ? <Empty title="הוסיפו מסלול שני" /> : (
    <div className="scroll"><table className="fsimple">
      <thead><tr>{pairHead.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{pairs.map(({ a, b }) => { const ax = [...new Set([...a.h.p, ...b.h.p])].sort((x, y) => x - y), ya = align(a, ax), yb = align(b, ax), w36 = winRate(ya, yb, 36), w12 = winRate(ya, yb, 12);
        const show = (w: typeof w36, n: number) => (w.of ? <Sourced src={() => wrSrc(a, b, n, w, ax)}><span className="num">{nf(w.won / w.of * 100, 0)}%</span></Sourced> : <span className="muted">–</span>);
        return <tr key={a.f.k + b.f.k}><td title={a.f.name}>{shortName(a.f.name)}</td><td className="muted" title={b.f.name}>{shortName(b.f.name)}</td><td>{show(w36, 36)}<span className="dim num"> מתוך {w36.of}</span></td><td>{show(w12, 12)}</td></tr>; })}</tbody>
    </table></div>
  );
  if (mode === 'pro') return (
    <Panel title={<>מי ניצח בחלונות של 36 חודשים <Tip k="winrate" /></>} aside={<span>{lbl} · כל ההיסטוריה המשותפת</span>}>
      {table}
      <div className="fnote">"61%": המסלול הראשון השיג יותר מהשני ב-61% מחלונות 36 החודשים המשותפים. עובדה היסטורית, לא תחזית.</div>
    </Panel>
  );
  return (
    <Panel title="חלונות מתגלגלים, זוג מול זוג" aside={<span>{lbl} · כל ההיסטוריה המשותפת</span>}>
      <details className="cmp-pairs">
        <summary>פער בתשואה בחלונות 36 חודשים: {pairs.length} זוגות <span className="muted">(הצגה)</span></summary>
        {table}
      </details>
      <div className="fnote">בכמה מחלונות 36 (ו-12) החודשים המתגלגלים המשותפים התשואה המצטברת של המסלול הראשון בזוג הייתה גבוהה מזו של השני. עובדה היסטורית, לא תחזית ולא דירוג; {sameCat ? 'כל המסלולים מאותה קטגוריה.' : 'מסלולים מקטגוריות שונות נושאים סיכון שונה, והפער ביניהם אינו השוואה.'}</div>
    </Panel>
  );
}

/** The analyst's risk table (components/FundsTime CompareRisk: drawdown, Sortino, beta, tracking error, capture, best and worst month) */
export const RiskTable = ({ d }: { d: CompareData }) => <CompareRisk items={d.items} cats={d.cats} />;
