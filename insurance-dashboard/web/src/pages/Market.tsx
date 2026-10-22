/* The regulator's view of one managing group (embedded in the company "חיסכון ארוך טווח" tab). The former /market/* pages are views of the Savings Lens now (pages/SavingsLens*.tsx). */
import { foxOption } from '../lib/foxchart';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { useSource } from '../lib/prov';
import { BreakChip, Empty, Field, Panel } from '../components/ui';
import { chartBase, palette } from '../lib/theme';
import { METRIC_BY_KEY, type Market, type MetricKey, type Win } from '../lib/market';
import { cls, fmt } from '../lib/format';
import { DataTable } from '../components/DataTable';
import '../styles/market.css';
import '../styles/prov-market.css';

function fmtMetric(key: MetricKey, v: number | null, signed = false): string {
  if (v == null || Number.isNaN(v)) return '–';
  const def = METRIC_BY_KEY[key];
  return fmt(v, def.unit === '%' ? 'pct' : 'n', { d: def.dec ?? (def.unit === '%' ? 1 : Math.abs(v) < 10 ? 2 : 1), signed });
}
const signedKey = (k: MetricKey) => k !== 'assets' && k !== 'share' && k !== 'fee';
const toneOf = (k: MetricKey, v: number | null) => (signedKey(k) ? cls(v) : '');
/** A regulator aggregate that opens its source. */
function MV({ m, k, pi, w, set, g, v, signed = signedKey(k) }: { m: Market; k: MetricKey; pi: number; w: Win; set: string; g: number; v: number | null; signed?: boolean }) {
  const t = <span className={`num ${toneOf(k, v)}`}>{fmtMetric(k, v, signed)}</span>;
  return v == null || Number.isNaN(v) ? t : <Sourced src={() => m.explain(k, pi, w, set, g)}>{t}</Sourced>;
}

/* ---------- group (also embedded in the company "savings" tab) ---------- */

