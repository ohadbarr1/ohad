import { Chart } from './Chart';
import { CHART_FONT, chartBase } from '../lib/theme';
import { nf } from '../lib/format';

/** One bar of a roll-forward: a balance (drawn from zero) or a movement (drawn from the running balance). */
export interface FallPt { l: string; v: number; total?: boolean }

/** The roll-forward as a waterfall: opening and closing balances in the ink colour, additions up, the release and other reductions down. */
export function WaterfallChart({ pts, label, onPoint, height = 300, deps }: { pts: FallPt[]; label: string; onPoint?: (i: number) => void; height?: number; deps: unknown[] }) {
  return (
    <Chart label={label} height={height} deps={deps} onPoint={(_, di) => onPoint?.(di)} build={() => {
      const b = chartBase();
      let run = 0; const base: (number | null)[] = [], up: (number | null)[] = [], down: (number | null)[] = [], tot: (number | null)[] = [];
      pts.forEach((p) => { if (p.total) { base.push(0); tot.push(p.v); up.push(null); down.push(null); run = p.v; } else { const nx = run + p.v; base.push(Math.min(run, nx)); up.push(p.v >= 0 ? p.v : null); down.push(p.v < 0 ? -p.v : null); tot.push(null); run = nx; } });
      const narrow = typeof window !== 'undefined' && window.innerWidth < 760;
      const lab = { show: !narrow || pts.length <= 6, position: 'top' as const, color: b.fg, fontSize: 10.5 };
      const lo = Math.min(...pts.filter((p) => p.total).map((p) => p.v), ...base.filter((x): x is number => x != null && x > 0));
      return {
        animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 6, right: 6, top: 24, bottom: 4, containLabel: true },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => { const p = pts[ps[0].dataIndex]; return `${p.l}: <b>‎${p.total ? '' : p.v > 0 ? '+' : ''}${nf(p.v, Math.abs(p.v) < 100 ? 1 : 0)}</b><br><span style="opacity:.65;font-size:11px">מיליוני ש"ח</span>`; } },
        xAxis: { type: 'category', data: pts.map((p) => p.l), axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } }, axisLabel: { color: b.mu, fontSize: 11, interval: 0, rotate: narrow || pts.length > 7 ? 35 : 0 } },
        // the axis starts near the smallest balance, not at zero, so the movements are visible next to a large balance; the bars say so by their gap
        yAxis: { type: 'value', min: lo > 0 ? Math.floor((lo * 0.9) / 100) * 100 : undefined, name: 'מיליוני ש"ח', nameTextStyle: { color: b.mu, fontSize: 11, align: 'left' }, axisLabel: { color: b.mu, fontSize: 10.5, formatter: (v: number) => `‎${nf(v, 0)}` }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
        series: [
          { type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, silent: true, tooltip: { show: false } },
          { type: 'bar', stack: 'w', data: tot, barMaxWidth: 44, itemStyle: { color: b.fg, opacity: 0.82, borderRadius: [2, 2, 0, 0] }, label: { ...lab, formatter: (p: { value: number }) => `‎${nf(p.value, 0)}` } },
          { type: 'bar', stack: 'w', data: up, barMaxWidth: 44, itemStyle: { color: b.up, borderRadius: [2, 2, 0, 0] }, label: { ...lab, formatter: (p: { value: number }) => `‎+${nf(p.value, 0)}` } },
          { type: 'bar', stack: 'w', data: down, barMaxWidth: 44, itemStyle: { color: b.down, borderRadius: [2, 2, 0, 0] }, label: { ...lab, formatter: (p: { value: number }) => `‎−${nf(p.value, 0)}` } },
        ],
      };
    }} />
  );
}

/** The same roll-forward in one line of bars, for a phone card: no axis, the balances as ticks, the movements as bars between them. */
export function MiniFall({ pts }: { pts: FallPt[] }) {
  let run = 0;
  const lv = pts.map((p) => { const from = p.total ? p.v : run, to = p.total ? p.v : run + p.v; run = to; return { ...p, from, to }; });
  const all = lv.flatMap((x) => [x.from, x.to]), lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <div className="minifall" aria-hidden="true">
      {lv.map((x, i) => (
        <div key={i} className="mf-row"><span className="mf-l">{x.l}</span>
          <span className="mf-track">{x.total ? <i className="tk" style={{ left: `${Math.min(pos(x.v), 99)}%` }} /> : <i className={x.v < 0 ? 'dn' : 'up'} style={{ left: `${pos(Math.min(x.from, x.to))}%`, width: `${Math.max(Math.abs(pos(x.to) - pos(x.from)), 1.2)}%` }} />}</span>
          <span className="mf-v num">{x.total ? '' : x.v > 0 ? '+' : ''}{nf(x.v, Math.abs(x.v) < 100 ? 1 : 0)}</span>
        </div>
      ))}
    </div>
  );
}
