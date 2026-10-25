import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Chart } from '../../components/Chart';
import { Sourced } from '../../components/Source';
import { useSource, type Prov } from '../../lib/prov';
import { Empty, ErrorBox, Loading, Panel, Seg, copyText } from '../../components/ui';
import { CHART_FONT, chartBase } from '../../lib/theme';
import { idColor } from '../../lib/identity';
import { usePhone } from '../../lib/useMedia';
import { useFundCats } from '../../lib/useData';
import { nf, sn, dateLabel } from '../../lib/format';
import { BASIS, endOf, factProv, lineProv, periodName } from '../../lib/csm';
import type { RF, Line } from '../../lib/csm';
import { INSURERS, MM, amt, closingAt, equityFor, useCapital, useCurve, useSens, type CapPt, type Ledger, type SensRow } from '../../lib/csmData';
import { dLab, solvProv, useSolvency, type SolvSens } from '../../lib/solvency';
import {
  PRESETS, SLIDERS, ZERO, activeRisks, applyLines, buildPreset, pickIfrs, readScenario, shockText, solvDate, solvLines, targetsAt, writeScenario,
  type CatFile, type CurveFile, type Effect, type Part, type Preset, type SBasis, type Scenario, type SRisk, type TargetFact,
} from '../../lib/stress';
import { Dot } from './LedgerView';
import '../../styles/stress.css';

type Metric = 'head' | 'eq' | 'csm';
const PP = 'נקודות אחוז';
const pp = (v: number) => `${sn(v, Math.abs(v) < 10 && v % 1 ? 1 : 0)} נ״א`;
const pctS = (v: number) => `${sn(v, Math.abs(v) < 10 ? 1 : 0)}%`;
const pkey = (p: string) => p.slice(0, 4) + (p.endsWith('FY') ? '4' : p.slice(5));
/** months from one ISO date to another */
const monthsTo = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
/** a solvency sensitivity is used against the ratio when it is at most two years older than the newest ratio printed */
const FRESH = 24;

interface Solv {
  d: string; b: 'w' | 'wo' | 'na'; eff: Effect<SolvSens>; fresh: boolean;
  base: { v: number; r: number; pg: number | null; l?: string } | null; scr: { v: number; r: number; pg: number | null; l?: string } | null;
  ref: TargetFact | null; div: TargetFact | null;
}
interface Row {
  id: string; d: string; rp: string;
  csm: { eff: Effect<SensRow>; base: Line | null; scope: string; b: string } | null;
  eq: { eff: Effect<SensRow>; base: RF | null; proxy: SRisk[]; e: SensRow['eff']; b: string } | null;
  sv: Solv | null;
  /** the newest printed ratio and the target in force for it, where no fresh sensitivity applies: shown unstressed */
  now: { p: string; b: SBasis; x: CapPt; t: TargetFact } | null;
}

