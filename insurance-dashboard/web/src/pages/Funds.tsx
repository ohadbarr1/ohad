import { foxOption } from '../lib/foxchart';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { FundsHead, FundsNav } from '../components/FundsNav';
import { MgrChip } from '../components/MgrChip';
import { CRISES, CRISIS_FORMULA, RATING_NOTE, crisis, ddText, rate, ratingProv, type Rating } from '../lib/rating';
import '../styles/lens.css';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { countP, dsOf, expP, flowP, fundP, listP, monthIn, monthsBack, retP, seedHist, warmHist, y12P, type TrackRef } from '../lib/market';
import { useSource, type Prov } from '../lib/prov';
import { Empty, ErrorBox, Field, Kpi, Loading, Panel, Seg } from '../components/ui';
import { chartBase, palette } from '../lib/theme';
import { nf, pct, pubLabel, sn } from '../lib/format';
import { DataTable, type Column } from '../components/DataTable';
import '../styles/market.css';
import '../styles/prov-market.css';
import { load, useFundCats, useFundHist, useFunds, useRegistry, type Fund, type FundCats, type FundHist } from '../lib/useData';

const PRODUCTS = ['גמל', 'השתלמות', 'גמל להשקעה', 'חיסכון לילד', 'פנסיה מקיפה', 'פנסיה כללית', 'פוליסות חיסכון', 'ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים', 'ביטוחי מנהלים 1992-2003', 'ביטוחי מנהלים 1990-1991', 'מרכזית לפיצויים', 'גמל, מטרה אחרת'];
type Per = 'm1' | 'ytd' | 'y12' | 'a3' | 'a5';
const PERIODS: [Per, string][] = [['m1', '1M'], ['ytd', 'YTD'], ['y12', 'LTM'], ['a3', '3Y'], ['a5', '5Y']];
type Win = '12' | '36' | '60' | '120' | 'max';
const WINDOWS: [Win, string][] = [['12', '1Y'], ['36', '3Y'], ['60', '5Y'], ['120', '10Y'], ['max', 'הכול']];
const ym = (p: number) => `${String(p % 100).padStart(2, '0')}/${String(Math.floor(p / 100)).slice(2)}`;
const PER_LABEL: Record<Per, string> = { m1: 'תשואה חודשית', ytd: 'תשואה YTD', y12: 'תשואה LTM', a3: 'תשואה שנתית ממוצעת, 3 שנים', a5: 'תשואה שנתית ממוצעת, 5 שנים' };
const PER_COL: Partial<Record<Per, string>> = { m1: 'MONTHLY_YIELD', ytd: 'YEAR_TO_DATE_YIELD', a3: 'AVG_ANNUAL_YIELD_TRAILING_3YRS', a5: 'AVG_ANNUAL_YIELD_TRAILING_5YRS' };
const pc = (v: number | null | undefined, d = 2) => (v == null ? '–' : sn(v, d) + '%');
const ref = (f: Fund): TrackRef => ({ ds: dsOf(f.fam), id: f.id, name: f.name });
/** The source of a return column of a track: published as is, or compounded from the monthly returns. */
const perSrc = (f: Fund, per: Per, asof: number): Prov => per === 'y12' ? y12P(ref(f), asof, pc(f.y12)) : fundP(ref(f), asof, PER_COL[per]!, PER_LABEL[per], pc(f[per]));
const plain = (f: Fund, asof: number, k: 'fee' | 'assets' | 'sharpe' | 'depfee' | 'sd'): Prov => {
  const v = f[k], r = ref(f);
  return k === 'assets' ? fundP(r, asof, 'TOTAL_ASSETS', 'נכסים', v == null ? '–' : nf(v, 1), 'מיליוני ש"ח')
    : k === 'sharpe' ? fundP(r, asof, 'SHARPE_RATIO', 'שארפ', v == null ? '–' : nf(v, 2))
    : k === 'sd' ? fundP(r, asof, 'STANDARD_DEVIATION', 'סטיית תקן', v == null ? '–' : nf(v, 2))
    : fundP(r, asof, k === 'fee' ? 'AVG_ANNUAL_MANAGEMENT_FEE' : 'AVG_DEPOSIT_FEE', k === 'fee' ? 'דמי ניהול מצבירה' : 'דמי ניהול מהפקדה', v == null ? '–' : nf(v, 2) + '%');
};
const EXP = { st: ['STOCK_MARKET_EXPOSURE', 'חשיפה למניות'], fo: ['FOREIGN_EXPOSURE', 'חשיפה לחו"ל'], fx: ['FOREIGN_CURRENCY_EXPOSURE', 'חשיפה למט"ח'] } as const;
const expSrc = (f: Fund, asof: number, k: keyof typeof EXP): Prov => expP(ref(f), asof, EXP[k][0], EXP[k][1], f[k], f.assets);
const rankSrc = (f: Fund, per: Per, asof: number, rank: number, n: number): Prov => ({ k: 'calc', title: `מקום לפי ${PER_LABEL[per]} · ${f.name}`, value: `${rank} מתוך ${n}`,
  formula: 'מקום = מספר המסלולים באותו מוצר ומסלול עם תשואה גבוהה יותר, ועוד 1. מדורגים המסלולים שיש להם תשואה בתקופה, ללא קופות ענפיות ומפעליות אלא אם נבחרו',
  inputs: [{ label: PER_LABEL[per], v: pc(f[per]), src: () => perSrc(f, per, asof) }, { label: 'מסלולים מדורגים', v: nf(n, 0) }, { label: 'מסלולים עם תשואה גבוהה יותר', v: nf(rank - 1, 0) }] });
const topSrc = (f: Fund): Prov => ({ k: 'calc', title: `רבע עליון · ${f.name}`, value: `${f.top}/${f.yrs}`,
  formula: 'בכמה מהשנים הקלנדריות המלאות מתוך חמש האחרונות תשואת המסלול (ריבית דריבית על 12 תשואות חודשיות) הייתה ברבע העליון של הקטגוריה: מקום ≤ ⌈n÷4⌉, בקטגוריה של 4 מסלולים לפחות',
  inputs: [{ label: 'שנים ברבע העליון', v: nf(f.top ?? 0, 0) }, { label: 'שנים שנבדקו', v: nf(f.yrs ?? 0, 0) }], note: 'מחושב מתשואות כל חברי הקטגוריה היום, בבניית הנתונים' });
/** the source of a rating component's value */
const compSrc = (f: Fund, c: 'sharpe' | 'ret' | 'cons' | 'fee', asof: number): (() => Prov) | undefined =>
  c === 'sharpe' ? () => plain(f, asof, 'sharpe') : c === 'fee' ? () => plain(f, asof, 'fee') : c === 'cons' ? (f.yrs ? () => topSrc(f) : undefined) : () => perSrc(f, f.a5 != null ? 'a5' : 'a3', asof);
