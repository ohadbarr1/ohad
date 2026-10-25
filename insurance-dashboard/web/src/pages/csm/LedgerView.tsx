import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../../components/Source';
import { useSource, type Prov } from '../../lib/prov';
import { Empty, Panel, Pick, Seg } from '../../components/ui';
import { ContextBar, Sheet } from '../../components/Sheet';
import { IndustryTools } from '../Industry';
import { Fig, MEASURES, Marks, Notes, lineMarks, lineOf, ratioMarks, showAmt, showMeasure, tableMarks } from '../../components/CsmEconomics';
import { MiniFall, WaterfallChart, type FallPt } from '../../components/CsmWaterfall';
import { idCss } from '../../lib/identity';
import { usePhone } from '../../lib/useMedia';
import { nf, sn } from '../../lib/format';
import { BASIS, SCOPE_HE, STEPS, gapProv, hrefOf, lineProv, medianProv, monthsOf, endOf, periodName, ratioProv, rankProv } from '../../lib/csm';
import type { Bridge, Line, Win } from '../../lib/csm';
import { INSURERS, agg2Prov, aggProv, amt, at, closeSrc, industry, likeForLike, sum, type Agg, type Agg2, type At, type Industry, type Ledger } from '../../lib/csmData';
import { useParam } from './params';

type MK = (typeof MEASURES)[number]['k'];
const KEYS = STEPS.map(([k]) => k);
const LABEL = new Map(STEPS.map(([k, , l]) => [k, l]));
const yearBefore = (p: string) => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;
/** rows a single filer adds under its own name, folded into one */
const extra = (b: Bridge): Line | null => { const xs = b.steps.filter((s) => !KEYS.includes(s.k)); return xs.length ? { v: xs.reduce((t, s) => t + s.line.v, 0), fs: xs.flatMap((s) => s.line.fs), n: xs.length > 1 ? xs.length : xs[0].line.n } : null; };
export const Dot = ({ id }: { id: string }) => <i className="iddot" style={{ background: idCss(id) }} aria-hidden="true" />;

/** n/N beside an industry figure that adds up fewer insurers than the column's set: each cell names its own members in its source sheet. */
function SetMark({ a, of }: { a: Agg | Agg2 | null; of: number }) {
  const n = !a ? 0 : 'parts' in a ? a.parts.length : a.num.parts.length;
  return n && n < of ? <sup className="mk" title={`סכום ${n} מתוך ${of} החברות: השאר אינן מדפיסות את שני הרכיבים`}>{n}/{of}</sup> : null;
}

