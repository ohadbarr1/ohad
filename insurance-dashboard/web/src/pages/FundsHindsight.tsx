import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BasisToggle, FundsHead } from '../components/FundsNav';
import { Sourced } from '../components/Source';
import { DataTable } from '../components/DataTable';
import { Tip } from '../components/Explain';
import { Empty, ErrorBox, Loading, Panel, Pick } from '../components/ui';
import { fundP, monthIn } from '../lib/market';
import type { Prov } from '../lib/prov';
import { useMacro } from '../lib/macro';
import { nf } from '../lib/format';
import { useFundCats, useFunds } from '../lib/useData';
import { GROSS_LABEL, NET_LABEL, NET_NOTE, catKey, netMonthIn, netSeries, refOf, selfDirected, useBasis, ym, type CatX, type FundX, type FundsFile, type HistX } from '../lib/funds';
import { addM, deposits, dist, irr, monthsFromTo, placeOf, runTrack, totalOf, type DepPlan, type Run } from '../lib/fundsCalc';
import { fromMonthInput, numQ, toMonthInput, useClosed, useHists } from '../lib/fundsLoad';
import { ToolLinks } from './FundsTools';
import '../styles/lens.css';
import '../styles/fundsTools.css';

/* /funds/tools/hindsight (funds plan #8, "מה היה לי"): a deposit history run through every track of a category, as it really was.
   Each month: the deposit, less the track's deposit fee, joins the balance at the start of the month and the balance earns the
   month's published return (net of the accumulation fee by default: the build's `yn`, else gross − fee ÷ 12; gross on request, labelled).
   Survivorship: tracks that closed inside the window are kept while they lived; after their last month the balance runs on the
   category's asset-weighted average (cat.json), flagged. Tracks born after the first deposit could not have been chosen: left out, counted.
   Everything runs here; the inputs live only in the address. */

const ils = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 0)} ש"ח`);
const pct = (v: number | null | undefined, d = 1) => (v == null ? '–' : `${nf(v, d)}%`);
const PRESETS: [string, Partial<Record<string, string>>][] = [
  ['1,000 ש"ח לחודש · 10 שנים', { m: 'm', a: '1000', r: '0', y: '10' }],
  ['2,000 ש"ח לחודש · 5 שנים · העלאה 3%', { m: 'm', a: '2000', r: '3', y: '5' }],
  ['500 ש"ח לחודש · 15 שנים', { m: 'm', a: '500', r: '0', y: '15' }],
  ['100,000 ש"ח חד-פעמי · 5 שנים', { m: 'l', a: '100000', r: '0', y: '5' }],
];
interface Row { f: FundX; h: HistX; run: Run; irr: number | null; depfee: number; series: (number | null)[]; netPub: boolean }

