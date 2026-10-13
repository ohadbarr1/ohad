import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { ErrorBox, Field, Loading } from '../components/ui';
import { nf } from '../lib/format';
import { baseKey, baseLabel, inst, Lts, parseBase, periodLabel, periodsOf, quarter, ytd, type Base, type LtsData, type PeriodSet } from '../lib/lts';
import { keepSrc, useSource, type Prov } from '../lib/prov';
import { CHART_FONT, chartBase, cssColor } from '../lib/theme';
import { useLoad } from '../lib/useData';
import '../styles/sectors.css';

const PEN = ['phoenix', 'menora', 'clal', 'migdal', 'harel', 'altshuler', 'meitav', 'more'];
const GEM = [...PEN, 'yelin', 'analyst'];
const AM = [...GEM, 'hachshara', 'ayalon', 'direct'];
const IC = ['phoenix', 'hachshara', 'migdal', 'harel', 'clal', 'ayalon', 'menora', 'direct'];

interface Ctx { lts: Lts; focus: string; all: string | null }
const C = createContext<Ctx>(null as unknown as Ctx);
const alpha = (rgb: string, a: number) => (rgb.startsWith('rgb(') ? rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`) : rgb);
const ltr = (t: string) => `\u202A${t}\u202C`;
const sign = (v: number, dec = 1) => ltr(`${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), dec)}%`);

function provOf(lts: Lts, title: string, metric: string, c: string, p: string, unit: string, dec: number): Prov {
  const v = lts.v(metric, c, p), s = lts.slide(metric, c, p);
  if (v == null) return { k: 'none', title: `${title} · ${lts.name(c)} · ${periodLabel(p)}`, why: 'אין נתון לתקופה זו.' };
  if (s === 0) {
    // built from the managing company's own report: the formula, and every printed figure it uses with its page
    const pr = lts.prov[c], f = pr?.facts[`${metric}|${p}`];
    if (!pr || !f) return { k: 'none', title: `${title} · ${lts.name(c)} · ${periodLabel(p)}`, why: 'מקור: דוחות החברה המנהלת. פירוט הרכיבים עדיין נטען, נסו שוב.' };
    return { k: 'calc', title: `${title} · ${lts.name(c)} · ${periodLabel(p)}`, value: nf(v, dec), unit, formula: f[0], note: `${pr.entity ?? 'דוחות החברה המנהלת'}. ${lts.d.notes[metric] ?? ''}`.trim(),
      inputs: f[1].slice(0, 40).map((i) => { const [file, pg, label, val, u, date, win] = pr.parts[i], url = pr.urls[file] ?? null;
        return { label: `${label} · ${date}${win && win !== 'instant' ? ` · ${win}` : ''}`, v: `${nf(val, Math.abs(val) < 100 ? 2 : 0)} ${u.replace('NIS thousands', 'אלפי ש"ח').replace('NIS thousand', 'אלפי ש"ח').replace('NIS millions', 'מיליוני ש"ח')}`,
          src: () => ({ k: 'report', title: label, value: nf(val, Math.abs(val) < 100 ? 2 : 0), unit: u, url, pg, doc: `${pr.entity ?? lts.name(c)}, דוח ${file}`, period: date, srcType: 'דוח החברה המנהלת' }) as Prov }; }) };
  }
  return { k: 'report', title: `${title} · ${lts.name(c)}`, value: nf(v, dec), unit, url: null, pg: s, doc: lts.d.source, period: periodLabel(p), srcType: 'מצגת השוואות ענפיות (שקף)', note: lts.d.notes[metric] };
}

/** Charts are many and each owns a canvas: one is built only when its card comes near the screen. */
function Lazy({ height, children }: { height: number; children: () => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (on || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setOn(true); }, { rootMargin: '500px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [on]);
  return <div ref={ref} style={on ? undefined : { minHeight: height }}>{on ? children() : null}</div>;
}

/** One slide element: its title, its unit, and the report it is measured on. */
function Card({ title, unit, metric, current, height = 300, children }: { title: string; unit: string; metric: string; current: (b: Base) => string; height?: number; children: (b: Base) => ReactNode }) {
  const { lts, all } = useContext(C);
  const bases = useMemo(() => lts.bases(metric, current), [lts, metric, current]);
  const [own, setOwn] = useState<string | null>(null);
  useEffect(() => setOwn(null), [all]);
  if (!bases.length) return null;
  const keys = bases.map(baseKey), pick = own && keys.includes(own) ? own : all && keys.includes(all) ? all : keys[0];
  const b = parseBase(pick);
  return (
    <section className="panel sx-card">
      <div className="hd">
        <h2>{title}</h2>
        <div className="aside">
          <span>{unit}</span>
          {all && !keys.includes(all) && <span className="chip">אין נתון ל-{baseLabel(parseBase(all))}</span>}
          <select aria-label={`${title}: על בסיס דוח`} value={pick} onChange={(e) => setOwn(e.target.value)}>{bases.map((x) => <option key={baseKey(x)} value={baseKey(x)}>{baseLabel(x)}</option>)}</select>
        </div>
      </div>
      <Lazy height={height}>{() => children(b)}</Lazy>
    </section>
  );
}

function tones(n: number): string[] {
  const b = chartBase(), navy = cssColor('--sx-navy'), hi = cssColor('--sx-hi');
  const set = [navy, alpha(navy, 0.62), alpha(b.mu, 0.5), hi];
  return n >= 4 ? set : n === 3 ? [navy, alpha(b.mu, 0.5), hi] : n === 2 ? [alpha(b.mu, 0.5), hi] : [hi];
}

interface BarsProps { title: string; metric: string; set: PeriodSet; cos: string[]; dec?: number; pct?: boolean; unit: string; g?: [number, number] | 'last'; agg?: 'own' | 'in'; b: Base; sub?: string; height?: number }
/** Companies side by side, one bar per period. The change between two of the periods is printed under each name. */
function Bars({ title, metric, set, cos: every, dec = 0, pct, unit, g, agg, b, sub, height = 300 }: BarsProps) {
  const { lts, focus } = useContext(C);
  const { open } = useSource();
  const ps = periodsOf(set, b).filter((p) => lts.has(metric, p));
  // only companies with a figure in one of the periods shown: a period built from the reports covers the companies extracted so far
  const cos = every.filter((c) => ps.some((p) => lts.v(metric, c, p) != null));
  const cats = agg === 'in' && ps.some((p) => lts.v(metric, 'all', p) != null) ? [...cos, 'all'] : cos;
  const fmt = (v: number) => `${nf(v, dec)}${pct ? '%' : ''}`;
  const pair = g === 'last' ? [ps.length - 1, ps.length - 2] : g ? [g[0], g[1]] : null;
  const growth = (c: string): number | null => {
    if (!pair || pair[1] < 0 || ps.length < 2) return null;
    const printed = lts.v(`${metric}.g`, c, ps[pair[0]]);
    if (printed != null) return printed;
    const a = lts.v(metric, c, ps[pair[0]]), z = lts.v(metric, c, ps[pair[1]]);
    return a != null && z != null && z > 0 ? (a / z - 1) * 100 : null;
  };
  const build = (list: string[], own: boolean) => () => {
    const cb = chartBase(), t = tones(ps.length);
    return {
      animationDuration: 500, textStyle: { fontFamily: CHART_FONT }, grid: { left: 6, right: 6, top: 26, bottom: 4, containLabel: true },
      legend: own ? undefined : { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: cb.mu, fontSize: 11 } },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number | null) => (v == null ? '–' : fmt(v)) },
      xAxis: { type: 'category', inverse: true, data: list, axisTick: { show: false }, axisLine: { lineStyle: { color: cb.ln } },
        axisLabel: { interval: 0, color: cb.fg, fontSize: 12, lineHeight: 16,
          formatter: (c: string) => { const gr = growth(c), s = sub ? lts.v(sub, c, inst(b)) : null; return `${c === focus ? '{f|' : '{n|'}${lts.name(c)}}${gr == null ? '' : `\n{${gr >= 0 ? 'u' : 'd'}|${sign(gr)}}`}${s == null ? '' : `\n{s|נכס ${nf(s, 0)}}`}`; },
          rich: { n: { color: cb.fg, fontSize: 12 }, f: { color: cb.accent, fontSize: 12, fontWeight: 700 }, u: { color: cb.up, fontSize: 11, fontWeight: 600 }, d: { color: cb.down, fontSize: 11, fontWeight: 600 }, s: { color: cb.mu, fontSize: 10.5 } } } },
      yAxis: { type: 'value', show: false },
      series: ps.map((p, i) => ({
        name: periodLabel(p), type: 'bar', barGap: '8%', barCategoryGap: '22%', itemStyle: { color: t[i], borderRadius: [2, 2, 0, 0] },
        data: list.map((c) => { const v = lts.v(metric, c, p); return v == null ? null : { value: v, label: { position: v < 0 ? 'bottom' : 'top' }, itemStyle: c === focus ? { borderColor: cb.accent, borderWidth: 1.5 } : undefined }; }),
        label: { show: true, color: cb.fg, fontSize: 10.5, formatter: (x: { value: number }) => fmt(x.value) },
      })),
    };
  };
  const hit = (list: string[]) => (si: number, di: number) => open(provOf(lts, title, metric, list[di], ps[si], unit, dec));
  const w = cats.length * (ps.length * (pct && dec >= 2 ? 36 : 24) + 22);
  return (
    <div className="sx-row">
      <div className="sx-scroll"><div style={{ minWidth: w }}><Chart label={title} height={height} deps={[baseKey(b), focus, metric]} build={build(cats, false)} onPoint={hit(cats)} /></div></div>
      {agg === 'own' && <div className="sx-agg"><Chart label={`${title}, ${lts.name('all')}`} height={height} deps={[baseKey(b), metric]} build={build(['all'], true)} onPoint={hit(['all'])} exportName="" /></div>}
    </div>
  );
}

/** Shares of the companies in one total, one ring per period. */
function Donuts({ title, share, total, set, cos, b, unit, dec = 0 }: { title: string; share: string; total: string; set: PeriodSet; cos: string[]; b: Base; unit: string; dec?: number }) {
  const { lts, focus } = useContext(C);
  const { open } = useSource();
  const ps = periodsOf(set, b).filter((p) => lts.has(share, p));
  return (
    <div className="sx-donuts">{ps.map((p) => (
      <div key={p}>
        <Chart label={`${title}, ${periodLabel(p)}`} height={230} deps={[p, focus]} exportName="" onPoint={(_, di) => open(provOf(lts, `${title}, נתח`, share, cos[di], p, '%', 1))} build={() => {
          const cb = chartBase(), t = lts.v(total, 'all', p);
          return {
            textStyle: { fontFamily: CHART_FONT }, tooltip: { trigger: 'item', valueFormatter: (v: number) => `${nf(v, 1)}%` },
            title: { text: periodLabel(p), subtext: t == null ? '' : `${nf(t, dec)} ${unit}`, left: 'center', top: '40%', textStyle: { color: cb.mu, fontSize: 11, fontWeight: 500 }, subtextStyle: { color: cb.fg, fontSize: 14, fontWeight: 700 }, itemGap: 2 },
            series: [{ type: 'pie', radius: ['40%', '58%'], startAngle: 90, clockwise: true, avoidLabelOverlap: true, itemStyle: { borderColor: cb.panel, borderWidth: 1.5 },
              label: { color: cb.fg, fontSize: 10.5, lineHeight: 13, overflow: 'none', formatter: (x: { name: string; value: number }) => `${x.name}\n${nf(x.value, 1)}%` }, labelLine: { length: 5, length2: 5, lineStyle: { color: cb.ln } },
              data: cos.map((c, i) => ({ name: lts.name(c), value: lts.v(share, c, p), itemStyle: { color: c === focus ? cssColor('--sx-hi') : alpha(cb.mu, 0.16 + (i % 3) * 0.1) } })).filter((x) => x.value != null) }],
          };
        }} />
      </div>
    ))}</div>
  );
}

/** Transfers in above the line, transfers out below it, the net under each name. */
function Flows({ title, fam, period, cos: every, b }: { title: string; fam: 'pen' | 'gem'; period: string; cos: string[]; b: Base }) {
  const { lts, focus } = useContext(C);
  const { open } = useSource();
  const keys = [`${fam}.tr_in`, `${fam}.tr_out`];
  const cos = every.filter((c) => lts.v(keys[0], c, period) != null || lts.v(keys[1], c, period) != null);
  if (!lts.has(keys[0], period)) return <div className="sx-none">{periodLabel(period)}: אין נתון</div>;
  return (
    <div className="sx-flow">
      <h3>{periodLabel(period)}</h3>
      <div className="sx-scroll"><div style={{ minWidth: cos.length * 62 }}>
        <Chart label={`${title}, ${periodLabel(period)}`} height={250} deps={[period, focus, baseKey(b)]} exportName={`fox-${title}-${period}`.replace(/\s+/g, '-')}
          onPoint={(si, di) => open(provOf(lts, `${title}, ${si === 0 ? 'ניוד פנימה' : 'ניוד החוצה'}`, keys[si], cos[di], period, 'מיליארדי ש"ח', 1))}
          build={() => {
            const cb = chartBase(), navy = cssColor('--sx-navy'), hi = cssColor('--sx-hi');
            return {
              textStyle: { fontFamily: CHART_FONT }, grid: { left: 6, right: 6, top: 26, bottom: 4, containLabel: true }, legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: cb.mu, fontSize: 11 } },
              tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number | null) => (v == null ? '–' : nf(Math.abs(v), 1)) },
              xAxis: { type: 'category', inverse: true, data: cos, axisTick: { show: false }, axisLine: { show: false },
                axisLabel: { interval: 0, lineHeight: 17, formatter: (c: string) => { const n = lts.v(`${fam}.tr_net`, c, period); return `${c === focus ? '{f|' : '{n|'}${lts.name(c)}}${n == null ? '' : `\n{${n >= 0 ? 'u' : 'd'}|${ltr(n < 0 ? `(${nf(-n, 1)})` : nf(n, 1))}}`}`; },
                  rich: { n: { color: cb.fg, fontSize: 12 }, f: { color: cb.accent, fontSize: 12, fontWeight: 700 }, u: { color: cb.fg, fontSize: 13, fontWeight: 800 }, d: { color: cb.down, fontSize: 13, fontWeight: 800 } } } },
              yAxis: { type: 'value', show: false },
              series: [
                { name: 'ניוד פנימה', type: 'bar', stack: 'a', barWidth: '62%', itemStyle: { color: navy }, data: cos.map((c) => lts.v(keys[0], c, period)), label: { show: true, position: 'inside', color: '#fff', fontSize: 10.5, formatter: (x: { value: number }) => nf(x.value, 1) },
                  markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: cb.fg, width: 1, type: 'solid' }, data: [{ yAxis: 0 }] } },
                { name: 'ניוד החוצה', type: 'bar', stack: 'a', itemStyle: { color: alpha(hi, 0.42) }, data: cos.map((c) => { const v = lts.v(keys[1], c, period); return v == null ? null : -v; }), label: { show: true, position: 'inside', color: cb.fg, fontSize: 10.5, formatter: (x: { value: number }) => ltr(`(${nf(-x.value, 1)})`) } },
              ],
            };
          }} />
      </div></div>
    </div>
  );
}

/** A rate by quarter, companies across. */
function QTable({ title, metric, cos, b, dec = 1 }: { title: string; metric: string; cos: string[]; b: Base; dec?: number }) {
  const { lts, focus } = useContext(C);
  const ps = periodsOf('q6', b).filter((p) => lts.has(metric, p)), cols = [...cos, 'all'];
  if (!ps.length) return null;
  return (
    <div className="scroll"><table className="sx-table">
      <thead><tr><th>רבעון</th>{cols.map((c) => <th key={c} className={c === focus ? 'on' : c === 'all' ? 'agg' : undefined}>{lts.name(c)}</th>)}</tr></thead>
      <tbody>{ps.map((p) => (
        <tr key={p}><td className="num">{periodLabel(p)}</td>{cols.map((c) => { const v = lts.v(metric, c, p); return <td key={c} className={`num${c === focus ? ' on' : c === 'all' ? ' agg' : ''}`}>{v == null ? '–' : <Sourced src={() => provOf(lts, title, metric, c, p, '%', dec)}>{nf(v, dec)}%</Sourced>}</td>; })}</tr>
      ))}</tbody>
    </table></div>
  );
}

/** Managed assets by product: pension, provident and investment contracts stacked, at one balance date. */
function Mix({ b }: { b: Base }) {
  const { lts, focus } = useContext(C);
  const { open } = useSource();
  const p = inst(b), parts: [string, string][] = [['am.mix.pen', 'פנסיה'], ['am.mix.gem', 'גמל'], ['am.mix.ic', 'חוזי השקעה']];
  const build = (list: string[], own: boolean) => () => {
    const cb = chartBase(), cols = [cssColor('--sx-navy'), alpha(cb.mu, 0.42), cssColor('--sx-hi')];
    return {
      textStyle: { fontFamily: CHART_FONT }, grid: { left: 6, right: 6, top: 30, bottom: 4, containLabel: true },
      legend: own ? undefined : { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: cb.mu, fontSize: 11 } },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number | null) => (v == null ? '–' : nf(v, 1)) },
      xAxis: { type: 'category', inverse: true, data: list, axisTick: { show: false }, axisLine: { lineStyle: { color: cb.ln } }, axisLabel: { interval: 0, formatter: (c: string) => `${c === focus ? '{f|' : '{n|'}${lts.name(c)}}\n{t|${nf(lts.v('am.aum', c, p) ?? 0, 0)}}`, rich: { n: { color: cb.fg, fontSize: 12 }, f: { color: cb.accent, fontSize: 12, fontWeight: 700 }, t: { color: cb.fg, fontSize: 12, fontWeight: 700 } }, lineHeight: 17 } },
      yAxis: { type: 'value', show: false },
      series: parts.map(([m, name], i) => ({ name, type: 'bar', stack: 'a', barWidth: '64%', itemStyle: { color: cols[i] },
        data: list.map((c) => { const pc = lts.v(m, c, p), a = lts.v('am.aum', c, p); return pc == null || a == null ? null : { value: +(a * pc / 100).toFixed(2), pc }; }),
        label: { show: true, position: 'inside', fontSize: 10.5, color: i === 0 ? '#fff' : cb.fg, formatter: (x: { data: { pc: number; value: number } }) => (x.data.pc < 100 && x.data.value > 0 ? `${x.data.pc}%` : '') } })),
    };
  };
  const hit = (list: string[]) => (si: number, di: number) => open(provOf(lts, `תמהיל נכסים, ${parts[si][1]}`, parts[si][0], list[di], p, '%', 0));
  return (
    <div className="sx-row">
      <div className="sx-scroll"><div style={{ minWidth: AM.length * 58 }}><Chart label="תמהיל נכסים מנוהלים" height={320} deps={[p, focus]} build={build(AM, false)} onPoint={hit(AM)} /></div></div>
      <div className="sx-agg"><Chart label="תמהיל נכסים מנוהלים, סך הענף" height={320} deps={[p]} build={build(['all'], true)} onPoint={hit(['all'])} exportName="" /></div>
    </div>
  );
}

/** A market total over time with the share of one company marked in it. */
function ShareBars({ title, metric, share, periods, unit }: { title: string; metric: string; share: string; periods: string[]; unit: string }) {
  const { lts, focus } = useContext(C);
  const { open } = useSource();
  const ps = periods.filter((p) => lts.v(metric, 'all', p) != null);
  const sh = (p: string) => { const own = lts.v(metric, focus, p), all = lts.v(metric, 'all', p); return own != null && all ? own / all * 100 : lts.v(share, focus, p); };
  return (
    <Chart label={title} height={280} deps={[ps.join(), focus]} onPoint={(si, di) => open(si === 0 && lts.v(metric, focus, ps[di]) == null ? provOf(lts, `${title}, נתח`, share, focus, ps[di], '%', 0) : provOf(lts, title, metric, si === 0 ? focus : 'all', ps[di], unit, 0))} build={() => {
      const cb = chartBase();
      return {
        textStyle: { fontFamily: CHART_FONT }, grid: { left: 6, right: 6, top: 30, bottom: 4, containLabel: true }, legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: cb.mu, fontSize: 11 } },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number | null) => (v == null ? '–' : nf(v, 1)) },
        xAxis: { type: 'category', data: ps.map(periodLabel), axisTick: { show: false }, axisLine: { lineStyle: { color: cb.ln } }, axisLabel: { color: cb.fg, fontSize: 12 } }, yAxis: { type: 'value', show: false },
        series: [
          { name: lts.name(focus), type: 'bar', stack: 'a', barWidth: '56%', itemStyle: { color: cssColor('--sx-navy') }, data: ps.map((p) => { const s = sh(p), a = lts.v(metric, 'all', p)!; return s == null ? null : { value: +(a * s / 100000).toFixed(2), s }; }), label: { show: true, position: 'inside', color: '#fff', fontSize: 11, formatter: (x: { data: { s: number } }) => `${nf(x.data.s, 0)}%` } },
          { name: 'כל היתר', type: 'bar', stack: 'a', itemStyle: { color: alpha(cb.mu, 0.4) }, data: ps.map((p) => { const s = sh(p) ?? 0, a = lts.v(metric, 'all', p)!; return { value: +(a * (100 - s) / 100000).toFixed(2), t: a / 1000 }; }), label: { show: true, position: 'top', color: cb.fg, fontSize: 12, fontWeight: 700, formatter: (x: { data: { t: number } }) => nf(x.data.t, x.data.t < 20 ? 1 : 0) } },
        ],
      };
    }} />
  );
}

/** Companies down, periods across, each figure with its share of the total. */
function IcTable({ title, metric, periods, withShare, growth }: { title: string; metric: string; periods: string[]; withShare?: boolean; growth?: boolean }) {
  const { lts, focus } = useContext(C);
  const ps = periods.filter((p) => lts.v(metric, 'all', p) != null && IC.some((c) => lts.v(metric, c, p) != null));
  const g = (c: string) => { const last = ps[ps.length - 1], pr = lts.v(`${metric}.g`, c, last); if (pr != null) return pr; const a = lts.v(metric, c, last), z = lts.v(metric, c, ps[ps.length - 2]); return a != null && z ? (a / z - 1) * 100 : null; };
  return (
    <div className="scroll"><table className="sx-table sx-ic">
      <thead><tr><th>חברה</th>{ps.map((p) => [<th key={p}>{periodLabel(p)}</th>, withShare ? <th key={`${p}s`}>נתח</th> : null])}{growth && ps.length > 1 && <th>שינוי</th>}</tr></thead>
      <tbody>{[...IC, 'all'].map((c) => (
        <tr key={c} className={c === 'all' ? 'tot' : c === focus ? 'on' : undefined}><td>{c === 'all' ? 'סך הכול' : lts.name(c)}</td>
          {ps.map((p) => { const v = lts.v(metric, c, p), all = lts.v(metric, 'all', p); return [
            <td key={p} className="num">{v == null ? '–' : <Sourced src={() => provOf(lts, title, metric, c, p, 'מיליוני ש"ח', 0)}>{nf(v, 0)}</Sourced>}</td>,
            withShare ? <td key={`${p}s`} className="num muted">{v == null || !all || c === 'all' ? '' : `${nf(v / all * 100, 0)}%`}</td> : null,
          ]; })}
          {growth && ps.length > 1 && <td className="num">{(() => { const x = g(c); return x == null ? '–' : sign(x, 0); })()}</td>}
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/** The executive summary of the deck, as figures: the company in focus, product by product. */
function Summary() {
  const { lts, focus, all } = useContext(C);
  const b = parseBase(all ?? '2026Q2');
  type Item = [string, string, string, string, number, string?];  // label, metric, company, period, decimals, suffix
  const rank = (metric: string, cos: string[], p: string) => { const v = lts.v(metric, focus, p); return v == null || cos.some((c) => lts.v(metric, c, p) == null) ? null : cos.filter((c) => lts.v(metric, c, p)! > v).length + 1; };
  const fy = `FY${b.q === 4 ? b.y : b.y - 1}`;
  const blocks: [string, Item[], (number | null)?][] = [
    ['ניהול נכסים', [['נכס מנוהל, מיליארדי ש"ח', 'am.aum', focus, inst(b), 0], ['שינוי מתחילת השנה', 'am.aum.g', focus, inst(b), 1, '%'], [`הכנסות מדמי ניהול, ${periodLabel(fy)}`, 'am.fees', focus, fy, 0], [`שינוי ברווח התפעולי, ${periodLabel(fy)}`, 'am.op.g', focus, fy, 1, '%']], rank('am.aum', AM, inst(b))],
    ['פוליסות השקעה', [['נכס מנוהל, מיליוני ש"ח', 'ic.aum', focus, inst(b), 0], ['נתח מהענף', 'ic.aum.share', focus, inst(b), 0, '%'], [`הפקדות ${periodLabel(quarter(b))}, מיליוני ש"ח`, 'ic.dep', focus, quarter(b), 0], ['נתח בהפקדות', 'ic.dep.share', focus, quarter(b), 0, '%']], rank('ic.aum', IC, inst(b))],
    ['פנסיה', [['נכס מנוהל, מיליארדי ש"ח', 'pen.aum', focus, inst(b), 0], ['נתח שוק', 'pen.aum.share', focus, inst(b), 1, '%'], [`ניוד נטו ${periodLabel(ytd(b))}`, 'pen.tr_net', focus, ytd(b), 1], [`ניוד נטו ${periodLabel(quarter(b))}`, 'pen.tr_net', focus, quarter(b), 1]], rank('pen.aum', PEN, inst(b))],
    ['גמל', [['נכס מנוהל, מיליארדי ש"ח', 'gem.aum', focus, inst(b), 0], ['נתח שוק', 'gem.aum.share', focus, inst(b), 1, '%'], [`ניוד נטו ${periodLabel(ytd(b))}`, 'gem.tr_net', focus, ytd(b), 1], [`ניוד נטו ${periodLabel(quarter(b))}`, 'gem.tr_net', focus, quarter(b), 1]], rank('gem.aum', GEM, inst(b))],
  ];
  return (
    <div className="sx-sum">{blocks.map(([name, items, rk]) => (
      <section key={name} className="panel">
        <h3>{name}{rk != null && <span className="chip">מקום {rk}</span>}</h3>
        <dl>{items.map(([label, metric, c, p, dec, suf]) => { const v = lts.v(metric, c, p); return <div key={label}><dt>{label}</dt><dd className="num">{v == null ? '–' : <Sourced src={() => provOf(lts, label, metric, c, p, suf ?? '', dec)}>{nf(v, dec)}{suf ?? ''}</Sourced>}</dd></div>; })}</dl>
      </section>
    ))}</div>
  );
}

