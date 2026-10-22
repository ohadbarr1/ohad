import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { Chart } from '../../components/Chart';
import { Sourced } from '../../components/Source';
import { useSource, type Prov } from '../../lib/prov';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/ui';
import { foxOption } from '../../lib/foxchart';
import { CHART_FONT, chartBase } from '../../lib/theme';
import { idColor } from '../../lib/identity';
import { usePhone } from '../../lib/useMedia';
import { nf, sn, dateLabel } from '../../lib/format';
import { INSURERS, monthHe, useCurve, useRates, type Curve, type Ledger, type RateRow } from '../../lib/csmData';
import { Dot } from './LedgerView';
import { useParam } from './params';

type Kind = 'nominal' | 'real';
const KIND_HE: Record<Kind, string> = { nominal: 'נומינלי', real: 'ריאלי (צמוד מדד)' };
const yrs = (t: number) => `${t} ${t === 1 ? 'שנה' : 'שנים'}`;
/** a short name for a portfolio, for legends */
const shortPort = (p: string) => (/שאינו תלוי תשואה ופוליסות קצבה/.test(p) ? 'לא תלוי תשואה וקצבה' : /שאינו תלוי תשואה/.test(p) ? 'לא תלוי תשואה' : /תלוי תשואה.*משתנים/.test(p) ? 'תלוי תשואה, דמי ניהול משתנים'
  : /תלוי תשואה.*קבועים/.test(p) ? 'תלוי תשואה, דמי ניהול קבועים' : /קצבה/.test(p) ? 'קצבה' : /סיעוד/.test(p) ? 'סיעוד ורכב חובה' : /שאר/.test(p) ? 'שאר התיקים' : p);

