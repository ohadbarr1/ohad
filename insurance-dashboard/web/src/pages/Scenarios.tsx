import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { ContextBar, Sheet } from '../components/Sheet';
import { Empty, ErrorBox, Loading, Panel, Seg, copyText } from '../components/ui';
import { load, useLoad, useRegistry } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { idCss } from '../lib/identity';
import { ltsProv, warmRep } from '../lib/lens';
import type { Prov } from '../lib/prov';
import { OUT_KEYS, QUALITY_HE, driversPath, fmt, fmtS, type DriverFile, type LtsResolver, type OutKey } from '../lib/drivers';
import {
  GAP_INPUT, RANK_HE, graphGaps, SLIDERS, SL_OF, ZERO, active, headline, makeCtx, ncRows, presets, rank, readScn, runAll, sameScn, scnText, sentence, writeScn,
  type CatFile, type Cell, type Ctx, type CurveFile, type MacroFile, type NowcastFile, type Preset, type RankKey, type Res, type Scn, type SKey,
} from '../lib/scenarios';
import '../styles/scenarios.css';

/* A2 · /scenarios, the war table: eight inputs, all 17 companies repriced through their driver graphs (lib/drivers.ts propagate) as the
   sliders move, ranked by how much of their capital or earnings cushion the scenario consumes. The scenario lives in the URL. Every
   figure opens its propagation path; gaps in the graph are shown as gaps, never as zero effects. Not a navigation item. */

const lts: LtsResolver = (j) => ltsProv(j.c, j.metric, j.period, j.title, j.unit, j.note, j.value);
const KIND: Record<string, string> = { insurance_group: 'ביטוח', fund_house: 'בית השקעות' };
const COLS: { k: OutKey | 'head'; he: string; unit: string; d: number }[] = [
  { k: 'revenue', he: 'הכנסות, פנסיה וגמל', unit: 'מ׳ ש״ח', d: 0 }, { k: 'op_profit', he: 'רווח תפעולי, פנסיה וגמל', unit: 'מ׳ ש״ח', d: 0 },
  { k: 'net_profit', he: 'רווח נקי', unit: 'מ׳ ש״ח', d: 0 }, { k: 'roe', he: 'ROE', unit: '%', d: 1 },
  { k: 'solv_w', he: 'כושר פירעון, עם הוראות מעבר', unit: '%', d: 0 }, { k: 'solv_wo', he: 'כושר פירעון, ללא הוראות מעבר', unit: '%', d: 0 },
  { k: 'csm', he: 'CSM', unit: 'מ׳ ש״ח', d: 0 }, { k: 'head', he: 'מרווח ליעד הדירקטוריון', unit: 'נ״א', d: 1 },
  { k: 'dist_capital', he: 'הון מעל יעד הדירקטוריון', unit: 'מ׳ ש״ח', d: 0 }, { k: 'div_capacity', he: 'עודף מעל סף הדיבידנד', unit: 'מ׳ ש״ח', d: 0 },
  { k: 'pb', he: 'P/B מוצדק', unit: 'x', d: 2 },
];
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** every managing company whose printed components a file cites (their provenance file loads before a sheet opens) */
function ltsCos(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((y) => ltsCos(y, out));
  else if (x && typeof x === 'object') { const o = x as Record<string, unknown>; if (o.k === 'lts' && typeof o.c === 'string') out.add(o.c); else Object.values(o).forEach((y) => ltsCos(y, out)); }
  return out;
}