/** The stress lab: the disclosed IFRS 17 and solvency sensitivities of every insurer as one scenario, read only between the disclosed points. */
export function StressLab({ L, name }: { L: Ledger; name: (id: string) => string }) {
  const { open } = useSource();
  const phone = usePhone();
  const S = useSens(), V = useSolvency(), C = useCapital(), K = useCurve(), F = useFundCats();
  const [sp, setSp] = useSearchParams();
  const [sc, setSc] = useState<Scenario>(() => readScenario(sp));
  const basis = (sp.get('b') === 'gross' ? 'gross' : 'net') as 'net' | 'gross';
  const metric = ((['head', 'eq', 'csm'] as const).find((m) => m === sp.get('m')) ?? 'head') as Metric;
  const setParam = (k: string, v: string, def: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (v === def) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  // the scenario follows the URL (back, a shared link) and writes itself into it after a short pause while a slider moves
  const last = useRef(sp.toString());
  useEffect(() => { if (sp.toString() !== last.current) { last.current = sp.toString(); setSc(readScenario(sp)); } }, [sp]);
  useEffect(() => {
    const t = setTimeout(() => setSp((prev) => { const n = writeScenario(prev, sc); last.current = n.toString(); return n; }, { replace: true }), 220);
    return () => clearTimeout(t);
  }, [sc, setSp]);
  const [copied, setCopied] = useState<boolean | null>(null);

  const presets = useMemo(() => PRESETS.map((p) => buildPreset(p, K.data as CurveFile | null, F.data as unknown as CatFile | null)), [K.data, F.data]);
  const rows = useMemo<Row[]>(() => {
    const sens = S.data?.rows, Sv = V.data, cap = C.data?.companies;
    if (!sens || !Sv || !cap) return [];
    return INSURERS.filter((id) => sens.some((r) => r.c === id)).map((id) => {
      const rs = L.byCo.get(id) ?? [], first = sens.find((r) => r.c === id)!;
      const facts: TargetFact[] = rs.flatMap((r) => r.F.filter((f) => f.m.startsWith('target_')).map((f) => ({ ...f, l: f.l, s: f.s, n: f.n })));
      const ci = pickIfrs(sens, id, 'csm', basis), ei = pickIfrs(sens, id, 'equity', basis);
      const cb = closingAt(rs, first.d, ci?.b === 'gross' ? 'gross' : 'net');
      const csm = ci ? { eff: applyLines(ci.lines, sc), base: cb?.l ?? null, scope: cb?.scope ?? '', b: ci.b } : null;
      const eq = ei ? { eff: applyLines(ei.lines, sc), base: equityFor(rs, first.rp), proxy: ei.proxy, e: ei.eff, b: ei.b } : null;
      // the solvency lines: the newest date with sensitivities, against the ratio and SCR of the same report on the same basis
      const sd = solvDate(Sv.sens, id);
      const ratioPts = Object.entries(cap[id]?.sr_w ?? {}).concat(Object.entries(cap[id]?.sr_wo ?? {}));
      const newest = ratioPts.map(([p]) => endOf(p)).sort().pop() ?? null;
      let sv: Solv | null = null;
      if (sd) {
        const lines = solvLines(Sv.sens, id, sd), b = (Sv.sens.find((s) => s.c === id && s.d === sd)?.b ?? 'na') as Solv['b'];
        const cell = Sv.companies[id]?.[sd] ?? {}, t = b === 'na' ? { board: null, div: null } : targetsAt(facts, sd, b);
        sv = { d: sd, b, eff: applyLines(lines, sc), fresh: !newest || monthsTo(sd, newest) <= FRESH, base: b === 'na' ? null : cell[`sr_${b}`] ?? null, scr: b === 'na' ? null : cell[`scr_${b}`] ?? null, ref: t.board ?? t.div, div: t.div ?? t.board };
      }
      let now: Row['now'] = null;
      if (!sv?.fresh || !sv.base || !sv.ref) {
        for (const b of ['wo', 'w'] as SBasis[]) {
          const pts = Object.entries(cap[id]?.[b === 'w' ? 'sr_w' : 'sr_wo'] ?? {}).sort(([a], [z]) => pkey(a).localeCompare(pkey(z)));
          const lastPt = pts[pts.length - 1];
          if (!lastPt) continue;
          const t = targetsAt(facts, endOf(lastPt[0]), b);
          if (t.board ?? t.div) { now = { p: lastPt[0], b, x: lastPt[1], t: (t.board ?? t.div)! }; break; }
        }
      }
      return { id, d: first.d, rp: first.rp, csm, eq, sv, now };
    });
  }, [S.data, V.data, C.data, L, basis, sc]);

  if (S.error || V.error || C.error) return <ErrorBox what="רגישויות" error={(S.error ?? V.error ?? C.error)!} />;
  if (!S.data || !V.data || !C.data) return <Loading what="מעבדת התרחישים" />;
  if (!rows.length) return <Empty title="לא חולצו גילויי רגישות" />;
  const Sv = V.data;
  const act = activeRisks(sc);
  const preset = presets.find((p) => SLIDERS.every((s) => p.sc[s.k] === sc[s.k]) && act.length > 0);

  /* ---------- sources ---------- */
  const asRF = (r: SensRow): RF => ({ c: r.c, m: `sensitivity:${r.shock}`, s: r.s, g: r.seg, b: r.b, w: 'instant', d: r.d, v: r.v, pg: r.pg, l: r.l, u: r.u, rp: r.rp });
  const sensProv = (r: SensRow, what: string): Prov => ({ ...(factProv(asRF(r), L.d, `${r.l} · ${what} · ${name(r.c)} · ${dateLabel(r.d)}`, amt(r.v)) as Extract<Prov, { k: 'report' }>), note: `גילוי רגישות · ${r.l} · בסיס ${BASIS[r.b] ?? r.b}${r.tax === 'after' ? ' · אחרי מס' : ''}` });
  const solvSrc = (s: SolvSens): Prov => solvProv(Sv, s, `${s.l} · השפעה על יחס כושר הפירעון · ${name(s.c)}`, s.d, PP, pp(s.v), `בסיס: ${s.b === 'w' ? 'עם הוראות מעבר' : s.b === 'wo' ? 'ללא הוראות מעבר' : 'לא צוין'}`);
  /** one shock's effect: the disclosed point(s) it was read from, and how */
  function partProv<R>(p: Part<R>, src: (r: R) => Prov, unit: string, fmt: (v: number) => string, what: string): Prov {
    const { e } = p, inputs: { label: string; v: string; src?: () => Prov }[] = [];
    [e.a, e.b].filter((x, i, xs) => x && xs.indexOf(x) === i).forEach((x) => inputs.push({ label: `גולה: ${shockText(p.k, x!.x)}`, v: fmt(x!.v), src: () => src(x!.row) }));
    const a = e.a, b = e.b;
    const formula = a && a === b ? (e.extra ? `מחוץ לטווח שגולה: נשאר בערך הקצה (${shockText(p.k, e.xe)})` : 'ההשפעה שגולתה בתרחיש זה, כפי שהודפסה')
      : !a || !b ? `קו ישר מנקודת האפס לנקודה שגולתה: ${fmt((a ?? b)!.v)} × ${e.xe} ÷ ${(a ?? b)!.x}`
      : `קו ישר בין שתי הנקודות שגולו: ${fmt(a.v)} + (${fmt(b.v)} − ${fmt(a.v)}) × (${e.xe} − ${a.x}) ÷ (${b.x} − ${a.x})`;
    return { k: 'calc', title: `${shockText(p.k, e.x)} · ${what}`, value: fmt(e.v), unit, formula, inputs, est: e.extra || undefined, note: e.extra ? `אקסטרפולציה: התרחיש (${shockText(p.k, e.x)}) מחוץ לטווח שגולה; ההשפעה לא הוארכה מעבר לנקודה הקיצונית` : undefined };
  }
  function effProv<R>(f: Effect<R>, src: (r: R) => Prov, unit: string, fmt: (v: number) => string, what: string, extra: string[] = []): Prov {
    return {
      k: 'calc', title: what, value: fmt(f.v), unit, est: f.extra || undefined,
      formula: f.parts.length > 1 ? 'סכום ההשפעות של כל זעזוע כפי שגולו, ללא פיזור בין הסיכונים' : f.parts.length ? 'השפעת הזעזוע היחיד, מקו הגילוי' : 'אין זעזוע בתוקף',
      inputs: f.parts.map((p) => ({ label: `${shockText(p.k, p.e.x)}${p.e.extra ? ' · אקסטרפולציה' : ''}`, v: fmt(p.e.v), src: () => partProv(p, src, unit, fmt, what) })),
      note: [f.combo ? 'ללא פיזור: ההשפעות חוברו כפי שגולו, כל אחת בנפרד' : '', f.extra ? 'אקסטרפולציה: זעזוע מחוץ לטווח שגולה נחתך בקצה' : '', f.none.length ? `לא גולתה רגישות ל: ${f.none.map((k) => SLIDERS.find((s) => s.k === k)!.he).join(', ')} (לא נכלל)` : '', ...extra].filter(Boolean).join(' · ') || undefined,
    };
  }
  const relProv = (abs: Prov, v: number, base: number, baseSrc: () => Prov, what: string, baseL: string): Prov => ({ k: 'calc', title: `${what} · % מ${baseL}`, value: pctS(v), formula: `ההשפעה ÷ ${baseL} לאותו תאריך × 100`,
    inputs: [{ label: 'ההשפעה', v: 'value' in abs ? abs.value : '', src: () => abs }, { label: baseL, v: amt(base), src: baseSrc }] });
  const tgtProv = (id: string, t: TargetFact): Prov => factProv({ ...(t as unknown as RF) }, L.d, `${t.l || 'יעד'} · ${name(id)}`, `${nf(t.v, t.v % 1 ? 1 : 0)}%`, '%');
  const capProv = (id: string, x: CapPt, p: string, b: SBasis): Prov => ({ k: 'report', title: `יחס כושר פירעון, ${b === 'w' ? 'עם' : 'ללא'} הוראות מעבר · ${name(id)} · ${periodName(p).replace('FY', 'Q4')}`, value: `${nf(x.v, x.v % 1 ? 1 : 0)}%`, unit: '%', url: x.u ?? null, pg: x.pg ?? null, doc: x.solv ? 'דוח כושר פירעון כלכלי' : 'דוח כספי', period: periodName(p) });
  const solvCell = (x: { v: number; r: number; pg: number | null; l?: string }, d: string, title: string, unit: string, text: string) => solvProv(Sv, x, title, d, unit, text);

  /* ---------- per insurer: stressed solvency, headroom, dividend capacity ---------- */
  const solvOut = (r: Row) => {
    const s = r.sv;
    if (!s || !s.fresh || !s.base || !s.ref) return null;
    const stressed = s.base.v + s.eff.v, head = stressed - s.ref.v, div = s.div!, room = stressed - div.v;
    const cap = s.scr ? (room / 100) * s.scr.v : null;
    return { stressed, head, room, cap, div };
  };
  const bLabel = (b: string) => (b === 'w' ? 'עם הוראות מעבר' : b === 'wo' ? 'ללא הוראות מעבר' : 'בסיס לא צוין');

  /* ---------- the ranked chart ---------- */
  type Bar = { id: string; v: number; on: boolean; prov: () => Prov; tag: string };
  const bars: Bar[] = rows.flatMap((r): Bar[] => {
    if (metric === 'head') {
      const o = solvOut(r);
      if (o && r.sv) return [{ id: r.id, v: o.head, on: true, tag: `${bLabel(r.sv.b)} · מול ${nf(r.sv.ref!.v, 0)}%`, prov: () => headProv(r, o) }];
      if (r.now) { const v = r.now.x.v - r.now.t.v; return [{ id: r.id, v, on: false, tag: 'ללא רגישות עדכנית: המצב הנוכחי', prov: () => nowProv(r, v) }]; }
      return [];
    }
    const x = metric === 'eq' ? r.eq : r.csm, base = metric === 'eq' ? r.eq?.base?.v : r.csm?.base?.v;
    if (!x || !base) return [];
    return [{ id: r.id, v: (x.eff.v / base) * 100, on: true, tag: '', prov: () => (metric === 'eq' ? eqRel(r) : csmRel(r))! }];
  }).sort((a, b) => b.v - a.v);
  const headProv = (r: Row, o: NonNullable<ReturnType<typeof solvOut>>): Prov => {
    const s = r.sv!;
    return { k: 'calc', title: `מרווח מעל היעד אחרי התרחיש · ${name(r.id)}`, value: pp(o.head), unit: PP, est: s.eff.extra || undefined, formula: 'יחס כושר הפירעון ביום הגילוי + השפעת התרחיש − יעד הדירקטוריון (אותו בסיס)',
      inputs: [{ label: `יחס כושר פירעון ${dLab(s.d)}, ${bLabel(s.b)}`, v: `${nf(s.base!.v, 0)}%`, src: () => solvCell(s.base!, s.d, `יחס כושר פירעון · ${name(r.id)}`, '%', `${nf(s.base!.v, 0)}%`) },
        { label: 'השפעת התרחיש', v: pp(s.eff.v), src: () => effProv(s.eff, solvSrc, PP, pp, `השפעה על יחס כושר הפירעון · ${name(r.id)}`) },
        { label: s.ref!.l ? `יעד: ${s.ref!.l.slice(0, 60)}` : 'יעד הדירקטוריון', v: `${nf(s.ref!.v, 0)}%`, src: () => tgtProv(r.id, s.ref!) }],
      note: [s.ref === s.div && !targetsAt([s.ref!], s.d, s.b as SBasis).board ? 'לבסיס זה הודפס רק סף לחלוקת דיבידנד; הוא משמש כיעד' : '', s.eff.combo ? 'ללא פיזור' : ''].filter(Boolean).join(' · ') || undefined };
  };
  const nowProv = (r: Row, v: number): Prov => ({ k: 'calc', title: `מרווח מעל היעד, המצב הנוכחי (ללא תרחיש) · ${name(r.id)}`, value: pp(v), unit: PP, formula: 'יחס כושר הפירעון האחרון שהודפס − היעד בתוקף, אותו בסיס',
    note: r.sv ? `רגישות היחס האחרונה גולתה ל-${dLab(r.sv.d)}${r.sv.b === 'na' ? ', בלי בסיס' : ''}: ישנה מדי או בלי בסיס, ולכן לא הופעל עליה תרחיש` : 'החברה לא גילתה רגישות של יחס כושר הפירעון',
    inputs: [{ label: `יחס כושר פירעון ${periodName(r.now!.p).replace('FY', 'Q4')}, ${bLabel(r.now!.b)}`, v: `${nf(r.now!.x.v, 0)}%`, src: () => capProv(r.id, r.now!.x, r.now!.p, r.now!.b) }, { label: 'יעד', v: `${nf(r.now!.t.v, 0)}%`, src: () => tgtProv(r.id, r.now!.t) }] });
  const csmAbs = (r: Row) => effProv(r.csm!.eff, (x) => sensProv(x, 'השפעה על CSM'), MM, (v) => (v > 0 ? '+' : '') + amt(v), `השפעה על CSM · ${name(r.id)}`, [`בסיס ${BASIS[r.csm!.b] ?? r.csm!.b}`]);
  const eqAbs = (r: Row) => effProv(r.eq!.eff, (x) => sensProv(x, x.eff === 'profit' ? 'השפעה על הרווח' : x.eff === 'pe' ? 'השפעה על הרווח וההון' : 'השפעה על ההון'), MM, (v) => (v > 0 ? '+' : '') + amt(v), `השפעה על ההון · ${name(r.id)}`,
    [r.eq!.proxy.length ? `לא גולתה השפעה על ההון ל${r.eq!.proxy.map((k) => SLIDERS.find((s) => s.k === k)!.he).join(', ')}: מוצגת ההשפעה על הרווח (אחרי מס כשצוין)` : '', r.eq!.e === 'pe' ? 'רווח והון בשורה אחת' : '']);
  const csmRel = (r: Row) => (r.csm?.base ? relProv(csmAbs(r), (r.csm.eff.v / r.csm.base.v) * 100, r.csm.base.v, () => lineProv(r.csm!.base!, L.d, `יתרת CSM · ${r.csm!.scope} · ${name(r.id)}`), `השפעה על CSM · ${name(r.id)}`, 'יתרת CSM') : null);
  const eqRel = (r: Row) => (r.eq?.base ? relProv(eqAbs(r), (r.eq.eff.v / r.eq.base.v) * 100, r.eq.base.v, () => factProv(r.eq!.base!, L.d, `הון לבעלי המניות · ${name(r.id)}`), `השפעה על ההון · ${name(r.id)}`, 'הון לבעלי המניות') : null);

  const Flags = ({ f, proxy }: { f: Effect<unknown> | undefined; proxy?: SRisk[] }) => (!f ? null : <>
    {f.extra && <span className="chip est" title="זעזוע מחוץ לטווח שגולה: ההשפעה נשארת בערך הקצה">אקסטרפולציה</span>}
    {f.combo && <span className="chip" title="ההשפעות חוברו כפי שגולו, בלי פיזור בין הסיכונים">ללא פיזור</span>}
    {proxy && f.parts.some((p) => proxy.includes(p.k)) && <span className="chip" title="לא גולתה השפעה על ההון לזעזוע הזה; מוצגת ההשפעה על הרווח">רווח</span>}
    {f.none.length > 0 && <span className="chip" title={`לא גולתה רגישות ל: ${f.none.map((k) => SLIDERS.find((s) => s.k === k)!.he).join(', ')}`}>חסר {f.none.length}</span>}
  </>);

  const set = (k: SRisk, v: number) => setSc((p) => ({ ...p, [k]: v }));
  const share = () => copyText(window.location.href, (ok) => { setCopied(ok); setTimeout(() => setCopied(null), 1800); });
  const presetProv = (p: Preset, k: 'rate' | 'equity'): Prov => k === 'rate'
    ? { k: 'calc', title: `${p.he} · ריבית`, value: `${sn(p.sc.rate, 0)} נ״ב`, formula: 'שינוי התשואה הריאלית לאפס, 10 שנים (ממוצע חודשי) בין שני החודשים × 100',
      inputs: p.r ? [{ label: `תשואה ריאלית 10 שנים, ${p.rate[0].slice(5)}/${p.rate[0].slice(2, 4)}`, v: `${nf(p.r.from, 2)}%` }, { label: `תשואה ריאלית 10 שנים, ${p.rate[1].slice(5)}/${p.rate[1].slice(2, 4)}`, v: `${nf(p.r.to, 2)}%` }] : [],
      note: p.r ? `בנק ישראל, עקום אפס (ZCM) · סדרה ${p.r.code} · נשלף ${dateLabel(p.r.retrieved)} · ${p.r.url}` : undefined }
    : { k: 'calc', title: `${p.he} · מניות`, value: `${sn(p.sc.equity, 1)}%`, formula: 'תשואה חודשית מצטברת של מסלולי המניות בקופות הגמל (ממוצע משוקלל בנכסים)',
      inputs: (p.e?.months ?? []).map(([m, y], i) => ({ label: `${String(m % 100).padStart(2, '0')}/${String(m).slice(2, 4)} · ${p.e!.n[i]} מסלולים`, v: `${sn(y, 2)}%` })),
      note: `גמל-נט (רשות שוק ההון, data.gov.il), קטגוריה "${p.e?.cat}"; מקרוב למחירי המניות, לא מדד` };

  const controls = (
    <div className="stress-ctl">
      <div className="stress-sliders">
        {SLIDERS.map((s) => (
          <label key={s.k} className={`stress-sl ${sc[s.k] ? 'on' : ''}`}>
            <span className="l">{s.he}</span>
            <input type="range" min={s.min} max={s.max} step={s.step} value={sc[s.k]} onChange={(e) => set(s.k, Number(e.target.value))} aria-label={`${s.he}, ${s.unit}`} />
            <span className="v num">{sc[s.k] > 0 ? '+' : sc[s.k] < 0 ? '−' : ''}{nf(Math.abs(sc[s.k]), s.step < 1 ? 1 : 0)}<small>{s.unit}</small></span>
          </label>
        ))}
      </div>
      <div className="stress-presets">
        <span className="dim">תרחישי עבר</span>
        {presets.map((p) => <button key={p.id} type="button" className="chip" aria-pressed={preset?.id === p.id} disabled={!p.r && !p.e} title={`ריבית ${p.rate[0].slice(5)}/${p.rate[0].slice(2, 4)}–${p.rate[1].slice(5)}/${p.rate[1].slice(2, 4)}, מניות ${p.eq[0].slice(5)}/${p.eq[0].slice(2, 4)}–${p.eq[1].slice(5)}/${p.eq[1].slice(2, 4)}`} onClick={() => setSc(p.sc)}>{p.he}</button>)}
        <button type="button" className="chip" onClick={() => setSc(ZERO)} disabled={!act.length}>איפוס</button>
        <button type="button" className="chip" onClick={share}>{copied == null ? 'העתקת קישור לתרחיש' : copied ? 'הקישור הועתק' : 'ההעתקה נכשלה'}</button>
      </div>
      {preset && <div className="src">{preset.he}: <Sourced className="num" src={() => presetProv(preset, 'rate')}>ריבית {sn(preset.sc.rate, 0)} נ״ב</Sourced> (תשואה ריאלית 10 שנים, בנק ישראל, {preset.rate[0].slice(5)}/{preset.rate[0].slice(2, 4)}→{preset.rate[1].slice(5)}/{preset.rate[1].slice(2, 4)}) · <Sourced className="num" src={() => presetProv(preset, 'equity')}>מניות {sn(preset.sc.equity, 1)}%</Sourced> (מסלולי מניות בגמל-נט, {preset.eq[0].slice(5)}/{preset.eq[0].slice(2, 4)}–{preset.eq[1].slice(5)}/{preset.eq[1].slice(2, 4)})</div>}
    </div>
  );

  const cells = (r: Row): ReactNode[] => {
    const o = solvOut(r), s = r.sv;
    return [
      <>{r.csm ? <>
                  <Sourced className={`num ${r.csm.eff.v < 0 ? 'neg' : r.csm.eff.v > 0 ? 'pos' : ''}`} src={() => csmAbs(r)}>{(r.csm.eff.v > 0 ? '+' : '') + amt(r.csm.eff.v)}</Sourced>
                  {r.csm.base && <Sourced className="num der dim" src={() => csmRel(r)!}>{pctS((r.csm.eff.v / r.csm.base.v) * 100)}</Sourced>}
                  <Flags f={act.length ? r.csm.eff : undefined} /></> : <span className="muted">–</span>}</>,
      <>{r.eq ? <>
                  <Sourced className={`num ${r.eq.eff.v < 0 ? 'neg' : r.eq.eff.v > 0 ? 'pos' : ''}`} src={() => eqAbs(r)}>{(r.eq.eff.v > 0 ? '+' : '') + amt(r.eq.eff.v)}</Sourced>
                  {r.eq.base && <Sourced className="num der dim" src={() => eqRel(r)!}>{pctS((r.eq.eff.v / r.eq.base.v) * 100)}</Sourced>}
                  <Flags f={act.length ? r.eq.eff : undefined} proxy={r.eq.proxy} /></> : <span className="muted">–</span>}</>,
      <>{s && s.fresh && s.base ? <>
                  <Sourced className="num" src={() => effProv(s.eff, solvSrc, PP, pp, `השפעה על יחס כושר הפירעון · ${name(r.id)}`)}>{nf(s.base.v + s.eff.v, 0)}%</Sourced>
                  <span className="dim"><span className="num">{pp(s.eff.v)}</span> · בסיס <span className="num">{nf(s.base.v, 0)}%</span> · {dLab(s.d)}</span><Flags f={act.length ? s.eff : undefined} /></>
                  : s && s.fresh && s.b === 'na' ? <><Sourced className="num" src={() => effProv(s.eff, solvSrc, PP, pp, `השפעה על יחס כושר הפירעון · ${name(r.id)}`)}>{pp(s.eff.v)}</Sourced><span className="dim">{dLab(s.d)} · בסיס לא צוין</span></>
                  : <span className="muted" title={s ? `רגישות היחס האחרונה: ${dLab(s.d)}` : 'לא גולתה רגישות של יחס כושר הפירעון'}>{s ? `רגישות אחרונה ${dLab(s.d)}` : 'לא גולתה'}</span>}</>,
      <>{o && s ? <><Sourced className={`num ${o.head < 0 ? 'neg' : ''}`} src={() => headProv(r, o)}>{pp(o.head)}</Sourced><span className="dim">מול <Sourced className="num" src={() => tgtProv(r.id, s.ref!)}>{nf(s.ref!.v, 0)}%</Sourced> · {bLabel(s.b)}</span></>
                  : r.now ? <><Sourced className="num dim" src={() => nowProv(r, r.now!.x.v - r.now!.t.v)}>{pp(r.now.x.v - r.now.t.v)}</Sourced><span className="dim">היום, ללא תרחיש · {periodName(r.now.p).replace('FY', 'Q4')}</span></> : <span className="muted">–</span>}</>,
      <>{o && s ? <>
                  <span className={`chip ${o.room >= 0 ? 'pass' : 'fail'}`}>{o.room >= 0 ? 'מעל סף החלוקה' : 'מתחת לסף החלוקה'}</span>
                  {o.cap != null && s.scr && <Sourced className="num der" src={() => ({ k: 'calc', title: `עודף הון מעל סף החלוקה אחרי התרחיש · ${name(r.id)}`, value: amt(o.cap!), unit: MM, est: true,
                    formula: '(יחס אחרי התרחיש − סף החלוקה) ÷ 100 × SCR ביום הגילוי; בהנחה שה-SCR אינו משתנה בתרחיש',
                    inputs: [{ label: 'יחס אחרי התרחיש', v: `${nf(o.stressed, 1)}%`, src: () => effProv(s.eff, solvSrc, PP, pp, `השפעה על יחס כושר הפירעון · ${name(r.id)}`) }, { label: o.div.l ? `סף: ${o.div.l.slice(0, 60)}` : 'סף חלוקה', v: `${nf(o.div.v, 0)}%`, src: () => tgtProv(r.id, o.div) },
                      { label: `SCR ${dLab(s.d)}, ${bLabel(s.b)}`, v: amt(s.scr!.v), src: () => solvCell(s.scr!, s.d, `SCR · ${name(r.id)}`, MM, amt(s.scr!.v)) }],
                    note: o.div === s.ref && !/dividend|דיבידנד/i.test(`${o.div.m} ${o.div.l ?? ''}`) ? 'לבסיס זה לא הודפס סף חלוקה נפרד: מוצג מול יעד הדירקטוריון' : undefined })}>{o.cap >= 0 ? '≈ ' : ''}{amt(o.cap)}</Sourced>}</>
                  : <span className="muted">–</span>}</>,
    ];
  };
  const HEAD = ['CSM', 'הון', 'יחס כושר פירעון', 'מרווח מעל היעד', 'כושר חלוקה'];
  const scenarioText = act.length ? act.map((k) => shockText(k, sc[k])).join(' · ') : 'ללא זעזוע';
  const M_L: Record<Metric, string> = { head: 'מרווח מעל יעד הדירקטוריון, נ״א', eq: 'השפעה על ההון, % מההון', csm: 'השפעה על CSM, % מה-CSM' };
  return (
    <>
      <Panel title="תרחיש" aside={<Seg<'net' | 'gross'> label="בסיס CSM" value={basis} onChange={(v) => setParam('b', v, 'net')} options={[['net', 'נטו'], ['gross', 'ברוטו']]} />}>
        {controls}
      </Panel>

      <Panel title={`דירוג · ${M_L[metric]}`} aside={<Seg<Metric> label="מדד" value={metric} onChange={(v) => setParam('m', v, 'head')} options={[['head', 'מרווח מעל היעד'], ['eq', 'הון'], ['csm', 'CSM']]} />}>
        {bars.length === 0 ? <Empty title="אין נתונים למדד הזה" /> : (
          <Chart label={`מעבדת תרחישים · ${M_L[metric]}`} height={Math.max(200, bars.length * 36 + 56)} deps={[metric, basis, JSON.stringify(sc), bars.length]} source={`${scenarioText} · גילויי רגישות FY'25 ודוחות כושר פירעון`} build={() => {
            const b = chartBase(), xs = [...bars].reverse();
            const fmt = (v: number) => (metric === 'head' ? pp(v) : pctS(v));
            return {
              animation: false, textStyle: { fontFamily: CHART_FONT, color: b.fg }, grid: { left: 8, right: phone ? 56 : 80, top: 10, bottom: 6, containLabel: true },
              tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => { const x = xs[ps[0].dataIndex]; return `${name(x.id)}: <b>‎${fmt(x.v)}</b>${x.tag ? `<br/><span style="opacity:.75">${x.tag}</span>` : ''}`; } },
              xAxis: { type: 'value', axisLabel: { color: b.mu, fontSize: 10.5, formatter: (v: number) => `‎${nf(v, 0)}` }, splitLine: { lineStyle: { color: b.ln, type: 'dashed' } } },
              yAxis: { type: 'category', data: xs.map((x) => name(x.id)), axisTick: { show: false }, axisLine: { lineStyle: { color: b.ln } }, axisLabel: { color: b.fg, fontSize: 11.5 } },
              series: [{ type: 'bar', barMaxWidth: 18, data: xs.map((x) => ({ value: +x.v.toFixed(2), itemStyle: { color: idColor(x.id), opacity: x.on ? 1 : 0.35, borderRadius: 2, decal: x.on ? undefined : { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: -0.8, color: 'rgba(255,255,255,.35)' } } })),
                label: { show: true, position: 'right', color: b.mu, fontSize: 10.5, formatter: (p: { dataIndex: number }) => `‎${fmt(xs[p.dataIndex].v)}` },
                markLine: metric === 'head' ? { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: b.fg, type: 'solid', width: 1 }, data: [{ xAxis: 0 }] } : undefined }],
            };
          }} onPoint={(_, di) => { const x = [...bars].reverse()[di]; if (x) open(x.prov()); }} />
        )}
        <div className="src">{metric === 'head' ? 'יחס כושר הפירעון ביום הגילוי ועוד השפעת התרחיש, פחות יעד הדירקטוריון באותו בסיס (עם או בלי הוראות מעבר, כפי שהודפס). מקווקו: חברה בלי רגישות יחס עדכנית (עד שנתיים) — המצב הנוכחי, בלי תרחיש.' : `ההשפעה המגולה ÷ ${metric === 'eq' ? 'ההון לבעלי המניות' : 'יתרת ה-CSM'} ליום הגילוי (FY'25).`} {scenarioText}.</div>
      </Panel>

      <Panel title="השפעה לפי חברה" aside={<span>{scenarioText} · {MM}</span>}>
        {phone ? <div className="csmcards">{rows.map((r) => { const cs = cells(r); return (
          <div key={r.id} className="csmcard stress-card"><header><Dot id={r.id} /><Link to={`/company/${r.id}/ifrs17`}>{name(r.id)}</Link><span className="dim">גילוי {periodName(r.rp)}</span></header>
            <div className="stress-k">{cs.map((c, i) => <div key={i}><span className="l">{HEAD[i]}{i === 4 && <span className="chip est">אומדן</span>}</span>{c}</div>)}</div></div>); })}</div>
        : <div className="scroll"><table className="stress-t">
          <thead><tr><th>חברה</th><th>CSM</th><th>הון</th><th>יחס כושר פירעון</th><th>מרווח מעל היעד</th><th>כושר חלוקה <span className="chip est">אומדן</span></th></tr></thead>
          <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="lbl"><Dot id={r.id} /><Link to={`/company/${r.id}/ifrs17`}>{name(r.id)}</Link><span className="dim">גילוי {periodName(r.rp)}</span></td>
                {cells(r).map((c, i) => <td key={i}>{c}</td>)}
              </tr>
          ))}</tbody>
        </table></div>}
        <div className="src">כל השפעה נקראת מהקו שבין נקודות הגילוי של החברה (FY'25 לרגישויות IFRS 17; דוח כושר הפירעון האחרון ליחס), בלי מודל: בתוך הטווח שגולה — אינטרפולציה; מחוצה לו — הערך בקצה, מסומן "אקסטרפולציה". זעזועים חוברו כפי שגולו, בלי פיזור. הגדרות התרחיש של כל חברה שונות (עקום מלא או ריבית חסרת סיכון; חשיפת מניות) — השוו כיוון וסדר גודל. הון: אחרי מס כשצוין; "רווח" = החברה גילתה רק השפעה על הרווח. CSM: בסיס {BASIS[basis]}, יתרה ליום הגילוי.</div>
      </Panel>
    </>
  );
}