const CM: MetricKey[] = ['assets', 'share', 'organic', 'rate', 'fee', 'ret'];
export function GroupPanel({ m, group, standalone = false }: { m: Market; group: string; standalone?: boolean }) {
  const nav = useNavigate();
  const { open } = useSource();
  const [set, setSet] = useState('all');
  const [metric, setMetric] = useState<MetricKey>('assets');
  const gi = m.groupIndex(group);
  if (gi < 0) return <Empty title="הקבוצה לא נמצאה">אין נתוני שוק לשם זה.</Empty>;
  const L = m.LAST, def = METRIC_BY_KEY[metric], win: Win = def.win ? 'ltm' : 'm';
  const rows = CM.map((k) => {
    const w: Win = METRIC_BY_KEY[k].win ? 'ltm' : 'm';
    return { k, now: m.value(k, L, w, set, gi), prev: L >= 12 ? m.value(k, L - 12, w, set, gi) : null, mk: m.value(k, L, w, set, -1) };
  });
  const dec = def.dec ?? 1;
  const own = m.P.map((_, i) => m.value(metric, i, win, set, gi));
  const mkt = m.P.map((_, i) => m.value(metric, i, win, set, -1));
  const pts = m.P.map((p, i) => (p % 100 === 12 || i === L ? i : -1)).filter((i) => i >= 0);
  const prodIdx = m.d.products.map((_, i) => i).filter((i) => m.sets.find((s) => s.id === set)!.has.has(i) && pts.some((pi) => m.cell(pi, 'p:' + m.d.products[i].key, gi).a > 0));
  const gopts = m.activeGroups(L, 'all').map((g) => m.d.groups[g]);
  if (!gopts.includes(group)) gopts.push(group);

  return (
    <>
      {standalone && <div className="pagehead"><div><h1>{group}</h1><div className="sub">שוק החיסכון הפנסיוני · קבוצה</div></div>
        <Field label="קבוצה"><select value={group} onChange={(e) => nav(`/industry/savings?g=${encodeURIComponent(e.target.value)}`)}>{gopts.map((g) => <option key={g}>{g}</option>)}</select></Field></div>}
      <section className="controls"><Field label="מוצר"><select value={set} onChange={(e) => setSet(e.target.value)}>{m.sets.map((s) => <option key={s.id} value={s.id}>{s.sub ? '  ' : ''}{s.label}</option>)}</select></Field></section>
      <div className="grid21">
        <Panel title={def.label} aside={<>{def.unit === 'bn' ? 'מיליארד ש"ח' : def.win ? 'LTM' : null} <BreakChip b={m.breaksFor(metric, set)[0]} /></>}>
          <Chart label="סדרה לאורך זמן" height={320} deps={[m, group, set, metric]} onPoint={(si, di) => { if ((si === 0 ? own : mkt)[di] != null) open(m.explain(metric, di, win, set, si === 0 ? gi : -1)); }} build={() => {
            const b = chartBase(), pct = def.unit === '%';
            return foxOption({ x: m.P.map((_, i) => m.plabel(i)), unit: pct ? '%' : def.unit === 'bn' ? 'מיליארד ש"ח' : '', dense: true, scale: !!def.ratio, legend: true, series: [
              { name: group, kind: 'line', lead: true, pct, color: b.accent, dec, data: own.map((v) => (v == null ? null : +v.toFixed(3))) },
              ...(def.ratio ? [{ name: 'כלל השוק', kind: 'line' as const, dashed: true, pct, color: b.mu, dec, data: mkt.map((v) => (v == null ? null : +v.toFixed(3))) }] : [])] });
            }} />
        </Panel>
        <Panel title={`מדדים, ${m.plabel(L)}`}>
          <DataTable caption={`מדדים, ${m.plabel(L)}`} rows={rows} rowKey={(r) => r.k} rowClass={(r) => (r.k === metric ? 'on' : undefined)}
            rowProps={(r) => ({ style: { cursor: 'pointer' }, onClick: (e) => { if (!(e.target as HTMLElement).closest('.src')) setMetric(r.k); } })}
            columns={[
              { key: 'k', head: 'מדד', text: (r) => METRIC_BY_KEY[r.k].short, cell: (r) => <>{METRIC_BY_KEY[r.k].short}{METRIC_BY_KEY[r.k].win && <span className="dim">LTM</span>} <BreakChip b={m.breakOf(r.k, set, L - 12, L)} /></> },
              { key: 'now', head: m.plabel(L), text: (r) => fmtMetric(r.k, r.now), cell: (r) => <MV m={m} k={r.k} pi={L} w="ltm" set={set} g={gi} v={r.now} signed={false} /> },
              { key: 'prev', head: m.plabel(L - 12), text: (r) => fmtMetric(r.k, r.prev), cell: (r) => <MV m={m} k={r.k} pi={L - 12} w="ltm" set={set} g={gi} v={r.prev} signed={false} /> },
              { key: 'mk', head: 'כלל השוק', text: (r) => fmtMetric(r.k, r.mk), cell: (r) => <MV m={m} k={r.k} pi={L} w="ltm" set={set} g={-1} v={r.mk} signed={false} /> },
            ]} />
          <div className="fnote">לחיצה על שורה מחליפה את הגרף. תזרימים כוללים פנסיה וגמל בלבד.</div>
        </Panel>
      </div>
      <Panel title={`נכסים לפי מוצר (מיליארד ש"ח, דצמבר של כל שנה ו-${m.plabel(L)})`}>
        <Chart label="נכסים לפי מוצר" height={280} deps={[m, group, set]} onPoint={(si, di) => { const i = prodIdx[si]; if (i != null && pts[di] != null) open(m.explain('assets', pts[di], 'm', 'p:' + m.d.products[i].key, gi)); }} build={() => {
          const pal = palette();
          return foxOption({ x: pts.map((i) => (i === L ? m.plabel(i) : String(Math.floor(m.P[i] / 100)))), unit: 'מיליארד ש"ח', full: true, total: true, labels: false,
            series: prodIdx.map((i) => ({ name: m.d.products[i].label, kind: 'bar' as const, stack: true, color: pal[i % pal.length], dec: 1, data: pts.map((pi) => +(m.cell(pi, 'p:' + m.d.products[i].key, gi).a / 1000).toFixed(2)) })) });
            }} />
      </Panel>
    </>
  );
}
