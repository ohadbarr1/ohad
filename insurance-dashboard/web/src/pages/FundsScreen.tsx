import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BasisToggle, CompareAdd, FundsHead } from '../components/FundsNav';
import { MgrChip } from '../components/MgrChip';
import { Sourced } from '../components/Source';
import { Tip } from '../components/Explain';
import { Empty, ErrorBox, Loading, Panel, Pick, Seg } from '../components/ui';
import { NumText } from '../components/NumText';
import { countP, expP, fundP, listP } from '../lib/market';
import type { Prov } from '../lib/prov';
import { useMacro } from '../lib/macro';
import { nf, pubLabel } from '../lib/format';
import { useStored } from '../lib/local';
import { usePhone } from '../lib/useMedia';
import { load, useFundCats, useFunds } from '../lib/useData';
import {
  FAMS, FAM_F, FAM_LABEL, GROSS_LABEL, PCT_F, PERIODS, PER_LABEL, catKey, equityOutlier, equitySpread, famOf, outlierProv, pc, rankAll, realOf, refOf,
  retOf, selfDirected, SELF_NOTE, shownProv, useReal, ym, type Basis, type CatX, type FamKey, type FundX, type FundsFile, type Per,
} from '../lib/funds';
import { DEFAULT_PER, tieBand } from '../lib/fundsTie';
import { useOptional } from '../lib/fundsLoad';
import { useStatsIndex } from '../lib/fundsTimeLoad';
import { pickSet, slugOf, ymL, type RankFile } from '../lib/fundsTime';
import { rankProv } from '../components/FundsTime';
import type { DefaultFile } from '../lib/fundsTools';
import { defaultKeys, defaultNow, isPension, periodText } from '../lib/pensionPack';
import { claimProv, claimsWhy, companyOf, DECISION_PATH, isOldGen, pc1, svcOf, svcProv, type DecisionFile } from '../lib/decision';  // W2, W6 claims
import { actProv, pc2, tenderProv } from '../lib/agentProv';
import '../components/agent/glossary';
import { useActiveDoor } from '../components/home/doorState';
import { useMine } from '../lib/mine';
import { useAddressWrite } from '../lib/sheetHost';
import { tieNote } from '../lib/pageWords';
import { sn } from '../lib/format';
import { ASC_MEASURES, COLS, COL_LABEL, EXACT_BAND, RET, isColKey, screenBoard, screenDefault, windowAvg, type ColKey } from './screen/screenCalc';
import { FilterOptions, FiltersSheet, RankBy, type DoorW, type Saved } from './screen/ScreenFilters';
import { ScreenPhone, type Measure, type ScreenGroup } from './screen/ScreenBoard';
import '../styles/lens.css';
import '../styles/market.css';

/* /funds/screen, the screener 2.0 (funds plan #2, #3, #6): every track the regulator publishes, filtered across products by what a
   track holds as well as what it is called, ranked inside its own category on one stated window and basis. Saved screens live in this
   browser. The place and the percentile are always among the tracks of the category on screen (open to the public unless the reader
   includes the closed ones); filters hide rows without changing a place.
   Rollout L2-b (spec 4, 16–18): the phone is one ranked board for one period (pages/screen/ScreenBoard), the filters a sheet
   (pages/screen/ScreenFilters); the desktop keeps its table and columns. Places on both come from lib/pageMonths `placeGroups` (18.5:
   anchored groups, standard competition places 1, 1, 3; self-managed / IRA and old-generation tracks unranked), the one ranking of the
   rollout pages. Opening type without an address: the saver's saved product (else pension · general), the agent's pension · up to 50,
   Pro's hishtalmut · general; period five years (D7); every old parameter keeps working. */

const PRODUCTS = ['השתלמות', 'גמל', 'גמל להשקעה', 'חיסכון לילד', 'פנסיה מקיפה', 'פנסיה כללית', 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)', 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים', 'ביטוחי מנהלים 1992-2003', 'ביטוחי מנהלים 1990-1991', 'מרכזית לפיצויים', 'גמל, מטרה אחרת'];
const ALL = 'all';
const DEFAULT_COLS: ColKey[] = ['pct', 'y12', 'a3', 'a5', 'fee', 'assets', 'sharpe', 'st', 'top'];
/** W1-agent: a pension product opens with its decision columns (both fees, the actuarial balance) */
const PENSION_COLS: ColKey[] = ['pct', 'y12', 'a3', 'a5', 'fee', 'depfee', 'act', 'svc', 'clm', 'assets', 'sharpe', 'st'];
const isPenProd = (p: string) => /^פנסיה/.test(p);
const TIP: Partial<Record<ColKey, string>> = { pct: 'pct', fee: 'fee', depfee: 'depfee', sharpe: 'sharpe', sd: 'sd', alpha: 'alpha', st: 'equity', act: 'actuarial', svc: 'svcidx', clm: 'claims' };
const EXP = { st: ['STOCK_MARKET_EXPOSURE', 'חשיפה למניות'], fo: ['FOREIGN_EXPOSURE', 'חשיפה לחו"ל'], fx: ['FOREIGN_CURRENCY_EXPOSURE', 'חשיפה למט"ח'] } as const;
/** ordinal rank and percentile (rankAll) plus the shared place inside the tie band (lo–hi) */
type RankInfo = { rank: number; n: number; pct: number | null; lo: number; hi: number; place: number };
/** the fee columns: the regulator's average actual fee of the track, not a quote */
const FEE_SUB: Partial<Record<ColKey, string>> = { fee: 'ממוצע בפועל', depfee: 'ממוצע בפועל', act: 'רבעון אחרון', svc: 'הרשות, 2025', clm: 'אושרו · דיווח החברה', persist: 'חודשים ברבע העליון מ-60' };