/** all driver files at once: the page has nothing to show until every company can be repriced */
function useDriverFiles(ids: string[] | null) {
  const [st, set] = useState<{ files: Map<string, DriverFile> | null; error: string | null }>({ files: null, error: null });
  const key = ids?.join(',') ?? '';
  useEffect(() => {
    if (!ids) return;
    let live = true;
    Promise.all(ids.map((id) => load<DriverFile>(driversPath(id)).then((f) => [id, f] as const)))
      .then((xs) => live && set({ files: new Map(xs), error: null }), (e: Error) => live && set({ files: null, error: e.message }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return st;
}

const Dot = ({ id }: { id: string }) => <i className="scn-dot" style={{ background: idCss(id) }} aria-hidden="true" />;
const sign = (v: number, d: number) => `⁦${fmtS(v, d)}⁩`;
const tone = (v: number | null | undefined) => (v == null || Math.abs(v) < 1e-9 ? '' : v < 0 ? 'neg' : 'pos');

/** the marks a figure carries: an estimate (assumption, extrapolation, stale disclosure), a gap, a low-quality link */
function Marks({ c }: { c: Pick<Cell, 'gap' | 'est' | 'q'> }) {
  return <>
    {c.gap.length > 0 && <span className="chip gap" title={c.gap.join('\n')}>חסר</span>}
    {c.est.length > 0 && <span className="chip est" title={c.est.join('\n')}>אומדן</span>}
    {c.q === 'low' && !c.est.length && <span className="chip est" title="הקשר החלש ביותר בחישוב: איכות נמוכה (ראו המקור)">איכות {QUALITY_HE.low}</span>}
  </>;
}

/** one output of one company: the stressed figure, the change under it, its marks */
function Fig({ r, k, d, unit, phone }: { r: Res; k: OutKey | 'head'; d: number; unit: string; phone?: boolean }) {
  if (k === 'head') {
    const h = r.head;
    if (!h) return <span className="muted" title={r.kind === 'insurance_group' ? 'לא נמצא יעד דירקטוריון ליחס' : 'לא מבטחת'}>{r.kind === 'insurance_group' ? '–' : '·'}</span>;
    const c = r.cells[h.t.ratio];
    return <span className="scn-fig">
      {h.v == null ? <span className="muted">–</span> : <Sourced className={`v ${h.v < 0 ? 'neg' : ''}`} src={h.prov}>{sign(h.v, d)}</Sourced>}
      <span className="dd">בסיס <span className="num">{fmt(h.base, d)}</span> · מול <Sourced className="num" src={h.t.prov}>{fmt(h.t.v, h.t.v % 1 ? 1 : 0)}%</Sourced></span>
      <span className="mk"><Marks c={{ gap: c.gap, est: [...(h.t.est ? [h.t.est] : []), ...c.est], q: c.q }} /></span>
    </span>;
  }
  const c = r.cells[k];
  if (c.na) return <span className="muted" title="לא רלוונטי לחברה">·</span>;
  const u = unit === '%' ? '%' : unit === 'x' ? 'x' : '';
  return <span className="scn-fig">
    {c.v == null ? <span className="muted" title={c.gap.join('\n') || 'אין בסיס לחברה'}>–</span> : <Sourced className="v" src={() => c.o.prov}>{fmt(c.v, d)}{u}</Sourced>}
    {c.d != null && c.base != null && Math.abs(c.d) >= Math.pow(10, -d) / 2 ? <span className={`dd num ${tone(c.d)}`}>{sign(c.d, d)}{unit === '%' ? ' נ״א' : ''}</span>
      : c.base != null && c.v == null ? <span className="dd">בסיס <span className="num">{fmt(c.base, d)}{u}</span></span> : phone ? null : <span className="dd"> </span>}
    <span className="mk"><Marks c={c} /></span>
  </span>;
}

/** a cushion bar: the share of the cushion the scenario consumes (100% = the cushion is gone) */
function Bar({ label, v, src, note, lead }: { label: string; v: number | null; src: () => Prov; note: ReactNode; lead: boolean }) {
  if (v == null) return <div className="scn-bar off"><span className="l">{label}</span><span className="track" /><span className="muted">–</span><span className="n">{note}</span></div>;
  const w = Math.min(100, Math.abs(v));
  return <div className={`scn-bar${lead ? ' lead' : ''}${v < 0 ? ' gain' : ''}${v >= 100 ? ' over' : ''}`}>
    <span className="l">{label}</span>
    <span className="track" aria-hidden="true"><i style={{ width: `${w}%` }} /></span>
    <Sourced className="pc" src={src}>{v < 0 ? `+${fmt(-v, 0)}%` : `${fmt(v, 0)}%`}</Sourced>
    <span className="n">{note}</span>
  </div>;
}

/** reorders animate: each row slides from where it was (FLIP), unless the reader asked for less motion */
function useFlip(keys: string[]) {
  const els = useRef(new Map<string, HTMLElement>()), prev = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const now = new Map<string, number>();
    els.current.forEach((el, k) => now.set(k, el.offsetTop));
    if (!reduced()) now.forEach((top, k) => {
      const was = prev.current.get(k), el = els.current.get(k);
      if (was == null || !el || was === top) return;
      el.style.transition = 'none'; el.style.transform = `translateY(${was - top}px)`;
      requestAnimationFrame(() => { el.style.transition = 'transform 180ms var(--ease)'; el.style.transform = ''; });
    });
    prev.current = now;
  }, [keys.join(',')]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (k: string) => (el: HTMLElement | null) => { if (el) els.current.set(k, el); else els.current.delete(k); };
}

export function Scenarios() {
  const reg = useRegistry();
  const phone = usePhone();
  const ids = useMemo(() => reg.data?.map((c) => c.id) ?? null, [reg.data]);
  const D = useDriverFiles(ids);
  const NC = useLoad<NowcastFile>('nowcast.json'), MC = useLoad<MacroFile>('macro/macro.json'), CV = useLoad<CurveFile>('macro/boi_curve.json'), CT = useLoad<CatFile>('funds/cat.json');
  const [sp, setSp] = useSearchParams();
  const [scn, setScn] = useState<Scn>(() => readScn(sp));
  const mode = sp.get('x') === 'lin' ? 'linear' : 'clamp';
  const rk = ((['vul', 'head', 'roe', 'np'] as const).find((k) => k === sp.get('k')) ?? 'vul') as RankKey;
  const setParam = (k: string, v: string, def: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (v === def) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const [sheet, setSheet] = useState(false);
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);

  // the scenario follows the URL (back, a shared link) and writes itself into it after a short pause while a slider moves
  const last = useRef(sp.toString());
  useEffect(() => { if (sp.toString() !== last.current) { last.current = sp.toString(); setScn(readScn(sp)); } }, [sp]);
  useEffect(() => {
    const t = setTimeout(() => setSp((prev) => { const n = writeScn(prev, scn); last.current = n.toString(); return n; }, { replace: true }), 220);
    return () => clearTimeout(t);
  }, [scn, setSp]);
  // a slider commits at most once a frame
  const pend = useRef<Scn | null>(null), raf = useRef(0);
  const set = useCallback((k: SKey | 'h', v: number) => {
    pend.current = { ...(pend.current ?? scnRef.current), [k]: v } as Scn;
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; const p = pend.current; pend.current = null; if (p) setScn(p); });
  }, []);
  const scnRef = useRef(scn); scnRef.current = scn;
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const NCm = useMemo(() => ncRows(NC.data), [NC.data]);
  const ctx = useMemo<Ctx[] | null>(() => (D.files && reg.data ? reg.data.map((c) => makeCtx(c.id, c.name_he, D.files!.get(c.id)!, NCm, lts)) : null), [D.files, reg.data, NCm]);
  const base = ctx?.[0]?.f.meta.base;
  const P = useMemo<Preset[]>(() => presets(CV.data, CT.data, MC.data, NC.data, base?.end ?? '2026-06-30'), [CV.data, CT.data, MC.data, NC.data, base?.end]);
  const now = P.find((p) => p.id === 'now');
  const ncAt = useMemo(() => ({ eq: now?.sc.eq ?? 0, y10: now?.sc.y10 ?? 0 }), [now?.sc.eq, now?.sc.y10]);
  const ms = useRef(0);
  const res = useMemo(() => {
    if (!ctx) return null;
    const t0 = performance.now(), r = runAll(ctx, scn, ncAt, mode, lts);
    ms.current = performance.now() - t0;
    return r;
  }, [ctx, scn, ncAt, mode]);
  const ranked = useMemo(() => (res ? rank(res, rk) : []), [res, rk]);
  const flip = useFlip(ranked.map((r) => r.id));
  const warm = (id: string) => { const f = D.files?.get(id); if (f) ltsCos(f).forEach((c) => warmRep(c)); };

  if (reg.error || D.error) return <ErrorBox what="קובצי המנגנונים" error={(reg.error ?? D.error)!} />;
  if (!ctx || !res) return <Loading what="חדר התרחישים" />;
  if (!ctx.length) return <Empty title="אין חברות" />;

  const act = active(scn);
  const cur = P.find((p) => p.ok && sameScn(p.sc, scn) && (act.length > 0 || p.sc.nc === 1));
  const label = cur ? `תחת "${cur.he}"` : act.length || scn.nc ? 'תחת התרחיש' : 'ללא זעזוע';
  const head = act.length || scn.nc ? headline(rank(res, 'vul'), label) : 'הזיזו מחוון או בחרו תרחיש: 17 החברות מתומחרות מחדש מיד';
  const below = res.filter((r) => r.tier === 0);
  const shown = ranked.filter((r) => r.tier < 2), none = ranked.filter((r) => r.tier === 2);
  const list = all || phone === false && shown.length <= 10 ? shown : shown.slice(0, phone ? 6 : 10);
  const share = () => copyText(window.location.href, (ok) => { setCopied(ok); setTimeout(() => setCopied(null), 1800); });
  const pick = (p: Preset) => setScn(p.sc);
  const phoneTxt = scnText(scn);

  const sliders = (
    <div className="scn-sliders" data-ms={ms.current.toFixed(2)}>
      {SLIDERS.map((d, i) => {
        const v = scn[d.k], gap = GAP_INPUT[d.k];
        const fee0 = d.group === 'fee' && SLIDERS[i - 1]?.group !== 'fee';
        return (
          <div key={d.k} className={`scn-sl${v ? ' on' : ''}${gap ? ' gapped' : ''}${d.group ? ' sub' : ''}`}>
            {fee0 && <div className="scn-grp">שחיקת דמי ניהול על הצבירה <span className="dim">פוליסות חיסכון לא נכללות</span></div>}
            <label className="row">
              <span className="l">{d.group ? d.he.split(' · ')[1] : d.he}</span>
              <input type="range" min={d.min} max={d.max} step={d.step} value={v} onChange={(e) => set(d.k, Number(e.target.value))} aria-label={`${d.he}, ${d.unit}`} aria-valuetext={`${fmtS(v, d.step < 1 ? 1 : 0)} ${d.unit}`} />
              <output className="v num">{v > 0 ? '+' : v < 0 ? '−' : ''}{fmt(Math.abs(v), v % 1 ? 1 : 0)}<small>{d.unit}</small></output>
            </label>
            {gap && <div className="scn-gapnote"><span className="chip gap" title={gap}>לא מוזרם</span><span className="dim">{d.k === 'credit' ? 'אין גילוי רגישות' : 'אין ערוץ מכויל'}</span></div>}
            {d.k === 'flow' && <div className="scn-h"><span className="dim">אופק</span><Seg<'4' | '8'> label="אופק הניוד" value={String(scn.h) as '4' | '8'} onChange={(x) => set('h', Number(x))} options={[['4', '4 רבעונים'], ['8', '8 רבעונים']]} /></div>}
          </div>
        );
      })}
      {scn.nc === 1 && <div className="scn-nc"><span className="chip est" title="M1: הנכסים הממוצעים ותשואת דמי הניהול ברבעון הנוכחי לכל מוצר, מנתוני הרשות; במקום ערוץ הנכסים">נכסים ודמי ניהול: M1 · {NC.data?.meta.live.q.replace(/Q(\d)-20(\d\d)/, "Q$1'$2")}</span><button type="button" className="chip" onClick={() => setScn({ ...scn, nc: 0 })}>הסרה</button></div>}
      <div className="scn-mode">
        <span className="dim">מעבר לנקודות הגילוי</span>
        <Seg<'clamp' | 'linear'> label="מעבר לנקודות הגילוי" value={mode} onChange={(v) => setParam('x', v === 'linear' ? 'lin' : 'clamp', 'clamp')} options={[['clamp', 'חיתוך בקצה'], ['linear', 'הארכה לינארית']]} />
      </div>
    </div>
  );
  const presetBar = (
    <div className="scn-presets" role="group" aria-label="תרחישים">
      {P.map((p) => <button key={p.id} type="button" className="chip" aria-pressed={cur?.id === p.id} disabled={!p.ok} title={p.ok ? scnText(p.sc) : 'הנתונים לתרחיש לא נטענו'} onClick={() => pick(p)}>{p.he}</button>)}
      <button type="button" className="chip" onClick={() => setScn(ZERO)} disabled={!act.length && !scn.nc}>איפוס</button>
      <button type="button" className="chip" onClick={share}>{copied == null ? 'העתקת קישור' : copied ? 'הקישור הועתק' : 'ההעתקה נכשלה'}</button>
    </div>
  );

  return (
    <div className="scn">
      <div className="pagehead"><div>
        <h1><span className="icotile"><Icon name="sliders" /></span>חדר תרחישים</h1>
        <div className="sub"><span><span className="num">{ctx.length}</span> חברות</span><span>·</span><span>בסיס <span className="num">{base?.q}</span>, LTM <span className="num">{base?.ltm[0]}–{base?.ltm[3]}</span></span><span>·</span><span>קצב שנתי, ש״ח במיליונים</span><span>·</span><Link to="/drivers">המנגנונים</Link><Link to="/industry/csm?view=stress">מעבדת הרגישויות</Link><Link to="/fragility?s=scen">מוניטור שבריריות</Link></div>
      </div></div>

      {presetBar}
      {cur && <div className="scn-def src"><Sourced src={() => cur.prov}>{cur.he}</Sourced>: {scnText(cur.sc)}{cur.gaps.length > 0 && <> · <span className="gapt">{cur.gaps.join(' · ')}</span></>}</div>}

      <section className="scn-head" aria-live="polite">
        <p>{head}</p>
        <div className="meta">
          {below.length > 0 && <span className="chip fail-t"><span className="num">{below.length}</span> מתחת ליעד הדירקטוריון</span>}
          {mode === 'linear' && <span className="chip est" title="ההשפעות מעבר לנקודה הקיצונית שגולתה מוארכות בקו ישר: אומדן">הארכה לינארית: אומדן</span>}
          {act.filter((k) => GAP_INPUT[k]).map((k) => <span key={k} className="chip gap" title={GAP_INPUT[k]}>{SL_OF[k].he}: לא מוזרם</span>)}
        </div>
      </section>

      {phone && <ContextBar onOpen={() => setSheet(true)} label="מחוונים"><b>{cur?.he ?? (act.length ? 'תרחיש' : 'ללא זעזוע')}</b>{act.length > 0 && <> · {phoneTxt}</>}</ContextBar>}
      {phone && <Sheet open={sheet} onClose={() => setSheet(false)} title="מחוונים">{sliders}</Sheet>}

      <div className="scn-grid">
        {!phone && <aside className="scn-aside"><Panel title="מחוונים" aside={<span>{act.length ? <span className="num">{act.length}</span> : 'אין'} פעילים</span>}>{sliders}</Panel></aside>}
        <div className="scn-main">
          <Panel className="scn-rank" title="דירוג פגיעות" aside={<Seg<RankKey> label="דירוג לפי" value={rk} onChange={(v) => setParam('k', v, 'vul')} options={(Object.keys(RANK_HE) as RankKey[]).map((k) => [k, RANK_HE[k]])} />}>
            <ol className="scn-list">
              {list.map((r, i) => (
                <li key={r.id} ref={flip(r.id)} className={`scn-r t${r.tier}`} onPointerEnter={() => warm(r.id)} onFocus={() => warm(r.id)}>
                  <span className="rk num" aria-hidden="true">{i + 1}</span>
                  <div className="who"><Dot id={r.id} /><Link to={`/company/${r.id}`}>{r.name}</Link><span className="dim">{KIND[r.kind] ?? ''}</span>
                    {r.breach && <span className="chip fail-t">חוצה את היעד</span>}{r.below0 && <span className="chip fail-t" title={`יחס ${r.head!.rp}: ${fmt(r.head!.base + r.head!.t.v, 1)}% מול יעד ${fmt(r.head!.t.v, 0)}%`}>מתחת ליעד בבסיס</span>}</div>
                  <p className="txt">{sentence(r)}</p>
                  <div className="bars">
                    <Bar label="מרווח ליעד" v={r.capUse} src={r.capProv} lead={r.driver === 'cap'} note={r.head ? <><span className="num">{fmt(r.head.base, 1)}</span>{r.head.v != null && <> ← <span className={`num ${r.head.v < 0 ? 'neg' : ''}`}>{fmt(r.head.v, 1)}</span></>} נ״א · {r.head.t.basis === 'w' ? 'עם הוראות מעבר' : r.head.t.basis === 'wo' ? 'ללא הוראות מעבר' : 'בסיס לא צוין'}</> : r.kind === 'insurance_group' ? 'אין יעד ליחס' : 'לא מבטחת'} />
                    <Bar label="רווח נקי" v={r.earnUse} src={r.earnProv} lead={r.driver === 'earn'} note={r.cells.roe.d != null && r.cells.roe.base != null ? <>ROE <span className="num">{fmt(r.cells.roe.base, 1)}%</span> ← <Sourced className={`num ${tone(r.cells.roe.d)}`} src={() => r.cells.roe.o.prov}>{fmt(r.cells.roe.v, 1)}%</Sourced></> : 'אין רווח LTM'} />
                  </div>
                </li>
              ))}
            </ol>
            {shown.length > list.length && <button type="button" className="btn scn-more" onClick={() => setAll(true)}>כל <span className="num">{shown.length}</span> החברות</button>}
            {none.length > 0 && <div className="src">ללא בסיס לחישוב (אין רווח LTM ואין יחס כושר פירעון): {none.map((r, i) => <span key={r.id}>{i ? ', ' : ''}<Link to={`/drivers/${r.id}`}>{r.name}</Link></span>)}</div>}
            <div className="src">הדירוג: החמור מבין שתי השחיקות. מרווח ליעד = −Δ יחס כושר הפירעון ÷ (יחס − יעד הדירקטוריון, אותו בסיס); רווח = −Δ רווח נקי ÷ רווח נקי LTM. מתחת ליעד (בבסיס או אחרי התרחיש) בראש, לפי המרווח. כל רכיב נפתח למקורו.</div>
          </Panel>

          <Panel className="scn-out" title="תוצאות לפי חברה" aside={<span>{scnText(scn)}</span>}>
            {phone ? (
              <div className="scn-cards">{ranked.map((r) => (
                <details key={r.id} className="scn-card" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) warm(r.id); }}>
                  <summary><Dot id={r.id} /><b>{r.name}</b>
                    <span className="sm">{r.head?.v != null ? <>מרווח <span className={`num ${r.head.v < 0 ? 'neg' : ''}`}>{fmt(r.head.v, 1)}</span></> : null}{r.cells.roe.d != null ? <> · ROE <span className={`num ${tone(r.cells.roe.d)}`}>{sign(r.cells.roe.d, 1)}</span></> : null}</span></summary>
                  <div className="scn-k">{COLS.map((c) => <div key={c.k}><span className="l">{c.he} <span className="dim">{c.unit}</span></span><Fig r={r} k={c.k} d={c.d} unit={c.unit} phone /></div>)}</div>
                  <Link className="more" to={`/drivers/${r.id}`}>המנגנונים של {r.name}</Link>
                </details>))}</div>
            ) : (
              <div className="scroll"><table className="scn-t">
                <thead><tr><th>חברה</th>{COLS.map((c) => <th key={c.k}>{c.he}<span className="u">{c.unit}</span></th>)}</tr></thead>
                <tbody>{ranked.map((r) => (
                  <tr key={r.id} onPointerEnter={() => warm(r.id)} className={`t${r.tier}`}>
                    <td className="lbl"><span className="co"><Dot id={r.id} /><Link to={`/drivers/${r.id}`}>{r.name}</Link>{r.rowGap.length > 0 && <span className="chip gap" title={r.rowGap.join('\n')}>חסר <span className="num">{r.rowGap.length}</span></span>}</span></td>
                    {COLS.map((c) => <td key={c.k}><Fig r={r} k={c.k} d={c.d} unit={c.unit} /></td>)}
                  </tr>))}</tbody>
              </table></div>
            )}
            <div className="src">הכנסות ורווח תפעולי: מגזרי פנסיה וגמל, LTM {base?.q} + השינוי בקצב שנתי. רווח נקי ו-ROE: הקבוצה, אחרי מס. כושר פירעון, CSM והון: היחס האחרון שהודפס + ההשפעות שגולו (FY'25 ל-IFRS 17; דוח כושר הפירעון האחרון ליחס), בלי פיזור; SCR קבוע. P/B מוצדק = (ROE − g) ÷ (ke − g). "חסר" = קלט בתוקף בלי ערוץ מכויל; "אומדן" = הנחה, הארכה או גילוי ישן. {OUT_KEYS.length} מדדים · {ctx.length} חברות.</div>
          </Panel>

          <div className="src scn-gaps"><b>פערים בגרף המנגנונים</b>{graphGaps(ctx).map((g, i) => <span key={i}>{i ? ' · ' : ': '}{g}</span>)}</div>
        </div>
      </div>
    </div>
  );
}
