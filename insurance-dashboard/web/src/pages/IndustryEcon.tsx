import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Field, Loading, Panel } from '../components/ui';
import { Sourced } from '../components/Source';
import type { Prov } from '../lib/prov';
import { rankProv } from '../lib/csm';
import { palette } from '../lib/theme';
import { nf } from '../lib/format';
import { useRegistry, useSavingsEcon } from '../lib/useData';
import type { SavingsRow } from '../lib/types';
import { pdfPage } from '../lib/sources';

type Act = SavingsRow['a'];
const ACTS: [Act, string][] = [['pension', 'פנסיה'], ['provident', 'גמל והשתלמות'], ['combined', 'פנסיה וגמל'], ['entity', 'כלל החברה'], ['investment_contracts', 'פוליסות חיסכון (חוזי השקעה)']];
// key, label, unit ('m' NIS millions, 'p' percent)
const METRICS: [string, string, 'm' | 'p'][] = [
  ['fees', 'דמי ניהול', 'm'], ['sm', 'שיווק ומכירה', 'm'], ['ga', 'הנהלה וכלליות', 'm'], ['expenses', 'הוצאות', 'm'], ['profit', 'רווח לפני מס', 'm'],
  ['margin', 'שיעור רווח', 'p'], ['exp_ratio', 'הוצאות / דמי ניהול', 'p'], ['sm_pct', 'שיווק / דמי ניהול', 'p'], ['ga_pct', 'הנה"כ / דמי ניהול', 'p'],
  ['aum', 'נכסים מנוהלים', 'm'], ['deposits', 'הפקדות', 'm'],
];
const KIND: Record<string, string> = { cibt: 'כולל לפני מס', op: 'רווח מגזרי' };
const LIMIT: Record<string, string> = { no_split: 'ללא פיצול שיווק / הנה"כ', combined_only: 'מגזר משולב בלבד', no_pension: 'אין פנסיה', ic_main: 'בעיקר פוליסות חיסכון', entity_costs: 'הוצאות ברמת החברה' };
const COSTS = ['sm', 'ga', 'sm_pct', 'ga_pct'];
const periodLabel = (k: string) => (k.endsWith('FY') ? `FY'${k.slice(2, 4)}` : `${k.slice(4)}'${k.slice(2, 4)}`);
const fmt = (v: number, u: 'm' | 'p') => (u === 'p' ? `${nf(v, 1)}%` : nf(v, Math.abs(v) < 100 ? 1 : 0));

/** Which of a company's disclosure limits explain an empty cell for this activity and metric. */
function why(limits: string[], a: Act, m: string): string[] {
  return limits.filter((l) => (l === 'no_split' ? COSTS.includes(m)
    : l === 'combined_only' ? a === 'pension' || a === 'provident'
    : l === 'no_pension' ? a === 'pension' || a === 'combined'
    : l === 'ic_main' ? a !== 'investment_contracts'
    : l === 'entity_costs' ? a !== 'entity' && !['fees', 'aum', 'deposits'].includes(m) : false));
}

function Src({ r }: { r: SavingsRow }) {
  const one = (pg: number | null | undefined, url: string | null | undefined) => (pg == null ? null : url ? <a href={`${url}#page=${pg}`} target="_blank" rel="noreferrer" className="num">עמ׳ {pg}</a> : <span className="num">עמ׳ {pg}</span>);
  const a = one(r.pg, r.url), b = r.der && (r.pg2 !== r.pg || r.url2 !== r.url) ? one(r.pg2, r.url2) : null;
  return a ? <>{a}{b && <> · {b}</>}</> : <>–</>;
}

function Chips({ r, combinedOnly }: { r: SavingsRow; combinedOnly: boolean }) {
  return (
    <>
      {r.der && <span className="chip est">נגזר</span>}
      {r.kind && KIND[r.kind] && <span className="chip">{KIND[r.kind]}</span>}
      {r.ns && <span className="chip">ללא פיצול</span>}
      {r.ent && <span className="chip">כלל החברה</span>}
      {combinedOnly && r.a === 'combined' && <span className="chip">מגזר משולב</span>}
      {r.src && <span className="chip est">{r.src === 'text' ? 'מטקסט' : r.src}</span>}
    </>
  );
}