const SECTIONS: [string, string][] = [['sum', 'תמצית'], ['am', 'ניהול נכסים'], ['ic', 'פוליסות השקעה'], ['pen', 'פנסיה'], ['gem', 'גמל']];
const cur = { inst: (b: Base) => inst(b), ytd: (b: Base) => ytd(b), q: (b: Base) => quarter(b), fy: (b: Base) => (b.q === 4 ? `FY${b.y}` : '') };
const BN = 'מיליארדי ש"ח', MN = 'מיליוני ש"ח', PA = '% מהנכס המנוהל', PF = '% מדמי הניהול';

/** The same eleven views for pension and for provident funds. */
function Family({ fam, cos, name }: { fam: 'pen' | 'gem'; cos: string[]; name: string }) {
  return (
    <>
      <Card title={`${name}: נתחי שוק בנכס המנוהל`} unit="%" metric={`${fam}.aum.share`} current={cur.inst} height={240}>{(b) => <Donuts title={`${name}, נכס מנוהל`} share={`${fam}.aum.share`} total={`${fam}.aum`} set="inst3" cos={cos} b={b} unit="מיליארד" />}</Card>
      <Card title={`${name}: מגמות בנכס המנוהל`} unit={BN} metric={`${fam}.aum`} current={cur.inst}>{(b) => <Bars title={`${name}, נכס מנוהל`} metric={`${fam}.aum`} set="inst3" cos={cos} unit={BN} g="last" b={b} />}</Card>
      <Card title={`${name}: ניוד נטו`} unit={BN} metric={`${fam}.tr_in`} current={cur.ytd} height={520}>{(b) => <><Flows title={`${name}, ניוד`} fam={fam} period={ytd(b)} cos={cos} b={b} />{b.q !== 4 && <Flows title={`${name}, ניוד`} fam={fam} period={`FY${b.y - 1}`} cos={cos} b={b} />}</>}</Card>
      <Card title={`${name}: ניוד נטו לפי רבעונים`} unit={BN} metric={`${fam}.tr_in`} current={cur.q} height={520}>{(b) => <div className="sx-two"><Flows title={`${name}, ניוד`} fam={fam} period={quarter(b)} cos={cos} b={b} /><Flows title={`${name}, ניוד`} fam={fam} period={quarter(b, 1)} cos={cos} b={b} /></div>}</Card>
      <Card title={`${name}: שיעור ניוד יוצא מהנכס המנוהל`} unit="%, שנתי" metric={`${fam}.out_rate`} current={cur.ytd} height={460}>{(b) => <><Bars title={`${name}, שיעור ניוד יוצא`} metric={`${fam}.out_rate`} set="flow3" cos={cos} dec={fam === 'gem' ? 2 : 1} pct unit="%" agg="in" b={b} height={260} /><QTable title={`${name}, שיעור ניוד יוצא`} metric={`${fam}.out_rate`} cos={cos} b={b} /></>}</Card>
      {fam === 'pen' ? (
        <>
          <Card title="פנסיה: פרמיה משונתת, עסק חדש (נתחים)" unit="%" metric="pen.nb.share" current={cur.ytd} height={240}>{(b) => <Donuts title="פנסיה, פרמיה משונתת עסק חדש" share="pen.nb.share" total="pen.nb" set="flow3" cos={cos} b={b} unit="מיליארד" dec={1} />}</Card>
          <Card title="פנסיה: פרמיה משונתת, עסק חדש" unit={BN} metric="pen.nb" current={cur.ytd}>{(b) => <Bars title="פנסיה, פרמיה משונתת עסק חדש" metric="pen.nb" set="flow3" cos={cos} dec={1} unit={BN} b={b} />}</Card>
          <Card title="פנסיה, קרנות חדשות: דמי ניהול מנכסים" unit="%" metric="pen.fee_a" current={cur.ytd}>{(b) => <Bars title="פנסיה, דמי ניהול מנכסים" metric="pen.fee_a" set="flow3" cos={cos} dec={3} pct unit="%" g="last" agg="in" b={b} />}</Card>
          <Card title="פנסיה, קרנות חדשות: דמי ניהול מהפקדות" unit="%" metric="pen.fee_d" current={cur.ytd}>{(b) => <Bars title="פנסיה, דמי ניהול מהפקדות" metric="pen.fee_d" set="flow3" cos={cos} dec={2} pct unit="%" g="last" agg="in" b={b} />}</Card>
        </>
      ) : (
        <>
          <Card title="גמל: הפקדות שוטפות (נתחים)" unit="%" metric="gem.dep.share" current={cur.ytd} height={240}>{(b) => <Donuts title="גמל, הפקדות שוטפות" share="gem.dep.share" total="gem.dep" set="flow3" cos={cos} b={b} unit="מיליארד" />}</Card>
          <Card title="גמל: הפקדות שוטפות" unit={BN} metric="gem.dep" current={cur.ytd}>{(b) => <Bars title="גמל, הפקדות שוטפות" metric="gem.dep" set="flow3" cos={cos} unit={BN} b={b} />}</Card>
          <Card title="גמל: דמי ניהול מנכסים" unit="%" metric="gem.fee_a" current={cur.ytd}>{(b) => <Bars title="גמל, דמי ניהול מנכסים" metric="gem.fee_a" set="flow3" cos={cos} dec={3} pct unit="%" g="last" agg="in" b={b} />}</Card>
        </>
      )}
      <Card title={`${name}: רווח מפעילות (דמי ניהול בניכוי מכירה ושיווק והנהלה וכלליות)`} unit={MN} metric={`${fam}.op`} current={cur.ytd}>{(b) => <Bars title={`${name}, רווח מפעילות`} metric={`${fam}.op`} set="flow3" cos={cos} unit={MN} sub={`${fam}.aum`} b={b} />}</Card>
      <Card title={`${name}: מרווח גולמי מהנכס המנוהל (דמי ניהול בניכוי מכירה ושיווק)`} unit={PA} metric={`${fam}.gross_m`} current={cur.ytd}>{(b) => <Bars title={`${name}, מרווח גולמי`} metric={`${fam}.gross_m`} set="flow3" cos={cos} dec={fam === 'pen' ? 3 : 2} pct unit="%" agg="in" b={b} />}</Card>
      <Card title={`${name}: מרווח מפעילות (מרווח גולמי בניכוי הנהלה וכלליות)`} unit={PA} metric={`${fam}.op_m`} current={cur.ytd}>{(b) => <Bars title={`${name}, מרווח מפעילות`} metric={`${fam}.op_m`} set="flow3" cos={cos} dec={fam === 'pen' ? 3 : 2} pct unit="%" agg="in" b={b} />}</Card>
      <Card title={`${name}: מרווח גולמי, שנים מלאות`} unit={PA} metric={`${fam}.gross_m`} current={cur.fy}>{(b) => <Bars title={`${name}, מרווח גולמי שנתי`} metric={`${fam}.gross_m`} set="annual3" cos={cos} dec={fam === 'pen' ? 3 : 2} pct unit="%" agg="in" b={b} />}</Card>
      <Card title={`${name}: מרווח גולמי, אותה תקופה בכל שנה`} unit={PA} metric={`${fam}.gross_m`} current={cur.ytd}>{(b) => <Bars title={`${name}, מרווח גולמי לתקופה`} metric={`${fam}.gross_m`} set="same3" cos={cos} dec={fam === 'pen' ? 3 : 2} pct unit="%" agg="in" b={b} />}</Card>
      <Card title={`${name}: הוצאות מכירה ושיווק מדמי הניהול`} unit={PF} metric={`${fam}.sm_fees`} current={cur.ytd}>{(b) => <Bars title={`${name}, מכירה ושיווק מדמי ניהול`} metric={`${fam}.sm_fees`} set="flow3" cos={cos} pct unit="%" agg="in" b={b} />}</Card>
      <Card title={`${name}: הוצאות מכירה ושיווק מהנכס`} unit={PA} metric={`${fam}.sm_aum`} current={cur.ytd}>{(b) => <Bars title={`${name}, מכירה ושיווק מנכס`} metric={`${fam}.sm_aum`} set="flow3" cos={cos} dec={2} pct unit="%" agg="in" b={b} />}</Card>
      <Card title={`${name}: הוצאות הנהלה וכלליות מדמי הניהול`} unit={PF} metric={`${fam}.ga_fees`} current={cur.ytd}>{(b) => <Bars title={`${name}, הנהלה וכלליות מדמי ניהול`} metric={`${fam}.ga_fees`} set="flow3" cos={cos} pct unit="%" agg="in" b={b} />}</Card>
      <Card title={`${name}: הוצאות הנהלה וכלליות מהנכס`} unit={PA} metric={`${fam}.ga_aum`} current={cur.ytd}>{(b) => <Bars title={`${name}, הנהלה וכלליות מנכס`} metric={`${fam}.ga_aum`} set="flow3" cos={cos} dec={2} pct unit="%" agg="in" b={b} />}</Card>
    </>
  );
}

