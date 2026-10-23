import { useState } from 'react';
import { Chart } from './Chart';
import { Sourced } from './Source';
import { Panel, Seg } from './ui';
import { foxOption } from '../lib/foxchart';
import { nf } from '../lib/format';
import { idColor } from '../lib/identity';
import { useSource } from '../lib/prov';
import { adjPeriod, adjProv, useAdjusted, type AdjPt } from '../lib/targets';
import '../styles/targets.css';

const yearly = (p: string) => p.endsWith('FY');
/** Company page: the KPIs the company defines itself (core profit, adjusted profit, core ROE), from its investor decks.
 *  Labelled "לפי הגדרת החברה" with the definition; never drawn beside or summed with statement figures. */
export function AdjustedPanel({ id, name }: { id: string; name: string }) {
  const A = useAdjusted();
  const { open } = useSource();
  const S = A.data?.companies[id];
  const keys = S ? Object.keys(S).sort((a, b) => S[b].pts.length - S[a].pts.length) : [];
  const [k, setK] = useState('');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  if (!A.data || !S || !keys.length) return null;
  const cur = S[k] ? k : keys[0], s = S[cur];
  const fy = s.pts.filter((x) => yearly(x.p)), qs = s.pts.filter((x) => /Q\d$/.test(x.p));
  const pts: AdjPt[] = (fy.length >= 3 ? fy : qs.length >= 2 ? qs : s.pts).slice(-10);
  return (
    <Panel title={<>מדדים מותאמים <span className="adj-co">· לפי הגדרת החברה</span></>} aside={<Seg<'chart' | 'table'> label="תצוגה" value={view} onChange={setView} options={[['chart', 'גרף'], ['table', 'טבלה']]} />}>
      {keys.length > 1 && <div className="tg-bar"><select aria-label="מדד" value={cur} onChange={(e) => setK(e.target.value)}>{keys.map((x) => <option key={x} value={x}>{S[x].l}</option>)}</select></div>}
      <div className="adj-def">{s.l} · {s.def || 'כפי שהוצג במצגת החברה'}</div>
      {view === 'chart' ? (
        <Chart label={`${s.l}, לפי הגדרת החברה`} height={240} deps={[cur, pts.length]} source="מצגות משקיעים של החברה, MAYA"
          build={() => foxOption({ x: pts.map((x) => adjPeriod(x.p)), unit: s.u === 'pct' ? '%' : 'מיליוני ש"ח', legend: false, labels: true, full: true,
            series: [{ name: `${s.l} (לפי הגדרת החברה)`, kind: 'bar' as const, pct: s.u === 'pct', color: idColor(id), dec: s.u === 'pct' ? 1 : 0, data: pts.map((x) => x.v) }] })}
          onPoint={(_si, di) => { const x = pts[di]; if (x) open(adjProv(A.data!, s, x, name)); }} />
      ) : (
        <div className="scroll"><table className="tight">
          <thead><tr><th>מדד</th>{[...new Set(keys.flatMap((x) => S[x].pts.map((y) => y.p)))].slice(-8).map((p) => <th key={p} className="num">{adjPeriod(p)}</th>)}</tr></thead>
          <tbody>{keys.map((x) => { const ps = [...new Set(keys.flatMap((y) => S[y].pts.map((z) => z.p)))].slice(-8); return (
            <tr key={x}><td>{S[x].l}</td>{ps.map((p) => { const y = S[x].pts.find((z) => z.p === p); return <td key={p}>{y ? <Sourced className="num" src={() => adjProv(A.data!, S[x], y, name)}>{S[x].u === 'pct' ? `${nf(y.v, 1)}%` : nf(y.v, 0)}</Sourced> : <span className="muted">–</span>}</td>; })}</tr>); })}</tbody>
        </table></div>
      )}
      <div className="src">מדד של ההנהלה, לא שורה בדוחות הכספיים ואינו בר השוואה בין חברות · {pts.length ? `${adjPeriod(pts[0].p)}–${adjPeriod(pts[pts.length - 1].p)} · ` : ''}כל ערך מקושר לשקף · מצגות משקיעים, MAYA</div>
    </Panel>
  );
}
