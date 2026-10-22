import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart } from '../../components/Chart';
import { Sourced } from '../../components/Source';
import { useSource, type Prov } from '../../lib/prov';
import { Empty, ErrorBox, Field, Loading, Panel, Seg } from '../../components/ui';
import { ContextBar, Sheet } from '../../components/Sheet';
import { CHART_FONT, chartBase } from '../../lib/theme';
import { usePhone } from '../../lib/useMedia';
import { nf, sn, dateLabel } from '../../lib/format';
import { BASIS, factProv, lineProv, periodName } from '../../lib/csm';
import type { RF } from '../../lib/csm';
import { INSURERS, MM, amt, at, closingAt, shockHe, useSens, type Ledger, type SensRow } from '../../lib/csmData';
import { Dot } from './LedgerView';
import { useParam } from './params';

type EffPick = 'csm' | 'profit' | 'equity';
type Unit = 'v' | 'csm' | 'eq';
const EFF_L: Record<EffPick, string> = { csm: 'השפעה על CSM', profit: 'השפעה על הרווח', equity: 'השפעה על ההון' };
const ORDER: Record<string, number> = { rate: 0, equity: 1, morbidity: 2, mortality: 3, lapse: 4, expense: 5, other: 6 };
const keyOf = (r: SensRow) => `${r.risk}|${r.dir ?? 'x'}|${r.size ?? ''}`;