/** A category average over its last n months: asset-weighted monthly returns of today's members, compounded. */
const CAT_F = 'ממוצע משוקלל נכסים של תשואות חברי הקטגוריה בכל חודש (MONTHLY_YIELD), ובריבית דריבית על חודשי התקופה';
const catSrc = (title: string, c: FundCats[string], n: number, value: string, formula = CAT_F): Prov => {
  const k = Math.min(n, c.y.length);
  return { k: 'calc', title, value, formula,
    inputs: c.p.slice(-k).map((p, i) => ({ label: `ממוצע הקטגוריה · ${ym(p)} · ${c.n[c.n.length - k + i]} מסלולים`, v: sn(c.y[c.y.length - k + i], 2) + '%' })), note: 'חברי הקטגוריה כפי שהם בחודש האחרון' };
};
type Stats = NonNullable<ReturnType<typeof stats>>;
type CmpRow = { f: Fund; nn: number; s: Stats | null };
const STAT_F = { ann: '(1 + תשואה מצטברת) בחזקת 12 ÷ מספר החודשים, פחות 1', vol: 'סטיית תקן של התשואות החודשיות כפול שורש 12', dd: 'הירידה הגדולה ביותר ממדד התשואה המצטברת, משיאו לשפל שאחריו', best: 'התשואה החודשית הגבוהה בחלון', worst: 'התשואה החודשית הנמוכה בחלון' };
/** A statistic of a track over its last n monthly returns, with the months behind it. */
function statSrc(f: TrackRef, h: FundHist, n: number, kind: 'ret' | 'ann' | 'vol' | 'dd' | 'best' | 'worst' | 'months', s: Stats): Prov {
  const tail = h.y.slice(-n), ps = h.p.slice(-n).filter((_, i) => tail[i] != null), months = () => ps.map((p) => monthIn(f, 'y', p, h.y[h.p.indexOf(p)]));
  if (kind === 'ret') return retP(f, ps, pc(s.ret), 'תשואה בחלון');
  if (kind === 'months') return countP(`חודשים בחלון · ${f.name}`, s.months, 'החודשים בחלון שבהם פורסמה תשואה חודשית');
  if (kind === 'best' || kind === 'worst') { const v = kind === 'best' ? s.best : s.worst, p = ps.find((x) => h.y[h.p.indexOf(x)] === v) ?? ps[0]; return fundP(f, p, 'MONTHLY_YIELD', kind === 'best' ? 'חודש טוב' : 'חודש גרוע', pc(v)); }
  if (kind === 'ann') return { k: 'calc', title: `תשואה שנתית · ${f.name}`, value: pc(s.ann), formula: STAT_F.ann, inputs: [{ label: 'תשואה מצטברת בחלון', v: pc(s.ret), src: () => retP(f, ps, pc(s.ret), 'תשואה בחלון') }, { label: 'חודשים', v: nf(s.months, 0) }] };
  return { k: 'calc', title: `${kind === 'vol' ? 'תנודתיות שנתית' : 'ירידה מרבית'} · ${f.name}`, value: kind === 'vol' ? nf(s.vol, 1) + '%' : pc(s.dd), formula: STAT_F[kind], inputs: months() };
}
/** The same statistics for the category average: monthly averages with no further source. */
function catStatSrc(title: string, c: { p: number[]; y: number[]; n: number[] }, n: number, kind: 'ret' | 'ann' | 'vol' | 'dd' | 'best' | 'worst', s: Stats): Prov {
  const v = kind === 'vol' ? nf(s.vol, 1) + '%' : pc(s[kind]);
  return catSrc(`${title} · ${kind}`, c, n, v, kind === 'ret' ? CAT_F : STAT_F[kind]);
}
/** A point on the rebased growth chart: 100 times the compounded monthly returns up to that month. */
function idxSrc(name: string, axis: number[], di: number, value: number, f?: TrackRef, c?: { p: number[]; y: number[] }): Prov {
  const ps = axis.slice(1, di + 1);
  return { k: 'calc', title: `תשואה מצטברת, בסיס 100 · ${name} · ${ym(axis[di])}`, value: nf(value, 1), formula: `100 × (1 + r₁) × … × (1 + rₙ) על התשואות החודשיות מ-${ym(axis[1] ?? axis[0])} עד ${ym(axis[di])}. הבסיס: סוף ${ym(axis[0])}`,
    inputs: f ? ps.map((p) => monthIn(f, 'y', p)) : ps.map((p) => { const i = c!.p.indexOf(p); return { label: `ממוצע הקטגוריה · ${ym(p)}`, v: i < 0 ? '–' : sn(c!.y[i], 2) + '%' }; }) };
}
const catKey = (f: Fund) => `${f.prod} | ${f.track}`;
const tone = (v: number | null | undefined) => (v == null ? '' : v < 0 ? 'neg' : 'pos');
const P = ({ v, d = 1 }: { v: number | null | undefined; d?: number }) => (v == null ? <span className="muted">–</span> : <span className={`num ${tone(v)}`}>{pct(v, d, true)}</span>);

/** Compounded return, annualised volatility and the deepest peak-to-trough fall over the last `n` monthly returns. All derived from the published monthly returns. */
function stats(y: (number | null)[], n: number) {
  const s = y.slice(-n).filter((x): x is number => x != null);
  if (s.length < Math.min(n, 3)) return null;
  let idx = 1, peak = 1, dd = 0;
  s.forEach((r) => { idx *= 1 + r / 100; peak = Math.max(peak, idx); dd = Math.min(dd, idx / peak - 1); });
  const mean = s.reduce((t, r) => t + r, 0) / s.length;
  const sd = Math.sqrt(s.reduce((t, r) => t + (r - mean) ** 2, 0) / Math.max(1, s.length - 1));
  return { ret: (idx - 1) * 100, ann: (idx ** (12 / s.length) - 1) * 100, vol: sd * Math.sqrt(12), dd: dd * 100, best: Math.max(...s), worst: Math.min(...s), months: s.length };
}
/** Series rebased to 100 at the start of the common window. */
function rebased(periods: number[], series: { p: number[]; y: (number | null)[] }) {
  const at = new Map(series.p.map((p, i) => [p, series.y[i]]));
  let idx = 100;
  return periods.map((p, i) => { const r = at.get(p); if (i === 0) return 100; if (r == null) return null; idx *= 1 + r / 100; return +idx.toFixed(2); });
}
const catReturn = (c: FundCats[string] | undefined, per: Per, asof: number) => {
  if (!c) return null;
  const n = per === 'm1' ? 1 : per === 'ytd' ? asof % 100 : per === 'y12' ? 12 : per === 'a3' ? 36 : 60;
  const s = stats(c.y, n);
  return !s || s.months < n ? null : per === 'a3' || per === 'a5' ? s.ann : s.ret;
};


function Growth({ periods, lines, deps, onPoint }: { periods: number[]; lines: { name: string; data: (number | null)[]; dash?: boolean }[]; deps: unknown[]; onPoint?: (si: number, di: number) => void }) {
  return (
    <Chart label="תשואה מצטברת, בסיס 100" height={320} deps={deps} onPoint={onPoint} build={() => {
      const b = chartBase(), pal = palette();
      return foxOption({ x: periods.map(ym), unit: 'בסיס 100', dense: true, scale: true, legend: true,
        series: lines.map((l, i) => ({ name: l.name, data: l.data, kind: 'line' as const, dashed: l.dash, color: l.dash ? b.mu : pal[i % pal.length], dec: 1 })) });
            }} />
  );
}

