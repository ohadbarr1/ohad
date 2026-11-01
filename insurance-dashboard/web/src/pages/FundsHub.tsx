import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BasisToggle, CompareAdd, FundsHead } from '../components/FundsNav';
import { MgrChip } from '../components/MgrChip';
import { Sourced } from '../components/Source';
import { Icon } from '../components/Icon';
import { Tip } from '../components/Explain';
import { Empty, ErrorBox, Loading, Panel, Pick, Seg } from '../components/ui';
import { countP, fundP, listP, trackKey } from '../lib/market';
import type { Prov } from '../lib/prov';
import { useMacro } from '../lib/macro';
import { nf, sn } from '../lib/format';
import { useFunds } from '../lib/useData';
import { GROSS_LABEL, NET_LABEL, PER_LABEL, catKey, hasNet, pc, rankAll, realOf, refOf, retOf, shownProv, useBasis, useReal, ym, ytdPrev, type Basis, type FundX, type FundsFile, type Per, prevMonth, selfDirected, SELF_NOTE } from '../lib/funds';
import '../styles/lens.css';
import '../styles/market.css';

/* /funds, the front door of "חיסכון" (funds plan #1, hub v1): the month in one screen. Per product, the leaders and laggards of its
   largest categories; where choosing a track mattered most; the tracks that moved most in their category; the fee changes; and the
   doors to every tool. Net of fee by default when the file carries it. Every figure opens its source; nothing is a score. */

const PRODUCTS = ['השתלמות', 'גמל', 'גמל להשקעה', 'פנסיה מקיפה', 'פוליסות חיסכון', 'פנסיה כללית', 'חיסכון לילד', 'מרכזית לפיצויים'];
const HUB_WIN: [Per, string][] = [['m1', 'החודש'], ['y12', 'LTM'], ['a3', '3Y']];
const MIN_N = 5;

