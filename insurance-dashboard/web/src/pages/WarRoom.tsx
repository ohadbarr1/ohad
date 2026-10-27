import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Icon } from '../components/Icon';
import { IdDot } from '../components/MgrChip';
import { Sourced } from '../components/Source';
import { ErrorBox, Loading, Panel, Seg } from '../components/ui';
import { driversPath, fmt, fmtS, type DriverFile, type LtsResolver } from '../lib/drivers';
import { foxOption } from '../lib/foxchart';
import { idColorOfGroup } from '../lib/identity';
import { ltsProv, warmRep } from '../lib/lens';
import type { Prov } from '../lib/prov';
import { cssColor } from '../lib/theme';
import { load, useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import {
  BOARD_PATH, BoardSrc, EL_PATH, EL_SRC_HE, H, MM, Q_HE, STRATS, STRAT_HE, STRAT_SUB, WPRODS, a1Impact, breakEven, counterCat, elasticity, matrix, monthLabel, nash,
  npv, payoff, quarters, run, short, total, valueOf, weights,
  type Alloc, type BoardFile, type Ctx, type ElFile, type ElSrc, type Mgr, type Others, type Q4, type Strat, type WProd,
} from '../lib/warroom';
import '../styles/warroom.css';

/* A5 · /warroom, the move simulator: a fee cut by one manager on one product × track category, the flow it buys from each competitor over
   eight quarters (the estimated elasticity, warroom/elasticity.json), what it does to each competitor's AUM, revenue and operating profit
   (A1), the mover's own NPV (M3), and the competitors' answers as a payoff matrix with the best-response profile. The scenario lives in
   the URL. Not a nav item: linked from /savings and from search. /warroom/regulation (A8) shares the tab row. */

const lts: LtsResolver = (j) => ltsProv(j.c, j.metric, j.period, j.title, j.unit, j.note, j.value);
const D0 = { mv: 'altshuler', p: 'hisht' as WProd, c: 'כללי', bp: 5 };
const PROD_HE: Record<WProd, string> = { pen: 'פנסיה', gemel: 'גמל', hisht: 'השתלמות' };
const bn = (v: number | null | undefined, d = 2) => (v == null ? '–' : fmt(v / 1000, d));
const bnS = (v: number | null | undefined, d = 2) => (v == null ? '–' : fmtS(v / 1000, d));
const tone = (v: number | null | undefined) => (v == null || Math.abs(v) < 0.05 ? '' : v > 0 ? 'pos' : 'neg');
const S = ({ src, children, className = '' }: { src: () => Prov; children: ReactNode; className?: string }) => <Sourced src={src}><span className={`num ${className}`}>{children}</span></Sourced>;
const QChip = ({ q }: { q: Q4 | 'set' }) => <span className={`wr-q ${q}`}>{q === 'set' ? 'הנחה' : Q_HE[q]}</span>;
const Est = ({ children, title }: { children: ReactNode; title?: string }) => <span className="chip est" title={title}>{children}</span>;

/** the tab row shared with the regulatory simulator (A8, /warroom/regulation) */
export function WarTabs() {
  return (
    <nav className="subnav wr-tabs" aria-label="חדר מלחמה">
      <NavLink to="/warroom" end className={({ isActive }) => (isActive ? 'active' : '')}>מהלך דמי ניהול</NavLink>
      <NavLink to="/warroom/regulation" className={({ isActive }) => (isActive ? 'active' : '')}>רגולציה</NavLink>
    </nav>
  );
}

/** every managing company whose printed components (lts_prov/<c>.json) a provenance node of the files cites */
function ltsCos(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((y) => ltsCos(y, out));
  else if (x && typeof x === 'object') { const o = x as Record<string, unknown>; if (o.k === 'lts' && typeof o.c === 'string') out.add(o.c); Object.values(o).forEach((y) => ltsCos(y, out)); }
  return out;
}
/** every A1 driver file the board's managers need, loaded once */
function useDrivers(ids: string[]): Map<string, DriverFile> | null {
  const key = [...new Set(ids)].sort().join(',');
  const [files, setFiles] = useState<Map<string, DriverFile> | null>(null);
  useEffect(() => {
    let live = true;
    const list = key ? key.split(',') : [];
    Promise.all(list.map((c) => load<DriverFile>(driversPath(c)).then((f) => [c, f] as const, () => null))).then((xs) => {
      if (!live) return;
      const m = new Map(xs.filter((x): x is readonly [string, DriverFile] => !!x));
      setFiles(m);
      ltsCos([...m.values()]).forEach((c) => warmRep(c));   // only the managing companies whose printed components a figure cites
    });
    return () => { live = false; };
  }, [key]);
  return files;
}

export function WarRoom() {
  const el = useLoad<ElFile>(EL_PATH), bd = useLoad<BoardFile>(BOARD_PATH);
  const ids = useMemo(() => Object.values(bd.data?.co ?? {}).filter((c): c is string => !!c), [bd.data]);
  const files = useDrivers(ids);
  return (
    <div className="wr">
      <WarTabs />
      {el.error || bd.error ? <ErrorBox what="נתוני חדר המלחמה" error={(el.error || bd.error)!} />
        : !el.data || !bd.data || !files ? <Loading what="חדר המלחמה" />
          : <Room el={el.data} b={bd.data} files={files} />}
    </div>
  );
}

function Room({ el, b, files }: { el: ElFile; b: BoardFile; files: Map<string, DriverFile> }) {
  const phone = usePhone();
  const [sp, setSp] = useSearchParams();
  const set = (patch: Record<string, string | null>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v == null || v === '' ? n.delete(k) : n.set(k, v))); setSp(n, { replace: true }); };
  const src = useMemo(() => new BoardSrc(b), [b]);

  /* ---- the scenario, from the URL ---- */
  const prod: WProd = WPRODS.includes(sp.get('p') as WProd) ? (sp.get('p') as WProd) : D0.p;
  const P = b.products[prod];
  const movers = useMemo(() => {
    const m = new Map<number, { g: number; he: string; c: string | null; A: number }>();
    for (const c of P.cats) for (const x of c.mgrs) { const o = m.get(x.g); m.set(x.g, { g: x.g, he: x.he, c: x.c, A: (o?.A ?? 0) + x.A }); }
    return [...m.values()].sort((a, z) => z.A - a.A);
  }, [P]);
  const mvKey = sp.get('mv') ?? D0.mv;
  const mover = movers.find((m) => m.c === mvKey || String(m.g) === mvKey) ?? movers.find((m) => m.c === D0.mv) ?? movers[0];
  const myCats = P.cats.filter((c) => c.mgrs.some((x) => x.g === mover.g)).sort((a, z) => z.mgrs.find((x) => x.g === mover.g)!.A - a.mgrs.find((x) => x.g === mover.g)!.A);
  // the default scenario's category on its product; elsewhere the mover's largest book
  const cat = myCats.find((c) => c.cat === sp.get('c')) ?? (prod === D0.p ? myCats.find((c) => c.cat === D0.c) : undefined) ?? myCats[0];
  const bpRaw = Number(sp.get('bp') ?? D0.bp);
  const bp = Number.isFinite(bpRaw) && bpRaw > 0 ? Math.min(bpRaw, 50) : D0.bp;
  const elSrc: ElSrc = (['main', 'fd', 'mgr', 'posted', 'pooled', 'set'] as ElSrc[]).includes(sp.get('el') as ElSrc) ? (sp.get('el') as ElSrc) : 'main';
  const evRaw = Number(sp.get('ev'));
  const ev = sp.get('ev') != null && Number.isFinite(evRaw) && evRaw > 0 ? evRaw : null;
  const alloc: Alloc = sp.get('al') === 'share' ? 'share' : 'rev';
  const others: Others = sp.get('ot') === 'nash' ? 'nash' : 'hold';

  const E = el.products[prod];
  const use = elasticity(el, prod, elSrc, elSrc === 'set' ? (ev ?? E.per_bp_year) : null, lts);
  const ctx: Ctx = { prod, a1: P.a1, cats: P.cats, files, el: use, alloc, lts };
  const me = cat.mgrs.find((x) => x.g === mover.g)!;
  const players = cat.mgrs.filter((x) => x.g !== mover.g).map((x) => x.g);

  /* ---- the move, everyone else holding ---- */
  const base = useMemo(() => run(ctx, { mover: mover.g, cat: cat.cat, bp, resp: new Map() })[0], [ctx.el.B, alloc, mover.g, cat, bp]);  // eslint-disable-line react-hooks/exhaustive-deps
  const won = total(base.fl.m.get(mover.g)!);
  const myVal = valueOf(files, cat, me, P.a1, lts);
  const myNpv = myVal ? npv(myVal, quarters(base.fl.m.get(mover.g)!), me.A, bp) : null;
  const be = breakEven(ctx, mover.g, cat.cat, bp);
  const rel = src.relFee(cat, me);
  const wt = weights(cat, mover.g, alloc);
  const eq = useMemo(() => nash(ctx, mover.g, cat.cat, bp, players), [ctx.el.B, alloc, mover.g, cat, bp, files]);  // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => matrix(ctx, mover.g, cat.cat, bp, players, others, eq.prof), [ctx.el.B, alloc, mover.g, cat, bp, others, eq, files]);  // eslint-disable-line react-hooks/exhaustive-deps
  const eqRuns = useMemo(() => run(ctx, { mover: mover.g, cat: cat.cat, bp, resp: eq.prof }), [eq, ctx.el.B, alloc]);  // eslint-disable-line react-hooks/exhaustive-deps
  const moverEq = payoff(ctx, eqRuns, mover.g);
  const mgrOf = (g: number) => cat.mgrs.find((x) => x.g === g)!;

  /* ---- provenance of the derived figures ---- */
  const bpIn = { label: 'ההורדה (נ״ב, הנחת התרחיש)', v: fmt(bp, bp % 1 ? 1 : 0) };
  const rampIn = { label: `הדרגתיות: ${use.rampHow === 'lags' ? 'מהפיגורים' : 'קו ישר לשישה חודשים (הנחה)'}`, v: use.ramp.map((x) => fmt(x, 2)).join(' · ') };
  const wProv = (g: number): (() => Prov) => () => {
    const d = cat.div[String(mover.g)], w = wt.w.get(g) ?? 0, x = mgrOf(g);
    if (wt.how === 'revealed') {
      const raw = d.raw?.[String(g)];
      return { k: 'calc', title: `תחליפיות נגלית · ${x.he} מול ${me.he} · ${cat.cat}`, value: fmt(w, 3), unit: 'חלק מהזרימה', est: true,
        formula: `OLS חודשי ${monthLabel(202001)}–${monthLabel(b.meta.asof)}: ניוד נטו של ${x.he} = a + b × ניוד נטו של ${me.he} (שניהם בקטגוריה). d = max(0, −b) ÷ Σ max(0, −b)`,
        inputs: [{ label: 'b (שיפוע)', v: raw ? `${fmtS(raw.b, 4)} (t ${fmt(raw.t, 2)})` : '–' }, { label: 'Σ max(0, −b) על כל המתחרים', v: fmt(d.cover, 3) }, { label: 'חודשים', v: String(d.n) },
          { label: 'ניוד נטו לפי מסלול וחודש', v: `${monthLabel(202001)}–${monthLabel(b.meta.asof)}`, src: () => ({ k: 'report', title: `${P.ds === 'pensia' ? 'פנסיה-נט' : 'גמל-נט'}: INTERNAL_TRANSFERS לפי מסלול וחודש · ${P.he} · ${cat.cat}`, value: `${d.n} חודשים`, unit: 'חודשים', url: P.ds === 'pensia' ? 'https://data.gov.il/dataset/pensia-net' : 'https://data.gov.il/dataset/gemelnet', pg: null, doc: P.ds === 'pensia' ? 'פנסיה-נט' : 'גמל-נט', period: `${monthLabel(202001)}–${monthLabel(b.meta.asof)}`, srcType: 'רשות שוק ההון · data.gov.il', note: 'web/public/data/prov/reg, כולל מסלולים שנסגרו' }) }] };
    }
    const tot = cat.mgrs.filter((y) => y.g !== mover.g).reduce((t, y) => t + y.A, 0);
    return { k: 'calc', title: `חלק מהזרימה לפי נתח נכסים · ${x.he} · ${cat.cat}`, value: fmt(w, 3), unit: 'חלק', est: true, formula: 'נכסי המתחרה בקטגוריה ÷ נכסי כל המתחרים בקטגוריה (בלי המניע)',
      inputs: [{ label: x.he, v: fmt(x.A, 0), src: () => src.assets(x, cat.cat) }, { label: 'כל המתחרים', v: fmt(tot, 0) }] };
  };
  const flowProv = (g: number, v: number, qi?: number): (() => Prov) => () => ({
    k: 'calc', title: `${g === mover.g ? 'זרימה למניע' : `זרימה מ${mgrOf(g).he} ל${me.he}`} · ${qi == null ? `${H / 3} רבעונים` : `רבעון ${qi + 1}`}`, value: fmtS(v, 0), unit: MM, est: true,
    formula: 'F(k → i, t) = −B ÷ 100 × הדרגתיות(t) × נכסי המניע בקטגוריה × d(i → k) × Δנ״ב; סכום החודשים',
    inputs: [{ label: 'B', v: use.B == null ? '–' : fmtS(use.B, 4), src: use.p }, { label: 'נכסי המניע בקטגוריה', v: fmt(me.A, 0), src: () => src.assets(me, cat.cat) },
      ...(g === mover.g ? [] : [{ label: `d(${short(me.he)} → ${short(mgrOf(g).he)})`, v: fmt(wt.w.get(g) ?? 0, 3), src: wProv(g) }]), bpIn, rampIn] });
  const npvProv = (x: Mgr, n: { flow: number; fee: number; v: number }, cut: number, flowsQ: number[]): (() => Prov) => () => {
    const v = valueOf(files, cat, x, P.a1, lts)!;
    return { k: 'calc', title: `ערך נוכחי · ${x.he} · ${cat.cat}`, value: fmtS(n.v, 1), unit: MM, est: true,
      formula: `NPV = a × [Σ_q F_q × (m − Δנ״ב ÷ 100) ÷ 100 × (1 + ke)^−(q + ½)/4 − נכסים × Δנ״ב ÷ 10,000] (M3, לפני מס)`,
      inputs: [{ label: 'מרווח m ו-a(D, ke) מקשר A1 tr.npv', v: `${fmt(v.m, 4)}% · ${fmt(v.a, 3)}`, src: v.p }, { label: 'ke', v: `${fmt(v.ke || b.meta.ke.v, 2)}%` },
        { label: 'זרימה ברבעונים 1–8', v: flowsQ.map((f) => fmt(f, 0)).join(' · '), src: flowProv(x.g, total(flowsQ)) }, { label: 'ערך הזרימה', v: fmtS(n.flow, 1) },
        { label: `ויתור על דמי ניהול: נכסים × ${fmt(cut, 1)} נ״ב × a`, v: fmtS(-n.fee, 1), src: () => src.assets(x, cat.cat) }] };
  };

  /* ---- competitors: flow, A1 run-rate, NPV ---- */
  const comp = players.map((g) => {
    const x = mgrOf(g), f = base.fl.m.get(g)!, fq = quarters(f), F = total(f);
    const a = a1Impact(files, x, P.a1, F, 0, x.A, lts);
    const val = valueOf(files, cat, x, P.a1, lts);
    const n = val ? npv(val, fq, x.A, 0) : null;
    return { x, F, fq, a, val, n };
  }).sort((p, q) => p.F - q.F);
  const myA1 = a1Impact(files, me, P.a1, won, bp, me.A, lts);

  /* ---- the chart: the mover's quarters against the five largest losers ---- */
  const top = comp.filter((c) => c.F < 0).slice(0, 5);
  const rest = comp.filter((c) => !top.includes(c));
  const qx = Array.from({ length: H / 3 }, (_, i) => `רבעון ${i + 1}`);
  const build = () => foxOption({ x: qx, unit: MM, legend: true, total: false, full: true, labels: false, series: [
    { name: short(me.he), data: quarters(base.fl.m.get(mover.g)!).map((v) => +v.toFixed(1)), color: cssColor('--accent'), stack: true },
    ...top.map((c) => ({ name: short(c.x.he), data: c.fq.map((v) => +v.toFixed(1)), color: idColorOfGroup(c.x.he), stack: true })),
    ...(rest.some((c) => c.F < 0) ? [{ name: 'שאר המתחרים', data: Array.from({ length: H / 3 }, (_, q) => +rest.reduce((t, c) => t + c.fq[q], 0).toFixed(1)), color: cssColor('--faint'), stack: true }] : []),
  ] });

  const flagNoFlow = use.B == null;
  const ctxQ = b.ctx.q[b.ctx.q.length - 1];
  const ctxPen = src.ctxTr(mover.g, 'pen', ctxQ), ctxGem = src.ctxTr(mover.g, 'gem', ctxQ);
  const ql = (q: string) => `${q.slice(0, 2)}'${q.slice(-2)}`;
  const counterOf = (g: number) => counterCat(ctx, mover.g, cat.cat, g)?.cat;
  const nashCount = STRATS.map((s) => [s, [...eq.prof.values()].filter((x) => x === s).length] as const).filter(([, n]) => n);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1><span className="icotile"><Icon name="sliders" /></span>חדר מלחמה · מהלך דמי ניהול</h1>
          <div className="sub"><span>נתוני הרשות עד <span className="num">{monthLabel(b.meta.asof)}</span></span><span className="dim">·</span><span>גמישות <span className="num">{el.meta.window}</span></span><span className="dim">·</span><span>מיליוני ש"ח, לפני מס</span></div>
        </div>
      </div>

      <Panel className="wr-ctl">
        <div className="wr-controls">
          <label className="field"><span>מניע</span>
            <select value={mover.c ?? String(mover.g)} onChange={(e) => set({ mv: e.target.value, c: null })}>{movers.map((m) => <option key={m.g} value={m.c ?? String(m.g)}>{m.he}</option>)}</select></label>
          <div className="field"><span>מוצר</span><Seg label="מוצר" value={prod} options={WPRODS.map((p) => [p, PROD_HE[p]] as [WProd, string])} onChange={(v) => set({ p: v, c: null })} /></div>
          <label className="field"><span>קטגוריית מסלול</span>
            <select value={cat.cat} onChange={(e) => set({ c: e.target.value })}>{myCats.map((c) => <option key={c.cat} value={c.cat}>{c.cat}</option>)}</select></label>
          <label className="field wr-bp"><span>הורדה, נ״ב</span>
            <input type="number" inputMode="decimal" min={0.5} max={50} step={0.5} value={bp} aria-label="הורדת דמי ניהול בנקודות בסיס" onChange={(e) => set({ bp: e.target.value })} /></label>
          <label className="field"><span>גמישות</span>
            <select value={elSrc} onChange={(e) => set({ el: e.target.value === 'main' ? null : e.target.value })}>{(['main', 'fd', 'mgr', 'posted', 'pooled', 'set'] as ElSrc[]).map((k) => <option key={k} value={k}>{EL_SRC_HE[k]}</option>)}</select></label>
          {elSrc === 'set' && <label className="field wr-bp"><span>% בשנה לכל נ״ב</span>
            <input type="number" inputMode="decimal" min={0} step={0.1} value={ev ?? +E.per_bp_year.toFixed(2)} aria-label="הנחת גמישות: אחוז מהנכסים בשנה לכל נקודת בסיס" onChange={(e) => set({ ev: e.target.value })} /></label>}
          <div className="field"><span>מי מפסיד</span><Seg label="הקצאת הזרימה" value={alloc} options={[['rev', 'תחליפיות נגלית'], ['share', 'נתח נכסים']]} onChange={(v) => set({ al: v === 'rev' ? null : v })} /></div>
        </div>
        <div className="wr-scn">
          <IdDot grp={me.he} /><b>{me.he}</b><span>מוריד</span><b className="num">{fmt(bp, bp % 1 ? 1 : 0)} נ״ב</b><span>·</span><span>{P.he}</span><span>·</span><span>{cat.cat}</span>
          <span className="wr-chips">
            <Est title="הזרימה נספרת שמונה רבעונים; הוויתור על דמי הניהול על התיק הקיים לאורך משך ההחזקה של M3">אופק זרימה: 8 רבעונים</Est>
            {use.rampHow === 'assumed' && <Est title="דמי הניהול בנתוני הרשות שנתיים; פרופיל הפיגורים החודשי אינו מזוהה">הדרגתיות: 6 חודשים, קו ישר</Est>}
            <Est title="M3: מרווח תפעולי ממוצע (תשואת דמי ניהול × (1 − הוצאות ÷ הכנסות)), לא שולי">מרווח ממוצע, M3</Est>
            {wt.how === 'share' && <Est title={alloc === 'rev' ? 'התחליפיות לא נאמדה: פחות מ-30% מהזרימה משתקפת אצל המתחרים, או פחות מ-36 חודשים' : 'נבחר נתח נכסים'}>הקצאה לפי נתח</Est>}
          </span>
        </div>
      </Panel>

      <section className="kpis wr-kpis" aria-label="המניע">
        <div className="kpi"><div className="l">נכסים במסלול · {monthLabel(b.meta.asof)}</div><div className="v"><S src={() => src.assets(me, cat.cat)}>{bn(me.A)}</S></div><div className="s">מיליארד ש"ח · <span className="num">{me.tracks.length}</span> מסלולים</div></div>
        <div className="kpi"><div className="l">דמי ניהול · יחסית לשאר</div><div className="v"><S src={() => src.fee(me, cat.cat)}>{me.fee == null ? '–' : `${fmt(me.fee, 2)}%`}</S></div><div className="s"><S src={rel.p}>{rel.v == null ? '–' : `${fmtS(rel.v, 1)} נ״ב`}</S> · נגבו ב-<span className="num">{b.meta.fee_year - 1}</span></div></div>
        <div className="kpi"><div className="l">ניוד נטו במסלול · {monthLabel(b.meta.q_months[0])}–{monthLabel(b.meta.q_months[2])}</div><div className={`v ${tone(me.trq)}`}><S src={() => src.trq(me, cat.cat)}>{bnS(me.trq)}</S></div><div className="s">מיליארד ש"ח · LTM <span className="num">{bnS(me.tr12)}</span></div></div>
        <div className="kpi"><div className="l">ניוד נטו · {ql(ctxQ)}</div><div className="v wr-two">
          {ctxPen && <span><small>פנסיה</small><S src={ctxPen.p} className={tone(ctxPen.v)}>{bnS(ctxPen.v)}</S></span>}
          {ctxGem && <span><small>גמל והשתלמות</small><S src={ctxGem.p} className={tone(ctxGem.v)}>{bnS(ctxGem.v)}</S></span>}</div><div className="s">מיליארד ש"ח · כל המסלולים</div></div>
      </section>

      <section className="kpis wr-kpis wr-res" aria-label="תוצאת המהלך">
        <div className="kpi"><div className="l">זרימה למניע · 8 רבעונים</div><div className={`v ${tone(won)}`}>{flagNoFlow ? '–' : <S src={flowProv(mover.g, won)}>{bnS(won)}</S>}</div><div className="s">מיליארד ש"ח · <span className="num">{fmtS(me.A ? won / me.A * 100 : 0, 1)}%</span> מהנכסים</div></div>
        <div className="kpi"><div className="l">NPV של המהלך למניע</div><div className={`v ${tone(myNpv?.v)}`}>{myNpv ? <S src={npvProv(me, myNpv, bp, quarters(base.fl.m.get(mover.g)!))}>{fmtS(myNpv.v, 0)}</S> : '–'}</div>
          <div className="s">ערך הזרימה <span className="num">{fmtS(myNpv?.flow, 1)}</span> · ויתור <span className="num">{fmtS(myNpv ? -myNpv.fee : null, 1)}</span></div></div>
        <div className="kpi"><div className="l">גמישות לאיזון</div><div className="v">{be == null ? '–' : <span className="num">{fmtS(-be * 12, 2)}%</span>}</div>
          <div className="s">{be == null ? (myVal && myVal.m - bp / 100 <= 0 ? <>המרווח אחרי ההורדה <span className="num">{fmtS(myVal.m - bp / 100, 3)}%</span>: אין גמישות שמאזנת</> : 'לא חושב') : <>מהנכסים בשנה לכל נ״ב · האומדן <span className="num">{use.B == null ? '–' : `${fmt(-use.B * 12, 2)}%`}</span>{use.B != null && be ? <> (×<span className="num">{fmt(be / use.B, 1)}</span>)</> : null}</>}</div></div>
        <div className="kpi"><div className="l">גמישות בשימוש</div><div className="v"><S src={use.p}>{use.B == null ? '–' : fmtS(use.B, 3)}</S></div>
          <div className="s"><QChip q={use.q} /> % בחודש לכל נ״ב{use.t != null && <> · t <span className="num">{fmt(use.t, 2)}</span></>}</div></div>
      </section>
      {use.flag && <div className="wr-flag" role="status"><Icon name="x" />{use.flag}</div>}

      <Panel title="הזרימה לפי רבעון" aside={<span>{wt.how === 'revealed' ? 'מי מפסיד: תחליפיות נגלית' : 'מי מפסיד: נתח נכסים'} · מיליוני ש"ח</span>}>
        {flagNoFlow ? <div className="wr-none">אין זרימה: {Q_HE.none}</div>
          : <Chart label={`חדר מלחמה · ${me.he} · ${P.he} · ${cat.cat}`} height={phone ? 260 : 300} deps={[mover.g, cat.cat, bp, use.B, alloc, prod]} build={build} source={`fox · ${el.meta.source}`} />}
      </Panel>

      <Panel title="ההשפעה על כל מתחרה" aside={<span>מתחרים מחזיקים · זרימה ו-NPV: 8 רבעונים · הכנסות ורווח: קצב שנתי בסוף האופק (A1)</span>}>
        <CompTable phone={phone} rows={comp.map((c) => ({ ...c, w: wt.w.get(c.x.g) ?? 0 }))} me={{ x: me, F: won, a: myA1, n: myNpv }} srcs={{ assets: (x) => () => src.assets(x, cat.cat), w: wProv, flow: (g, v) => flowProv(g, v), npv: (x, n, cut, fq) => npvProv(x, n, cut, fq) }} myFq={quarters(base.fl.m.get(mover.g)!)} bp={bp} />
      </Panel>

      <Panel title="מטריצת תגובות" aside={<span>NPV למתחרה, מיליוני ש"ח · δ = <span className="num">{fmt(bp, bp % 1 ? 1 : 0)}</span> נ״ב</span>}>
        <div className="wr-mhead">
          <div className="field"><span>שאר המתחרים</span><Seg label="הנחה על שאר המתחרים" value={others} options={[['hold', 'מחזיקים'], ['nash', 'בשיווי משקל']]} onChange={(v) => set({ ot: v === 'hold' ? null : v })} /></div>
          <div className="wr-nash">
            <span className="dim">שיווי משקל (תגובה מיטבית חוזרת{eq.stable ? `, ${eq.rounds} סבבים` : ', לא התייצב ב-30 סבבים'}):</span>
            {nashCount.map(([s, n]) => <span key={s} className={`wr-st ${s}`}>{STRAT_HE[s]} <span className="num">{n}</span></span>)}
            <span className="dim">· NPV למניע</span><b className={`num ${tone(moverEq?.v)}`}>{moverEq ? fmtS(moverEq.v, 0) : '–'}</b>
          </div>
        </div>
        <Matrix phone={phone} rows={rows} eq={eq.prof} mgr={mgrOf} counterOf={counterOf} />
        <div className="wr-foot">
          <Est title="השוואה: אותה הורדה באותה קטגוריה; חלקית: מחצית; מענה בזירה אחרת: אותה הורדה בקטגוריה הגדולה הבאה של המניע במוצר">אסטרטגיות</Est>
          <Est title="דומיננטית: אותה תגובה מיטבית מול חמישה פרופילים של האחרים (כולם מחזיקים, משווים, משווים חלקית, עונים בזירה אחרת, ושיווי המשקל)">דומיננטית: מול 5 פרופילים</Est>
          <Est title="המניע אינו משנה את מהלכו; המתחרים מגיבים זה לזה בסבבים לפי גודל">המהלך של המניע קבוע</Est>
        </div>
      </Panel>

      <ElPanel el={el} prod={prod} phone={phone} />
      <p className="wr-links"><Link to={`/savings?v=npv&s=${P.a1}`}>ערך הניוד (M3)</Link><span className="dim">·</span>{me.c && <Link to={`/drivers/${me.c}`}>מנגנונים: {me.he} (A1)</Link>}</p>
    </>
  );
}