/* wave 2b (fox 3.0): persistence, the former /funds/rank. The site's monthly percentile of every track in its category (funds/rank/<slug>.json,
   LTM return, the build's own ranking), and how many of the last 60 months the track sat in the top quarter (percentile 75 and up). The
   files load only when the column is on screen or the screen is sorted by it (?sort=persist). The percentile chart is on the track card. */
type Persist = { top: number; of: number; xs: (number | null)[]; months: number[]; n: number[]; basis: Basis };
function usePersist(cats: string[], on: boolean, basis: Basis): Map<string, Map<string, Persist>> | null {
  const idx = useStatsIndex();
  const [files, setFiles] = useState<Map<string, RankFile | null>>(new Map());
  const want = on && idx.data ? cats.map((c) => [c, slugOf(idx.data, c)] as const).filter(([c, r]) => r && r.rank !== false && !files.has(c)) : [];
  const key = want.map(([c]) => c).join('|');
  useEffect(() => {
    if (!want.length) return;
    let live = true;
    Promise.all(want.map(([c, r]) => load<RankFile>(`funds/rank/${r!.slug}.json`).then((f) => [c, f] as const, () => [c, null] as const)))
      .then((xs) => live && setFiles((m) => { const n = new Map(m); xs.forEach(([c, f]) => n.set(c, f)); return n; }));
    return () => { live = false; };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    if (!on || (!idx.data && !idx.missing)) return null;
    const out = new Map<string, Map<string, Persist>>();
    files.forEach((f, c) => {
      const set = f ? pickSet(f, 'y12', 'gross') : null;
      if (!f || !set) return;
      const m = new Map<string, Persist>();
      Object.entries(set.tracks).forEach(([k, xs]) => { const last = xs.slice(-60).filter((v): v is number => v != null); if (last.length) m.set(k, { top: last.filter((v) => v >= 75).length, of: last.length, xs, months: f.months, n: set.n, basis: 'gross' }); });
      out.set(c, m);
    });
    return out;
  }, [on, idx.data, idx.missing, files, basis]);
}

/** W6 doors: the IRA note in the agent's words (SELF_NOTE speaks to the saver) */
const SELF_NOTE_AGENT = 'מסלולי IRA (ניהול אישי) אינם מדורגים: העמית בוחר את ההשקעות בעצמו, והתשואה המפורסמת אינה תוצאה של מנהל';
const yearsOf = (f: FundX, asof: number) => (f.since ? (Math.floor(asof / 100) + (asof % 100) / 12) - (Number(f.since.slice(0, 4)) + Number(f.since.slice(5, 7)) / 12) : null);

