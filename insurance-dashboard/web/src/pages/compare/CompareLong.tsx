import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chart } from '../../components/Chart';
import { GuardLine } from '../../components/GuardLine';
import { NumText } from '../../components/NumText';
import { Scoreboard, type ScoreRowData } from '../../components/Scoreboard';
import { signed } from '../../components/MonthGrid';
import { foxOption } from '../../lib/foxchart';
import { nf } from '../../lib/format';
import { catKey, grossProv, netMonthIn, netProv, netSeries, pc, refOf, ym, GROSS_LABEL, NET_LABEL, NET_NOTE, PER_LABEL, type CatX, type FundX, type FundsFile, type HistX } from '../../lib/funds';
import { monthIn, seedHist, listP } from '../../lib/market';
import { useSource, type Prov } from '../../lib/prov';
import { load, useFundCats, useFunds } from '../../lib/useData';
import { tieBand } from '../../lib/fundsTie';
import { isOldGen } from '../../lib/decision';
import { OLD_POLICY_LINE, PRODUCTS_LINE, longWords, monthShortYear, riskLongWords } from '../../lib/compareWords';
import {
  PER_UNIT, boardRows, catCount, chartSeries, perFrom, periodFigures, persOf, readoutTitle, riskOf, windowAxis, type LongMode, type LongPer,
} from '../../lib/compareLong';
import type { CmpCtx } from './contract';
import { trackLabels, trackRgb } from './tracks';
import { ShareRow, Stamp } from './CompareMonths';
import '../../styles/compare.css';
import '../../styles/compare-long.css';

/* "לאורך זמן" (C8, spec 4.7, mockup v3 frame 7): one period for the whole lens ("שנה אחרונה | 3 שנים | 5 שנים"; agent and Pro: YTD, LTM, 3Y, 5Y),
   the takeaway sentence, the ranked rows with the category-average tick, and one chart for the same period with a finger scrub that drives a
   readout line and a switch "כמה שווים 100 ש״ח | כמה ירד מהשיא". The period sits in the URL as `per` (replace), so a shared link reopens it.
   Across risk levels: the rows keep the chosen order, carry no place, and show each track's worst month and deepest fall instead of a bar. */

type Hist = Record<string, HistX>;

