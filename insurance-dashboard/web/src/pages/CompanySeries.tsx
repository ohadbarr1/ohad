import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Field, Loading, Panel, Seg } from '../components/ui';
import { nf } from '../lib/format';
import { load } from '../lib/useData';
import { BASIS } from './IndustryIfrs';
import { he, isPct, segName } from './CompanyIfrs';

interface Cell { v: number; pg?: number; u?: string; std: string; cmp?: number; der?: number; src?: string }
interface Row { m: string; s: string; g: string; b: string; vals: Record<string, Cell> }
const label = (p: string) => `${p.slice(4)}'${p.slice(2, 4)}`;
const lineName = (s: string) => { const [head, rest] = s.split(/:(.*)/); return rest ? rest.trim() : segName(head); };
const G_ORDER = ['group', 'life', 'health', 'pc', 'savings', 'investment_contracts', 'insurer', 'other'];

/** Every reported line, quarter by quarter since 2022, across the change of accounting standard. Each figure is the one printed for that quarter and opens its page. */
export function CompanySeries({ id, docs }: { id: string; docs: number }) {
  const [data, setData] = useState<{ periods: string[]; rows: Row[] } | null | undefined>(undefined);
  useEffect(() => { setData(undefined); load<{ periods: string[]; rows: Row[] }>(`series/${id}.json`).then(setData, () => setData(null)); }, [id]);
  const [g, setG] = useState('group');
  const [view, setView] = useState<'q' | 'fy'>('q');
  const [q, setQ] = useState('');
  const rows = data?.rows ?? [];
  const groups = useMemo(() => G_ORDER.filter((x) => rows.some((r) => r.g === x)), [rows]);
  const G = groups.includes(g) ? g : groups[0] ?? '';
  const periods = useMemo(() => (data?.periods ?? []).filter((p) => (view === 'fy' ? p.endsWith('FY') : !p.endsWith('FY'))).sort().reverse(), [data, view]);
  const mine = useMemo(() => {
    const t = q.trim();
    return rows.filter((r) => r.g === G && periods.some((p) => r.vals[p]) && (!t || `${he(r.m)} ${lineName(r.s)} ${r.m}`.includes(t)))
      .map((r) => ({ r, n: periods.filter((p) => r.vals[p]).length })).sort((a, b) => b.n - a.n).map((x) => x.r);
  }, [rows, G, periods, q]);
  // where the standard changes, reading from the newest column back
  const firstOld = useMemo(() => periods.find((p) => mine.some((r) => r.vals[p]?.std === 'IFRS 4') && !mine.some((r) => r.vals[p]?.std === 'IFRS 17')), [periods, mine]);

  if (data === undefined) return <Loading what="רצף הדוחות" />;
  if (!data || rows.length === 0) return <Empty title="הדוחות של החברה טרם חולצו">{docs > 0 && <Link to="../filings">{docs} מסמכי מקור</Link>}</Empty>;
  return (
    <>
      <section className="controls">
        <div className="field"><span>תצוגה</span><Seg label="תצוגה" value={view} onChange={setView} options={[['q', 'רבעוני'], ['fy', 'שנתי']]} /></div>
        <Field label="מגזר"><select value={G} onChange={(e) => setG(e.target.value)}>{groups.map((x) => <option key={x} value={x}>{segName(x)} ({rows.filter((r) => r.g === x).length})</option>)}</select></Field>
        <Field label="חיפוש שורה"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="רווח, דמי ניהול, CSM" /></Field>
        <span className="chip">מיליוני ש"ח · כפי שדווח</span>
      </section>
      <Panel title={`${segName(G)} · ${view === 'q' ? 'רבעון בודד' : 'שנתי'}`} aside={<span>{mine.length} שורות · {periods.length ? `${label(periods[periods.length - 1])} עד ${label(periods[0])}` : ''}</span>}>
        {mine.length === 0 ? <Empty title="אין שורות בסינון הזה" /> : (
          <div className="scroll" style={{ maxHeight: 680 }}><table className="series">
            <thead><tr><th>שורה</th>{periods.map((p) => <th key={p} className={p === firstOld ? 'brk' : ''}>{label(p)}{p === firstOld && <span className="dim">IFRS 4</span>}</th>)}</tr></thead>
            <tbody>{mine.slice(0, 250).map((r, i) => (
              <tr key={i}>
                <td className="lbl">{he(r.m)}{r.s !== r.g && <span className="muted"> · {lineName(r.s)}</span>}{r.b !== 'na' && <span className="dim">{BASIS[r.b] ?? r.b}</span>}</td>
                {periods.map((p) => { const c = r.vals[p]; const txt = c ? nf(c.v, isPct(r.m) || Math.abs(c.v) < 100 ? 1 : 0) + (isPct(r.m) ? '%' : '') : '';
                  const tip = c ? [c.std, c.der ? 'נגזר: שנתי פחות תשעה חודשים' : '', c.cmp ? 'מספר השוואה מדוח מאוחר יותר' : '', c.src ? `מקור: ${c.src}` : '', c.pg ? `עמ׳ ${c.pg}` : ''].filter(Boolean).join(' · ') : '';
                  return <td key={p} className={`${p === firstOld ? 'brk' : ''} ${c?.std === 'IFRS 4' ? 'old' : ''}`}>{!c ? <span className="muted">·</span> : c.u && c.pg != null && !c.der
                    ? <a className={`num ${c.v < 0 ? 'neg' : ''} ${c.cmp ? 'cmp' : ''}`} href={`${c.u}#page=${c.pg}`} target="_blank" rel="noreferrer" title={tip}>{txt}</a>
                    : <span className={`num ${c.v < 0 ? 'neg' : ''} ${c.der ? 'der' : ''}`} title={tip}>{txt}</span>}</td>; })}
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="src">נטוי: Q4 נגזר (שנתי פחות תשעה חודשים). אפור: מספר השוואה מדוח מאוחר יותר, עשוי להיות מוצג מחדש. רקע כהה: דווח תחת IFRS 4, לא בר-השוואה לעמודות ה-IFRS 17. ריחוף על מספר מציג את המקור.</div>
      </Panel>
    </>
  );
}
