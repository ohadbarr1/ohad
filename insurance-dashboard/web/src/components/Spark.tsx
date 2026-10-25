/* A sparkline: the run behind a figure, the latest point in the ember. Shared by the KPI ledger, the data table and the phone tiles. */
/** The last twelve points of a series as a small line, the latest marked. */
export function Spark({ data, w = 96, h = 24 }: { data: (number | null)[]; w?: number; h?: number }) {
  const pts = data.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <span className="muted">–</span>;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v)), span = hi - lo || 1, i0 = pts[0].i, ix = pts[pts.length - 1].i - i0 || 1;
  const xy = pts.map((p) => [2 + ((p.i - i0) / ix) * (w - 4), h - 3 - ((p.v - lo) / span) * (h - 6)] as const);
  const zero = lo < 0 && hi > 0 ? h - 3 - ((0 - lo) / span) * (h - 6) : null;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {zero != null && <line x1="0" x2={w} y1={zero} y2={zero} className="zero" />}
      <polyline points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="2.6" />
    </svg>
  );
}
