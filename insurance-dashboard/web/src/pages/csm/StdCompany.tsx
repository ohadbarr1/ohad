import { cssColor } from '../../lib/theme';
import { Chart } from '../../components/Chart';
import { Sourced } from '../../components/Source';
import { Empty, Panel, Seg } from '../../components/ui';
import { foxOption } from '../../lib/foxchart';
import { usePhone } from '../../lib/useMedia';
import { amt, cellProv, pageHref, qShort, useStdCompany, whyOf, type MetricId, type StdCompany } from '../../lib/ifrsStd';
import { StdCell } from './StdView';
import { useParam } from './params';
import { useRegistry } from '../../lib/useData';
import '../../styles/ifrsStd.css';

const ORDER: MetricId[] = ['insurance_revenue', 'insurance_service_expenses', 'isr_before_reinsurance', 'reinsurance_result', 'insurance_service_result', 'losses_onerous',
  'csm', 'ra', 'be', 'lrc_excl_lc', 'loss_component', 'lic'];
const PORT_METRICS: MetricId[] = ['insurance_revenue', 'isr_before_reinsurance', 'insurance_service_result', 'csm', 'ra', 'be', 'lrc_excl_lc', 'loss_component', 'lic'];
const SEG_OPTS: [string, string][] = [['life', 'חיים וחיסכון'], ['health', 'בריאות'], ['pc', 'כללי'], ['life_health_risk', 'סיכוני חיים ובריאות']];

