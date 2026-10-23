import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { Sheet } from '../components/Sheet';
import { BreakChip, Empty, ErrorBox, Field, Kpi, Loading, Panel, Seg as SegCtl } from '../components/ui';
import { IdDot } from '../components/MgrChip';
import { foxOption } from '../lib/foxchart';
import { identify } from '../lib/idmarks';
import { nf, sn } from '../lib/format';
import { GROUP_ID, idColor, idColorOfGroup } from '../lib/identity';
import { LensSrc, NO_REP, SEG_LONG, SEGS, bn, madd, pc, ql, rankHistory, spc, useLens, warmRep, ym, type LensData, type LensNow, type LensRow, type RankBy, type Seg } from '../lib/lens';
import { useSource, type Prov } from '../lib/prov';
import { chartBase, cssColor, CHART_FONT } from '../lib/theme';
import { usePhone } from '../lib/useMedia';
import '../styles/lens.css';
import '../styles/prov-market.css';

const LensMarket = lazy(async () => ({ default: (await import('./SavingsLensMarket')).LensMarket }));
const IndustryEcon = lazy(async () => ({ default: (await import('./IndustryEcon')).IndustryEcon }));

type View = 'lens' | 'now' | 'rank' | 'market' | 'econ';
const OTHERS = 'קרנות ענפיות ואחרות';
const short = (g: string) => g.replace('מנורה מבטחים', 'מנורה').replace('אלטשולר שחם', 'אלטשולר').replace('ילין לפידות', 'ילין').replace('ביטוח ישיר', 'ישיר').replace(OTHERS, 'ענפיות');
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
/** small ratios (0.27%) need decimals on the value axis */
function decimals<T>(o: T, dec: number, pct: boolean): T {
  const ys = (o as { yAxis?: { axisLabel?: { formatter?: unknown } }[] }).yAxis ?? [];
  ys.forEach((a) => { a.axisLabel = { ...(a.axisLabel ?? {}), formatter: (v: number) => `${nf(v, dec)}${pct ? '%' : ''}` }; });
  return o;
}
/** a missing figure: a dash whose tooltip says why */
const Dash = ({ why }: { why: string }) => <span className="muted lens-dash" title={why}>–</span>;
const S = ({ src, children, className = '' }: { src: () => Prov; children: ReactNode; className?: string }) => <Sourced src={src}><span className={`num ${className}`}>{children}</span></Sourced>;

/** Savings Lens: the regulator's monthly fund data and the managers' quarterly P&L on one axis. */
export function SavingsLens() {
  const { data, error } = useLens();
  if (error) return <ErrorBox what="עדשת החיסכון" error={error} />;
  if (!data) return <Loading what="עדשת החיסכון" />;
  return <Lens d={data} />;
}

function Lens({ d }: { d: LensData }) {
  const [sp, setSp] = useSearchParams();
  const src = useMemo(() => new LensSrc(d), [d]);
  const view = (['lens', 'now', 'rank', 'market', 'econ'] as View[]).find((v) => v === sp.get('v')) ?? 'lens';
  const seg = (SEGS.map(([k]) => k).find((k) => k === sp.get('s')) ?? 'pen') as Seg;
  const q = d.quarters.includes(sp.get('q') ?? '') ? sp.get('q')! : d.meta.last_rep;
  const g = d.groups.findIndex((x) => x.name === sp.get('g'));
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setSp(n, { replace: true }); };
  const views: [View, string][] = [['lens', 'עדשה'], ['now', `אומדן ${ql(d.nowcast.q)}`], ['market', 'נכסים ותזרימים'], ['econ', 'רווחיות מהדוחות']];
  // the managers' ranking over time has one home, the managers page; an old ?v=rank link lands there with its settings
  if (view === 'rank') { const n = new URLSearchParams(sp); n.set('v', 'rank'); n.delete('q'); return <Navigate to={`/managers?${n}`} replace />; }
  return (
    <>
      <h2 className="band">עדשת חיסכון<span className="muted">תזרימים ונכסים: רשות שוק ההון, חודשי, עד <span className="num">{ym(d.meta.asof)}</span> · הכנסות והוצאות: דוחות החברות המנהלות, עד <span className="num">{ql(d.meta.last_rep)}</span></span></h2>
      <div className="lens-views"><SegCtl<View> label="תצוגה" value={view} onChange={(v) => set({ v: v === 'lens' ? '' : v })} options={views} /><Link className="chip lens-out" to={`/managers?v=rank${seg !== 'pen' ? `&s=${seg}` : ''}`}>דירוג מנהלים לאורך זמן ←</Link></div>
      {view === 'lens' && <LensView d={d} src={src} seg={seg} q={q} g={g} set={set} />}
      {view === 'now' && <NowView d={d} src={src} seg={seg} set={set} />}
      {(view === 'market' || view === 'econ') && <Suspense fallback={<Loading what="התצוגה" />}>{view === 'market' ? <LensMarket /> : <IndustryEcon />}</Suspense>}
      {g >= 0 && view === 'now' && <Drill d={d} src={src} g={g} seg={seg} onClose={() => set({ g: '' })} />}
    </>
  );
}

function SegPick({ seg, set, omit = [] }: { seg: Seg; set: (p: Record<string, string>) => void; omit?: Seg[] }) {
  return <div className="field"><span>פעילות</span><SegCtl<Seg> label="פעילות" value={seg} onChange={(v) => set({ s: v === 'pen' ? '' : v })} options={SEGS.filter(([k]) => !omit.includes(k))} /></div>;
}

/** The lens of one managing group, for the company "חיסכון ארוך טווח" tab: every quarter, both sources, per activity. */
export function LensForGroup({ group }: { group: string }) {
  const { data: d, error } = useLens();
  const [seg, setSeg] = useState<Seg>('pg');
  const src = useMemo(() => (d ? new LensSrc(d) : null), [d]);
  if (error) return <ErrorBox what="עדשת החיסכון" error={error} />;
  if (!d || !src) return <Loading what="עדשת החיסכון" />;
  const g = d.groups.findIndex((x) => x.name === group);
  if (g < 0) return null;
  const segs = SEGS.filter(([k]) => d.rows.some((r) => r.g === g && r.s === k));
  const S0 = segs.some(([k]) => k === seg) ? seg : segs[0]?.[0];
  if (!S0) return null;
  return (
    <Panel title={<>עדשת חיסכון · {SEG_LONG[S0]}</>} aside={<><SegCtl<Seg> label="פעילות" value={S0} onChange={setSeg} options={segs} /><Link className="chip" to={`/industry/savings?g=${encodeURIComponent(group)}&s=${S0}`}>מול המנהלים האחרים</Link></>}>
      <DrillBody d={d} src={src} g={g} seg={S0} />
    </Panel>
  );
}

