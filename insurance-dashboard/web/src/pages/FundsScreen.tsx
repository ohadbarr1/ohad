import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BasisToggle, CompareAdd, FundsHead } from '../components/FundsNav';
import { MgrChip } from '../components/MgrChip';
import { Sourced } from '../components/Source';
import { Sheet } from '../components/Sheet';
import { Tip } from '../components/Explain';
import { Empty, ErrorBox, Field, Loading, Panel, Pick, Seg } from '../components/ui';
import { countP, expP, fundP, listP } from '../lib/market';
import type { Prov } from '../lib/prov';
import { useMacro } from '../lib/macro';
import { nf, pubLabel } from '../lib/format';
import { useStored } from '../lib/local';
import { usePhone } from '../lib/useMedia';
import { load, useFunds } from '../lib/useData';
import {
  FAMS, FAM_F, FAM_LABEL, GROSS_LABEL, NET_LABEL, PCT_F, PERIODS, PER_LABEL, catKey, equityOutlier, equitySpread, famOf, hasNet, outlierProv, pc, rankAll, realOf, refOf,
  retOf, selfDirected, SELF_NOTE, shownProv, useBasis, useReal, ym, type Basis, type FamKey, type FundX, type FundsFile, type Per,
} from '../lib/funds';
import { DEFAULT_PER, TIE_F, TIE_NOTE, rankText, tieBand, tieRanks } from '../lib/fundsTie';
import { useOptional } from '../lib/fundsLoad';
import type { DefaultFile } from '../lib/fundsTools';
import { defaultKeys, defaultNow, isPension, periodText } from '../lib/pensionPack';
import { DECISION_PATH, svcOf, svcProv, type DecisionFile } from '../lib/decision';  // W2
import { actProv, pc2, tenderProv } from '../lib/agentProv';
import '../components/agent/glossary';
import '../styles/lens.css';
import '../styles/market.css';

/* /funds/screen, the screener 2.0 (funds plan #2, #3, #6): every track the regulator publishes, filtered across products by what a
   track holds as well as what it is called, ranked inside its own category on one stated window and basis. Phone: one card per track.
   Saved screens live in this browser. The rank and the percentile are always among the tracks of the category on screen (open to the
   public unless the reader includes the closed ones); filters hide rows without changing a rank. */

const PRODUCTS = ['השתלמות', 'גמל', 'גמל להשקעה', 'חיסכון לילד', 'פנסיה מקיפה', 'פנסיה כללית', 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)', 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים', 'ביטוחי מנהלים 1992-2003', 'ביטוחי מנהלים 1990-1991', 'מרכזית לפיצויים', 'גמל, מטרה אחרת'];
const ALL = 'all';
type ColKey = 'pct' | 'm1' | 'ytd' | 'y12' | 'a3' | 'a5' | 'fee' | 'depfee' | 'assets' | 'sharpe' | 'sd' | 'alpha' | 'st' | 'fo' | 'fx' | 'liq' | 'age' | 'top' | 'act' | 'svc';
const COLS: [ColKey, string][] = [['pct', 'אחוזון'], ['m1', '1M'], ['ytd', 'YTD'], ['y12', 'LTM'], ['a3', '3Y'], ['a5', '5Y'], ['fee', 'ד"נ מצבירה'], ['depfee', 'ד"נ מהפקדה'], ['assets', 'נכסים'], ['sharpe', 'שארפ'], ['sd', 'סטיית תקן'], ['alpha', 'אלפא'], ['st', 'מניות'], ['fo', 'חו"ל'], ['fx', 'מט"ח'], ['liq', 'נזיל'], ['age', 'ותק'], ['top', 'רבע עליון'], ['act', 'איזון אקטוארי'], ['svc', 'מדד שירות']];  // act: W1-agent, svc: W2, pension only
const COL_LABEL = Object.fromEntries(COLS) as Record<ColKey, string>;
const DEFAULT_COLS: ColKey[] = ['pct', 'y12', 'a3', 'a5', 'fee', 'assets', 'sharpe', 'st', 'top'];
/** W1-agent: a pension product opens with its decision columns (both fees, the actuarial balance) */
const PENSION_COLS: ColKey[] = ['pct', 'y12', 'a3', 'a5', 'fee', 'depfee', 'act', 'svc', 'assets', 'sharpe', 'st'];
const isPenProd = (p: string) => /^פנסיה/.test(p);
const TIP: Partial<Record<ColKey, string>> = { pct: 'pct', fee: 'fee', depfee: 'depfee', sharpe: 'sharpe', sd: 'sd', alpha: 'alpha', st: 'equity', act: 'actuarial', svc: 'svcidx' };
const RET = new Set<ColKey>(['m1', 'ytd', 'y12', 'a3', 'a5']);
const EXP = { st: ['STOCK_MARKET_EXPOSURE', 'חשיפה למניות'], fo: ['FOREIGN_EXPOSURE', 'חשיפה לחו"ל'], fx: ['FOREIGN_CURRENCY_EXPOSURE', 'חשיפה למט"ח'] } as const;
interface Saved { name: string; qs: string }
/** ordinal rank and percentile (rankAll) plus the shared place inside the tie band (lo–hi) */
type RankInfo = { rank: number; n: number; pct: number | null; lo: number; hi: number };
/** the fee columns: the regulator's average actual fee of the track, not a quote */
const FEE_SUB: Partial<Record<ColKey, string>> = { fee: 'ממוצע בפועל', depfee: 'ממוצע בפועל', act: 'רבעון אחרון', svc: 'הרשות, 2025' };

