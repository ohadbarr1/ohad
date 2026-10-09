import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { CHART_FONT, chartBase, palette } from '../lib/theme';
import { nf, pct, sn } from '../lib/format';
import type { Market, MetricKey, Win } from '../lib/market';
import { useMarket } from '../lib/useData';

export function IndustryLayout() {
  return (
    <>
      <div className="pagehead"><div><h1>השוואה ענפית</h1></div></div>
      <nav className="subnav" aria-label="השוואה ענפית">
        <NavLink to="savings">חיסכון ארוך טווח</NavLink>
        <NavLink to="ifrs">IFRS 17 · CSM</NavLink>
        <NavLink to="capital">הון ודיבידנד</NavLink>
        <NavLink to="headline">מדדי כותרת</NavLink>
      </nav>
      <Outlet />
    </>
  );
}

type Tab = 'all' | 'fam:pension' | 'fam:gemel' | 'fam:insurance';
const TABS: [Tab, string][] = [['all', 'ניהול נכסים'], ['fam:pension', 'פנסיה'], ['fam:gemel', 'גמל'], ['fam:insurance', 'פוליסות חיסכון']];
const short = (g: string) => g.replace('מנורה מבטחים', 'מנורה').replace('אלטשולר שחם', 'אלטשולר').replace('ילין לפידות', 'ילין').replace('ביטוח ישיר', 'ישיר');

/** The quarterly peer deck: every chart is one metric, companies side by side, at the period the user picks. */
export function IndustrySavings() {
  const { market: m, error } = useMarket();
  if (error) return <ErrorBox what="נתוני השוק" error={error} />;
  if (!m) return <Loading what="השוואה ענפית" />;
  return <Deck m={m} />;
}

