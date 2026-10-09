import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Field, Loading, Panel, Seg } from '../components/ui';
import { nf } from '../lib/format';
import { load } from '../lib/useData';
import { he, periodName, segName } from './CompanyIfrs';

interface SopFact { f: string; m: string; s: string; w: string; d: string; v: number; pg: number | null; b: string; u?: string | null; src?: string; n?: string }
type SopData = Record<string, { url: string | null; facts: SopFact[]; missing: string[] }>;
const FAMILIES: [string, string][] = [['sop', 'מקורות הרווח'], ['pc', 'כללי, לפי ענף'], ['health', 'בריאות, לפי ענף'], ['life', 'חיים וחיסכון, לפי מוצר'], ['nostro', 'נוסטרו'], ['other', 'אחר']];
const WIN: Record<string, string> = { q: 'QTD', ytd: 'YTD', fy: 'FY', instant: '' };
const quarter = (d: string) => (d ? `${({ '03': 'Q1', '06': 'Q2', '09': 'Q3', '12': 'Q4' } as Record<string, string>)[d.slice(5, 7)] ?? d.slice(5, 7)}'${d.slice(2, 4)}` : '');
const colName = (w: string, d: string) => (w === 'fy' ? `FY'${d.slice(2, 4)}` : w === 'instant' ? d : `${WIN[w] ?? w} · ${quarter(d)}`);
const lineName = (s: string) => { const [head, rest] = s.split(/:(.*)/); return rest ? rest.trim() : segName(head); };
const rowName = (m: string) => (m.startsWith('sop_total:') ? m.slice(10) : m.startsWith('sop:') ? m.slice(4) : m.startsWith('nostro_pct:') ? `${m.slice(11)}, %` : m.startsWith('nostro:') ? m.slice(7) : he(m));

/** What the report says about where profit comes from: sources of profit by segment, results by line of business, and the insurer's own investment book. As printed, each figure on its page. */
export function CompanySop({ id, docs }: { id: string; docs: number }) {
  const [data, setData] = useState<SopData | null | undefined>(undefined);
  useEffect(() => { setData(undefined); load<SopData>(`sop/${id}.json`).then(setData, () => setData(null)); }, [id]);
  const periods = useMemo(() => Object.keys(data ?? {}).sort().reverse(), [data]);
  const [period, setPeriod] = useState('');
  const [fam, setFam] = useState('sop');
  const [col, setCol] = useState('');
  const P = periods.includes(period) ? period : periods[0] ?? '';
  const facts = data?.[P]?.facts ?? [];
  const fams = FAMILIES.filter(([k]) => facts.some((f) => f.f === k));
  const F = fams.some(([k]) => k === fam) ? fam : fams[0]?.[0] ?? '';
  const mine = useMemo(() => facts.filter((f) => f.f === F), [facts, F]);
  // one table per window and date: the report's own period first, then its comparatives
  const cols = useMemo(() => {
    const seen = new Map<string, number>();
    mine.forEach((f) => seen.set(`${f.w}|${f.d}`, (seen.get(`${f.w}|${f.d}`) ?? 0) + 1));
    const order = ['q', 'ytd', 'fy', 'instant'];
    return [...seen.keys()].sort((a, b) => b.split('|')[1].localeCompare(a.split('|')[1]) || order.indexOf(a.split('|')[0]) - order.indexOf(b.split('|')[0]));
  }, [mine]);
  const C = cols.includes(col) ? col : cols[0] ?? '';
  const table = useMemo(() => {
    const [w, d] = C.split('|');
    const at = mine.filter((f) => f.w === w && f.d === d);
    const lines = [...new Set(at.map((f) => f.s))];
    const metrics = [...new Set(at.map((f) => f.m))];
    return { lines, rows: metrics.map((m) => ({ m, total: m.startsWith('sop_total'), cells: lines.map((s) => at.find((f) => f.m === m && f.s === s) ?? null) })) };
  }, [mine, C]);

  if (data === undefined) return <Loading what="מקורות הרווח" />;
  if (!data || !P) return <Empty title="מקורות הרווח של החברה טרם חולצו">{docs > 0 && <Link to="../filings">{docs} מסמכי מקור</Link>}</Empty>;
  const url = (f: SopFact) => (f.u !== undefined ? f.u : data[P].url);
  const isPct = (m: string) => /ratio|pct/.test(m);

  return (
    <>
      <section className="controls">
        <div className="field"><span>דוח</span><Seg label="דוח" value={P} onChange={setPeriod} options={periods.map((p) => [p, periodName(p)])} /></div>
        <div className="field"><span>טבלה</span><Seg label="טבלה" value={F} onChange={setFam} options={fams} /></div>
        {cols.length > 1 && <Field label="תקופה"><select value={C} onChange={(e) => setCol(e.target.value)}>{cols.map((c) => <option key={c} value={c}>{colName(c.split('|')[0], c.split('|')[1])}</option>)}</select></Field>}
        <span className="chip">מיליוני ש"ח · כפי שדווח</span>
        {data[P].url && <a className="chip" href={data[P].url!} target="_blank" rel="noreferrer">הדוח המלא</a>}
      </section>
      <Panel title={FAMILIES.find(([k]) => k === F)?.[1]} aside={<span>{colName(C.split('|')[0], C.split('|')[1])} · {table.rows.length} שורות</span>}>
        {table.rows.length === 0 ? <Empty title="אין נתונים לטבלה ולתקופה שנבחרו" /> : (
          <div className="scroll"><table>
            <thead><tr><th>שורה</th>{table.lines.map((s) => <th key={s}>{lineName(s)}</th>)}</tr></thead>
            <tbody>{table.rows.map((r) => (
              <tr key={r.m} className={r.total ? 'tot' : ''}>
                <td className="lbl">{rowName(r.m)}</td>
                {r.cells.map((f, i) => <td key={i}>{!f ? <span className="muted">–</span> : (
                  <>{url(f) && f.pg != null ? <a className={`num ${f.v < 0 ? 'neg' : ''}`} href={`${url(f)}#page=${f.pg}`} target="_blank" rel="noreferrer" title={`${f.n ?? ''} · עמ׳ ${f.pg}`}>{nf(f.v, isPct(f.m) || Math.abs(f.v) < 100 ? 1 : 0)}{isPct(f.m) ? '%' : ''}</a> : <span className="num">{nf(f.v, 1)}</span>}{f.src === 'chart' && <span className="chip est">מגרף</span>}</>
                )}</td>)}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {F === 'life' && <div className="src">"פוליסות הכוללות רכיב חיסכון" הן ביטוחי מנהלים (IFRS 17). חוזי השקעה הם פוליסות חיסכון טהורות (IFRS 9).</div>}
      </Panel>
      {data[P].missing.length > 0 && (
        <Panel title="מה הדוח לא מדפיס" aside={<span>{data[P].missing.length}</span>}>
          <ul className="prose" style={{ paddingInlineStart: 18, margin: 0 }}>{data[P].missing.map((m, i) => <li key={i} className="muted" style={{ fontSize: 12.5 }}><bdi>{m}</bdi></li>)}</ul>
        </Panel>
      )}
    </>
  );
}
