import { useMemo, useState } from 'react';
import { Chart } from './Chart';
import { Sourced } from './Source';
import { useSource } from '../lib/prov';
import { Empty, ErrorBox, Loading, Panel, Seg } from './ui';
import { foxOption } from '../lib/foxchart';
import { palette } from '../lib/theme';
import { nf, byPeriodDesc } from '../lib/format';
import { useIfrsCompany, useIfrsData } from '../lib/useData';
import type { IfrsData } from '../lib/types';
import type { Prov } from '../lib/prov';
import { TEXT_HE } from '../lib/labels';
import { BASIS, SCOPE_HE, STEPS, basesAt, best, bridge, endOf, equityAt, factsOf, gapProv, hrefOf, lineProv, monthsOf, periodName, quarter, ratioProv, ratios, tag } from '../lib/csm';
import type { Bridge, Line, Ratios, Reports, RF, ScopeId, Win } from '../lib/csm';
import '../styles/csm.css';

/** The measures of the CSM lens. `amt` rows are printed lines; the rest are computed here from them and say from what. */
export const MEASURES: { k: Exclude<keyof Ratios, 'joint' | 'open'>; l: string; kind: 'amt' | 'pct' | 'x'; from?: string }[] = [
  { k: 'close', l: 'יתרת CSM', kind: 'amt' },
  { k: 'nb', l: 'CSM עסק חדש', kind: 'amt' },
  { k: 'rel', l: 'שחרור CSM', kind: 'amt' },
  { k: 'nbRel', l: 'עסק חדש / שחרור', kind: 'pct', from: 'עסק חדש חלקי שחרור' },
  { k: 'csmEq', l: 'CSM / הון', kind: 'x', from: 'יתרת CSM חלקי הון לבעלי המניות' },
  { k: 'relOpen', l: 'שחרור / CSM פתיחה, מנורמל לשנה', kind: 'pct', from: 'שחרור חלקי יתרת הפתיחה, כפול 12 חלקי חודשי החלון' },
  { k: 'intOpen', l: 'צבירת ריבית / CSM פתיחה', kind: 'pct', from: 'צבירת ריבית חלקי יתרת הפתיחה, לחלון, לא מנורמל' },
  { k: 'estOpen', l: 'שינויי אומדן / CSM פתיחה', kind: 'pct', from: 'שינויי אומדן חלקי יתרת הפתיחה, לחלון, לא מנורמל' },
  { k: 'chg', l: 'שינוי ביתרה בחלון', kind: 'pct', from: 'סגירה חלקי פתיחה, פחות 1' },
];
/** Remarks on a figure, numbered under the table instead of a chip in every cell. */
export const NOTES = [
  'בסיס שונה מהבסיס שנבחר: זה הבסיס שהחברה מדפיסה',
  'חיים ובריאות יחד: החברה לא מדפיסה שורת קבוצה',
  'נגזר: חיים ועוד בריאות, על אותו בסיס',
  'חיים וחיסכון בלבד: אין בדוח CSM לקבוצה או לבריאות',
  'נקרא מגרף או מטקסט בדוח או במצגת',
  'כולל רווח עתידי בפוליסות חיסכון, שאינו CSM לפי התקן',
  'ללא פוליסות חיסכון: הסכום שהודפס פחות עמודת פוליסות החיסכון באותה טבלה',
  'נגזר: סכום של כמה שורות באותה טבלה',
  'פתיחה: יתרת הסגירה שהודפסה לתאריך הקודם',
  'ריבית והשפעות כלכליות מודפסות בשורה אחת, והיא מוצגת כאן',
  'נגזר: טבלה מצטברת פחות הטבלה המצטברת שלפניה (Q4 = FY פחות 9M)',
  'מדוח מאוחר יותר, שהדפיס את התקופה כעמודת השוואה',
  'הוצג מחדש: דוח מאוחר הדפיס יתרה אחרת לאותו תאריך; הנתון הראשון והמאוחר בגיליון המקור',
];
export const SUP = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹', '¹⁰', '¹¹', '¹²', '¹³'];
export const showAmt = (v: number) => nf(v, Math.abs(v) < 100 ? 1 : 0);
export const showMeasure = (kind: 'amt' | 'pct' | 'x', v: number) => (kind === 'amt' ? showAmt(v) : kind === 'x' ? `${nf(v, 2)}×` : `${nf(v, 1)}%`);
/** Notes that belong to the table as a whole: its basis, its scope, how it was assembled. */
export function tableMarks(b: Bridge, pref: string): number[] {
  const m: number[] = [];
  if (b.b !== pref) m.push(0);
  if (b.scope === 'life_health') m.push(1);
  if (b.scope === 'life') m.push(3);
  if (b.der) m.push(10);
  if (b.cmp) m.push(11);
  return m;
}
/** Notes that belong to one line: how it was read and what it contains. */
export function lineMarks(l: Line | null | undefined): number[] {
  if (!l) return [];
  const m: number[] = [];
  if (l.sum) m.push(2);
  if (l.fs.some((f) => f.src === 'chart' || f.src === 'text')) m.push(4);
  if (l.fs.some((f) => f.cl === 1)) m.push(6); else if (l.fs.some((f) => f.inc === 1)) m.push(5);
  if ((l.n ?? 1) > 1) m.push(7);
  return m;
}
export const lineOf = (b: Bridge | null, k: string): Line | null => (!b ? null : k === 'close' ? b.close : k === 'open' ? b.open : b.steps.find((s) => s.k === k)?.line ?? null);
/** A computed ratio carries the savings-policy caveat of the lines it is built from. */
export const ratioMarks = (b: Bridge | null, k: string, r: Ratios): number[] => {
  const m: number[] = [];
  if (factsOf(b).some((f) => f.inc === 1)) m.push(5);
  if (b?.openPrev && ['relOpen', 'intOpen', 'estOpen', 'chg'].includes(k)) m.push(8);
  if (k === 'estOpen' && r.joint) m.push(9);
  return m;
};
export function Marks({ ms, used }: { ms: number[]; used: Set<number> }) {
  if (!ms.length) return null;
  ms.forEach((m) => used.add(m));
  return <sup className="mk" title={ms.map((m) => NOTES[m]).join(' · ')}>{ms.map((m) => SUP[m]).join(' ')}</sup>;
}
export function Notes({ used }: { used: Set<number> }) {
  return used.size === 0 ? null : <ol className="fnotes">{[...used].sort((a, b) => a - b).map((m) => <li key={m}><sup>{SUP[m]}</sup> {NOTES[m]}</li>)}</ol>;
}
/** A printed figure, linked to its page. A sum of several printed rows links the first and lists the other pages after it. */
export function Fig({ line, d, text, tone = '', title = 'CSM', src }: { line: Line; d: IfrsData; text: string; tone?: string; title?: string; src?: () => Prov }) {
  const seen = new Map<string, RF>();
  line.fs.forEach((f) => { const h = hrefOf(f, d); if (h && !seen.has(h)) seen.set(h, f); });
  const [first, ...rest] = [...seen];
  const tip = line.fs.map((f) => `${f.l} · ${periodName(f.rp)} עמ׳ ${f.pg ?? '–'}`).join('\n');
  // a single printed row stays a real link to its page; a sum or a difference opens its inputs
  const href = line.fs.length === 1 && !line.sum && !line.diff ? first?.[0] ?? null : null;
  return (
    <>
      <Sourced className={`num ${tone}`} src={src ?? (() => lineProv(line, d, title, text))} href={href} title={tip}>{text}</Sourced>
      {rest.map(([h, f]) => <a key={h} className="num csm-pg" href={h} target="_blank" rel="noreferrer" title={f.l}>עמ׳ {f.pg}</a>)}
    </>
  );
}
const stepLabel = (m: string, label: string) => (m.startsWith('csm_other:') ? TEXT_HE[label] ?? label : label);
const KEYS = STEPS.map(([k]) => k);

