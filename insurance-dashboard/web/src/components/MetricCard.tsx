import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chart } from './Chart';
import { CHART_FONT, chartBase, palette } from '../lib/theme';
import { nf } from '../lib/format';

export interface CardSeries { name: string; data: (number | null)[]; color?: number }
export interface MetricCardProps {
  title: string;
  tag?: string;
  unit: string;
  value: string;
  delta?: { text: string; tone?: 'pos' | 'neg' };
  x: string[];
  series: CardSeries[];
  kind?: 'bar' | 'area' | 'stack';
  color?: number;
  dec?: number;
  to?: string;
  foot?: ReactNode;
  wide?: boolean;
  i?: number;
}

const alpha = (rgb: string, a: number) => (rgb.startsWith('rgb(') ? rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`) : rgb);

/** One metric, one small chart, the latest period marked. The overview is a grid of these. */
export function MetricCard({ title, tag, unit, value, delta, x, series, kind = 'bar', color = 0, dec = 1, to, foot, wide, i = 0 }: MetricCardProps) {
  const empty = !series.some((s) => s.data.some((v) => v != null));
  return (
    <section className={`mcard${wide ? ' wide' : ''}`} style={{ ['--i' as string]: i }}>
      <header>
        <h3>{tag && <span className={`tag${tag === 'נגזר' ? ' est' : ''}`}>{tag}</span>}{title}</h3>
        {to && <Link to={to} className="open" aria-label={`פתח: ${title}`}>⤢</Link>}
      </header>
      <div className="mval"><span className="v num">{value}</span><span className="u">{unit}</span>{delta && <span className={`d num ${delta.tone ?? ''}`}>{delta.text}</span>}</div>
      {empty ? <div className="mnone">אין נתון</div> : (
        <Chart label={title} height={150} deps={[x.length, x[x.length - 1], series.map((s) => s.data[s.data.length - 1]).join(), kind]} build={() => {
          const b = chartBase(), pal = palette();
          const step = Math.max(1, Math.ceil(x.length / 7));
          return {
            animationDuration: 800, animationEasing: 'cubicOut', animationDelay: (idx: number) => idx * 12, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 4, right: 4, top: 8, bottom: 2, containLabel: true },
            tooltip: { trigger: 'axis', axisPointer: { type: kind === 'area' ? 'line' : 'shadow' }, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, confine: true,
              valueFormatter: (v: number | null) => (v == null ? '–' : nf(v, dec)) },
            xAxis: { type: 'category', data: x, boundaryGap: kind !== 'area', axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false },
              axisLabel: { color: b.mu, fontSize: 10, interval: kind === 'area' ? (i: number) => i > 0 && x[i] !== x[i - 1] : (i: number) => (x.length - 1 - i) % step === 0, hideOverlap: true } },
            yAxis: { type: 'value', scale: kind === 'area', splitNumber: 3, axisLabel: { color: b.mu, fontSize: 10 }, splitLine: { lineStyle: { color: b.ln, opacity: 0.5 } } },
            series: series.map((s, i) => {
              // one series: ember bars fading to nothing, the latest period at full strength; several: the categorical palette
              const single = series.length === 1, c = single ? b.accent : pal[(s.color ?? color + i) % pal.length];
              const fade = (top: number, bottom: number) => ({ type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: alpha(c, top) }, { offset: 1, color: alpha(c, bottom) }] });
              const last = s.data.reduce((at, v, k) => (v != null ? k : at), -1);
              if (kind === 'area') return { name: s.name, type: 'line', data: s.data, symbol: 'none', smooth: 0.25, lineStyle: { color: c, width: 2, shadowColor: alpha(c, 0.6), shadowBlur: 10 }, itemStyle: { color: c }, areaStyle: { color: fade(0.32, 0) } };
              return { name: s.name, type: 'bar', stack: kind === 'stack' ? 'a' : undefined, barCategoryGap: '24%',
                data: single ? s.data.map((v, k) => (k === last ? { value: v, itemStyle: { color: fade(1, 0.55), shadowColor: alpha(c, 0.55), shadowBlur: 14 } } : v)) : s.data,
                itemStyle: { color: single ? fade(0.62, 0.14) : c, opacity: single ? 1 : 0.92, borderRadius: kind === 'stack' ? 0 : [3, 3, 0, 0] } };
            }),
          };
        }} />
      )}
      {foot && <footer>{foot}</footer>}
    </section>
  );
}
