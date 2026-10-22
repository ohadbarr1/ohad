import { Sourced } from './Source';
import { nf, pct } from '../lib/format';
import { useKpis, useLoad } from '../lib/useData';
import type { Market } from '../lib/market';
import type { Prov } from '../lib/prov';

/** The cross-company lines (lines.json): one statement line per role and company, every cell with its page. */
interface Lines { roles: [string, string, string][]; periods: [string, string][]; urls: string[]; data: Record<string, Record<string, { label: string; unit: string; cells: [number, number, number | null, number | null, number][] }>> }
const ql = (end: string) => `Q${Math.ceil(Number(end.slice(5, 7)) / 3)}'${end.slice(2, 4)}`;

/** A fund house judged as a fund house: assets and flows from the regulator, fee revenue and operating profit from its own statements, ROE from its tagged report. */
export function FundHouseStrip({ id, name, market, group }: { id: string; name: string; market: Market | null; group: string | null }) {
  const lines = useLoad<Lines>('lines.json');
  const { kpis } = useKpis();
  const k = kpis?.get(id);
  const g = market && group ? market.groupIndex(group) : -1, L = market?.LAST ?? 0;
  // the last four quarters of a printed line, each with its page; null when one of them is missing
  const ltm = (role: string) => {
    const d = lines.data?.data[role]?.[id];
    if (!d || !lines.data) return null;
    const q = d.cells.map(([pi, v, pg, u]) => ({ p: lines.data!.periods[pi], v, pg, u: u == null ? null : lines.data!.urls[u] })).filter((c) => c.p[0] === 'Q').sort((a, b) => a.p[1].localeCompare(b.p[1]));
    const last4 = q.slice(-4);
    if (last4.length < 4) return null;
    const ends = last4.map((c) => c.p[1]), gap = (Date.parse(ends[3]) - Date.parse(ends[0])) / 864e5;
    if (gap > 300) return null;  // four quarters, consecutive
    // and current: the window ends at the company's latest reported quarter, or the figure is not shown
    const np = lines.data.data.np?.[id]?.cells.map(([pi]) => lines.data!.periods[pi]).filter((p) => p[0] === 'Q').map((p) => p[1]).sort().pop();
    if (np && ends[3] !== np) return null;
    return { v: last4.reduce((s, c) => s + c.v, 0) / 1000, cells: last4, label: d.label, end: ends[3] };
  };
  const fees = ltm('fees'), op = ltm('op_profit'), rev = ltm('total_rev');
  const roe = k?.latest('roe') ?? null;
  const prov = (title: string, x: NonNullable<ReturnType<typeof ltm>>): Prov => ({ k: 'calc', title: `${title}, LTM עד ${ql(x.end)} · ${name}`, value: nf(x.v, 0), unit: 'מיליוני ש"ח', formula: 'סכום ארבעת הרבעונים האחרונים כפי שהודפסו',
    inputs: x.cells.map((c) => ({ label: ql(c.p[1]), v: nf(c.v / 1000, 1), src: () => ({ k: 'report', title: `${x.label} · ${ql(c.p[1])}`, value: nf(c.v / 1000, 1), unit: 'מיליוני ש"ח', url: c.u, pg: c.pg, doc: 'דוח כספי', period: ql(c.p[1]) }) as Prov })) });
  const margin = op && rev && rev.v > 0 ? (op.v / rev.v) * 100 : null;
  const cells: { l: string; v: React.ReactNode; s: React.ReactNode }[] = [];
  if (market && g >= 0) {
    const a = market.value('assets', L, 'm', 'all', g), gr = market.growth(L, 'ltm', 'all', g), nfl = market.value('netflow', L, 'ltm', 'all', g);
    if (a != null) cells.push({ l: 'נכסים מנוהלים, פנסיה וגמל', v: <Sourced src={() => market.explain('assets', L, 'm', 'all', g)}>{nf(a, 0)}</Sourced>, s: <>מיליארד ש"ח · {market.plabel(L)}{gr != null && <> · <Sourced src={() => market.explain('growth', L, 'ltm', 'all', g)}><span className={gr >= 0 ? 'pos' : 'neg'}>{pct(gr, 1, true)}</span></Sourced> YoY</>}</> });
    if (nfl != null) cells.push({ l: 'צבירה נטו, LTM', v: <Sourced src={() => market.explain('netflow', L, 'ltm', 'all', g)}><span className={nfl >= 0 ? 'pos' : 'neg'}>{nf(nfl, 1)}</span></Sourced>, s: <>מיליארד ש"ח · הפקדות פחות משיכות, ועוד העברות</> });
  }
  if (fees) cells.push({ l: 'הכנסות מדמי ניהול, LTM', v: <Sourced src={() => prov('הכנסות מדמי ניהול', fees)}>{nf(fees.v, 0)}</Sourced>, s: <>מיליוני ש"ח · עד {ql(fees.end)} · מהדוחות</> });
  if (op) cells.push({ l: 'רווח תפעולי, LTM', v: <Sourced src={() => prov('רווח תפעולי', op)}>{nf(op.v, 0)}</Sourced>, s: <>מיליוני ש"ח{margin != null && <> · מרווח <Sourced src={() => ({ k: 'calc', title: `מרווח תפעולי, LTM · ${name}`, value: pct(margin, 1), formula: 'רווח תפעולי ÷ סך ההכנסות, ארבעה רבעונים', inputs: [{ label: 'רווח תפעולי', v: nf(op.v, 0), src: () => prov('רווח תפעולי', op) }, { label: 'סך ההכנסות', v: nf(rev!.v, 0), src: () => prov('סך ההכנסות', rev!) }] })}>{pct(margin, 1)}</Sourced> <span className="chip est">נגזר</span></>}</> });
  if (roe?.v != null && k) cells.push({ l: 'ROE, LTM', v: <Sourced src={() => k.explain('roe', 'ltm', roe.period)}>{pct(roe.v, 1)}</Sourced>, s: <>מהדוח המתויג · <span className="chip est">נגזר</span></> });
  if (!cells.length) return null;
  return (
    <section>
      <h2 className="band">בית השקעות<span className="muted">נכסים וצבירה: רשות שוק ההון · הכנסות ורווח: הדוחות של החברה</span></h2>
      <div className="kpis">{cells.map((c) => <div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v num">{c.v}</div><div className="s">{c.s}</div></div>)}</div>
    </section>
  );
}