/** The roll-forward of the CSM, industry and insurer by insurer, for one report and window; the ratios built on it. */
export function LedgerView({ L, name }: { L: Ledger; name: (id: string) => string }) {
  const { open } = useSource();
  const phone = usePhone();
  const { d, byCo, periods } = L;
  const [period, setPeriod] = useParam('p', periods[0] ?? '', periods);
  const [win, setWin] = useParam<'q' | 'ytd'>('w', 'q', ['q', 'ytd']);
  const [pref, setPref] = useParam<'net' | 'gross'>('b', 'net', ['net', 'gross']);
  const [view, setView] = useParam<'v' | 'y'>('y', 'v', ['v', 'y']);
  const [focus, setFocus] = useParam<string>('f', 'ind');
  const [sort, setSort] = useState<{ k: MK; dir: 1 | -1 } | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [ctl, setCtl] = useState(false);
  const P = period, annual = P.endsWith('FY'), W: Win = annual ? 'fy' : win;
  const ids = useMemo(() => INSURERS.filter((id) => byCo.has(id)), [byCo]);
  const when = periodName(P);
  const rows = useMemo(() => ids.map((id) => at(byCo.get(id)!, id, P, W, pref)), [byCo, ids, P, W, pref]);
  const before = useMemo(() => new Map(ids.map((id) => [id, at(byCo.get(id)!, id, yearBefore(P), W, pref)])), [byCo, ids, P, W, pref]);
  const ind = useMemo(() => industry(rows, pref, d, name, when), [rows, pref, d, name, when]);
  const indAll = ind;
  // the headline row adds up one set of insurers: those that print every component of every card (balance, new business, release, equity)
  const kpiIds = useMemo(() => rows.filter((r) => ind.members.includes(r.id) && r.b?.close && r.eq && r.b.steps.some((s) => s.k === 'nb') && r.b.steps.some((s) => s.k === 'rel')).map((r) => r.id), [rows, ind]);
  const indK = useMemo(() => industry(rows, pref, d, name, when, false, kpiIds), [rows, pref, d, name, when, kpiIds]);
  const indPrev = useMemo(() => industry([...before.values()], pref, d, name, periodName(yearBefore(P))), [before, pref, d, name, P]);
  // the industry balance: one set of insurers at both dates (a closing balance on the basis chosen now and a year earlier), so the level and
  // the YoY beside it add up the same companies; with fewer than two such insurers there is no YoY and the level is every balance on the basis
  const bal = useMemo(() => {
    const ok = (r: At | undefined) => !!r?.b?.close && r.b.b === pref;
    const now = rows.filter(ok), both = now.filter((r) => ok(before.get(r.id)));
    const set = both.length >= 2 ? both : now;
    const part = (r: At, per: string) => ({ id: r.id, v: r.b!.close!.v, src: () => closeSrc(r, r.b!.close!, d, `CSM סגירה · ${name(r.id)} · ${periodName(per)}`, showAmt(r.b!.close!.v)) });
    const cur = sum(set.map((r) => part(r, P))), prev = both.length >= 2 ? sum(both.map((r) => part(before.get(r.id)!, yearBefore(P)))) : null;
    return { ids: set.map((r) => r.id), cur, prev, yoy: cur && prev?.v ? (cur.v / prev.v - 1) * 100 : null, noPrev: now.filter((r) => !ok(before.get(r.id))).map((r) => r.id) };
  }, [rows, before, pref, d, name, P]);
  // the roll-forward column and the waterfall: only insurers whose own table rolls forward, so the industry column adds up like a company's
  const full = useMemo(() => industry(rows, pref, d, name, when, true), [rows, pref, d, name, when]);

  const wlabel = W === 'fy' ? 'FY' : W === 'q' ? 'QTD' : `YTD (${monthsOf(endOf(P), 'ytd')}M)`;
  const live = rows.filter((r) => r.b);
  const stepKeys = KEYS.filter((k) => live.some((r) => r.b!.steps.some((s) => s.k === k)));
  const anyExtra = live.some((r) => extra(r.b!));
  const used = new Set<number>(), used2 = new Set<number>();

  /* ---------- industry figures ---------- */
  const indCell = (a: Agg | null, title: string, signed = false, of?: number) => {
    if (!a) return <span className="muted">–</span>;
    const part = of != null && a.parts.length < of;
    return <><Sourced className={`num der ${a.v < 0 ? 'neg' : ''}`} src={() => aggProv(a, `${title} · ענף · ${when}`, name)}>{(signed && a.v > 0 ? '+' : '') + showAmt(a.v)}</Sourced>{part && <sup className="mk" title={`סכום ${a.parts.length} מתוך ${of} החברות: השורה לא מודפסת בשאר`}>{a.parts.length}/{of}</sup>}</>;
  };
  const indRatio = (k: MK, ind: Industry = indAll): { a: Agg2 | Agg | null; prov: () => Prov; v: number | null } => {
    const nm = MEASURES.find((x) => x.k === k)!.l, t = `${nm} · ענף · ${when}`;
    const r2 = (a: Agg2 | null, f: string, n: string, dn: string, kind: 'pct' | 'x') => ({ a, v: a?.v ?? null, prov: () => agg2Prov(a!, t, f, name, showMeasure(kind, a!.v), n, dn) });
    switch (k) {
      case 'close': return { a: ind.close, v: ind.close?.v ?? null, prov: () => aggProv(ind.close!, t, name) };
      case 'nb': { const a = ind.steps.get('nb') ?? null; return { a, v: a?.v ?? null, prov: () => aggProv(a!, t, name) }; }
      case 'rel': { const a = ind.steps.get('rel') ?? null; return { a, v: a ? Math.abs(a.v) : null, prov: () => aggProv(a!, t, name, showAmt(Math.abs(a!.v))) }; }
      case 'nbRel': return r2(ind.nbRel, 'Σ עסק חדש ÷ Σ שחרור × 100', 'CSM עסק חדש', 'שחרור CSM', 'pct');
      case 'csmEq': return r2(ind.csmEq, 'Σ יתרת CSM ÷ Σ הון לבעלי המניות', 'יתרת CSM', 'הון לבעלי המניות', 'x');
      case 'relOpen': return r2(ind.relOpen, 'Σ שחרור מנורמל לשנה ÷ Σ CSM פתיחה × 100', 'שחרור CSM מנורמל לשנה', 'CSM פתיחה', 'pct');
      case 'intOpen': return r2(ind.intOpen, 'Σ צבירת ריבית ÷ Σ CSM פתיחה × 100', 'צבירת ריבית', 'CSM פתיחה', 'pct');
      case 'estOpen': return r2(ind.estOpen, 'Σ שינויי אומדן ÷ Σ CSM פתיחה × 100', 'שינויי אומדן', 'CSM פתיחה', 'pct');
      case 'chg': return r2(ind.chg, 'Σ (סגירה − פתיחה) ÷ Σ פתיחה × 100', 'שינוי ביתרה', 'CSM פתיחה', 'pct');
    }
  };

  /* ---------- the ratio matrix ---------- */
  const mName = (k: MK) => MEASURES.find((x) => x.k === k)!.l;
  const valueProv = (r: At, k: MK, kind: 'amt' | 'pct' | 'x', per: string): Prov => {
    const x = r.r[k], title = `${mName(k)} · ${name(r.id)} · ${periodName(per)}`;
    if (x == null) return { k: 'none', title, why: 'הדוח לא מדפיס את השורות שמהן מחושב המדד' };
    const txt = showMeasure(kind, x), l = kind === 'amt' ? lineOf(r.b, k) : null;
    if (l) return k === 'close' ? closeSrc(r, l, d, title, txt) : lineProv({ ...l, v: Math.abs(l.v) }, d, title, txt);
    return kind === 'amt' ? { k: 'none', title, why: 'השורה לא נמצאה בטבלה' } : ratioProv(k, r.b, r.eq, d, title, txt);
  };
  const shown = (r: At, k: MK, kind: string): number | null => {
    const x = r.r[k];
    if (x == null || view === 'v') return x;
    const y = before.get(r.id)?.r[k];
    return y == null ? null : kind === 'amt' ? (y ? ((x - y) / Math.abs(y)) * 100 : null) : x - y;
  };
  const fmt = (kind: 'amt' | 'pct' | 'x', v: number) => (view === 'v' ? showMeasure(kind, v) : kind === 'amt' ? `${sn(v, 1)}%` : kind === 'x' ? `${sn(v, 2)}×` : `${sn(v, 1)} נק׳`);
  const cellProv = (r: At, k: MK, kind: 'amt' | 'pct' | 'x'): Prov => {
    if (view === 'v') return valueProv(r, k, kind, P);
    const b = before.get(r.id), v = shown(r, k, kind), title = `${mName(k)} · ${name(r.id)} · YoY, ${when}`;
    const cur = r.r[k], prev = b?.r[k];
    return { k: 'calc', title, value: v == null ? '–' : fmt(kind, v), formula: kind === 'amt' ? 'הערך בדוח הנוכחי ÷ הערך באותה תקופה בשנה הקודמת, פחות 1' : 'הערך בדוח הנוכחי פחות הערך באותה תקופה בשנה הקודמת, בנקודות',
      inputs: [{ label: when, v: cur == null ? '–' : showMeasure(kind, cur), src: () => valueProv(r, k, kind, P) }, { label: periodName(yearBefore(P)), v: prev == null ? '–' : showMeasure(kind, prev), src: b ? () => valueProv(b, k, kind, yearBefore(P)) : undefined }] };
  };
  const sorted = (() => {
    const c = sort && MEASURES.find((x) => x.k === sort.k);
    if (!c) return rows;
    return [...rows].sort((a, b) => { const x = shown(a, c.k, c.kind), y = shown(b, c.k, c.kind); return x == null ? 1 : y == null ? -1 : (y - x) * sort.dir; });
  })();
  const median = (k: MK, kind: string): number | null => { const xs = rows.map((r) => shown(r, k, kind)).filter((v): v is number => v != null).sort((p, q) => p - q); return xs.length < 3 ? null : xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2; };
  const top = new Map(MEASURES.map((c) => [c.k, Math.max(0, ...rows.map((r) => Math.abs(shown(r, c.k, c.kind) ?? 0)))]));
  const indShown = (k: MK, kind: string): number | null => {
    const x = indRatio(k).v;
    if (x == null || view === 'v') return x;
    if (k === 'close') return likeForLike(ind.close, indPrev.close)?.v ?? null;
    const a = indPrev, y = k === 'nb' ? a.steps.get('nb')?.v ?? null : k === 'rel' ? (a.steps.get('rel') ? Math.abs(a.steps.get('rel')!.v) : null) : (a[k] as Agg2 | null)?.v ?? null;
    return y == null ? null : kind === 'amt' ? (y ? ((x - y) / Math.abs(y)) * 100 : null) : x - y;
  };

  /* ---------- the waterfall of the entity in focus ---------- */
  const F = focus === 'ind' || !ids.includes(focus) ? 'ind' : focus;
  const fall = useMemo((): { pts: FallPt[]; src: (() => Prov)[] } | null => {
    const lab = (k: string) => LABEL.get(k) ?? 'אחר';
    if (F === 'ind') {
      const I = full;
      if (!I.open || !I.close || I.members.length < 2) return null;
      const ks = [...I.steps.keys()].filter((k) => KEYS.includes(k) && k !== 'rel'), other = [...I.steps.keys()].filter((k) => !KEYS.includes(k));
      const pts: FallPt[] = [{ l: 'פתיחה', v: I.open.v, total: true }], src: (() => Prov)[] = [() => aggProv(I.open!, `CSM פתיחה · ענף · ${when}`, name)];
      ks.forEach((k) => { const a = I.steps.get(k)!; pts.push({ l: lab(k), v: a.v }); src.push(() => aggProv(a, `${lab(k)} · ענף · ${when}`, name)); });
      if (other.length) { const parts = other.flatMap((k) => I.steps.get(k)!.parts), a = { v: parts.reduce((t, x) => t + x.v, 0), parts }; pts.push({ l: 'אחר', v: a.v }); src.push(() => aggProv(a, `שורות נוספות · ענף · ${when}`, name)); }
      const rel = I.steps.get('rel');
      if (rel) { pts.push({ l: 'שחרור', v: rel.v }); src.push(() => aggProv(rel, `שחרור · ענף · ${when}`, name)); }
      if (I.gap && Math.abs(I.gap.v) > 2) { const g = I.gap; pts.push({ l: 'לא מוסבר', v: g.v }); src.push(() => aggProv(g, `הפרש לא מוסבר · ענף · ${when}`, name)); }
      pts.push({ l: 'סגירה', v: I.close.v, total: true }); src.push(() => aggProv(I.close!, `CSM סגירה · ענף · ${when}`, name));
      return { pts, src };
    }
    const r = rows.find((x) => x.id === F);
    const b = r?.b;
    if (!b?.open || !b.close) return null;
    const pts: FallPt[] = [{ l: 'פתיחה', v: b.open.v, total: true }], src: (() => Prov)[] = [() => lineProv(b.open!, d, `CSM פתיחה · ${name(F)} · ${when}`)];
    b.steps.filter((s) => s.k !== 'rel' && KEYS.includes(s.k)).forEach((s) => { pts.push({ l: lab(s.k), v: s.line.v }); src.push(() => lineProv(s.line, d, `${s.label} · ${name(F)} · ${when}`)); });
    const x = extra(b); if (x) { pts.push({ l: 'אחר', v: x.v }); src.push(() => lineProv(x, d, `שורות נוספות · ${name(F)} · ${when}`)); }
    const rel = b.steps.find((s) => s.k === 'rel'); if (rel) { pts.push({ l: 'שחרור', v: rel.line.v }); src.push(() => lineProv(rel.line, d, `שחרור · ${name(F)} · ${when}`)); }
    if (b.gap != null && Math.abs(b.gap) > 2) { pts.push({ l: 'לא מוסבר', v: b.gap }); src.push(() => gapProv(b, d, `הפרש לא מוסבר · ${name(F)} · ${when}`, amt(b.gap!))); }
    pts.push({ l: 'סגירה', v: b.close.v, total: true }); src.push(() => closeSrc(r!, b.close!, d, `CSM סגירה · ${name(F)} · ${when}`));
    return { pts, src };
  }, [F, full, rows, d, name, when]);
  const fallOf = (b: Bridge): FallPt[] => {
    const pts: FallPt[] = b.open ? [{ l: 'פתיחה', v: b.open.v, total: true }] : [];
    b.steps.filter((s) => s.k !== 'rel' && KEYS.includes(s.k)).forEach((s) => pts.push({ l: LABEL.get(s.k) ?? s.label, v: s.line.v }));
    const x = extra(b); if (x) pts.push({ l: 'אחר', v: x.v });
    const rel = b.steps.find((s) => s.k === 'rel'); if (rel) pts.push({ l: 'שחרור', v: rel.line.v });
    if (b.gap != null && Math.abs(b.gap) > 2) pts.push({ l: 'לא מוסבר', v: b.gap });
    if (b.close) pts.push({ l: 'סגירה', v: b.close.v, total: true });
    return pts;
  };

  /* ---------- export ---------- */
  const xlsx = async () => {
    const { downloadXlsx } = await import('../../lib/xlsx');
    const cell = (l: Line | null | undefined) => { if (!l) return null; const h = l.fs.length === 1 && !l.sum && !l.diff ? hrefOf(l.fs[0], d) : null; return { v: Math.round(l.v * 10) / 10, link: h ?? undefined, fmt: 'n1' as const }; };
    const agg = (a: Agg | null | undefined) => (a ? { v: Math.round(a.v * 10) / 10, italic: true } : null);
    const head = ['שורה', `ענף (${full.members.length})`, ...live.map((r) => name(r.id))];
    const line = (lbl: string, ia: Agg | null | undefined, get: (b: Bridge) => Line | null | undefined) => [lbl, agg(ia), ...live.map((r) => cell(get(r.b!)))];
    const bridgeRows = [head, ['בסיס', BASIS[pref], ...live.map((r) => `${BASIS[r.b!.b]} · ${SCOPE_HE[r.b!.scope]}`)],
      line('פתיחה', full.open, (b) => b.open), ...stepKeys.filter((k) => k !== 'rel').map((k) => line(LABEL.get(k)!, full.steps.get(k), (b) => lineOf(b, k))),
      ...(anyExtra ? [line('שורות נוספות', null, extra)] : []), line('שחרור לרווח', full.steps.get('rel'), (b) => lineOf(b, 'rel')), line('סגירה', full.close, (b) => b.close)];
    const ratioRows = [['חברה', ...MEASURES.map((m) => m.l)], ...rows.map((r) => [name(r.id), ...MEASURES.map((m) => { const v = r.r[m.k]; return v == null ? null : { v: Math.round(v * (m.kind === 'x' ? 1000 : 10)) / (m.kind === 'x' ? 1000 : 10), fmt: m.kind === 'x' ? 'n2' as const : 'n1' as const, italic: m.kind !== 'amt' }; })]),
      ['ענף', ...MEASURES.map((m) => { const v = indRatio(m.k).v; return v == null ? null : { v: Math.round(v * 100) / 100, italic: true, fmt: m.kind === 'x' ? 'n2' as const : 'n1' as const }; })]];
    const about = [['fox · ספר CSM'], [`דוח ${when} · ${wlabel} · בסיס מועדף ${BASIS[pref]} · מיליוני ש"ח`], ['מספר עם קישור: מודפס בדוח, הקישור לעמוד. נטוי: נגזר (סכום או יחס).'], [`ענף: סכום החברות על בסיס ${BASIS[pref]}${ind.out.length ? `; מחוץ לסכום: ${ind.out.map((o) => `${name(o.id)} (${o.why})`).join(', ')}` : ''}`], [`נבנה ${L.built.split('-').reverse().join('.')} · ${location.host}`]];
    downloadXlsx(`fox-csm-${P}-${W}-${pref}`, [{ name: 'גשר CSM', rows: bridgeRows, widths: [26, 14, ...live.map(() => 14)], freeze: { rows: 2, cols: 1 } }, { name: 'יחסים', rows: ratioRows, widths: [16, ...MEASURES.map(() => 16)], freeze: { rows: 1, cols: 1 } }, { name: 'אודות', rows: about, widths: [90] }]);
  };

  /* ---------- the parts ---------- */
  const controls = (
    <section className={phone ? "controls" : "tbar-fields"}>
      <Pick label="דוח" cap="דוח" value={P} onChange={setPeriod} options={periods.map((p) => [p, <span className="num">{periodName(p)}</span>] as [string, ReactNode])} />
      {!annual && <div className="field"><span>חלון</span><Seg label="חלון" value={win} onChange={setWin} options={[['q', 'QTD'], ['ytd', 'YTD']]} /></div>}
      <div className="field"><span>בסיס מועדף</span><Seg<'net' | 'gross'> label="בסיס מועדף" value={pref} onChange={setPref} options={[['net', 'נטו'], ['gross', 'ברוטו']]} /></div>
      <div className="field"><span>תצוגה</span><Seg<'v' | 'y'> label="תצוגה" value={view} onChange={setView} options={[['v', 'ערך'], ['y', 'YoY']]} /></div>
      {!phone && <div className="field"><span>ייצוא</span><button type="button" className="btn" onClick={() => void xlsx()}>Excel</button></div>}
    </section>
  );
  const kpi = (l: string, v: ReactNode, s?: ReactNode) => <div className="kpi"><div className="l">{l}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}</div>;
  const ik = (k: MK, kind: 'amt' | 'pct' | 'x') => { const x = indRatio(k, indK); return x.v == null ? <span className="muted">–</span> : <Sourced className="num der" src={x.prov}>{showMeasure(kind, x.v)}</Sourced>; };
  const membersTxt = `${ind.members.length} מתוך ${ids.length} חברות · ${BASIS[pref]}`;
  const outTxt = ind.out.length ? `מחוץ לסכום: ${ind.out.map((o) => `${name(o.id)} (${o.why})`).join(' · ')}` : '';

  const bridgeTable = (cols: At[], withInd: boolean) => (
    <div className="scroll"><table className="csm-bridge">
      <thead><tr><th>שורה</th>
        {withInd && <th className={`indcol ${F === 'ind' ? 'on' : ''}`}><button type="button" className="thsel" onClick={() => setFocus('ind')}>ענף</button><span className="dim">{full.members.length}/{ids.length} · {BASIS[pref]}</span></th>}
        {cols.map((r) => <th key={r.id} className={F === r.id ? 'on' : ''}><button type="button" className="thsel" onClick={() => setFocus(r.id)}><Dot id={r.id} />{name(r.id)}</button><Marks ms={tableMarks(r.b!, pref)} used={used2} /><span className="dim">{BASIS[r.b!.b]} · {SCOPE_HE[r.b!.scope]}</span></th>)}</tr></thead>
      <tbody>
        <tr className="lead"><td className="lbl">פתיחה</td>{withInd && <td className="indcol">{indCell(full.open, 'CSM פתיחה', false, full.members.length)}</td>}{cols.map((r) => <td key={r.id}>{r.b!.open ? <><Fig line={r.b!.open} d={d} title={`CSM פתיחה · ${name(r.id)} · ${when}`} text={showAmt(r.b!.open.v)} /><Marks ms={[...lineMarks(r.b!.open), ...(r.b!.openPrev ? [8] : [])]} used={used2} /></> : <span className="muted">–</span>}</td>)}</tr>
        {stepKeys.filter((k) => k !== 'rel').map((k) => (
          <tr key={k}><td className="lbl">{LABEL.get(k)}</td>{withInd && <td className="indcol">{indCell(full.steps.get(k) ?? null, LABEL.get(k)!, true, full.members.length)}</td>}
            {cols.map((r) => { const l = lineOf(r.b, k); return <td key={r.id}>{l ? <><Fig line={l} d={d} title={`${LABEL.get(k)} · ${name(r.id)} · ${when}`} text={(l.v > 0 ? '+' : '') + showAmt(l.v)} tone={l.v < 0 ? 'neg' : ''} /><Marks ms={lineMarks(l)} used={used2} /></> : <span className="muted">–</span>}</td>; })}</tr>
        ))}
        {anyExtra && <tr><td className="lbl">שורות נוספות בטבלת החברה</td>{withInd && <td className="indcol">{(() => { const parts = [...full.steps.entries()].filter(([k]) => !KEYS.includes(k)).flatMap(([, a]) => a.parts); return parts.length ? indCell({ v: parts.reduce((t, x) => t + x.v, 0), parts }, 'שורות נוספות', true) : <span className="muted">–</span>; })()}</td>}
          {cols.map((r) => { const l = extra(r.b!); return <td key={r.id}>{l ? <><Fig line={l} d={d} title={`שורות נוספות · ${name(r.id)} · ${when}`} text={(l.v > 0 ? '+' : '') + showAmt(l.v)} tone={l.v < 0 ? 'neg' : ''} /><Marks ms={lineMarks(l)} used={used2} /></> : <span className="muted">–</span>}</td>; })}</tr>}
        {stepKeys.includes('rel') && <tr><td className="lbl">שחרור לרווח</td>{withInd && <td className="indcol">{indCell(full.steps.get('rel') ?? null, 'שחרור לרווח', true, full.members.length)}</td>}{cols.map((r) => { const l = lineOf(r.b, 'rel'); return <td key={r.id}>{l ? <><Fig line={l} d={d} title={`שחרור לרווח · ${name(r.id)} · ${when}`} text={showAmt(l.v)} tone="neg" /><Marks ms={lineMarks(l)} used={used2} /></> : <span className="muted">–</span>}</td>; })}</tr>}
        <tr className="csm-gap"><td className="lbl">הפרש לא מוסבר<span className="dim">נגזר: סגירה פחות פתיחה פחות השורות שמעל</span></td>{withInd && <td className="indcol">{indCell(full.gap, 'הפרש לא מוסבר', true)}</td>}
          {cols.map((r) => <td key={r.id}>{r.b!.gap == null ? <span className="muted">–</span> : <Sourced className={`num der ${Math.abs(r.b!.gap) > 2 ? 'neg' : ''}`} src={() => gapProv(r.b!, d, `הפרש לא מוסבר · ${name(r.id)} · ${when}`, showAmt(Math.round(r.b!.gap! * 10) / 10 || 0))}>{(r.b!.gap > 0 ? '+' : '') + showAmt(Math.round(r.b!.gap * 10) / 10 || 0)}</Sourced>}</td>)}</tr>
        <tr className="lead"><td className="lbl">סגירה</td>{withInd && <td className="indcol">{indCell(full.close, 'CSM סגירה', false, full.members.length)}</td>}{cols.map((r) => <td key={r.id}>{r.b!.close ? <><Fig line={r.b!.close} d={d} title={`CSM סגירה · ${name(r.id)} · ${when}`} text={showAmt(r.b!.close.v)} src={() => closeSrc(r, r.b!.close!, d, `CSM סגירה · ${name(r.id)} · ${when}`, showAmt(r.b!.close!.v))} /><Marks ms={[...lineMarks(r.b!.close), ...(r.re ? [12] : [])]} used={used2} /></> : <span className="muted">–</span>}</td>)}</tr>
        <tr><td className="lbl">הון לבעלי המניות</td>{withInd && <td className="indcol">{indCell(full.eq, 'הון לבעלי המניות')}</td>}{cols.map((r) => <td key={r.id}>{r.eq ? <Fig line={{ v: r.eq.v, fs: [r.eq] }} d={d} title={`הון לבעלי המניות · ${name(r.id)}`} text={showAmt(r.eq.v)} /> : <span className="muted">–</span>}</td>)}</tr>
      </tbody>
    </table></div>
  );

  const card = (r: At) => {
    const b = r.b!, chg = r.r.chg;
    return (
      <article key={r.id} className="csmcard">
        <header><Dot id={r.id} /><Link to={`/company/${r.id}/ifrs17`}>{name(r.id)}</Link><span className="dim">{BASIS[b.b]} · {SCOPE_HE[b.scope]}</span></header>
        <div className="csmcard-k">
          <div><span className="l">יתרת CSM</span><span className="v">{b.close ? <Fig line={b.close} d={d} title={`CSM סגירה · ${name(r.id)} · ${when}`} text={showAmt(b.close.v)} src={() => closeSrc(r, b.close!, d, `CSM סגירה · ${name(r.id)} · ${when}`, showAmt(b.close!.v))} /> : '–'}</span>{r.re && <span className="redot" title="הוצג מחדש בדוח מאוחר" />}</div>
          <div><span className="l">שינוי בחלון</span><span className="v">{chg == null ? <span className="muted">–</span> : <Sourced className={`num der ${chg < 0 ? 'neg' : 'pos'}`} src={() => ratioProv('chg', b, r.eq, d, `שינוי ביתרה · ${name(r.id)} · ${when}`, `${nf(chg, 1)}%`)}>{sn(chg, 1)}%</Sourced>}</span></div>
          <div><span className="l">עסק חדש / שחרור</span><span className="v">{r.r.nbRel == null ? <span className="muted">–</span> : <Sourced className="num der" src={() => ratioProv('nbRel', b, r.eq, d, `עסק חדש / שחרור · ${name(r.id)} · ${when}`, `${nf(r.r.nbRel!, 1)}%`)}>{nf(r.r.nbRel, 0)}%</Sourced>}</span></div>
        </div>
        {b.open && b.close && <MiniFall pts={fallOf(b)} />}
        <button type="button" className="btn csmcard-go" onClick={() => setSheet(r.id)}>הגשר המלא</button>
      </article>
    );
  };

  const ratioMatrix = (
    <Panel title="יחסי ה-CSM" aside={<span>{when} · {wlabel} · {view === 'v' ? 'כפי שדווח' : `שינוי מול ${periodName(yearBefore(P))}`} · ÷ נגזר · לחיצה על כותרת ממיינת</span>}>
      <div className="scroll"><table className="matrix csm-matrix">
        <thead><tr><th>חברה</th>{MEASURES.map((c) => <th key={c.k} aria-sort={sort?.k === c.k ? (sort.dir === 1 ? 'descending' : 'ascending') : 'none'}><button type="button" className="thsort" title={c.from ? `נגזר: ${c.from}` : undefined} onClick={() => setSort((cur) => (cur?.k !== c.k ? { k: c.k, dir: 1 } : cur.dir === 1 ? { k: c.k, dir: -1 } : null))}>{c.l}{c.from && <span className="dim"> ÷</span>}<i>{sort?.k === c.k ? (sort.dir === 1 ? '▼' : '▲') : ''}</i></button></th>)}</tr></thead>
        <tbody>{sorted.map((r, ri) => (
          <tr key={r.id}>
            <td>{sort && (() => { const c = MEASURES.find((x) => x.k === sort.k)!, ranked = sorted.filter((q) => shown(q, c.k, c.kind) != null); return <Sourced className="rk num" src={() => rankProv(`דירוג לפי ${c.l} · ${when}`, ri + 1, ranked.map((q) => ({ label: name(q.id), v: fmt(c.kind, shown(q, c.k, c.kind)!), src: () => cellProv(q, c.k, c.kind) })))}>{ri + 1}</Sourced>; })()}<Dot id={r.id} /><Link to={`/company/${r.id}/ifrs17`}>{name(r.id)}</Link>{r.b && <Marks ms={tableMarks(r.b, pref)} used={used} />}{r.b && <span className="dim">{BASIS[r.b.b]} · {SCOPE_HE[r.b.scope]}</span>}</td>
            {MEASURES.map((c) => {
              const v = shown(r, c.k, c.kind);
              if (v == null) return <td key={c.k}><span className="muted">–</span></td>;
              const l = c.kind === 'amt' ? lineOf(r.b, c.k) : null, tone = view === 'y' ? (v >= 0 ? 'pos' : 'neg') : v < 0 ? 'neg' : '';
              const w = top.get(c.k) ? Math.round((Math.abs(v) / top.get(c.k)!) * 100) : 0;
              return (
                <td key={c.k} className="bar" style={{ ['--w' as string]: `${w}%` }}>
                  {l && view === 'v' ? <Fig line={{ ...l, v: Math.abs(l.v) }} d={d} title={`${c.l} · ${name(r.id)} · ${when}`} text={fmt(c.kind, v)} tone={tone} src={() => cellProv(r, c.k, c.kind)} /> : <Sourced className={`num ${tone} ${c.kind === 'amt' ? '' : 'der'}`} src={() => cellProv(r, c.k, c.kind)}>{fmt(c.kind, v)}</Sourced>}
                  <Marks ms={[...(l ? lineMarks(l) : ratioMarks(r.b, c.k, r.r)), ...(c.k === 'close' && r.re ? [12] : [])]} used={used} />
                </td>
              );
            })}
          </tr>
        ))}</tbody>
        <tfoot>
          <tr className="indrow"><td>ענף<span className="dim">{membersTxt}</span></td>{MEASURES.map((c) => { const x = indShown(c.k, c.kind); return <td key={c.k}>{x == null ? <span className="muted">–</span> : <Sourced className="num der" src={view === 'v' ? indRatio(c.k).prov : () => ({ k: 'calc', title: `${c.l} · ענף · YoY`, value: fmt(c.kind, x), formula: 'הערך הענפי בדוח הנוכחי מול אותה תקופה בשנה הקודמת', inputs: [{ label: when, v: showMeasure(c.kind, indRatio(c.k).v!), src: indRatio(c.k).prov }] })}>{fmt(c.kind, x)}</Sourced>}{x != null && <SetMark a={view === 'y' && c.k === 'close' ? likeForLike(ind.close, indPrev.close)?.now ?? null : indRatio(c.k).a} of={ind.members.length} />}</td>; })}</tr>
          <tr><td>חציון</td>{MEASURES.map((c) => { const x = median(c.k, c.kind); return <td key={c.k}>{x == null ? <span className="muted">–</span> : <Sourced className="num" src={() => medianProv(`${c.l} · חציון · ${when}`, fmt(c.kind, x), rows.map((q) => ({ q, v: shown(q, c.k, c.kind) })).filter((e) => e.v != null).sort((a, b) => a.v! - b.v!).map((e) => ({ label: name(e.q.id), v: fmt(c.kind, e.v!), src: () => cellProv(e.q, c.k, c.kind) })))}>{fmt(c.kind, x)}</Sourced>}</td>; })}</tr>
        </tfoot>
      </table></div>
      <Notes used={used} />
      <div className="src">ענף: סכום החברות שמדפיסות את שני רכיבי היחס על הבסיס שנבחר, לא ממוצע יחסים. שחרור / פתיחה מנורמל לשנה; ריבית ושינויי אומדן לחלון עצמו.{outTxt && ` ${outTxt}.`}</div>
    </Panel>
  );

  if (!P) return <Empty title="אין דוחות מחולצים" />;
  const sheetRow = sheet ? rows.find((r) => r.id === sheet) : null;
  return (
    <>
      {phone ? <><ContextBar onOpen={() => setCtl(true)}>{when} · {wlabel} · {BASIS[pref]}{view === 'y' ? ' · YoY' : ''}</ContextBar><Sheet open={ctl} onClose={() => setCtl(false)} title="ספר ה-CSM">{controls}</Sheet></> : <IndustryTools>{controls}</IndustryTools>}

      <section className="kpis csm-kpis" aria-label="CSM ענפי">
        {kpi('יתרת CSM, ענף', bal.cur ? <Sourced className="num der" src={() => aggProv(bal.cur!, `יתרת CSM · ענף · ${when}`, name)}>{nf(bal.cur.v / 1000, 1)}</Sourced> : '–', <>מיליארדי ש"ח · <span className="num">{bal.ids.length}</span> חברות{bal.yoy != null && <> · <Sourced className={`num der ${bal.yoy < 0 ? 'neg' : 'pos'}`} src={() => ({ k: 'calc', title: `יתרת CSM ענפית · YoY · ${when}`, value: `${sn(bal.yoy!, 1)}%`, formula: `Σ יתרה ÷ Σ יתרה באותו תאריך שנה קודם, פחות 1 · אותן ${bal.ids.length} חברות בשני התאריכים`, inputs: [{ label: when, v: amt(bal.cur!.v), src: () => aggProv(bal.cur!, 'יתרת CSM · ענף', name) }, { label: periodName(yearBefore(P)), v: amt(bal.prev!.v), src: () => aggProv(bal.prev!, 'יתרת CSM · ענף', name) }] })}>{sn(bal.yoy, 1)}%</Sourced> YoY</>}</>)}
        {kpi(`עסק חדש, ${wlabel}`, ik('nb', 'amt'), 'מיליוני ש"ח')}
        {kpi(`שחרור לרווח, ${wlabel}`, ik('rel', 'amt'), 'מיליוני ש"ח')}
        {kpi('עסק חדש / שחרור', ik('nbRel', 'pct'), 'מעל 100%: היתרה נבנית')}
        {kpi('CSM / הון', ik('csmEq', 'x'), 'יתרה ÷ הון לבעלי המניות')}
      </section>
      <div className="csm-set" aria-label="החברות בשורת הענף"><span className="dim">יתרה ו-YoY: <span className="num">{bal.ids.length}</span> · עסק חדש, שחרור ויחסים: <span className="num">{kpiIds.length}</span> · מתוך <span className="num">{ids.length}</span> · {BASIS[pref]}:</span>{ids.map((id) => {
        const inB = bal.ids.includes(id), inK = kpiIds.includes(id);
        const why = ind.out.find((o) => o.id === id)?.why, tip = [inB ? 'ביתרה' : bal.noPrev.includes(id) ? `לא ביתרה: אין יתרה על אותו בסיס ב-${periodName(yearBefore(P))}` : `לא ביתרה: ${why ?? 'אין יתרת סגירה'}`, inK ? 'בעסק חדש, שחרור ויחסים' : `לא בעסק חדש, שחרור ויחסים: ${why ?? 'חסר רכיב: עסק חדש, שחרור או הון'}`].join(' · ');
        return <span key={id} className={`csm-chip${inB && inK ? '' : inB || inK ? ' half' : ' off'}`} title={tip}><Dot id={id} />{name(id)}</span>; })}</div>

      {phone ? (
        <Panel title="גשר CSM" aside={<span>{when} · {wlabel} · מיליוני ש"ח</span>}>
          {fall && F === 'ind' && <div className="csmcard ind"><header><b>ענף</b><span className="dim">{full.members.length} חברות עם גשר מלא · {BASIS[pref]}</span></header><MiniFall pts={fall.pts} /></div>}
          <div className="csmcards">{live.map(card)}</div>
          {ids.length > live.length && <div className="src">ללא טבלת תנועה לחלון: {ids.filter((id) => !live.some((r) => r.id === id)).map(name).join(', ')}</div>}
        </Panel>
      ) : (
        <Panel title="גשר CSM" aside={<span>{when} · {wlabel} · מיליוני ש"ח · כל מספר מקושר לעמוד · לחיצה על כותרת מציגה מפל</span>}>
          {live.length === 0 ? <Empty title="לא נמצאה תנועת CSM בדוחות לתקופה ולחלון שנבחרו" /> : <>
            {bridgeTable(live, true)}
            <Notes used={used2} />
            {fall ? <>
              <div className="csm-fallhd"><b>{F === 'ind' ? 'ענף' : name(F)}</b><span className="dim">מפל · {when} · {wlabel}</span></div>
              <WaterfallChart label={`גשר CSM · ${F === 'ind' ? 'ענף' : name(F)} · ${when}`} pts={fall.pts} deps={[F, P, W, pref, fall.pts.length]} onPoint={(i) => { const s = fall.src[i]; if (s) open(s()); }} />
            </> : <div className="src">אין לחברה שנבחרה פתיחה וסגירה באותה טבלה לחלון הזה.</div>}
            <div className="src">עמודת הענף: סכום החברות שהטבלה שלהן כוללת פתיחה, סגירה, עסק חדש ושחרור על הבסיס שנבחר{full.out.length ? ` (מחוץ לעמודה: ${full.out.map((o) => `${name(o.id)}, ${o.why}`).join(' · ')})` : ''}; 2/4 ליד מספר: סכום החלק מהחברות שמדפיס את השורה. ציר המפל מתחיל סמוך ליתרה הקטנה ולא באפס.</div>
          </>}
        </Panel>
      )}

      {ratioMatrix}

      <Sheet open={!!sheetRow} onClose={() => setSheet(null)} title={sheetRow ? `גשר CSM · ${name(sheetRow.id)} · ${when}` : ''}>
        {sheetRow?.b && <>{bridgeTable([sheetRow], false)}<Notes used={used2} />
          <dl className="csm-dl">{MEASURES.filter((m) => m.kind !== 'amt' && sheetRow.r[m.k] != null).map((m) => <div key={m.k}><dt>{m.l}</dt><dd><Sourced className="num der" src={() => valueProv(sheetRow, m.k, m.kind, P)}>{showMeasure(m.kind, sheetRow.r[m.k]!)}</Sourced></dd></div>)}</dl></>}
      </Sheet>
    </>
  );
}