/* ---------- the lens: one quarter, every manager, both sources ---------- */
type TrendKey = 'fy' | 'ci' | 'ppb' | 'flow_share' | 'growth';
function LensView({ d, src, seg, q, g, set }: { d: LensData; src: LensSrc; seg: Seg; q: string; g: number; set: (p: Record<string, string>) => void }) {
  const phone = usePhone();
  const { open } = useSource();
  const [trend, setTrend] = useState<TrendKey>('fy');
  const ins = seg === 'ins', flows = !ins;
  const rows = useMemo(() => d.rows.filter((r) => r.s === seg && r.q === q).sort((a, b) => (b.reg.aE ?? 0) - (a.reg.aE ?? 0)), [d, seg, q]);
  const e = rows[0]?.reg.e ?? 0;
  const fy = (r: LensRow) => (ins ? r.fy_rep : r.fy_reg);
  const fyP = (r: LensRow) => (ins ? src.fyRep(r) : src.fyReg(r));
  const brk = ins ? d.breaks.filter((b) => b.family === 'insurance' && b.metric === 'fee' && Number(b.from) <= e && Number(b.from) > madd(e, -12)).pop() : undefined;

  // the sector: managers with both sources in the quarter
  const sample = rows.filter((r) => fy(r) != null);
  const sumOf = (xs: LensRow[], f: (r: LensRow) => number) => xs.reduce((t, r) => t + f(r), 0);
  const secFy = sample.length ? (ins ? sumOf(sample, (r) => r.rep!.fees!) * 4 / (sumOf(sample, (r) => (r.rep!.aE! + r.rep!.aO!) / 2) * 1000) * 100 : sumOf(sample, (r) => r.rep!.fees!) * 4 / sumOf(sample, (r) => r.reg.avg!) * 100) : null;
  const ciS = rows.filter((r) => r.ci != null && !r.mark), ppbS = rows.filter((r) => r.ppb != null && !r.mark);
  const secCi = ciS.length ? sumOf(ciS, (r) => r.rep!.sm! + r.rep!.ga!) / sumOf(ciS, (r) => r.rep!.fees!) * 100 : null;
  const secPpb = ppbS.length ? sumOf(ppbS, (r) => r.rep!.op!) * 4 / (sumOf(ppbS, (r) => r.reg.avg!) / 1000) : null;
  const mkt = d.series[`-1|${seg}`], mi = d.months.indexOf(e);
  const mktA = mkt && mi >= 0 ? mkt.a[mi] : null;
  const netQ = flows ? sumOf(rows.filter((r) => r.reg.org != null && r.reg.tr != null), (r) => r.reg.org! + r.reg.tr!) : null;
  const listP = (title: string, value: string, unit: string | undefined, formula: string, xs: LensRow[], v: (r: LensRow) => string, p: (r: LensRow) => Prov, note?: string): Prov =>
    ({ k: 'calc', title, value, unit, formula, inputs: xs.map((r) => ({ label: src.name(r.g), v: v(r), src: () => p(r) })), note });

  const xlsx = async () => {
    const { downloadXlsx } = await import('../lib/xlsx');
    const head = ['מנהל', 'נכסים, מיליארד ש"ח (רשות)', 'נתח מנכסים %', 'נתח מהצבירה %', 'ניוד נטו QTD, מיליארד', 'צבירה אורגנית QTD, מיליארד', 'צמיחה אורגנית %', 'דמי ניהול מוצהרים %', 'הכנסות מדמי ניהול, מיליוני ש"ח (דוח)', 'שיווק ומכירה', 'הנהלה וכלליות', 'רווח תפעולי', 'נכסים ממוצעים, מיליארד (רשות)', 'תשואת דמי ניהול על נכסי הרשות %', 'תשואת דמי ניהול על נכסי הדוח %', 'הוצאות להכנסות %', 'רווח למיליארד, מיליוני ש"ח', 'נכסים בדוח ÷ נכסי הרשות %'];
    const n = (x: number | null | undefined, f: 'n0' | 'n1' | 'n2' = 'n2') => (x == null ? null : { v: x, fmt: f });
    downloadXlsx(`fox-עדשת-חיסכון-${seg}-${q}`, [{ name: `${SEG_LONG[seg]} ${ql(q)}`.slice(0, 31), freeze: { rows: 1, cols: 1 }, widths: [22, ...head.slice(1).map(() => 14)],
      rows: [head.map((h) => ({ v: h, bold: true })), ...rows.map((r) => [src.name(r.g), n(r.reg.aE != null ? r.reg.aE / 1000 : null), n(r.aum_share), n(r.flow_share), n(r.reg.tr != null ? r.reg.tr / 1000 : null), n(r.reg.org != null ? r.reg.org / 1000 : null), n(r.growth), n(r.reg.posted),
        n(r.rep?.fees, 'n1'), n(r.rep?.sm, 'n1'), n(r.rep?.ga, 'n1'), n(r.rep?.op, 'n1'), n(r.reg.avg != null ? r.reg.avg / 1000 : null), n(r.fy_reg), n(r.fy_rep), n(r.ci, 'n1'), n(r.ppb), n(r.cover, 'n1')]),
      [], [`מקור: ${d.meta.source_reg}; ${d.meta.source_rep}. נוסחאות: pipeline/build_lens.py. fox · ${location.host}${location.pathname}${location.search}`]] }]);
  };

  // the trend: one metric per manager over the quarters
  const tdef: Record<TrendKey, { label: string; v: (r: LensRow) => number | null | undefined; dec: number; pct: boolean; unit: string; p: (r: LensRow) => Prov }> = {
    fy: { label: ins ? 'תשואת דמי ניהול על נכסי הדוח' : 'תשואת דמי ניהול', v: fy, dec: 3, pct: true, unit: '%', p: fyP },
    ci: { label: 'הוצאות להכנסות', v: (r) => r.ci, dec: 1, pct: true, unit: '%', p: (r) => src.ci(r) },
    ppb: { label: 'רווח תפעולי למיליארד', v: (r) => r.ppb, dec: 2, pct: false, unit: 'מיליוני ש"ח למיליארד', p: (r) => src.ppb(r) },
    flow_share: { label: 'נתח מהצבירה נטו', v: (r) => r.flow_share, dec: 1, pct: true, unit: '%', p: (r) => src.share(r, d.rows, 'flow') },
    growth: { label: 'צמיחה אורגנית', v: (r) => r.growth, dec: 2, pct: true, unit: '%', p: (r) => src.growth(r) },
  };
  const TK = (ins ? ['fy'] : ['fy', 'ci', 'ppb', 'flow_share', 'growth']).filter((k) => seg !== 'hish' || k === 'flow_share' || k === 'growth') as TrendKey[];
  const tk = TK.includes(trend) ? trend : TK[0];
  const tg = useMemo(() => [...new Set(d.rows.filter((r) => r.s === seg && tdef[tk].v(r) != null).map((r) => r.g))].sort((a, b) => (rows.find((r) => r.g === b)?.reg.aE ?? 0) - (rows.find((r) => r.g === a)?.reg.aE ?? 0)), [d, seg, tk, rows]);  // eslint-disable-line react-hooks/exhaustive-deps
  const cell = (gg: number, qq: string) => d.rows.find((r) => r.g === gg && r.s === seg && r.q === qq);

  return (
    <>
      <section className="controls lens-ctl">
        <SegPick seg={seg} set={set} />
        <Field label="רבעון"><select value={q} onChange={(ev) => set({ q: ev.target.value === d.meta.last_rep ? '' : ev.target.value })}>{[...d.quarters].reverse().map((x) => <option key={x} value={x}>{ql(x)}</option>)}</select></Field>
      </section>

      <section className="kpis">
        <Kpi label={`נכסים, ${SEG_LONG[seg]}`} value={mktA == null ? '–' : <Sourced src={() => src.reg('assets', e, 'm', seg, -1, bn(mktA, 0), 'מיליארד ש"ח')}>{bn(mktA, 0)}</Sourced>} sub={<>מיליארד ש"ח · רשות · <span className="num">{ym(e)}</span></>} />
        {flows && <Kpi label={`צבירה נטו, ${ql(q)}`} value={netQ == null ? '–' : <Sourced src={() => listP(`צבירה נטו · ${SEG_LONG[seg]} · ${ql(q)}`, bn(netQ, 1), 'מיליארד ש"ח', 'סכום צבירה אורגנית ועוד העברות נטו של הקבוצות', rows.filter((r) => r.reg.org != null && r.reg.tr != null), (r) => bn(r.reg.org! + r.reg.tr!, 2), (r) => src.share(r, d.rows, 'flow'))}>{bn(netQ, 1)}</Sourced>} tone={netQ != null && netQ < 0 ? 'neg' : undefined} sub="מיליארד ש״ח · הפקדות פחות משיכות, ועוד ניוד" />}
        <Kpi label={ins ? 'תשואת דמי ניהול, פוליסות חיסכון' : 'תשואת דמי ניהול'} value={secFy == null ? '–' : <Sourced src={() => listP(`תשואת דמי ניהול · מגזר · ${SEG_LONG[seg]} · ${ql(q)}`, pc(secFy, 3), 'שנתי', ins ? 'Σ הכנסות מדמי ניהול × 4 ÷ Σ נכסים ממוצעים בדוח × 100, על המנהלים שבמדגם' : 'Σ הכנסות מדמי ניהול × 4 ÷ Σ נכסים ממוצעים ברשות × 100, על המנהלים שיש להם שני המקורות', sample, (r) => pc(fy(r), 3), fyP)}>{pc(secFy, 3)}</Sourced>} sub={<>שנתי · <span className="num">{sample.length}</span> מנהלים · <span className="chip est">נגזר</span></>} />
        {!ins && seg !== 'hish' && <Kpi label="הוצאות להכנסות" value={secCi == null ? '–' : <Sourced src={() => listP(`הוצאות להכנסות · מגזר · ${SEG_LONG[seg]} · ${ql(q)}`, pc(secCi, 1), undefined, 'Σ (שיווק ומכירה + הנהלה וכלליות) ÷ Σ הכנסות מדמי ניהול × 100. ללא מנהלים שהנתון שלהם אינו בר השוואה', ciS, (r) => pc(r.ci, 1), (r) => src.ci(r))}>{pc(secCi, 1)}</Sourced>} sub={<>מהדוחות · <span className="num">{ciS.length}</span> מנהלים</>} />}
        {!ins && seg !== 'hish' && <Kpi label="רווח תפעולי למיליארד" value={secPpb == null ? '–' : <Sourced src={() => listP(`רווח תפעולי למיליארד · מגזר · ${SEG_LONG[seg]} · ${ql(q)}`, nf(secPpb, 2), 'מיליוני ש"ח למיליארד', 'Σ רווח תפעולי × 4 ÷ Σ נכסים ממוצעים ברשות במיליארדים', ppbS, (r) => nf(r.ppb!, 2), (r) => src.ppb(r))}>{nf(secPpb, 2)}</Sourced>} sub="מיליוני ש״ח לכל מיליארד נכסים, שנתי" />}
      </section>
      {ins && <div className="lens-note"><span className="chip est">שני סוגי חוזים</span> ביטוח-נט מאחד ביטוחי מנהלים (IFRS 17) ופוליסות חיסכון (חוזי השקעה, IFRS 9) באותם מסלולים. תשואת דמי הניהול כאן היא של פוליסות החיסכון בלבד, על הנכסים שבדוח; הנכסים והנתח הם של ביטוח-נט כולו. {brk && <BreakChip b={{ label: ym(Number(brk.from)), note: brk.note }} />}</div>}
      {seg === 'hish' && <div className="lens-note"><span className="chip">נתוני רשות בלבד</span> {NO_REP.hish}.</div>}

      <Panel title={`${SEG_LONG[seg]} · ${ql(q)}`} aside={<><span>נכסים ותזרימים: מיליארדי ש"ח · יחסים שנתיים</span><button type="button" className="btn" onClick={() => void xlsx()}>Excel</button></>}>
        <div className="scroll"><table className="lens-tbl">
          <thead><tr>
            <th>מנהל</th><th>נכסים</th><th className="wide-only">נתח</th>
            {flows && <><th className="wide-only">נתח מהצבירה</th><th className="wide-only">ניוד נטו</th><th className="wide-only">צבירה אורגנית</th><th className="wide-only">צמיחה</th></>}
            <th className="wide-only">דמי ניהול מוצהרים {brk && <BreakChip b={{ label: ym(Number(brk.from)), note: brk.note }} />}</th>
            {seg !== 'hish' && <><th>{phone ? 'דמי ניהול' : 'תשואת דמי ניהול'} <span className="chip est">נגזר</span></th>{!ins && <th className="wide-only">על נכסי הדוח</th>}</>}
            {!ins && seg !== 'hish' && <><th className="wide-only">הוצאות להכנסות</th><th>{phone ? 'רווח/מיליארד' : 'רווח למיליארד'}</th><th className="wide-only" title="נכסים בדוח החברה ÷ נכסיה אצל הרשות: 100% = אותו בסיס">דוח ÷ רשות</th></>}
          </tr></thead>
          <tbody>{rows.map((r) => {
            const name = src.name(r.g), noRep = r.rep ? null : (d.groups[r.g].lts ? NO_REP[seg] : 'לחברה אין דוח רווח והפסד מגזרי באתר');
            return (
              <tr key={r.g} className={r.g === g ? 'lead' : ''} onPointerEnter={() => warmRep(r.rep?.c)}>
                <td><button type="button" className="lens-mgr" onClick={() => set({ g: name })}><IdDot grp={name} />{phone ? short(name) : name}</button>{r.mark && <span className="chip est" title={r.mark}>לא בר השוואה</span>}</td>
                <td>{r.reg.aE == null ? '–' : <S src={() => src.reg('assets', r.reg.e, 'm', seg, r.g, bn(r.reg.aE), 'מיליארד ש"ח')}>{bn(r.reg.aE, r.reg.aE < 10000 ? 2 : 1)}</S>}</td>
                <td className="wide-only">{r.aum_share == null ? '–' : <S src={() => src.share(r, d.rows, 'aum')}>{pc(r.aum_share, 1)}</S>}</td>
                {flows && <>
                  <td className="wide-only">{r.flow_share == null ? <Dash why="אין תזרים מלא לרבעון, או שהצבירה נטו של השוק אינה חיובית" /> : <><S src={() => src.share(r, d.rows, 'flow')}>{pc(r.flow_share, 1)}</S>{r.aum_share != null && r.flow_share !== r.aum_share && <span className="lens-vs" title={r.flow_share > r.aum_share ? 'מעל הנתח בנכסים: צובר מהר מהשוק' : 'מתחת לנתח בנכסים: צובר לאט מהשוק'} aria-label={r.flow_share > r.aum_share ? 'מעל הנתח בנכסים' : 'מתחת לנתח בנכסים'}>{r.flow_share > r.aum_share ? '▲' : '▼'}</span>}</>}</td>
                  <td className="wide-only">{r.reg.tr == null ? <Dash why="אין תזרים מלא לרבעון" /> : <S className={tone(r.reg.tr)} src={() => src.reg('transfers', r.reg.e, 'q', seg, r.g, bn(r.reg.tr, 2), 'מיליארד ש"ח')}>{sn(r.reg.tr / 1000, 2)}</S>}</td>
                  <td className="wide-only">{r.reg.org == null ? <Dash why="אין תזרים מלא לרבעון" /> : <S className={tone(r.reg.org)} src={() => src.reg('organic', r.reg.e, 'q', seg, r.g, bn(r.reg.org, 2), 'מיליארד ש"ח')}>{sn(r.reg.org / 1000, 2)}</S>}</td>
                  <td className="wide-only">{r.growth == null ? <Dash why="אין תזרים מלא לרבעון" /> : <S className={tone(r.growth)} src={() => src.growth(r)}>{spc(r.growth, 1)}</S>}</td>
                </>}
                <td className="wide-only">{r.reg.posted == null ? '–' : <S src={() => src.reg('fee', r.reg.e, 'm', seg, r.g, pc(r.reg.posted), undefined)}>{pc(r.reg.posted, 2)}</S>}</td>
                {seg !== 'hish' && <>
                  <td>{fy(r) == null ? <Dash why={noRep ?? (ins ? 'אין נכסי פוליסות חיסכון בדוח לשני המועדים' : 'חסר נתון הכנסות או נכסים לרבעון')} /> : <S src={() => fyP(r)}>{pc(fy(r), 2)}</S>}</td>
                  {!ins && <td className="wide-only">{r.fy_rep == null ? <Dash why={noRep ?? 'חסרים נכסים מדווחים לתחילת הרבעון או לסופו'} /> : <S src={() => src.fyRep(r)}>{pc(r.fy_rep, 2)}</S>}</td>}
                </>}
                {!ins && seg !== 'hish' && <>
                  <td className="wide-only">{r.ci == null ? <Dash why={noRep ?? 'הדוח אינו מפצל שיווק והנהלה לרבעון זה'} /> : <S src={() => src.ci(r)}>{pc(r.ci, 0)}</S>}</td>
                  <td>{r.ppb == null ? <Dash why={noRep ?? 'חסר רווח תפעולי לרבעון'} /> : <S className={r.ppb < 0 ? 'neg' : ''} src={() => src.ppb(r)}>{nf(r.ppb, 2)}</S>}</td>
                  <td className="wide-only">{r.cover == null ? '' : <Sourced src={() => src.cover(r)}><span className={`num lens-cover${Math.abs(r.cover - 100) <= 1.5 ? '' : ' off'}`} title={Math.abs(r.cover - 100) <= 1.5 ? 'הדוח והרשות על אותו בסיס נכסים' : 'הדוח כולל נכסים שאינם בנתוני הרשות (קרנות ותיקות, מקבלי קצבה) או חסר מהם'}>{nf(r.cover, 0)}%</span></Sourced>}</td>
                </>}
              </tr>
            );
          })}</tbody>
        </table></div>
        <div className="fnote">{ins ? 'תשואת דמי ניהול = הכנסות הרבעון מפוליסות חיסכון × 4 ÷ ממוצע נכסי פוליסות החיסכון בתחילת הרבעון ובסופו, הכול מהדוח. ' : <>{flows ? '▲ / ▼ בנתח מהצבירה: מעל או מתחת לנתח בנכסים (צובר מהר או לאט מהשוק). ' : ''}{seg !== 'hish' && 'תשואת דמי ניהול = הכנסות הרבעון מהדוח × 4 ÷ נכסים ממוצעים (טרפז על ארבעה סופי חודש) מהרשות. נכסי דוח ÷ רשות: 100% = אותו בסיס; מעל 100 כשהדוח כולל קרנות ותיקות או מקבלי קצבה. '}</>}לחיצה על מנהל פותחת אותו.</div>
      </Panel>

      {g >= 0 && <Drill d={d} src={src} g={g} seg={seg} onClose={() => set({ g: '' })} />}
      <div className="grid2">
        {flows && <Panel title="נתח מנכסים מול נתח מהצבירה" aside={<span>%, {ql(q)} · מעל הקו: צובר מהר מהשוק</span>}>
          <ShareScatter rows={rows.filter((r) => r.aum_share != null && r.flow_share != null && d.groups[r.g].name !== OTHERS)} d={d} onPoint={(r) => open(src.share(r, d.rows, 'flow'))} lead={g} />
        </Panel>}
        <Panel title={tdef[tk].label} aside={TK.length > 1 ? <SegCtl<TrendKey> label="מדד" value={tk} onChange={setTrend} options={TK.map((k) => [k, ({ fy: 'דמי ניהול', ci: 'הוצאות', ppb: 'רווח', flow_share: 'נתח צבירה', growth: 'צמיחה' } as Record<TrendKey, string>)[k]])} /> : <span>{tdef[tk].unit}</span>} className={flows ? '' : 'span2'}>
          <Chart label={`${tdef[tk].label} · ${SEG_LONG[seg]}`} height={phone ? 300 : 330} deps={[seg, tk, g, tg.join()]} source={`${d.meta.source_reg}; ${d.meta.source_rep}`}
            onPoint={(si, di) => { const r = cell(tg[si], d.quarters[di]); if (r && tdef[tk].v(r) != null) open(tdef[tk].p(r)); }}
            build={() => identify(decimals(foxOption({ x: d.quarters.map(ql), unit: tdef[tk].unit, scale: true, legend: true,
              series: tg.map((gg) => ({ name: short(src.name(gg)), kind: 'line' as const, pct: tdef[tk].pct, dec: tdef[tk].dec, color: idColorOfGroup(src.name(gg)), lead: gg === g, dim: g >= 0 && gg !== g,
                data: d.quarters.map((qq) => { const r = cell(gg, qq); const v = r ? tdef[tk].v(r) : null; return v == null ? null : +v.toFixed(tdef[tk].dec + 1); }) })) }), tk === 'fy' ? 2 : tk === 'ppb' || tk === 'growth' ? 1 : 0, tdef[tk].pct))} />
        </Panel>
      </div>
    </>
  );
}

function ShareScatter({ rows, d, onPoint, lead }: { rows: LensRow[]; d: LensData; onPoint: (r: LensRow) => void; lead: number }) {
  const phone = usePhone();
  return (
    <Chart label="נתח מנכסים מול נתח מהצבירה" height={phone ? 300 : 330} deps={[rows.map((r) => r.g + ':' + r.flow_share).join(), lead]} onPoint={(_s, di) => { const r = rows[di]; if (r) onPoint(r); }} build={() => {
      const b = chartBase();
      const xs = rows.map((r) => r.aum_share!), ys = rows.map((r) => r.flow_share!);
      const hi = Math.max(5, ...xs, ...ys.filter((y) => y > 0)), lo = Math.min(0, ...ys);
      const amax = Math.max(...rows.map((r) => r.reg.aE ?? 0), 1);
      return {
        animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg },
        grid: { left: 8, right: 18, top: 30, bottom: 24, containLabel: true },
        tooltip: { trigger: 'item', confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 },
          formatter: (p: { dataIndex: number }) => { const r = rows[p.dataIndex]; return `<b>${d.groups[r.g].name}</b><br>נתח מנכסים: <b>${nf(r.aum_share!, 1)}%</b><br>נתח מהצבירה: <b>${nf(r.flow_share!, 1)}%</b>`; } },
        xAxis: { type: 'value', name: 'נתח מנכסים, %', nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: b.mu, fontSize: 11 }, min: 0, max: Math.ceil(hi / 5) * 5, axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
        yAxis: { type: 'value', name: 'נתח מהצבירה, %', nameTextStyle: { color: b.mu, fontSize: 11, align: 'left' }, min: Math.floor(lo / 10) * 10, max: Math.ceil(hi / 5) * 5, axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
        // a line with no stroke draws the points: the registered chart set (lib/echarts.ts) has no scatter type
        series: [{ type: 'line', lineStyle: { opacity: 0 }, showSymbol: true, symbol: 'circle', z: 5, data: rows.map((r) => ({ value: [r.aum_share, r.flow_share], itemStyle: { color: idColorOfGroup(d.groups[r.g].name), opacity: lead >= 0 && r.g !== lead ? 0.35 : 0.9, borderColor: r.g === lead ? b.fg : 'transparent', borderWidth: 2 } })),
          symbolSize: (_v: unknown, p: { dataIndex: number }) => 10 + 22 * Math.sqrt((rows[p.dataIndex].reg.aE ?? 0) / amax),
          label: { show: true, position: 'right', color: b.fg, fontSize: 11, formatter: (p: { dataIndex: number }) => short(d.groups[rows[p.dataIndex].g].name) },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: b.mu, type: 'dashed', width: 1 }, label: { show: false }, data: [[{ coord: [0, 0] }, { coord: [Math.ceil(hi / 5) * 5, Math.ceil(hi / 5) * 5] }]] } }],
      };
    }} />
  );
}