type Row = { f: FundX; v: number };
/** a category on the chosen basis: its ranked tracks (open to everyone, with assets), best first */
function ranked(fs: FundX[], per: Per, basis: Basis, real: boolean, asof: number, cpi: ReturnType<typeof useMacro>['data']): Row[] {
  return fs.map((f) => ({ f, v: real ? realOf(f, per, basis, asof, cpi?.series.cpi).v : retOf(f, per, basis).v })).filter((r): r is Row => r.v != null).sort((a, b) => b.v - a.v);
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

/** fee of every track in the latest month and the month before, from the per-group monthly files (prov/reg), when funds.json has no `fee1` */
function useRegFees(asof: number | undefined, need: boolean, groups: number): Map<string, [number | null, number | null]> | null {
  const [m, setM] = useState<Map<string, [number | null, number | null]> | null>(null);
  useEffect(() => {
    if (!asof || !need) return;
    let live = true;
    const y = Math.floor(asof / 100), years = asof % 100 === 1 ? [y - 1, y] : [y];
    const prev = asof % 100 === 1 ? (y - 1) * 100 + 12 : asof - 1;
    type RF = { months: number[]; funds: [string, number, string, number, string][]; fee: (number | null)[][] };
    const get = (g: number, yr: number) => fetch(`${import.meta.env.BASE_URL}data/prov/reg/${g}/${yr}.json`).then((r) => (r.ok ? r.json() as Promise<RF> : null)).catch(() => null);
    Promise.all(Array.from({ length: groups }, (_, g) => Promise.all(years.map((yr) => get(g, yr))))).then((all) => {
      const out = new Map<string, [number | null, number | null]>();
      all.flat().forEach((f) => {
        if (!f || !Array.isArray(f.funds)) return;
        f.funds.forEach((fu, i) => {
          const k = trackKey(fu[0] as 'gemel' | 'pensia' | 'insurance', fu[1]), cur = out.get(k) ?? [null, null];
          const a = f.months.indexOf(asof), b = f.months.indexOf(prev);
          if (a >= 0) cur[0] = f.fee[i]?.[a] ?? null;
          if (b >= 0) cur[1] = f.fee[i]?.[b] ?? null;
          out.set(k, cur);
        });
      });
      if (live) setM(out);
    });
    return () => { live = false; };
  }, [asof, need, groups]);
  return m;
}

export function FundsHub() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cpi = useMacro().data;
  const [basisAsked] = useBasis();
  const [real] = useReal();
  const [prod, setProd] = useState('השתלמות');
  const [per, setPer] = useState<Per>('y12');
  const live = useMemo(() => (data?.funds ?? []).filter((f) => f.assets && !f.closed && !f.gone && !selfDirected(f)), [data]);
  const netOk = useMemo(() => hasNet(data?.funds ?? []), [data]);
  const basis: Basis = basisAsked === 'net' && netOk ? 'net' : 'gross';
  const asof = data?.asof ?? 0;
  const C = cpi?.series.cpi;
  const hasFee1 = useMemo(() => (data?.funds ?? []).some((f) => f.fee1 != null), [data]);
  // one file per managing group (market.json's group list, the same names as the tracks' `grp`)
  const nGroups = useMemo(() => new Set((data?.funds ?? []).map((f) => f.grp)).size, [data]);
  const regFees = useRegFees(data?.asof, !!data && !hasFee1, nGroups);

  const cats = useMemo(() => {
    const by = new Map<string, FundX[]>();
    live.forEach((f) => by.set(catKey(f), [...(by.get(catKey(f)) ?? []), f]));
    return by;
  }, [live]);
  // the product's largest categories (by assets), each with its ranking on the chosen window
  const board = useMemo(() => [...cats.entries()].filter(([, fs]) => fs[0].prod === prod)
    .map(([k, fs]) => ({ k, track: fs[0].track, fs, assets: fs.reduce((t, f) => t + (f.assets ?? 0), 0), r: ranked(fs, per, basis, real, asof, cpi) }))
    .filter((c) => c.r.length >= 3).sort((a, b) => b.assets - a.assets).slice(0, 6), [cats, prod, per, basis, real, asof, cpi]);
  // where the choice mattered most: the widest spread between the best and worst track of a category (any product)
  const spread = useMemo(() => [...cats.values()].map((fs) => ({ fs, r: ranked(fs, per, basis, real, asof, cpi) })).filter((c) => c.r.length >= MIN_N)
    .map((c) => ({ ...c, d: c.r[0].v - c.r[c.r.length - 1].v })).sort((a, b) => b.d - a.d).slice(0, 5), [cats, per, basis, real, asof, cpi]);
  // rank movers: last month's percentile (pr1 / pn1) when the build ships it, else the YTD rank a month ago vs today
  const movers = useMemo(() => {
    const out: { f: FundX; from: number; to: number; n: number; how: 'pct' | 'ytd' }[] = [];
    const pubPrev = live.some((f) => (basis === 'net' ? f.pn1 : f.pr1)?.y12 != null);
    [...cats.values()].filter((fs) => fs[0].prod === prod).forEach((fs) => {
      if (pubPrev) {
        fs.forEach((f) => { const a = (basis === 'net' ? f.pn1 : f.pr1)?.y12, b = (basis === 'net' ? f.pn : f.pr)?.y12, n = (basis === 'net' ? f.pnn : f.prn)?.y12; if (a != null && b != null && n != null) out.push({ f, from: a, to: b, n, how: 'pct' }); });
        return;
      }
      if (asof % 100 === 1) return;
      const now = rankAll(fs, (f) => retOf(f, 'ytd', basis).v), was = rankAll(fs, (f) => { const r = retOf(f, 'ytd', basis).v, m = retOf(f, 'm1', basis).v; return r == null || m == null ? null : ytdPrev({ ytd: r, m1: m }, asof); });
      fs.forEach((f) => { const a = was.get(f.k), b = now.get(f.k); if (a && b && b.n >= MIN_N && a.n === b.n) out.push({ f, from: a.rank, to: b.rank, n: b.n, how: 'ytd' }); });
    });
    return out.filter((x) => x.from !== x.to).sort((a, b) => (b.how === 'pct' ? Math.abs(b.to - b.from) - Math.abs(a.to - a.from) : Math.abs(b.from - b.to) / b.n - Math.abs(a.from - a.to) / a.n)).slice(0, 8);
  }, [cats, prod, basis, asof, live]);
  // fee changes against last month
  const fees = useMemo(() => {
    const rows: { f: FundX; a: number; b: number; pub: boolean }[] = [];
    live.filter((f) => f.prod === prod).forEach((f) => {
      if (hasFee1) { if (f.fee != null && f.fee1 != null && Math.abs(f.fee - f.fee1) >= 0.005) rows.push({ f, a: f.fee, b: f.fee1, pub: true }); return; }
      const x = regFees?.get(f.k);
      if (x && x[0] != null && x[1] != null && Math.abs(x[0] - x[1]) >= 0.005) rows.push({ f, a: x[0], b: x[1], pub: false });
    });
    return rows.sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b));
  }, [live, prod, hasFee1, regFees]);

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data) return <Loading what="קופות" />;
  const lbl = real ? `${basis === 'net' ? 'נטו, ' : ''}ריאלי` : basis === 'net' ? NET_LABEL : GROSS_LABEL;
  const V = ({ f, v }: { f: FundX; v: number }) => <Sourced src={() => shownProv(f, per, basis, real, asof, C, data)}><span className="num">{pc(v, per === 'm1' ? 2 : 1)}</span></Sourced>;
  const totalA = live.reduce((t, f) => t + (f.assets ?? 0), 0);
  const prods = PRODUCTS.filter((p) => live.some((f) => f.prod === p));
  const medProv = (c: (typeof board)[number], m: number): Prov => listP(`חציון ${PER_LABEL[per]} · ${c.k}`, pc(m), undefined, 'החציון של תשואות המסלולים המדורגים בקטגוריה', c.r.map((x) => ({ label: x.f.name, v: pc(x.v), src: () => shownProv(x.f, per, basis, real, asof, C, data) })));
  const spreadProv = (c: (typeof spread)[number]): Prov => ({ k: 'calc', title: `פער בין המסלול המוביל למאסף · ${catKey(c.fs[0])} · ${PER_LABEL[per]}`, value: `${nf(c.d, 2)} נ"א`, formula: 'התשואה הגבוהה בקטגוריה פחות הנמוכה',
    inputs: [{ label: `מוביל: ${c.r[0].f.name}`, v: pc(c.r[0].v), src: () => shownProv(c.r[0].f, per, basis, real, asof, C, data) }, { label: `מאסף: ${c.r[c.r.length - 1].f.name}`, v: pc(c.r[c.r.length - 1].v), src: () => shownProv(c.r[c.r.length - 1].f, per, basis, real, asof, C, data) }, { label: 'מסלולים מדורגים', v: nf(c.r.length, 0) }] });
  const feeProv = (x: (typeof fees)[number]): Prov => ({ k: 'calc', title: `שינוי בדמי הניהול מצבירה · ${x.f.name}`, value: `${sn(x.a - x.b, 2)} נ"א`, formula: `דמי הניהול הממוצעים ב-${ym(asof)} פחות דמי הניהול בחודש הקודם (AVG_ANNUAL_MANAGEMENT_FEE)`,
    inputs: [{ label: ym(asof), v: nf(x.a, 2) + '%', src: () => fundP(refOf(x.f), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', nf(x.a, 2) + '%') }, { label: ym(prevMonth(asof)), v: nf(x.b, 2) + '%', src: () => fundP(refOf(x.f), prevMonth(asof), 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', nf(x.b, 2) + '%') }] });
  const moverProv = (x: (typeof movers)[number]): Prov => x.how === 'pct'
    ? { k: 'calc', title: `אחוזון LTM, שינוי מהחודש הקודם · ${x.f.name}`, value: `${nf(x.from, 0)} → ${nf(x.to, 0)}`, formula: 'האחוזון בקטגוריה על תשואת LTM, החודש מול החודש הקודם (מחושב בבניית הנתונים)', inputs: [{ label: 'חודש קודם', v: nf(x.from, 0) }, { label: ym(asof), v: nf(x.to, 0) }, { label: 'מסלולים מדורגים', v: nf(x.n, 0) }] }
    : { k: 'calc', title: `מקום YTD, שינוי מהחודש הקודם · ${x.f.name}`, value: `${x.from} → ${x.to}`, formula: 'המקום בקטגוריה לפי תשואת YTD בסוף החודש הקודם מול היום. YTD של החודש הקודם: (1 + YTD) ÷ (1 + תשואת החודש) − 1',
      inputs: [{ label: 'תשואה YTD', v: pc(retOf(x.f, 'ytd', basis).v), src: () => shownProv(x.f, 'ytd', basis, false, asof, C, data) }, { label: 'תשואת החודש', v: pc(retOf(x.f, 'm1', basis).v), src: () => shownProv(x.f, 'm1', basis, false, asof, C, data) }, { label: 'מסלולים מדורגים', v: nf(x.n, 0) }] };
  const big = board[0];

  return (
    <>
      <FundsHead sub={<>החודש בקופות · <span className="num">{ym(asof)}</span> · <Sourced src={() => countP('מסלולים פעילים', live.length, 'המסלולים הפתוחים לציבור שפורסמו בחודש האחרון, עם נכסים, ללא מסלולים בניהול אישי')}><span className="num">{nf(live.length, 0)}</span></Sourced> מסלולים · {data.source}</>} tools={<BasisToggle netReady={netOk} />} />

      <section className="kpis fhub-kpis">
        <div className="kpi"><div className="l">מסלולים פתוחים לציבור</div><div className="v num"><Sourced src={() => countP('מסלולים פעילים', live.length, 'המסלולים הפתוחים לציבור שפורסמו בחודש האחרון, עם נכסים, ללא מסלולים בניהול אישי')}>{nf(live.length, 0)}</Sourced></div><div className="s">{ym(asof)}</div></div>
        <div className="kpi"><div className="l">נכסים במסלולים</div><div className="v num"><Sourced src={() => ({ k: 'calc', title: 'נכסים, כל המסלולים הפתוחים לציבור', value: nf(totalA / 1000, 0), unit: 'מיליארד ש"ח', formula: 'סכום TOTAL_ASSETS של המסלולים הפתוחים לציבור, חלקי 1,000', note: 'מוצגות 40 הקטגוריות הגדולות',
          inputs: [...cats.entries()].map(([k, fs]) => ({ k, fs, a: fs.reduce((t, f) => t + (f.assets ?? 0), 0) })).sort((x, y) => y.a - x.a).slice(0, 40).map((x) => ({ label: x.k, v: nf(x.a / 1000, 1), src: () => listP(`נכסים · ${x.k}`, nf(x.a, 0), 'מיליוני ש"ח', 'סכום TOTAL_ASSETS של המסלולים בקטגוריה', x.fs.map((f) => ({ label: f.name, v: nf(f.assets ?? 0, 1), src: () => fundP(refOf(f), asof, 'TOTAL_ASSETS', 'נכסים', nf(f.assets ?? 0, 1), 'מיליוני ש"ח') }))) })) })}>{nf(totalA / 1000, 0)}</Sourced></div><div className="s">מיליארד ש"ח</div></div>
        <div className="kpi"><div className="l">בסיס התשואה <Tip k={basis === 'net' ? 'net' : 'gross'} /></div><div className="v">{lbl}</div><div className="s">{basis === 'net' ? 'אחרי דמי ניהול מצבירה' : basisAsked === 'net' ? 'נטו עוד לא בקובץ הנתונים' : 'כפי שהרשות מפרסמת'}</div></div>
      </section>

      {big && big.r.length > 1 && (
        <Panel title="בקצרה" className="fhub-brief">
          <ul className="fbrief">
            <li>ב{prod} {big.track}, הקטגוריה הגדולה במוצר, <Link to={`/funds/${big.r[0].f.k}`}>{big.r[0].f.name}</Link> מוביל עם <V f={big.r[0].f} v={big.r[0].v} /> ב{HUB_WIN.find(([k]) => k === per)?.[1]}; המאסף, <Link to={`/funds/${big.r[big.r.length - 1].f.k}`}>{big.r[big.r.length - 1].f.name}</Link>, עם <V f={big.r[big.r.length - 1].f} v={big.r[big.r.length - 1].v} />.</li>
            {spread[0] && <li>הבחירה השפיעה הכי הרבה ב{spread[0].fs[0].prod} {spread[0].fs[0].track}: פער של <Sourced src={() => spreadProv(spread[0])}><span className="num">{nf(spread[0].d, 1)}</span></Sourced> נקודות אחוז בין המוביל למאסף.</li>}
            {fees.length > 0 && <li>ב{prod}, <Sourced src={() => listP(`שינויי דמי ניהול · ${prod}`, nf(fees.length, 0), undefined, 'המסלולים שדמי הניהול מצבירה שלהם השתנו מהחודש הקודם', fees.map((x) => ({ label: x.f.name, v: `${nf(x.b, 2)}% → ${nf(x.a, 2)}%`, src: () => feeProv(x) })))}><span className="num">{fees.length}</span></Sourced> מסלולים שינו את דמי הניהול מצבירה מהחודש הקודם.</li>}
          </ul>
        </Panel>
      )}

      <Panel title={<>מובילים ומאספים · {prod}</>} aside={<><Pick label="מוצר" value={prod} onChange={setProd} options={prods.map((p) => [p, p] as [string, string])} /><Seg label="חלון" value={per} onChange={setPer} options={HUB_WIN} /><span className={`chip${basis === 'net' || real ? ' est' : ''}`}>{lbl}</span></>}>
        {board.length === 0 ? <Empty title="אין קטגוריות מדורגות במוצר הזה בחלון שנבחר" /> : (
          <div className="fcats">
            {board.map((c) => { const m = median(c.r.map((x) => x.v)); const top = c.r[0], low = c.r[c.r.length - 1];
              return (
                <article className="fcat" key={c.k}>
                  <header><Link to={`/funds/screen?prod=${encodeURIComponent(prod)}&track=${encodeURIComponent(c.track)}&per=${per}`} className="fcat-t">{c.track}</Link>
                    <span className="muted"><Sourced src={() => countP(`מסלולים מדורגים · ${c.k}`, c.r.length, 'המסלולים בקטגוריה שיש להם תשואה בחלון')}><span className="num">{c.r.length}</span></Sourced> מסלולים · חציון {m == null ? '–' : <Sourced src={() => medProv(c, m)}><span className="num">{pc(m, per === 'm1' ? 2 : 1)}</span></Sourced>}</span></header>
                  {[['מוביל', top, 'up'], ['מאסף', low, 'down']].map(([l, x, t]) => { const r = x as Row; return (
                    <div className={`fline ${t}`} key={l as string}><span className="fl-l">{l as string}</span><span className="fl-n"><Link to={`/funds/${r.f.k}`}>{r.f.name}</Link><MgrChip grp={r.f.grp} mgr={r.f.mgr} short /></span><span className="fl-v"><V f={r.f} v={r.v} /></span><CompareAdd k={r.f.k} name={r.f.name} small /></div>
                  ); })}
                </article>
              ); })}
          </div>
        )}
        <div className="fnote">הקטגוריות הגדולות במוצר לפי נכסים; מדורגים מסלולים פתוחים לציבור עם נכסים. {basis === 'net' ? 'נטו: אומדן אחרי דמי ניהול מצבירה.' : 'התשואות לפני דמי ניהול, כפי שהרשות מפרסמת.'} {real ? `ריאלי: מנוכה במדד המחירים לצרכן (הלמ"ס); המדד בקובץ מכסה ${cpi?.series.cpi?.points.length ?? 0} חודשים.` : ''} 3Y: שנתי ממוצע. {SELF_NOTE}.</div>
      </Panel>

      <div className="grid2">
        <Panel title="איפה הבחירה שינתה הכי הרבה" aside={<span>פער בין המוביל למאסף · {HUB_WIN.find(([k]) => k === per)?.[1]}</span>}>
          {spread.length === 0 ? <Empty title="אין קטגוריות עם 5 מסלולים מדורגים לפחות" /> : (
            <div className="scroll"><table className="fsimple">
              <thead><tr><th>קטגוריה</th><th>מסלולים</th><th>פער, נ"א</th></tr></thead>
              <tbody>{spread.map((c) => <tr key={catKey(c.fs[0])}><td><Link to={`/funds/screen?prod=${encodeURIComponent(c.fs[0].prod)}&track=${encodeURIComponent(c.fs[0].track)}&per=${per}`}>{c.fs[0].prod} · {c.fs[0].track}</Link></td><td className="num">{c.r.length}</td><td><Sourced src={() => spreadProv(c)}><span className="num">{nf(c.d, 2)}</span></Sourced></td></tr>)}</tbody>
            </table></div>
          )}
        </Panel>
        <Panel title={<>מקומות שזזו · {prod}</>} aside={<span>{movers[0]?.how === 'pct' ? 'אחוזון LTM, מול החודש הקודם' : 'מקום YTD בקטגוריה, מול החודש הקודם'}</span>}>
          {movers.length === 0 ? <Empty title={asof % 100 === 1 ? 'בינואר אין YTD של חודש קודם להשוואה' : 'אין שינויי מקום בקטגוריות של 5 מסלולים לפחות'} /> : (
            <div className="scroll"><table className="fsimple">
              <thead><tr><th>מסלול</th><th>קטגוריה</th><th>{movers[0].how === 'pct' ? 'אחוזון' : 'מקום'}</th></tr></thead>
              <tbody>{movers.map((x) => { const up = x.how === 'pct' ? x.to > x.from : x.to < x.from;
                return <tr key={x.f.k}><td><Link to={`/funds/${x.f.k}`}>{x.f.name}</Link></td><td className="muted">{x.f.track}</td><td><Sourced src={() => moverProv(x)}><span className={`num ${up ? 'pos' : 'neg'}`}>{x.from} → {x.to}</span></Sourced>{x.how === 'ytd' && <span className="dim num"> מתוך {x.n}</span>}</td></tr>; })}</tbody>
            </table></div>
          )}
        </Panel>
      </div>

      <Panel title={<>שינויי דמי ניהול · {prod}</>} aside={<><span>מצבירה · {ym(asof)} מול החודש הקודם</span><Tip k="fee" /></>}>
        {!hasFee1 && !regFees ? <Loading what="דמי ניהול" /> : fees.length === 0 ? <Empty title="דמי הניהול מצבירה לא השתנו החודש במוצר הזה" /> : (
          <div className="scroll"><table className="fsimple">
            <thead><tr><th>מסלול</th><th>קטגוריה</th><th>קודם</th><th>{ym(asof)}</th><th>שינוי, נ"א</th></tr></thead>
            <tbody>{fees.slice(0, 12).map((x) => <tr key={x.f.k}><td><Link to={`/funds/${x.f.k}`}>{x.f.name}</Link></td><td className="muted">{x.f.track}</td><td className="num">{nf(x.b, 2)}%</td><td className="num">{nf(x.a, 2)}%</td><td><Sourced src={() => feeProv(x)}><span className={`num ${x.a < x.b ? 'pos' : 'neg'}`}>{sn(x.a - x.b, 2)}</span></Sourced></td></tr>)}</tbody>
          </table></div>
        )}
        {fees.length > 12 && <div className="fnote">מוצגים 12 השינויים הגדולים מתוך {fees.length}.</div>}
      </Panel>

      <nav className="ftiles" aria-label="כלי החיסכון">
        {([['/funds/screen', 'funds', 'כל המסלולים', 'סינון לפי מוצר, משפחה, דמי ניהול וחשיפה; שמירת סינונים'], ['/funds/compare', 'compare', 'השוואה ראש בראש', '2–4 מסלולים: צמיחה נטו, חלונות מתגלגלים, ירידות, שנים'], ['/funds/tools', 'sliders', 'כלים', 'מה היה לי, דמי ניהול לאורך קריירה, קרנות ברירת מחדל, עוקבי מדד'],
          ['/savings', 'savings', 'הענף', 'נכסים, צבירה, ניוד והכנסות דמי ניהול של הגופים'], ['/managers', 'companies', 'מנהלים', 'החברות המנהלות ודירוגן לאורך זמן'], ['/holdings', 'statement', 'הרכב נכסים', 'מה הגופים מחזיקים, ברמת גוף ומוצר']] as const).map(([to, icon, t, d]) => (
          <Link key={to} to={to} className="ftile"><span className="icotile lg"><Icon name={icon} /></span><b>{t}</b><span>{d}</span></Link>
        ))}
      </nav>
    </>
  );
}
