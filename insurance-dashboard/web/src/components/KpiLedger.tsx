import { useState, type ReactNode } from 'react';
import { MetricCard, type MetricCardProps } from './MetricCard';
import { Sourced } from './Source';
import { Sheet } from './Sheet';
import { useMedia } from '../lib/useMedia';

export interface LedgerGroup { title: string; note?: ReactNode; cards: MetricCardProps[] }

/** The last twelve points of a series as a small line, the latest marked. */
function Spark({ data }: { data: (number | null)[] }) {
  const pts = data.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null).slice(-12);
  if (pts.length < 2) return <span className="muted">–</span>;
  const W = 96, H = 24, lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v)), span = hi - lo || 1, i0 = pts[0].i, i1 = pts[pts.length - 1].i, ix = i1 - i0 || 1;
  const xy = pts.map((p) => [2 + ((p.i - i0) / ix) * (W - 4), H - 3 - ((p.v - lo) / span) * (H - 6)] as const);
  const zero = lo < 0 && hi > 0 ? H - 3 - ((0 - lo) / span) * (H - 6) : null;
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {zero != null && <line x1="0" x2={W} y1={zero} y2={zero} className="zero" />}
      <polyline points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="2.6" />
    </svg>
  );
}

/** Every headline metric of a company on one screen: one row each (value, change, the last twelve periods, source), grouped;
 *  the selected row's full chart beside the table on a wide screen, in a sheet on a phone. Built from the same card specs as before,
 *  so every figure keeps its source. */
export function KpiLedger({ groups }: { groups: LedgerGroup[] }) {
  const phone = useMedia('(max-width: 1100px)');  // where the chart pane does not fit, the chart opens in a sheet
  const all = groups.flatMap((g) => g.cards.filter((c) => c.value !== '–'));
  const [sel, setSel] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const cur = all.find((c) => c.title === sel) ?? all[0];
  if (!all.length) return null;
  const pick = (c: MetricCardProps) => { setSel(c.title); if (phone) setSheet(true); };
  return (
    <div className="ledger-wrap">
      <div className="panel ledger">
        <table>
          <thead><tr><th>מדד</th><th>ערך</th><th>שינוי</th><th className="wide-only">12 תקופות</th><th className="wide-only">יחידה</th></tr></thead>
          {groups.map((g) => {
            const cs = g.cards.filter((c) => c.value !== '–');
            return cs.length ? (
              <tbody key={g.title}>
                <tr className="sec"><td colSpan={5}>{g.title}{g.note && <span className="dim">{g.note}</span>}</td></tr>
                {cs.map((c) => (
                  <tr key={c.title} className={cur?.title === c.title ? 'on' : ''} onClick={(e) => { if (!(e.target as HTMLElement).closest('.src')) pick(c); }} tabIndex={-1}>
                    <td className="lbl"><span className="lblin"><button type="button" className="rowbtn" onClick={() => pick(c)} aria-pressed={cur?.title === c.title}>{c.title}</button>{c.tag && <span className="chip est">{c.tag}</span>}</span></td>
                    <td><span className="num v">{c.src ? <Sourced src={c.src} href={c.href}>{c.value}</Sourced> : c.value}</span></td>
                    <td>{c.delta ? <span className={`num ${c.delta.tone ?? ''}`}>{c.delta.text}</span> : <span className="muted">–</span>}</td>
                    <td className="wide-only"><Spark data={c.series[0]?.data ?? []} /></td>
                    <td className="wide-only muted">{c.unit}</td>
                  </tr>
                ))}
              </tbody>
            ) : null;
          })}
        </table>
      </div>
      {!phone && cur && <aside className="ledger-chart"><MetricCard {...cur} height={300} /></aside>}
      {phone && cur && <Sheet open={sheet} onClose={() => setSheet(false)} title={cur.title}><MetricCard {...cur} height={240} /></Sheet>}
    </div>
  );
}