/** The sensitivity disclosures side by side: one row per standard shock, one column per insurer, in shekels or relative to the insurer's own CSM or equity. */
export function SensView({ L, name }: { L: Ledger; name: (id: string) => string }) {
  const { open } = useSource();
  const phone = usePhone();
  const S = useSens();
  const [eff, setEff] = useParam<EffPick>('e', 'csm', ['csm', 'profit', 'equity']);
  const [basis, setBasis] = useParam<'net' | 'gross'>('b', 'net', ['net', 'gross']);
  const [unit, setUnit] = useParam<Unit>('u', 'v', ['v', 'csm', 'eq']);
  const [co, setCo] = useParam('c', 'phoenix', INSURERS);
  const [ctl, setCtl] = useState(false);
  const rows = S.data?.rows ?? [];
  const ids = INSURERS.filter((id) => rows.some((r) => r.c === id));
  const rp = rows[0]?.rp ?? '';
  // the denominators: closing CSM and shareholders' equity at the same balance date, from the same report
  const base = useMemo(() => new Map(ids.map((id) => { const rs = L.byCo.get(id); const c = rs && rows[0] ? closingAt(rs, rows[0].d, basis) : null, a = rs && rp ? at(rs, id, rp, 'fy', basis) : null; return [id, { csm: c?.l ?? null, scope: c?.scope ?? '', eq: a?.eq ?? null }]; })), [L, ids, rp, basis, rows]);

  const shocks = useMemo(() => {
    const m = new Map<string, SensRow>();
    rows.filter((r) => r.dir != null).forEach((r) => { if (!m.has(keyOf(r))) m.set(keyOf(r), r); });
    return [...m.entries()].sort(([, a], [, b]) => ORDER[a.risk] - ORDER[b.risk] || (b.dir ?? 0) - (a.dir ?? 0) || (a.size ?? 0) - (b.size ?? 0));
  }, [rows]);
  const odd = useMemo(() => [...new Map(rows.filter((r) => r.dir == null).map((r) => [`${r.c}|${r.shock}`, r])).values()], [rows]);

  /** the printed figure for one insurer, shock and effect: the basis asked for, else the basis printed; profit and equity printed together count for both */
  const cell = (id: string, test: (r: SensRow) => boolean): SensRow | null => {
    const xs = rows.filter((r) => r.c === id && test(r) && (eff === 'csm' ? r.eff === 'csm' : r.eff === eff || r.eff === 'pe'));
    const rank = (r: SensRow) => (r.b === basis ? 0 : r.b === 'na' ? 1 : 2) + (r.eff === 'pe' ? 0.5 : 0);
    return [...xs].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  };
  const asRF = (r: SensRow): RF => ({ c: r.c, m: `sensitivity:${r.shock}`, s: r.s, g: r.seg, b: r.b, w: 'instant', d: r.d, v: r.v, pg: r.pg, l: r.l, u: r.u, rp: r.rp });
  const title = (r: SensRow) => `${shockHe(r)} · ${EFF_L[eff]} · ${name(r.c)} · ${dateLabel(r.d)}`;
  const printed = (r: SensRow): Prov => {
    const p = factProv(asRF(r), L.d, title(r), amt(r.v));
    return p.k === 'report' ? { ...p, note: [r.l, r.seg === 'group' ? 'קבוצה' : 'חיים ובריאות', `בסיס: ${BASIS[r.b] ?? r.b}`, r.eff === 'pe' ? 'רווח והון בשורה אחת' : '', r.tax === 'after' ? 'אחרי מס' : r.eff !== 'csm' ? 'לא צוין לפני או אחרי מס' : ''].filter(Boolean).join(' · ') } : p;
  };
  const denom = (id: string) => (unit === 'csm' ? base.get(id)?.csm?.v ?? null : unit === 'eq' ? base.get(id)?.eq?.v ?? null : null);
  // a relative figure keeps one basis: an effect printed on another basis than the balance is not divided by it
  const shown = (r: SensRow): number | null => { if (unit === 'v') return r.v; if (unit === 'csm' && r.b !== basis && r.b !== 'na') return null; const dd = denom(r.c); return dd ? (r.v / dd) * 100 : null; };
  const text = (v: number) => (unit === 'v' ? (v > 0 ? '+' : '') + amt(v) : `${sn(v, 2)}%`);
  const prov = (r: SensRow): Prov => {
    if (unit === 'v') return printed(r);
    const b = base.get(r.c)!, v = shown(r)!, dl = unit === 'csm' ? 'יתרת CSM' : 'הון לבעלי המניות';
    const dsrc = unit === 'csm' ? () => lineProv(b.csm!, L.d, `${dl} · ${BASIS[basis]} · ${b.scope} · ${name(r.c)}`) : () => factProv(b.eq!, L.d, `${dl} · ${name(r.c)}`);
    return { k: 'calc', title: `${title(r)} · % מ${dl}`, value: `${sn(v, 2)}%`, formula: `ההשפעה המודפסת ÷ ${dl} לאותו תאריך × 100`, inputs: [{ label: 'השפעה, כפי שהודפסה', v: amt(r.v), src: () => printed(r) }, { label: dl, v: amt(unit === 'csm' ? b.csm!.v : b.eq!.v), src: dsrc }] };
  };
  const Cell = ({ r }: { r: SensRow | null }) => {
    if (!r) return <span className="muted">–</span>;
    const v = shown(r);
    if (v == null) return <span className="muted">–</span>;
    const h = r.u && r.pg != null ? `${r.u}#page=${r.pg}` : null;
    return <><Sourced className={`num ${unit === 'v' ? '' : 'der'} ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}`} href={unit === 'v' ? h : null} src={() => prov(r)}>{text(v)}</Sourced>
      {(r.b !== basis || r.eff === 'pe' || (r.eff !== 'csm' && r.tax == null)) && <sup className="mk" title={[r.b !== basis ? `בסיס ${BASIS[r.b] ?? r.b}` : '', r.eff === 'pe' ? 'רווח והון בשורה אחת' : '', r.eff !== 'csm' && r.tax == null ? 'לא צוין לפני או אחרי מס' : ''].filter(Boolean).join(' · ')}>{r.b !== basis ? (r.b === 'na' ? 'ל' : BASIS[r.b]?.[0]) : ''}{r.eff === 'pe' ? '±' : ''}{r.eff !== 'csm' && r.tax == null ? '*' : ''}</sup>}</>;
  };

  if (S.error) return <ErrorBox what="רגישויות" error={S.error} />;
  if (!S.data) return <Loading what="רגישויות" />;
  if (!rows.length) return <Empty title="לא חולצו גילויי רגישות" />;

  const C = ids.includes(co) ? co : ids[0];
  const tor = shocks.map(([k, s]) => ({ k, s, r: cell(C, (r) => keyOf(r) === k) })).filter((x) => x.r && shown(x.r) != null);
  const controls = (
    <section className="controls">
      <div className="field"><span>השפעה על</span><Seg<EffPick> label="השפעה על" value={eff} onChange={setEff} options={[['csm', 'CSM'], ['profit', 'רווח'], ['equity', 'הון']]} /></div>
      <div className="field"><span>בסיס</span><Seg<'net' | 'gross'> label="בסיס" value={basis} onChange={setBasis} options={[['net', 'נטו'], ['gross', 'ברוטו']]} /></div>
      <div className="field"><span>יחידה</span><Seg<Unit> label="יחידה" value={unit} onChange={setUnit} options={[['v', 'מיליוני ש"ח'], ['csm', '% מה-CSM'], ['eq', '% מההון']]} /></div>
    </section>
  );
  const pages = ids.map((id) => { const r = rows.find((x) => x.c === id && x.pg != null); return { id, r }; });
  return (
    <>
      {phone ? <><ContextBar onOpen={() => setCtl(true)}>{EFF_L[eff]} · {BASIS[basis]} · {unit === 'v' ? 'מיליוני ש"ח' : unit === 'csm' ? '% מה-CSM' : '% מההון'}</ContextBar><Sheet open={ctl} onClose={() => setCtl(false)} title="רגישויות">{controls}</Sheet></> : controls}
      <Panel title={`רגישויות · ${EFF_L[eff]}`} aside={<span>{periodName(rp)} · {unit === 'v' ? 'מיליוני ש"ח, כפי שהודפס' : 'נגזר: ההשפעה ÷ היתרה של החברה'}</span>}>
        <div className="scroll"><table className="sens csm-sens">
          <thead><tr><th>תרחיש</th>{ids.map((id) => <th key={id}><button type="button" className={`thsel ${C === id ? 'on' : ''}`} onClick={() => setCo(id)}><Dot id={id} />{name(id)}</button></th>)}</tr></thead>
          <tbody>
            {shocks.map(([k, s]) => (
              <tr key={k}><td className="lbl">{shockHe(s)}<span className="dim">{s.risk === 'rate' || s.risk === 'equity' ? 'קבוצה' : 'חיים ובריאות'}</span></td>
                {ids.map((id) => <td key={id}><Cell r={cell(id, (r) => keyOf(r) === k)} /></td>)}</tr>
            ))}
            {odd.map((o) => (
              <tr key={`${o.c}|${o.shock}`} className="odd"><td className="lbl">{shockHe(o)}, עמודה נוספת<span className="dim">{name(o.c)}: הכותרת הודפסה פעמיים, הכיוון לא צוין</span></td>
                {ids.map((id) => <td key={id}>{id === o.c ? <Cell r={cell(id, (r) => r.dir == null && r.shock === o.shock)} /> : null}</td>)}</tr>
            ))}
          </tbody>
          <tfoot><tr><td>עמוד בדוח</td>{pages.map(({ id, r }) => <td key={id}>{r?.u && r.pg != null ? <a className="num" href={`${r.u}#page=${r.pg}`} target="_blank" rel="noreferrer">עמ׳ {r.pg}</a> : '–'}</td>)}</tr>
            {unit !== 'v' && <tr><td>{unit === 'csm' ? `יתרת CSM, ${BASIS[basis]}` : 'הון לבעלי המניות'}</td>{ids.map((id) => { const b = base.get(id)!, v = unit === 'csm' ? b.csm?.v : b.eq?.v; return <td key={id}>{v != null ? <><Sourced className="num" src={() => (unit === 'csm' ? lineProv(b.csm!, L.d, `יתרת CSM · ${BASIS[basis]} · ${b.scope} · ${name(id)}`) : factProv(b.eq!, L.d, `הון לבעלי המניות · ${name(id)}`))}>{amt(v)}</Sourced>{unit === 'csm' && <span className="dim">{b.scope}</span>}</> : <span className="muted" title="לא הודפסה יתרה על הבסיס הזה">–</span>}</td>; })}</tr>}
          </tfoot>
        </table></div>
        <div className="src">כל חברה מגדירה את התרחיש בעצמה (ריבית חסרת סיכון או עקום ההיוון כולו; מניות לפי חשיפה); השוו כיוון וגודל, לא שקל מול שקל. ריבית ומניות: קבוצה; תחלואה ותמותה: מגזרי חיים ובריאות. סימונים: ל = בסיס לא צוין, נ/ב = בסיס אחר מהנבחר, ± = רווח והון בשורה אחת, * = לא צוין לפני או אחרי מס. {MM} אלא אם צוין אחרת.</div>
      </Panel>

      <Panel title={`מפת רגישות · ${name(C)}`} aside={<Field label=""><select aria-label="חברה" value={C} onChange={(e) => setCo(e.target.value)}>{ids.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select></Field>}>
        {tor.length === 0 ? <Empty title="אין גילוי לתרחישים ולהשפעה שנבחרו" /> : (
          <Chart label={`רגישות ${EFF_L[eff]} · ${name(C)}`} height={Math.max(220, tor.length * 34 + 60)} deps={[C, eff, basis, unit, tor.length]} build={() => {
            const b = chartBase(), xs = [...tor].sort((p, q) => Math.abs(shown(p.r!)!) - Math.abs(shown(q.r!)!));
            return {
              animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 8, right: 8, top: 26, bottom: 6, containLabel: true },
              tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => { const x = xs[ps[0].dataIndex]; return `${shockHe(x.s)}: <b>‎${text(shown(x.r!)!)}</b>`; } },
              xAxis: { type: 'value', name: unit === 'v' ? 'מיליוני ש"ח' : '%', nameTextStyle: { color: b.mu, fontSize: 11 }, axisLabel: { color: b.mu, fontSize: 10.5, formatter: (v: number) => `‎${nf(v, unit === 'v' ? 0 : 1)}` }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
              yAxis: { type: 'category', data: xs.map((x) => shockHe(x.s)), axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } }, axisLabel: { color: b.fg, fontSize: 11.5 } },
              series: [{ type: 'bar', barMaxWidth: 20, data: xs.map((x) => { const v = shown(x.r!)!; return { value: +v.toFixed(3), itemStyle: { color: v < 0 ? b.down : b.up, borderRadius: 2 } }; }),
                label: { show: true, position: 'right', color: b.mu, fontSize: 10.5, formatter: (p: { value: number }) => `‎${text(p.value)}` } }],
            };
          }} onPoint={(_, di) => { const xs = [...tor].sort((p, q) => Math.abs(shown(p.r!)!) - Math.abs(shown(q.r!)!)); const x = xs[di]; if (x?.r) open(prov(x.r)); }} />
        )}
        <div className="src"><Link to={`/company/${C}/ifrs17`}>כל הרגישויות של {name(C)} בדוח</Link></div>
      </Panel>
    </>
  );
}