/* ---------- one manager: every quarter, both sources ---------- */
function Drill({ d, src, g, seg, onClose }: { d: LensData; src: LensSrc; g: number; seg: Seg; onClose: () => void }) {
  const phone = usePhone();
  const name = d.groups[g].name, id = d.groups[g].id;
  useEffect(() => { warmRep(d.groups[g].lts); }, [d, g]);
  const body = <DrillBody d={d} src={src} g={g} seg={seg} />;
  const links = <>{id && <Link className="chip" to={`/company/${id === 'idi' ? 'idi' : id}/savings`}>עמוד החברה</Link>}<Link className="chip" to={`/managers?v=makers&mk=${encodeURIComponent(name)}`}>המסלולים מול השוק</Link></>;
  if (phone) return <Sheet open onClose={onClose} title={`${name} · ${SEG_LONG[seg]}`}><div className="lens-links">{links}</div>{body}</Sheet>;
  return (
    <div ref={(el) => { if (el && el.dataset.g !== String(g)) { el.dataset.g = String(g); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }}><Panel className="lens-drill" title={<><IdDot grp={name} />{name} · {SEG_LONG[seg]}</>} aside={<>{links}<button type="button" className="btn" onClick={onClose} aria-label="סגירה">×</button></>}>{body}</Panel></div>
  );
}

function DrillBody({ d, src, g, seg }: { d: LensData; src: LensSrc; g: number; seg: Seg }) {
  const { open } = useSource();
  // inside a phone sheet the chart waits for the sheet's opening motion, so it measures its final size
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 320); return () => clearTimeout(t); }, []);
  const rows = d.rows.filter((r) => r.g === g && r.s === seg);
  const ins = seg === 'ins';
  if (!rows.length) return <Empty title="אין נתונים לקבוצה בפעילות זו" />;
  const by = new Map(rows.map((r) => [r.q, r]));
  const qs = d.quarters.filter((q) => by.has(q));
  const series: { name: string; v: (r: LensRow) => number | null | undefined; p: (r: LensRow) => Prov; dashed?: boolean; color: string }[] = [
    ...(!ins ? [{ name: 'על נכסי הרשות', v: (r: LensRow) => r.fy_reg, p: (r: LensRow) => src.fyReg(r), color: idColorOfGroup(d.groups[g].name) }] : []),
    { name: 'על נכסי הדוח', v: (r) => r.fy_rep, p: (r) => src.fyRep(r), dashed: !ins, color: ins ? idColorOfGroup(d.groups[g].name) : chartBase().mu },
    { name: 'דמי ניהול מוצהרים מצבירה (רשות)', v: (r) => r.reg.posted, p: (r) => src.reg('fee', r.reg.e, 'm', seg, g, pc(r.reg.posted), undefined), dashed: true, color: cssColor('--neutral') },
  ];
  const hasRep = rows.some((r) => r.rep);
  const M = (r: LensRow | undefined, k: 'fees' | 'sm' | 'ga' | 'op') => (r?.rep?.[k] == null ? <span className="muted">–</span> : <S className={k === 'op' && r.rep[k]! < 0 ? 'neg' : ''} src={() => src.rep(r, k, 'q')}>{nf(r.rep[k]!, 1)}</S>);
  return (
    <>
      {hasRep && seg !== 'hish' && (!ready ? <div style={{ height: 260 }} /> : <Chart label={`תשואת דמי ניהול · ${d.groups[g].name} · ${SEG_LONG[seg]}`} height={260} deps={[g, seg]} onPoint={(si, di) => { const r = by.get(qs[di]); if (r && series[si].v(r) != null) open(series[si].p(r)); }}
        build={() => decimals(foxOption({ x: qs.map(ql), unit: '%', scale: true, legend: true, series: series.map((s) => ({ name: s.name, kind: 'line' as const, pct: true, dec: 3, dashed: s.dashed, color: s.color, data: qs.map((q) => { const v = s.v(by.get(q)!); return v == null ? null : +v.toFixed(4); }) })) }), 2, true)} />)}
      <div className="scroll"><table className="lens-tbl drill">
        <thead><tr><th>רבעון</th><th className={hasRep ? 'wide-only' : ''}>נכסים ממוצעים, רשות</th>{hasRep && <><th>הכנסות</th><th className="wide-only">שיווק</th><th className="wide-only">הנהלה</th><th>רווח תפעולי</th><th>תשואת דמי ניהול</th><th className="wide-only">הוצאות להכנסות</th><th className="wide-only">רווח למיליארד</th><th className="wide-only" title="נכסים בדוח החברה ÷ נכסיה אצל הרשות: 100% = אותו בסיס">דוח ÷ רשות</th></>}{!ins && <><th className="wide-only">ניוד נטו</th><th className={hasRep ? 'wide-only' : ''}>צבירה אורגנית</th></>}</tr></thead>
        <tbody>{[...qs].reverse().map((q) => { const r = by.get(q)!; const fy = ins ? r.fy_rep : r.fy_reg; return (
          <tr key={q} onPointerEnter={() => warmRep(r.rep?.c)}>
            <td><span className="num">{ql(q)}</span></td>
            <td className={hasRep ? 'wide-only' : ''}>{r.reg.avg == null ? '–' : <S src={() => src.avgP(r)}>{bn(r.reg.avg, 1)}</S>}</td>
            {hasRep && <>
              <td>{M(r, 'fees')}</td><td className="wide-only">{M(r, 'sm')}</td><td className="wide-only">{M(r, 'ga')}</td><td>{M(r, 'op')}</td>
              <td>{fy == null ? <span className="muted">–</span> : <S src={() => (ins ? src.fyRep(r) : src.fyReg(r))}>{pc(fy, 3)}</S>}</td>
              <td className="wide-only">{r.ci == null ? <span className="muted">–</span> : <S src={() => src.ci(r)}>{pc(r.ci, 1)}</S>}</td>
              <td className="wide-only">{r.ppb == null ? <span className="muted">–</span> : <S className={r.ppb < 0 ? 'neg' : ''} src={() => src.ppb(r)}>{nf(r.ppb, 2)}</S>}</td>
              <td className="wide-only">{r.cover == null ? '' : <Sourced src={() => src.cover(r)}><span className="num">{nf(r.cover, 1)}%</span></Sourced>}</td>
            </>}
            {!ins && <>
              <td className="wide-only">{r.reg.tr == null ? '–' : <S className={tone(r.reg.tr)} src={() => src.reg('transfers', r.reg.e, 'q', seg, g, bn(r.reg.tr, 2), 'מיליארד ש"ח')}>{sn(r.reg.tr / 1000, 2)}</S>}</td>
              <td className={hasRep ? 'wide-only' : ''}>{r.reg.org == null ? '–' : <S className={tone(r.reg.org)} src={() => src.reg('organic', r.reg.e, 'q', seg, g, bn(r.reg.org, 2), 'מיליארד ש"ח')}>{sn(r.reg.org / 1000, 2)}</S>}</td>
            </>}
          </tr>); })}</tbody>
      </table></div>
      <div className="fnote">הכנסות, שיווק, הנהלה ורווח תפעולי: מיליוני ש"ח, רבעון, מהדוח. נכסים ותזרימים: מיליארדי ש"ח, רשות. {rows.find((r) => r.mark)?.mark ?? ''}</div>
    </>
  );
}