export function FundsHindsight() {
  const { data: raw, error } = useFunds();
  const data = raw as FundsFile | undefined;
  const cats = useFundCats().data as Record<string, CatX> | undefined;
  const closed = useClosed();
  const cpi = useMacro().data?.series.cpi;
  const [basis] = useBasis();
  const [sp, setSp] = useSearchParams();
  const set = (patch: Record<string, string | null>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v == null ? n.delete(k) : n.set(k, v))); setSp(n, { replace: true }); };
  const asof = data?.asof ?? 0;

  // the inputs (the address is the state)
  const cat = sp.get('cat') ?? 'השתלמות | כללי';
  const mode: 'm' | 'l' = sp.get('m') === 'l' ? 'l' : 'm';
  const amount = numQ(sp.get('a'), mode === 'l' ? 100000 : 1000, 0, 1e9);
  const raise = numQ(sp.get('r'), 0, -20, 50);
  const to = Math.min(fromMonthInput(sp.get('to') ?? '') ?? asof, asof || 999999);
  const yrs = numQ(sp.get('y'), 10, 1, 40);
  const from = fromMonthInput(sp.get('from') ?? '') ?? (asof ? addM(to, -Math.round(yrs * 12) + 1) : 0);
  const withDep = sp.get('df') !== '0';
  const net = basis === 'net';

  // the category's members: open and closed, managed tracks only
  const all = useMemo(() => (data && closed ? [...data.funds as FundX[], ...closed] : []), [data, closed]);
  const catList = useMemo(() => { const m = new Map<string, number>(); all.forEach((f) => { if (!selfDirected(f)) m.set(catKey(f), (m.get(catKey(f)) ?? 0) + 1); }); return m; }, [all]);
  const prods = useMemo(() => [...new Set(all.map((f) => f.prod))], [all]);
  const [prod, track] = cat.split(' | ');
  const tracks = useMemo(() => [...catList.keys()].filter((k) => k.startsWith(prod + ' | ') && catList.get(k)! >= 3).map((k) => k.split(' | ')[1]), [catList, prod]);
  // open to the public only: a sectoral fund (קופה ענפית, `closed`) takes only its own members
  const members = useMemo(() => all.filter((f) => catKey(f) === cat && !selfDirected(f) && !f.closed), [all, cat]);
  const sectoral = useMemo(() => all.filter((f) => catKey(f) === cat && f.closed).length, [all, cat]);
  const keys = useMemo(() => members.map((f) => f.k), [members]);
  const { hist, failed, pending } = useHists(keys);

  const plan: DepPlan = { mode, start: from, end: to, amount, raise };
  const dep = useMemo(() => deposits(plan), [mode, from, to, amount, raise]);  // eslint-disable-line react-hooks/exhaustive-deps
  const total = totalOf(dep);
  const c = cats?.[cat];
  // the fill: the category's asset-weighted average of the month, on the same basis (net when published for the month, else gross)
  const fill = useMemo(() => new Map((c?.p ?? []).map((p, i) => [p, net ? (c!.yn?.[i] ?? c!.y[i]) : c!.y[i]] as [number, number | null])), [c, net]);
  const fillGross = useMemo(() => (net && c ? c.p.filter((p, i) => c.yn?.[i] == null && p >= from && p <= to).length : 0), [c, net, from, to]);

  const rows: Row[] = useMemo(() => members.flatMap((f) => {
    const h = hist[f.k]; if (!h) return [];
    const ns = net ? netSeries(h) : null, series = ns ? ns.y : h.y, depfee = withDep ? f.depfee ?? 0 : 0;
    const run = runTrack(h.p, series, dep, { start: from, end: to, depfee, fill });
    return run ? [{ f, h, run, irr: irr(from, dep, run.bal, run.months), depfee, series, netPub: !!ns?.pub }] : [];
  }).sort((a, b) => b.run.bal - a.run.bal), [members, hist, net, withDep, dep, from, to, fill]);
  const later = members.filter((f) => hist[f.k] && !rows.some((r) => r.f.k === f.k));
  const d = dist(rows.map((r) => r.run.bal));
  const kQ = sp.get('k');
  const me = rows.find((r) => r.f.k === kQ) ?? [...rows].filter((r) => !r.f.gone).sort((a, b) => (b.f.assets ?? 0) - (a.f.assets ?? 0))[0];
  const place = me ? placeOf(me.run.bal, rows.map((r) => r.run.bal)) : null;

  if (error) return <ErrorBox what="נתוני הקופות" error={error} />;
  if (!data || !closed) return <Loading what="מחשבון" />;
  const lbl = net ? NET_LABEL : GROSS_LABEL;
  const badRange = !(from <= to) || to > asof;

  /* ---- sources ---- */
  const planInputs = [{ label: mode === 'm' ? 'הפקדה חודשית (קלט שלך)' : 'סכום חד-פעמי (קלט שלך)', v: ils(amount) }, ...(mode === 'm' ? [{ label: 'העלאה שנתית (קלט שלך)', v: pct(raise) }] : []), { label: 'מ-', v: ym(from) }, { label: 'עד', v: ym(to) }];
  const totalProv = (): Prov => ({ k: 'calc', title: 'סך ההפקדות', value: ils(total), formula: mode === 'm' ? 'Σ על החודשים: הפקדה חודשית × (1 + העלאה)^⌊חודשים מההתחלה ÷ 12⌋' : 'הסכום החד-פעמי', inputs: planInputs });
  const monthRow = (r: Row, p: number) => (net ? netMonthIn(refOf(r.f), r.h, p, netSeries(r.h)) : monthIn(refOf(r.f), 'y', p, r.h.y[r.h.p.indexOf(p)]));
  const runProv = (r: Row): Prov => {
    const ms = monthsFromTo(from, to), last = r.run.closedAt;
    return { k: 'calc', est: net, title: `היתרה ב-${ym(to)} · ${r.f.name}`, value: ils(r.run.bal),
      formula: `כל חודש: יתרה = (יתרה קודמת + הפקדה × (1 − ד"נ מהפקדה)) × (1 + תשואת החודש). הפקדה בתחילת החודש; תשואה ${lbl}.${last ? ` המסלול נסגר אחרי ${ym(last)}: מהחודש שאחריו, תשואת ממוצע הקטגוריה (משוקלל נכסים).` : ''}${r.run.filled ? ` ${r.run.filled} חודשים בלי תשואה בחיי המסלול: ממוצע הקטגוריה.` : ''}`,
      note: net ? NET_NOTE + '. דמי ניהול מהפקדה: האחרונים שפורסמו, על כל התקופה (אומדן; הרשות מפרסמת רק את הנוכחיים)' : 'ברוטו: לפני דמי ניהול מצבירה. דמי ניהול מהפקדה: האחרונים שפורסמו, על כל התקופה',
      inputs: [...planInputs, { label: 'דמי ניהול מהפקדה', v: withDep ? pct(r.depfee, 2) : 'לא נוכו', src: withDep ? () => fundP(refOf(r.f), r.f.end ?? asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה', pct(r.f.depfee, 2)) : undefined },
        ...ms.map((p) => (last && p > last ? { label: `ממוצע הקטגוריה · ${ym(p)}`, v: pct(fill.get(p) ?? null, 2) } : monthRow(r, p)))] };
  };
  const listProv = (title: string, v: number, formula: string): Prov => ({ k: 'calc', est: net, title, value: ils(v), formula, inputs: rows.map((r) => ({ label: r.f.name, v: ils(r.run.bal), src: () => runProv(r) })) });
  const gapProv = (a: Row, b: { label: string; v: number; src: () => Prov }): Prov => ({ k: 'calc', est: net, title: `הפער · ${a.f.name} מול ${b.label}`, value: ils(a.run.bal - b.v), formula: 'היתרה במסלול שבחרת פחות היתרה השנייה', inputs: [{ label: a.f.name, v: ils(a.run.bal), src: () => runProv(a) }, { label: b.label, v: ils(b.v), src: b.src }] });
  const irrProv = (r: Row): Prov => ({ k: 'calc', est: net, title: `תשואה שנתית משוקללת הפקדות · ${r.f.name}`, value: pct(r.irr, 2), formula: 'השיעור החודשי i שבו Σ הפקדה × (1 + i)^(חודשים עד הסוף) = היתרה, בשנתי: (1 + i)^12 − 1. ההפקדות לפני דמי ניהול מהפקדה, כך שהשיעור כולל אותם',
    inputs: [{ label: 'סך ההפקדות', v: ils(total), src: totalProv }, { label: 'היתרה', v: ils(r.run.bal), src: () => runProv(r) }, { label: 'חודשים', v: nf(r.run.months, 0) }] });
  // CPI-linked deposits: what the deposits would be worth if they had only kept their value
  const cpiAt = new Map((cpi?.points ?? []).filter((x) => x.mom != null).map((x) => [Number(x.m.replace('-', '')), x.mom as number]));
  const cpiMs = monthsFromTo(from, to), cpiOk = cpiMs.every((p) => cpiAt.has(p));
  const indexed = cpiOk ? [...dep].reduce((s, [p, a]) => s + a * monthsFromTo(p, to).reduce((t, q) => t * (1 + cpiAt.get(q)! / 100), 1), 0) : null;
  const indexedProv = (): Prov => ({ k: 'calc', title: 'ההפקדות צמודות למדד', value: ils(indexed), formula: 'כל הפקדה × מכפלת (1 + שינוי המדד) מחודש ההפקדה עד הסוף: כמה היו שוות ההפקדות אילו רק שמרו על ערכן',
    inputs: [{ label: 'סך ההפקדות', v: ils(total), src: totalProv }, ...cpiMs.map((p) => ({ label: `מדד המחירים לצרכן, שינוי · ${ym(p)}`, v: pct(cpiAt.get(p), 1) }))] });

  /* ---- the strip ---- */
  const W = 600, PAD = 14;
  const xOf = (v: number) => (d && d.max > d.min ? PAD + (v - d.min) / (d.max - d.min) * (W - 2 * PAD) : W / 2);
  const lanes = (() => { const used: number[][] = []; return rows.map((r) => { const x = xOf(r.run.bal); let lane = 0; while (lane < 9 && (used[lane] ?? []).some((u) => Math.abs(u - x) < 9)) lane++; (used[lane] ??= []).push(x); return { r, x, lane }; }); })();
  const H = 30 + Math.max(1, ...lanes.map((l) => l.lane + 1)) * 10;

  return (
    <>
      <FundsHead title="מה היה לי" sub={<>ההפקדות שלך דרך כל מסלול בקטגוריה, כפי שהיה באמת · נתונים עד {ym(asof)}</>} tools={<BasisToggle real={false} />} />
      <ToolLinks />

      <Panel title="ההפקדות" aside={<span className="chip">קלט שלך · לא נשלח</span>}>
        <div className="fform">
          <label><span>מוצר</span><select value={prod} onChange={(e) => { const p = e.target.value; const t = [...catList.keys()].filter((k) => k.startsWith(p + ' | ')).sort((a, b) => catList.get(b)! - catList.get(a)!)[0]; set({ cat: t ?? `${p} | כללי`, k: null }); }}>{prods.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          <label><span>מסלול (קטגוריה)</span><select value={track} onChange={(e) => set({ cat: `${prod} | ${e.target.value}`, k: null })}>{tracks.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label><span>אופן ההפקדה</span><select value={mode} onChange={(e) => set({ m: e.target.value })}><option value="m">הפקדה חודשית</option><option value="l">סכום חד-פעמי</option></select></label>
          <label><span>{mode === 'm' ? 'סכום לחודש, ש"ח' : 'סכום, ש"ח'}</span><input type="number" inputMode="decimal" min={0} step={100} value={amount} onChange={(e) => set({ a: e.target.value })} /></label>
          {mode === 'm' && <label><span>העלאה שנתית, %</span><input type="number" inputMode="decimal" step={0.5} value={raise} onChange={(e) => set({ r: e.target.value })} /></label>}
          <label><span>מחודש</span><input type="month" value={from ? toMonthInput(from) : ''} min="1999-01" max={asof ? toMonthInput(asof) : undefined} onChange={(e) => set({ from: e.target.value || null })} /></label>
          <label><span>עד חודש</span><input type="month" value={to ? toMonthInput(to) : ''} min="1999-01" max={asof ? toMonthInput(asof) : undefined} onChange={(e) => set({ to: e.target.value || null })} /></label>
          <label><span>דמי ניהול מהפקדה <Tip k="depfee" /></span><select value={withDep ? '1' : '0'} onChange={(e) => set({ df: e.target.value === '1' ? null : '0' })}><option value="1">לנכות (של כל מסלול)</option><option value="0">לא לנכות</option></select></label>
        </div>
        <div className="fpresets"><span>מוכנים:</span>{PRESETS.map(([l, q]) => <button key={l} type="button" className="chip" onClick={() => set({ m: q.m!, a: q.a!, r: q.r!, y: q.y!, from: null, to: null })}>{l}</button>)}</div>
        <div className="fprivacy">החישוב רץ בדפדפן הזה. הסכומים נשמרים רק בכתובת העמוד (כדי שקישור ישחזר את החישוב) ולא נשלחים לשום מקום.</div>
      </Panel>

      {badRange ? <Empty title="טווח החודשים אינו תקין">חודש ההתחלה צריך להקדים את חודש הסיום, והסיום לא אחרי {ym(asof)}.</Empty>
        : members.length === 0 ? <Empty title="אין מסלולים בקטגוריה הזו" />
        : pending > 0 && rows.length < 2 ? <Loading what={`היסטוריות (${keys.length - pending} מתוך ${keys.length})`} />
        : rows.length === 0 ? <Empty title="אף מסלול בקטגוריה לא היה קיים בחודש ההתחלה">נסו חודש התחלה מאוחר יותר.</Empty> : (
        <>
          <section className="kpis">
            <div className="kpi"><div className="l">הפקדת</div><div className="v num"><Sourced src={totalProv}>{ils(total)}</Sourced></div><div className="s">{ym(from)}–{ym(to)} · {dep.size} הפקדות</div></div>
            {me && <div className="kpi"><div className="l">במסלול שבחרת</div><div className="v num"><Sourced src={() => runProv(me)}>{ils(me.run.bal)}</Sourced></div><div className="s">מקום {place?.rank} מתוך {place?.n}{me.irr != null && <> · <Sourced src={() => irrProv(me)}>{pct(me.irr, 1)}</Sourced> לשנה</>}</div></div>}
            {d && <div className="kpi"><div className="l">החציון בקטגוריה</div><div className="v num"><Sourced src={() => listProv(`חציון היתרות · ${cat}`, d.med, 'החציון של היתרות בכל המסלולים שהיו קיימים בחודש ההתחלה')}>{ils(d.med)}</Sourced></div><div className="s">{rows.length} מסלולים</div></div>}
            {d && <div className="kpi"><div className="l">הטוב · החלש</div><div className="v num"><Sourced src={() => runProv(rows[0])}>{ils(d.max)}</Sourced></div><div className="s"><Sourced src={() => runProv(rows[rows.length - 1])}>{ils(d.min)}</Sourced></div></div>}
            {indexed != null && <div className="kpi"><div className="l">ההפקדות צמודות למדד</div><div className="v num"><Sourced src={indexedProv}>{ils(indexed)}</Sourced></div><div className="s">רק שמירת ערך</div></div>}
          </section>

          {me && d && <Panel title="הפער בשקלים" aside={<><span className={`chip${net ? ' est' : ''}`}>{lbl}</span><Pick label="המסלול שלך" value={me.f.k} onChange={(k) => set({ k })} options={rows.map((r) => [r.f.k, r.f.name] as [string, string])} /></>}>
            <p className="fread">ב{me.f.name}, אותן הפקדות שוות היום <Sourced src={() => runProv(me)}>{ils(me.run.bal)}</Sourced>:
              {' '}<Sourced src={() => gapProv(me, { label: 'החציון', v: d.med, src: () => listProv(`חציון היתרות · ${cat}`, d.med, 'החציון של היתרות') })}><span className={`num ${me.run.bal >= d.med ? 'pos' : 'neg'}`}>{me.run.bal >= d.med ? '+' : '−'}{ils(Math.abs(me.run.bal - d.med))}</span></Sourced> מול החציון,
              {' '}ו-<Sourced src={() => gapProv(me, { label: rows[0].f.name, v: rows[0].run.bal, src: () => runProv(rows[0]) })}><span className="num neg">{ils(Math.abs(me.run.bal - d.max))}</span></Sourced> פחות מהמסלול הטוב בקטגוריה{me === rows[0] ? ' (זה הוא)' : ''}.
              {' '}בין הטוב לחלש: <Sourced src={() => ({ k: 'calc', est: net, title: `הפער בין הטוב לחלש · ${cat}`, value: ils(d.max - d.min), formula: 'היתרה הגבוהה פחות הנמוכה', inputs: [{ label: rows[0].f.name, v: ils(d.max), src: () => runProv(rows[0]) }, { label: rows[rows.length - 1].f.name, v: ils(d.min), src: () => runProv(rows[rows.length - 1]) }] })}><span className="num">{ils(d.max - d.min)}</span></Sourced>.</p>
            <svg className="fdots" direction="ltr" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`פיזור היתרות של ${rows.length} מסלולים: מ-${ils(d.min)} עד ${ils(d.max)}, חציון ${ils(d.med)}; המסלול שבחרת ${ils(me.run.bal)}`}>
              <line className="ax" x1={PAD} x2={W - PAD} y1={H - 18} y2={H - 18} />
              <line className="med" x1={xOf(d.med)} x2={xOf(d.med)} y1={4} y2={H - 14} />
              {lanes.filter((l) => l.r !== me).map((l) => <circle key={l.r.f.k} className={`dot${l.r.run.closedAt ? ' gone' : ''}`} cx={l.x} cy={H - 26 - l.lane * 10} r={4}><title>{`${l.r.f.name}: ${ils(l.r.run.bal)}`}</title></circle>)}
              {lanes.filter((l) => l.r === me).map((l) => <circle key="me" className="dot me" cx={l.x} cy={H - 26 - l.lane * 10} r={6}><title>{`${l.r.f.name}: ${ils(l.r.run.bal)}`}</title></circle>)}
              <text x={PAD} y={H - 4} textAnchor="start">{ils(d.min)}</text>
              <text x={W - PAD} y={H - 4} textAnchor="end">{ils(d.max)}</text>
              <text x={xOf(d.med)} y={H - 4} textAnchor="middle">חציון</text>
            </svg>
            <div className="fnote">כל נקודה היא מסלול; עיגול מקווקו = מסלול שנסגר בתוך התקופה; קו מקווקו = החציון; הנקודה המודגשת = המסלול שבחרת.</div>
          </Panel>}

          <Panel title="כל המסלולים בקטגוריה" aside={<span className={`chip${net ? ' est' : ''}`}>{lbl}</span>}>
            <DataTable<Row> caption={`מה היה לי · ${cat}`} rows={rows} rowKey={(r) => r.f.k} rowClass={(r) => (r === me ? 'fme' : undefined)}
              export={{ name: `מה-היה-לי-${ym(to).replace('/', '-')}`, title: `מה היה לי · ${cat}`, note: `${lbl} · ${ym(from)}–${ym(to)} · סך ההפקדות ${ils(total)} · רשות שוק ההון` }}
              columns={[
                { key: 'rank', head: 'מקום', className: 'wide-only', value: (r) => rows.indexOf(r) + 1, firstDir: 'asc', cell: (r) => <span className="num">{rows.indexOf(r) + 1}</span> },
                { key: 'name', head: 'מסלול', value: (r) => r.f.name, cell: (r) => <><Link to={`/funds/${r.f.k}`}>{r.f.name}</Link>{r.run.closedAt && <span className="chip est">נסגר {ym(r.run.closedAt)}</span>}</> },
                { key: 'grp', head: 'מנהל', value: (r) => r.f.grp, className: 'wide-only' },
                { key: 'bal', head: `יתרה ב-${ym(to)}`, value: (r) => r.run.bal, cell: (r) => <Sourced src={() => runProv(r)}><span className="num">{ils(r.run.bal)}</span></Sourced> },
                { key: 'gap', head: 'מול החציון', value: (r) => (d ? r.run.bal - d.med : null), cell: (r) => (d ? <span className={`num ${r.run.bal >= d.med ? 'pos' : 'neg'}`}>{r.run.bal >= d.med ? '+' : '−'}{nf(Math.abs(r.run.bal - d.med), 0)}</span> : '–') },
                { key: 'irr', head: 'שנתי משוקלל', title: 'תשואה שנתית משוקללת הפקדות (IRR)', value: (r) => r.irr, cell: (r) => (r.irr == null ? <span className="muted">–</span> : <Sourced src={() => irrProv(r)}><span className="num">{pct(r.irr, 2)}</span></Sourced>) },
                { key: 'df', head: 'ד"נ מהפקדה', value: (r) => r.depfee, className: 'wide-only', cell: (r) => <span className="num">{pct(r.depfee, 2)}</span> },
              ]} />
            <div className="fnote">
              {later.length > 0 && <>{later.length} מסלולים בקטגוריה נפתחו אחרי {ym(from)} או נסגרו לפני כן, ואינם בחישוב (לא היה אפשר לבחור בהם אז). </>}{sectoral > 0 && <>{sectoral} קופות ענפיות (סגורות לציבור) אינן בחישוב. </>}
              {failed.length > 0 && <>{failed.length} היסטוריות לא נטענו. </>}
              {pending > 0 && <>טוען עוד {pending}… </>}
              {rows.some((r) => r.run.closedAt) && <>מסלולים שנסגרו נשארים בחישוב עד החודש האחרון שלהם; משם היתרה ממשיכה בתשואת ממוצע הקטגוריה (משוקלל נכסים), כדי שהחישוב לא יכלול רק את השורדים. </>}
              {fillGross > 0 && <>בחודשים שבהם ממוצע הקטגוריה נטו לא פורסם ({fillGross}), ההשלמה היא בממוצע ברוטו. </>}
              {rows.some((r) => r.run.zero > 0) && <>חודשים בלי תשואה בכלל נספרו כ-0%. </>}
              הפקדה בתחילת החודש. {net ? 'נטו: אומדן, תשואה חודשית פחות דמי ניהול מצבירה ÷ 12 של אותו חודש. ' : 'ברוטו: לפני דמי ניהול מצבירה. '}
              דמי ניהול מהפקדה: הממוצע הנוכחי של כל מסלול, על כל התקופה (הרשות מפרסמת רק את האחרונים); חוסך מסוים משלם דמי ניהול משלו. תוצאות עבר אינן מבטיחות תוצאות בעתיד.
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
