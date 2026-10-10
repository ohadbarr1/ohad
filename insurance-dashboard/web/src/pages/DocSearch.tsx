import { byPeriodDesc } from '../lib/format';
import { useEffect, useMemo, useState } from 'react';
import { Empty, Field, Panel } from '../components/ui';
import { useRegistry } from '../lib/useData';
import { periodName } from './CompanyIfrs';

type Idx = { company: string; period: string; pages: number; kb: number };
type Doc = { url: string; pages: string[] };
type Hit = { company: string; period: string; page: number; url: string; before: string; match: string; after: string };
const cache = new Map<string, Promise<Doc>>();
const get = (name: string) => { if (!cache.has(name)) cache.set(name, fetch(`${import.meta.env.BASE_URL}data/search/${name}.json`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Doc>; })); return cache.get(name)!; };
const norm = (s: string) => s.replace(/[,"'׳״]/g, '').toLowerCase();

/** Full-text search in the Hebrew reports that were extracted. A hit opens the filed PDF on its page. */
export function DocSearch({ company }: { company?: string }) {
  const reg = useRegistry();
  const [idx, setIdx] = useState<Idx[] | null>(null);
  const [q, setQ] = useState('');
  const [co, setCo] = useState(company ?? 'all');
  const [period, setPeriod] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { fetch(`${import.meta.env.BASE_URL}data/search/index.json`).then((r) => r.json()).then(setIdx, () => setErr('אינדקס החיפוש לא נטען')); }, []);
  const periods = useMemo(() => [...new Set((idx ?? []).filter((x) => co === 'all' || x.company === co).map((x) => x.period))].sort(byPeriodDesc), [idx, co]);
  const P = periods.includes(period) ? period : periods[0] ?? '';
  // one company: every report; all companies: one period at a time, to keep the download small
  const scope = useMemo(() => (idx ?? []).filter((x) => (co === 'all' ? x.period === P : x.company === co && (period === 'all' || x.period === P))), [idx, co, P, period]);
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;

  const run = async () => {
    const term = norm(q.trim());
    if (term.length < 2) return;
    setBusy(true); setErr('');
    try {
      const docs = await Promise.all(scope.map((s) => get(`${s.company}_${s.period}`).then((d) => ({ s, d }))));
      const out: Hit[] = [];
      for (const { s, d } of docs) d.pages.forEach((text, i) => {
        const t = norm(text);
        let at = t.indexOf(term), n = 0;
        while (at >= 0 && n < 2 && out.length < 300) {
          out.push({ company: s.company, period: s.period, page: i + 1, url: d.url, before: t.slice(Math.max(0, at - 70), at), match: t.slice(at, at + term.length), after: t.slice(at + term.length, at + term.length + 90) });
          at = t.indexOf(term, at + term.length + 200); n++;
        }
      });
      setHits(out);
    } catch { setErr('טעינת הדוחות נכשלה'); }
    setBusy(false);
  };

  return (
    <Panel title="חיפוש בדוחות" aside={idx && <span>{scope.length} דוחות · <span className="num">{scope.reduce((t, s) => t + s.pages, 0).toLocaleString()}</span> עמודים</span>}>
      <form className="controls" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <Field label="ביטוי"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="רכיב הפסד, 17,717, דיבידנד" autoComplete="off" /></Field>
        {!company && <Field label="חברה"><select value={co} onChange={(e) => setCo(e.target.value)}><option value="all">כל החברות</option>{[...new Set((idx ?? []).map((x) => x.company))].map((c) => <option key={c} value={c}>{name(c)}</option>)}</select></Field>}
        <Field label="דוח"><select value={period === 'all' && co !== 'all' ? 'all' : P} onChange={(e) => setPeriod(e.target.value)}>{co !== 'all' && <option value="all">כל הדוחות</option>}{periods.map((p) => <option key={p} value={p}>{periodName(p)}</option>)}</select></Field>
        <button type="submit" className="chip" disabled={busy || q.trim().length < 2}>{busy ? 'מחפש…' : 'חפש'}</button>
      </form>
      {err && <Empty title={err} />}
      {hits && !err && (hits.length === 0 ? <Empty title="לא נמצא" /> : (
        <div className="scroll" style={{ maxHeight: 640 }}><table>
          <thead><tr><th>מקור</th><th>הקשר</th></tr></thead>
          <tbody>{hits.map((h, i) => (
            <tr key={i}><td style={{ whiteSpace: 'nowrap' }}><a href={`${h.url}#page=${h.page}`} target="_blank" rel="noreferrer">{!company && `${name(h.company)} · `}{periodName(h.period)} · <span className="num">עמ׳ {h.page}</span></a></td>
              <td className="lbl" style={{ whiteSpace: 'normal' }}><span className="muted">{h.before}</span><b>{h.match}</b><span className="muted">{h.after}</span></td></tr>
          ))}</tbody>
        </table></div>
      ))}
      {hits && hits.length >= 300 && <div className="src">מוצגות 300 התוצאות הראשונות.</div>}
    </Panel>
  );
}
