import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Field, Loading, Panel } from '../components/ui';
import { nf } from '../lib/format';
import { load } from '../lib/useData';
import { he, isPct, segName } from './CompanyIfrs';

interface Pt { v: number; pg: number | null; from: string; u: string | null; rnd?: number; re?: number; was?: number; src?: string }
interface Row { m: string; s: string; b: string; w: string; pts: Record<string, Pt> }
const label = (d: string, w: string) => (w === 'q' ? `${({ '03': 'Q1', '06': 'Q2', '09': 'Q3', '12': 'Q4' } as Record<string, string>)[d.slice(5, 7)]}'${d.slice(2, 4)}` : d.slice(5) === '12-31' ? `FY'${d.slice(2, 4)}` : d);
const lineName = (s: string) => { const [head, rest] = s.split(/:(.*)/); return rest ? rest.trim() : segName(head); };

/** The years before IFRS 17, as each annual report printed them under IFRS 4. Kept apart from the IFRS 17 screens: the measures are not comparable across the change of standard. */
export function CompanyHist({ id, docs }: { id: string; docs: number }) {
  const [data, setData] = useState<{ standard: string; rows: Row[] } | null | undefined>(undefined);
  useEffect(() => { setData(undefined); load<{ standard: string; rows: Row[] }>(`hist/${id}.json`).then(setData, () => setData(null)); }, [id]);
  const [seg, setSeg] = useState('group');
  const rows = data?.rows ?? [];
  const head = (s: string) => s.split(':')[0];
  const segs = useMemo(() => { const m = new Map<string, number>(); rows.forEach((r) => m.set(head(r.s), (m.get(head(r.s)) ?? 0) + 1)); return [...m.entries()].sort((a, b) => (a[0] === 'group' ? -1 : b[0] === 'group' ? 1 : b[1] - a[1])); }, [rows]);
  const S = segs.some(([s]) => s === seg) ? seg : segs[0]?.[0] ?? '';
  const mine = useMemo(() => rows.filter((r) => head(r.s) === S && (r.w === 'fy' || r.w === 'instant' || r.w === '')), [rows, S]);
  // year-ends for annual figures; other balance dates (a mid-year solvency ratio) keep their own column
  const dates = useMemo(() => [...new Set(mine.flatMap((r) => Object.keys(r.pts)))].sort(), [mine]);

  if (data === undefined) return <Loading what="היסטוריה" />;
  if (!data || rows.length === 0) return <Empty title="ההיסטוריה של החברה טרם חולצה">{docs > 0 && <Link to="../filings">{docs} מסמכי מקור</Link>}</Empty>;
  return (
    <>
      <section className="controls">
        <Field label="מגזר"><select value={S} onChange={(e) => setSeg(e.target.value)}>{segs.map(([s, n]) => <option key={s} value={s}>{segName(s)} ({n})</option>)}</select></Field>
        <span className="chip est" title="המדדים לפני IFRS 17 אינם ברי-השוואה למסכי ה-IFRS 17">{data.standard} · לפני IFRS 17</span>
        <span className="chip">מיליוני ש"ח · כפי שדווח</span>
      </section>
      <Panel title={`${segName(S)} · לפני IFRS 17`} aside={<span>{mine.length} שורות · {dates.length} מועדים</span>}>
        <div className="scroll"><table>
          <thead><tr><th>שורה</th>{dates.map((d) => <th key={d}>{label(d, 'fy')}</th>)}</tr></thead>
          <tbody>{mine.map((r, i) => (
            <tr key={i}>
              <td className="lbl">{he(r.m)}{r.s !== S && <span className="muted"> · {lineName(r.s)}</span>}{r.b !== 'na' && <span className="dim">{r.b === 'gross' ? 'ברוטו' : r.b === 'net' ? 'נטו' : r.b}</span>}</td>
              {dates.map((d) => { const p = r.pts[d]; return (
                <td key={d}>{!p ? <span className="muted">–</span> : (
                  <>{p.u && p.pg != null ? <a className={`num ${p.v < 0 ? 'neg' : ''}`} href={`${p.u}#page=${p.pg}`} target="_blank" rel="noreferrer" title={`מדוח ${label(p.from.slice(0, 4) + '-12-31', 'fy')} · עמ׳ ${p.pg}`}>{nf(p.v, isPct(r.m) || Math.abs(p.v) < 100 ? 1 : 0)}{isPct(r.m) ? '%' : ''}</a> : <span className="num">{nf(p.v, 1)}</span>}
                    {p.re === 1 && <span className="chip est" title={`הוצג מחדש בדוח מאוחר יותר; בדוח המקורי: ${p.was?.toLocaleString()}`}>הוצג מחדש</span>}{p.rnd === 1 && <span className="chip est">עגול</span>}{p.src && <span className="chip est">{p.src === 'chart' ? 'מגרף' : p.src === 'image' ? 'מתמונה' : 'מטקסט'}</span>}</>
                )}</td>
              ); })}
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </>
  );
}
