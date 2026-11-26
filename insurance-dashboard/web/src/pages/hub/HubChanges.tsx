import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Takeaway } from '../../components/Takeaway';
import { NumText } from '../../components/NumText';
import { Sourced } from '../../components/Source';
import { Loading } from '../../components/ui';
import { fundP, trackKey } from '../../lib/market';
import type { Prov } from '../../lib/prov';
import { nf, sn } from '../../lib/format';
import { catKey, pc, prevMonth, rankAll, refOf, retOf, shownProv, ym, ytdPrev, type FundX } from '../../lib/funds';
import { rankedSpread, scoreRows, typeGrid, typeMembers } from '../../lib/pageMonths';
import { hubSpreadHead, hubSpreadItemSub, hubSpreadWords, NO_MOVERS, noFeeChanges, prodLabel, typeLabel, typeName } from '../../lib/pageWords';
import type { HubCtx } from './HubMonth';

/* The hub's "שינויים" lens (rollout spec §6.2 #6, §17.1 2d, §18.6, T-H3).
   - Saver: one sentence about the reader's type (else the widest), and one card "הפער בין הראשון לאחרון, באוקטובר" for the same types
     as the first lens, in the same names, the reader's marked. A row opens that type's month sheet. Nothing else.
   - Agent and Pro: the spread list over every type of the product (the six widest), "בכל המוצרים" (the old hub's "איפה הבחירה שינתה
     הכי הרבה", any product), "מקומות שזזו" (the percentile in the type on 12 months, last month against this month, pr1 / pr) and
     "שינויי דמי ניהול" (or the plain line), every figure opening its source as on the old hub.
   The gap = first − last of the type's ranked tracks in the data month (lib/pageMonths scoreRows + rankedSpread: self-managed tracks and
   old-generation policies are not ranked). */

type Spread = { key: string; gap: number; n: number; top: FundX; low: FundX; tv: number; lv: number };
function spreadOf(funds: FundX[], key: string, asof: number, min = 2): Spread | null {
  const scored = scoreRows(typeMembers(funds, key), 'm1', { asof }), r = scored.filter((x) => x.ranked && x.v != null);
  const gap = rankedSpread(scored);
  if (gap == null || r.length < min) return null;
  return { key, gap, n: r.length, top: r[0].f, low: r[r.length - 1].f, tv: r[0].v as number, lv: r[r.length - 1].v as number };
}

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

