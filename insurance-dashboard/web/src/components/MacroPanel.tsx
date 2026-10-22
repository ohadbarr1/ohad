import type { ReactNode } from 'react';
import { Sourced } from './Source';
import { Chart } from './Chart';
import { foxOption } from '../lib/foxchart';
import { palette } from '../lib/theme';
import { nf, pubLabel } from '../lib/format';
import { back3, deltaProv, mLabel, seriesProv, useCurve, useMacro, type MonthSeries } from '../lib/macro';
import type { Prov } from '../lib/prov';
import type { EChartsCoreOption } from 'echarts/core';

/** yields sit in a 2-point band: the axis prints one decimal so its labels do not repeat */
function withPctAxis(o: EChartsCoreOption): EChartsCoreOption {
  const y = (o as { yAxis?: unknown }).yAxis;
  (Array.isArray(y) ? y : y ? [y] : []).forEach((a: { axisLabel?: Record<string, unknown> }) => { a.axisLabel = { ...(a.axisLabel ?? {}), formatter: (v: number) => `${nf(v, 1)}%` }; });
  return o;
}
import '../styles/home.css';

/** A thin line of the last months, drawn inline: no chart engine for a sparkline. */
function Spark({ v }: { v: number[] }) {
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), w = 96, h = 26, r = hi - lo || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - lo) / r) * (h - 4)).toFixed(1)}`).join(' ');
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}

interface Tile { key: string; label: string; value: string; prov: () => Prov; sub: ReactNode; spark: number[] }

/** BoI rate, CPI and the 10-year zero-coupon points: external inputs for reading CSM interest accretion and finance expenses. */
export function MacroPanel({ compact = false }: { compact?: boolean }) {
  const { data, error } = useMacro();
  const curve = useCurve().data;
  if (error) return <section className="panel macro"><div className="hd"><h2>מאקרו</h2></div><p className="muted">קובץ המאקרו לא נטען</p></section>;
  if (!data) return <section className="panel macro" aria-busy="true"><div className="hd"><h2>מאקרו</h2></div><div className="macro-tiles skeleton" /></section>;
  const S = data.series, tiles: Tile[] = [];
  const r = S.rate;
  if (r) {
    const prev = r.changes.length > 1 ? r.changes[r.changes.length - 2] : null, cur = r.changes[r.changes.length - 1];
    tiles.push({ key: 'rate', label: 'ריבית בנק ישראל', value: `${nf(r.last[1], 2)}%`, prov: () => seriesProv(r, `${nf(r.last[1], 2)}%`, pubLabel(r.last[0]), 'סדרה יומית'), spark: r.months.map(([, v]) => v),
      sub: <>{prev && <>שונתה <span className="num">{pubLabel(cur[0])}</span> · קודם <span className="num">{nf(prev[1], 2)}%</span></>}{r.next && <> · החלטה הבאה <Sourced src={() => ({ k: 'report', title: 'מועד החלטת הריבית הבאה', value: pubLabel(r.next), url: r.next_url, pg: null, doc: 'בנק ישראל', srcType: 'נתון חיצוני', note: `נמשך ${pubLabel(r.retrieved)}` })}><span className="num">{pubLabel(r.next)}</span></Sourced></>}</> });
  }
  const c = S.cpi;
  if (c?.points.length) {
    const L = c.points[c.points.length - 1];
    if (L.yoy != null) tiles.push({ key: 'cpi', label: 'מדד המחירים לצרכן, 12 חודשים', value: `${nf(L.yoy, 1)}%`, prov: () => seriesProv(c, `${nf(L.yoy!, 1)}%`, mLabel(L.m), 'שינוי ב-12 חודשים, כפי שפורסם'), spark: c.points.map((p) => p.yoy ?? 0),
      sub: <><span className="num">{mLabel(L.m)}</span>{L.mom != null && <> · בחודש <Sourced src={() => seriesProv(c, `${nf(L.mom!, 1)}%`, mLabel(L.m), 'שינוי חודשי, כפי שפורסם')}><span className="num">{nf(L.mom, 1)}%</span></Sourced></>}</> });
    const y = c.ytd;
    if (y) tiles.push({ key: 'ytd', label: 'מדד מתחילת השנה', value: `${nf(y.v, 1)}%`, spark: [],
      prov: () => ({ k: 'calc', title: `מדד המחירים לצרכן, ${mLabel(y.from)} → ${mLabel(y.to)}`, value: `${nf(y.v, 2)}%`, unit: '%', formula: 'מדד אחרון ÷ מדד דצמבר הקודם − 1 (אותו בסיס)',
        inputs: [{ label: `מדד ${mLabel(y.to)}`, v: nf(y.idx_to, 1), src: () => seriesProv(c, nf(y.idx_to, 1), mLabel(y.to), `בסיס ${L.base ?? ''}`) }, { label: `מדד ${mLabel(y.from)}`, v: nf(y.idx_from, 1), src: () => seriesProv(c, nf(y.idx_from, 1), mLabel(y.from)) }] }),
      sub: <><span className="num">{mLabel(y.from)}</span> עד <span className="num">{mLabel(y.to)}</span></> });
  }
  const zc = (s: MonthSeries | undefined, key: string, label: string) => {
    if (!s?.months.length) return;
    const a = s.months[s.months.length - 1], b = s.months.find(([m]) => m === back3(a[0]));
    const d = b ? (a[1] - b[1]) * 100 : null;
    tiles.push({ key, label, value: `${nf(a[1], 2)}%`, prov: () => seriesProv(s, `${nf(a[1], 2)}%`, mLabel(a[0]), s.basis), spark: s.months.map(([, v]) => v),
      sub: <><span className="num">{mLabel(a[0])}</span> · ממוצע חודשי{b && d != null && <> · <Sourced className={`num ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`} src={() => deltaProv(s, a, b, true)}>{`${d > 0 ? '+' : ''}${nf(d, 0)}`}</Sourced> נ"ב מול <span className="num">{mLabel(b[0])}</span></>}</> });
  };
  zc(S.nom10, 'nom10', 'תשואה נומינלית, אפס 10 שנים');
  zc(S.real10, 'real10', 'תשואה ריאלית, אפס 10 שנים');
  zc(S.be10, 'be10', 'ציפיות אינפלציה, 10 שנים');
  const pal = palette();
  // the curve: the latest month against the same month a year before
  const cm = curve?.months.length ? curve.months.length - 1 : -1, cy = cm >= 12 ? cm - 12 : -1;
  return (
    <section className={`panel macro${compact ? ' compact' : ''}`} aria-label="מאקרו">
      <div className="hd"><h2>מאקרו</h2><div className="aside"><span>קלט חיצוני · בנק ישראל, הלמ"ס</span></div></div>
      <div className="macro-tiles">
        {tiles.map((t) => (
          <div className="mt" key={t.key}>
            <div className="l">{t.label}</div>
            <div className="row"><Sourced className="v" src={t.prov}>{t.value}</Sourced><Spark v={t.spark} /></div>
            <div className="s">{t.sub}</div>
          </div>
        ))}
      </div>
      {curve && cm >= 0 && !compact && (
        <Chart label="עקום אפס ממשלתי" height={210} deps={[curve.months[cm]]} source={`בנק ישראל · ZCM · ${curve.basis === 'monthly average' ? 'ממוצע חודשי' : curve.basis}`} build={() => withPctAxis(foxOption({
          x: curve.tenors.map((t) => `${t}Y`), unit: '%', scale: true, labels: false, full: true, series: [
            { name: `נומינלי ${mLabel(curve.months[cm])}`, kind: 'line', color: pal[0], pct: true, dec: 2, data: curve.tenors.map((t) => curve.nominal[String(t)]?.[cm] ?? null) },
            { name: `ריאלי ${mLabel(curve.months[cm])}`, kind: 'line', color: pal[1], pct: true, dec: 2, data: curve.tenors.map((t) => curve.real[String(t)]?.[cm] ?? null) },
            ...(cy >= 0 ? [{ name: `נומינלי ${mLabel(curve.months[cy])}`, kind: 'line' as const, color: pal[0], dashed: true, dim: true, pct: true, dec: 2, data: curve.tenors.map((t) => curve.nominal[String(t)]?.[cy] ?? null) }] : []),
          ] }))} />
      )}
    </section>
  );
}