/* ---------- the competitor table ---------- */
type CompRow = { x: Mgr; F: number; fq: number[]; a: ReturnType<typeof a1Impact>; val: ReturnType<typeof valueOf>; n: ReturnType<typeof npv> | null; w: number };
type Srcs = { assets: (x: Mgr) => () => Prov; w: (g: number) => () => Prov; flow: (g: number, v: number) => () => Prov; npv: (x: Mgr, n: { flow: number; fee: number; v: number }, cut: number, fq: number[]) => () => Prov };
function CompTable({ rows, me, srcs, phone, myFq, bp }: { rows: CompRow[]; me: { x: Mgr; F: number; a: ReturnType<typeof a1Impact>; n: ReturnType<typeof npv> | null }; srcs: Srcs; phone: boolean; myFq: number[]; bp: number }) {
  const A1v = ({ v, p, why }: { v: number | null; p?: () => Prov; why?: string }) => (v == null || !p ? <span className="dim" title={why}>–</span> : <S src={p} className={tone(v)}>{fmtS(v, 1)}</S>);
  const lead = { x: me.x, F: me.F, a: me.a, n: me.n };
  if (phone) return (
    <ul className="wr-cards wr-cc">
      <li className="wr-cch" aria-hidden="true"><span>מנהל · d</span><span>זרימה</span><span>NPV</span></li>
      {[lead, ...rows].map((r, i) => (
        <li key={r.x.g} className={i === 0 ? 'lead' : ''}>
          <div className="wr-ccr">
            <span className="wr-c1"><IdDot grp={r.x.he} /><b>{short(r.x.he)}</b>{i === 0 ? <span className="chip">מניע</span> : <span className="dim"><S src={srcs.w(r.x.g)}>{fmt((r as CompRow).w, 2)}</S></span>}</span>
            <S src={srcs.flow(r.x.g, r.F)} className={tone(r.F)}>{fmtS(r.F, 0)}</S>
            {r.n ? <S src={srcs.npv(r.x, r.n, i === 0 ? bp : 0, i === 0 ? myFq : (r as CompRow).fq)} className={tone(r.n.v)}>{fmtS(r.n.v, 1)}</S> : <span className="dim">–</span>}
          </div>
          <div className="wr-ccs">נכסים <S src={srcs.assets(r.x)}>{bn(r.x.A, 1)}</S> · Δהכנסות <A1v v={r.a.rev} p={r.a.pRev} why={r.a.why} /> · Δרווח <A1v v={r.a.op} p={r.a.pOp} why={r.a.why} /></div>
        </li>))}
    </ul>
  );
  return (
    <div className="scroll">
      <table className="wr-t">
        <thead><tr><th>מנהל</th><th>נכסים, מיליארד</th><th>חלק מהזרימה (d)</th><th>זרימה, 8 רבעונים</th><th>% מהנכסים</th><th>Δהכנסות לשנה</th><th>Δרווח תפעולי לשנה</th><th>NPV</th></tr></thead>
        <tbody>
          {[lead, ...rows].map((r, i) => (
            <tr key={r.x.g} className={i === 0 ? 'lead' : ''}>
              <td><span className="wr-nm"><IdDot grp={r.x.he} />{r.x.he}{i === 0 && <span className="chip">מניע</span>}{r.n && (i === 0 ? false : (r as CompRow).val?.est) && <Est title={(r as CompRow).val?.why}>מרווח ממוצע</Est>}</span></td>
              <td><S src={srcs.assets(r.x)}>{bn(r.x.A, 1)}</S></td>
              <td>{i === 0 ? <span className="dim">–</span> : <S src={srcs.w(r.x.g)}>{fmt((r as CompRow).w, 3)}</S>}</td>
              <td><S src={srcs.flow(r.x.g, r.F)} className={tone(r.F)}>{fmtS(r.F, 0)}</S></td>
              <td className={tone(r.F)}><span className="num">{fmtS(r.x.A ? r.F / r.x.A * 100 : 0, 2)}%</span></td>
              <td><A1v v={r.a.rev} p={r.a.pRev} why={r.a.why} /></td>
              <td><A1v v={r.a.op} p={r.a.pOp} why={r.a.why} /></td>
              <td>{r.n ? <S src={srcs.npv(r.x, r.n, i === 0 ? bp : 0, i === 0 ? myFq : (r as CompRow).fq)} className={tone(r.n.v)}>{fmtS(r.n.v, 1)}</S> : <span className="dim" title="אין מרווח M3">–</span>}</td>
            </tr>))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- the response matrix ---------- */
function Matrix({ rows, eq, mgr, counterOf, phone }: { rows: ReturnType<typeof matrix>; eq: Map<number, Strat>; mgr: (g: number) => Mgr; counterOf: (g: number) => string | undefined; phone: boolean }) {
  const cell = (r: (typeof rows)[number], s: Strat) => {
    const c = r.cells.find((x) => x.s === s)!;
    const best = r.best === s, inEq = eq.get(r.g) === s;
    return (
      <span className={`wr-cell${best ? ' best' : ''}${inEq ? ' eq' : ''}`} title={c.na ?? (s === 'counter' ? `מענה ב: ${counterOf(r.g) ?? '–'}` : STRAT_SUB[s])}>
        {c.v == null ? <span className="dim">–</span> : <span className={`num ${tone(c.v)}`}>{fmtS(c.v, 1)}</span>}
        {inEq && <i className="wr-eqdot" role="img" aria-label="בשיווי המשקל" />}
        {c.est && <sup className="wr-est" title="מרווח ממוצע, הנחה">*</sup>}
      </span>
    );
  };
  if (phone) return (
    <ul className="wr-mcards">
      <li className="wr-m4 wr-m4h" aria-hidden="true">{STRATS.map((s) => <span key={s}>{STRAT_HE[s].replace('השוואה חלקית', 'חלקית').replace('מענה בזירה אחרת', 'זירה אחרת')}</span>)}</li>
      {rows.map((r) => (
      <li key={r.g}>
        <div className="wr-c1"><IdDot grp={mgr(r.g).he} /><b>{short(mgr(r.g).he)}</b>{r.best && <span className={`wr-st ${r.best}`}>{STRAT_HE[r.best]}</span>}{r.dominant && <span className="chip pass">דומיננטית</span>}</div>
        <div className="wr-m4">{STRATS.map((s) => <div key={s} title={STRAT_HE[s]}>{cell(r, s)}</div>)}</div>
      </li>))}</ul>
  );
  return (
    <div className="scroll">
      <table className="wr-t wr-mx">
        <thead><tr><th>מתחרה</th>{STRATS.map((s) => <th key={s}><span className="wr-th">{STRAT_HE[s]}<small>{STRAT_SUB[s]}</small></span></th>)}<th>תגובה מיטבית</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.g}>
            <td><span className="wr-nm"><IdDot grp={mgr(r.g).he} />{mgr(r.g).he}</span></td>
            {STRATS.map((s) => <td key={s}>{cell(r, s)}</td>)}
            <td>{r.best ? <span className="wr-best"><span className={`wr-st ${r.best}`}>{STRAT_HE[r.best]}</span>{r.dominant ? <span className="chip pass">דומיננטית</span> : <span className="chip">תלוי באחרים</span>}</span> : <span className="dim">–</span>}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

/* ---------- the elasticity estimates ---------- */
function ElPanel({ el, prod, phone }: { el: ElFile; prod: WProd; phone: boolean }) {
  const ft = el.meta.fee_timing;
  const specs: [string, (p: ElFile['products'][WProd]) => { B: number; t: number; n: number }][] = [
    ['ראשי', (p) => p.main], ['+ מנהל × חודש', (p) => p.rob.mgr], ['הפרשים ראשונים', (p) => p.rob.fd], ['כפי שפורסם', (p) => p.rob.posted]];
  const pv = (p: ElFile['products'][WProd]) => () => elasticity(el, WPRODS.find((k) => el.products[k] === p)!, 'main', null, lts).p();
  return (
    <Panel title="גמישות הניוד לדמי ניהול יחסיים" aside={<span>% מנכסי המסלול בחודש לכל 1 נ״ב · <span className="num">{el.meta.window}</span> · פיגורים <span className="num">0–{el.meta.lags}</span></span>}>
      {phone ? (
        <ul className="wr-cards">{WPRODS.map((k) => { const p = el.products[k]; return (
          <li key={k} className={k === prod ? 'lead' : ''}>
            <div className="wr-c1"><b>{p.he}</b><QChip q={p.quality} /></div>
            <dl className="wr-c2">
              <div><dt>B</dt><dd><S src={pv(p)}>{fmtS(p.main.B, 4)}</S></dd></div><div><dt>t</dt><dd className="num">{fmt(p.main.t, 2)}</dd></div>
              <div><dt>n</dt><dd className="num">{p.main.n.toLocaleString('en-US')}</dd></div><div><dt>R²</dt><dd className="num">{fmt(p.main.r2, 2)}</dd></div>
              <div><dt>לשנה לכל נ״ב</dt><dd className="num">{fmtS(p.per_bp_year, 2)}%</dd></div><div><dt>שינויי דמי ניהול</dt><dd className="num">{p.events.ge1}</dd></div>
            </dl>
            <div className="wr-rob">{specs.slice(1).map(([l, f]) => { const s = f(p); return <span key={l}>{l}: <span className={`num ${s.B < 0 ? '' : 'neg'}`}>{fmtS(s.B, 3)}</span> <span className="dim">(t <span className="num">{fmt(s.t, 1)}</span>)</span></span>; })}</div>
          </li>); })}</ul>
      ) : (
        <div className="scroll">
          <table className="wr-t">
            <thead><tr><th>מוצר</th><th>B</th><th>t</th><th>n</th><th>מסלולים</th><th>R²</th><th>% בשנה לכל נ״ב</th><th>איכות</th>{specs.slice(1).map(([l]) => <th key={l}>{l}</th>)}<th>שינויי דמי ניהול ≥1 / ≥5 נ״ב</th></tr></thead>
            <tbody>{WPRODS.map((k) => { const p = el.products[k]; return (
              <tr key={k} className={k === prod ? 'lead' : ''}>
                <td>{p.he}</td><td><S src={pv(p)}>{fmtS(p.main.B, 4)}</S></td><td><span className="num">{fmt(p.main.t, 2)}</span></td><td><span className="num">{p.main.n.toLocaleString('en-US')}</span></td><td><span className="num">{p.tracks}</span></td>
                <td><span className="num">{fmt(p.main.r2, 3)}</span></td><td><span className="num">{fmtS(p.per_bp_year, 2)}%</span></td><td><QChip q={p.quality} /></td>
                {specs.slice(1).map(([l, f]) => { const s = f(p); return <td key={l}><span className="num">{fmtS(s.B, 3)}</span> <span className="dim">t <span className="num">{fmt(s.t, 1)}</span></span></td>; })}
                <td><span className="num">{p.events.ge1} / {p.events.ge5}</span></td>
              </tr>); })}
              <tr className="tot"><td>שלושת המוצרים</td><td><span className="num">{fmtS(el.pooled.main.B, 4)}</span></td><td><span className="num">{fmt(el.pooled.main.t, 2)}</span></td><td><span className="num">{el.pooled.main.n.toLocaleString('en-US')}</span></td><td><span className="num">{el.pooled.main.clusters}</span></td><td><span className="num">{fmt(el.pooled.main.r2, 3)}</span></td><td><span className="num">{fmtS(el.pooled.per_bp_year, 2)}%</span></td><td><QChip q={el.pooled.quality} /></td><td colSpan={4} /></tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="wr-foot">
        <Est title={`AVG_ANNUAL_MANAGEMENT_FEE משתנה רק בינואר (${ft.january.toLocaleString('en-US')} מתוך ${ft.changes.toLocaleString('en-US')} שינויים מ-01/20). מתאם השינוי השנתי עם תשואת דמי הניהול המדווחת: שנה קודמת ${fmt(ft.corr_prior, 2)} (n ${ft.n_prior}), אותה שנה ${fmt(ft.corr_same, 2)} (n ${ft.n_same})`}>דמי הניהול: ממוצע שנתי, מוזז שנה</Est>
        <Est title="אפקט מסלול + אפקט קטגוריה × חודש; משקל: נכסי פתיחה; שגיאות מקובצות לפי מסלול; בקרות: תשואה יחסית 12 ו-36 חודשים, גודל">WLS, אפקטים קבועים</Est>
        <span className="dim">איכות: גבוהה t ≤ −3 וסימן עקבי · בינונית t ≤ −2 · נמוכה t ≤ −1 · אין אות: לא משמש</span>
      </div>
    </Panel>
  );
}