/** The CSM of one company: the movement table of the chosen report as a waterfall, by segment where printed, and the ratios quarter by quarter. */
export function CsmEconomics({ id }: { id: string }) {
  const { open } = useSource();
  const { data: d, error } = useIfrsData();
  const periods = useMemo(() => (d?.files ?? []).filter((f) => f.company === id).map((f) => f.period).sort(byPeriodDesc), [d, id]);
  const all = useIfrsCompany(id, periods);
  const rs: Reports = useMemo(() => [...periods].reverse().filter((p) => all.has(p)).map((p) => ({ p, F: tag(all.get(p)!.filter((f) => f.c === id), p) })), [all, periods, id]);
  const [period, setPeriod] = useState('');
  const [win, setWin] = useState<'q' | 'ytd'>('q');
  const [basis, setBasis] = useState('');
  const [seg, setSeg] = useState<'all' | 'life' | 'health'>('all');
  const [span, setSpan] = useState<'q' | 'ytd'>('q');
  const P = periods.includes(period) ? period : periods[0] ?? '';
  const annual = P.endsWith('FY'), end = P ? endOf(P) : '', W: Win = annual ? 'fy' : win;
  const cur = rs.find((r) => r.p === P)?.F;
  const bases = useMemo(() => (cur ? basesAt(cur, end) : []), [cur, end]);
  const pref = bases.includes(basis) ? basis : bases.includes('net') ? 'net' : bases[0] ?? 'net';

  // the table of the report in view: the company total first, then each segment the report prints on the same basis
  const cols = useMemo(() => {
    if (!cur) return [];
    const pool = rs.flatMap((r) => r.F);
    const tot = bridge(cur, end, W, { pref, prev: pool });
    if (!tot) return [];
    const parts = tot.scope === 'life' ? [] : (['life', 'health'] as ScopeId[]).map((s) => bridge(cur, end, W, { scope: s, basis: tot.b, prev: pool })).filter((b): b is Bridge => !!b);
    return [tot, ...parts];
  }, [cur, rs, end, W, pref]);
  const rows = useMemo(() => {
    const ks = [...new Set(cols.flatMap((b) => b.steps.map((s) => s.k)))];
    const other = ks.filter((k) => !KEYS.includes(k));
    return [...KEYS.slice(0, -1).filter((k) => ks.includes(k)), ...other, ...(ks.includes('rel') ? ['rel'] : [])].map((k) => { const s = cols.flatMap((b) => b.steps).find((x) => x.k === k)!; return { k, label: stepLabel(s.m, s.label) }; });
  }, [cols]);

  // quarter by quarter since the first comparative year, on the scope chosen
  const series = useMemo(() => {
    if (!rs.length) return [];
    const y0 = Number(rs[0].p.slice(0, 4)) - 1, last = rs[rs.length - 1].p, keys: string[] = [];
    for (let y = y0; y <= Number(last.slice(0, 4)); y++) for (const q of ['Q1', 'Q2', 'Q3', 'FY']) keys.push(`${y}${q}`);
    const o = { pref, scope: seg === 'all' ? undefined : (seg as ScopeId) };
    return keys.filter((k) => byPeriodDesc(k, last) >= 0).map((k) => {
      const b = span === 'q' ? quarter(rs, k, o) : best(rs, k, endOf(k), k.endsWith('FY') ? 'fy' : 'ytd', o);
      const eq = [rs.find((r) => r.p === k), ...rs].map((r) => (r ? equityAt(r.F, endOf(k)) : null)).find(Boolean) ?? null;
      return { k, b, eq, r: ratios(b, seg === 'all' ? eq?.v ?? null : null) };
    }).filter((x) => x.b);
  }, [rs, pref, seg, span]);

  if (error) return <ErrorBox what="נתוני CSM" error={error} />;
  if (!d) return <Loading what="CSM" />;
  if (!P) return <Empty title="הדוחות של החברה טרם חולצו" />;
  if (!cur) return <Loading what="CSM" />;
  const used = new Set<number>(), used2 = new Set<number>();
  const tot = cols[0];
  // the waterfall of the total column: every movement as a bar between the running balance before and after it
  const levels = tot?.open && tot.close ? (() => { let run = tot.open!.v; const at = new Map<string, [number, number]>(); tot.steps.forEach((s) => { at.set(s.k, [run, run + s.line.v]); run += s.line.v; }); return { at, run, lo: Math.min(tot.open!.v, tot.close!.v, ...[...at.values()].flat()), hi: Math.max(tot.open!.v, tot.close!.v, ...[...at.values()].flat()) }; })() : null;
  const pos = (v: number) => (levels && levels.hi > levels.lo ? ((v - levels.lo) / (levels.hi - levels.lo)) * 100 : 0);
  const bar = (from: number, to: number, cls: string) => <div className="wf" aria-hidden="true"><i className={cls} style={{ left: `${pos(Math.min(from, to))}%`, width: `${Math.max(Math.abs(pos(to) - pos(from)), 1)}%` }} /></div>;
  const tick = (v: number) => <div className="wf" aria-hidden="true"><i className="tk" style={{ left: `${Math.min(pos(v), 99)}%` }} /></div>;
  const wlabel = W === 'fy' ? 'FY' : W === 'q' ? 'QTD' : 'YTD';
  const shown = series.filter((x) => MEASURES.some((m) => x.r[m.k] != null));
  const pal = palette();
  // a column is a quarter (Q4'25), or a cumulative window named by its months (6M'26, FY'25)
  const plabel = (k: string) => (span === 'q' ? periodName(k).replace('FY', 'Q4') : k.endsWith('FY') ? periodName(k) : `${monthsOf(endOf(k), 'ytd')}M'${k.slice(2, 4)}`);

  return (
    <>
      <section className="controls">
        <div className="field"><span>דוח</span><Seg label="דוח" value={P} onChange={setPeriod} options={periods.map((p) => [p, periodName(p)])} /></div>
        {bases.length > 1 && <div className="field"><span>בסיס</span><Seg label="בסיס" value={pref} onChange={setBasis} options={bases.map((b) => [b, BASIS[b] ?? b])} /></div>}
        {!annual && <div className="field"><span>חלון</span><Seg label="חלון" value={win} onChange={setWin} options={[['q', 'QTD'], ['ytd', 'YTD']]} /></div>}
      </section>

      <Panel title="גשר CSM" aside={tot ? <><span className="chip">{BASIS[tot.b] ?? tot.b}</span><span className="chip">{wlabel}</span><span>{periodName(P)} · מיליוני ש"ח · כפי שדווח</span></> : undefined}>
        {!tot ? <Empty title="לא נמצאה תנועת CSM בדוח לבסיס ולחלון שנבחרו" /> : (
          <div className="scroll"><table className="csm-bridge">
            <thead><tr><th>שורה</th>{cols.map((b, i) => <th key={b.scope}>{SCOPE_HE[b.scope]}{i === 0 && <Marks ms={tableMarks(b, pref)} used={used} />}</th>)}{levels && <th className="wfh">מפל · {SCOPE_HE[tot.scope]}</th>}</tr></thead>
            <tbody>
              <tr className="lead"><td className="lbl">פתיחה</td>{cols.map((b) => <td key={b.scope}>{b.open ? <><Fig line={b.open} d={d} title={`CSM פתיחה · ${SCOPE_HE[b.scope]} · ${periodName(P)}`} text={showAmt(b.open.v)} /><Marks ms={[...lineMarks(b.open), ...(b.openPrev ? [8] : [])]} used={used} /></> : <span className="muted">–</span>}</td>)}{levels && <td>{tick(tot.open!.v)}</td>}</tr>
              {rows.map((r) => (
                <tr key={r.k}><td className="lbl">{r.label}</td>
                  {cols.map((b) => { const l = lineOf(b, r.k); return <td key={b.scope}>{l ? <><Fig line={l} d={d} title={`${r.label} · ${SCOPE_HE[b.scope]} · ${periodName(P)}`} text={(l.v > 0 ? '+' : '') + showAmt(l.v)} tone={l.v < 0 ? 'neg' : ''} /><Marks ms={lineMarks(l)} used={used} /></> : <span className="muted">–</span>}</td>; })}
                  {levels && <td>{levels.at.has(r.k) ? bar(levels.at.get(r.k)![0], levels.at.get(r.k)![1], levels.at.get(r.k)![1] < levels.at.get(r.k)![0] ? 'dn' : '') : null}</td>}
                </tr>
              ))}
              <tr className="csm-gap"><td className="lbl">הפרש לא מוסבר<span className="dim">נגזר: סגירה פחות פתיחה פחות השורות שמעל · שורות שהדוח לא מדפיס או שלא חולצו</span></td>
                {cols.map((b) => <td key={b.scope}>{b.gap == null ? <span className="muted">–</span> : <Sourced className={`num der ${Math.abs(b.gap) > 2 ? 'neg' : ''}`} src={() => gapProv(b, d, `הפרש לא מוסבר · ${SCOPE_HE[b.scope]} · ${periodName(P)}`, showAmt(Math.round(b.gap! * 10) / 10 || 0))}>{(b.gap > 0 ? '+' : '') + showAmt(Math.round(b.gap * 10) / 10 || 0)}</Sourced>}</td>)}
                {levels && <td>{tot.gap != null && Math.abs(tot.gap) > 2 ? bar(levels.run, tot.close!.v, 'gp') : null}</td>}
              </tr>
              <tr className="lead"><td className="lbl">סגירה</td>{cols.map((b) => <td key={b.scope}>{b.close ? <><Fig line={b.close} d={d} title={`CSM סגירה · ${SCOPE_HE[b.scope]} · ${periodName(P)}`} text={showAmt(b.close.v)} /><Marks ms={lineMarks(b.close)} used={used} /></> : <span className="muted">–</span>}</td>)}{levels && <td>{tick(tot.close!.v)}</td>}</tr>
            </tbody>
          </table></div>
        )}
        <Notes used={used} />
        {tot && <div className="src">כל מספר מקושר לעמוד בדוח. שחרור מוצג כהפחתה מהיתרה. ציר המפל מתחיל ביתרה הנמוכה ביותר בגשר ולא באפס.</div>}
      </Panel>

      <Panel title="כלכלת ה-CSM לאורך זמן" aside={<span>{span === 'q' ? 'רבעוני' : 'מצטבר מתחילת השנה'} · {BASIS[pref]} מועדף · כפי שדווח בכל תקופה</span>}>
        <section className="controls">
          <div className="field"><span>חלון</span><Seg<'q' | 'ytd'> label="חלון" value={span} onChange={setSpan} options={[['q', 'רבעון'], ['ytd', 'YTD']]} /></div>
          {cols.length > 1 && <div className="field"><span>מגזר</span><Seg<'all' | 'life' | 'health'> label="מגזר" value={seg} onChange={setSeg} options={[['all', 'סך הכול'], ['life', 'חיים וחיסכון'], ['health', 'בריאות']]} /></div>}
        </section>
        {shown.length === 0 ? <Empty title="אין תנועת CSM מחולצת למגזר שנבחר" /> : (
          <>
            {shown.filter((x) => x.r.nbRel != null || x.r.relOpen != null).length > 1 && (
              <Chart label={`כלכלת CSM ${id}`} height={250} deps={[id, span, seg, pref, shown.length, rs.length]} build={() => foxOption({
                x: shown.map((x) => plabel(x.k)), unit: '%', legend: true, labels: false, scale: true,
                series: [{ name: 'עסק חדש / שחרור', k: 'nbRel' as const, c: pal[0] }, { name: 'שחרור / CSM פתיחה, מנורמל לשנה', k: 'relOpen' as const, c: pal[2] }]
                  .map((s) => ({ name: s.name, kind: 'line' as const, pct: true, color: s.c, dec: 1, data: shown.map((x) => { const v = x.r[s.k]; return v == null ? null : +v.toFixed(2); }) })),
              })} onPoint={(si, di) => { const x = shown[di], k = (['nbRel', 'relOpen'] as const)[si]; const v = x?.r[k]; if (v != null) open(ratioProv(k, x.b, x.eq, d, `${MEASURES.find((m) => m.k === k)!.l} · ${plabel(x.k)}`, showMeasure('pct', v))); }} />
            )}
            <div className="scroll"><table className="csm-series">
              <thead><tr><th>מדד</th>{shown.map((x) => <th key={x.k}>{plabel(x.k)}<Marks ms={tableMarks(x.b!, pref)} used={used2} /><span className="dim">{BASIS[x.b!.b]} · {SCOPE_HE[x.b!.scope]}</span></th>)}</tr></thead>
              <tbody>{MEASURES.filter((m) => (m.k !== 'csmEq' || seg === 'all') && shown.some((x) => x.r[m.k] != null)).map((m) => (
                <tr key={m.k}><td className="lbl">{m.l}{m.from && <span className="dim">נגזר: {m.from}</span>}</td>
                  {shown.map((x) => {
                    const v = x.r[m.k];
                    if (v == null) return <td key={x.k}><span className="muted">–</span></td>;
                    const l = m.kind === 'amt' ? lineOf(x.b, m.k) : null;
                    const ttl = `${m.l} · ${plabel(x.k)}`, txt = showMeasure(m.kind, v);
                    return <td key={x.k}>{l ? <Fig line={l} d={d} title={ttl} text={txt} /> : m.kind === 'amt' ? <span className="num">{txt}</span> : <Sourced className="num der" src={() => ratioProv(m.k, x.b, x.eq, d, ttl, txt)}>{txt}</Sourced>}<Marks ms={l ? lineMarks(l) : m.kind === 'amt' ? [] : ratioMarks(x.b, m.k, x.r)} used={used2} /></td>;
                  })}
                </tr>
              ))}
              {seg === 'all' && shown.some((x) => x.eq) && <tr><td className="lbl">הון לבעלי המניות</td>{shown.map((x) => <td key={x.k}>{x.eq ? <Fig line={{ v: x.eq.v, fs: [x.eq] }} d={d} title={`הון לבעלי המניות · ${plabel(x.k)}`} text={showAmt(x.eq.v)} /> : <span className="muted">–</span>}</td>)}</tr>}
              </tbody>
            </table></div>
            <Notes used={used2} />
            <div className="src">IFRS 17 מיושם מ-2025; 2024 נלקחה מעמודות ההשוואה. מספר נטוי הוא נגזר. הרבעון הרביעי מוצג רק כשהחברה מדפיסה טבלת 9M על אותו בסיס ואותו היקף כמו הטבלה השנתית.</div>
          </>
        )}
      </Panel>
    </>
  );
}
