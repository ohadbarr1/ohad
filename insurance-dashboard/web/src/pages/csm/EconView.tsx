import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';
import { Chart } from '../../components/Chart';
import { Sourced } from '../../components/Source';
import { useSource, type Prov } from '../../lib/prov';
import { Empty, Panel, Pick, Seg } from '../../components/ui';
import { ContextBar, Sheet } from '../../components/Sheet';
import { IndustryTools } from '../Industry';
import { Fig, MEASURES, Marks, Notes, lineOf, showAmt, showMeasure } from '../../components/CsmEconomics';
import { foxOption } from '../../lib/foxchart';
import { chartBase } from '../../lib/theme';
import { idColor } from '../../lib/identity';
import { usePhone } from '../../lib/useMedia';
import { nf } from '../../lib/format';
import { BASIS, BUCKETS, BUCKET_END, SCOPE_HE, lineProv, periodName, ratioProv, runoff, endOf } from '../../lib/csm';
import type { Runoff } from '../../lib/csm';
import { INSURERS, agg2Prov, aggProv, atQ, closeSrc, industry, qLabel, quarterKeys, type Agg, type Agg2, type At, type Industry, type Ledger } from '../../lib/csmData';
import { Dot } from './LedgerView';
import { useParam } from './params';

type MK = (typeof MEASURES)[number]['k'];
/** The economics charts: one measure each, one axis each, the insurers in their identity colours and the industry as a dashed line. */
const CHARTS: { k: MK; t: string; ind: boolean }[] = [
  { k: 'close', t: 'יתרת CSM', ind: false },
  { k: 'nbRel', t: 'עסק חדש / שחרור', ind: true },
  { k: 'csmEq', t: 'CSM / הון לבעלי המניות', ind: true },
  { k: 'chg', t: 'צמיחת היתרה בחלון', ind: true },
  { k: 'intOpen', t: 'צבירת ריבית / CSM פתיחה', ind: true },
  { k: 'estOpen', t: 'שינויי אומדן / CSM פתיחה', ind: true },
  { k: 'relOpen', t: 'קצב שחרור, מנורמל לשנה', ind: true },
];
const IND_FORMULA: Partial<Record<MK, [string, string, string]>> = {
  nbRel: ['Σ עסק חדש ÷ Σ שחרור × 100', 'CSM עסק חדש', 'שחרור CSM'], csmEq: ['Σ יתרת CSM ÷ Σ הון לבעלי המניות', 'יתרת CSM', 'הון לבעלי המניות'],
  chg: ['Σ (סגירה − פתיחה) ÷ Σ פתיחה × 100', 'שינוי ביתרה', 'CSM פתיחה'], intOpen: ['Σ צבירת ריבית ÷ Σ פתיחה × 100', 'צבירת ריבית', 'CSM פתיחה'],
  estOpen: ['Σ שינויי אומדן ÷ Σ פתיחה × 100', 'שינויי אומדן', 'CSM פתיחה'], relOpen: ['Σ שחרור מנורמל לשנה ÷ Σ פתיחה × 100', 'שחרור מנורמל לשנה', 'CSM פתיחה'],
};