/** The company's IFRS 17 on the standard grid: every metric by quarter for a segment, its portfolios at a quarter end, and its CSM roll-forwards. */
export function StdCompanyPanel({ id }: { id: string }) {
  const { data: S } = useStdCompany(id);
  const reg = useRegistry();
  const name = reg.data?.find((c) => c.id === id)?.name_he ?? id;
  const phone = usePhone();
  const segs = S ? SEG_OPTS.filter(([k]) => S.segs[k] && Object.values(S.segs[k]).some((x) => Object.keys(x).length)) : [];
  const [seg, setSeg] = useParam('ss', 'life', SEG_OPTS.map(([k]) => k));
  if (!S) return null;
  const M = S.meta, Q = S.quarters;
  const g = segs.some(([k]) => k === seg) ? seg : segs[0]?.[0] ?? 'life';
  const T = S.segs[g] ?? ({} as StdCompany['segs'][string]);
  const ports = Object.keys(M.port_seg).filter((p) => (M.port_seg[p] === g || (g === 'life' && id === 'hachshara' && M.port_seg[p] === 'health') || (g === 'life_health_risk' && M.port_seg[p] !== 'pc')) && S.ports[p]);
  const lastQ = [...Q].reverse().find((k) => ports.some((p) => S.ports[p]?.csm?.[k])) ?? Q[Q.length - 1];
  const vfa = S.models.filter((x) => x.model === 'VFA');
  return (
    <Panel title="IFRS 17 מתוקנן · לפי רבעון" aside={<Seg label="מגזר" value={g} options={segs} onChange={setSeg} />}>
      <div className="scroll"><table className="std-grid">
        <thead><tr><th>מדד · {M.segs[g] ?? g}</th>{Q.map((k) => <th key={k} className="num">{qShort(k)}</th>)}</tr></thead>
        <tbody>{ORDER.map((m) => <tr key={m}><th>{M.metrics[m].he}</th>{Q.map((k) => <td key={k} className="num"><StdCell c={T[m]?.[k]} title={`${M.metrics[m].he} · ${M.segs[g] ?? g} · ${name} · ${qShort(k)}`} why={whyOf(M, S.nulls[g]?.[m]?.[k])} /></td>)}</tr>)}</tbody>
      </table></div>
      <Chart label={`הכנסות ותוצאת שירותי ביטוח · ${M.segs[g] ?? g}`} height={phone ? 240 : 260} deps={[id, g]} source={`${name}, דוחות כספיים, ביאור קבוצות תיקים עיקריות`} asof={qShort(Q[Q.length - 1])}
        build={() => foxOption({ x: Q.map(qShort), unit: 'מיליוני ש"ח', legend: true, labels: false, full: true, series: [
          { name: 'הכנסות משירותי ביטוח', kind: 'bar' as const, color: cssColor('--accent'), data: Q.map((k) => T.insurance_revenue?.[k]?.[0] ?? null) },
          { name: 'תוצאת שירותי ביטוח', kind: 'line' as const, color: cssColor('--up'), data: Q.map((k) => T.insurance_service_result?.[k]?.[0] ?? null) }] })} />

      <h3 className="std-h3">קבוצות תיקים · {qShort(lastQ)}</h3>
      {ports.length === 0 ? <Empty title="הדוח אינו מפרט את המגזר לפי קבוצות תיקים" /> : (
        <div className="scroll"><table className="std-grid">
          <thead><tr><th>תיק</th>{PORT_METRICS.map((m) => <th key={m} className="num">{M.metrics[m].he}</th>)}</tr></thead>
          <tbody>{ports.map((p) => <tr key={p}><th title={(S.port_he[p] ?? []).join(' · ')}>{M.ports[p]}{p === 'life_yield' && vfa.length > 0 && <span className="chip">VFA לפי מדיניות החברה</span>}</th>
            {PORT_METRICS.map((m) => <td key={m} className="num"><StdCell c={S.ports[p]?.[m]?.[lastQ]} title={`${M.metrics[m].he} · ${M.ports[p]} · ${name} · ${qShort(lastQ)}`} /></td>)}</tr>)}</tbody>
        </table></div>
      )}
      {vfa.length > 0 && <p className="src">אין פיצול מודפס VFA מול GMM. מיפוי החברה: {vfa.slice(0, 2).map((x, i) => <span key={i}>{i ? ' · ' : ''}<Sourced src={() => ({ k: 'report', title: `מיפוי מודל המדידה · ${name}`, value: x.model, url: pageHref(x.r, null), pg: x.pg, note: x.l })} href={pageHref(x.r, x.pg)}>{x.ph} → {x.model} (עמ׳ {x.pg})</Sourced></span>)}.</p>}

      <h3 className="std-h3">גשרי CSM שהודפסו</h3>
      {S.rfs.length === 0 ? <Empty title="לא הודפס גשר CSM" /> : (
        <div className="scroll"><table className="std-grid">
          <thead><tr><th>דוח</th><th>חלון</th><th>היקף · בסיס</th><th className="num">פתיחה</th><th className="num">תנועות</th><th className="num">סגירה</th><th className="num">הפרש</th></tr></thead>
          <tbody>{S.rfs.filter((r) => !r.partial).slice(-14).reverse().map((r, i) => <tr key={i}><th>{r.rp}</th><td>{r.w === 'q' ? 'רבעון' : r.w === 'ytd' ? 'מצטבר' : 'שנה'} · {r.d}</td>
            <td>{M.segs[r.seg] ?? (r.seg === 'group' ? 'קבוצה' : r.seg)} · {r.b === 'net' ? 'נטו' : r.b === 'gross' ? 'ברוטו' : r.b === 'reinsurance' ? 'ביטוח משנה' : 'לא צוין'}{r.chart ? ' · גרף' : ''}</td>
            <td className="num"><StdCell c={[r.open[0], r.open[1], r.open[2]]} title={`פתיחה · ${name} · ${r.rp}`} /></td>
            <td className="num"><Sourced src={() => ({ k: 'calc', title: `תנועות CSM · ${name} · ${r.rp}`, value: amt(r.rows.reduce((s, x) => s + x[2], 0)), unit: 'מיליוני ש"ח', formula: 'סכום התנועות שהודפסו', inputs: r.rows.map((x) => ({ label: `${M.rf_he[x[0]] ?? x[0]} · ${x[1]}`, v: amt(x[2]), src: () => cellProv([x[2], x[3], x[4], x[5]], `${x[1]} · ${name}`) })) })}>{amt(r.rows.reduce((s, x) => s + x[2], 0))}</Sourced></td>
            <td className="num"><StdCell c={[r.close[0], r.close[1], r.close[2]]} title={`סגירה · ${name} · ${r.rp}`} /></td>
            <td className={`num ${r.ok ? 'std-ok' : 'std-bad'}`}>{amt(r.diff)}</td></tr>)}</tbody>
        </table></div>
      )}
      <p className="src">כל מספר פותח את העמוד שבו הודפס; נטוי = נגזר (הפרש מצטברים או סכום רכיבים). {M.no_2023}.</p>
    </Panel>
  );
}