/** A curve chart on a real time axis (years to maturity), so 15 and 60 years sit where they belong. */
function curveOption(series: { name: string; color: string; data: [number, number][]; width?: number; dashed?: boolean; opacity?: number }[], unit = '%'): EChartsCoreOption {
  const b = chartBase();
  return {
    animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 8, right: 16, top: 58, bottom: 6, containLabel: true },
    legend: { top: 0, type: 'scroll', textStyle: { color: b.mu, fontSize: 11.5 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' },
    tooltip: { trigger: 'item', formatter: (p: { seriesName: string; value: [number, number]; marker: string }) => `${p.marker} ${p.seriesName}<br>${yrs(p.value[0])}: <b>‎${nf(p.value[1], 2)}%</b>` },
    xAxis: { type: 'value', name: 'שנים', nameLocation: 'end', nameTextStyle: { color: b.mu, fontSize: 11 }, min: 0, axisLine: { lineStyle: { color: b.ln } }, axisLabel: { color: b.mu, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', scale: true, name: unit, nameTextStyle: { color: b.mu, fontSize: 11, align: 'left' }, axisLabel: { color: b.mu, fontSize: 11, formatter: (v: number) => `‎${nf(v, 1)}%` }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
    series: series.map((s) => ({ name: s.name, type: 'line', data: s.data, symbolSize: 5, itemStyle: { color: s.color, opacity: s.opacity ?? 1 }, lineStyle: { color: s.color, width: s.width ?? 2, type: s.dashed ? 'dashed' : 'solid', opacity: s.opacity ?? 1 }, emphasis: { focus: 'series' } })),
  };
}

/** The Bank of Israel zero-coupon curve at each quarter end, its history, and the discount rates the insurers print next to it. */
export function CurveView({ name }: { L: Ledger; name: (id: string) => string }) {
  const { open } = useSource();
  const phone = usePhone();
  const C = useCurve();
  const R = useRates();
  const [kind, setKind] = useParam<Kind>('k', 'nominal', ['nominal', 'real']);
  const [gap, setGap] = useState<'v' | 'g'>('v');
  const cv = C.data;
  const rates = R.data?.rows ?? [];
  const dates = useMemo(() => [...new Set(rates.map((r) => r.d))].sort().reverse(), [rates]);
  const [ye, setYe] = useParam('ye', dates[0] ?? '', dates);
  const qEnds = useMemo(() => (cv ? cv.months.filter((m) => /-(03|06|09|12)$/.test(m)).slice(-6) : []), [cv]);

  if (C.error) return <ErrorBox what="עקום בנק ישראל" error={C.error} />;
  if (!cv) return <Loading what="עקום הריבית" />;
  const ix = (m: string) => cv.months.indexOf(m);
  const val = (c: Curve, k: Kind, t: number, m: string) => c[k][String(t)]?.[ix(m)] ?? null;
  const ten = (k: Kind) => cv.tenors.filter((t) => cv[k][String(t)]);
  const boiProv = (k: Kind, t: number, m: string): Prov => {
    const v = val(cv, k, t, m)!;
    return { k: 'report', title: `עקום אפס ${KIND_HE[k]} · ${yrs(t)} · ${monthHe(m)}`, value: `${nf(v, 2)}%`, unit: '% לשנה', url: cv.url, pg: null, doc: 'בנק ישראל', period: monthHe(m), srcType: 'בנק ישראל · SDMX',
      note: `סדרה ${cv.codes[k]?.[String(t)] ?? ''} · ממוצע חודשי של אומדנים יומיים · אוחזר ${dateLabel(cv.retrieved)}` };
  };
  const latest = qEnds[qEnds.length - 1];
  const b = chartBase();

  // the disclosed rates of the year end in view, and the BoI real curve of the same month
  const Y = dates.includes(ye) ? ye : dates[0] ?? '';
  const ym = Y.slice(0, 7);
  const own = rates.filter((r) => r.d === Y);
  const ports = [...new Map(own.map((r) => [`${r.c}|${r.orig}`, r])).values()].sort((a, b2) => INSURERS.indexOf(a.c) - INSURERS.indexOf(b2.c));
  const tens = [...new Set(own.map((r) => r.t))].sort((a, b2) => a - b2);
  const rate = (p: RateRow, t: number) => own.find((r) => r.c === p.c && r.orig === p.orig && r.t === t) ?? null;
  const rateProv = (r: RateRow): Prov => ({ k: 'report', title: `ריבית היוון · ${name(r.c)} · ${shortPort(r.port ?? r.orig)} · ${yrs(r.t)}`, value: `${nf(r.v, 2)}%`, unit: '% לשנה', url: r.u, pg: r.pg, doc: 'דוח כספי', period: dateLabel(r.d),
    note: [r.real ? 'ספוט ריאלית' : '', r.ilp ? 'כולל פרמיית אי-נזילות' : '', r.port && r.port !== r.orig ? r.orig : ''].filter(Boolean).join(' · ') });
  const gapOf = (r: RateRow) => { const g = val(cv, 'real', r.t, ym); return g == null ? null : r.v - g; };
  const gapProv = (r: RateRow): Prov => { const g = gapOf(r)!; return { k: 'calc', title: `פער מול עקום בנק ישראל · ${name(r.c)} · ${shortPort(r.port ?? r.orig)} · ${yrs(r.t)}`, value: `${sn(g * 100, 0)} נ״ב`, formula: 'ריבית ההיוון שהחברה מדפיסה (ריאלית, כולל פרמיית אי-נזילות) פחות תשואת אפס ריאלית ממשלתית של בנק ישראל באותו חודש ובאותו טווח',
    note: 'קירוב: העקום של בנק ישראל הוא ממוצע חודשי, וריבית החברה היא לתאריך המאזן; הפער כולל פרמיית אי-נזילות והבדלי מתודולוגיה', inputs: [{ label: 'ריבית היוון מדווחת', v: `${nf(r.v, 2)}%`, src: () => rateProv(r) }, { label: `בנק ישראל, ריאלי, ${monthHe(ym)}`, v: `${nf(val(cv, 'real', r.t, ym)!, 2)}%`, src: () => boiProv('real', r.t, ym) }] }; };

  return (
    <>
      <div className="csm-grid">
        <Panel title={`עקום אפס ממשלתי, ${KIND_HE[kind]}`} aside={<Seg<Kind> label="עקום" value={kind} onChange={setKind} options={[['nominal', 'נומינלי'], ['real', 'ריאלי']]} />}>
          <Chart label={`עקום אפס ${KIND_HE[kind]} בסוף רבעון`} height={phone ? 260 : 300} deps={[kind, qEnds.join()]} source={`בנק ישראל, ZCM · אוחזר ${dateLabel(cv.retrieved)}`} build={() => curveOption(qEnds.map((m, i) => ({
            name: monthHe(m), color: m === latest ? b.accent : b.fg, width: m === latest ? 3 : 1.6, opacity: m === latest ? 1 : 0.25 + (0.5 * i) / Math.max(1, qEnds.length - 1),
            data: ten(kind).map((t) => [t, val(cv, kind, t, m)] as [number, number]).filter((p) => p[1] != null),
          })))} onPoint={(si, di) => { const m = qEnds[si], t = ten(kind).filter((x) => val(cv, kind, x, m) != null)[di]; if (m && t != null) open(boiProv(kind, t, m)); }} />
          <div className="src">ממוצע חודשי של חודש סוף הרבעון; האחרון מודגש. מקור: בנק ישראל, סדרות ZC_TSB · <a href={cv.url} target="_blank" rel="noreferrer">SDMX</a> · אוחזר <span className="num">{dateLabel(cv.retrieved)}</span>.</div>
        </Panel>
        <Panel title="10 שנים לאורך זמן" aside={<span>% לשנה · ממוצע חודשי</span>}>
          {(() => { const ms = cv.months.filter((m) => m >= '2018-01'); return (
            <Chart label="תשואת אפס ממשלתית ל-10 שנים" height={phone ? 260 : 300} deps={[ms.length]} source={`בנק ישראל, ZCM · אוחזר ${dateLabel(cv.retrieved)}`} build={() => foxOption({ x: ms.map(monthHe), unit: '%', dense: true, legend: true, labels: false, full: true,
              series: [{ name: 'נומינלי', kind: 'line', pct: true, color: b.accent, dec: 2, data: ms.map((m) => val(cv, 'nominal', 10, m)) }, { name: 'ריאלי', kind: 'line', pct: true, color: b.fg, dec: 2, data: ms.map((m) => val(cv, 'real', 10, m)) }] })}
              onPoint={(si, di) => { const m = ms[di]; if (m) open(boiProv(si === 0 ? 'nominal' : 'real', 10, m)); }} />
          ); })()}
          <div className="src">הפער בין הקווים: ציפיות אינפלציה ופרמיית סיכון, לא נגזר כאן.</div>
        </Panel>
      </div>

      <Panel title="העקום בסוף כל רבעון" aside={<span>{KIND_HE[kind]} · % לשנה</span>}>
        <div className="scroll"><table className="csm-series">
          <thead><tr><th>טווח</th>{qEnds.map((m) => <th key={m}><span className="num">{monthHe(m)}</span></th>)}<th>שינוי ברבעון<span className="dim">נ״ב, נגזר</span></th></tr></thead>
          <tbody>{ten(kind).map((t) => { const a = val(cv, kind, t, qEnds[qEnds.length - 2] ?? ''), z = val(cv, kind, t, latest); return (
            <tr key={t}><td className="lbl">{yrs(t)}</td>{qEnds.map((m) => { const v = val(cv, kind, t, m); return <td key={m}>{v == null ? <span className="muted">–</span> : <Sourced className="num" src={() => boiProv(kind, t, m)}>{nf(v, 2)}</Sourced>}</td>; })}
              <td>{a != null && z != null ? <Sourced className={`num der ${z - a < 0 ? 'neg' : 'pos'}`} src={() => ({ k: 'calc', title: `שינוי ברבעון · ${yrs(t)} · ${KIND_HE[kind]}`, value: `${sn((z - a) * 100, 0)} נ״ב`, formula: 'התשואה בחודש סוף הרבעון האחרון פחות הקודם, בנקודות בסיס', inputs: [{ label: monthHe(latest), v: `${nf(z, 2)}%`, src: () => boiProv(kind, t, latest) }, { label: monthHe(qEnds[qEnds.length - 2]), v: `${nf(a, 2)}%`, src: () => boiProv(kind, t, qEnds[qEnds.length - 2]) }] })}>{sn((z - a) * 100, 0)}</Sourced> : <span className="muted">–</span>}</td></tr>
          ); })}</tbody>
        </table></div>
      </Panel>

      <Panel title="ריבית היוון מדווחת מול העקום" aside={dates.length ? <Seg label="תאריך" value={Y} onChange={setYe} options={dates.map((x) => [x, dateLabel(x)])} /> : undefined}>
        {R.error ? <ErrorBox what="ריביות היוון" error={R.error} /> : !R.data ? <Loading what="ריביות היוון" /> : ports.length === 0 ? <Empty title="לא חולצו ריביות היוון מדווחות" /> : <>
          <Chart label={`ריבית היוון מדווחת מול עקום בנק ישראל · ${dateLabel(Y)}`} height={phone ? 300 : 340} deps={[Y, ports.length]} source={`דוחות החברות; בנק ישראל ZCM · אוחזר ${dateLabel(cv.retrieved)}`} build={() => curveOption([
            { name: `בנק ישראל, ריאלי, ${monthHe(ym)}`, color: b.fg, width: 3, data: ten('real').map((t) => [t, val(cv, 'real', t, ym)] as [number, number]).filter((p) => p[1] != null) },
            ...ports.map((p) => ({ name: `${name(p.c)} · ${shortPort(p.port ?? p.orig)}`, color: idColor(p.c), width: 1.4, dashed: /שאר|סיעוד/.test(p.port ?? ''), data: tens.map((t) => { const r = rate(p, t); return r ? [t, r.v] as [number, number] : null; }).filter((x): x is [number, number] => !!x) })),
          ])} onPoint={(si, di) => { if (si === 0) { const t = ten('real').filter((x) => val(cv, 'real', x, ym) != null)[di]; if (t != null) open(boiProv('real', t, ym)); return; } const p = ports[si - 1], t = tens.filter((x) => rate(p, x))[di], r = p && t != null ? rate(p, t) : null; if (r) open(rateProv(r)); }} />
          <section className="controls"><div className="field"><span>בטבלה</span><Seg<'v' | 'g'> label="בטבלה" value={gap} onChange={setGap} options={[['v', 'ריבית מדווחת, %'], ['g', 'פער מול בנק ישראל, נ״ב']]} /></div></section>
          <div className="scroll"><table className="csm-series">
            <thead><tr><th>חברה · תיק</th>{tens.map((t) => <th key={t}><span className="num">{t}</span>{t === tens[0] && <span className="dim">שנים</span>}</th>)}</tr></thead>
            <tbody>
              <tr className="indrow"><td>בנק ישראל, ריאלי ממשלתי<span className="dim">ממוצע {monthHe(ym)}</span></td>{tens.map((t) => { const v = val(cv, 'real', t, ym); return <td key={t}>{v == null ? <span className="muted">–</span> : <Sourced className="num" src={() => boiProv('real', t, ym)}>{nf(v, 2)}</Sourced>}</td>; })}</tr>
              {ports.map((p) => (
                <tr key={`${p.c}|${p.orig}`}><td><Dot id={p.c} />{name(p.c)}<span className="dim">{p.port ?? shortPort(p.orig)}</span></td>
                  {tens.map((t) => { const r = rate(p, t); if (!r) return <td key={t}><span className="muted">–</span></td>; if (gap === 'v') return <td key={t}><Sourced className="num" href={r.u && r.pg != null ? `${r.u}#page=${r.pg}` : null} src={() => rateProv(r)}>{nf(r.v, 2)}</Sourced></td>;
                    const g = gapOf(r); return <td key={t}>{g == null ? <span className="muted">–</span> : <Sourced className={`num der ${g < 0 ? 'neg' : ''}`} src={() => gapProv(r)}>{sn(g * 100, 0)}</Sourced>}</td>; })}
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="src">ריבית ספוט ריאלית כולל פרמיית אי-נזילות, כפי שהודפסה בביאור ההנחות; רק {[...new Set(ports.map((p) => name(p.c)))].join(' ו')} מדפיסות טבלה לפי טווח. הפער מול בנק ישראל נגזר וקירובי (ממוצע חודשי מול תאריך מאזן); מעל 20 שנים אין לבנק ישראל עקום.</div>
        </>}
      </Panel>
    </>
  );
}
