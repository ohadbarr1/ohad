import { palette } from '../../lib/theme';
import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Chart } from '../../components/Chart';
import { Sourced } from '../../components/Source';
import { Empty, ErrorBox, Loading, Panel, Seg } from '../../components/ui';
import { foxOption } from '../../lib/foxchart';
import { idColor } from '../../lib/identity';
import { usePhone } from '../../lib/useMedia';
import { pct } from '../../lib/format';
import { amt, cellProv, pageHref, qShort, useStdIndustry, whyOf, type Cell, type MetricId, type StdIndustry } from '../../lib/ifrsStd';
import { useParam } from './params';
import '../../styles/ifrsStd.css';

type Scope = 'lh' | 'pc' | 'vfa' | 'gmm_paa';
const SCOPES: [Scope, string][] = [['lh', 'חיים ובריאות'], ['pc', 'כללי'], ['vfa', '≈VFA · חיסכון תלוי תשואה'], ['gmm_paa', 'שאר תיקי חיים ובריאות']];
const MODEL_METRICS: MetricId[] = ['csm', 'ra', 'be', 'insurance_revenue', 'isr_before_reinsurance'];
const METRIC_ORDER: MetricId[] = ['insurance_revenue', 'insurance_service_expenses', 'isr_before_reinsurance', 'reinsurance_result', 'insurance_service_result', 'csm', 'ra', 'be', 'lrc_excl_lc', 'loss_component', 'lic', 'losses_onerous'];
const flagMark = (c: Cell) => ((c[3] ?? 0) & 1 ? 'נגזר' : (c[3] ?? 0) & 4 ? 'גרף' : (c[3] ?? 0) & 2 ? 'הוצג מחדש' : '');

/** One number of the grid: opens its page (or its arithmetic); an empty cell carries the reason it is empty. */
export function StdCell({ c, title, why, fmt = amt }: { c: Cell | undefined | null; title: string; why?: string; fmt?: (v: number) => string }) {
  if (!c) return <span className="std-null" title={why ?? 'לא הודפס'}>–</span>;
  const m = flagMark(c);
  return <Sourced src={() => cellProv(c, title)} href={(c[3] ?? 0) & 1 ? null : pageHref(c[2], c[1])} className={m ? 'std-der' : undefined} title={m || undefined}>{fmt(c[0])}</Sourced>;
}

