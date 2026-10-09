import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { CHART_FONT, chartBase, palette } from '../lib/theme';
import { nf } from '../lib/format';
import { KPI_BY_KEY, KPI_DEFS, periodLabelShort, type Basis } from '../lib/kpi';
import { useKpis, useRegistry } from '../lib/useData';

const BASIS: [Basis, string][] = [['q', 'QTD'], ['ltm', 'LTM'], ['fy', 'FY']];
const fmt = (v: number | null, unit: string) => (v == null ? '–' : unit === '%' ? nf(v, 1) + '%' : unit === 'x' ? nf(v, 2) : unit === 'nis' ? nf(v, 2) : nf(v, 0));
const UNIT: Record<string, string> = { m: 'מיליוני ש"ח', nis: 'ש"ח', '%': '%', x: 'מכפיל' };

/** One reported KPI across companies and periods. */
export function Compare() {
  const { kpis, notes, error } = useKpis();
  const reg = useRegistry();
  const [sp, setSp] = useSearchParams();
  const [metric, setMetric] = useState(KPI_BY_KEY[sp.get('k') ?? ''] ? sp.get('k')! : 'roe');
  const [basis, setBasis] = useState<Basis>((['q', 'ltm', 'fy'] as Basis[]).find((b) => b === sp.get('b')) ?? 'ltm');
  const [from, setFrom] = useState(Number(sp.get('y')) || 2022);
  const [off, setOff] = useState<string[]>((sp.get('x') ?? '').split(',').filter(Boolean));
  const [index, setIndex] = useState(sp.get('i') === '1');
  const def = KPI_BY_KEY[metric];
  useEffect(() => {
    const q: Record<string, string> = { k: metric, b: basis, y: String(from) };
    if (off.length) q.x = off.join(',');
    if (index) q.i = '1';
    setSp(q, { replace: true });
  }, [metric, basis, from, off, index, setSp]);

  const ids = useMemo(() => (kpis ? [...kpis.keys()] : []), [kpis]);
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  const on = ids.filter((id) => !off.includes(id));
  const data = useMemo(() => {
    if (!kpis) return null;
    const series = new Map(ids.map((id) => [id, kpis.get(id)!.series(metric, basis).filter((p) => Number(p.period.slice(0, 4)) >= from)]));
    const periods = [...new Set([...series.values()].flatMap((s) => s.map((p) => p.period)))].sort((a, b) => (a.slice(0, 4) + (a.endsWith('FY') ? '4' : a.slice(5))).localeCompare(b.slice(0, 4) + (b.endsWith('FY') ? '4' : b.slice(5))));
    const cell = (id: string, p: string) => series.get(id)!.find((x) => x.period === p)?.v ?? null;
    const used = periods.filter((p) => ids.some((id) => cell(id, p) != null));
    return { periods: used, cell };
  }, [kpis, ids, metric, basis, from]);

  if (error) return <ErrorBox what="נתוני ההשוואה" error={error} />;
  if (!kpis || !data) return <Loading what="השוואה" />;
  const pal = palette();
  const color = (id: string) => pal[ids.indexOf(id) % pal.length];
  const last = data.periods[data.periods.length - 1];
  const rank = on.map((id) => ({ id, v: data.cell(id, last) })).filter((r) => r.v != null).sort((a, b) => b.v! - a.v!);
  const max = Math.max(...rank.map((r) => Math.abs(r.v!)), 1e-9);
  const lab = (p: string) => (basis === 'fy' ? p.slice(0, 4) : periodLabelShort(p));
  const idx = (id: string, p: string) => { const base = data.periods.map((x) => data.cell(id, x)).find((v) => v != null); const v = data.cell(id, p); return v == null || !base ? null : (v / base) * 100; };
  const shown = (id: string, p: string) => (index ? idx(id, p) : data.cell(id, p));

  return (
    <>
      <div className="src">{def.label} · {index ? 'אינדקס, תקופה ראשונה = 100' : UNIT[def.unit]}{def.derived && <> · <span className="chip est">נגזר</span></>}</div>
      <section className="controls">
        <Field label="מדד"><select value={metric} onChange={(e) => setMetric(e.target.value)}>
          {(['דוחות', 'יחסים', 'שוק ההון'] as const).map((g) => <optgroup key={g} label={g}>{KPI_DEFS.filter((d) => d.group === g).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>)}
        </select></Field>
        {def.flow && <div className="field"><span>בסיס</span><Seg label="בסיס" value={basis} onChange={setBasis} options={BASIS} /></div>}
        <Field label="משנת"><select value={from} onChange={(e) => setFrom(Number(e.target.value))}>{[2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => <option key={y}>{y}</option>)}</select></Field>
        <div className="field"><span>תצוגה</span><Seg<'v' | 'i'> label="תצוגה" value={index ? 'i' : 'v'} onChange={(v) => setIndex(v === 'i')} options={[['v', 'ערך'], ['i', 'אינדקס 100']]} /></div>
        <div className="field"><span>חברות</span><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ids.map((id) => <button key={id} type="button" className="chip" aria-pressed={!off.includes(id)} onClick={() => setOff((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))}><i className="sw" style={{ background: color(id) }} />{name(id)}</button>)}
        </div></div>
      </section>

      {on.length === 0 || data.periods.length === 0 ? <Empty title="אין נתונים לבחירה" /> : (
        <div className="grid21">
          <Panel title={def.label} aside={<span>{lab(data.periods[0])} עד {lab(last)}</span>}>
            <Chart label={def.label} height={380} deps={[metric, basis, from, on.join(), index, kpis]} build={() => {
              const b = chartBase();
              return {
                animationDuration: 700, animationEasing: 'cubicOut', textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 8, right: 12, top: 14, bottom: 4, containLabel: true },
                tooltip: { trigger: 'axis', confine: true, backgroundColor: b.panel, borderColor: b.ln, textStyle: { color: b.fg, fontSize: 12 }, valueFormatter: (v: number | null) => (index ? (v == null ? '–' : nf(v, 0)) : fmt(v, def.unit)), order: 'valueDesc' },
                xAxis: { type: 'category', data: data.periods.map(lab), boundaryGap: false, axisLine: { lineStyle: { color: b.ln } }, axisTick: { show: false }, axisLabel: { color: b.mu, fontSize: 11 } },
                yAxis: { type: 'value', scale: true, axisLabel: { color: b.mu, fontSize: 11, formatter: (v: number) => `\u200E${v}` }, splitLine: { lineStyle: { color: b.ln, opacity: 0.5 } } },
                series: on.map((id) => ({ name: name(id), type: 'line', data: data.periods.map((p) => { const v = shown(id, p); return v == null ? null : +v.toFixed(3); }), connectNulls: true, symbol: 'circle', symbolSize: 5, showSymbol: data.periods.length <= 16,
                  lineStyle: { color: color(id), width: 2.2 }, itemStyle: { color: color(id) }, emphasis: { focus: 'series' }, endLabel: { show: false } })),
              };
            }} />
          </Panel>
          <Panel title={`דירוג, ${lab(last)}`} aside={<span>{UNIT[def.unit]}</span>}>
            <table><tbody>{rank.map((r, i) => (
              <tr key={r.id}><td><span className="num muted">{i + 1}</span> <Link to={`/company/${r.id}`}>{name(r.id)}</Link></td>
                <td style={{ width: '45%' }}><div className="bar"><i style={{ width: `${(Math.abs(r.v!) / max) * 100}%`, background: r.v! < 0 ? 'var(--down)' : color(r.id) }} /></div></td>
                <td><span className={`num ${r.v! < 0 ? 'neg' : ''}`}>{fmt(r.v, def.unit)}</span></td></tr>
            ))}</tbody></table>
          </Panel>
        </div>
      )}

      <Panel title="טבלה" aside={<span>{index ? 'אינדקס' : UNIT[def.unit]} · מקור: XBRL בדוחות התקופתיים, MAYA</span>}>
        <div className="scroll"><table>
          <thead><tr><th>חברה</th>{[...data.periods].reverse().map((p) => <th key={p}>{lab(p)}</th>)}</tr></thead>
          <tbody>{on.map((id) => (
            <tr key={id}><td><span className="dot" style={{ background: color(id), marginInlineEnd: 8 }} /><Link to={`/company/${id}`}>{name(id)}</Link></td>
              {[...data.periods].reverse().map((p) => { const v = shown(id, p); return <td key={p}><span className={`num ${v != null && v < 0 ? 'neg' : ''}`}>{index ? (v == null ? '–' : nf(v, 0)) : fmt(v, def.unit)}</span></td>; })}</tr>
          ))}</tbody>
        </table></div>
        <div className="src">עד 2024: כפי שדווח במקור לפי IFRS 4, לא הוצג מחדש. מ-2025: IFRS 17.</div>
        {notes.length > 0 && <div className="src">{notes.map((n) => `${name(n.company)}: ${n.corrected.length} רבעונים תוקנו לפי הדוח (ב-XBRL תויג מצטבר)${n.withheld.length ? `, ${n.withheld.length} רבעונים שלא אומתו הוסרו` : ''}`).join(' · ')}</div>}
        {def.derived && <div className="src">{metric === 'roe' ? 'ROE: רווח LTM חלקי הון ממוצע (פתיחה וסגירה).' : metric === 'leverage' ? 'סך נכסים חלקי הון לבעלי המניות.' : 'שווי שוק: מחיר סגירה במועד הדוח כפול מספר מניות נגזר (רווח שנתי חלקי רווח למניה). אומדן.'}</div>}
      </Panel>
    </>
  );
}
