import { useEffect, useMemo, useState } from 'react';
import { keepSrc } from '../lib/prov';
import { Link, useSearchParams } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Sourced } from '../components/Source';
import { useSource, type Prov } from '../lib/prov';
import { Empty, ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { foxOption } from '../lib/foxchart';
import { nf, periodLabel, sn } from '../lib/format';
import { palette } from '../lib/theme';
import { useLoad, useRegistry } from '../lib/useData';

type Cell = [number, number, number | null, number | null, number];  // period index, value, page, url index, flags (1 derived, 2 IFRS 4, 4 sign turned)
interface Lines {
  roles: [string, string, string][];
  periods: [string, string][];
  urls: string[];
  data: Record<string, Record<string, { label: string; unit: 'k' | 'nis' | 'pct'; cells: Cell[] }>>;
}
const SHEET: Record<string, string> = { 'X.רווח_והפסד': 'רווח והפסד', 'X.מאזן': 'מאזן', 'X.תזרים_מזומנים': 'תזרים מזומנים' };
type PT = 'Q' | 'H' | 'FY' | 'LTM';

/** One line of the statements for every insurer, over time: the comparison the statements pages cannot make one company at a time.
    Each company's line is its own printed line (the caption it uses is shown), each figure links to its page. */
export function IndustryLines() {
  const { open } = useSource();
  const { data: d, error } = useLoad<Lines>('lines.json');
  const reg = useRegistry();
  const [sp, setSp] = useSearchParams();
  const [role, setRole] = useState(sp.get('l') ?? 'ins_res');
  const [pt, setPt] = useState<PT>((['Q', 'H', 'FY', 'LTM'] as PT[]).find((x) => x === sp.get('t')) ?? 'Q');
  const [view, setView] = useState<'v' | 'y'>(sp.get('v') === 'y' ? 'y' : 'v');
  const [lead, setLead] = useState(sp.get('c') ?? '');
  const [from, setFrom] = useState(Number(sp.get('y')) || 2020);
  // insurers and fund houses are different businesses: one group at a time unless asked otherwise
  const [who, setWho] = useState<'ins' | 'fund' | 'all'>((['ins', 'fund', 'all'] as const).find((x) => x === sp.get('g')) ?? 'ins');
  useEffect(() => { setSp(keepSrc({ l: role, t: pt, ...(view === 'y' ? { v: 'y' } : {}), ...(lead ? { c: lead } : {}), ...(from !== 2020 ? { y: String(from) } : {}), ...(who !== 'ins' ? { g: who } : {}) }), { replace: true }); }, [role, pt, view, lead, from, who, setSp]);

  const def = d?.roles.find(([k]) => k === role) ?? d?.roles[0];
  const balance = def?.[2] === 'X.מאזן';
  const base = balance ? 'I' : pt === 'LTM' ? 'Q' : pt;
  const model = useMemo(() => {
    if (!d || !def) return null;
    const lines = d.data[def[0]] ?? {};
    const kind = (id: string) => reg.data?.find((c) => c.id === id)?.kind;
    const ids = Object.keys(lines).filter((id) => who === 'all' || (who === 'fund') === (kind(id) === 'fund_house'));
    // period end -> cell, per company, for the period type on screen (balance sheets have dates only)
    const at = new Map(ids.map((id) => [id, new Map(lines[id].cells.filter((c) => d.periods[c[0]][0] === base).map((c) => [d.periods[c[0]][1], c]))]));
    const back = (end: string, k: number) => new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 3 * k, 0)).toISOString().slice(0, 10);
    const raw = (id: string, end: string): number | null => at.get(id)?.get(end)?.[1] ?? null;
    const amount = (id: string, end: string): number | null => {
      if (pt !== 'LTM' || balance) return raw(id, end);
      let sum = 0;  // trailing twelve months: the quarter and the three before it, all four present
      for (let k = 0; k < 4; k++) { const v = raw(id, back(end, k)); if (v == null) return null; sum += v; }
      return sum;
    };
    const ends = [...new Set(ids.flatMap((id) => [...at.get(id)!.keys()]))].filter((e) => Number(e.slice(0, 4)) >= from).sort();
    const prior = (end: string) => `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`;
    const value = (id: string, end: string): number | null => {
      const v = amount(id, end);
      if (view === 'v' || v == null) return v;
      const p = amount(id, prior(end));
      return p != null && p > 0 && v > 0 ? (v / p - 1) * 100 : null;  // a rate of change only between two positive figures
    };
    const shown = ends.filter((e) => ids.some((id) => value(id, e) != null));
    return { lines, ids, at, shown, value, raw, amount, back, prior };
  }, [d, def, base, pt, view, from, balance, who, reg.data]);

  if (error) return <ErrorBox what="שורות הדוחות" error={error} />;
  if (!d || !reg.data || !model || !def) return <Loading what="שורות הדוחות" />;
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  const unit = model.lines[model.ids[0]]?.unit ?? 'k';
  const scaled = (v: number) => (view === 'y' || unit !== 'k' ? v : v / 1000);
  const dec = view === 'y' ? 1 : unit === 'nis' ? 2 : 0;
  const text = (v: number) => (view === 'y' ? `${sn(v, 1)}%` : nf(scaled(v), dec));
  const lab = (e: string) => `${pt === 'LTM' && !balance ? 'LTM ' : ''}${periodLabel(base, e)}`;
  const pal = palette();
  const firstNew = model.shown.findIndex((e) => model.ids.some((id) => { const c = model.at.get(id)?.get(e); return c && !(c[4] & 2); }));
  const anyOld = model.shown.some((e) => model.ids.some((id) => (model.at.get(id)?.get(e)?.[4] ?? 0) & 2));
  const unitLabel = view === 'y' ? '% YoY' : unit === 'nis' ? 'ש"ח למניה' : 'מיליוני ש"ח';
  const groups = [...new Set(d.roles.map((r) => r[2]))];
  const uLabel = unit === 'nis' ? 'ש"ח למניה' : unit === 'pct' ? '%' : 'מיליוני ש"ח';
  // one printed cell (Q4 / H2 derived from the annual report is flagged), a four-quarter sum, or a year-on-year change of two such figures
  const abs = (v: number) => nf(unit === 'k' ? v / 1000 : v, unit === 'nis' ? 2 : 0);
  const printed = (id: string, e: string, per: string): Prov => {
    const c = model.at.get(id)?.get(e), line = model.lines[id].label, title = `${def[1]} · ${name(id)} · ${per}`;
    if (!c) return { k: 'none', title, why: 'אין נתון לתקופה בדוח שחולץ' };
    return { k: 'report', title, value: abs(c[1]), unit: uLabel, url: c[3] != null ? d.urls[c[3]] : null, pg: c[2], doc: 'דוח כספי', period: per, note: `שורה בדוח: ${line}`, der: c[4] & 1 ? true : undefined, old: c[4] & 2 ? true : undefined, turned: c[4] & 4 ? true : undefined };
  };
  const amountProv = (id: string, e: string): Prov => {
    const per = lab(e), v = model.amount(id, e), title = `${def[1]} · ${name(id)} · ${per}`;
    if (v == null) return { k: 'none', title, why: 'אין נתון לתקופה בדוח שחולץ' };
    if (pt !== 'LTM' || balance) return printed(id, e, per);
    const ends = [0, 1, 2, 3].map((k) => model.back(e, k));
    return { k: 'calc', title, value: abs(v), unit: uLabel, formula: 'סכום ארבעת הרבעונים האחרונים', inputs: ends.map((x) => ({ label: periodLabel(base, x), v: abs(model.raw(id, x) ?? 0), src: () => printed(id, x, periodLabel(base, x)) })) };
  };
  const valueProv = (id: string, e: string): Prov => {
    if (view === 'v') return amountProv(id, e);
    const per = lab(e), v = model.value(id, e), pe = model.prior(e), a = model.amount(id, e), b = model.amount(id, pe), title = `${def[1]} · ${name(id)} · YoY, ${per}`;
    if (v == null) return { k: 'none', title, why: 'שינוי באחוזים מחושב רק בין שני ערכים חיוביים' };
    return { k: 'calc', title, value: text(v), unit: '%', formula: 'הערך בתקופה ÷ הערך באותה תקופה בשנה הקודמת, פחות 1', inputs: [{ label: per, v: a == null ? '–' : abs(a), src: () => amountProv(id, e) }, { label: lab(pe), v: b == null ? '–' : abs(b), src: () => amountProv(id, pe) }] };
  };

  return (
    <>
      <section className="controls">
        <Field label="שורה"><select value={def[0]} onChange={(e) => setRole(e.target.value)}>{groups.map((g) => <optgroup key={g} label={SHEET[g] ?? g}>{d.roles.filter((r) => r[2] === g && Object.keys(d.data[r[0]] ?? {}).length > 0).map((r) => <option key={r[0]} value={r[0]}>{r[1]}</option>)}</optgroup>)}</select></Field>
        <div className="field"><span>חברות</span><Seg<'ins' | 'fund' | 'all'> label="חברות" value={who} onChange={setWho} options={[['ins', 'מבטחות'], ['fund', 'בתי השקעות'], ['all', 'כולן']]} /></div>
        {!balance && <div className="field"><span>תקופה</span><Seg<PT> label="תקופה" value={pt} onChange={setPt} options={[['Q', 'Q'], ['H', 'H'], ['FY', 'FY'], ['LTM', 'LTM']]} /></div>}
        <div className="field"><span>תצוגה</span><Seg<'v' | 'y'> label="תצוגה" value={view} onChange={setView} options={[['v', 'ערך'], ['y', 'YoY %']]} /></div>
        <Field label="מיקוד"><select value={lead} onChange={(e) => setLead(e.target.value)}><option value="">כל החברות שוות</option>{model.ids.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select></Field>
        <Field label="משנת"><select value={from} onChange={(e) => setFrom(Number(e.target.value))}>{[2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => <option key={y}>{y}</option>)}</select></Field>
      </section>

      {model.shown.length < 2 ? <Empty title="אין רצף לשורה ולתקופה שנבחרו" /> : (
        <>
          <Panel title={def[1]} aside={<span>{unitLabel} · {SHEET[def[2]]} · כפי שדווח בכל תקופה</span>}>
            <Chart label={`שורת דוח לכל החברות: ${def[1]}`} exportName={`fox-${def[0]}-${pt}`} height={380} deps={[def[0], pt, view, lead, from, who, model.shown.length]} build={() => foxOption({
              x: model.shown.map(lab), unit: unitLabel, legend: true, labels: false, scale: balance || view === 'y',
              breakAt: view === 'v' && anyOld && firstNew > 0 ? firstNew : undefined, breakLabel: 'IFRS 17',
              series: model.ids.map((id, i) => ({ name: name(id), kind: 'line' as const, color: pal[i % pal.length], pct: view === 'y', lead: lead === id, dim: !!lead && lead !== id, dec,
                data: model.shown.map((e) => { const v = model.value(id, e); return v == null ? null : +scaled(v).toFixed(3); }) })),
            })} onPoint={(si, di) => { const id = model.ids[si], e = model.shown[di]; if (id && e) open(valueProv(id, e)); }} />
            {anyOld && <div className="src">הקו המקווקו: המעבר ל-IFRS 17. לפניו כל חברה לפי IFRS 4 כפי שדווח במקור, ולכן שורות שהגדרתן השתנתה בתקן אינן בנות השוואה משני צדיו.</div>}
          </Panel>
          <Panel title="טבלה" aside={<span>{unitLabel} · כל מספר מקושר לעמוד בדוח</span>}>
            <div className="scroll"><table>
              <thead><tr><th>חברה</th>{[...model.shown].reverse().map((e) => <th key={e}>{lab(e)}</th>)}</tr></thead>
              <tbody>{model.ids.map((id, i) => (
                <tr key={id} className={lead === id ? 'on' : undefined}>
                  <td><span className="dot" style={{ background: pal[i % pal.length], marginInlineEnd: 8 }} /><Link to={`/company/${id}/financials?sheet=${encodeURIComponent(def[2])}`} title={`בדוחות החברה: ${model.lines[id].label}`}>{name(id)}</Link></td>
                  {[...model.shown].reverse().map((e) => {
                    const v = model.value(id, e), c = model.at.get(id)?.get(e);
                    if (v == null) return <td key={e}><span className="muted">–</span></td>;
                    const cls = `num${view === 'y' ? (v >= 0 ? ' pos' : ' neg') : v < 0 ? ' neg' : ''}${c && c[4] & 1 ? ' der' : ''}${c && c[4] & 2 ? ' old' : ''}`;
                    const href = view === 'v' && pt !== 'LTM' && c && c[3] != null ? `${d.urls[c[3]]}${c[2] ? `#page=${c[2]}` : ''}` : null;
                    return <td key={e}><Sourced className={cls} href={href} src={() => valueProv(id, e)} title={`${model.lines[id].label}${c?.[2] ? ` · עמ׳ ${c[2]}` : ''}`}>{text(v)}</Sourced></td>;
                  })}
                </tr>
              ))}</tbody>
            </table></div>
            <div className="src">כל חברה לפי השורה שהיא מדפיסה (הניסוח שלה מופיע בריחוף על שם החברה). נטוי: Q4 או H2 מחושב מהדוח השנתי. אפור: לפי IFRS 4 כפי שדווח.{pt === 'LTM' && !balance ? ' LTM: סכום ארבעת הרבעונים האחרונים, מחושב.' : ''}</div>
          </Panel>
        </>
      )}
    </>
  );
}