/** The standardised IFRS 17 grid across the seven insurers: one metric, every quarter, on a scope each filer prints (or its own model mapping). */
export function StdView({ name }: { name: (id: string) => string }) {
  const { data: D, error } = useStdIndustry();
  const phone = usePhone();
  const [scope, setScope] = useParam<Scope>('sc', 'lh', SCOPES.map(([k]) => k));
  const [metric, setMetric] = useParam<MetricId>('mt', 'csm', METRIC_ORDER);
  if (error) return <ErrorBox what="שכבת IFRS 17 המתוקננת" error={error} />;
  if (!D) return <Loading what="שכבת IFRS 17 המתוקננת" />;
  const model = scope === 'vfa' || scope === 'gmm_paa';
  const metrics = model ? MODEL_METRICS : METRIC_ORDER;
  const m = metrics.includes(metric) ? metric : 'csm';
  const Q = D.quarters, ids = D.insurers;
  const ser = (id: string) => D.table[id]?.[scope]?.[m] ?? {};
  const label = `${D.metrics[m].he} · ${SCOPES.find(([k]) => k === scope)![1]}`;
  return (
    <div className="std">
      <Panel title="IFRS 17 מתוקנן" aside={<span className="muted">מיליוני ש"ח · רבעונים · {D.metrics[m].kind === 'stock' ? 'יתרה לסוף רבעון' : 'תנועת הרבעון'}</span>}>
        <div className="std-tools">
          <Seg label="היקף" value={scope} options={SCOPES} onChange={setScope} />
          <select aria-label="מדד" value={m} onChange={(e) => setMetric(e.target.value as MetricId)}>
            {metrics.map((k) => <option key={k} value={k}>{D.metrics[k].he}</option>)}
          </select>
        </div>
        {model && <p className="src">{D.model_note}</p>}
        <div className="scroll"><table className="std-grid">
          <thead><tr><th>חברה</th>{Q.map((k) => <th key={k} className="num">{qShort(k)}</th>)}</tr></thead>
          <tbody>{ids.map((id) => <tr key={id}><th><Link to={`/company/${id}/ifrs17`}>{name(id)}</Link></th>{Q.map((k) => <td key={k} className="num"><StdCell c={ser(id)[k]} title={`${label} · ${name(id)} · ${qShort(k)}`} why={k < '2025Q1' ? D.reasons[0] : nullWhy(D, id, scope, m, k)} /></td>)}</tr>)}</tbody>
        </table></div>
        <Chart label={label} height={phone ? 260 : 300} deps={[scope, m]} source="דוחות החברות, MAYA · ביאור קבוצות תיקים עיקריות" asof={qShort(Q[Q.length - 1])}
          build={() => foxOption({ x: Q.map(qShort), unit: 'מיליוני ש"ח', dense: false, legend: true, labels: false, full: true,
            series: ids.map((id) => ({ name: name(id), kind: 'line' as const, color: idColor(id), data: Q.map((k) => ser(id)[k]?.[0] ?? null) })) })} />
        <p className="src">2023: {D.no_2023}. נגזר = הפרש מצטברים שהודפסו (Q4 = שנה פחות 9 חודשים) או סכום מגזרים; כל מספר פותח את העמוד שבו הודפס. מקור: {D.source}.</p>
      </Panel>
      <RunoffPanel D={D} name={name} />
      <OnerousPanel D={D} name={name} />
      <ReconPanel D={D} name={name} />
    </div>
  );
}

function nullWhy(D: StdIndustry, id: string, scope: Scope, m: MetricId, k: string): string {
  const n = D.nulls[id] ?? {};
  const w = scope === 'pc' ? n.pc?.[m]?.[k] : n.life?.[m]?.[k] ?? n.health?.[m]?.[k];
  return whyOf(D, w);
}

/** The expected release of the closing CSM, by the filer's own time buckets and on the four standard ones. */
function RunoffPanel({ D, name }: { D: StdIndustry; name: (id: string) => string }) {
  const phone = usePhone();
  const [basis, setBasis] = useParam<'gross' | 'reinsurance'>('rb', 'gross', ['gross', 'reinsurance']);
  const rows = D.insurers.map((id) => {
    const t = D.runoff[id] ?? {};
    const pick = t[`group|${basis}`] ?? t[`life|${basis}`] ?? null;
    return { id, t: pick, parts: pick ? null : (['life', 'health'] as const).map((s) => t[`${s}|${basis}`]).filter(Boolean) };
  });
  const std = (r: (typeof rows)[number]) => r.t?.std ?? null;
  const total = (r: (typeof rows)[number]) => (std(r) ?? []).reduce((s, b) => s + (typeof b[2] === 'number' ? b[2] : 0), 0);
  if (!rows.some((r) => r.t)) return <Panel title="הכרה צפויה ב-CSM"><Empty title="לא הודפסה טבלת הכרה צפויה" /></Panel>;
  const B = ['1', '2-5', '5-10', '10+'], BH: Record<string, string> = { '1': 'עד שנה', '2-5': '1–5', '5-10': '5–10', '10+': 'מעל 10' };
  const val = (r: (typeof rows)[number], b: string) => { const x = std(r)?.find((s) => s[0] === b); return x && typeof x[2] === 'number' ? x : null; };
  return (
    <Panel title="CSM run-off · הכרה צפויה ב-CSM" aside={<Seg label="בסיס" value={basis} options={[['gross', 'ברוטו'], ['reinsurance', 'ביטוח משנה']]} onChange={setBasis} />}>
      <div className="scroll"><table className="std-grid">
        <thead><tr><th>חברה</th><th>היקף</th>{B.map((b) => <th key={b} className="num">{BH[b]} שנים</th>)}<th className="num">% עד 5 שנים</th></tr></thead>
        <tbody>{rows.filter((r) => r.t).map((r) => <tr key={r.id}><th>{name(r.id)}</th><td>{D.segs[r.t!.seg] ?? (r.t!.seg === 'group' ? 'קבוצה' : r.t!.seg)}</td>
          {B.map((b) => { const x = val(r, b); return <td key={b} className="num">{x ? <StdCell c={(x.length > 5 ? [x[2], null, null, 1, (x[6] as unknown[][]).map((p) => [1, p[1], p[2], p[3], p[0]])] : [x[2], x[3], x[4]]) as Cell} title={`הכרה צפויה ב-CSM · ${BH[b]} שנים · ${name(r.id)} · 31.12.25`} /> : <span className="std-null" title={String(val(r, b) ?? std(r)?.find((s) => s[0] === b)?.[3] ?? '')}>–</span>}</td>; })}
          <td className="num">{total(r) ? pct(((val(r, '1')?.[2] as number ?? 0) + (val(r, '2-5')?.[2] as number ?? 0)) / total(r) * 100, 0) : '–'}</td></tr>)}</tbody>
      </table></div>
      <Chart label="פריסת שחרור ה-CSM הצפויה, % מהיתרה" height={phone ? 260 : 280} deps={[basis]} source="דוחות החברות לשנת 2025, טבלת ההכרה הצפויה ב-CSM" asof="31.12.25"
        build={() => foxOption({ x: rows.filter((r) => r.t).map((r) => name(r.id)), unit: '%', legend: true, labels: false,
          series: B.map((b, i) => ({ name: `${BH[b]} שנים`, stack: true, kind: 'bar' as const, color: palette()[i],
            data: rows.filter((r) => r.t).map((r) => { const x = val(r, b), t = total(r); return x && t ? +((x[2] as number) / t * 100).toFixed(1) : null; }) })) })} />
      <p className="src">המדרגות כפי שהודפסו (עד שנה, 1–2 ... מעל 15) נסכמות לארבעה טווחים; סכום מסומן כנגזר ופותח את המדרגות שהודפסו. ליום 31.12.2025, מהדוח השנתי.</p>
    </Panel>
  );
}

/** Onerous contracts: the loss component at each quarter end, by segment. */
function OnerousPanel({ D, name }: { D: StdIndustry; name: (id: string) => string }) {
  const phone = usePhone();
  const [seg, setSeg] = useParam<'life' | 'health' | 'pc'>('os', 'health', ['life', 'health', 'pc']);
  const Q = D.quarters;
  const s = (id: string) => D.onerous[id]?.[seg]?.loss_component ?? {};
  return (
    <Panel title="מעקב חוזים מכבידים · רכיב הפסד (LC)" aside={<Seg label="מגזר" value={seg} options={[['life', 'חיים'], ['health', 'בריאות'], ['pc', 'כללי']]} onChange={setSeg} />}>
      <div className="scroll"><table className="std-grid">
        <thead><tr><th>חברה</th>{Q.map((k) => <th key={k} className="num">{qShort(k)}</th>)}</tr></thead>
        <tbody>{D.insurers.map((id) => <tr key={id}><th>{name(id)}</th>{Q.map((k) => <td key={k} className="num"><StdCell c={s(id)[k]} title={`רכיב הפסד · ${D.segs[seg]} · ${name(id)} · ${qShort(k)}`} /></td>)}</tr>)}</tbody>
      </table></div>
      <Chart label={`רכיב הפסד · ${D.segs[seg]}`} height={phone ? 240 : 260} deps={[seg]} source="דוחות החברות, ביאור קבוצות תיקים עיקריות" asof={qShort(Q[Q.length - 1])}
        build={() => foxOption({ x: Q.map(qShort), unit: 'מיליוני ש"ח', legend: true, labels: false, full: true, series: D.insurers.map((id) => ({ name: name(id), kind: 'line' as const, color: idColor(id), data: Q.map((k) => s(id)[k]?.[0] ?? null) })) })} />
      <p className="src">היתרה ברוטו מהביאור לפי קבוצות תיקים. רוב דוחות הביניים של 2025 אינם מפרטים יתרות לפי תיק; ההפסדים וביטולם לשנה מופיעים בטבלאות התנועה השנתיות (דף החברה).</p>
    </Panel>
  );
}

/** The CSM roll-forward identity, insurer by quarter: opening + movements = closing for every printed roll-forward; every break is listed. */
function ReconPanel({ D, name }: { D: StdIndustry; name: (id: string) => string }) {
  const Q = D.quarters.filter((k) => k >= '2024Q4');
  const r = D.recon;
  return (
    <Panel title="זהות גשר ה-CSM" aside={<span className="muted">{r.ok} מתוך {r.checked} גשרים נסגרים · {r.breaks.length} שבירות · {r.partial.length} חלקיים</span>}>
      <div className="scroll"><table className="std-grid">
        <thead><tr><th>חברה</th>{Q.map((k) => <th key={k} className="num">{qShort(k)}</th>)}</tr></thead>
        <tbody>{D.insurers.map((id) => <tr key={id}><th>{name(id)}</th>{Q.map((k) => {
          const x = D.rf[id]?.[`${k}|q`] ?? D.rf[id]?.[`${k}|ytd`] ?? D.rf[id]?.[`${k}|fy`];
          const w = x ? (x.w === 'q' || (x.w === 'ytd' && k.endsWith('Q1')) ? 'רבעון' : x.w === 'ytd' ? 'מצטבר' : 'שנה') : '';
          return <td key={k} className={`num ${x ? (x.ok ? 'std-ok' : 'std-bad') : ''}`} title={x ? `${w} · ${x.b === 'net' ? 'נטו' : x.b === 'gross' ? 'ברוטו' : 'בסיס לא צוין'} · ${D.segs[x.seg] ?? x.seg}${x.chart ? ' · מגרף' : ''} · הפרש ${amt(x.diff)}` : 'לא הודפס גשר'}>
            {x ? <Sourced src={() => ({ k: 'calc', title: `גשר CSM · ${name(id)} · ${qShort(k)} · ${w}`, value: amt(x.close[0]), unit: 'מיליוני ש"ח', formula: 'פתיחה + תנועות = סגירה',
              inputs: [{ label: 'פתיחה', v: amt(x.open[0]), src: () => cellProv([x.open[0], x.open[1], x.open[2]], `פתיחה · ${name(id)}`) },
                ...x.rows.map((row) => ({ label: `${D.rf_he[row[0]] ?? row[0]}${row[6] ? ` · ${row[6]}` : ''}`, v: amt(row[2]), src: () => cellProv([row[2], row[3], row[4], row[5]], `${row[1]} · ${name(id)}`) })),
                { label: 'סגירה', v: amt(x.close[0]), src: () => cellProv([x.close[0], x.close[1], x.close[2]], `סגירה · ${name(id)}`) }] })}>{x.ok ? '✓' : '✗'} {w}</Sourced> : '–'}
          </td>; })}</tr>)}</tbody>
      </table></div>
      {r.breaks.length > 0 && <ul className="std-breaks">{r.breaks.map((b, i) => <li key={i}>{name(b.c!)} · {b.rp} · {b.seg} · {b.w} · הפרש {amt(b.diff)}</li>)}</ul>}
      {r.partial.length > 0 && <p className="src">חלקיים (לא נבדקו: גרף שמציג שורה או שתיים בלבד): {r.partial.map((b, i) => <Fragment key={i}>{i ? ' · ' : ''}{name(b.c!)} {b.rp} {b.w}</Fragment>)}.</p>}
    </Panel>
  );
}