function Deck({ m }: { m: Market }) {
  const [sp, setSp] = useSearchParams();
  const ends = useMemo(() => m.P.map((p, i) => ({ p, i })).filter(({ p, i }) => (p % 100) % 3 === 0 && p >= 201812 || i === m.LAST).reverse(), [m]);
  const [pi, setPi] = useState(() => { const want = Number(sp.get('p')); return ends.find((e) => e.p === want)?.i ?? ends.find((e) => (e.p % 100) % 3 === 0)?.i ?? m.LAST; });
  const [tab, setTab] = useState<Tab>((TABS.find(([t]) => t === sp.get('t'))?.[0]) ?? 'all');
  const [lead, setLead] = useState(sp.get('c') ?? 'הפניקס');
  const [n, setN] = useState(13);
  useEffect(() => { setSp({ p: String(m.P[pi]), t: tab, c: lead }, { replace: true }); }, [pi, tab, lead, m, setSp]);

  const y = Math.floor(m.P[pi] / 100), mo = m.P[pi] % 100;
  const decs = [3, 2, 1].map((k) => m.P.indexOf((y - k + (mo === 12 ? 1 : 0)) * 100 + 12)).filter((i) => i >= 0 && i < pi);
  const pts = [...decs, pi];
  const plab = (i: number) => (m.P[i] % 100 === 12 ? String(Math.floor(m.P[i] / 100)) : `${m.P[i] % 100 === 6 ? '1H' : m.P[i] % 100 === 3 ? 'Q1 ' : m.P[i] % 100 === 9 ? '9M ' : ''}${Math.floor(m.P[i] / 100)}`);
  const groups = useMemo(() => m.activeGroups(pi, tab).sort((a, b) => m.cell(pi, tab, b).a - m.cell(pi, tab, a).a).slice(0, n), [m, pi, tab, n]);
  const names = groups.map((g) => m.d.groups[g]);
  const hasFlows = tab !== 'fam:insurance' && tab !== 'all';
  const ytdBase = decs[decs.length - 1];

  const base = () => {
    const b = chartBase();
    return { b, common: { animationDuration: 650, animationEasing: 'cubicOut' as const, textStyle: { fontFamily: CHART_FONT, color: b.fg },
      tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const }, confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 } } } };
  };
  const xAxis = (b: ReturnType<typeof chartBase>, extra: (g: number) => string | null) => ({
    type: 'category' as const, data: [...names.map(short), 'סך השוק'], axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } },
    axisLabel: { color: b.fg, fontSize: 11.5, interval: 0, hideOverlap: false, rotate: window.innerWidth < 760 ? 50 : 0,
      formatter: (v: string, i: number) => { const e = extra(i < groups.length ? groups[i] : -1); return e ? `${v}\n{${e.startsWith('+') ? 'u' : 'd'}|${e}}` : v; },
      rich: { u: { color: b.up, fontSize: 10.5, padding: [3, 0, 0, 0] }, d: { color: b.down, fontSize: 10.5, padding: [3, 0, 0, 0] } } },
  });
  const tone = (g: number, i: number, k: number, pal: string[], b: ReturnType<typeof chartBase>) => (g >= 0 && m.d.groups[g] === lead ? [0.45, 0.65, 0.85, 1][4 - pts.length + k] : 1) && (i >= 0 ? (g >= 0 && m.d.groups[g] === lead ? b.accent : pal[7]) : pal[7]);
  const opacity = (k: number) => [0.4, 0.6, 0.8, 1][4 - pts.length + k];

  const trend = (key: MetricKey, dec: number, growth: boolean) => () => {
    const { b, common } = base(), pal = palette();
    const val = (i: number, g: number) => { const v = m.value(key, i, 'm', tab, g); return v == null ? null : +v.toFixed(dec + 1); };
    const all = [...groups, -1];
    return { ...common, grid: { left: 4, right: 4, top: 26, bottom: 4, containLabel: true }, legend: { top: 0, textStyle: { color: b.mu, fontSize: 11 }, itemWidth: 10, itemHeight: 10, icon: 'roundRect' },
      xAxis: xAxis(b, (g) => { if (!growth || ytdBase == null) return null; const a = m.cell(ytdBase, tab, g).a, c = m.cell(pi, tab, g).a; return a > 0 ? `${sn((c / a - 1) * 100, 1)}%` : null; }),
      yAxis: [{ type: 'value', show: false }, { type: 'value', show: false }],
      series: pts.map((i, k) => ({ name: plab(i), type: 'bar', barGap: '8%', barCategoryGap: '18%', yAxisIndex: 0,
        data: all.map((g) => (g === -1 && key === 'assets' ? null : { value: val(i, g), itemStyle: { color: tone(g, i, k, pal, b), opacity: opacity(k), borderRadius: [2, 2, 0, 0] } })),
        label: { show: k === pts.length - 1 && window.innerWidth >= 760, position: 'top', color: b.fg, fontSize: 10.5, formatter: (p: { value: number | null }) => (p.value == null ? '' : nf(p.value, dec)) }, itemStyle: { color: pal[7], opacity: opacity(k) } })),
    };
  };
  const mix = () => {
    const { b, common } = base(), pal = palette();
    const fams: [string, string, number][] = [['fam:pension', 'פנסיה', 4], ['fam:gemel', 'גמל', 7], ['fam:insurance', 'פוליסות חיסכון', 0]];
    return { ...common, grid: { left: 4, right: 4, top: 26, bottom: 4, containLabel: true }, legend: { top: 0, textStyle: { color: b.mu, fontSize: 11 }, itemWidth: 10, itemHeight: 10, icon: 'roundRect' },
      tooltip: { ...common.tooltip, valueFormatter: (v: number) => `${nf(v, 0)}%` }, xAxis: xAxis(b, (g) => { const t = m.cell(pi, 'all', g).a; return t ? `+${nf(t / 1000, 0)}` : null; }),
      yAxis: { type: 'value', max: 100, show: false },
      series: fams.map(([s, name, c]) => ({ name, type: 'bar', stack: 'a', barCategoryGap: '30%', itemStyle: { color: pal[c], opacity: 0.9 },
        data: [...groups, -1].map((g) => { const t = m.cell(pi, 'all', g).a; return t ? +(m.cell(pi, s, g).a / t * 100).toFixed(1) : null; }),
        label: { show: window.innerWidth >= 760, color: '#fff', fontSize: 10, formatter: (p: { value: number }) => (p.value >= 9 ? `${nf(p.value, 0)}%` : '') } })) };
  };
  const flow = (key: MetricKey, wins: [Win, number, string][], dec = 1) => () => {
    const { b, common } = base(), pal = palette();
    return { ...common, grid: { left: 4, right: 4, top: 26, bottom: 4, containLabel: true }, legend: { top: 0, textStyle: { color: b.mu, fontSize: 11 }, itemWidth: 10, itemHeight: 10, icon: 'roundRect' },
      xAxis: { ...xAxis(b, () => null), data: names.map(short) }, yAxis: { type: 'value', axisLabel: { color: b.mu, fontSize: 10 }, splitLine: { lineStyle: { color: b.ln, opacity: 0.5 } } },
      series: wins.map(([w, i, name], k) => ({ name, type: 'bar', barGap: '8%',
        data: groups.map((g) => { const v = i >= 0 ? m.value(key, i, w, tab, g) : null; return v == null ? null : { value: +v.toFixed(dec + 1), itemStyle: { color: m.d.groups[g] === lead ? b.accent : v < 0 ? b.down : pal[k === wins.length - 1 ? 1 : 7], opacity: k === wins.length - 1 ? 1 : 0.55, borderRadius: v < 0 ? [0, 0, 2, 2] : [2, 2, 0, 0] } }; }),
        itemStyle: { color: pal[k === wins.length - 1 ? 1 : 7], opacity: k === wins.length - 1 ? 1 : 0.55 },
        label: { show: k === wins.length - 1 && window.innerWidth >= 760, position: 'top', color: b.fg, fontSize: 10.5, formatter: (p: { value: number | null }) => (p.value == null ? '' : nf(p.value, dec)) } })) };
  };
  const deps = [pi, tab, lead, n, m];
  const qLabel = `Q${mo / 3 || ''}`.replace('Q0', '') || 'רבעון';
  const prevQ = pi - 3;
  const tabLabel = TABS.find(([t]) => t === tab)![1];

  return (
    <>
      <section className="controls">
        <Field label="תקופה"><select value={pi} onChange={(e) => setPi(Number(e.target.value))}>{ends.map(({ p, i }) => <option key={i} value={i}>{m.plabel(i)}{(p % 100) % 3 !== 0 ? ' (חודש אחרון)' : ''}</option>)}</select></Field>
        <div className="field"><span>פעילות</span><Seg<Tab> label="פעילות" value={tab} onChange={setTab} options={TABS} /></div>
        <Field label="חברה מודגשת"><select value={lead} onChange={(e) => setLead(e.target.value)}>{m.activeGroups(pi, 'all').map((g) => m.d.groups[g]).sort((a, b) => a.localeCompare(b, 'he')).map((g) => <option key={g}>{g}</option>)}</select></Field>
        <Field label="חברות"><select value={n} onChange={(e) => setN(Number(e.target.value))}>{[8, 10, 13, 16, 20].map((x) => <option key={x} value={x}>{x} הגדולות</option>)}</select></Field>
      </section>

      <Panel title={`${tabLabel}: מגמות בנכס מנוהל`} aside={<span>מיליארדי ש"ח · השינוי מתחת לשם: מתחילת השנה</span>}>
        <Chart label="נכס מנוהל" height={330} deps={deps} build={trend('assets', 0, true)} />
        <div className="src">סך השוק ל-{m.plabel(pi)}: <span className="num">{nf(m.cell(pi, tab, -1).a / 1000, 0)}</span> מיליארד ש"ח{ytdBase != null && <> · <span className="num">{pct((m.cell(pi, tab, -1).a / m.cell(ytdBase, tab, -1).a - 1) * 100, 1, true)}</span> מתחילת השנה</>}</div>
      </Panel>
      <div className="grid2">
        <Panel title={`${tabLabel}: נתח שוק`} aside={<span>% מנכסי הענף</span>}><Chart label="נתח שוק" height={270} deps={deps} build={trend('share', 1, false)} /></Panel>
        {tab === 'all'
          ? <Panel title="תמהיל הנכס המנוהל" aside={<span>% · מתחת לשם: סך הנכסים, מיליארדי ש"ח</span>}><Chart label="תמהיל" height={270} deps={deps} build={mix} /></Panel>
          : <Panel title={`${tabLabel}: שיעור דמי ניהול מנכסים`} aside={<span>%, משוקלל בנכסים</span>}><Chart label="דמי ניהול" height={270} deps={deps} build={trend('fee', 2, false)} /></Panel>}
      </div>
      {hasFlows && (
        <>
          <div className="grid2">
            <Panel title={`${tabLabel}: ניוד נטו`} aside={<span>מיליארדי ש"ח</span>}>
              <Chart label="ניוד נטו" height={270} deps={deps} build={flow('transfers', [['ytd', pi - 12, `1-${mo}/${y - 1}`], ['ytd', pi, `1-${mo}/${y}`]])} />
            </Panel>
            <Panel title={`${tabLabel}: ניוד נטו לפי רבעונים`} aside={<span>מיליארדי ש"ח</span>}>
              <Chart label="ניוד רבעוני" height={270} deps={deps} build={flow('transfers', [['q', prevQ, m.plabel(prevQ)], ['q', pi, m.plabel(pi)]])} />
            </Panel>
          </div>
          <div className="grid2">
            <Panel title={`${tabLabel}: צבירה אורגנית (הפקדות פחות משיכות)`} aside={<span>מיליארדי ש"ח</span>}>
              <Chart label="צבירה אורגנית" height={270} deps={deps} build={flow('organic', [['ytd', pi - 12, `1-${mo}/${y - 1}`], ['ytd', pi, `1-${mo}/${y}`]])} />
            </Panel>
            <Panel title={`${tabLabel}: צבירה נטו כ-% מנכסי הפתיחה`} aside={<span>%, מתחילת השנה</span>}>
              <Chart label="צבירה מנכסים" height={270} deps={deps} build={flow('rate', [['ytd', pi - 12, `1-${mo}/${y - 1}`], ['ytd', pi, `1-${mo}/${y}`]])} />
            </Panel>
          </div>
        </>
      )}
      <Panel title={`${tabLabel}: טבלה, ${m.plabel(pi)}`} aside={<span>מקור: רשות שוק ההון · {qLabel}</span>}>
        <div className="scroll"><table>
          <thead><tr><th>חברה</th><th>נכסים, מיליארד</th><th>נתח שוק</th><th>מתחילת השנה</th><th>12 חודשים</th>{hasFlows && <><th>ניוד נטו, רבעון</th><th>ניוד נטו, מתחילת השנה</th><th>צבירה אורגנית, מתחילת השנה</th></>}{tab !== 'all' && <th>דמי ניהול</th>}<th>תשואה, 12 ח׳</th></tr></thead>
          <tbody>{[...groups, -1].map((g) => {
            const v = (k: MetricKey, w: Win) => m.value(k, pi, w, tab, g), c = (x: number | null) => (x == null ? '' : x > 0 ? 'pos' : x < 0 ? 'neg' : '');
            const f = (x: number | null, d = 1) => (x == null ? '–' : nf(x, d));
            return (
              <tr key={g} className={g === -1 ? 'tot' : m.d.groups[g] === lead ? 'lead' : ''}>
                <td>{g === -1 ? 'סך השוק' : m.d.groups[g]}</td><td><span className="num">{f(v('assets', 'm'))}</span></td><td><span className="num">{g === -1 ? '100%' : pct(v('share', 'm'), 1)}</span></td>
                <td><span className={`num ${c(v('growth', 'ytd'))}`}>{pct(v('growth', 'ytd'), 1, true)}</span></td><td><span className={`num ${c(v('growth', 'ltm'))}`}>{pct(v('growth', 'ltm'), 1, true)}</span></td>
                {hasFlows && <><td><span className={`num ${c(v('transfers', 'q'))}`}>{f(v('transfers', 'q'), 2)}</span></td><td><span className={`num ${c(v('transfers', 'ytd'))}`}>{f(v('transfers', 'ytd'), 2)}</span></td><td><span className={`num ${c(v('organic', 'ytd'))}`}>{f(v('organic', 'ytd'), 2)}</span></td></>}
                {tab !== 'all' && <td><span className="num">{pct(v('fee', 'm'), 2)}</span></td>}<td><span className="num">{pct(v('ret', 'ltm'), 1)}</span></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <div className="src">ניוד נכנס ויוצא בנפרד, פרמיה משונתת, ורווחיות החברות המנהלות (דמי ניהול בש"ח, רווח גולמי ותפעולי, הוצאות שיווק והנהלה) אינם בנתוני הרשות; הם יתווספו מדוחות החברות המנהלות.</div>
      </Panel>
    </>
  );
}