const yearsOf = (f: FundX, asof: number) => (f.since ? (Math.floor(asof / 100) + (asof % 100) / 12) - (Number(f.since.slice(0, 4)) + Number(f.since.slice(5, 7)) / 12) : null);

export function FundsScreen() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cpi = useMacro().data?.series.cpi;
  const [sp, setSp] = useSearchParams();
  const phone = usePhone();
  const [basisAsked] = useBasis();
  const [real] = useReal();
  const netOk = useMemo(() => hasNet(data?.funds ?? []), [data]);
  const basis: Basis = basisAsked === 'net' && netOk ? 'net' : 'gross';
  const set = (patch: Record<string, string | null>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setSp(n, { replace: true }); };
  const num = (k: string) => { const v = sp.get(k); return v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
  // the old /funds?q= links and the search palette: open the product and track of the first match
  const q = sp.get('q') ?? '';
  const hit = !sp.get('prod') && q ? data?.funds.find((f) => f.name.includes(q.trim())) : undefined;
  const prod = sp.get('prod') ?? hit?.prod ?? 'השתלמות';
  const perRaw = sp.get('per') ?? sp.get('win') ?? DEFAULT_PER;
  const per: Per = (PERIODS.some(([k]) => k === perRaw) ? perRaw : DEFAULT_PER) as Per;
  const fams = (sp.get('fam') ?? '').split(',').filter((x): x is FamKey => FAMS.some(([k]) => k === x));
  const mk = sp.get('mk') ?? '';
  const closed = sp.get('closed') === '1', gone = sp.get('gone') === '1', outOnly = sp.get('out') === '1';
  const F = { fmax: num('fmax'), dmax: num('dmax'), amin: num('amin'), smin: num('smin'), hist: num('hist'), eqmin: num('eqmin'), eqmax: num('eqmax') };
  const colsQ = (sp.get('cols') ?? '').split(',').filter((x): x is ColKey => COLS.some(([k]) => k === x));
  const baseCols = isPenProd(prod) ? PENSION_COLS : DEFAULT_COLS;
  const cols: ColKey[] = colsQ.length ? colsQ : baseCols;
  // W1-agent: the default funds (קרנות ברירת מחדל) of the tender in force; `df=1` keeps only them
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dfOnly = sp.get('df') === '1';
  const dec = useOptional<DecisionFile>(DECISION_PATH);  // W2: the service index column (pension)
  const [open, setOpen] = useState<string[]>([]);
  const [opts, setOpts] = useState(false);
  const [saved, setSaved] = useStored<Saved[]>('funds:screens', []);
  const [naming, setNaming] = useState<string | null>(null);

  // closed (ceased) tracks: a separate file, loaded only when asked
  const [goneRows, setGoneRows] = useState<FundX[] | null>(null);
  useEffect(() => { if (gone && !goneRows) load<{ funds: FundX[] }>('funds/closed.json').then((d) => setGoneRows((d.funds ?? []).map((f) => ({ ...f, gone: true }))), () => setGoneRows([])); }, [gone, goneRows]);

  const all = useMemo(() => (data?.funds ?? []).filter((f) => f.assets !== 0).map((f) => (f.sd != null && f.sd > 0 ? f : { ...f, sharpe: null })), [data]);
  const spread = useMemo(() => equitySpread(all.filter((f) => !f.closed)), [all]);
  const prods = PRODUCTS.filter((p) => all.some((f) => f.prod === p));
  const inProd = (f: FundX) => prod === ALL || f.prod === prod;
  const tracks = useMemo(() => { const m = new Map<string, number>(); all.filter(inProd).forEach((f) => m.set(f.track, (m.get(f.track) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [all, prod]);  // eslint-disable-line react-hooks/exhaustive-deps
  const trackQ = sp.get('track') ?? hit?.track ?? (prod === ALL ? ALL : 'כללי');
  const T = trackQ === ALL || tracks.some(([t]) => t === trackQ) ? trackQ : tracks[0]?.[0] ?? ALL;
  const groupsAll = useMemo(() => [...new Set(all.map((f) => f.grp))].sort((a, b) => a.localeCompare(b, 'he')), [all]);
  const asof = data?.asof ?? 0;
  const dfKeys = useMemo(() => defaultKeys(dfile, asof), [dfile, asof]);
  const val = (f: FundX, p: Per) => (real ? realOf(f, p, basis, asof, cpi).v : retOf(f, p, basis).v);

  const screened = (f: FundX) => {
    const t = q.trim();
    if (t && !(f.name.includes(t) || f.mgr.includes(t) || f.grp.includes(t))) return false;
    if (fams.length && !fams.includes(famOf(f.track))) return false;
    if (mk && f.grp !== mk) return false;
    if (F.fmax != null && !(f.fee != null && f.fee <= F.fmax)) return false;
    if (F.dmax != null && !(f.depfee != null && f.depfee <= F.dmax)) return false;
    if (F.amin != null && !(f.assets != null && f.assets >= F.amin)) return false;
    if (F.smin != null && !(f.sharpe != null && f.sharpe >= F.smin)) return false;
    if (F.hist != null && !(f.n >= F.hist * 12)) return false;
    if (F.eqmin != null && !(f.st != null && f.st >= F.eqmin)) return false;
    if (F.eqmax != null && !(f.st != null && f.st <= F.eqmax)) return false;
    if (outOnly && !equityOutlier(f, spread)) return false;
    if (dfOnly && !dfKeys.has(f.k)) return false;
    return true;
  };
  const sortKey = (sp.get('s') ?? '') as ColKey | '';
  const groups = useMemo(() => {
    const keys = new Map<string, FundX[]>();
    all.filter((f) => inProd(f) && (T === ALL || f.track === T) && (closed || !f.closed)).forEach((f) => keys.set(catKey(f), [...(keys.get(catKey(f)) ?? []), f]));
    if (gone && goneRows) goneRows.filter((f) => inProd(f) && (T === ALL || f.track === T)).forEach((f) => { if (keys.has(catKey(f)) || T !== ALL) keys.set(catKey(f), [...(keys.get(catKey(f)) ?? []), f]); });
    return [...keys.entries()].map(([k, shown]) => {
      const peers = shown.filter((f) => !f.gone && !selfDirected(f));
      const ord = rankAll(peers, (f) => val(f, per)), tie = tieRanks(peers, (f) => val(f, per), tieBand(per, asof));
      const rk = new Map<string, RankInfo>([...ord].map(([k, r]) => [k, { ...r, lo: tie.get(k)?.lo ?? r.rank, hi: tie.get(k)?.hi ?? r.rank }]));
      const by = sortKey && sortKey !== 'pct' ? sortKey : null;
      const sv = (f: FundX): number | null => (by == null ? null : RET.has(by) ? val(f, by as Per) : by === 'age' ? yearsOf(f, asof) : by === 'top' ? f.top : by === 'svc' ? (isPension(f) ? svcOf(dec, f.grp, 'pension')?.total ?? null : null) : (f as unknown as Record<string, number | null>)[by] ?? null);
      const list = shown.filter(screened).sort((a, b) => {
        if (a.gone !== b.gone) return a.gone ? 1 : -1;
        if (by) { const x = sv(a), y = sv(b); if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; return by === 'fee' || by === 'depfee' || by === 'sd' ? x - y : y - x; }
        const ra = rk.get(a.k)?.rank, rb = rk.get(b.k)?.rank; return ra == null || rb == null ? (ra == null ? (rb == null ? 0 : 1) : -1) : ra - rb;
      });
      return { k, prod: shown[0].prod, track: shown[0].track, list, rk, n: rk.size ? [...rk.values()][0].n : 0, assets: peers.reduce((t, f) => t + (f.assets ?? 0), 0) };
    }).filter((g) => g.list.length).sort((a, b) => b.assets - a.assets);
  }, [all, prod, T, closed, gone, goneRows, per, basis, real, cpi, sortKey, q, sp, dfKeys, dec]);  // eslint-disable-line react-hooks/exhaustive-deps
  const shownN = groups.reduce((t, g) => t + g.list.length, 0);
  const multi = groups.length > 1 || T === ALL;
  const nFilters = [q, fams.length ? '1' : '', mk, closed ? '1' : '', gone ? '1' : '', outOnly ? '1' : '', dfOnly ? '1' : '', ...Object.values(F).map((v) => (v == null ? '' : '1'))].filter(Boolean).length;

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="מסלולים" />;
  const lbl = real ? `ריאלי${basis === 'net' ? ', נטו' : ''}` : basis === 'net' ? NET_LABEL : GROSS_LABEL;

  /* ---- cells: every figure opens its source ---- */
  const rankSrc = (f: FundX, r: RankInfo): Prov => ({ k: 'calc', title: `מקום לפי ${PER_LABEL[per]} (${lbl}) · ${f.name}`, value: `${rankText(r)} מתוך ${r.n}`,
    formula: `מקום = מספר המסלולים בקטגוריה (אותו מוצר ומסלול) עם תשואה גבוהה יותר בחלון, ועוד 1. ${TIE_F}. מדורגים המסלולים שעל המסך שיש להם תשואה בחלון; סינונים מסתירים שורות ולא משנים מקום`,
    inputs: [{ label: PER_LABEL[per], v: pc(val(f, per)), src: () => shownProv(f, per, basis, real, asof, cpi, data) }, { label: 'מסלולים מדורגים', v: nf(r.n, 0) }, { label: 'צמודים למסלול', v: nf(r.hi - r.lo, 0) }] });
  const pctSrc = (f: FundX, r: RankInfo): Prov => ({ k: 'calc', title: `אחוזון · ${PER_LABEL[per]} (${lbl}) · ${f.name}`, value: r.pct == null ? '–' : nf(r.pct, 0), formula: PCT_F,
    inputs: [{ label: PER_LABEL[per], v: pc(val(f, per)), src: () => shownProv(f, per, basis, real, asof, cpi, data) }, { label: 'מקום', v: `${rankText(r)} מתוך ${r.n}`, src: () => rankSrc(f, r) }] });
  const plain = (f: FundX, col: string, label: string, v: string, unit?: string) => () => fundP(refOf(f), f.end ?? asof, col, label, v, unit);
  const Ret = ({ f, p }: { f: FundX; p: Per }) => {
    const v = val(f, p);
    if (v != null) return <Sourced src={() => shownProv(f, p, basis, real, asof, cpi, data)}><span className="num">{pc(v, p === 'm1' ? 2 : 1)}</span></Sourced>;
    // net asked, the file has net, this track has none for the window: its gross, dimmed and labelled, never ranked with the net figures
    if (basis === 'net' && !real && f[p] != null) return <span className="fgross" title="אין לחלון הזה היסטוריית דמי ניהול: מוצג ברוטו, מחוץ לדירוג"><span className="num muted">{pc(f[p], 1)}</span><span className="chip">ברוטו</span></span>;
    return <span className="muted">–</span>;
  };
  const cell = (f: FundX, c: ColKey, r: RankInfo | undefined): ReactNode => {
    if (RET.has(c)) return <Ret f={f} p={c as Per} />;
    switch (c) {
      case 'pct': return r?.pct == null ? <span className="muted">–</span> : <Sourced src={() => pctSrc(f, r)}><span className="num">{nf(r.pct, 0)}</span></Sourced>;
      case 'fee': return f.fee == null ? <span className="muted">–</span> : <Sourced src={plain(f, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', nf(f.fee, 2) + '%')}><span className="num">{nf(f.fee, 2)}%</span></Sourced>;
      case 'depfee': return f.depfee == null ? <span className="muted">–</span> : <Sourced src={plain(f, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', nf(f.depfee, 2) + '%')}><span className="num">{nf(f.depfee, 2)}%</span></Sourced>;
      case 'assets': return f.assets == null ? <span className="muted">–</span> : <Sourced src={plain(f, 'TOTAL_ASSETS', 'נכסים', nf(f.assets, 1), 'מיליוני ש"ח')}><span className="num">{nf(f.assets, 0)}</span></Sourced>;
      case 'sharpe': return f.sharpe == null ? <span className="muted">–</span> : <Sourced src={plain(f, 'SHARPE_RATIO', 'שארפ', nf(f.sharpe, 2))}><span className="num">{nf(f.sharpe, 2)}</span></Sourced>;
      case 'sd': return f.sd == null ? <span className="muted">–</span> : <Sourced src={plain(f, 'STANDARD_DEVIATION', 'סטיית תקן', nf(f.sd, 2))}><span className="num">{nf(f.sd, 2)}</span></Sourced>;
      case 'alpha': return f.alpha == null ? <span className="muted">–</span> : <Sourced src={plain(f, 'ALPHA', 'אלפא', nf(f.alpha, 2))}><span className="num">{nf(f.alpha, 2)}</span></Sourced>;
      case 'liq': return f.liq == null ? <span className="muted">–</span> : <Sourced src={plain(f, 'LIQUID_ASSETS_PERCENT', 'נכסים נזילים', nf(f.liq, 1) + '%')}><span className="num">{nf(f.liq, 0)}%</span></Sourced>;
      case 'st': case 'fo': case 'fx': { const v = f[c]; if (v == null) return <span className="muted">–</span>; const o = c === 'st' ? equityOutlier(f, spread) : null;
        return <><Sourced src={() => expP(refOf(f), f.end ?? asof, EXP[c][0], EXP[c][1], v, f.assets)}><span className="num">{nf(v, 0)}%</span></Sourced>{o && <Sourced className="chip est fout" src={() => outlierProv(f, o, () => expP(refOf(f), asof, EXP.st[0], EXP.st[1], f.st, f.assets))} title="חשיפה למניות רחוקה מהחציון בקטגוריה">{o.z > 0 ? '▲' : '▼'}</Sourced>}</>; }
      case 'age': { const y = yearsOf(f, asof); return y == null ? <span className="muted">–</span> : <Sourced src={() => ({ k: 'calc', title: `ותק · ${f.name}`, value: `${nf(y, 1)} שנים`, formula: `מועד ההקמה שדווח לרשות (${pubLabel(f.since)}) עד ${ym(asof)}`, inputs: [{ label: 'חודשי היסטוריה עם תשואה', v: nf(f.n, 0) }] })}><span className="num">{nf(y, 0)}</span></Sourced>; }
      case 'act': return !isPension(f) ? <span className="muted">–</span> : f.act == null ? <span className="muted" title="הקרן לא דיווחה איזון אקטוארי לרבעון האחרון">–</span> : <Sourced src={() => actProv(f)} title={`איזון אקטוארי, רבעון ${ym(f.act_p ?? asof)}`}><span className={`num ${f.act < 0 ? 'neg' : f.act > 0 ? 'pos' : ''}`}>{pc2(f.act)}</span></Sourced>;
      case 'svc': { const r = isPension(f) && dec ? svcOf(dec, f.grp, 'pension') : null; return !r ? <span className="muted" title={isPension(f) ? 'החברה אינה במדד השירות לקרנות פנסיה' : 'מדד השירות לקרנות פנסיה'}>–</span> : <Sourced src={() => svcProv(dec!, f.grp, 'pension', 'total')} title={`מדד השירות 2025: ${r.total}, מקום ${r.rank} מתוך ${r.of} (ברמת החברה המנהלת)`}><span className="num">{r.total}</span><span className="dim num"> · {r.rank}/{r.of}</span></Sourced>; }
      case 'top': return f.yrs ? <Sourced src={() => ({ k: 'calc', title: `רבע עליון · ${f.name}`, value: `${f.top}/${f.yrs}`, formula: 'בכמה מהשנים הקלנדריות המלאות מתוך חמש האחרונות תשואת המסלול (ברוטו, ריבית דריבית על 12 תשואות חודשיות) הייתה ברבע העליון של הקטגוריה: מקום ≤ ⌈n÷4⌉, בקטגוריה של 4 מסלולים לפחות', inputs: [{ label: 'שנים ברבע העליון', v: nf(f.top ?? 0, 0) }, { label: 'שנים שנבדקו', v: nf(f.yrs ?? 0, 0) }], note: 'מחושב בבניית הנתונים מתשואות חברי הקטגוריה' })}><span className="num">{f.top}/{f.yrs}</span></Sourced> : <span className="muted">–</span>;
    }
    return null;
  };
  const Flags = ({ f }: { f: FundX }) => <>
    {f.closed && <span className="chip">ענפית</span>}
    {f.gone && <span className="chip est">נסגר{f.end ? ` ${ym(f.end)}` : ''}</span>}
    {selfDirected(f) && <span className="chip" title={SELF_NOTE}>ניהול אישי</span>}
    {f.n < 60 && !f.gone && <span className="chip" title="פחות מ-60 חודשי היסטוריה: אין 5Y">היסטוריה קצרה</span>}
    {dfKeys.has(f.k) && (() => { const d = defaultNow(f.k, dfile, asof); return d ? <Sourced className="chip pass" src={() => tenderProv(d.t, 'קרן ברירת מחדל', `${pc2(d.depfee)} / ${pc2(d.fee)}`)} title={`קרן ברירת מחדל ${periodText(d.t)}: ${pc2(d.depfee)} מהפקדה, ${pc2(d.fee)} מצבירה`}>ברירת מחדל</Sourced> : null; })()}
    {f.tx?.dis && <span className="chip est" title={`הסיווג הרשמי (transfer_bank): ${[f.tx.type, f.tx.spec, f.tx.sub].filter(Boolean).join(' · ')}`}>סיווג רשמי שונה</span>}
  </>;
  const CatHead = ({ g }: { g: (typeof groups)[number] }) => (
    <span className="fcat-h"><b>{prod === ALL ? `${g.prod} · ` : ''}{g.track}</b><span className="chip" title={FAM_F}>{FAM_LABEL[famOf(g.track)]}</span>
      <span className="muted"><Sourced src={() => countP(`מסלולים · ${g.k}`, g.list.length, 'המסלולים המוצגים בקטגוריה')}><span className="num">{g.list.length}</span></Sourced> מסלולים · <Sourced src={() => listP(`נכסים · ${g.k}`, nf(g.assets, 0), 'מיליוני ש"ח', 'סכום TOTAL_ASSETS של המסלולים המדורגים בקטגוריה', g.list.filter((f) => f.assets != null && !f.gone).map((f) => ({ label: f.name, v: nf(f.assets!, 1), src: plain(f, 'TOTAL_ASSETS', 'נכסים', nf(f.assets!, 1), 'מיליוני ש"ח') })))}><span className="num">{nf(g.assets / 1000, 1)}</span></Sourced> מיליארד ש"ח</span></span>
  );

  /* ---- controls ---- */
  const famChip = (k: FamKey) => <button key={k} type="button" className="chip" aria-pressed={fams.includes(k)} onClick={() => set({ fam: (fams.includes(k) ? fams.filter((x) => x !== k) : [...fams, k]).join(',') || null })}>{FAM_LABEL[k]}</button>;
  const numIn = (k: keyof typeof F, label: string, unit: string, step: string) => (
    <label className="fnum">{label} <input type="number" inputMode="decimal" step={step} value={F[k] ?? ''} onChange={(e) => set({ [k]: e.target.value === '' ? null : e.target.value })} aria-label={`${label} ${unit}`} />{unit}</label>
  );
  const Options = (
    <div className="fopts">
      <Field label="חיפוש"><input type="search" value={q} onChange={(e) => set({ q: e.target.value || null })} placeholder="שם מסלול או גוף" /></Field>
      <div className="field"><span>משפחת מסלול <Tip k="family" /></span><div className="fchips">{FAMS.map(([k]) => famChip(k))}</div></div>
      <div className="field"><span>גוף מנהל</span><Pick label="גוף מנהל" value={mk || ALL} onChange={(v) => set({ mk: v === ALL ? null : v })} options={[[ALL, 'כל הגופים'], ...groupsAll.map((g) => [g, g] as [string, string])]} /></div>
      <div className="field"><span>סינון{nFilters > 0 && <button type="button" className="linkbtn" onClick={() => { const n = new URLSearchParams(); ['prod', 'track', 'per', 'b', 'cols', 'real'].forEach((k) => { const v = sp.get(k); if (v) n.set(k, v); }); setSp(n, { replace: true }); }}>ניקוי</button>}</span>
        <div className="fnums">
          {numIn('eqmin', 'מניות מ-', '%', '5')}{numIn('eqmax', 'מניות עד', '%', '5')}
          {numIn('fmax', 'ד"נ מצבירה עד', '%', '0.05')}{numIn('dmax', 'ד"נ מהפקדה עד', '%', '0.1')}
          {numIn('amin', 'נכסים מ-', 'מ׳ ש"ח', '100')}{numIn('smin', 'שארפ מ-', '', '0.1')}{numIn('hist', 'היסטוריה מ-', 'שנים', '1')}
        </div></div>
      <div className="fchips">
        <button type="button" className="chip" aria-pressed={outOnly} onClick={() => set({ out: outOnly ? null : '1' })}>רק תווית מול מציאות</button><Tip k="outlier" />
        <button type="button" className="chip" aria-pressed={closed} onClick={() => set({ closed: closed ? null : '1' })}>כולל קופות ענפיות</button><Tip k="closed" />
        <button type="button" className="chip" aria-pressed={gone} onClick={() => set({ gone: gone ? null : '1' })}>כולל מסלולים שנסגרו</button>
      </div>
      {!phone && <div className="field"><span>עמודות</span><div className="fchips">{COLS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={cols.includes(k)} onClick={() => { const next = cols.includes(k) ? cols.filter((x) => x !== k) : COLS.map(([x]) => x).filter((x) => cols.includes(x) || x === k); set({ cols: next.join(',') === baseCols.join(',') ? null : next.join(',') }); }}>{l}</button>)}</div></div>}
      <div className="field"><span>סינונים שמורים <span className="muted">· בדפדפן הזה בלבד</span></span>
        <div className="fchips">
          {saved.map((s) => <span key={s.name} className="fsaved"><Link className="chip" to={`/funds/screen?${s.qs}`}>{s.name}</Link><button type="button" className="fsaved-x" aria-label={`מחיקת הסינון ${s.name}`} onClick={() => setSaved(saved.filter((x) => x.name !== s.name))}>×</button></span>)}
          {naming == null ? <button type="button" className="chip" onClick={() => setNaming('')}>+ שמירת הסינון הזה</button> : (
            <form className="fsave" onSubmit={(e) => { e.preventDefault(); const n = naming.trim(); if (!n) return; setSaved([...saved.filter((x) => x.name !== n), { name: n, qs: sp.toString() }]); setNaming(null); }}>
              <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="שם לסינון" aria-label="שם לסינון" maxLength={40} /><button type="submit" className="chip">שמירה</button><button type="button" className="chip" onClick={() => setNaming(null)}>ביטול</button>
            </form>
          )}
        </div></div>
    </div>
  );
  const tools = <>
    <Pick label="מוצר" value={prod} onChange={(p) => set({ prod: p, track: null })} options={[[ALL, 'כל המוצרים'], ...prods.map((p) => [p, p] as [string, string])]} />
    <Pick label="מסלול" className="trackpick" value={T} onChange={(t) => set({ track: t })} options={[[ALL, 'כל המסלולים', nf(tracks.reduce((u, [, c]) => u + c, 0), 0)], ...tracks.map(([t, c]) => [t, t, nf(c, 0)] as [string, string, string])]} />
    {isPenProd(prod) && <button type="button" className="chip" aria-pressed={dfOnly} onClick={() => set({ df: dfOnly ? null : '1' })} title="קרנות שנבחרו בהליך שבתוקף כקרנות ברירת מחדל">ברירת מחדל</button>}
    {!phone && <Seg label="דירוג לפי" value={per} onChange={(v) => set({ per: v, win: null })} options={PERIODS} />}
    <button type="button" className={`btn${opts ? ' primary' : ''}`} aria-expanded={opts} onClick={() => setOpts((v) => !v)}>{phone ? `${PERIODS.find(([k]) => k === per)?.[1]} · ${lbl}${nFilters ? ` · ${nFilters}` : ''}` : `סינון${nFilters ? ` · ${nFilters}` : ''}`}</button>
  </>;

  const shown = (g: (typeof groups)[number]) => !multi || open.includes(g.k) || groups.length <= 2;
  return (
    <>
      <FundsHead sub={<>מסלולים · <Sourced src={() => countP('מסלולים מוצגים', shownN, 'המסלולים שעוברים את הסינון')}><span className="num">{nf(shownN, 0)}</span></Sourced> מסלולים · {ym(asof)} · {data.source}</>} tools={<>{tools}{!phone && <BasisToggle netReady={netOk} />}</>} />
      {phone ? <Sheet open={opts} onClose={() => setOpts(false)} title="דירוג וסינון"><div className="fopts"><div className="field"><span>דירוג לפי</span><Seg label="דירוג לפי" value={per} onChange={(v) => set({ per: v, win: null })} options={PERIODS} /></div><div className="field"><span>בסיס</span><BasisToggle netReady={netOk} /></div>{Options}</div></Sheet> : opts && <section className="controls opts">{Options}</section>}

      <Panel title={<>{prod === ALL ? 'כל המוצרים' : prod} · {T === ALL ? 'כל המסלולים' : T}</>} aside={<>
        {multi && groups.length > 2 && <button type="button" className="chip" onClick={() => setOpen(open.length ? [] : groups.map((g) => g.k))}>{open.length ? 'כווץ הכול' : 'פתח הכול'}</button>}
        <span className={`chip${basis === 'net' || real ? ' est' : ''}`}>{lbl}</span><span className="chip">3Y ו-5Y: שנתי ממוצע</span>
        {prod === 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)' && <span className="chip est" title="ביטוח-נט מפרסם מסלולי השקעה. פוליסת חיסכון וביטוח מנהלים שהונפק מ-2004 מושקעים באותו מסלול, ולכן התשואה זהה; הנכסים ודמי הניהול הממוצעים כוללים את שני המוצרים">מסלול משותף לשני המוצרים</span>}
      </>}>
        {groups.length === 0 ? <Empty title="אין מסלולים בסינון הזה">{nFilters > 0 && 'נסו לנקות חלק מהסינונים.'}</Empty> : phone ? (
          <div className="fcards">
            {groups.map((g) => (
              <Fragment key={g.k}>
                {multi && <div className="fcards-h"><button type="button" className="twist" aria-expanded={shown(g)} aria-label={shown(g) ? `כווץ את ${g.k}` : `פתח את ${g.k}`} onClick={() => setOpen(open.includes(g.k) ? open.filter((x) => x !== g.k) : [...open, g.k])}>{shown(g) ? '▾' : '◂'}</button><CatHead g={g} /></div>}
                {shown(g) && g.list.map((f) => { const r = g.rk.get(f.k); return (
                  <article className={`fcard${f.gone ? ' gone' : ''}`} key={f.k}>
                    <div className="fcard-top"><Link className="name" to={`/funds/${f.k}`}>{f.name}</Link><CompareAdd k={f.k} name={f.name} small /></div>
                    <div className="fcard-meta"><MgrChip grp={f.grp} mgr={f.mgr} short /><Flags f={f} /></div>
                    <div className="fcard-fig">
                      <div className="big"><span className="l">{PERIODS.find(([k]) => k === per)?.[1]} · {lbl}</span><Ret f={f} p={per} /></div>
                      <div><span className="l">מקום</span>{r ? <Sourced src={() => rankSrc(f, r)}><span className="num">{rankText(r)}/{r.n}</span></Sourced> : <span className="muted">–</span>}</div>
                      <div><span className="l">אחוזון</span>{cell(f, 'pct', r)}</div>
                      <div><span className="l" title="דמי ניהול מצבירה, הממוצע בפועל של המסלול">ד"נ ממוצע בפועל</span>{cell(f, 'fee', r)}</div>
                      {isPension(f) ? <><div><span className="l" title="דמי ניהול מהפקדה, הממוצע בפועל של המסלול">ד"נ מהפקדה</span>{cell(f, 'depfee', r)}</div><div><span className="l">איזון אקטוארי</span>{cell(f, 'act', r)}</div></> : <div><span className="l">מניות</span>{cell(f, 'st', r)}</div>}
                    </div>
                  </article>
                ); })}
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="scroll" style={{ maxHeight: 720 }}><table className="rank fscreen">
            <thead><tr><th>מסלול</th><th>#</th>{cols.map((c) => <th key={c} aria-sort={sortKey === c ? 'descending' : undefined}><button type="button" className="thbtn" onClick={() => set({ s: sortKey === c ? null : c })}>{RET.has(c) && c === per ? <b>{COL_LABEL[c]}</b> : COL_LABEL[c]}{FEE_SUB[c] && <span className="dim">{FEE_SUB[c]}</span>}</button>{TIP[c] && <Tip k={TIP[c]!} />}</th>)}<th><span className="sr-only">השוואה</span></th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.k}>
                  {multi && <tr className="sec grp" onClick={(e) => { if ((e.target as Element).closest('a, button.src')) return; setOpen(open.includes(g.k) ? open.filter((x) => x !== g.k) : [...open, g.k]); }}>
                    <td colSpan={cols.length + 3}><button type="button" className="twist" aria-expanded={shown(g)} aria-label={shown(g) ? `כווץ את ${g.k}` : `פתח את ${g.k}`}>{shown(g) ? '▾' : '◂'}</button><CatHead g={g} /></td></tr>}
                  {shown(g) && g.list.map((f) => { const r = g.rk.get(f.k); return (
                    <tr key={f.k} className={f.gone ? 'gone' : undefined}>
                      <td><span className="fname"><Link className="name" to={`/funds/${f.k}`}>{f.name}</Link><span className="fund-mgr"><MgrChip grp={f.grp} mgr={f.mgr} short /><Flags f={f} /></span></span></td>
                      <td>{r ? <Sourced src={() => rankSrc(f, r)}><span className="num muted">{rankText(r)}</span></Sourced> : <span className="muted">–</span>}</td>
                      {cols.map((c) => <td key={c} className={c === per ? 'lead' : undefined}>{cell(f, c, r)}</td>)}
                      <td>{!f.gone && <CompareAdd k={f.k} name={f.name} small />}</td>
                    </tr>
                  ); })}
                </Fragment>
              ))}
            </tbody>
          </table></div>
        )}
        <div className="fnote">מקום ואחוזון: בתוך הקטגוריה (אותו מוצר ומסלול), על {PER_LABEL[per]} {lbl}; מדורגים מסלולים פתוחים לציבור{closed ? ' וקופות ענפיות' : ''} עם נכסים; מסלול בלי היסטוריה לחלון מוצג "–" ובסוף הקטגוריה. {TIE_NOTE}. ד"נ: הממוצע בפועל של המסלול (הרשות), לא דמי הניהול של חוסך מסוים. {basis === 'net' ? 'נטו: אומדן אחרי דמי ניהול מצבירה; מסלול בלי נטו לחלון מוצג ברוטו ואינו מדורג.' : basisAsked === 'net' ? 'נטו עוד לא נכלל בקובץ הנתונים, ולכן מוצג ברוטו.' : 'ברוטו: לפני דמי ניהול, כפי שהרשות מפרסמת.'} ▲▼ ליד החשיפה למניות: תווית מול מציאות. {real ? `ריאלי: מנוכה במדד המחירים לצרכן (הלמ"ס); המדד בקובץ מכסה ${cpi?.points.length ?? 0} חודשים, וחלון ארוך יותר מוצג "–".` : ''} {gone ? 'מסלולים שנסגרו: הנתונים לחודש האחרון שלהם, מחוץ לדירוג.' : 'ממוצעי הקטגוריה ודירוגים כוללים רק מסלולים פעילים היום.'} {SELF_NOTE}.</div>
      </Panel>
    </>
  );
}