/** Every savings track the regulator publishes, compared inside its own product and track. */
/** `makersOnly`: the makers-vs-market matrix alone; `embedded`: inside the managers page, which carries the section head */
export function Funds({ makersOnly = false, embedded = false }: { makersOnly?: boolean; embedded?: boolean }) {
  const { data, error } = useFunds();
  const cats = useFundCats().data;
  const [sp, setSp] = useSearchParams();
  // a search arriving from elsewhere (the palette, an old /market/funds?q= link) opens the product and track of the first match
  const hit = !sp.get('prod') && sp.get('q') ? data?.funds.find((f) => f.name.includes(sp.get('q')!.trim())) : undefined;
  const prod = sp.get('prod') ?? hit?.prod ?? 'השתלמות', track = sp.get('track') ?? hit?.track ?? 'כללי', per = (sp.get('per') as Per) ?? 'y12';
  const sel = useMemo(() => (sp.get('sel') ?? '').split(',').filter(Boolean), [sp]);
  const [closed, setClosed] = useState(false);
  // search, the closed-fund switch and the ranking period sit behind one button on a phone, so the first screen shows figures
  const [more, setMore] = useState(() => window.matchMedia('(min-width: 761px)').matches);
  const [q, setQ] = useState(sp.get('q') ?? '');
  // numeric screens: they hide rows, the rank stays the rank within the whole category
  const num = (k: string) => { const v = sp.get(k); return v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
  const [feeMax, setFeeMax] = useState<number | null>(num('fmax'));
  const [sharpeMin, setSharpeMin] = useState<number | null>(num('smin'));
  const [assetsMin, setAssetsMin] = useState<number | null>(num('amin'));
  const screened = (f: Fund) => (feeMax == null || (f.fee != null && f.fee <= feeMax)) && (sharpeMin == null || (f.sharpe != null && f.sharpe >= sharpeMin)) && (assetsMin == null || (f.assets != null && f.assets >= assetsMin));
  const [win, setWin] = useState<Win>('60');
  const { open: openSrc } = useSource();
  const set = (patch: Record<string, string>) => { const next = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k))); setSp(next, { replace: true }); };

  // a track with no assets is not ranked; a Sharpe ratio over a series with no volatility (personally managed tracks report sd 0) says nothing
  const all = useMemo(() => (data?.funds ?? []).filter((f) => f.assets !== 0).map((f) => (f.sd != null && f.sd > 0 ? f : { ...f, sharpe: null })), [data]);
  const tracks = useMemo(() => { const m = new Map<string, number>(); all.filter((f) => f.prod === prod).forEach((f) => m.set(f.track, (m.get(f.track) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [all, prod]);
  const ALL = 'all';
  const T = makersOnly || track === ALL || tracks.some(([t]) => t === track) ? (makersOnly ? ALL : track) : tracks[0]?.[0] ?? '';
  const [open, setOpen] = useState<string[]>([]);
  // one group per track; a single track is the same table with one group
  const groups = useMemo(() => {
    const t = q.trim();
    return (T === ALL ? tracks.map(([x]) => x) : [T]).map((tr) => {
      const shown = all.filter((f) => f.prod === prod && f.track === tr && (closed || !f.closed));  // the rank is among the tracks on screen
      const ranked = shown.filter((f) => f[per] != null).sort((a, b) => b[per]! - a[per]!);
      const rank = new Map(ranked.map((f, i) => [f.k, i + 1]));
      const list = [...ranked, ...shown.filter((f) => f[per] == null)].filter((f) => (!t || f.name.includes(t) || f.mgr.includes(t) || f.grp.includes(t)) && screened(f)).map((f) => ({ f, rank: rank.get(f.k) ?? null, r: rate(f, shown) }));
      return { tr, list, n: ranked.length, assets: shown.reduce((u, f) => u + (f.assets ?? 0), 0), cat: cats?.[`${prod} | ${tr}`] };
    }).filter((g) => g.list.length).sort((x, y) => y.assets - x.assets);
  }, [all, tracks, T, prod, per, closed, q, cats, feeMax, sharpeMin, assetsMin]);  // eslint-disable-line react-hooks/exhaustive-deps
  const rows = { n: groups.reduce((u, g) => u + g.n, 0) };
  // the highlighted manufacturer may arrive as a company id (from search or a company page) or as the group name
  const regs = useRegistry().data;
  const mk = sp.get('mk') ?? '';
  const maker = regs?.find((c) => c.id === mk)?.market_group ?? mk;
  // manufacturer against the market: where each managing group stands in every track (its largest track there, ranked on the chosen period)
  const makers = useMemo(() => {
    const size = new Map<string, number>();
    groups.forEach((g) => g.list.forEach(({ f }) => size.set(f.grp, (size.get(f.grp) ?? 0) + (f.assets ?? 0))));
    const top = [...size.entries()].filter(([n]) => n !== 'קרנות ענפיות ואחרות').sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n]) => n);
    // the chosen manufacturer leads, so it is the first column on a phone, and is shown even when it is not among the largest
    const names = maker && size.has(maker) ? [maker, ...top.filter((n) => n !== maker)] : top;
    const cell = (g: typeof groups[number], name: string) => g.list.filter((x) => x.f.grp === name && x.rank != null).sort((a, b) => (b.f.assets ?? 0) - (a.f.assets ?? 0))[0] ?? null;
    const score = names.map((name) => { const c = groups.map((g) => ({ g, x: cell(g, name) })).filter((y) => y.x && y.g.n >= 4); return { n: c.length, top: c.filter((y) => y.x!.rank! <= Math.ceil(y.g.n / 4)).length }; });
    return { names, cell, score };
  }, [groups, maker]);

  const cat = T === ALL ? undefined : cats?.[`${prod} | ${T}`];

  // histories of the tracks picked for comparison
  const [hist, setHist] = useState<Record<string, FundHist>>({});
  useEffect(() => { sel.filter((k) => !hist[k]).forEach((k) => load<FundHist>(`funds/${k}.json`).then((h) => { const f = all.find((x) => x.k === k); if (f) seedHist(ref(f), h); setHist((cur) => ({ ...cur, [k]: h })); }, () => {})); }, [sel, hist]);
  const picked = sel.map((k) => all.find((f) => f.k === k)).filter((f): f is Fund => !!f && !!hist[f.k]);
  const n = win === 'max' ? Infinity : Number(win);
  const axis = useMemo(() => {
    if (!picked.length) return [];
    const start = Math.max(...picked.map((f) => hist[f.k].p[Math.max(0, hist[f.k].p.length - (n === Infinity ? hist[f.k].p.length : n + 1))]));
    return hist[picked[0].k].p.filter((p) => p >= start);
  }, [picked, hist, n]);

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="קופות" />;
  const asof = data.asof;
  const toggle = (k: string) => set({ sel: (sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k].slice(-6)).join(',') });

  const shownOf = (tr: string) => all.filter((f) => f.prod === prod && f.track === tr && (closed || !f.closed));
  const CatP = ({ g, k }: { g: (typeof groups)[number]; k: Per }) => {
    const v = catReturn(g.cat, k, asof);
    if (v == null || !g.cat) return <P v={null} />;
    const n = k === 'm1' ? 1 : k === 'ytd' ? asof % 100 : k === 'y12' ? 12 : k === 'a3' ? 36 : 60;
    return <Sourced src={() => catSrc(`${PER_LABEL[k]}, ממוצע המסלולים · ${prod} | ${g.tr}`, g.cat!, n, pc(v), k === 'a3' || k === 'a5' ? CAT_F + '. השנתי: (1 + תשואה מצטברת) בחזקת 12 ÷ חודשים, פחות 1' : CAT_F)}><P v={v} /></Sourced>;
  };
  const AssetsOf = ({ g }: { g: (typeof groups)[number] }) => <Sourced src={() => listP(`נכסים · ${prod} | ${g.tr}`, nf(g.assets, 0), 'מיליוני ש"ח', 'סכום TOTAL_ASSETS של המסלולים המוצגים בקטגוריה', shownOf(g.tr).filter((f) => f.assets != null).sort((a, b) => b.assets! - a.assets!).map((f) => ({ label: f.name, v: nf(f.assets!, 1), src: () => plain(f, asof, 'assets') })))}><span className="num">{nf(g.assets, 0)}</span></Sourced>;
  const CatCount = ({ g }: { g: (typeof groups)[number] }) => <Sourced src={() => countP(`מסלולים · ${prod} | ${g.tr}`, g.list.length, 'המסלולים המוצגים בקטגוריה')}>{g.list.length}</Sourced>;

  return (
    <>
      {!embedded && <FundsHead sub={<>{makersOnly ? 'יצרן מול השוק' : 'מסלולים'} · <Sourced src={() => countP('מסלולים פעילים', all.length, 'המסלולים שפורסמו בחודש האחרון בגמל-נט, פנסיה-נט וביטוח-נט')}><span className="num">{nf(all.length, 0)}</span></Sourced> מסלולים · {ym(asof)} · {data.source}</>} />}
      <section className="controls tight">
        <div className="prim">
          <Field label="מוצר"><select value={prod} onChange={(e) => set({ prod: e.target.value, track: '', sel: '' })}>{PRODUCTS.filter((p) => all.some((f) => f.prod === p)).map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
          {!makersOnly && <Field label="מסלול"><select value={T} onChange={(e) => set({ track: e.target.value, sel: '' })}><option value={ALL}>כל המסלולים ({tracks.reduce((u, [, c]) => u + c, 0)})</option>{tracks.map(([t, c]) => <option key={t} value={t}>{t} ({c})</option>)}</select></Field>}
          <div className="field more-btn"><span>עוד</span><button type="button" className={`btn${more ? ' primary' : ''}`} aria-expanded={more} onClick={() => setMore((v) => !v)}>{`אפשרויות${per !== 'y12' || q || closed ? ' •' : ''}`}</button></div>
        </div>
        <div className={`extra${more ? '' : ' shut'}`}>
          <div className="field"><span>דירוג לפי</span><Seg label="תקופה" value={per} onChange={(v) => set({ per: v })} options={PERIODS} /></div>
          {!makersOnly && <Field label="חיפוש"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם קופה או גוף" /></Field>}
          {!makersOnly && <div className="field screen"><span>סינון{(feeMax ?? sharpeMin ?? assetsMin) != null && <button type="button" className="linkbtn" onClick={() => { setFeeMax(null); setSharpeMin(null); setAssetsMin(null); }}>ניקוי</button>}</span><div className="screen-in">
            <label>דמי ניהול עד <input type="number" inputMode="decimal" step="0.05" min="0" value={feeMax ?? ''} onChange={(e) => setFeeMax(e.target.value === '' ? null : Number(e.target.value))} aria-label="דמי ניהול מקסימליים, אחוז" />%</label>
            <label>שארפ מ- <input type="number" inputMode="decimal" step="0.1" value={sharpeMin ?? ''} onChange={(e) => setSharpeMin(e.target.value === '' ? null : Number(e.target.value))} aria-label="שארפ מינימלי" /></label>
            <label>נכסים מ- <input type="number" inputMode="numeric" step="100" min="0" value={assetsMin ?? ''} onChange={(e) => setAssetsMin(e.target.value === '' ? null : Number(e.target.value))} aria-label="נכסים מינימליים, מיליוני ש&quot;ח" />מ׳ ש"ח</label>
          </div></div>}
          <button type="button" className="chip" aria-pressed={closed} onClick={() => setClosed(!closed)}>כולל קופות ענפיות ומפעליות</button>
        </div>
      </section>

      {T === ALL && makers.names.length > 0 && (
        <Panel title="יצרן מול השוק" aside={<><span>מקום בכל מסלול לפי {PERIODS.find(([k]) => k === per)?.[1]} · המסלול הגדול של היצרן</span><span className="chip est">נגזר</span></>}>
          <div className="scroll"><table className="heat">
            <thead><tr><th>מסלול</th>{makers.names.map((n) => <th key={n} className={n === maker ? 'on' : ''}><button type="button" className="thbtn" aria-pressed={n === maker} onClick={() => set({ mk: n === maker ? '' : n })}>{n}</button></th>)}</tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.tr}>
                  <td><Link className="name" to={`/funds?prod=${encodeURIComponent(prod)}&track=${encodeURIComponent(g.tr)}`}>{g.tr}</Link> <span className="muted num">{g.n}</span></td>
                  {makers.names.map((n) => { const x = makers.cell(g, n); const q4 = x && g.n >= 4 ? (x.rank! <= Math.ceil(g.n / 4) ? 'pos' : x.rank! > g.n - Math.floor(g.n / 4) ? 'neg' : '') : '';
                    return <td key={n} className={`${n === maker ? 'on' : ''} ${q4 ? 'q-' + q4 : ''}`}>{x ? <Sourced className="num" href={`/funds/${x.f.k}`} title={`${x.f.name} · ${pct(x.f[per]!, 1, true)} · מקום ${x.rank} מתוך ${g.n}`} src={() => rankSrc(x.f, per, asof, x.rank!, g.n)}>{x.rank}</Sourced> : <span className="muted">·</span>}</td>; })}
                </tr>
              ))}
              <tr className="tot"><td>רבע עליון</td>{makers.score.map((sc, i) => <td key={i} className={makers.names[i] === maker ? 'on' : ''}>{sc.n ? <Sourced src={() => listP(`רבע עליון · ${makers.names[i]}`, `${sc.top}/${sc.n}`, undefined, 'בכמה מהמסלולים שבהם ליצרן מסלול מדורג, והקטגוריה כוללת 4 מדורגים לפחות, מקומו ברבע העליון: מקום ≤ ⌈n÷4⌉',
              groups.map((g) => ({ g, x: makers.cell(g, makers.names[i]) })).filter((y) => y.x && y.g.n >= 4).map((y) => ({ label: `${y.g.tr} · ${y.x!.f.name}`, v: `${y.x!.rank} מתוך ${y.g.n}`, src: () => rankSrc(y.x!.f, per, asof, y.x!.rank!, y.g.n) })))}><span className="num">{`${sc.top}/${sc.n}`}</span></Sourced> : <span className="num">–</span>}</td>)}</tr>
            </tbody>
          </table></div>
          <div className="fnote">ירוק: רבע עליון במסלול. אדום: רבע תחתון. לחיצה על יצרן מדגישה את העמודה שלו; לחיצה על מסלול פותחת את הדירוג המלא.</div>
        </Panel>
      )}

      {!makersOnly && <Panel title={`${prod} · ${T === ALL ? 'כל המסלולים' : T}`} aside={<>{T === ALL && <button type="button" className="chip" onClick={() => setOpen(open.length ? [] : groups.map((g) => g.tr))}>{open.length ? 'כווץ הכול' : 'פתח הכול'}</button>}<span><Sourced src={() => countP('מסלולים מדורגים', rows.n, 'המסלולים בטבלה שיש להם תשואה בתקופה שנבחרה')}>{rows.n}</Sourced> מדורגים</span><span className="chip">3Y ו-5Y: שנתי ממוצע</span>{prod === 'פוליסות חיסכון' && <span className="chip est" title="ביטוח-נט מפרסם מסלולי השקעה. פוליסת חיסכון וביטוח מנהלים שהונפק מ-2004 מושקעים באותו מסלול, ולכן התשואה זהה; הנכסים ודמי הניהול הממוצעים כוללים את שני המוצרים">תשואת המסלול; נכסים ודמי ניהול כוללים גם ביטוחי מנהלים מ-2004</span>}{T === ALL && <span>שורת קבוצה: ממוצע המסלול, משוקלל נכסים</span>}<span>סמן עד 6 להשוואה</span></>}>
        {groups.length === 0 ? <Empty title="אין מסלולים בסינון הזה" /> : (
          <div className="scroll" style={{ maxHeight: 640 }}><table className="rank">
            <thead><tr><th>מסלול</th><th>#</th>{PERIODS.map(([k, l]) => <th key={k} className={k === per ? '' : 'wide-only'}>{l}</th>)}<th>דמי ניהול</th><th className="wide-only">נכסים, מיליוני ש"ח</th><th className="wide-only">שארפ</th><th className="wide-only">מניות</th><th className="wide-only" title="בכמה מחמש השנים הקלנדריות המלאות האחרונות המסלול סיים ברבע העליון של המסלולים בקטגוריה">רבע עליון <span className="chip est">נגזר</span></th><th className="wide-only" title={RATING_NOTE}>דירוג fox</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.tr}>
                  {T === ALL && (
                    <tr className="sec grp" onClick={(e) => { if ((e.target as Element).closest('a.src, button.src')) return; setOpen(open.includes(g.tr) ? open.filter((x) => x !== g.tr) : [...open, g.tr]); }} aria-expanded={open.includes(g.tr)}>
                      <td><button type="button" className="twist" aria-label={open.includes(g.tr) ? `כווץ את ${g.tr}` : `פתח את ${g.tr}`}>{open.includes(g.tr) ? '▾' : '◂'}</button>{g.tr} <span className="muted" style={{ fontWeight: 400 }}>· <CatCount g={g} /></span></td>
                      <td></td>{PERIODS.map(([k]) => <td key={k} className={k === per ? '' : 'wide-only'}><CatP g={g} k={k} /></td>)}<td></td>
                      <td className="wide-only"><AssetsOf g={g} /></td><td className="wide-only"></td><td className="wide-only"></td><td className="wide-only"></td><td className="wide-only"></td>
                    </tr>
                  )}
                  {g.cat && T !== ALL && <tr className="lead"><td>ממוצע המסלול<span className="dim">משוקלל נכסים · נגזר</span></td><td></td>{PERIODS.map(([k]) => <td key={k} className={k === per ? '' : 'wide-only'}><CatP g={g} k={k} /></td>)}<td></td><td className="wide-only"><AssetsOf g={g} /></td><td className="wide-only"></td><td className="wide-only"></td><td className="wide-only"></td><td className="wide-only"></td></tr>}
              {(T !== ALL || open.includes(g.tr)) && g.list.map(({ f, rank, r: rt }) => (
                <tr key={f.k} onPointerEnter={() => warmHist(ref(f))}>
                  <td><span style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><label className="fund-pick" title={`השוואה: ${f.name}`}><input type="checkbox" checked={sel.includes(f.k)} onChange={() => toggle(f.k)} aria-label={`השווה את ${f.name}`} style={{ marginTop: 4, accentColor: 'var(--accent)' }} /></label>
                    <span><Link className="name" to={`/funds/${f.k}`}>{f.name}</Link>{f.closed && <span className="chip" style={{ marginInlineStart: 6 }}>סגורה</span>}<span className="fund-mgr"><MgrChip grp={f.grp} mgr={f.mgr} short /></span></span></span></td>
                  <td>{rank == null ? <span className="num muted">–</span> : <Sourced src={() => rankSrc(f, per, asof, rank, g.n)}><span className="num muted">{rank}</span></Sourced>}</td>
                  {PERIODS.map(([k]) => <td key={k} className={k === per ? '' : 'wide-only'}>{f[k] == null ? <P v={null} /> : <Sourced src={() => perSrc(f, k, asof)}><P v={f[k]} /></Sourced>}</td>)}
                  <td>{f.fee == null ? <span className="muted">–</span> : <Sourced src={() => plain(f, asof, 'fee')}><span className="num">{nf(f.fee, 2)}%</span></Sourced>}</td>
                  <td className="wide-only">{f.assets == null ? <span className="num">–</span> : <Sourced src={() => plain(f, asof, 'assets')}><span className="num">{nf(f.assets, 0)}</span></Sourced>}</td>
                  <td className="wide-only">{f.sharpe == null ? <span className="num">–</span> : <Sourced src={() => plain(f, asof, 'sharpe')}><span className="num">{nf(f.sharpe, 2)}</span></Sourced>}</td>
                  <td className="wide-only">{f.st == null ? <span className="num">–</span> : <Sourced src={() => expSrc(f, asof, 'st')}><span className="num">{`${nf(f.st, 0)}%`}</span></Sourced>}</td>
                  <td className="wide-only">{f.yrs ? <Sourced src={() => topSrc(f)}><span className={`num ${f.top! * 2 > f.yrs ? 'pos' : ''}`}>{f.top}/{f.yrs}</span></Sourced> : <span className="muted">–</span>}</td>
                  <td className="wide-only">{rt.score == null ? <span className="muted" title={rt.why}>–</span> : <Sourced src={() => ratingProv(f, rt, (c) => compSrc(f, c, asof))}><span className="num">{nf(rt.score, 0)}</span></Sourced>}</td>
                </tr>
              ))}
                </Fragment>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>}

      {!makersOnly && picked.length > 0 && (
        <Panel title="השוואה" aside={<><Seg label="חלון" value={win} onChange={setWin} options={WINDOWS} /><button type="button" className="chip" onClick={() => set({ sel: '' })}>נקה</button></>}>
          <Growth periods={axis} deps={[sel.join(), win, Object.keys(hist).length]} lines={[...picked.map((f) => ({ name: f.name, data: rebased(axis, hist[f.k]) })), ...(cat ? [{ name: 'ממוצע המסלול', data: rebased(axis, cat), dash: true }] : [])]}
            onPoint={(si, di) => { if (di < 1) return; if (si < picked.length) { const v = rebased(axis, hist[picked[si].k])[di]; if (v != null) openSrc(idxSrc(picked[si].name, axis, di, v, ref(picked[si]))); } else if (cat) { const v = rebased(axis, cat)[di]; if (v != null) openSrc(idxSrc(`ממוצע ${T}`, axis, di, v, undefined, cat)); } }} />
          <DataTable caption="השוואת מסלולים" rows={picked.map((f) => { const nn = Math.max(1, axis.length - 1); return { f, nn, s: stats(hist[f.k].y, nn) }; })} rowKey={(r) => r.f.k}
            export={{ name: `fox-funds-compare-${win}`, title: 'השוואת מסלולים', note: `${ym(axis[0])} עד ${ym(axis[axis.length - 1])} · נגזר מהתשואות החודשיות שפורסמו (רשות שוק ההון)` }}
            columns={[
              { key: 'f', head: 'מסלול', value: (r) => r.f.name, cell: (r) => <Link to={`/funds/${r.f.k}`}>{r.f.name}</Link> },
              ...(([['ret', 'תשואה בחלון'], ['ann', 'שנתי'], ['vol', 'תנודתיות, שנתי'], ['dd', 'ירידה מרבית'], ['best', 'חודש טוב'], ['worst', 'חודש גרוע']] as const).map(([kind, head]): Column<CmpRow> => ({
                key: kind, head, value: (r) => r.s?.[kind], unit: 'pct', signed: kind !== 'vol', tone: kind !== 'vol',
                src: (r) => (r.s ? statSrc(ref(r.f), hist[r.f.k], r.nn, kind, r.s) : null),
              }))),
              { key: 'fee', head: 'דמי ניהול', value: (r) => r.f.fee, unit: 'pct', d: 2, src: (r) => plain(r.f, asof, 'fee') },
              { key: 'months', head: 'חודשים', value: (r) => r.s?.months, unit: 'int', src: (r) => (r.s ? statSrc(ref(r.f), hist[r.f.k], r.nn, 'months', r.s) : null) },
            ]} />
          <div className="fnote">תשואה, תנודתיות וירידה מרבית מחושבות מהתשואות החודשיות שפורסמו. החלון מתחיל במועד שבו לכל המסלולים שנבחרו יש נתונים.</div>
        </Panel>
      )}
    </>
  );
}