export function HubChanges({ ctx }: { ctx: HubCtx }) {
  const { file, cats, asof, prod, saver, mineKey, openType } = ctx;
  const funds = file.funds;
  const keys = useMemo(() => {
    if (saver) return typeGrid(funds, cats, prod, { asof, mineKey, n: 1 }).cols.map((c) => c.key);
    return [...new Set(funds.filter((f) => f.prod === prod).map(catKey))];
  }, [saver, funds, cats, prod, asof, mineKey]);
  const sp = useMemo(() => keys.map((k) => spreadOf(funds, k, asof, saver ? 2 : 3)).filter((x): x is Spread => !!x).sort((a, b) => b.gap - a.gap).slice(0, 6), [keys, funds, asof, saver]);
  const lead = sp.find((x) => x.key === mineKey) ?? sp[0];
  const spreadProv = (c: Spread): Prov => ({ k: 'calc', title: `פער בין הראשון לאחרון · ${c.key} · ${ym(asof)}`, value: `${nf(c.gap, 2)}%`, formula: 'התשואה החודשית של המסלול הראשון בסוג פחות של האחרון (מסלולים מדורגים, ברוטו)',
    inputs: [{ label: `הראשון: ${c.top.name}`, v: pc(c.tv), src: () => shownProv(c.top, 'm1', 'gross', false, asof, undefined, file) }, { label: `האחרון: ${c.low.name}`, v: pc(c.lv), src: () => shownProv(c.low, 'm1', 'gross', false, asof, undefined, file) }, { label: 'מסלולים מדורגים', v: nf(c.n, 0) }] });
  const card = (
    <div className="hub-card" id="spread-card">
      <div className="hub-bh"><b>{hubSpreadHead(asof)}</b><span>לפני דמי ניהול</span></div>
      <div className="hub-spread" id="spread">
        {sp.map((x) => (
          <button type="button" key={x.key} className="hub-sp" aria-haspopup="dialog" onClick={() => openType(x.key, asof)}>
            <span className="t">{typeLabel(x.key.split(' | ')[1] ?? '')}{saver && x.key === mineKey ? <span className="sb-mine">שלי</span> : null} <small><NumText t={hubSpreadItemSub(x.n)} /></small></span>
            <span className="v">{saver ? <bdi dir="ltr" className="sgnum">{nf(x.gap, 2)}%</bdi> : <Sourced src={() => spreadProv(x)}><bdi dir="ltr" className="sgnum">{nf(x.gap, 2)}%</bdi></Sourced>}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="hub-chg">
      {lead ? <Takeaway text={hubSpreadWords(asof, typeName(lead.key), lead.gap, saver && lead.key === mineKey)} /> : null}
      {card}
      {saver ? null : <ProChanges ctx={ctx} spreadProv={spreadProv} />}
    </div>
  );
}

/* ---------- agent and Pro: every type of every product, the movers, the fee changes (the old hub's panels, kept) ---------- */
function ProChanges({ ctx, spreadProv }: { ctx: HubCtx; spreadProv: (c: Spread) => Prov }) {
  const { file, asof, prod, openType } = ctx;
  const funds = file.funds;
  const live = useMemo(() => funds.filter((f) => f.assets && !f.closed && !f.gone), [funds]);
  const all = useMemo(() => [...new Set(live.map(catKey))].map((k) => spreadOf(funds, k, asof, 5)).filter((x): x is Spread => !!x).sort((a, b) => b.gap - a.gap).slice(0, 5), [live, funds, asof]);
  const cats = useMemo(() => { const by = new Map<string, FundX[]>(); live.filter((f) => f.prod === prod).forEach((f) => by.set(catKey(f), [...(by.get(catKey(f)) ?? []), f])); return by; }, [live, prod]);
  const movers = useMemo(() => {
    const out: { f: FundX; from: number; to: number; n: number; how: 'pct' | 'ytd' }[] = [];
    const pubPrev = live.some((f) => f.pr1?.y12 != null);
    [...cats.values()].forEach((fs) => {
      if (pubPrev) { fs.forEach((f) => { const a = f.pr1?.y12, b = f.pr?.y12, n = f.prn?.y12; if (a != null && b != null && n != null) out.push({ f, from: a, to: b, n, how: 'pct' }); }); return; }
      if (asof % 100 === 1) return;
      const now = rankAll(fs, (f) => retOf(f, 'ytd').v), was = rankAll(fs, (f) => { const r = retOf(f, 'ytd').v, m = retOf(f, 'm1').v; return r == null || m == null ? null : ytdPrev({ ytd: r, m1: m }, asof); });
      fs.forEach((f) => { const a = was.get(f.k), b = now.get(f.k); if (a && b && b.n >= 5 && a.n === b.n) out.push({ f, from: a.rank, to: b.rank, n: b.n, how: 'ytd' }); });
    });
    return out.filter((x) => x.from !== x.to).sort((a, b) => (b.how === 'pct' ? Math.abs(b.to - b.from) - Math.abs(a.to - a.from) : Math.abs(b.from - b.to) / b.n - Math.abs(a.from - a.to) / a.n)).slice(0, 8);
  }, [cats, asof, live]);
  const hasFee1 = useMemo(() => funds.some((f) => f.fee1 != null), [funds]);
  const nGroups = useMemo(() => new Set(funds.map((f) => f.grp)).size, [funds]);
  const regFees = useRegFees(asof, !hasFee1, nGroups);
  const inProd = live.filter((f) => f.prod === prod);
  const fees = useMemo(() => {
    const rows: { f: FundX; a: number; b: number }[] = [];
    inProd.forEach((f) => {
      if (hasFee1) { if (f.fee != null && f.fee1 != null && Math.abs(f.fee - f.fee1) >= 0.005) rows.push({ f, a: f.fee, b: f.fee1 }); return; }
      const x = regFees?.get(f.k);
      if (x && x[0] != null && x[1] != null && Math.abs(x[0] - x[1]) >= 0.005) rows.push({ f, a: x[0], b: x[1] });
    });
    return rows.sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b));
  }, [inProd, hasFee1, regFees]);  // eslint-disable-line react-hooks/exhaustive-deps
  const feeProv = (x: (typeof fees)[number]): Prov => ({ k: 'calc', title: `שינוי בדמי הניהול מצבירה · ${x.f.name}`, value: `${sn(x.a - x.b, 2)} נ"א`, formula: `דמי הניהול הממוצעים ב-${ym(asof)} פחות דמי הניהול בחודש הקודם (AVG_ANNUAL_MANAGEMENT_FEE)`,
    inputs: [{ label: ym(asof), v: nf(x.a, 2) + '%', src: () => fundP(refOf(x.f), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', nf(x.a, 2) + '%') }, { label: ym(prevMonth(asof)), v: nf(x.b, 2) + '%', src: () => fundP(refOf(x.f), prevMonth(asof), 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה', nf(x.b, 2) + '%') }] });
  const moverProv = (x: (typeof movers)[number]): Prov => x.how === 'pct'
    ? { k: 'calc', title: `אחוזון LTM, שינוי מהחודש הקודם · ${x.f.name}`, value: `${nf(x.from, 0)} → ${nf(x.to, 0)}`, formula: 'האחוזון בקטגוריה על תשואת LTM (ברוטו), החודש מול החודש הקודם (מחושב בבניית הנתונים)', inputs: [{ label: 'חודש קודם', v: nf(x.from, 0) }, { label: ym(asof), v: nf(x.to, 0) }, { label: 'מסלולים מדורגים', v: nf(x.n, 0) }] }
    : { k: 'calc', title: `מקום YTD, שינוי מהחודש הקודם · ${x.f.name}`, value: `${x.from} → ${x.to}`, formula: 'המקום בקטגוריה לפי תשואת YTD בסוף החודש הקודם מול היום. YTD של החודש הקודם: (1 + YTD) ÷ (1 + תשואת החודש) − 1',
      inputs: [{ label: 'תשואה YTD', v: pc(retOf(x.f, 'ytd').v), src: () => shownProv(x.f, 'ytd', 'gross', false, asof, undefined, file) }, { label: 'תשואת החודש', v: pc(retOf(x.f, 'm1').v), src: () => shownProv(x.f, 'm1', 'gross', false, asof, undefined, file) }, { label: 'מסלולים מדורגים', v: nf(x.n, 0) }] };
  const pl = prodLabel(prod);
  return (
    <>
      <section className="hub-card hub-sec" id="spread-all">
        <div className="hub-bh"><b>איפה הבחירה שינתה הכי הרבה · בכל המוצרים</b><span>{ym(asof)} · לפני דמי ניהול</span></div>
        <div className="hub-spread">
          {all.map((x) => (
            <button type="button" key={x.key} className="hub-sp" aria-haspopup="dialog" onClick={() => openType(x.key, asof)}>
              <span className="t">{typeName(x.key)} <small><NumText t={hubSpreadItemSub(x.n)} /></small></span>
              <span className="v"><Sourced src={() => spreadProv(x)}><bdi dir="ltr" className="sgnum">{nf(x.gap, 2)}%</bdi></Sourced></span>
            </button>
          ))}
        </div>
      </section>
      <section className="hub-card hub-sec" id="movers">
        <div className="hub-bh"><b>מקומות שזזו · {pl}</b><span>{movers[0]?.how === 'ytd' ? 'מקום YTD בקטגוריה, מול החודש הקודם' : 'אחוזון LTM בקטגוריה, מול החודש הקודם'}</span></div>
        {movers.length === 0 ? <p className="hub-plain">{NO_MOVERS}</p> : (
          <div className="scroll"><table className="fsimple hub-tbl">
            <thead><tr><th>מסלול</th><th>סוג</th><th>{movers[0].how === 'pct' ? 'אחוזון' : 'מקום'}</th></tr></thead>
            <tbody>{movers.map((x) => { const up = x.how === 'pct' ? x.to > x.from : x.to < x.from;
              return <tr key={x.f.k}><td><Link to={`/funds/${x.f.k}`}>{x.f.name}</Link></td><td className="muted">{typeLabel(x.f.track)}</td><td><Sourced src={() => moverProv(x)}><span className={`num ${up ? 'pos' : 'neg'}`}>{x.from} → {x.to}</span></Sourced>{x.how === 'ytd' && <span className="dim num"> מתוך {x.n}</span>}</td></tr>; })}</tbody>
          </table></div>
        )}
      </section>
      <section className="hub-card hub-sec" id="feechg">
        <div className="hub-bh"><b>שינויי דמי ניהול · {pl}</b><span>מצבירה, ממוצע בפועל · {ym(asof)} מול החודש הקודם</span></div>
        {!hasFee1 && !regFees ? <Loading what="דמי ניהול" /> : fees.length === 0 ? <p className="hub-plain"><NumText t={noFeeChanges(inProd.length)} /></p> : (
          <div className="scroll"><table className="fsimple hub-tbl">
            <thead><tr><th>מסלול</th><th>סוג</th><th>קודם</th><th>{ym(asof)}</th><th>שינוי, נ"א</th></tr></thead>
            <tbody>{fees.slice(0, 12).map((x) => <tr key={x.f.k}><td><Link to={`/funds/${x.f.k}`}>{x.f.name}</Link></td><td className="muted">{typeLabel(x.f.track)}</td><td className="num">{nf(x.b, 2)}%</td><td className="num">{nf(x.a, 2)}%</td><td><Sourced src={() => feeProv(x)}><span className={`num ${x.a < x.b ? 'pos' : 'neg'}`}>{sn(x.a - x.b, 2)}</span></Sourced></td></tr>)}</tbody>
          </table></div>
        )}
        {fees.length > 12 ? <p className="hub-plain">מוצגים 12 השינויים הגדולים מתוך {fees.length}.</p> : null}
      </section>
    </>
  );
}