export function IndustrySectors() {
  const { data, error } = useLoad<LtsData>('lts.json');
  const [sp, setSp] = useSearchParams();
  const [focus, setFocus] = useState(sp.get('c') ?? 'phoenix');
  const [all, setAll] = useState<string | null>(sp.get('p'));
  const lts = useMemo(() => (data ? new Lts(data) : null), [data]);
  useEffect(() => {
    if (!lts) return;
    lts.reported().forEach((c) => { void fetch(`${import.meta.env.BASE_URL}data/lts_prov/${c}.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) lts.prov[c] = j; }).catch(() => {}); });
  }, [lts]);
  useEffect(() => { setSp(keepSrc({ ...(focus !== 'phoenix' ? { c: focus } : {}), ...(all ? { p: all } : {}) }), { replace: true }); }, [focus, all, setSp]);
  if (error) return <ErrorBox what="השוואת ענפים" error={error} />;
  if (!lts) return <Loading what="השוואת ענפים" />;
  const bases = lts.bases('am.aum', cur.inst).concat(lts.bases('pen.out_rate', cur.q)).map(baseKey).filter((k, i, a) => a.indexOf(k) === i).sort().reverse();
  const go = (id: string) => document.getElementById(`sx-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <C.Provider value={{ lts, focus, all }}>
      <div className="sx">
        <div className="sx-bar">
          <Field label="חברה במוקד"><select value={focus} onChange={(e) => setFocus(e.target.value)}>{AM.map((c) => <option key={c} value={c}>{lts.name(c)}</option>)}</select></Field>
          <Field label="על בסיס דוח, לכל הגרפים"><select value={all ?? ''} onChange={(e) => setAll(e.target.value || null)}><option value="">האחרון בכל גרף</option>{bases.map((k) => <option key={k} value={k}>{baseLabel(parseBase(k))}</option>)}</select></Field>
          <nav aria-label="פרקים">{SECTIONS.map(([id, name]) => <button key={id} type="button" className="chip" onClick={() => go(id)}>{name}</button>)}</nav>
        </div>

        <h2 className="band" id="sx-sum">תמצית<span className="muted">{lts.name(focus)} · {lts.d.source}</span></h2>
        <Summary />

        <h2 className="band" id="sx-am">ניהול נכסים<span className="muted">פנסיה, גמל וחוזי השקעה</span></h2>
        <Card title="ניהול נכסים: מגמות בנכס המנוהל" unit={BN} metric="am.aum" current={cur.inst} height={320}>{(b) => <Bars title="נכס מנוהל" metric="am.aum" set="inst4" cos={AM} unit={BN} g="last" agg="own" b={b} height={320} />}</Card>
        <Card title="ניהול נכסים: מגמות בתמהיל" unit={BN} metric="am.mix.pen" current={cur.inst} height={320}>{(b) => <Mix b={b} />}</Card>
        <Card title="ניהול נכסים: סך הכנסות מדמי ניהול" unit={MN} metric="am.fees" current={cur.ytd}>{(b) => <Bars title="הכנסות מדמי ניהול" metric="am.fees" set="flow3" cos={AM} unit={MN} g={[1, 0]} b={b} />}</Card>
        <Card title="ניהול נכסים: רווח גולמי" unit={MN} metric="am.gross" current={cur.ytd}>{(b) => <Bars title="רווח גולמי" metric="am.gross" set="flow3" cos={AM} unit={MN} g={[1, 0]} b={b} />}</Card>
        <Card title="ניהול נכסים: רווח תפעולי" unit={MN} metric="am.op" current={cur.ytd}>{(b) => <Bars title="רווח תפעולי" metric="am.op" set="flow3" cos={AM} unit={MN} g={[1, 0]} b={b} />}</Card>
        <Card title="ניהול נכסים: שיעור הכנסות" unit={PA} metric="am.rev_rate" current={cur.ytd}>{(b) => <Bars title="שיעור הכנסות" metric="am.rev_rate" set="flow3" cos={AM} dec={2} pct unit="%" b={b} />}</Card>
        <Card title="ניהול נכסים: מרווח גולמי" unit={PA} metric="am.gross_m" current={cur.ytd}>{(b) => <Bars title="מרווח גולמי" metric="am.gross_m" set="flow3" cos={AM} dec={2} pct unit="%" b={b} />}</Card>
        <Card title="ניהול נכסים: מרווח תפעולי" unit={PA} metric="am.op_m" current={cur.ytd}>{(b) => <Bars title="מרווח תפעולי" metric="am.op_m" set="flow3" cos={AM} dec={2} pct unit="%" b={b} />}</Card>

        <h2 className="band" id="sx-ic">פוליסות השקעה<span className="muted">חוזי השקעה, חברות הביטוח</span></h2>
        <Card title="פוליסות השקעה: סך הכסף שנכנס" unit={BN} metric="ic.dep" current={cur.q} height={280}>{(b) => <ShareBars title="פוליסות השקעה, הפקדות" metric="ic.dep" share="ic.dep.share" periods={periodsOf('q6', b)} unit={MN} />}</Card>
        <Card title="פוליסות השקעה: הפקדות לפי חברה" unit={MN} metric="ic.dep" current={cur.q} height={320}>{(b) => <IcTable title="פוליסות השקעה, הפקדות" metric="ic.dep" periods={[`FY${b.q === 4 ? b.y : b.y - 1}`, quarter(b, 1), quarter(b)]} withShare />}</Card>
        <Card title="פוליסות השקעה: נכס מנוהל" unit={BN} metric="ic.aum" current={cur.inst} height={280}>{(b) => <ShareBars title="פוליסות השקעה, נכס מנוהל" metric="ic.aum" share="ic.aum.share" periods={periodsOf('inst4', b)} unit={MN} />}</Card>
        <Card title="פוליסות השקעה: נכס מנוהל לפי חברה" unit={MN} metric="ic.aum" current={cur.inst} height={320}>{(b) => <IcTable title="פוליסות השקעה, נכס מנוהל" metric="ic.aum" periods={periodsOf('inst3', b)} growth />}</Card>

        <h2 className="band" id="sx-pen">פנסיה<span className="muted">8 חברות מנהלות</span></h2>
        <Family fam="pen" cos={PEN} name="פנסיה" />

        <h2 className="band" id="sx-gem">גמל<span className="muted">10 חברות מנהלות</span></h2>
        <Family fam="gem" cos={GEM} name="גמל" />
      </div>
    </C.Provider>
  );
}