/** One track: its record against the category, year by year, with exposure and money flows. */
export function FundCard() {
  const { k = '' } = useParams();
  // a track key is a letter and a number (p2009, g103, i512): anything else is answered before 1 MB of fund data is fetched
  const valid = /^[gip]\d+$/.test(k);
  const { data, error } = useFunds(valid);
  const hist = useFundHist(valid ? k : null);
  const cats = useFundCats(valid).data;
  const [win, setWin] = useState<Win>('60');
  const { open } = useSource();
  const f = data?.funds.find((x) => x.k === k);
  const h = hist.data;
  const cat = f && cats ? cats[catKey(f)] : undefined;
  const company = useRegistry().data?.find((c) => f && c.market_group === f.grp);
  // ranked against the tracks open to everyone, as in the table
  const peers = useMemo(() => (data && f ? data.funds.filter((x) => catKey(x) === catKey(f) && (f.closed || !x.closed) && x.assets !== 0) : []), [data, f]);
  const years = useMemo(() => {
    if (!h) return [];
    const by = (s: { p: number[]; y: (number | null)[] }) => { const m = new Map<number, { r: number[]; p: number[] }>(); s.p.forEach((p, i) => { const r = s.y[i], y = Math.floor(p / 100); if (r != null) { const e = m.get(y) ?? { r: [], p: [] }; e.r.push(r); e.p.push(p); m.set(y, e); } }); return m; };
    const mine = by(h), theirs = cat ? by(cat) : new Map<number, { r: number[]; p: number[] }>();
    const comp = (xs: number[] | undefined) => (xs ? (xs.reduce((t, r) => t * (1 + r / 100), 1) - 1) * 100 : null);
    return [...mine.keys()].sort((a, b) => b - a).map((y) => ({ y, n: mine.get(y)!.r.length, ps: mine.get(y)!.p, cps: theirs.get(y)?.p ?? [], me: comp(mine.get(y)?.r), cat: theirs.get(y)?.r.length === mine.get(y)!.r.length ? comp(theirs.get(y)?.r) : null }));
  }, [h, cat]);

  if (!valid) return <Empty title="המסלול לא נמצא או אינו פעיל"><Link to="/funds">לכל המסלולים</Link></Empty>;
  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data || (!h && !hist.error)) return <Loading what="מסלול" />;
  if (!f || !h) return <Empty title="המסלול לא נמצא או אינו פעיל"><Link to="/funds">לכל המסלולים</Link></Empty>;
  const n = win === 'max' ? h.p.length - 1 : Math.min(Number(win), h.p.length - 1);
  const axis = h.p.slice(-(n + 1));
  const s = stats(h.y, n), cs = cat ? stats(cat.y.slice(0, cat.p.indexOf(axis[axis.length - 1]) + 1), n) : null;
  seedHist(ref(f), h);
  const asof = data.asof, R0 = ref(f);
  const rankOf = (key: Per) => { const r = peers.filter((x) => x[key] != null).sort((a, b) => b[key]! - a[key]!); const i = r.findIndex((x) => x.k === f.k); return i < 0 ? null : `${i + 1} מתוך ${r.length}`; };
  /** "מקום 3 מתוך 40" as a figure that opens its calculation */
  const RK = ({ k }: { k: Per }) => { const t = rankOf(k); if (!t) return <>{' '}</>; const [a, b] = t.split(' מתוך ').map(Number); return <>מקום <Sourced src={() => rankSrc(f, k, asof, a, b)}>{t}</Sourced></>; };
  const SRC = (src: () => Prov, child: React.ReactNode) => <Sourced src={src}>{child}</Sourced>;
  const catYear = (r: (typeof years)[number]): Prov => catSrc(`תשואה ${r.y}, ממוצע ${f.track}`, { p: r.cps, y: r.cps.map((p) => cat!.y[cat!.p.indexOf(p)]), n: r.cps.map((p) => cat!.n[cat!.p.indexOf(p)]) }, r.cps.length, pc(r.cat));
  const catRows = cat ? { p: cat.p.slice(0, cat.p.indexOf(axis[axis.length - 1]) + 1), y: cat.y.slice(0, cat.p.indexOf(axis[axis.length - 1]) + 1), n: cat.n.slice(0, cat.p.indexOf(axis[axis.length - 1]) + 1) } : null;
  const SS = (kind: 'ret' | 'ann' | 'vol' | 'dd' | 'best' | 'worst', child: React.ReactNode, cs_?: boolean) => {
    const st = cs_ ? cs : s; if (!st) return child;
    return <Sourced src={() => (cs_ ? catStatSrc(`ממוצע ${f.track}`, catRows!, n, kind, st) : statSrc(R0, h, n, kind, st))}>{child}</Sourced>;
  };
  const crisisP = (c: (typeof CRISES)[number], x: ReturnType<typeof crisis>, who: string, own: boolean): Prov => ({ k: 'calc', title: `${c.label} · ${who}`, value: ddText(x), formula: `${CRISIS_FORMULA}. בסיס: סוף ${ym(c.base)}; חלון השפל: עד ${ym(c.to)}`,
    inputs: [{ label: 'שפל', v: x ? ym(x.trough) : '–' }, { label: 'חודשים להתאוששות', v: x?.rec == null ? 'טרם' : nf(x.rec, 0) }, ...(x ? x.months.map((p) => own ? monthIn(R0, 'y', p, h.y[h.p.indexOf(p)]) : { label: `ממוצע הקטגוריה · ${ym(p)}`, v: cat && cat.p.includes(p) ? sn(cat.y[cat.p.indexOf(p)], 2) + '%' : '–' }) : [])] });
  const expo = (k: keyof typeof EXP, v: number | null | undefined) => (v == null ? '–' : <Sourced src={() => expSrc(f, asof, k)}>{`${nf(v, 0)}%`}</Sourced>);
  const last = <T,>(xs: T[]) => xs.slice(-121);
  const net = h.dep ? [h.dep, h.wd!, h.tr!].reduce((t, xs, i) => t + (i === 1 ? -1 : 1) * xs.slice(-12).reduce((u: number, x) => u + (x ?? 0), 0), 0) : 0;
  const flow12 = (c: 'dep' | 'wd' | 'tr', l: string, shown: number): Prov => c === 'tr' ? flowP(R0, h.p[h.p.length - 1], 'tr', nf(shown, 0))
    : { k: 'calc', title: `${l}, LTM · ${f.name}`, value: nf(shown, 0), unit: 'מיליוני ש"ח', formula: `סכום ${c === 'dep' ? 'DEPOSITS' : 'WITHDRAWLS'} על 12 החודשים האחרונים`, inputs: monthsBack(h.p[h.p.length - 1], 12).map((p) => monthIn(R0, c, p)) };

  return (
    <>
      <div className="pagehead"><div><h1>{f.name}</h1><div className="sub"><span>{f.mgr}</span><MgrChip grp={f.grp} mgr={f.mgr} />{company && <Link className="chip" to={`/company/${company.id}`}>עמוד החברה: {company.name_he}</Link>}<Link className="chip" to={`/funds?prod=${encodeURIComponent(f.prod)}&track=${encodeURIComponent(f.track)}`}>{f.prod} · {f.track}</Link>{f.closed && <span className="chip">קופה ענפית או מפעלית</span>}<span className="chip">{ym(data.asof)}</span></div></div></div>
      <FundsNav />
      <section className="kpis">
        <Kpi label="LTM" value={f.y12 == null ? '–' : SRC(() => perSrc(f, 'y12', asof), pct(f.y12, 1, true))} tone={f.y12 == null ? undefined : f.y12 < 0 ? 'neg' : 'pos'} sub={rankOf('y12') ? <RK k="y12" /> : ' '} />
        <Kpi label="3Y, שנתי" value={f.a3 == null ? '–' : SRC(() => perSrc(f, 'a3', asof), pct(f.a3, 1, true))} sub={rankOf('a3') ? <RK k="a3" /> : ' '} />
        <Kpi label="5Y, שנתי" value={f.a5 == null ? '–' : SRC(() => perSrc(f, 'a5', asof), pct(f.a5, 1, true))} sub={rankOf('a5') ? <RK k="a5" /> : ' '} />
        <Kpi label="YTD" value={f.ytd == null ? '–' : SRC(() => perSrc(f, 'ytd', asof), pct(f.ytd, 1, true))} sub={rankOf('ytd') ? <RK k="ytd" /> : ' '} />
        <Kpi label="דמי ניהול מצבירה" value={f.fee == null ? '–' : SRC(() => plain(f, asof, 'fee'), `${nf(f.fee, 2)}%`)} sub={f.depfee != null ? <>מהפקדה {SRC(() => plain(f, asof, 'depfee'), `${nf(f.depfee!, 2)}%`)}</> : ' '} />
        <Kpi label="נכסים" value={f.assets == null ? '–' : SRC(() => plain(f, asof, 'assets'), nf(f.assets, 0))} sub={'מיליוני ש"ח'} />
        <Kpi label="שארפ" value={f.sharpe == null ? '–' : SRC(() => plain(f, asof, 'sharpe'), nf(f.sharpe, 2))} sub={f.yrs ? <>רבע עליון ב-{SRC(() => topSrc(f), `${f.top} מתוך ${f.yrs}`)} שנים</> : f.sd != null ? <>סטיית תקן {SRC(() => plain(f, asof, 'sd'), nf(f.sd!, 2))}</> : ' '} />
        <Kpi label="חשיפה למניות" value={expo('st', f.st)} sub={f.fo != null ? <>חו"ל {expo('fo', f.fo)} · מט"ח {expo('fx', f.fx)}</> : ' '} />
      </section>

      <div className="grid21">
        <Panel title="תשואה מצטברת, בסיס 100" aside={<Seg label="חלון" value={win} onChange={setWin} options={WINDOWS} />}>
          <Growth periods={axis} deps={[k, win, h.p.length, !!cat]} lines={[{ name: f.name, data: rebased(axis, h) }, ...(cat ? [{ name: `ממוצע ${f.track}`, data: rebased(axis, cat), dash: true }] : [])]}
            onPoint={(si, di) => { if (di < 1) return; const v = rebased(axis, si === 0 ? h : cat!)[di]; if (v != null) open(si === 0 ? idxSrc(f.name, axis, di, v, R0) : idxSrc(`ממוצע ${f.track}`, axis, di, v, undefined, cat!)); }} />
          <div className="scroll"><table>
            <thead><tr><th>{ym(axis[0])} עד {ym(axis[axis.length - 1])} <span className="chip est">נגזר</span></th><th>תשואה</th><th>שנתי</th><th>תנודתיות, שנתי</th><th>ירידה מרבית</th><th>חודש טוב</th><th>חודש גרוע</th></tr></thead>
            <tbody>
              <tr><td>המסלול</td><td>{SS('ret', <P v={s?.ret} />)}</td><td>{SS('ann', <P v={s?.ann} />)}</td><td>{SS('vol', <span className="num">{s ? `${nf(s.vol, 1)}%` : '–'}</span>)}</td><td>{SS('dd', <P v={s?.dd} />)}</td><td>{SS('best', <P v={s?.best} />)}</td><td>{SS('worst', <P v={s?.worst} />)}</td></tr>
              {cs && <tr><td>ממוצע {f.track}</td><td>{SS('ret', <P v={cs.ret} />, true)}</td><td>{SS('ann', <P v={cs.ann} />, true)}</td><td>{SS('vol', <span className="num">{nf(cs.vol, 1)}%</span>, true)}</td><td>{SS('dd', <P v={cs.dd} />, true)}</td><td>{SS('best', <P v={cs.best} />, true)}</td><td>{SS('worst', <P v={cs.worst} />, true)}</td></tr>}
            </tbody>
          </table></div>
        </Panel>
        <Panel title="לפי שנה" aside={<span className="chip est">נגזר מתשואות חודשיות</span>}>
          <DataTable caption="תשואה לפי שנה" maxHeight={470} rows={years} rowKey={(r) => String(r.y)} export={{ name: `fox-fund-${f.k}-years`, title: `תשואה לפי שנה · ${f.name}`, note: 'נגזר מתשואות חודשיות · רשות שוק ההון' }} columns={[
            { key: 'y', head: 'שנה', value: (r) => r.y, cell: (r) => <><span className="num">{r.y}</span>{r.n < 12 && <span className="dim">{r.n} חודשים</span>}</> },
            { key: 'me', head: 'המסלול', value: (r) => r.me, unit: 'pct', signed: true, tone: true, src: (r) => retP(R0, r.ps, pc(r.me), `תשואה ${r.y}`) },
            { key: 'cat', head: 'ממוצע המסלולים', value: (r) => (cat ? r.cat : null), unit: 'pct', signed: true, tone: true, src: (r) => catYear(r) },
            { key: 'gap', head: 'פער', value: (r) => (r.me != null && r.cat != null && cat ? r.me - r.cat : null), unit: 'pct', signed: true, tone: true,
              src: (r) => ({ k: 'calc', title: `פער ${r.y} · ${f.name}`, value: pc(r.me! - r.cat!), formula: 'תשואת המסלול בשנה פחות תשואת ממוצע המסלולים באותה שנה',
                inputs: [{ label: 'המסלול', v: pc(r.me), src: () => retP(R0, r.ps, pc(r.me), `תשואה ${r.y}`) }, { label: `ממוצע ${f.track}`, v: pc(r.cat), src: () => catYear(r) }] }) },
          ]} />
        </Panel>
      </div>

      <div className="grid2">
        <Panel title="משברים" aside={<span className="chip est">נגזר מתשואות חודשיות</span>}>
          <DataTable caption="משברים" rows={CRISES.map((c) => ({ c, me: crisis(h, c.base, c.to), ct: cat ? crisis(cat, c.base, c.to) : null }))} rowKey={(r) => r.c.key}
            export={{ name: `fox-fund-${f.k}-crises`, title: `משברים · ${f.name}`, note: 'נגזר מתשואות חודשיות · רשות שוק ההון' }}
            columns={[
              { key: 'c', head: 'אירוע', value: (r) => r.c.base, text: (r) => `${r.c.label} ${ym(r.c.base)}–${ym(r.c.to)}`, firstDir: 'asc', cell: (r) => <>{r.c.label}<span className="dim num">{ym(r.c.base)} → {ym(r.c.to)}</span></> },
              { key: 'me', head: 'ירידה', value: (r) => r.me?.dd, text: (r) => ddText(r.me), cell: (r) => (r.me == null ? <span className="muted" title="אין תשואות לכל חודשי החלון">–</span> : <Sourced src={() => crisisP(r.c, r.me, f.name, true)}><span className={`num ${r.me.dd < 0 ? 'neg' : ''}`}>{ddText(r.me)}</span></Sourced>) },
              { key: 'ct', head: `ממוצע ${f.track}`, value: (r) => r.ct?.dd, text: (r) => ddText(r.ct), cell: (r) => (r.ct == null ? <span className="muted">–</span> : <Sourced src={() => crisisP(r.c, r.ct, `ממוצע ${f.track}`, false)}><span className={`num ${r.ct.dd < 0 ? 'neg' : ''}`}>{ddText(r.ct)}</span></Sourced>) },
              { key: 'rec', head: 'התאוששות', value: (r) => r.me?.rec, text: (r) => (r.me == null ? '' : r.me.rec == null ? 'טרם' : String(r.me.rec)), firstDir: 'asc', cell: (r) => <span className="num">{r.me == null ? '–' : r.me.rec == null ? 'טרם' : r.me.rec}</span> },
              { key: 'crec', head: 'התאוששות, ממוצע', className: 'wide-only', value: (r) => r.ct?.rec, text: (r) => (r.ct == null ? '' : r.ct.rec == null ? 'טרם' : String(r.ct.rec)), firstDir: 'asc', cell: (r) => <span className="num muted">{r.ct == null ? '–' : r.ct.rec == null ? 'טרם' : r.ct.rec}</span> },
            ]} />
          <div className="fnote">ירידה: מסוף חודש הבסיס עד השפל בחלון. התאוששות: מספר החודשים מהשפל עד חזרה לרמת הבסיס.</div>
        </Panel>
        <RatingPanel f={f} peers={peers} asof={asof} />
      </div>
      <Heatmap h={h} f={R0} />

      <div className="grid2">
        <Panel title="חשיפות" aside={<span>% מהנכסים · 10 שנים</span>}>
          <Chart label="חשיפות" height={260} deps={[k, h.p.length]} onPoint={(si, di) => { const key = (['st', 'fo', 'fx'] as const)[si], ser = [h.st, h.fo, h.fx][si]; if (!key || !ser) return; const pv = last(ser)[di], a = last(h.a)[di], p = last(h.p)[di]; if (pv != null) open(expP(R0, p, EXP[key][0], EXP[key][1], pv, a ?? null)); }} build={() => {
            const pal = palette();
            return foxOption({ x: last(h.p).map(ym), unit: '%', dense: true, full: true,
              series: ([['מניות', h.st], ['חו"ל', h.fo], ['מט"ח', h.fx]] as [string, (number | null)[]][]).map(([name, data], i) => ({ name, data: last(data), kind: 'line' as const, pct: true, color: pal[i] })) });
            }} />
        </Panel>
        <Panel title="נכסים ודמי ניהול" aside={<span>10 שנים · שני צירים נפרדים</span>}>
          <Chart label="נכסים" height={190} deps={[k, h.p.length]} onPoint={(_si, di) => { const p = last(h.p)[di], v = last(h.a)[di]; if (v != null) open(fundP(R0, p, 'TOTAL_ASSETS', 'נכסים', nf(v, 1), 'מיליוני ש"ח')); }} build={() => {
            const b = chartBase();
            return foxOption({ x: last(h.p).map(ym), unit: 'נכסים, מיליוני ש"ח', dense: true, full: true, legend: false, series: [{ name: 'נכסים', data: last(h.a), kind: 'bar', color: b.mu, opacity: 0.45, dec: 0 }] });
            }} />
          <Chart label="דמי ניהול מצבירה" height={140} deps={[k, h.p.length]} onPoint={(_si, di) => { const p = last(h.p)[di], v = last(h.fee)[di]; if (v != null) open(fundP(R0, p, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', nf(v, 2) + '%')); }} build={() => {
            const b = chartBase(), o = foxOption({ x: last(h.p).map(ym), unit: '%', dense: true, full: true, scale: true, legend: false, series: [{ name: 'דמי ניהול מצבירה', data: last(h.fee), kind: 'line', pct: true, color: b.accent, dec: 2 }] });
            ((o as { yAxis: { axisLabel: { formatter: unknown }; name?: string }[] }).yAxis).forEach((y) => { y.axisLabel.formatter = (v: number) => `${nf(v, 2)}%`; y.name = 'דמי ניהול מצבירה, %'; });
            return o;
            }} />
        </Panel>
      </div>
      <Panel title="פרטי המסלול" aside={<span>כפי שמדווח לרשות שוק ההון</span>}>
        <div className="scroll"><table>
          <tbody>
            {([['מספר ברשות', String(f.id)], ['סיווג', f.cls], ['התמחות', [f.spec, f.sub].filter(Boolean).join(' · ') || null], ['אוכלוסיית יעד', f.target], ['מועד הקמה', f.since ? pubLabel(f.since) : null], ['גוף מנהל', f.mgr], ['תאגיד שולט', f.ctrl],
              ['נכסים נזילים', f.liq == null ? null : `${nf(f.liq, 1)}%`, () => fundP(R0, asof, 'LIQUID_ASSETS_PERCENT', 'נכסים נזילים', `${nf(f.liq!, 1)}%`)],
              ['חשיפה למניות', f.st == null ? null : `${nf(f.st, 1)}%`, () => expSrc(f, asof, 'st')], ['חשיפה לחו"ל', f.fo == null ? null : `${nf(f.fo, 1)}%`, () => expSrc(f, asof, 'fo')], ['חשיפה למט"ח', f.fx == null ? null : `${nf(f.fx, 1)}%`, () => expSrc(f, asof, 'fx')],
              ['היסטוריה', `${f.n} חודשים, מ-${ym(h.p[0])}`, () => countP(`חודשי היסטוריה · ${f.name}`, f.n, 'החודשים שבהם פורסמה תשואה חודשית למסלול')]] as [string, string | null, (() => Prov)?][]).filter(([, x]) => x).map(([l, x, src]) => <tr key={l}><td className="muted">{l}</td><td style={{ textAlign: 'start' }}>{src ? <Sourced src={src}>{x}</Sourced> : x}</td></tr>)}
          </tbody>
        </table></div>
        <div className="fnote">הרכב נכסים מפורט ומדיניות השקעה מוצהרת אינם במאגרי הרשות הפתוחים; הם מתפרסמים באתר של כל גוף מנהל.</div>
      </Panel>
      {h.dep && (
        <Panel title="תזרים, LTM" aside={<span>מיליוני ש"ח</span>}>
          <section className="kpis" style={{ border: 0, boxShadow: 'none', background: 'none' }}>
            {([['הפקדות', h.dep, 'dep'], ['משיכות', h.wd!, 'wd'], ['העברות נטו', h.tr!, 'tr']] as const).map(([l, xs, c]) => { const v = xs.slice(-12).reduce((t: number, x) => t + (x ?? 0), 0); return <Kpi key={l} label={l} value={SRC(() => flow12(c, l, l === 'משיכות' ? -v : v), nf(l === 'משיכות' ? -v : v, 0))} tone={l === 'העברות נטו' ? (v < 0 ? 'neg' : 'pos') : undefined} />; })}
            <Kpi label="צבירה נטו" value={SRC(() => ({ k: 'calc', title: `צבירה נטו, LTM · ${f.name}`, value: nf(net, 0), unit: 'מיליוני ש"ח', formula: 'הפקדות פחות משיכות ועוד העברות נטו, 12 החודשים האחרונים',
              inputs: ([['הפקדות', 'dep', h.dep!], ['משיכות', 'wd', h.wd!], ['העברות נטו', 'tr', h.tr!]] as const).map(([l, c, xs]) => { const v = xs.slice(-12).reduce((t: number, x) => t + (x ?? 0), 0), shown = c === 'wd' ? -v : v; return { label: l, v: nf(shown, 0), src: () => flow12(c, l, shown) }; }) }), nf(net, 0))} />
          </section>
        </Panel>
      )}
    </>
  );
}

/** fox's rating of the track in its category: the score, its band and every component, each opening its calculation. */
function RatingPanel({ f, peers, asof }: { f: Fund; peers: Fund[]; asof: number }) {
  const r: Rating = rate(f, peers);
  return (
    <Panel title="דירוג fox" aside={<span className="chip" title={RATING_NOTE}>שיטת fox · לא המלצה</span>}>
      {r.score == null ? <Empty title="לא דורג">{r.why}</Empty> : (
        <div className="rating">
          <div><Sourced src={() => ratingProv(f, r, (c) => compSrc(f, c, asof))}><span className="score num">{nf(r.score, 0)}</span></Sourced><div className="band" role="img" aria-label={`דרגה ${r.band} מתוך 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= r.band! ? 'on' : ''} />)}</div><div className="dim">מתוך 100 · {f.prod} · {f.track} · <span className="num">{peers.length}</span> מסלולים</div></div>
          <div className="scroll"><table>
            <thead><tr><th>רכיב</th><th className="wide-only">משקל</th><th>ערך</th><th>אחוזון</th></tr></thead>
            <tbody>{r.parts.map((x) => { const sv = compSrc(f, x.c.key, asof); return <tr key={x.c.key}><td>{x.c.label}</td><td className="wide-only"><span className="num muted">{x.c.w}</span></td>
              <td>{x.v == null ? '–' : sv ? <Sourced src={sv}><span className="num">{x.c.show(x.v)}</span></Sourced> : <span className="num">{x.c.show(x.v)}</span>}</td>
              <td>{x.p == null ? <span className="muted" title="פחות מ-5 מסלולים עם נתון">–</span> : <Sourced src={() => ({ k: 'calc', title: `אחוזון · ${x.c.label} · ${f.name}`, value: nf(x.p!, 0), formula: '100 × (גרועים + חצי מהשווים) ÷ (n − 1)', inputs: [{ label: 'ערך המסלול', v: x.c.show(x.v!), src: sv }, { label: 'n', v: nf(x.n, 0) }, { label: 'גרועים', v: nf(x.worse, 0) }, { label: 'שווים', v: nf(x.ties, 0) }] })}><span className="num">{nf(x.p, 0)}</span></Sourced>}</td></tr>; })}</tbody>
          </table></div>
        </div>
      )}
      <div className="fnote">{RATING_NOTE} הנוסחה המלאה בפתיחת הציון.</div>
    </Panel>
  );
}

/** monthly returns, year by year: each cell opens its published figure */
function Heatmap({ h, f }: { h: FundHist; f: TrackRef }) {
  const years = [...new Set(h.p.map((p) => Math.floor(p / 100)))].sort((a, b) => b - a).slice(0, 10);
  const at = new Map(h.p.map((p, i) => [p, h.y[i]]));
  const max = Math.max(1, ...h.y.slice(-120).filter((x): x is number => x != null).map(Math.abs));
  const bg = (v: number) => `color-mix(in oklch, var(${v >= 0 ? '--up' : '--down'}) ${Math.round(8 + 55 * Math.min(1, Math.abs(v) / max))}%, transparent)`;
  return (
    <Panel title="תשואות חודשיות" aside={<span>% · 10 שנים · שנה: ריבית דריבית</span>}>
      <div className="scroll"><table className="heat-m">
        <thead><tr><th /> {Array.from({ length: 12 }, (_, i) => <th key={i}>{String(i + 1).padStart(2, '0')}</th>)}<th>שנה</th></tr></thead>
        <tbody>{years.map((y) => { const ms = Array.from({ length: 12 }, (_, i) => y * 100 + i + 1), vals = ms.map((p) => at.get(p) ?? null), have = ms.filter((_p, i) => vals[i] != null);
          const tot = have.length ? (have.reduce((t, p) => t * (1 + at.get(p)! / 100), 1) - 1) * 100 : null;
          return <tr key={y}><td className="y num">{y}</td>{ms.map((p, i) => { const v = vals[i]; return <td key={p} className="c" style={v == null ? undefined : { background: bg(v) }}>{v == null ? '' : <Sourced src={() => fundP(f, p, 'MONTHLY_YIELD', 'תשואה חודשית', pc(v))}><span className="num">{nf(v, 1)}</span></Sourced>}</td>; })}
            <td className="c tot">{tot == null ? '' : <Sourced src={() => retP(f, have, pc(tot), `תשואה ${y}`)}><span className={`num ${tot < 0 ? 'neg' : ''}`}>{nf(tot, 1)}</span></Sourced>}</td></tr>; })}</tbody>
      </table></div>
    </Panel>
  );
}

/** Every managing group against the whole market: its place in each track of a product, on one screen. */
/** the makers-vs-market matrix, inside the managers page */
export function MakersBody() { return <Funds makersOnly embedded />; }
/** /funds/makers: the ranking has one home, the managers page */
export function FundMakers() { const loc = useLocation(); const n = new URLSearchParams(loc.search); n.set('v', 'makers'); return <Navigate to={`/managers?${n}`} replace />; }