/* ---------- the nowcast: the quarter not yet reported ---------- */
function NowView({ d, src, seg, set }: { d: LensData; src: LensSrc; seg: Seg; set: (p: Record<string, string>) => void }) {
  const nc = d.nowcast;
  const s = seg === 'ins' ? 'pen' : seg;
  const rows = nc.rows.filter((r) => r.s === s && d.groups[r.g].name !== OTHERS).sort((a, b) => (b.fees ?? -1) - (a.fees ?? -1) || b.avg - a.avg);
  const base = (n: LensNow) => d.rows.find((r) => r.g === n.g && r.s === s && r.q === nc.base);
  const delta = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0 ? null : (a / b - 1) * 100);
  const withFees = rows.filter((r) => r.fees != null);
  const tot = (f: (r: LensNow) => number | null | undefined) => withFees.reduce((t, r) => t + (f(r) ?? 0), 0);
  const dP = (title: string, a: string, b: string, v: number | null, pa: () => Prov, pb: (() => Prov) | undefined): Prov => ({ k: 'calc', est: true, title, value: spc(v, 1), formula: 'אומדן ÷ בפועל ברבעון הבסיס, פחות 1', inputs: [{ label: `אומדן ${ql(nc.q)}`, v: a, src: pa }, { label: `${ql(nc.base)}, בפועל`, v: b, src: pb }] });
  const qtd = (metric: 'transfers' | 'organic', n: LensNow, label: string): Prov => ({ k: 'calc', title: `${label} QTD · ${src.name(n.g)} · ${SEG_LONG[s]} · ${ql(nc.q)}`, value: bn(metric === 'transfers' ? n.tr : n.org, 2), unit: 'מיליארד ש"ח',
    formula: `סכום ${nc.months.length} החודשים שפורסמו`, inputs: nc.months.map((p) => ({ label: `${label} · ${ym(p)}`, v: '', src: () => src.reg(metric, p, 'm', s, n.g, '', 'מיליארד ש"ח') })) });
  if (!nc.months.length) return <Empty title={`אין עדיין חודשים שפורסמו ל-${ql(nc.q)}`} />;
  return (
    <>
      <section className="controls lens-ctl"><SegPick seg={s} set={set} omit={['ins']} /></section>
      <div className="lens-note est"><span className="chip est">אומדן</span> {ql(nc.q)} עד <span className="num">{ym(nc.months[nc.months.length - 1])}</span> · <span className="num">{nc.months.length}/3</span> חודשים · הכנסות = תשואת דמי הניהול של {ql(nc.base)} × נכסים ממוצעים QTD מהרשות × 3 ÷ 12 · רווח = אומדן ההכנסות פחות הוצאות {ql(nc.base)} · ניוד וצבירה: בפועל, QTD.</div>
      <Panel title={`${SEG_LONG[s]} · ${ql(nc.q)} אומדן מול ${ql(nc.base)}`} aside={<span>הכנסות ורווח: מיליוני ש"ח · נכסים ותזרימים: מיליארדי ש"ח</span>}>
        <div className="scroll"><table className="lens-tbl">
          <thead><tr><th>מנהל</th><th className={s !== 'hish' ? 'wide-only' : ''}>נכסים ממוצעים QTD</th><th className="wide-only">מול {ql(nc.base)}</th><th className="wide-only">ניוד נטו QTD</th><th className="wide-only">צבירה QTD</th>
            {s !== 'hish' && <><th className="wide-only">הכנסות {ql(nc.base)}</th><th>הכנסות {ql(nc.q)} <span className="chip est">אומדן</span></th><th>שינוי</th><th className="wide-only">רווח {ql(nc.base)}</th><th className="wide-only">רווח {ql(nc.q)} <span className="chip est">אומדן</span></th></>}</tr></thead>
          <tbody>{rows.map((n) => { const b = base(n), name = src.name(n.g), da = delta(n.avg, n.baseAvg), df = delta(n.fees, n.baseFees); return (
            <tr key={n.g} onPointerEnter={() => warmRep(d.groups[n.g].lts)}>
              <td><button type="button" className="lens-mgr" onClick={() => set({ g: name, v: '' })}><IdDot grp={name} />{short(name)}</button></td>
              <td className={s !== 'hish' ? 'wide-only' : ''}><Sourced src={() => src.now(n, b, 'avg')}><span className="num">{bn(n.avg, 1)}</span></Sourced></td>
              <td className="wide-only">{da == null ? '–' : <Sourced src={() => ({ k: 'calc', title: `נכסים ממוצעים · ${name} · ${ql(nc.q)} QTD מול ${ql(nc.base)}`, value: spc(da, 1), formula: 'נכסים ממוצעים QTD ÷ נכסים ממוצעים ברבעון הבסיס, פחות 1', inputs: [{ label: 'QTD', v: bn(n.avg, 2), src: () => src.now(n, b, 'avg') }, { label: ql(nc.base), v: bn(n.baseAvg, 2), src: b ? () => src.avgP(b) : undefined }] })}><span className={`num ${tone(da)}`}>{spc(da, 1)}</span></Sourced>}</td>
              <td className="wide-only">{n.tr == null ? '–' : <S className={tone(n.tr)} src={() => qtd('transfers', n, 'העברות נטו')}>{sn(n.tr / 1000, 2)}</S>}</td>
              <td className="wide-only">{n.org == null ? '–' : <S className={tone(n.org)} src={() => qtd('organic', n, 'צבירה אורגנית')}>{sn(n.org / 1000, 2)}</S>}</td>
              {s !== 'hish' && <>
                <td className="wide-only">{n.baseFees == null || !b ? <Dash why={NO_REP[s]} /> : <S src={() => src.rep(b, 'fees', 'q')}>{nf(n.baseFees, 1)}</S>}</td>
                <td>{n.fees == null ? <Dash why={d.groups[n.g].lts ? 'אין תשואת דמי ניהול לרבעון הבסיס' : 'לחברה אין דוח רווח והפסד מגזרי באתר'} /> : <Sourced src={() => src.now(n, b, 'fees')}><span className="num est-num">{nf(n.fees, 1)}</span></Sourced>}</td>
                <td>{df == null ? '–' : <Sourced src={() => dP(`הכנסות · ${name} · ${ql(nc.q)} מול ${ql(nc.base)}`, nf(n.fees!, 1), nf(n.baseFees!, 1), df, () => src.now(n, b, 'fees'), b ? () => src.rep(b, 'fees', 'q') : undefined)}><span className={`num ${tone(df)}`}>{spc(df, 1)}</span></Sourced>}</td>
                <td className="wide-only">{n.baseOp == null || !b ? '–' : <S className={n.baseOp < 0 ? 'neg' : ''} src={() => src.rep(b, 'op', 'q')}>{nf(n.baseOp, 1)}</S>}</td>
                <td className="wide-only">{n.op == null ? '–' : <Sourced src={() => src.now(n, b, 'op')}><span className={`num est-num ${n.op < 0 ? 'neg' : ''}`}>{nf(n.op, 1)}</span></Sourced>}</td>
              </>}
            </tr>); })}
            {s !== 'hish' && withFees.length > 1 && <tr className="tot"><td>סך המנהלים באומדן</td><td className="wide-only"><span className="num">{bn(tot((r) => r.avg), 1)}</span></td><td className="wide-only" /><td className="wide-only" /><td className="wide-only" />
              <td className="wide-only"><span className="num">{nf(tot((r) => r.baseFees), 0)}</span></td><td><span className="num est-num">{nf(tot((r) => r.fees), 0)}</span></td><td><span className={`num ${tone(delta(tot((r) => r.fees), tot((r) => r.baseFees)))}`}>{spc(delta(tot((r) => r.fees), tot((r) => r.baseFees)), 1)}</span></td>
              <td className="wide-only"><span className="num">{nf(tot((r) => r.baseOp), 0)}</span></td><td className="wide-only"><span className="num est-num">{nf(tot((r) => r.op), 0)}</span></td></tr>}
          </tbody>
        </table></div>
        <div className="fnote">האומדן אינו כולל שינוי בשיעור דמי הניהול האפקטיבי, הכנסות שאינן מדמי ניהול, או שינוי בהוצאות. הדוח של {ql(nc.q)} יחליף אותו.</div>
      </Panel>
    </>
  );
}

