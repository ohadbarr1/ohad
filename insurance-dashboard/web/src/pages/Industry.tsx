import { foxPeers } from '../lib/foxchart';
import { keepSrc } from '../lib/prov';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { BreakChip, ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { palette } from '../lib/theme';
import { nf, pct, sn } from '../lib/format';
import type { Market, MetricKey, Win } from '../lib/market';
import { useMarket } from '../lib/useData';
import { Sourced } from '../components/Source';
import { useSource, type Prov } from '../lib/prov';
import '../styles/prov-kpi.css';

export function IndustryLayout() {
  return (
    <>
      <div className="pagehead"><div><h1>השוואה ענפית</h1></div></div>
      <nav className="subnav" aria-label="השוואה ענפית">
        <NavLink to="peers">טבלת עמיתים</NavLink>
        <NavLink to="csm">IFRS 17 · CSM · הון</NavLink>
        <NavLink to="savings">חיסכון ארוך טווח</NavLink>
      </nav>
      <Outlet />
    </>
  );
}

type Tab = 'all' | 'fam:pension' | 'fam:gemel' | 'fam:insurance';
const TABS: [Tab, string][] = [['all', 'ניהול נכסים'], ['fam:pension', 'פנסיה'], ['fam:gemel', 'גמל'], ['fam:insurance', 'ביטוח: מנהלים וחיסכון']];
const short = (g: string) => g.replace('מנורה מבטחים', 'מנורה').replace('אלטשולר שחם', 'אלטשולר').replace('ילין לפידות', 'ילין').replace('ביטוח ישיר', 'ישיר');

/** The quarterly peer deck: every chart is one metric, companies side by side, at the period the user picks. */
export function IndustrySavings() {
  const { market: m, error } = useMarket();
  if (error) return <ErrorBox what="נתוני השוק" error={error} />;
  if (!m) return <Loading what="השוואה ענפית" />;
  return <Deck m={m} />;
}

function Deck({ m }: { m: Market }) {
  const { open } = useSource();
  const [sp, setSp] = useSearchParams();
  const ends = useMemo(() => m.P.map((p, i) => ({ p, i })).filter(({ p, i }) => (p % 100) % 3 === 0 && p >= 201812 || i === m.LAST).reverse(), [m]);
  const [pi, setPi] = useState(() => { const want = Number(sp.get('p')); return ends.find((e) => e.p === want)?.i ?? ends.find((e) => (e.p % 100) % 3 === 0)?.i ?? m.LAST; });
  const [tab, setTab] = useState<Tab>((TABS.find(([t]) => t === sp.get('t'))?.[0]) ?? 'all');
  const [lead, setLead] = useState(sp.get('c') ?? 'הפניקס');
  const [n, setN] = useState(13);
  useEffect(() => { setSp(keepSrc({ p: String(m.P[pi]), t: tab, c: lead }), { replace: true }); }, [pi, tab, lead, m, setSp]);

  const y = Math.floor(m.P[pi] / 100), mo = m.P[pi] % 100;
  const decs = [3, 2, 1].map((k) => m.P.indexOf((y - k + (mo === 12 ? 1 : 0)) * 100 + 12)).filter((i) => i >= 0 && i < pi);
  const pts = [...decs, pi];
  const plab = (i: number) => (m.P[i] % 100 === 12 ? String(Math.floor(m.P[i] / 100)) : `${m.P[i] % 100 === 6 ? '1H' : m.P[i] % 100 === 3 ? 'Q1 ' : m.P[i] % 100 === 9 ? '9M ' : ''}${Math.floor(m.P[i] / 100)}`);
  const groups = useMemo(() => m.activeGroups(pi, tab).sort((a, b) => m.cell(pi, tab, b).a - m.cell(pi, tab, a).a).slice(0, n), [m, pi, tab, n]);
  const names = groups.map((g) => m.d.groups[g]);
  const hasFlows = tab !== 'fam:insurance' && tab !== 'all';
  const ytdBase = decs[decs.length - 1];

  // the companies of the deck, the one in focus, and (where it adds up) the market as a last column
  const leadAt = groups.findIndex((g) => m.d.groups[g] === lead);
  const strength = (k: number) => [0.4, 0.6, 0.8, 1][4 - pts.length + k];
  const trend = (key: MetricKey, dec: number, growth: boolean) => () => {
    const val = (i: number, g: number) => { const v = m.value(key, i, 'm', tab, g); return v == null ? null : +v.toFixed(dec + 1); };
    const all = [...groups, -1];
    const sub = !growth || ytdBase == null ? undefined : all.map((g) => { const a = m.cell(ytdBase, tab, g).a, c = m.cell(pi, tab, g).a; return a > 0 ? `${sn((c / a - 1) * 100, 1)}%` : null; });
    return foxPeers({ cats: [...names.map(short), 'סך השוק'], sub, lead: leadAt, dec, pct: key !== 'assets',
      series: pts.map((i, k) => ({ name: plab(i), strength: strength(k), data: all.map((g) => (g === -1 && key === 'assets' ? null : val(i, g))) })) });
  };
  const mix = () => {
    const pal = palette();
    const fams: [string, string, number][] = [['fam:pension', 'פנסיה', 4], ['fam:gemel', 'גמל', 7], ['fam:insurance', 'ביטוח: מנהלים וחיסכון', 0]];
    const all = [...groups, -1];
    return foxPeers({ cats: [...names.map(short), 'סך השוק'], sub: all.map((g) => { const t = m.cell(pi, 'all', g).a; return t ? `+${nf(t / 1000, 0)}` : null; }), stack: true, pct: true, max: 100, dec: 0,
      series: fams.map(([s, name, c]) => ({ name, color: pal[c], data: all.map((g) => { const t = m.cell(pi, 'all', g).a; return t ? +(m.cell(pi, s, g).a / t * 100).toFixed(1) : null; }) })) });
  };
  const flow = (key: MetricKey, wins: [Win, number, string][], dec = 1) => () => {
    const pal = palette();
    return foxPeers({ cats: names.map(short), lead: leadAt, dec, axis: true, signed: true, pct: key === 'rate',
      series: wins.map(([w, i, name], k) => ({ name, color: pal[k === wins.length - 1 ? 1 : 7], strength: k === wins.length - 1 ? 1 : 0.55,
        data: groups.map((g) => { const v = i >= 0 ? m.value(key, i, w, tab, g) : null; return v == null ? null : +v.toFixed(dec + 1); }) })) });
  };
  // a click on a bar opens the figure it draws; on a phone only the latest period is drawn, so series 0 is the last one
  const narrow = () => typeof window !== 'undefined' && window.innerWidth < 760;
  const prevQ = pi - 3;
  const YTD2: [Win, number, string][] = [['ytd', pi - 12, `1-${mo}/${y - 1}`], ['ytd', pi, `1-${mo}/${y}`]], QQ: [Win, number, string][] = [['q', prevQ, m.plabel(prevQ)], ['q', pi, m.plabel(pi)]];
  const trendPt = (key: MetricKey) => (si: number, di: number) => { const g = di < groups.length ? groups[di] : -1; if (g === -1 && key === 'assets') return; open(m.explain(key, pts[narrow() ? pts.length - 1 : si], 'm', tab, g)); };
  const flowPt = (key: MetricKey, wins: [Win, number, string][]) => (si: number, di: number) => { const [w, i] = wins[narrow() ? wins.length - 1 : si]; if (i >= 0 && groups[di] != null) open(m.explain(key, i, w, tab, groups[di])); };
  const FAMS: [string, string][] = [['fam:pension', 'פנסיה'], ['fam:gemel', 'גמל'], ['fam:insurance', 'ביטוח: מנהלים וחיסכון']];
  const mixPt = (si: number, di: number) => {
    const g = di < groups.length ? groups[di] : -1, [set, name] = FAMS[si] ?? FAMS[0], who = g === -1 ? 'כלל השוק' : m.d.groups[g];
    const part = m.cell(pi, set, g).a, all = m.cell(pi, 'all', g).a, f = (x: number) => nf(x / 1000, 1);
    open({ k: 'calc', title: `תמהיל נכסים · ${who} · ${name} · ${m.plabel(pi)}`, value: all ? nf(part / all * 100, 1) : '–', unit: '%', formula: 'נתח המוצר = נכסי המוצר ÷ סך הנכסים המנוהלים של החברה × 100',
      inputs: [{ label: `נכסים, ${name}`, v: f(part), src: () => m.explain('assets', pi, 'm', set, g) }, { label: 'סך הנכסים המנוהלים', v: f(all), src: () => m.explain('assets', pi, 'm', 'all', g) }] } satisfies Prov);
  };
  const deps = [pi, tab, lead, n, m];
  const qLabel = `Q${mo / 3 || ''}`.replace('Q0', '') || 'רבעון';
  const tabLabel = TABS.find(([t]) => t === tab)![1];

  return (
    <>
      <section className="controls">
        <Field label="תקופה"><select value={pi} onChange={(e) => setPi(Number(e.target.value))}>{ends.map(({ p, i }) => <option key={i} value={i}>{m.plabel(i)}{(p % 100) % 3 !== 0 ? ' (חודש אחרון)' : ''}</option>)}</select></Field>
        <div className="field"><span>פעילות</span><Seg<Tab> label="פעילות" value={tab} onChange={setTab} options={TABS} /></div>
        <Field label="חברה מודגשת"><select value={lead} onChange={(e) => setLead(e.target.value)}>{m.activeGroups(pi, 'all').map((g) => m.d.groups[g]).sort((a, b) => a.localeCompare(b, 'he')).map((g) => <option key={g}>{g}</option>)}</select></Field>
        <Field label="חברות"><select value={n} onChange={(e) => setN(Number(e.target.value))}>{[8, 10, 13, 16, 20].map((x) => <option key={x} value={x}>{x} הגדולות</option>)}</select></Field>
      </section>

      <Panel title={`${tabLabel}: מגמות בנכס מנוהל`} aside={<span>מיליארדי ש"ח · השינוי מתחת לשם: YTD</span>}>
        <Chart label="נכס מנוהל" height={330} deps={deps} build={trend('assets', 0, true)} onPoint={trendPt('assets')} />
        <div className="src">סך השוק ל-{m.plabel(pi)}: <Sourced src={() => m.explain('assets', pi, 'm', tab, -1)}><span className="num">{nf(m.cell(pi, tab, -1).a / 1000, 0)}</span></Sourced> מיליארד ש"ח{ytdBase != null && <> · <Sourced src={() => m.explain('growth', pi, 'ytd', tab, -1)}><span className="num">{pct((m.cell(pi, tab, -1).a / m.cell(ytdBase, tab, -1).a - 1) * 100, 1, true)}</span></Sourced> YTD</>}</div>
      </Panel>
      <div className="grid2">
        <Panel title={`${tabLabel}: נתח שוק`} aside={<span>% מנכסי הענף</span>}><Chart label="נתח שוק" height={270} deps={deps} build={trend('share', 1, false)} onPoint={trendPt('share')} /></Panel>
        {tab === 'all'
          ? <Panel title="תמהיל הנכס המנוהל" aside={<span>% · מתחת לשם: סך הנכסים, מיליארדי ש"ח</span>}><Chart label="תמהיל" height={270} deps={deps} build={mix} onPoint={mixPt} /></Panel>
          : <Panel title={`${tabLabel}: שיעור דמי ניהול מנכסים`} aside={<><span>%, משוקלל בנכסים</span> <BreakChip b={m.breaksFor('fee', tab)[0]} /></>}><Chart label="דמי ניהול" height={270} deps={deps} build={trend('fee', 2, false)} onPoint={trendPt('fee')} /></Panel>}
      </div>
      {hasFlows && (
        <>
          <div className="grid2">
            <Panel title={`${tabLabel}: ניוד נטו`} aside={<span>מיליארדי ש"ח</span>}>
              <Chart label="ניוד נטו" height={270} deps={deps} build={flow('transfers', YTD2)} onPoint={flowPt('transfers', YTD2)} />
            </Panel>
            <Panel title={`${tabLabel}: ניוד נטו לפי רבעונים`} aside={<span>מיליארדי ש"ח</span>}>
              <Chart label="ניוד נטו, QoQ" height={270} deps={deps} build={flow('transfers', QQ)} onPoint={flowPt('transfers', QQ)} />
            </Panel>
          </div>
          <div className="grid2">
            <Panel title={`${tabLabel}: צבירה אורגנית (הפקדות פחות משיכות)`} aside={<span>מיליארדי ש"ח</span>}>
              <Chart label="צבירה אורגנית" height={270} deps={deps} build={flow('organic', YTD2)} onPoint={flowPt('organic', YTD2)} />
            </Panel>
            <Panel title={`${tabLabel}: צבירה נטו כ-% מנכסי הפתיחה`} aside={<span>%, YTD</span>}>
              <Chart label="צבירה מנכסים" height={270} deps={deps} build={flow('rate', YTD2)} onPoint={flowPt('rate', YTD2)} />
            </Panel>
          </div>
        </>
      )}
      <Panel title={`${tabLabel}: טבלה, ${m.plabel(pi)}`} aside={<span>מקור: רשות שוק ההון · {qLabel}</span>}>
        <div className="scroll"><table>
          <thead><tr><th>חברה</th><th>נכסים, מיליארד</th><th>נתח שוק</th><th>YTD</th><th>LTM</th>{hasFlows && <><th>ניוד נטו, QTD</th><th>ניוד נטו, YTD</th><th>צבירה אורגנית, YTD</th></>}{tab !== 'all' && <th>דמי ניהול</th>}<th>תשואה, LTM</th></tr></thead>
          <tbody>{[...groups, -1].map((g) => {
            const v = (k: MetricKey, w: Win) => m.value(k, pi, w, tab, g), S = (k: MetricKey, w: Win, node: ReactNode) => (v(k, w) == null ? node : <Sourced src={() => m.explain(k, pi, w, tab, g)}>{node}</Sourced>), c = (x: number | null) => (x == null ? '' : x > 0 ? 'pos' : x < 0 ? 'neg' : '');
            const f = (x: number | null, d = 1) => (x == null ? '–' : nf(x, d));
            return (
              <tr key={g} className={g === -1 ? 'tot' : m.d.groups[g] === lead ? 'lead' : ''}>
                <td>{g === -1 ? 'סך השוק' : m.d.groups[g]}</td><td>{S('assets', 'm', <span className="num">{f(v('assets', 'm'))}</span>)}</td><td>{g === -1 ? <span className="num">100%</span> : S('share', 'm', <span className="num">{pct(v('share', 'm'), 1)}</span>)}</td>
                <td>{S('growth', 'ytd', <span className={`num ${c(v('growth', 'ytd'))}`}>{pct(v('growth', 'ytd'), 1, true)}</span>)}</td><td>{S('growth', 'ltm', <span className={`num ${c(v('growth', 'ltm'))}`}>{pct(v('growth', 'ltm'), 1, true)}</span>)}</td>
                {hasFlows && <><td>{S('transfers', 'q', <span className={`num ${c(v('transfers', 'q'))}`}>{f(v('transfers', 'q'), 2)}</span>)}</td><td>{S('transfers', 'ytd', <span className={`num ${c(v('transfers', 'ytd'))}`}>{f(v('transfers', 'ytd'), 2)}</span>)}</td><td>{S('organic', 'ytd', <span className={`num ${c(v('organic', 'ytd'))}`}>{f(v('organic', 'ytd'), 2)}</span>)}</td></>}
                {tab !== 'all' && <td>{S('fee', 'm', <span className="num">{pct(v('fee', 'm'), 2)}</span>)}</td>}<td>{S('ret', 'ltm', <span className="num">{pct(v('ret', 'ltm'), 1)}</span>)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <div className="src">ניוד נכנס ויוצא בנפרד, פרמיה משונתת, ורווחיות החברות המנהלות (דמי ניהול בש"ח, רווח גולמי ותפעולי, הוצאות שיווק והנהלה) אינם בנתוני הרשות; הם יתווספו מדוחות החברות המנהלות.</div>
      </Panel>
    </>
  );
}