/** Pension and provident economics across companies: printed figures with their source pages; ratios tagged as derived. */
export function IndustryEcon() {
  const { data: d, error } = useSavingsEcon();
  const reg = useRegistry();
  const [sp, setSp] = useSearchParams();
  const [period, setPeriod] = useState(sp.get('p') ?? '');
  const [act, setAct] = useState<Act>((sp.get('a') as Act) ?? 'provident');
  const [metric, setMetric] = useState(sp.get('m') ?? 'fees');
  const periods = d?.periods ?? [];
  const P = periods.some((p) => p.k === period) ? period : periods[0]?.k ?? '';
  const A = ACTS.some(([k]) => k === act) ? act : 'provident';
  const M = METRICS.find(([k]) => k === metric) ?? METRICS[0];
  // merged into the page's query: inside the Savings Lens the view (?v=econ) stays
  useEffect(() => { if (P) setSp((prev) => { const n = new URLSearchParams(prev); n.set('p', P); n.set('a', A); n.set('m', M[0]); return n; }, { replace: true }); }, [P, A, M, setSp]);

  const cur = useMemo(() => (d?.rows ?? []).filter((r) => r.pk === P && r.a === A), [d, P, A]);
  const cell = useMemo(() => new Map(cur.map((r) => [`${r.c}|${r.m}`, r])), [cur]);
  const ranked = useMemo(() => (d?.companies ?? []).map((id) => ({ id, r: cell.get(`${id}|${M[0]}`) ?? null }))
    .sort((x, y) => (y.r ? y.r.v : -Infinity) - (x.r ? x.r.v : -Infinity)), [d, cell, M]);

  if (error) return <ErrorBox what="כלכלת החיסכון" error={error} />;
  if (!d || !reg.data) return <Loading what="כלכלת החיסכון" />;
  if (!P) return <Empty title="אין נתונים מחולצים" />;
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  const pal = palette();
  const have = ranked.filter((x) => x.r);
  const max = Math.max(...have.map((x) => Math.abs(x.r!.v)), 1e-9);
  const actLabel = ACTS.find(([k]) => k === A)![1];
  const mLabel = (m: string) => METRICS.find(([k]) => k === m)?.[1] ?? m;
  // a printed row opens its page; a ratio (derived) opens the two printed rows it divides
  const econProv = (x: SavingsRow, who: string): Prov => {
    const u = METRICS.find(([k]) => k === x.m)![2], title = `${mLabel(x.m)} · ${who} · ${periodLabel(x.pk)}`, val = fmt(x.v, u);
    if (!x.der) return { k: 'report', title, value: val, unit: u === 'p' ? '%' : 'מיליוני ש"ח', url: x.url, pg: x.pg, doc: 'דוח כספי', period: periodLabel(x.pk), note: [x.l, x.kind ? KIND[x.kind] : '', x.src === 'text' ? 'נקרא מטקסט' : '', x.ent ? 'כלל החברה' : ''].filter(Boolean).join(' · ') };
    const [nu, de] = x.rm.split('/'), find = (rm: string) => cur.find((y) => y.c === x.c && y.rm === rm && !y.der);
    const parts = [find(nu), find(de)];
    return { k: 'calc', title, value: val, unit: '%', formula: `${parts[0] ? mLabel(parts[0].m) : nu} ÷ ${parts[1] ? mLabel(parts[1].m) : de} × 100`, note: x.l,
      inputs: parts.map((y, i) => (y ? { label: mLabel(y.m), v: fmt(y.v, 'm'), src: () => econProv(y, who) } : { label: i ? de : nu, v: '–' })) };
  };
  const inView = d.companies.filter((id) => cur.some((r) => r.c === id));
  const cols = METRICS.filter(([k]) => cur.some((r) => r.m === k));

  return (
    <>
      <section className="controls">
        <Field label="תקופה"><select value={P} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p.k} value={p.k}>{periodLabel(p.k)}</option>)}</select></Field>
        <Field label="פעילות"><select value={A} onChange={(e) => setAct(e.target.value as Act)}>{ACTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="מדד"><select value={M[0]} onChange={(e) => setMetric(e.target.value)}>{METRICS.map(([k, l, u]) => <option key={k} value={k}>{l}{u === 'p' ? ' (נגזר)' : ''}</option>)}</select></Field>
      </section>

      <Panel title={`${M[1]} · ${actLabel}`} aside={<span>{M[2] === 'p' ? 'אחוזים' : 'מיליוני ש"ח'} · {periodLabel(P)} · {have.length}/{d.companies.length} חברות</span>}>
        {have.length === 0 ? <Empty title="לא דווח" /> : (
          <div className="scroll"><table><tbody>{ranked.map(({ id, r }, i) => (
            <tr key={id}>
              <td>{r && <Sourced className="num muted" src={() => rankProv(`דירוג ${M[1]} · ${actLabel} · ${periodLabel(P)}`, i + 1, have.map((q) => ({ label: name(q.id), v: fmt(q.r!.v, M[2]), src: () => econProv(q.r!, name(q.id)) })))}>{i + 1}</Sourced>} <Link to={`/company/${id}`}>{name(id)}</Link></td>
              <td style={{ width: '30%' }}>{r && <div className="bar"><i style={{ width: `${(Math.abs(r.v) / max) * 100}%`, background: r.v < 0 ? 'var(--down)' : pal[d.companies.indexOf(id) % pal.length] }} /></div>}</td>
              <td>{r ? <Sourced className={`num ${r.v < 0 ? 'neg' : ''}`} title={r.l} href={!r.der && r.url ? pdfPage(r.url, r.pg) : null} src={() => econProv(r, name(id))}>{fmt(r.v, M[2])}</Sourced> : <span className="num">לא דווח</span>}</td>
              <td>{r ? <Chips r={r} combinedOnly={d.limits[id]?.includes('combined_only') ?? false} /> : why(d.limits[id] ?? [], A, M[0]).map((l) => <span key={l} className="chip pending">{LIMIT[l]}</span>)}</td>
              <td>{r && <Src r={r} />}</td>
            </tr>
          ))}</tbody></table></div>
        )}
      </Panel>

      <Panel title={`${actLabel} · ${periodLabel(P)}`} aside={<span>מיליוני ש"ח · יחסים באחוזים</span>}>
        {inView.length === 0 ? <Empty title="לא דווח" /> : (
          <div className="scroll"><table>
            <thead><tr><th>חברה</th>{cols.map(([k, l, u]) => <th key={k}>{l}{u === 'p' && <> <span className="chip est">נגזר</span></>}</th>)}<th>גילוי</th></tr></thead>
            <tbody>{inView.map((id) => (
              <tr key={id}>
                <td><Link to={`/company/${id}`}>{name(id)}</Link></td>
                {cols.map(([k, , u]) => {
                  const r = cell.get(`${id}|${k}`);
                  if (!r) return <td key={k}><span className="muted">–</span></td>;
                  const v = <Sourced className={`num ${r.v < 0 ? 'neg' : ''}`} href={!r.der && r.url ? pdfPage(r.url, r.pg) : null} src={() => econProv(r, name(id))}>{fmt(r.v, u)}</Sourced>;
                  return <td key={k} title={`${r.l} · עמ׳ ${r.pg ?? '–'}`}>{v}{k === 'profit' && r.kind && KIND[r.kind] && <span className="dim">{KIND[r.kind]}</span>}{r.pg != null && <span className="dim num">עמ׳ {r.pg}</span>}</td>;
                })}
                <td>{[...(d.limits[id] ?? []).map((l) => LIMIT[l]), ...(cur.some((r) => r.c === id && r.ent) ? ['כלל החברה'] : [])].map((l) => <span key={l} className="chip">{l}</span>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
