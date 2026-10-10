import { foxPeers } from '../lib/foxchart';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { palette } from '../lib/theme';
import { nf, pct, sn } from '../lib/format';
import type { Market, MetricKey, Win } from '../lib/market';
import { useMarket } from '../lib/useData';

export function IndustryLayout() {
  return (
    <>
      <div className="pagehead"><div><h1>השוואה ענפית</h1></div></div>
      <nav className="subnav" aria-label="השוואה ענפית">
        <NavLink to="matrix">מטריצת עמיתים</NavLink>
        <NavLink to="ifrs">IFRS 17 · CSM</NavLink>
        <NavLink to="capital">הון ודיבידנד</NavLink>
        <NavLink to="econ">רווחיות פנסיה וגמל</NavLink>
        <NavLink to="savings">נכסים מנוהלים</NavLink>
        <NavLink to="headline">לאורך זמן</NavLink>
        <NavLink to="search">חיפוש בדוחות</NavLink>
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

      <Panel title={`${tabLabel}: מגמות בנכס מנוהל`} aside={<span>מיליארדי ש"ח · השינוי מתחת לשם: YTD</span>}>
        <Chart label="נכס מנוהל" height={330} deps={deps} build={trend('assets', 0, true)} />
        <div className="src">סך השוק ל-{m.plabel(pi)}: <span className="num">{nf(m.cell(pi, tab, -1).a / 1000, 0)}</span> מיליארד ש"ח{ytdBase != null && <> · <span className="num">{pct((m.cell(pi, tab, -1).a / m.cell(ytdBase, tab, -1).a - 1) * 100, 1, true)}</span> YTD</>}</div>
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
              <Chart label="ניוד נטו, QoQ" height={270} deps={deps} build={flow('transfers', [['q', prevQ, m.plabel(prevQ)], ['q', pi, m.plabel(pi)]])} />
            </Panel>
          </div>
          <div className="grid2">
            <Panel title={`${tabLabel}: צבירה אורגנית (הפקדות פחות משיכות)`} aside={<span>מיליארדי ש"ח</span>}>
              <Chart label="צבירה אורגנית" height={270} deps={deps} build={flow('organic', [['ytd', pi - 12, `1-${mo}/${y - 1}`], ['ytd', pi, `1-${mo}/${y}`]])} />
            </Panel>
            <Panel title={`${tabLabel}: צבירה נטו כ-% מנכסי הפתיחה`} aside={<span>%, YTD</span>}>
              <Chart label="צבירה מנכסים" height={270} deps={deps} build={flow('rate', [['ytd', pi - 12, `1-${mo}/${y - 1}`], ['ytd', pi, `1-${mo}/${y}`]])} />
            </Panel>
          </div>
        </>
      )}
      <Panel title={`${tabLabel}: טבלה, ${m.plabel(pi)}`} aside={<span>מקור: רשות שוק ההון · {qLabel}</span>}>
        <div className="scroll"><table>
          <thead><tr><th>חברה</th><th>נכסים, מיליארד</th><th>נתח שוק</th><th>YTD</th><th>LTM</th>{hasFlows && <><th>ניוד נטו, QTD</th><th>ניוד נטו, YTD</th><th>צבירה אורגנית, YTD</th></>}{tab !== 'all' && <th>דמי ניהול</th>}<th>תשואה, LTM</th></tr></thead>
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