/** The ranking over time, for the managers page (its one home): activity and measure in the address; a manager opens in the lens. */
export function LensRank() {
  const { data: d, error } = useLens();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  if (error) return <ErrorBox what="דירוג המנהלים" error={error} />;
  if (!d) return <Loading what="דירוג המנהלים" />;
  const seg = (SEGS.map(([k]) => k).find((k) => k === sp.get('s')) ?? 'pen') as Seg;
  const set = (patch: Record<string, string>) => {
    if (patch.g) { nav(`/industry/savings?g=${encodeURIComponent(patch.g)}${seg !== 'pen' ? `&s=${seg}` : ''}`); return; }
    const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); setSp(n, { replace: true });
  };
  return <RankView d={d} seg={seg} set={set} by={(sp.get('by') as RankBy) ?? 'aum'} />;
}

/* ---------- rank history ---------- */
function RankView({ d, seg, set, by }: { d: LensData; seg: Seg; set: (p: Record<string, string>) => void; by: RankBy }) {
  const phone = usePhone();
  const B: [RankBy, string][] = [['aum', 'נכסים'], ['flow', 'צבירה נטו, 3 חודשים'], ['fee', 'דמי ניהול מוצהרים'], ...(seg !== 'hish' && seg !== 'ins' ? [['fy', 'תשואת דמי ניהול, רבעוני'] as [RankBy, string]] : [])];
  const bb = B.some(([k]) => k === by) ? by : 'aum';
  const noFlow = seg === 'ins' && bb === 'flow';
  const h = useMemo(() => rankHistory(d, seg, bb), [d, seg, bb]);
  const last = h.x.length - 1;
  const lastIdx = (arr: (number | null)[]) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i; return -1; };
  const top = [...h.ranks.entries()].filter(([, r]) => r[last] != null).sort((a, b) => a[1][last]! - b[1][last]!).slice(0, phone ? 8 : 12);
  const back = bb === 'fy' ? 4 : 12;
  const breaks = seg === 'ins' && bb === 'fee' ? d.breaks.filter((b) => b.family === 'insurance' && b.metric === 'fee' && Number(b.from) >= d.months[0]) : [];
  const fmt = (v: number | null) => (v == null ? '–' : bb === 'aum' ? bn(v, 1) : bb === 'flow' ? sn(v / 1000, 2) : pc(v, bb === 'fy' ? 3 : 2));
  return (
    <>
      <section className="controls lens-ctl">
        <SegPick seg={seg} set={set} />
        <div className="field"><span>דירוג לפי</span><SegCtl<RankBy> label="דירוג לפי" value={bb} onChange={(v) => set({ by: v === 'aum' ? '' : v })} options={B} /></div>
      </section>
      {noFlow ? <Empty title="ביטוח-נט אינו מפרסם תזרימים" /> : (
        <>
          <Panel title={`דירוג לאורך זמן · ${SEG_LONG[seg]} · ${B.find(([k]) => k === bb)![1]}`} aside={<><span>1 = הגבוה ביותר · {bb === 'fy' ? 'רבעוני, מהדוחות ומהרשות' : 'חודשי, רשות'}</span>{breaks.map((b) => <BreakChip key={b.from} b={{ label: ym(Number(b.from)), note: b.note }} />)}</>}>
            <Chart label={`דירוג · ${SEG_LONG[seg]}`} height={phone ? 340 : 420} deps={[seg, bb, top.map(([g]) => g).join()]} build={() => {
              const b = chartBase(), N = Math.max(...h.n, 1);
              return {
                animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg },
                grid: { left: 8, right: phone ? 54 : 82, top: 14, bottom: 8, containLabel: true },
                tooltip: { trigger: 'axis', confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 },
                  formatter: (ps: { axisValueLabel: string; marker: string; seriesName: string; value: number | null; dataIndex: number; seriesIndex: number }[]) => `<b>${ps[0]?.axisValueLabel ?? ''}</b><br>${[...ps].filter((p) => p.value != null).sort((x, y) => x.value! - y.value!).map((p) => `${p.marker} ${p.value}. ${p.seriesName} <span style="opacity:.7">${fmt(h.vals.get(top[p.seriesIndex][0])![p.dataIndex])}</span>`).join('<br>')}` },
                xAxis: { type: 'category', data: h.x, boundaryGap: false, axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false }, axisLabel: { color: b.mu, fontSize: 11, hideOverlap: true } },
                yAxis: { type: 'value', inverse: true, min: 1, max: Math.min(N, 16), interval: 1, axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { lineStyle: { color: b.ln, type: 'dashed', opacity: 0.5 } } },
                series: top.map(([g, r]) => ({ name: short(d.groups[g].name), type: 'line', data: r, connectNulls: false, symbol: bb === 'fy' ? 'circle' : 'none', symbolSize: 6, color: idColor(GROUP_ID[d.groups[g].name] ?? ''),
                  lineStyle: { width: 2.2 }, endLabel: { show: true, color: idColor(GROUP_ID[d.groups[g].name] ?? ''), fontSize: 11, formatter: '{a}' }, emphasis: { focus: 'series' } })),
              };
            }} />
          </Panel>
          <Panel title="מקום ושינוי" aside={<span>מול {bb === 'fy' ? '4 רבעונים' : '12 חודשים'} קודם</span>}>
            <div className="scroll"><table className="lens-tbl">
              <thead><tr><th>מנהל</th><th>{h.x[last]}</th><th className="wide-only">{h.x[Math.max(0, last - back)]}</th><th>שינוי</th><th>ערך</th></tr></thead>
              <tbody>{[...h.ranks.entries()].filter(([, r]) => r[last] != null).sort((a, b) => a[1][last]! - b[1][last]!).map(([g, r]) => {
                const was = r[Math.max(0, last - back)], ch = was == null ? null : was - r[last]!;
                return <tr key={g}><td><button type="button" className="lens-mgr" onClick={() => set({ g: d.groups[g].name, v: '' })}><IdDot grp={d.groups[g].name} />{d.groups[g].name}</button></td>
                  <td><span className="num">{r[last]}</span></td><td className="wide-only"><span className="num muted">{was ?? '–'}</span></td><td><span className={`num ${tone(ch)}`}>{ch == null ? '–' : ch === 0 ? '0' : sn(ch, 0)}</span></td><td><span className="num">{fmt(h.vals.get(g)![lastIdx(h.vals.get(g)!)])}</span></td></tr>;
              })}</tbody>
            </table></div>
            <div className="fnote">{bb === 'fy' ? 'תשואת דמי ניהול: הכנסות מהדוח ÷ נכסים ממוצעים מהרשות. ' : bb === 'flow' ? 'צבירה נטו: הפקדות פחות משיכות ועוד העברות נטו, שלושת החודשים האחרונים, מיליארדי ש"ח. ' : bb === 'fee' ? 'דמי ניהול מצבירה, ממוצע משוקלל נכסים של מסלולי הקבוצה. ' : 'נכסים: מיליארדי ש"ח. '}קרנות ענפיות ואחרות אינן מדורגות.</div>
          </Panel>
        </>
      )}
    </>
  );
}
