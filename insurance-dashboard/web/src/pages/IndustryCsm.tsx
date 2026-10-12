import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart } from '../components/Chart';
import { Empty, ErrorBox, Field, Loading, Panel, Seg } from '../components/ui';
import { Fig, MEASURES, Marks, Notes, lineMarks, lineOf, ratioMarks, showAmt, showMeasure, tableMarks } from '../components/CsmEconomics';
import { foxOption } from '../lib/foxchart';
import { palette } from '../lib/theme';
import { nf, sn, byPeriodDesc } from '../lib/format';
import { load, useIfrsData, useRegistry } from '../lib/useData';
import type { IfrsFact } from '../lib/types';
import { BASIS, BUCKETS, BUCKET_END, SCOPE_HE, STEPS, best, endOf, equityAt, monthsOf, periodName, quarter, ratios, runoff, tag } from '../lib/csm';
import type { Bridge, Line, Ratios, Reports, RF, Win } from '../lib/csm';
import '../styles/csm.css';

type MK = (typeof MEASURES)[number]['k'];
type Row = { id: string; b: Bridge | null; r: Ratios; eq: RF | null };
const yearBefore = (p: string) => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;
const KEYS = STEPS.map(([k]) => k);

/** Every extracted report of every insurer, grouped by company and ordered oldest first. Reports that fail to load are left out. */
function useReports(periods: string[]): { byCo: Map<string, Reports>; done: boolean } {
  const [all, setAll] = useState<Map<string, IfrsFact[]>>(new Map());
  const key = periods.join();
  useEffect(() => {
    let live = true;
    setAll(new Map());
    periods.forEach((p) => load<IfrsFact[]>(`ifrs_${p}.json`).then((fs) => live && setAll((cur) => new Map(cur).set(p, fs)), () => live && setAll((cur) => new Map(cur).set(p, []))));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const byCo = useMemo(() => {
    const m = new Map<string, Reports>();
    [...periods].sort((a, b) => byPeriodDesc(b, a)).forEach((p) => {
      const by = new Map<string, RF[]>();
      tag(all.get(p) ?? [], p).forEach((f) => { if (!by.has(f.c)) by.set(f.c, []); by.get(f.c)!.push(f); });
      by.forEach((F, c) => { if (!m.has(c)) m.set(c, []); m.get(c)!.push({ p, F }); });
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, key]);
  return { byCo, done: periods.length > 0 && all.size === periods.length };
}

/** The CSM economics of the insurers side by side: the ratios of the chosen report, the movement tables behind them, one ratio over time, and the expected release schedule. */
export function IndustryCsm() {
  const { data: d, error } = useIfrsData();
  const reg = useRegistry();
  const periods = useMemo(() => [...new Set((d?.files ?? []).map((f) => f.period))].sort(byPeriodDesc), [d]);
  const { byCo, done } = useReports(periods);
  const [period, setPeriod] = useState('');
  const [win, setWin] = useState<'q' | 'ytd'>('q');
  const [pref, setPref] = useState<'net' | 'gross'>('net');
  const [view, setView] = useState<'v' | 'y'>('v');
  const [sort, setSort] = useState<{ k: MK; dir: 1 | -1 } | null>(null);
  const [mk, setMk] = useState<MK>('nbRel');
  const [lead, setLead] = useState('');
  const [span, setSpan] = useState<'q' | 'ytd'>('q');
  const [share, setShare] = useState<'v' | 'p'>('v');
  const P = periods.includes(period) ? period : periods[0] ?? '';
  const annual = P.endsWith('FY'), W: Win = annual ? 'fy' : win;
  const ids = useMemo(() => [...byCo.keys()].sort(), [byCo]);

  // one table per company for the chosen report; a report that does not print the period falls back to a later one that reprints it
  const at = (p: string): Row[] => ids.map((id) => {
    const rs = byCo.get(id)!, end = endOf(p), b = best(rs, p, end, W, { pref });
    const eq = [rs.find((r) => r.p === p), ...rs].map((r) => (r ? equityAt(r.F, end) : null)).find(Boolean) ?? null;
    return { id, b, eq, r: ratios(b, eq?.v ?? null) };
  });
  const rows = useMemo(() => (P ? at(P) : []), [byCo, P, W, pref]);  // eslint-disable-line react-hooks/exhaustive-deps
  const before = useMemo(() => new Map((P ? at(yearBefore(P)) : []).map((r) => [r.id, r])), [byCo, P, W, pref]);  // eslint-disable-line react-hooks/exhaustive-deps

  // every quarter since the first comparative year, for the chart
  const keys = useMemo(() => {
    if (!periods.length) return [];
    const last = periods[0], out: string[] = [];
    for (let y = Number(periods[periods.length - 1].slice(0, 4)) - 1; y <= Number(last.slice(0, 4)); y++) for (const q of ['Q1', 'Q2', 'Q3', 'FY']) out.push(`${y}${q}`);
    return out.filter((k) => byPeriodDesc(k, last) >= 0);
  }, [periods]);
  const trend = useMemo(() => new Map(ids.map((id) => {
    const rs = byCo.get(id)!;
    return [id, keys.map((k) => {
      const b = span === 'q' ? quarter(rs, k, { pref }) : best(rs, k, endOf(k), k.endsWith('FY') ? 'fy' : 'ytd', { pref });
      const eq = [rs.find((r) => r.p === k), ...rs].map((r) => (r ? equityAt(r.F, endOf(k)) : null)).find(Boolean) ?? null;
      return { b, r: ratios(b, eq?.v ?? null) };
    })] as const;
  })), [byCo, ids, keys, span, pref]);

  // the expected release schedule is printed once a year
  const fy = periods.find((p) => p.endsWith('FY')) ?? '';
  const sched = useMemo(() => ids.map((id) => ({ id, s: fy ? runoff(byCo.get(id)!.find((r) => r.p === fy)?.F ?? [], endOf(fy), 'gross') : null })), [byCo, ids, fy]);

  if (error) return <ErrorBox what="נתוני CSM" error={error} />;
  if (!d || !reg.data || (periods.length > 0 && !done)) return <Loading what="כלכלת ה-CSM" />;
  if (!P) return <Empty title="אין דוחות מחולצים" />;
  const name = (id: string) => reg.data?.find((c) => c.id === id)?.name_he ?? id;
  const pal = palette();
  const cols = MEASURES;
  // what a cell shows: the figure, or its change on the same period a year earlier (percent for amounts, points for ratios)
  const shown = (r: Row, k: MK, kind: string): number | null => {
    const x = r.r[k];
    if (x == null || view === 'v') return x;
    const y = before.get(r.id)?.r[k];
    return y == null ? null : kind === 'amt' ? (y ? ((x - y) / Math.abs(y)) * 100 : null) : x - y;
  };
  const fmt = (kind: 'amt' | 'pct' | 'x', v: number) => (view === 'v' ? showMeasure(kind, v) : kind === 'amt' ? `${sn(v, 1)}%` : kind === 'x' ? `${sn(v, 2)}×` : `${sn(v, 1)} נק׳`);
  const sorted = (() => {
    const c = sort && cols.find((x) => x.k === sort.k);
    if (!c) return rows;
    return [...rows].sort((a, b) => { const x = shown(a, c.k, c.kind), y = shown(b, c.k, c.kind); return x == null ? 1 : y == null ? -1 : (y - x) * sort.dir; });
  })();
  const median = (k: MK, kind: string): number | null => { const xs = rows.map((r) => shown(r, k, kind)).filter((v): v is number => v != null).sort((p, q) => p - q); return xs.length < 3 ? null : xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2; };
  const top = new Map(cols.map((c) => [c.k, Math.max(0, ...rows.map((r) => Math.abs(shown(r, c.k, c.kind) ?? 0)))]));
  const press = (k: MK) => { setSort((cur) => (cur?.k !== k ? { k, dir: 1 } : cur.dir === 1 ? { k, dir: -1 } : null)); setMk(k); };
  const used = new Set<number>(), used2 = new Set<number>(), used3 = new Set<number>();
  const wlabel = W === 'fy' ? 'FY' : W === 'q' ? 'QTD' : `YTD (${monthsOf(endOf(P), 'ytd')}M)`;
  const csv = () => {
    const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
    const head = ['company', 'basis', 'scope', ...cols.flatMap((c) => [c.l, `${c.l} · page`])];
    const body = sorted.map((r) => [name(r.id), r.b?.b ?? '', r.b ? SCOPE_HE[r.b.scope] : '', ...cols.flatMap((c) => { const v = r.r[c.k], l = c.kind === 'amt' ? lineOf(r.b, c.k) : null; return v == null ? ['', ''] : [Number(v.toFixed(3)), l ? l.fs.map((f) => f.pg).join('+') : 'derived']; })]);
    const blob = new Blob(['﻿' + [head, ...body].map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `fox_csm_${P}_${W}_${pref}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  // the movement tables behind the ratios: one column per company, the rows a single filer adds under its own name folded into one
  const live = rows.filter((r) => r.b);
  const stepKeys = KEYS.filter((k) => live.some((r) => r.b!.steps.some((s) => s.k === k)));
  const extra = (b: Bridge): Line | null => { const xs = b.steps.filter((s) => !KEYS.includes(s.k)); return xs.length ? { v: xs.reduce((t, s) => t + s.line.v, 0), fs: xs.flatMap((s) => s.line.fs), n: xs.length > 1 ? xs.length : xs[0].line.n } : null; };
  const anyExtra = live.some((r) => extra(r.b!));
  const stepRow = (label: string, get: (b: Bridge) => Line | null, key: string) => (
    <tr key={key}><td className="lbl">{label}</td>{live.map((r) => { const l = get(r.b!); return <td key={r.id}>{l ? <><Fig line={l} d={d} text={(l.v > 0 ? '+' : '') + showAmt(l.v)} tone={l.v < 0 ? 'neg' : ''} /><Marks ms={lineMarks(l)} used={used2} /></> : <span className="muted">–</span>}</td>; })}</tr>
  );

  // the chart: ratios are plotted for every period; amounts only on the basis of the company's latest point, so a line never changes basis
  const m = MEASURES.find((x) => x.k === mk)!;
  const lastBasis = new Map(ids.map((id) => [id, [...trend.get(id)!].reverse().find((x) => x.r[mk] != null)?.b?.b]));
  const point = (id: string, i: number): number | null => { const x = trend.get(id)![i]; return m.kind === 'amt' && x.b?.b !== lastBasis.get(id) ? null : x.r[mk]; };
  const tshown = keys.map((k, i) => ({ k, i })).filter(({ i }) => ids.some((id) => point(id, i) != null));
  const xlab = (k: string) => (span === 'q' ? periodName(k).replace('FY', 'Q4') : k.endsWith('FY') ? periodName(k) : `${monthsOf(endOf(k), 'ytd')}M'${k.slice(2, 4)}`);

  const have = sched.filter((x) => x.s);

  return (
    <>
      <section className="controls">
        <Field label="דוח"><select value={P} onChange={(e) => setPeriod(e.target.value)}>{periods.map((p) => <option key={p} value={p}>{periodName(p)}</option>)}</select></Field>
        {!annual && <div className="field"><span>חלון</span><Seg label="חלון" value={win} onChange={setWin} options={[['q', 'QTD'], ['ytd', 'YTD']]} /></div>}
        <div className="field"><span>בסיס מועדף</span><Seg<'net' | 'gross'> label="בסיס מועדף" value={pref} onChange={setPref} options={[['net', 'נטו'], ['gross', 'ברוטו']]} /></div>
        <div className="field"><span>תצוגה</span><Seg<'v' | 'y'> label="תצוגה" value={view} onChange={setView} options={[['v', 'ערך'], ['y', 'YoY']]} /></div>
        <div className="field"><span>ייצוא</span><button type="button" className="btn" onClick={csv}>CSV</button></div>
      </section>

      <Panel title="כלכלת ה-CSM" aside={<span>{periodName(P)} · {wlabel} · {view === 'v' ? 'מיליוני ש"ח, כפי שדווח' : `שינוי מול ${periodName(yearBefore(P))}`} · ÷ נגזר · לחיצה על כותרת ממיינת</span>}>
        <div className="scroll"><table className="matrix">
          <thead><tr><th>חברה</th>{cols.map((c) => <th key={c.k} aria-sort={sort?.k === c.k ? (sort.dir === 1 ? 'descending' : 'ascending') : 'none'}><button type="button" className="thsort" title={c.from ? `נגזר: ${c.from}` : undefined} onClick={() => press(c.k)}>{c.l}{c.from && <span className="dim"> ÷</span>}<i>{sort?.k === c.k ? (sort.dir === 1 ? '▼' : '▲') : ''}</i></button></th>)}</tr></thead>
          <tbody>{sorted.map((r, ri) => (
            <tr key={r.id}>
              <td>{sort && <span className="rk num">{ri + 1}</span>}<Link to={`/company/${r.id}/ifrs17`}>{name(r.id)}</Link>{r.b && <Marks ms={tableMarks(r.b, pref)} used={used} />}{r.b && <span className="dim">{BASIS[r.b.b]} · {SCOPE_HE[r.b.scope]}</span>}</td>
              {cols.map((c) => {
                const v = shown(r, c.k, c.kind);
                if (v == null) return <td key={c.k}><span className="muted">–</span></td>;
                const l = c.kind === 'amt' ? lineOf(r.b, c.k) : null;
                const tone = view === 'y' ? (v >= 0 ? 'pos' : 'neg') : v < 0 ? 'neg' : '';
                const w = top.get(c.k) ? Math.round((Math.abs(v) / top.get(c.k)!) * 100) : 0;
                return (
                  <td key={c.k} className="bar" style={{ ['--w' as string]: `${w}%` }}>
                    {l && view === 'v' ? <Fig line={{ ...l, v: Math.abs(l.v) }} d={d} text={fmt(c.kind, v)} tone={tone} /> : <span className={`num ${tone} ${c.kind === 'amt' ? '' : 'der'}`} title={c.from ? `נגזר: ${c.from}` : undefined}>{fmt(c.kind, v)}</span>}
                    <Marks ms={l ? lineMarks(l) : ratioMarks(r.b, c.k, r.r)} used={used} />
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
          <tfoot><tr><td>חציון</td>{cols.map((c) => { const x = median(c.k, c.kind); return <td key={c.k}>{x == null ? <span className="muted">–</span> : <span className="num">{fmt(c.kind, x)}</span>}</td>; })}</tr></tfoot>
        </table></div>
        <Notes used={used} />
        <div className="src">÷ נגזר מהשורות המודפסות שבטבלת הגשר שמתחת. שחרור / פתיחה מנורמל לשנה (כפול 12 חלקי חודשי החלון); ריבית ושינויי אומדן לחלון עצמו. CSM / הון: יתרת CSM חלקי הון לבעלי המניות של הקבוצה.</div>
      </Panel>

      <Panel title="גשר CSM" aside={<span>{periodName(P)} · {wlabel} · מיליוני ש"ח · כל מספר מקושר לעמוד</span>}>
        {live.length === 0 ? <Empty title="לא נמצאה תנועת CSM בדוחות לתקופה ולחלון שנבחרו" /> : (
          <div className="scroll"><table className="csm-bridge">
            <thead><tr><th>שורה</th>{live.map((r) => <th key={r.id}>{name(r.id)}<Marks ms={tableMarks(r.b!, pref)} used={used2} /><span className="dim">{BASIS[r.b!.b]} · {SCOPE_HE[r.b!.scope]}</span></th>)}</tr></thead>
            <tbody>
              <tr className="lead"><td className="lbl">פתיחה</td>{live.map((r) => <td key={r.id}>{r.b!.open ? <><Fig line={r.b!.open} d={d} text={showAmt(r.b!.open.v)} /><Marks ms={[...lineMarks(r.b!.open), ...(r.b!.openPrev ? [8] : [])]} used={used2} /></> : <span className="muted">–</span>}</td>)}</tr>
              {stepKeys.filter((k) => k !== 'rel').map((k) => stepRow(STEPS.find(([x]) => x === k)![2], (b) => lineOf(b, k), k))}
              {anyExtra && stepRow('שורות נוספות בטבלת החברה', extra, 'x')}
              {stepKeys.includes('rel') && stepRow('שחרור לרווח', (b) => lineOf(b, 'rel'), 'rel')}
              <tr className="csm-gap"><td className="lbl">הפרש לא מוסבר<span className="dim">נגזר: סגירה פחות פתיחה פחות השורות שמעל · שורות שהדוח לא מדפיס או שלא חולצו</span></td>
                {live.map((r) => <td key={r.id}>{r.b!.gap == null ? <span className="muted">–</span> : <span className={`num der ${Math.abs(r.b!.gap) > 2 ? 'neg' : ''}`}>{(r.b!.gap > 0 ? '+' : '') + showAmt(Math.round(r.b!.gap * 10) / 10 || 0)}</span>}</td>)}</tr>
              <tr className="lead"><td className="lbl">סגירה</td>{live.map((r) => <td key={r.id}>{r.b!.close ? <><Fig line={r.b!.close} d={d} text={showAmt(r.b!.close.v)} /><Marks ms={lineMarks(r.b!.close)} used={used2} /></> : <span className="muted">–</span>}</td>)}</tr>
              <tr><td className="lbl">הון לבעלי המניות</td>{live.map((r) => <td key={r.id}>{r.eq ? <Fig line={{ v: r.eq.v, fs: [r.eq] }} d={d} text={showAmt(r.eq.v)} /> : <span className="muted">–</span>}</td>)}</tr>
            </tbody>
          </table></div>
        )}
        <Notes used={used2} />
      </Panel>

      <Panel title={`לאורך זמן: ${m.l}`} aside={<span>{m.kind === 'amt' ? 'מיליוני ש"ח' : m.kind === 'x' ? '×' : '%'} · {span === 'q' ? 'רבעוני' : 'מצטבר מתחילת השנה'} · {BASIS[pref]} מועדף · כפי שדווח בכל תקופה</span>}>
        <section className="controls">
          <Field label="מדד"><select value={mk} onChange={(e) => setMk(e.target.value as MK)}>{MEASURES.map((c) => <option key={c.k} value={c.k}>{c.l}</option>)}</select></Field>
          <Field label="מיקוד"><select value={lead} onChange={(e) => setLead(e.target.value)}><option value="">כל החברות שוות</option>{ids.map((id) => <option key={id} value={id}>{name(id)}</option>)}</select></Field>
          <div className="field"><span>חלון</span><Seg<'q' | 'ytd'> label="חלון" value={span} onChange={setSpan} options={[['q', 'רבעון'], ['ytd', 'YTD']]} /></div>
        </section>
        {tshown.length < 2 ? <Empty title="אין רצף למדד הזה" /> : (
          <Chart label={`CSM עמיתים לאורך זמן: ${m.l}`} height={360} deps={[mk, lead, span, pref, tshown.length, byCo.size]} build={() => foxOption({
            x: tshown.map(({ k }) => xlab(k)), unit: m.kind === 'amt' ? 'מיליוני ש"ח' : m.kind === 'x' ? '×' : '%', legend: true, labels: false, scale: m.kind !== 'amt' || m.k === 'close',
            series: ids.map((id, i) => ({ name: name(id), kind: 'line' as const, color: pal[i % pal.length], pct: m.kind === 'pct', lead: lead === id, dim: !!lead && lead !== id, dec: m.kind === 'pct' ? 1 : m.kind === 'x' ? 2 : 0,
              faded: tshown.map(({ i: j }) => !!trend.get(id)![j].b?.cmp || !!trend.get(id)![j].b?.der), data: tshown.map(({ i: j }) => { const v = point(id, j); return v == null ? null : +v.toFixed(3); }) })),
          })} />
        )}
        <div className="src">
          {m.from ? `נגזר: ${m.from}. ` : ''}נקודה בהירה: נגזרת (Q4 = FY פחות 9M) או מדוח מאוחר שהדפיס את התקופה שוב. IFRS 17 מיושם מ-2025; 2024 מעמודות ההשוואה.
          {m.kind === 'amt' && <> בסיס הקו: {ids.filter((id) => lastBasis.get(id)).map((id) => `${name(id)} ${BASIS[lastBasis.get(id)!]}`).join(' · ')}.</>}
        </div>
      </Panel>

      <Panel title="שחרור CSM צפוי לרווח" aside={fy ? <><span>{periodName(fy)} · {share === 'v' ? 'מיליוני ש"ח' : '% מסך הלוח, נגזר'} · לפי שנים מתאריך המאזן</span></> : undefined}>
        {have.length === 0 ? <Empty title="לוח השחרור מתפרסם בדוח השנתי, ולא נמצא בדוחות שחולצו" /> : (
          <>
            <section className="controls"><div className="field"><span>תצוגה</span><Seg<'v' | 'p'> label="תצוגה" value={share} onChange={setShare} options={[['v', 'מיליוני ש"ח'], ['p', '% מהסך']]} /></div></section>
            <Chart label="שחרור CSM צפוי, מצטבר" height={300} deps={[fy, lead, have.length, byCo.size]} build={() => foxOption({
              x: BUCKET_END.slice(0, -1).map((y) => `עד ${y} ${y === 1 ? 'שנה' : 'שנים'}`), unit: '%', legend: true, labels: false,
              series: have.map((x) => { let run = 0; const i = ids.indexOf(x.id); return { name: name(x.id), kind: 'line' as const, pct: true, color: pal[i % pal.length], lead: lead === x.id, dim: !!lead && lead !== x.id, dec: 1, data: x.s!.cells.slice(0, -1).map((c) => { run += c!.v; return +((run / x.s!.total) * 100).toFixed(2); }) }; }),
            })} />
            <div className="scroll"><table className="csm-series">
              <thead><tr><th>חברה</th>{BUCKETS.map((b) => <th key={b}>{b}</th>)}<th>סך הלוח</th><th>שנה ראשונה / סך<span className="dim">נגזר</span></th></tr></thead>
              <tbody>{have.map((x) => (
                <tr key={x.id} className={lead === x.id ? 'lead' : ''}>
                  <td><Link to={`/company/${x.id}/ifrs17`}>{name(x.id)}</Link><Marks ms={[...(x.s!.scope === 'lh' ? [2] : x.s!.scope === 'life' ? [3] : [])]} used={used3} /><span className="dim">{BASIS[x.s!.b]} · {SCOPE_HE[x.s!.scope]}</span></td>
                  {x.s!.cells.map((c, i) => <td key={i}>{share === 'v' ? <Fig line={c!} d={d} text={showAmt(c!.v)} /> : <span className="num der">{nf((c!.v / x.s!.total) * 100, 1)}%</span>}</td>)}
                  <td>{x.s!.printed ? <Fig line={x.s!.printed} d={d} text={showAmt(x.s!.printed.v)} /> : <span className="num der" title="נגזר: סכום שמונה התקופות">{showAmt(x.s!.total)}</span>}</td>
                  <td><span className="num der">{nf((x.s!.cells[0]!.v / x.s!.total) * 100, 1)}%</span></td>
                </tr>
              ))}</tbody>
            </table></div>
            <Notes used={used3} />
            <div className="src">הגרף: החלק המצטבר מסך הלוח שצפוי להשתחרר עד כל אופק, נגזר מהלוח המודפס. סך נטוי: סכום שמונה התקופות, כשהחברה לא מדפיסה שורת סך. {ids.length > have.length && `ללא לוח בדוח: ${ids.filter((id) => !have.some((x) => x.id === id)).map(name).join(', ')}.`}</div>
          </>
        )}
      </Panel>
    </>
  );
}