/** `aside`: beside the month table on a wide screen (D5): the page's end (share, stamp) is the month lens's, not repeated here */
export function CompareLong(ctx: CmpCtx & { aside?: boolean }) {
  const { keys, basis, door, openSheet } = ctx;
  const { data: raw } = useFunds();
  const data = raw as FundsFile | undefined;
  const cats = useFundCats().data as Record<string, CatX> | undefined;
  const { open } = useSource();
  const [sp, setSp] = useSearchParams();
  const saver = door === 'saver';
  const per: LongPer = perFrom(sp.get('per'), saver);
  const setPer = (p: LongPer) => { const n = new URLSearchParams(sp); n.set('per', p); setSp(n, { replace: true }); };
  const [mode, setMode] = useState<LongMode>('g');
  const [touch, setTouch] = useState<number | null>(null);   // axis index under the finger; null = the end of the period

  // the tracks: funds.json, else the closed ones (funds/closed.json)
  const [gone, setGone] = useState<FundX[]>([]);
  const missing = data ? keys.filter((k) => !data.funds.some((f) => f.k === k)) : [];
  useEffect(() => { if (missing.length && !gone.length) load<{ funds: FundX[] }>('funds/closed.json').then((d) => setGone((d.funds ?? []).map((f) => ({ ...f, gone: true }))), () => {}); }, [missing.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [hist, setHist] = useState<Hist>({});
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => { keys.filter((k) => !hist[k] && !failed.includes(k)).forEach((k) => load<HistX>(`funds/${k}.json`).then((h) => setHist((c) => ({ ...c, [k]: h })), () => setFailed((c) => [...c, k]))); }, [keys, hist, failed]);

  const have = useMemo(() => keys.map((k) => data?.funds.find((f) => f.k === k) ?? gone.find((f) => f.k === k)).filter((f): f is FundX => !!f), [keys, data, gone]);
  // labels and colours from the page's one source (./tracks): by column position in `keys`, so a track keeps the name and colour of its
  // column chip even when another key is missing
  const labels = useMemo(() => { const all = trackLabels(keys.map((k) => have.find((f) => f.k === k) ?? null)); return have.map((f) => all[keys.indexOf(f.k)]); }, [keys, have]);
  const asof = data?.asof ?? 0;

  if (!data || !asof) return <div className="cl" id="lens-long"><div className="cl-empty" role="status">טוען…</div></div>;
  if (!have.length) return <div className="cl" id="lens-long"><div className="cl-empty">בחרו מסלולים כדי לראות אותם לאורך זמן.</div></div>;

  const net = basis === 'net';
  const cross = new Set(have.map(catKey)).size > 1;
  const mixed = new Set(have.map((f) => f.prod)).size > 1;
  const old = have.some((f) => isOldGen(f));
  const colorOf = (i: number) => trackRgb(Math.max(0, keys.indexOf(have[i]?.k)));
  const cat = !cross ? cats?.[catKey(have[0])] ?? null : null;

  const { vals, avg } = periodFigures(have, basis, per, asof, cat);
  const band = tieBand(per, asof);
  const sentence = cross ? riskLongWords(have.map((f) => f.st)) : longWords(per, have.map((_f, i) => ({ label: labels[i], v: vals[i] })), { asof, band });
  const sorted = boardRows(have.map((f, i) => ({ k: f.k, label: labels[i], value: vals[i] })), per, asof, cross);
  const idx = (k: string) => have.findIndex((f) => f.k === k);
  const feeSub = (f: FundX) => {
    const fee = f.fee == null ? '–' : `${nf(f.fee, 2)}%`;
    if (saver) return `דמי ניהול ${fee} מהחיסכון`;
    const dep = f.depfee == null ? '–' : `${nf(f.depfee, 2)}%`;
    return door === 'agent' ? `ד״נ ${fee} · מהפקדה ${dep}` : `ד״נ ${fee} · שארפ ${f.sharpe == null || !(f.sd != null && f.sd > 0) ? '–' : nf(f.sharpe, 2)} ${cross || f.st == null ? '' : ` · ${Math.round(f.st)}% מניות`}`;
  };
  const rows: ScoreRowData[] = sorted.map((r) => {
    const i = idx(r.k), f = have[i], h = hist[r.k], rk = cross && h ? riskOf(h, basis, asof) : null;
    return {
      k: r.k, label: r.label, color: colorOf(i), value: r.value, unit: PER_UNIT[per], place: r.place, tie: r.tie, sub: feeSub(f),
      tag: cross && f.st != null ? `${Math.round(f.st)}% מניות` : undefined,
      extra: cross ? (
        <>
          <span className="kv">החודש הכי גרוע <b>{rk ? signed(rk.worst, 2, true) : '–'}</b>{rk ? ` · ${monthShortYear(rk.worstP)}` : ''}</span>
          <span className="kv">הירידה הכי גדולה לפני שחזר לעלות <b>{rk ? signed(rk.dd, 1, true) : '–'}</b></span>
        </>
      ) : undefined,
    };
  });
  const n = catCount(cat, basis, asof);
  const benchmark = !cross && avg != null ? { label: n ? `ממוצע כל ${n} המסלולים מהסוג הזה` : 'ממוצע המסלולים מהסוג הזה', value: avg } : null;

  /* ---- sources: the board's figures open the published figure (or the net build) one by one ---- */
  const lbl = net ? NET_LABEL : GROSS_LABEL;
  const perName = persOf(false).find(([p]) => p === per)?.[1] ?? PER_LABEL[per];
  const figProv = (f: FundX, v: number | null): Prov => (net ? netProv(f, per, asof, v, data.net_method) : grossProv(f, per, asof));
  const boardSrc = (): Prov => listP(`${PER_LABEL[per]}, ${lbl}`, perName, undefined,
    `${net ? 'תשואה נטו (אומדן האתר) של כל מסלול' : 'התשואה ברוטו כפי שהרשות לשוק ההון מפרסמת'}, לתקופה שמסתיימת ב-${ym(asof)}. הממוצע: תשואות הקטגוריה החודשיות (funds/cat.json) בריבית דריבית`,
    have.map((f, i) => ({ label: labels[i], v: pc(vals[i], 1), src: () => figProv(f, vals[i]) })), net ? NET_NOTE : undefined);

  /* ---- chart ---- */
  const axis = windowAxis(per, asof);
  const ready = have.every((f) => hist[f.k]);
  const series = ready ? have.map((f) => chartSeries(axis, hist[f.k], basis, mode)) : [];
  const last = axis.length - 1, at = touch == null ? last : Math.max(0, Math.min(last, touch));
  const fmtRo = (v: number | null) => (v == null ? '–' : mode === 'g' ? nf(v, 1) : signed(v, 1, true));
  const monthRow = (f: FundX, p: number) => { const h = hist[f.k]; seedHist(refOf(f), h); return net ? netMonthIn(refOf(f), h, p, netSeries(h)) : monthIn(refOf(f), 'y', p, h.y[h.p.indexOf(p)]); };
  const pointSrc = (si: number, di: number): Prov | null => {
    const f = have[si], v = series[si]?.[di];
    if (!f || di < 1 || v == null) return null;
    return mode === 'g'
      ? { k: 'calc', est: net, title: `צמיחה של 100 ש"ח · ${f.name} · ${ym(axis[di])}`, value: nf(v, 1), formula: `100 × (1 + r₁) × … × (1 + rₙ) על התשואות החודשיות (${lbl}) מ-${ym(axis[1])} עד ${ym(axis[di])}. בסיס: סוף ${ym(axis[0])}`, note: net ? NET_NOTE : undefined, inputs: axis.slice(1, di + 1).map((p) => monthRow(f, p)) }
      : { k: 'calc', est: net, title: `מתחת לשיא · ${f.name} · ${ym(axis[di])}`, value: pc(v, 1), formula: `מדד התשואה המצטברת (${lbl}) חלקי השיא שלפניו בחלון, פחות 1`, inputs: axis.slice(1, di + 1).map((p) => monthRow(f, p)) };
  };
  const build = () => {
    const o = foxOption({ x: axis.map(ym), unit: mode === 'g' ? 'ש"ח' : '%', dense: true, full: true, scale: mode === 'g', legend: false,
      series: have.map((_f, i) => ({ name: labels[i], data: series[i], kind: 'line' as const, color: colorOf(i), dec: 1, pct: mode === 'd', area: mode === 'd' && have.length === 1 })) });
    // the readout above the chart is the legend (the chips' names and colours): no chart legend, no axis title (review B1 P6)
    for (const a of ((o as { yAxis?: { name?: string }[] }).yAxis ?? [])) a.name = '';
    // the finger drives the readout above the chart, not a floating box: the axis tooltip reports its position and draws nothing
    const t = (o as { tooltip: Record<string, unknown> }).tooltip;
    (o as { tooltip: Record<string, unknown> }).tooltip = { ...t, backgroundColor: 'transparent', borderWidth: 0, padding: 0, extraCssText: 'visibility:hidden;pointer-events:none;box-shadow:none', formatter: (ps: { dataIndex?: number }[]) => { const j = ps?.[0]?.dataIndex; if (j != null) setTouch(j); return ''; } };
    return o;
  };

  return (
    <div className="cl" id="lens-long">
      <div className="cl-per" role="group" aria-label="תקופה" id="long-per">
        {persOf(saver).map(([p, l]) => <button key={p} type="button" aria-pressed={p === per} data-per={p} onClick={() => setPer(p)}>{l}</button>)}
      </div>

      {mixed ? <GuardLine kind="product" text={PRODUCTS_LINE} id="products-line" /> : null}
      {old ? <GuardLine kind="oldgen" text={OLD_POLICY_LINE} id="oldgen-line" /> : null}

      {sentence ? <div className="cl-take" id="takeaway"><NumText t={sentence} /></div> : null}

      <Scoreboard id="board" rows={rows} decimals={1} benchmark={benchmark} onOpen={(k) => openSheet({ t: 'track', k })} />


      <div className="cl-card" id="chart-card">
        <div className="cl-ro" id="readout" aria-live="polite">
          <div className="t" id="ro-t">{ready ? readoutTitle(mode, axis, at, ym) : 'טוען את הגרף…'}</div>
          {ready ? (
            <div className="vals">
              {have.map((f, i) => { const v = series[i][at]; return (
                <span key={f.k} className="v" style={{ '--c': colorOf(i) } as CSSProperties}><span><i aria-hidden="true" />{labels[i]}</span><b id={`ro-${i}`} className={mode === 'd' && v != null && v < 0 ? 'neg' : undefined}>{fmtRo(v)}</b></span>
              ); })}
            </div>
          ) : null}
        </div>
        <div className="cl-plot" onPointerUp={() => setTouch(null)} onPointerLeave={() => setTouch(null)} onPointerCancel={() => setTouch(null)} onTouchEnd={() => setTouch(null)}>
          {ready ? (
            <Chart label={mode === 'g' ? 'צמיחה של 100 ש"ח' : 'מרחק מהשיא'} height={230} tools={false} bookable={false} asof={ym(asof)} deps={[keys.join(), per, mode, basis, ready]}
              onPoint={(si, di) => { const p = pointSrc(si, di); if (p) open(p); }} build={build} />
          ) : <div style={{ height: 230 }} />}
        </div>
        <div className="cl-mode" role="group" aria-label="סוג הגרף">
          <button type="button" aria-pressed={mode === 'g'} data-mode="g" onClick={() => { setMode('g'); setTouch(null); }}>כמה שווים 100 ש״ח</button>
          <button type="button" aria-pressed={mode === 'd'} data-mode="d" onClick={() => { setMode('d'); setTouch(null); }}>כמה ירד מהשיא</button>
        </div>
        <div className="cl-note">גררו אצבע על הגרף כדי לראות כל חודש. בלי הפקדות נוספות.</div>
      </div>

      {ctx.aside ? null : <>
        <ShareRow ctx={ctx} />
        <Stamp asof={asof} basis={basis} onWhy={() => openSheet({ t: 'why' })} onSrc={saver ? undefined : () => open(boardSrc())} />
      </>}
    </div>
  );
}