/** CSM economics over time: the franchise measures quarter by quarter for every insurer and the industry, and the expected release schedule. */
export function EconView({ L, name }: { L: Ledger; name: (id: string) => string }) {
  const { open } = useSource();
  const phone = usePhone();
  const { d, byCo, periods } = L;
  const [span, setSpan] = useParam<'q' | 'ytd'>('w', 'q', ['q', 'ytd']);
  const [pref, setPref] = useParam<'net' | 'gross'>('b', 'net', ['net', 'gross']);
  const [lead, setLead] = useParam<string>('f', '');
  const [mode, setMode] = useParam<'c' | 't'>('t', 'c', ['c', 't']);
  const [tk, setTk] = useParam<MK>('m', 'nbRel', MEASURES.map((m) => m.k));
  const [share, setShare] = useState<'v' | 'p'>('p');
  const [ctl, setCtl] = useState(false);
  const ids = useMemo(() => INSURERS.filter((id) => byCo.has(id)), [byCo]);
  const keys = useMemo(() => quarterKeys(periods), [periods]);
  const flows = useMemo(() => new Map(ids.map((id) => [id, keys.map((k) => atQ(byCo.get(id)!, id, k, span, pref))])), [byCo, ids, keys, span, pref]);
  // balances do not depend on the window: the closing CSM and CSM / equity are read from the fullest table printed for the date
  const stock = useMemo(() => (span === 'ytd' ? flows : new Map(ids.map((id) => [id, keys.map((k) => atQ(byCo.get(id)!, id, k, 'ytd', pref))]))), [byCo, ids, keys, span, pref, flows]);
  const BAL: MK[] = ['close', 'csmEq'];
  const gridOf = (k: MK) => (BAL.includes(k) ? stock : flows);
  const grid = flows;
  const inds = useMemo(() => keys.map((k, i) => industry(ids.map((id) => grid.get(id)![i]), pref, d, name, qLabel(k, span))), [keys, ids, grid, pref, d, name, span]);
  const indsS = useMemo(() => (stock === flows ? inds : keys.map((k, i) => industry(ids.map((id) => stock.get(id)![i]), pref, d, name, qLabel(k)))), [keys, ids, stock, flows, inds, pref, d, name]);
  const indsOf = (k: MK) => (BAL.includes(k) ? indsS : inds);
  const fy = periods.find((p) => p.endsWith('FY')) ?? '';
  const sched = useMemo(() => ids.map((id) => ({ id, s: fy ? runoff(byCo.get(id)!.find((r) => r.p === fy)?.F ?? [], endOf(fy), 'gross') : null })), [byCo, ids, fy]);

  // a line of amounts keeps one basis: points on another basis than the company's latest are left out
  const lastBasis = (id: string, k: MK) => [...gridOf(k).get(id)!].reverse().find((x) => x.r[k] != null)?.b?.b;
  const point = (id: string, i: number, k: MK): number | null => { const x = gridOf(k).get(id)![i], m = MEASURES.find((q) => q.k === k)!; return m.kind === 'amt' && x.b?.b !== lastBasis(id, k) ? null : x.r[k]; };
  const cols = (k: MK) => keys.map((key, i) => ({ key, i })).filter(({ i }) => ids.some((id) => point(id, i, k) != null));
  // an industry line adds up one constant set of insurers: those present in every period it shows. When no two insurers are present
  // throughout, the set is the latest period's and the line keeps only the periods where all of them are present.
  // the set: the insurers present in each of the last n periods. A broad set comes first (four insurers, else three, else two), then the
  // longest run of periods it covers: an industry line of two insurers over three years says less than one of five over a year.
  const constSet = (lists: string[][]): string[] => {
    for (const min of [4, 3, 2]) {
      let best: string[] = [];
      for (let n = 2; n <= lists.length; n++) { const S = ids.filter((id) => lists.slice(-n).every((l) => l.includes(id))); if (S.length >= min) best = S; }
      if (best.length) return best;
    }
    return lists.length === 1 && lists[0].length >= 2 ? ids.filter((id) => lists[0].includes(id)) : [];
  };
  const setOf = (k: MK): string[] => {
    if (!IND_FORMULA[k]) return [];
    return constSet(cols(k).map(({ i }) => indsOf(k)[i][k as 'nbRel']).filter((a): a is Agg2 => !!a).map((a) => a.num.parts.map((x) => x.id)));
  };
  const sets = new Map(CHARTS.map((c) => [c.k, setOf(c.k)] as const));
  if (!sets.has(tk)) sets.set(tk, setOf(tk));
  const keep = (g: Agg, S: string[]): Agg | null => { const parts = g.parts.filter((x) => S.includes(x.id)); return parts.length === S.length ? { v: parts.reduce((t, x) => t + x.v, 0), parts } : null; };
  const restrict = (a: Agg2 | null, S: string[]): Agg2 | null => { if (!a || S.length < 2) return null; const num = keep(a.num, S), den = keep(a.den, S); return num && den && den.v ? { v: (num.v / den.v) * a.scale, num, den, scale: a.scale } : null; };
  const indAgg = (I: Industry, k: MK) => (k === 'close' || k === 'nb' || k === 'rel' ? null : restrict(I[k as 'nbRel'], sets.get(k) ?? []));
  const indVal = (I: Industry, k: MK) => indAgg(I, k)?.v ?? null;
  const provOf = (id: string, i: number, k: MK): Prov => {
    const x = gridOf(k).get(id)![i], m = MEASURES.find((q) => q.k === k)!, v = x.r[k], title = `${m.l} · ${name(id)} · ${qLabel(keys[i], span)}`;
    if (v == null) return { k: 'none', title, why: 'הדוח לא מדפיס את השורות' };
    const txt = showMeasure(m.kind, v), l = m.kind === 'amt' ? lineOf(x.b, k) : null;
    return l ? (k === 'close' ? closeSrc(x, l, d, title, txt) : lineProv({ ...l, v: Math.abs(l.v) }, d, title, txt)) : ratioProv(k, x.b, x.eq, d, title, txt);
  };
  const indProv = (i: number, k: MK): Prov => { const I = indsOf(k)[i], a = indAgg(I, k)!, f = IND_FORMULA[k]!, m = MEASURES.find((q) => q.k === k)!; return agg2Prov(a, `${m.l} · ענף · ${qLabel(keys[i], span)}`, f[0], name, showMeasure(m.kind, a.v), f[1], f[2]); };

  const build = (k: MK, withInd: boolean) => (): EChartsCoreOption => {
    const m = MEASURES.find((q) => q.k === k)!, cs = cols(k), b = chartBase();
    const series = ids.map((id) => ({ name: name(id), kind: 'line' as const, color: idColor(id), pct: m.kind === 'pct', lead: lead === id, dim: !!lead && lead !== id, dec: m.kind === 'pct' ? 1 : m.kind === 'x' ? 2 : 0,
      faded: cs.map(({ i }) => !!gridOf(k).get(id)![i].b?.cmp || !!gridOf(k).get(id)![i].b?.der), data: cs.map(({ i }) => { const v = point(id, i, k); return v == null ? null : +v.toFixed(3); }) }));
    if (withInd) series.push({ name: 'ענף', kind: 'line' as const, color: b.mu, pct: m.kind === 'pct', lead: false, dim: !!lead, dec: m.kind === 'pct' ? 1 : 2, faded: cs.map(() => false), data: cs.map(({ i }) => { const v = indVal(indsOf(k)[i], k); return v == null ? null : +v.toFixed(3); }), dashed: true } as never);
    const o = foxOption({ x: cs.map(({ key }) => qLabel(key, span)), unit: m.kind === 'amt' ? 'מיליוני ש"ח' : m.kind === 'x' ? '×' : '%', legend: true, labels: false, full: true, scale: true, series });
    // ratios sit within a few points: the axis keeps a decimal (two for multiples) so its ticks are distinct
    if (m.kind !== 'amt') (o.yAxis as { axisLabel: { formatter: (v: number) => string } }[]).forEach((a) => { a.axisLabel.formatter = (v: number) => `\u200E${nf(v, m.kind === 'x' ? 2 : Math.abs(v) < 10 && v % 1 ? 1 : 0)}${m.kind === 'pct' ? '%' : ''}`; });
    // a closing balance a later report reprinted with another figure: a hollow ring on the point
    if (k === 'close') (o.series as { data: unknown[]; itemStyle: { color: string } }[]).forEach((s, si) => {
      const id = ids[si]; if (!id) return;
      s.data = s.data.map((v, j) => { const x = stock.get(id)![cs[j].i]; if (v == null || !x.re) return v; const val = typeof v === 'object' ? (v as { value: number }).value : v; return { value: val, symbol: 'circle', symbolSize: 10, itemStyle: { color: b.panel, borderColor: s.itemStyle.color, borderWidth: 2.5 } }; });
    });
    return o;
  };
  const onPoint = (k: MK, withInd: boolean) => (si: number, di: number) => { const c = cols(k)[di]; if (!c) return; if (withInd && si === ids.length) { if (indVal(indsOf(k)[c.i], k) != null) open(indProv(c.i, k)); return; } const id = ids[si]; if (id && point(id, c.i, k) != null) open(provOf(id, c.i, k)); };

  // industry new business against release: the two flows that decide whether the stock grows
  const nbrel0 = keys.map((key, i) => ({ key, i, nb: inds[i].steps.get('nb') ?? null, rel: inds[i].steps.get('rel') ?? null })).filter((x) => x.nb && x.rel);
  const inBoth = (x: (typeof nbrel0)[number]) => x.nb!.parts.map((p) => p.id).filter((id) => x.rel!.parts.some((q) => q.id === id));
  const nbSet = constSet(nbrel0.map(inBoth));
  const nbrel = nbrel0.map((x) => ({ ...x, nb: keep(x.nb!, nbSet), rel: keep(x.rel!, nbSet), n: nbSet.length })).filter((x) => nbSet.length >= 2 && x.nb && x.rel);

  const SetStrip = ({ S, what }: { S: string[]; what: string }) => S.length < 2 ? <div className="src">{what}: אין שתי חברות עם נתון בכל התקופות</div> : (
    <div className="csm-set" aria-label={`${what}: החברות בסכום`}><span className="dim">{what} · {S.length} מתוך {ids.length}, אותן חברות בכל נקודה:</span>{ids.map((id) => <span key={id} className={`csm-chip${S.includes(id) ? '' : ' off'}`} title={S.includes(id) ? 'בסכום' : 'חסר באחת התקופות המוצגות'}><Dot id={id} />{name(id)}</span>)}</div>);
  const controls = (
    <section className={phone ? "controls" : "tbar-fields"}>
      <div className="field"><span>חלון</span><Seg<'q' | 'ytd'> label="חלון" value={span} onChange={setSpan} options={[['q', 'רבעון'], ['ytd', 'מצטבר']]} /></div>
      <div className="field"><span>בסיס מועדף</span><Seg<'net' | 'gross'> label="בסיס מועדף" value={pref} onChange={setPref} options={[['net', 'נטו'], ['gross', 'ברוטו']]} /></div>
      <Pick label="מיקוד" cap="מיקוד" value={lead} onChange={setLead} options={[['', 'כל החברות'], ...ids.map((id) => [id, name(id)] as [string, string])]} />
      <div className="field"><span>תצוגה</span><Seg<'c' | 't'> label="תצוגה" value={mode} onChange={setMode} options={[['c', 'גרפים'], ['t', 'טבלה']]} /></div>
    </section>
  );
  const used = new Set<number>(), used3 = new Set<number>();
  const have = sched.filter((x) => x.s);
  const totalProv = (x: { id: string; s: Runoff | null }): Prov => { const s = x.s!, title = `סך לוח השחרור · ${name(x.id)} · ${periodName(fy)}`; return s.printed ? lineProv(s.printed, d, title) : { k: 'calc', title, value: showAmt(s.total), unit: 'מיליוני ש"ח', formula: 'סכום שמונה התקופות של הלוח', inputs: s.cells.map((c, i) => ({ label: BUCKETS[i], v: showAmt(c!.v), src: () => lineProv(c!, d, `${BUCKETS[i]} · ${name(x.id)}`) })) }; };
  const shareProv = (x: { id: string; s: Runoff | null }, upto: number, cum: boolean): Prov => {
    const s = x.s!, cells = cum ? s.cells.slice(0, upto + 1) : [s.cells[upto]], v = cells.reduce((t, c) => t + c!.v, 0);
    return { k: 'calc', title: `${cum ? 'שחרור מצטבר עד ' + (BUCKET_END[upto] ?? '') + ' שנים' : BUCKETS[upto]}, % מהסך · ${name(x.id)} · ${periodName(fy)}`, value: `${nf((v / s.total) * 100, 1)}%`, formula: `${cum ? 'סכום התקופות עד האופק' : 'שחרור התקופה'} ÷ סך הלוח × 100`,
      inputs: [...cells.map((c, i) => ({ label: BUCKETS[cum ? i : upto], v: showAmt(c!.v), src: () => lineProv(c!, d, `${BUCKETS[cum ? i : upto]} · ${name(x.id)}`) })), { label: 'סך הלוח', v: showAmt(s.total), src: () => totalProv(x) }] };
  };
  const tm = MEASURES.find((m) => m.k === tk)!, tcols = cols(tk);

  return (
    <>
      {phone ? <><ContextBar onOpen={() => setCtl(true)}>{span === 'q' ? 'רבעוני' : 'מצטבר'} · {BASIS[pref]}{lead ? ` · ${name(lead)}` : ''} · {mode === 'c' ? 'גרפים' : 'טבלה'}</ContextBar><Sheet open={ctl} onClose={() => setCtl(false)} title="כלכלת CSM">{controls}</Sheet></> : <IndustryTools>{controls}</IndustryTools>}

      {mode === 'c' ? (
        <>
          <Panel title="עסק חדש מול שחרור, ענף" aside={<span>מיליוני ש"ח · {span === 'q' ? 'רבעוני' : 'מצטבר מתחילת השנה'} · {BASIS[pref]}</span>}>
            {nbrel.length < 2 ? <Empty title="אין רצף" /> : <Chart label="עסק חדש מול שחרור CSM, ענף" height={260} deps={[span, pref, nbrel.length]} build={() => foxOption({ x: nbrel.map((x) => qLabel(x.key, span)), unit: 'מיליוני ש"ח', legend: true, labels: false, full: true,
              series: [{ name: 'עסק חדש', kind: 'bar', color: chartBase().up, data: nbrel.map((x) => +x.nb!.v.toFixed(1)) }, { name: 'שחרור לרווח', kind: 'bar', color: chartBase().down, data: nbrel.map((x) => +Math.abs(x.rel!.v).toFixed(1)) }] })}
              onPoint={(si, di) => { const x = nbrel[di]; if (!x) return; const a = si === 0 ? x.nb! : x.rel!; open(aggProv(si === 0 ? a : { ...a, v: Math.abs(a.v) }, `${si === 0 ? 'עסק חדש' : 'שחרור'} · ענף · ${qLabel(x.key, span)}`, name)); }} />}
            <SetStrip S={nbSet} what={`ענף, ${BASIS[pref]}`} /></Panel>
          <div className="csm-grid">
            {CHARTS.map((c) => {
              const m = MEASURES.find((q) => q.k === c.k)!, cs = cols(c.k);
              return (
                <Panel key={c.k} title={c.t} aside={<span>{m.kind === 'amt' ? 'מיליוני ש"ח' : m.kind === 'x' ? '×' : '%'}{m.from ? ' · נגזר' : ''}</span>}>
                  {cs.length < 2 ? <Empty title="אין רצף" /> : <Chart label={`${c.t} · CSM`} height={phone ? 250 : 270} deps={[c.k, span, pref, lead, cs.length, byCo.size]} build={build(c.k, c.ind)} onPoint={onPoint(c.k, c.ind)} />}
                  {m.from && <div className="src">{m.from}{c.ind ? '. ענף: יחס הסכומים' : ''}</div>}
                  {c.ind && cs.length >= 2 && <SetStrip S={sets.get(c.k) ?? []} what="ענף" />}
                </Panel>
              );
            })}
          </div>
          <div className="src">נקודה בהירה: נגזרת (Q4 = FY פחות 9M) או מדוח מאוחר שהדפיס את התקופה שוב. טבעת: יתרה שהוצגה מחדש בדוח מאוחר. IFRS 17 מיושם מ-2025; 2024 מעמודות ההשוואה. כל נקודה פותחת את מקורה.</div>
        </>
      ) : (
        <Panel title={tm.l} aside={<span>{span === 'q' ? 'רבעוני' : 'מצטבר'} · {tm.kind === 'amt' ? 'מיליוני ש"ח' : tm.kind === 'x' ? '×' : '%'} · ÷ נגזר</span>}>
          <section className="controls"><Pick<MK> label="מדד" cap="מדד" value={tk} onChange={setTk} options={MEASURES.map((m) => [m.k, m.l] as [MK, string])} /></section>
          {tcols.length === 0 ? <Empty title="אין נתונים" /> : <div className="scroll"><table className="csm-series">
            <thead><tr><th>חברה</th>{tcols.map(({ key }) => <th key={key}><span className="num">{qLabel(key, span)}</span></th>)}</tr></thead>
            <tbody>{ids.map((id) => (
              <tr key={id} className={lead === id ? 'lead' : ''}><td><Dot id={id} /><Link to={`/company/${id}/ifrs17`}>{name(id)}</Link></td>
                {tcols.map(({ i }) => { const x: At = gridOf(tk).get(id)![i], v = point(id, i, tk); if (v == null) return <td key={i}><span className="muted">–</span></td>; const l = tm.kind === 'amt' ? lineOf(x.b, tk) : null, txt = showMeasure(tm.kind, v);
                  return <td key={i}>{l ? <Fig line={tk === 'rel' ? { ...l, v: Math.abs(l.v) } : l} d={d} title={`${tm.l} · ${name(id)}`} text={txt} src={() => provOf(id, i, tk)} /> : <Sourced className="num der" src={() => provOf(id, i, tk)}>{txt}</Sourced>}<Marks ms={[...(x.b?.der ? [10] : []), ...(x.b?.cmp ? [11] : []), ...(tk === 'close' && x.re ? [12] : []), ...(x.b && x.b.b !== pref ? [0] : [])]} used={used} /></td>; })}
              </tr>
            ))}
            {IND_FORMULA[tk] && <tr className="indrow"><td>ענף<span className="dim">{(sets.get(tk) ?? []).length} חברות קבועות</span></td>{tcols.map(({ i }) => { const v = indVal(indsOf(tk)[i], tk); return <td key={i}>{v == null ? <span className="muted">–</span> : <Sourced className="num der" src={() => indProv(i, tk)}>{showMeasure(tm.kind, v)}</Sourced>}</td>; })}</tr>}
            </tbody>
          </table></div>}
          <Notes used={used} />
          {tm.from && <div className="src">נגזר: {tm.from}.</div>}
        </Panel>
      )}

      <Panel title="שחרור CSM צפוי לרווח" aside={fy ? <span>{periodName(fy)} · {share === 'v' ? 'מיליוני ש"ח' : '% מסך הלוח, נגזר'} · לפי שנים מתאריך המאזן</span> : undefined}>
        {have.length === 0 ? <Empty title="לוח השחרור מתפרסם בדוח השנתי, ולא נמצא בדוחות שחולצו" /> : (
          <>
            <section className="controls"><div className="field"><span>תצוגה</span><Seg<'v' | 'p'> label="תצוגה" value={share} onChange={setShare} options={[['p', '% מהסך'], ['v', 'מיליוני ש"ח']]} /></div></section>
            <Chart label="שחרור CSM צפוי, מצטבר" height={280} deps={[fy, lead, have.length]} build={() => foxOption({
              x: BUCKET_END.slice(0, -1).map((y) => `עד ${y} ${y === 1 ? 'שנה' : 'שנים'}`), unit: '%', legend: true, labels: false, full: true,
              series: have.map((x) => { let run = 0; return { name: name(x.id), kind: 'line' as const, pct: true, color: idColor(x.id), lead: lead === x.id, dim: !!lead && lead !== x.id, dec: 1, data: x.s!.cells.slice(0, -1).map((c) => { run += c!.v; return +((run / x.s!.total) * 100).toFixed(2); }) }; }),
            })} onPoint={(si, di) => { const x = have[si]; if (x) open(shareProv(x, di, true)); }} />
            <div className="scroll"><table className="csm-series">
              <thead><tr><th>חברה</th>{BUCKETS.map((b) => <th key={b}>{b}</th>)}<th>סך הלוח</th></tr></thead>
              <tbody>{have.map((x) => (
                <tr key={x.id} className={lead === x.id ? 'lead' : ''}>
                  <td><Dot id={x.id} /><Link to={`/company/${x.id}/ifrs17`}>{name(x.id)}</Link><Marks ms={x.s!.scope === 'lh' ? [2] : x.s!.scope === 'life' ? [3] : []} used={used3} /><span className="dim">{BASIS[x.s!.b]} · {SCOPE_HE[x.s!.scope]}</span></td>
                  {x.s!.cells.map((c, i) => <td key={i}>{share === 'v' ? <Fig line={c!} d={d} title={`${BUCKETS[i]} · ${name(x.id)} · ${periodName(fy)}`} text={showAmt(c!.v)} /> : <Sourced className="num der" src={() => shareProv(x, i, false)}>{nf((c!.v / x.s!.total) * 100, 1)}%</Sourced>}</td>)}
                  <td>{x.s!.printed ? <Fig line={x.s!.printed} d={d} title={`סך הלוח · ${name(x.id)} · ${periodName(fy)}`} text={showAmt(x.s!.printed.v)} /> : <Sourced className="num der" src={() => totalProv(x)}>{showAmt(x.s!.total)}</Sourced>}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <Notes used={used3} />
            <div className="src">הגרף: החלק המצטבר מסך הלוח שצפוי להשתחרר עד כל אופק. {ids.length > have.length && `ללא לוח בדוח: ${ids.filter((id) => !have.some((x) => x.id === id)).map(name).join(', ')}.`}</div>
          </>
        )}
      </Panel>
    </>
  );
}