export function FundsScreen() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cpi = useMacro().data?.series.cpi;
  const [sp] = useSearchParams();
  const phone = usePhone();
  const [real] = useReal();
  const basis: Basis = 'gross';  // owner 26.11.26: every return is the published gross
  // every write reads the address fresh and replaces it (a sheet may have changed it; lenses and sheets never push)
  const write = useAddressWrite();
  const set = (patch: Record<string, string | null>) => write(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v || null])));
  const num = (k: string) => { const v = sp.get(k); return v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
  // the old /funds?q= links and the search palette: open the product and track of the first match
  const q = sp.get('q') ?? '';
  const hit = !sp.get('prod') && q ? data?.funds.find((f) => f.name.includes(q.trim())) : undefined;
  // W4: the agent door shows shared ranks and percentiles (facts) but not the "רבע עליון x/5" badge
  const [door0] = useActiveDoor();
  const door: DoorW = door0 ?? 'saver';  // B1 / D3: no door reads as the saver
  const agentDoor = door === 'agent';
  const [mine] = useMine();
  const byK = useMemo(() => new Map((data?.funds ?? []).map((f) => [f.k, f])), [data]);
  const own = useMemo(() => (door === 'saver' ? mine.map((m) => byK.get(m.k)).filter((f): f is FundX => !!f) : []), [door, mine, byK]);
  const mineKeys = useMemo(() => new Set(own.map((f) => f.k)), [own]);
  // spec 4.2 defaults: the saver on the type of the first saved product (pension first), else pension · general; the agent on pension ·
  // up to 50 with the decision columns (W6: PENSION_COLS); Pro on hishtalmut · general
  const def = screenDefault(door, own);
  const prod = sp.get('prod') ?? hit?.prod ?? def.prod;
  const perRaw = sp.get('per') ?? sp.get('win') ?? DEFAULT_PER;
  const per: Per = (PERIODS.some(([k]) => k === perRaw) ? perRaw : DEFAULT_PER) as Per;
  const fams = (sp.get('fam') ?? '').split(',').filter((x): x is FamKey => FAMS.some(([k]) => k === x));
  const mk = sp.get('mk') ?? '';
  const closed = sp.get('closed') === '1', gone = sp.get('gone') === '1', outOnly = sp.get('out') === '1';
  const F = { fmax: num('fmax'), dmax: num('dmax'), amin: num('amin'), smin: num('smin'), hist: num('hist'), eqmin: num('eqmin'), eqmax: num('eqmax') };
  const colsQ = (sp.get('cols') ?? '').split(',').filter(isColKey);
  // ?sort=persist (the address /funds/rank lands on): sorted by persistence, with its column on screen
  const sortPersist = sp.get('sort') === 'persist' && !sp.get('s');
  const colsAll = agentDoor ? COLS.filter(([k]) => k !== 'top') : COLS;
  const baseCols = (isPenProd(prod) ? PENSION_COLS : DEFAULT_COLS).filter((c) => !agentDoor || c !== 'top');
  const cols0: ColKey[] = colsQ.length ? colsQ.filter((c) => !agentDoor || c !== 'top') : baseCols;
  // the persistence column sits beside the percentile when the address asks for it
  const cols: ColKey[] = sortPersist && !cols0.includes('persist') ? (() => { const i = cols0.indexOf('pct') + 1; return [...cols0.slice(0, i), 'persist' as ColKey, ...cols0.slice(i)]; })() : cols0;
  // W1-agent: the default funds (קרנות ברירת מחדל) of the tender in force; `df=1` keeps only them
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const dfOnly = sp.get('df') === '1';
  const dec = useOptional<DecisionFile>(DECISION_PATH);  // W2: the service index column (pension)
  const [open, setOpen] = useState<string[]>([]);
  const [opts, setOpts] = useState(false);
  const [saved, setSaved] = useStored<Saved[]>('funds:screens', []);
  const cats = useFundCats(phone).data as Record<string, CatX> | undefined;
  // B10: a choice that would leave no track at all is refused, with the reason; the previous filter stays
  const [refused, setRefused] = useState(false);
  useEffect(() => { setRefused(false); }, [sp]);
  // B9: the phone's control row scrolls sideways; after the ranking window or the scope changes it starts at its start again
  useEffect(() => { document.querySelectorAll<HTMLElement>('.tbar-ctl').forEach((el) => el.scrollTo({ left: 0 })); }, [sp, phone]);

  // closed (ceased) tracks: a separate file, loaded only when asked
  const [goneRows, setGoneRows] = useState<FundX[] | null>(null);
  useEffect(() => { if (gone && !goneRows) load<{ funds: FundX[] }>('funds/closed.json').then((d) => setGoneRows((d.funds ?? []).map((f) => ({ ...f, gone: true }))), () => setGoneRows([])); }, [gone, goneRows]);

  const all = useMemo(() => (data?.funds ?? []).filter((f) => f.assets !== 0).map((f) => (f.sd != null && f.sd > 0 ? f : { ...f, sharpe: null })), [data]);
  const spread = useMemo(() => equitySpread(all.filter((f) => !f.closed)), [all]);
  const prods = PRODUCTS.filter((p) => all.some((f) => f.prod === p));
  const inProd = (f: FundX) => prod === ALL || f.prod === prod;
  const tracks = useMemo(() => { const m = new Map<string, number>(); all.filter(inProd).forEach((f) => m.set(f.track, (m.get(f.track) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [all, prod]);  // eslint-disable-line react-hooks/exhaustive-deps
  // W4: a comprehensive pension opens on the age track up to 50, where the default funds and most members are (כללי there holds 5 funds)
  const ownTrack = own.find((f) => f.prod === prod)?.track;
  const trackQ = sp.get('track') ?? hit?.track ?? (prod === ALL ? ALL : prod === def.prod ? def.track : ownTrack ? ownTrack : door !== 'saver' && prod === 'פנסיה מקיפה' && tracks.some(([t]) => t === 'עד 50') ? 'עד 50' : 'כללי');
  const T = trackQ === ALL || tracks.some(([t]) => t === trackQ) ? trackQ : tracks[0]?.[0] ?? ALL;
  const groupsAll = useMemo(() => [...new Set(all.map((f) => f.grp))].sort((a, b) => a.localeCompare(b, 'he')), [all]);
  const asof = data?.asof ?? 0;
  const dfKeys = useMemo(() => defaultKeys(dfile, asof), [dfile, asof]);
  const val = (f: FundX, p: Per) => (real ? realOf(f, p, basis, asof, cpi).v : retOf(f, p, basis).v);

  const screened = (f: FundX, o: { fams?: FamKey[]; mk?: string } = {}) => {
    const fm = o.fams ?? fams, mkx = o.mk ?? mk;
    const t = q.trim();
    if (t && !(f.name.includes(t) || f.mgr.includes(t) || f.grp.includes(t))) return false;
    if (fm.length && !fm.includes(famOf(f.track))) return false;
    if (mkx && f.grp !== mkx) return false;
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
  // how many tracks a choice would leave (every other filter kept)
  const reach = (o: { track?: string; fams?: FamKey[]; mk?: string }) => all.filter((f) => inProd(f) && (closed || !f.closed) && (o.track == null || o.track === ALL || f.track === o.track) && screened(f, o)).length;
  const trackCount = (t: string) => reach({ track: t });
  const sortKey = (sp.get('s') ?? (sortPersist ? 'persist' : '')) as ColKey | '';
  const persistOn = cols.includes('persist') || sortKey === 'persist';
  const persistCats = useMemo(() => [...new Set(all.filter((f) => inProd(f) && (T === ALL || f.track === T)).map(catKey))], [all, prod, T]);  // eslint-disable-line react-hooks/exhaustive-deps
  const persist = usePersist(persistCats, persistOn, basis);
  const persistOf = (f: FundX) => persist?.get(catKey(f))?.get(f.k) ?? null;
  const groups = useMemo(() => {
    const keys = new Map<string, FundX[]>();
    all.filter((f) => inProd(f) && (T === ALL || f.track === T) && (closed || !f.closed)).forEach((f) => keys.set(catKey(f), [...(keys.get(catKey(f)) ?? []), f]));
    if (gone && goneRows) goneRows.filter((f) => inProd(f) && (T === ALL || f.track === T)).forEach((f) => { if (keys.has(catKey(f)) || T !== ALL) keys.set(catKey(f), [...(keys.get(catKey(f)) ?? []), f]); });
    return [...keys.entries()].map(([k, shown]) => {
      // W5 (red team 3): a generation closed to new members (managers' insurance sold 1990-2003, e.g. קרן י') is no choice a client can
      // make: it gets no rank and no percentile, and does not move the others'
      const peers = shown.filter((f) => !f.gone && !selfDirected(f) && !isOldGen(f));
      // the percentile: rankAll (unchanged); the place: placeGroups (18.5), the one ranking of the rollout pages
      const ord = rankAll(peers, (f) => val(f, per)), board = screenBoard(shown, (f) => val(f, per), tieBand(per, asof));
      const pl = new Map(board.rows.filter((r) => r.pl).map((r) => [r.f.k, r.pl!]));
      const rk = new Map<string, RankInfo>([...ord].filter(([k]) => pl.has(k)).map(([k, r]) => { const x = pl.get(k)!; return [k, { ...r, n: x.n, lo: x.lo!, hi: x.hi!, place: x.place! }]; }));
      const by = sortKey && sortKey !== 'pct' ? sortKey : null;
      const sv = (f: FundX): number | null => (by == null ? null : RET.has(by) ? val(f, by as Per) : by === 'age' ? yearsOf(f, asof) : by === 'top' ? f.top : by === 'persist' ? (() => { const x = persistOf(f); return x ? x.top / x.of : null; })() : by === 'svc' ? (isPension(f) ? svcOf(dec, f.grp, 'pension')?.total ?? null : null) : by === 'clm' ? (isPension(f) && dec ? companyOf(dec, f.grp)?.claims?.disability.approved ?? null : null) : (f as unknown as Record<string, number | null>)[by] ?? null);
      // the phone's board: the period's return, or (agent / Pro "דירוג לפי") another measure in its own unit, lower first for fees
      const mby = sortKey && !RET.has(sortKey) ? sortKey : null;
      const mv = (f: FundX): number | null => (mby === 'pct' ? ord.get(f.k)?.pct ?? null : mby === 'persist' ? persistOf(f)?.top ?? null : sv(f));
      const pboard = mby ? screenBoard(shown, mv, EXACT_BAND, { asc: ASC_MEASURES.has(mby) }) : board;
      const list = shown.filter((f) => screened(f)).sort((a, b) => {
        if (a.gone !== b.gone) return a.gone ? 1 : -1;
        if (by) { const x = sv(a), y = sv(b); if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; return by === 'fee' || by === 'depfee' || by === 'sd' ? x - y : y - x; }
        const ra = rk.get(a.k)?.place, rb = rk.get(b.k)?.place; return ra == null || rb == null ? (ra == null ? (rb == null ? (b.assets ?? 0) - (a.assets ?? 0) : 1) : -1) : ra - rb || (val(b, per) ?? 0) - (val(a, per) ?? 0);
      });
      return { k, prod: shown[0].prod, track: shown[0].track, list, rk, n: board.n, assets: peers.reduce((t, f) => t + (f.assets ?? 0), 0), shown, pboard };
    }).filter((g) => g.list.length).sort((a, b) => b.assets - a.assets);
  }, [all, prod, T, closed, gone, goneRows, per, basis, real, cpi, sortKey, q, sp, dfKeys, dec, persist, asof]);  // eslint-disable-line react-hooks/exhaustive-deps
  const shownN = groups.reduce((t, g) => t + g.list.length, 0);
  const rkOf = (f: FundX) => { for (const g of groups) { const r = g.rk.get(f.k); if (r) return r; } return undefined; };
  const multi = groups.length > 1 || T === ALL;
  const nFilters = [q, fams.length ? '1' : '', mk, closed ? '1' : '', gone ? '1' : '', outOnly ? '1' : '', dfOnly ? '1' : '', ...Object.values(F).map((v) => (v == null ? '' : '1'))].filter(Boolean).length;

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="מסלולים" />;
  const lbl = real ? 'ריאלי' : GROSS_LABEL;

  /* ---- cells: every figure opens its source ---- */
  const rankSrc = (f: FundX, r: RankInfo): Prov => ({ k: 'calc', title: `מקום לפי ${PER_LABEL[per]} (${lbl}) · ${f.name}`, value: `${r.place} מתוך ${r.n}`,
    formula: `ממיינים את מסלולי הקטגוריה (אותו מוצר ומסלול) מהתשואה הגבוהה לנמוכה. מסלול שהפער שלו מהמסלול הראשון בקבוצה קטן מ-${nf(tieBand(per, asof), 2)} נקודות אחוז מצטרף לקבוצה וחולק את מקומה, והקבוצה הבאה ממשיכה לפי הסדר (1, 1, 3). מוסכמת הצגה, לא מבחן סטטיסטי. מדורגים המסלולים שעל המסך שיש להם תשואה בחלון; מסלולים בניהול אישי (IRA) ודורות ישנים של ביטוח מנהלים אינם מדורגים; סינונים מסתירים שורות ולא משנים מקום`,
    inputs: [{ label: PER_LABEL[per], v: pc(val(f, per)), src: () => shownProv(f, per, basis, real, asof, cpi, data) }, { label: 'מסלולים מדורגים', v: nf(r.n, 0) }, { label: 'חולקים את המקום', v: nf(r.hi - r.lo + 1, 0) }] });
  const pctSrc = (f: FundX, r: RankInfo): Prov => ({ k: 'calc', title: `אחוזון · ${PER_LABEL[per]} (${lbl}) · ${f.name}`, value: r.pct == null ? '–' : nf(r.pct, 0), formula: PCT_F,
    inputs: [{ label: PER_LABEL[per], v: pc(val(f, per)), src: () => shownProv(f, per, basis, real, asof, cpi, data) }, { label: 'מקום', v: `${r.place} מתוך ${r.n}`, src: () => rankSrc(f, r) }] });
  const plain = (f: FundX, col: string, label: string, v: string, unit?: string) => () => fundP(refOf(f), f.end ?? asof, col, label, v, unit);
  const Ret = ({ f, p }: { f: FundX; p: Per }) => {
    const v = val(f, p);
    if (v != null) return <Sourced src={() => shownProv(f, p, basis, real, asof, cpi, data)}><span className="num">{pc(v, p === 'm1' ? 2 : 1)}</span></Sourced>;
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
      case 'clm': { const c = isPension(f) && dec ? companyOf(dec, f.grp)?.claims : null; const v = c?.disability.approved ?? null;
        return !isPension(f) ? <span className="muted">–</span> : v == null ? <span className="muted" title={dec ? claimsWhy(dec, f.grp) : 'קובץ נתוני ההחלטה לא פורסם'}>–</span> : <Sourced src={() => claimProv(dec!, f.grp, 'disability', 'approved')} title={`תביעות נכות שאושרו ב-${c!.year}, מתוך התביעות שנסגרו · דיווח החברה (${c!.entity}), לא נבדק על ידי הרשות`}><span className="num">{pc1(v)}</span></Sourced>; }
      case 'svc': { const r = isPension(f) && dec ? svcOf(dec, f.grp, 'pension') : null; return !r ? <span className="muted" title={isPension(f) ? 'החברה אינה במדד השירות לקרנות פנסיה' : 'מדד השירות לקרנות פנסיה'}>–</span> : <Sourced src={() => svcProv(dec!, f.grp, 'pension', 'total')} title={`מדד השירות 2025: ${r.total}, מקום ${r.rank} מתוך ${r.of} (ברמת החברה המנהלת)`}><span className="num">{r.total}</span><span className="dim num"> · {r.rank}/{r.of}</span></Sourced>; }
      case 'persist': { const x = persistOf(f);
        if (!x) return <span className="muted" title={persist == null ? 'טוען את קובצי האחוזונים' : 'אין אחוזון חודשי למסלול בקטגוריה (היסטוריה קצרה, או שהקטגוריה קטנה מדי)'}>–</span>;
        const L = x.months.length - 1, first = Math.max(0, x.xs.length - 60);
        return <Sourced src={() => ({ k: 'calc', title: `התמדה · ${f.name}`, value: `${x.top} מתוך ${x.of}`, formula: 'מספר החודשים מתוך 60 האחרונים שבהם האחוזון של המסלול בקטגוריה (תשואת LTM) היה 75 ומעלה, מתוך החודשים שבהם המסלול דורג',
          note: `אחוזון היום: ${x.xs[L] == null ? '–' : nf(x.xs[L]!, 0)} · ברוטו · הגרף החודשי בכרטיס המסלול`,
          inputs: x.xs.slice(first).map((v, i) => ({ label: ymL(x.months[first + i] ?? 0), v: v == null ? '–' : nf(v, 0), src: v == null ? undefined : () => rankProv(f.name, x.months[first + i], v, x.n[first + i] ?? null, 'y12', x.basis, 'file') })).filter((z) => z.v !== '–') })}><span className="num">{x.top}/{x.of}</span></Sourced>; }
      case 'top': return f.yrs ? <Sourced src={() => ({ k: 'calc', title: `רבע עליון · ${f.name}`, value: `${f.top}/${f.yrs}`, formula: 'בכמה מהשנים הקלנדריות המלאות מתוך חמש האחרונות תשואת המסלול (ברוטו, ריבית דריבית על 12 תשואות חודשיות) הייתה ברבע העליון של הקטגוריה: מקום ≤ ⌈n÷4⌉, בקטגוריה של 4 מסלולים לפחות', inputs: [{ label: 'שנים ברבע העליון', v: nf(f.top ?? 0, 0) }, { label: 'שנים שנבדקו', v: nf(f.yrs ?? 0, 0) }], note: 'מחושב בבניית הנתונים מתשואות חברי הקטגוריה' })}><span className="num">{f.top}/{f.yrs}</span></Sourced> : <span className="muted">–</span>;
    }
    return null;
  };
  const Flags = ({ f }: { f: FundX }) => <>
    {f.closed && <span className="chip">ענפית</span>}
    {isOldGen(f) && <span className="chip est" title="דור ישן של ביטוח מנהלים (פוליסות 1990-2003): אי אפשר להצטרף אליו היום, ולכן אין לו מקום ואחוזון">סגור להצטרפות</span>}
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
  const clear = () => { const keep = new Set(['prod', 'track', 'per', 'b', 'cols', 'real', 'sheet']); const cur = new URLSearchParams(window.location.search); write(Object.fromEntries([...cur.keys()].filter((k) => !keep.has(k)).map((k) => [k, null]))); };
  const filterProps = {
    door, phone, q, fams, mk, F, closed, gone, outOnly, nFilters, groupsAll, refused, setRefused, set, clear, cols, colsAll, baseCols, saved, setSaved, qs: sp.toString(),
    reachFam: (fx: FamKey[]) => reach({ track: T, fams: fx }), reachMk: (m: string) => reach({ track: T, mk: m }),
  };
  const Refused = refused ? <div className="fnote" role="status">אין מסלולים כאלה; הסינון הקודם נשמר</div> : null;
  const Options = <FilterOptions {...filterProps} />;
  const dfChip = isPenProd(prod) && <button type="button" className="chip" aria-pressed={dfOnly} onClick={() => set({ df: dfOnly ? null : '1' })} title="קרנות שנבחרו בהליך שבתוקף כקרנות ברירת מחדל">ברירת מחדל</button>;
  const tools = <>
    <Pick label="מוצר" value={prod} onChange={(p) => set({ prod: p, track: null })} options={[[ALL, 'כל המוצרים'], ...prods.map((p) => [p, p] as [string, string])]} />
    <Pick label="מסלול" className="trackpick" value={T} onChange={(t) => { if (t !== ALL && trackCount(t) === 0) { setRefused(true); return; } set({ track: t }); }} options={[[ALL, 'כל המסלולים', nf(tracks.reduce((u, [, c]) => u + c, 0), 0)], ...tracks.map(([t, c]) => [t, t, nf(c, 0)] as [string, string, string])]} />
    {dfChip}
    <Seg label="דירוג לפי" value={per} onChange={(v) => set({ per: v, win: null })} options={PERIODS} />
    <button type="button" className={`btn${opts ? ' primary' : ''}`} aria-expanded={opts} onClick={() => setOpts((v) => !v)}>{`סינון${nFilters ? ` · ${nFilters}` : ''}`}</button>
  </>;
  const placeCell = (f: FundX) => { const r = rkOf(f); return r ? <Sourced src={() => rankSrc(f, r)}><span><bdi className="num">{r.place}</bdi> מתוך <bdi className="num">{r.n}</bdi></span></Sourced> : isOldGen(f) ? <span className="muted">סגור להצטרפות</span> : <span className="muted">–</span>; };
  const methodFacts = <>
    <li>מקום ואחוזון: בתוך הקטגוריה (אותו מוצר ומסלול), על {PER_LABEL[per]} {lbl}; מדורגים מסלולים פתוחים לציבור{closed ? ' וקופות ענפיות' : ''} עם נכסים; מסלול בלי היסטוריה לחלון מוצג &quot;אין עדיין&quot; ובסוף הרשימה; סינונים מסתירים שורות ולא משנים מקום.</li>
    <li>דורות ישנים של ביטוח מנהלים (1990-2003) סגורים להצטרפות ואינם מדורגים. {agentDoor ? SELF_NOTE_AGENT : SELF_NOTE}.</li>
    <li>ממוצע הסוג: הממוצע המשוקלל בנכסים שהרשות מפרסמת לכל סוג מסלול בכל חודש; לתקופה של כמה חודשים בריבית דריבית, ל-3 ו-5 שנים בממוצע לשנה.</li>
    <li>דמי ניהול: הממוצע בפועל של המסלול (הרשות), לא דמי הניהול של חוסך מסוים.{door === 'saver' ? '' : ' ▲▼ ליד החשיפה למניות: תווית מול מציאות.'}</li>
    {real ? <li>ריאלי: מנוכה במדד המחירים לצרכן (הלמ&quot;ס); המדד בקובץ מכסה {cpi?.points.length ?? 0} חודשים, וחלון ארוך יותר מוצג &quot;–&quot;.</li> : null}
    <li>{gone ? 'מסלולים שנסגרו: הנתונים לחודש האחרון שלהם, מחוץ לדירוג.' : 'ממוצעי הקטגוריה ודירוגים כוללים רק מסלולים פעילים היום.'}</li>
    {agentDoor && cols.includes('clm') ? <li>תביעות נכות: שיעור התביעות שאושרו מתוך אלה שנסגרו בשנה, מדיווח החברה עצמה (נספח ב3), ברמת החברה המנהלת.</li> : null}
  </>;

  /* ---- phone: one ranked board for one period (rollout L2-b) ---- */
  if (phone) {
    const mkey = sortKey && !RET.has(sortKey) ? sortKey : null;
    const pc0 = (d: number) => (v: number) => `${nf(v, d)}`;
    const MFMT: Partial<Record<ColKey, (v: number) => string>> = { fee: (v) => `${nf(v, 2)}%`, depfee: (v) => `${nf(v, 2)}%`, st: (v) => `${nf(v, 0)}%`, fo: (v) => `${nf(v, 0)}%`, fx: (v) => `${nf(v, 0)}%`, liq: (v) => `${nf(v, 0)}%`, act: (v) => `${sn(v, 2)}%`, clm: (v) => `${nf(v, 1)}%`, sharpe: pc0(2), sd: pc0(2), alpha: pc0(2), age: pc0(1) };
    const measure: Measure | null = mkey ? {
      key: mkey, label: COL_LABEL[mkey], asc: ASC_MEASURES.has(mkey), fmt: (v) => <bdi dir="ltr" className="sgnum">{(MFMT[mkey] ?? pc0(0))(v)}</bdi>,
      unit: (f) => (mkey === 'assets' ? 'מ׳ ש"ח' : mkey === 'age' ? 'שנים' : mkey === 'top' ? (f.yrs ? `מתוך ${f.yrs}` : undefined) : mkey === 'persist' ? (persistOf(f) ? `מתוך ${persistOf(f)!.of}` : undefined) : undefined),
    } : null;
    const pgroups: ScreenGroup[] = groups.map((g) => ({
      k: g.k, prod: g.prod, track: g.track, board: g.pboard, members: g.shown,
      rows: g.pboard.rows.filter((r) => screened(r.f)), self: g.pboard.self.filter((r) => screened(r.f)),
      avg: windowAvg(cats?.[g.k], per, asof),
    })).filter((g) => g.rows.length + g.self.length > 0);
    return (
      <ScreenPhone door={door} asof={asof} per={per} setPer={(v) => set({ per: v, win: null })} prod={prod} T={T} all={ALL} prods={prods} tracks={tracks} trackCount={trackCount}
        setProdTrack={(p, t) => set({ prod: p, track: t })} groups={pgroups} shownN={pgroups.reduce((t, g) => t + g.rows.length + g.self.length, 0)} nFilters={nFilters} real={real}
        measure={measure} clearMeasure={() => set({ s: null, sort: null })} mineKeys={mineKeys} val={val}
        cell={(f, c) => cell(f, c, rkOf(f))} place={placeCell} ret={(f, p) => <Ret f={f} p={p} />} flags={(f) => <Flags f={f} />} mgr={(f) => <MgrChip grp={f.grp} mgr={f.mgr} short />}
        find={(k) => byK.get(k) ?? goneRows?.find((x) => x.k === k)} clearFilters={clear} refused={refused} sharedPolicy={prod === 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)'} method={methodFacts}
        filters={(o, onClose) => (
          <FiltersSheet open={o} onClose={onClose} door={door} shown={shownN} extra={dfChip || null}
            rankBy={door === 'saver' ? null : <RankBy sortKey={sortKey} per={per} cols={colsAll} onPick={(k) => (k == null ? set({ s: null, sort: null }) : RET.has(k) ? set({ per: k, win: null, s: null, sort: null }) : set({ s: k, sort: null }))} />}>
            {Options}
          </FiltersSheet>
        )} />
    );
  }

  const shown = (g: (typeof groups)[number]) => !multi || open.includes(g.k) || groups.length <= 2;
  return (
    <>
      <FundsHead sub={<span><Sourced src={() => countP('מסלולים מוצגים', shownN, 'המסלולים שעוברים את הסינון')}><span className="num">{nf(shownN, 0)}</span></Sourced> מסלולים · {ym(asof)} · {data.source}</span>} tools={<>{tools}<BasisToggle /></>} />
      {opts && <section className="controls opts">{Options}</section>}

      {!opts && Refused}
      <Panel title={<>{prod === ALL ? 'כל המוצרים' : prod} · {T === ALL ? 'כל המסלולים' : T}</>} aside={<>
        {multi && groups.length > 2 && <button type="button" className="chip" onClick={() => setOpen(open.length ? [] : groups.map((g) => g.k))}>{open.length ? 'כווץ הכול' : 'פתח הכול'}</button>}
        <span className={`chip${real ? ' est' : ''}`}>{lbl}</span>{(per === 'a3' || per === 'a5') && <span className="chip">3Y ו-5Y: שנתי ממוצע</span>}
        {prod === 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)' && <span className="chip est" title="ביטוח-נט מפרסם מסלולי השקעה. פוליסת חיסכון וביטוח מנהלים שהונפק מ-2004 מושקעים באותו מסלול, ולכן התשואה זהה; הנכסים ודמי הניהול הממוצעים כוללים את שני המוצרים">מסלול משותף לשני המוצרים</span>}
      </>}>
        {groups.length === 0 ? <Empty title="אין מסלולים בסינון הזה">{nFilters > 0 && 'נסו לנקות חלק מהסינונים.'}</Empty>  : (
          <div className="scroll" style={{ maxHeight: 720 }}><table className="rank fscreen">
            <thead><tr><th>מסלול</th><th>#</th>{cols.map((c) => <th key={c} aria-sort={sortKey === c ? 'descending' : undefined}><button type="button" className="thbtn" onClick={() => set({ s: sortKey === c ? null : c, sort: null })}>{RET.has(c) && c === per ? <b>{COL_LABEL[c]}</b> : COL_LABEL[c]}{FEE_SUB[c] && <span className="dim">{FEE_SUB[c]}</span>}</button>{TIP[c] && <Tip k={TIP[c]!} />}</th>)}<th><span className="sr-only">השוואה</span></th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.k}>
                  {multi && <tr className="sec grp" onClick={(e) => { if ((e.target as Element).closest('a, button.src')) return; setOpen(open.includes(g.k) ? open.filter((x) => x !== g.k) : [...open, g.k]); }}>
                    <td colSpan={cols.length + 3}><button type="button" className="twist" aria-expanded={shown(g)} aria-label={shown(g) ? `כווץ את ${g.k}` : `פתח את ${g.k}`}>{shown(g) ? '▾' : '◂'}</button><CatHead g={g} /></td></tr>}
                  {shown(g) && g.list.map((f) => { const r = g.rk.get(f.k); return (
                    <tr key={f.k} className={f.gone ? 'gone' : undefined}>
                      <td><span className="fname"><Link className="name" to={`/funds/${f.k}`}>{f.name}</Link><span className="fund-mgr"><MgrChip grp={f.grp} mgr={f.mgr} short /><Flags f={f} /></span></span></td>
                      <td>{r ? <Sourced src={() => rankSrc(f, r)}><span className="num muted">{r.place}</span></Sourced> : <span className="muted" title={isOldGen(f) ? 'סגור להצטרפות: לא מדורג' : undefined}>–</span>}</td>
                      {cols.map((c) => <td key={c} className={c === per ? 'lead' : undefined}>{cell(f, c, r)}</td>)}
                      <td>{!f.gone && <CompareAdd k={f.k} name={f.name} small />}</td>
                    </tr>
                  ); })}
                </Fragment>
              ))}
            </tbody>
          </table></div>
        )}
        <div className="fnote">מקום ואחוזון: בתוך הקטגוריה (אותו מוצר ומסלול), על {PER_LABEL[per]} {lbl}; מדורגים מסלולים פתוחים לציבור{closed ? ' וקופות ענפיות' : ''} עם נכסים; דורות ישנים של ביטוח מנהלים (1990-2003) סגורים להצטרפות ואינם מדורגים; מסלול בלי היסטוריה לחלון מוצג "–" ובסוף הקטגוריה. <NumText t={tieNote(per, asof)} /> ד"נ: הממוצע בפועל של המסלול (הרשות), לא דמי הניהול של חוסך מסוים. ברוטו: לפני דמי ניהול, כפי שהרשות מפרסמת; דמי הניהול בעמודה נפרדת. ▲▼ ליד החשיפה למניות: תווית מול מציאות. {real ? `ריאלי: מנוכה במדד המחירים לצרכן (הלמ"ס); המדד בקובץ מכסה ${cpi?.points.length ?? 0} חודשים, וחלון ארוך יותר מוצג "–".` : ''} {gone ? 'מסלולים שנסגרו: הנתונים לחודש האחרון שלהם, מחוץ לדירוג.' : 'ממוצעי הקטגוריה ודירוגים כוללים רק מסלולים פעילים היום.'} {agentDoor ? SELF_NOTE_AGENT : SELF_NOTE}.{agentDoor && cols.includes('clm') ? ' תביעות נכות: שיעור התביעות שאושרו מתוך אלה שנסגרו בשנה, מדיווח החברה עצמה (נספח ב3), ברמת החברה המנהלת.' : ''}</div>
      </Panel>
    </>
  );
}
