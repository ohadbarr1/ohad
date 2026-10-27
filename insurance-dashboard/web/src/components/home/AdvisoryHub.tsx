import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../Icon';
import { Sourced } from '../Source';
import { load, useRegistry } from '../../lib/useData';
import { idCss } from '../../lib/identity';
import { nf } from '../../lib/format';
import { ltsProv, warmRep } from '../../lib/lens';
import type { Prov } from '../../lib/prov';
import { driversPath, fmt, type DriverFile, type LtsResolver } from '../../lib/drivers';
import { makeCtx, presets, rank, runAll, scnText, writeScn, type Res } from '../../lib/scenarios';
import { SEG_HE, UNIT_OF, headline as sigHeadline, type Row as FragRow } from '../../lib/fragility';
import { fprov, useFragility, warmProv } from '../../lib/fragilityLoad';
import { usePositions } from '../../lib/positions';
import '../../styles/fragility.css';
import '../../styles/hub.css';

/* The advisory hub at the top of the home page: today's scenario (A2's "מפולת מניות" preset through the scenario library, the first three
   companies of the vulnerability ranking in one sentence), the Fragility Monitor's alerts (A10), the position book's status (A6), the war
   room, and the row of links down to the evidence. Every figure opens its source. No score: the ranking is A2's, shown as its own numbers. */

const lts: LtsResolver = (j) => ltsProv(j.c, j.metric, j.period, j.title, j.unit, j.note, j.value);
const PRESET = 'eqdd';
const NO_NC = new Map();
const calc = (title: string, value: string, formula: string, inputs: { label: string; v: string; src?: () => Prov }[], note?: string): Prov => ({ k: 'calc', title, value, formula, inputs, note });
/** every managing company whose printed components a file cites (its provenance file is warmed so the sheet opens complete) */
function ltsCos(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((y) => ltsCos(y, out));
  else if (x && typeof x === 'object') { const o = x as Record<string, unknown>; if (o.k === 'lts' && typeof o.c === 'string') out.add(o.c); else Object.values(o).forEach((y) => ltsCos(y, out)); }
  return out;
}

/** all driver files, fetched once the page has painted (the company table comes first) */
function useDriverFiles(ids: string[] | null) {
  const [files, set] = useState<Map<string, DriverFile> | null>(null);
  const [error, setError] = useState(false);
  const key = ids?.join(',') ?? '';
  useEffect(() => {
    if (!ids) return;
    let live = true;
    const go = () => Promise.all(ids.map((id) => load<DriverFile>(driversPath(id)).then((f) => [id, f] as const)))
      .then((xs) => live && set(new Map(xs)), () => live && setError(true));
    const ric = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const h = ric ? ric(() => void go(), { timeout: 600 }) : window.setTimeout(() => void go(), 50);
    return () => { live = false; if (!ric) clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { files, error };
}

/** one company of the headline, the way scenarios.ts headline() words it, with its figure opening the propagation path */
function Frag({ r }: { r: Res }) {
  const h = r.head, roe = r.cells.roe;
  const who = <><i className="hub-dot" style={{ background: idCss(r.id) }} aria-hidden="true" />{r.name}</>;
  if (h && r.below0) return <>{who} <Sourced src={h.prov}>מתחת ליעד הדירקטוריון כבר בבסיס</Sourced></>;
  if (h && r.breach) return <>{who} <Sourced src={h.prov}>חוצה את יעד הדירקטוריון</Sourced></>;
  if (r.driver === 'cap' && r.capUse != null && h?.v != null) return <>{who} שוחקת <Sourced src={r.capProv}>{`${fmt(r.capUse, 0)}%`}</Sourced> מהמרווח ליעד</>;
  if (roe.d != null && roe.d < 0) return <>{who} מאבדת <Sourced src={() => roe.o.prov}>{`${fmt(Math.abs(roe.d), 1)} נ״א`}</Sourced> ROE</>;
  return <>{who} מאבדת <Sourced src={r.earnProv}>{`${fmt(r.earnUse ?? 0, 0)}%`}</Sourced> מהרווח</>;
}

function ScenarioCell() {
  const reg = useRegistry();
  const ids = useMemo(() => reg.data?.map((c) => c.id) ?? null, [reg.data]);
  const D = useDriverFiles(ids);
  const out = useMemo(() => {
    if (!D.files || !reg.data) return null;
    const ctx = reg.data.filter((c) => D.files!.has(c.id)).map((c) => makeCtx(c.id, c.name_he, D.files!.get(c.id)!, NO_NC, lts));
    const p = presets(null, null, null, null, ctx[0]?.f.meta.base?.end ?? '2026-06-30').find((x) => x.id === PRESET)!;
    const ranked = rank(runAll(ctx, p.sc, { eq: 0, y10: 0 }, 'clamp', lts), 'vul');
    // the same selection as scenarios.ts headline(): companies already below target lead only when the scenario moves them
    const moves = (r: Res) => (r.head?.d ?? 0) !== 0 || Math.abs(r.earnUse ?? 0) >= 0.5;
    const hit = ranked.filter((r) => (r.tier === 0 && (r.breach || moves(r))) || (r.tier === 1 && r.vul != null && r.vul >= 0.5)).slice(0, 3);
    const still = ranked.filter((r) => r.below0 && !hit.includes(r));
    return { p, hit, still, n: ctx.length, files: D.files };
  }, [D.files, reg.data]);
  useEffect(() => { if (out) out.hit.forEach((r) => ltsCos(out.files.get(r.id)).forEach((c) => warmRep(c))); }, [out]);
  const to = out ? `/scenarios?${writeScn(new URLSearchParams(), out.p.sc).toString()}` : '/scenarios';
  return (
    <Cell cls="hub-scn" icon="scenarios" title={<>תרחיש היום{out && <span className="muted"> · {out.p.he}</span>}</>} to={to} more="לחדר התרחישים">
      {D.error ? <p className="muted">קובצי המנגנונים לא נטענו</p> : !out ? <p className="muted hub-wait" aria-busy="true">טוען תרחיש…</p> : <>
        <p className="hub-line">{out.hit.length === 0
          ? <>אף חברה לא מאבדת חצי אחוז מהכרית{out.still.length > 0 && <>; {out.still.map((r) => r.name).join(', ')} מתחת ליעד כבר בבסיס</>}</>
          : <>{out.hit.map((r, i) => <span key={r.id} className="hub-frag">{i > 0 && ', '}<Frag r={r} /></span>)}{out.still.length > 0 && <>; {out.still.map((r) => `${r.name} מתחת ליעד כבר בבסיס`).join(', ')}</>}</>}</p>
        <p className="hub-sub"><Sourced src={() => out.p.prov}>{scnText(out.p.sc)}</Sourced> · <span className="nowrap"><span className="num">{out.n}</span> חברות</span>, מדורגות לפי שחיקת הכרית
          {out.p.gaps.length > 0 && <span className="chip gap" title={out.p.gaps.join('\n')}>חסר ערוץ</span>}</p>
      </>}
    </Cell>
  );
}

function FragilityCell() {
  const { data: F, error } = useFragility();
  const v = useMemo(() => {
    if (!F) return null;
    const nA = (r: FragRow) => r.flags.filter((f) => f.st === 'alert').length;
    const alert = F.rows.filter((r) => nA(r) > 0), watch = F.rows.filter((r) => r.flags.length > 0 && nA(r) === 0);
    const top = [...F.rows].filter((r) => r.flags.length).sort((a, b) => nA(b) - nA(a) || b.flags.length - a.flags.length || a.name.localeCompare(b.name, 'he')).slice(0, 3);
    return { alert, watch, top };
  }, [F]);
  useEffect(() => { if (F && v) v.top.forEach((r) => { const f = r.flags[0], c = r.sig[f.sig]; warmProv(c.seg ? c.segs[c.seg]?.prov : null); }); }, [F, v]);
  const list = (rows: FragRow[]) => rows.map((r) => ({ label: r.name, v: r.flags.map((f) => `${F!.sigs.find((s) => s.id === f.sig)?.short ?? f.sig} (${f.st === 'alert' ? 'התראה' : 'מעקב'})`).join(', ') }));
  return (
    <Cell cls="hub-frg" icon="shield" title="מוניטור שבריריות" to="/fragility" more="כל המנהלים">
      {error ? <p className="muted">הקובץ לא נטען</p> : !F || !v ? <p className="muted hub-wait" aria-busy="true">טוען אותות…</p> : <>
        <p className="hub-sum">
          <span className="fr-st st-alert sm"><i aria-hidden="true" /><Sourced src={() => calc('מוניטור שבריריות · מנהלים בהתראה', nf(v.alert.length, 0), 'מנהלים שלפחות אות אחד שלהם בהתראה, בספי ברירת המחדל (הנחות)', list(v.alert), `נתוני הרשות ${F.asof.reg} · דוחות ${F.asof.lens}`)}>{nf(v.alert.length, 0)}</Sourced> בהתראה</span>
          <span className="fr-st st-watch sm"><i aria-hidden="true" /><Sourced src={() => calc('מוניטור שבריריות · מנהלים במעקב בלבד', nf(v.watch.length, 0), 'מנהלים עם אות במעקב ובלי אף אות בהתראה, בספי ברירת המחדל (הנחות)', list(v.watch), `נתוני הרשות ${F.asof.reg} · דוחות ${F.asof.lens}`)}>{nf(v.watch.length, 0)}</Sourced> במעקב בלבד</span>
          <span className="dim">מתוך <span className="num">{F.rows.length}</span> · אין ציון מצרפי</span>
        </p>
        {v.top.length > 0 && <ul className="hub-list">{v.top.map((r) => {
          const f = r.flags[0], c = r.sig[f.sig], x = c.seg ? c.segs[c.seg] : undefined, d = F.sigs.find((s) => s.id === f.sig);
          return <li key={r.c}>
            <Link className="hub-who" to={`/fragility?c=${r.c}&s=${f.sig}`}><i className="hub-dot" style={{ background: idCss(r.c) }} aria-hidden="true" />{r.name}</Link>
            <span className={`fr-st st-${f.st} sm`}><i aria-hidden="true" />{d?.short ?? f.sig}{c.seg && SEG_HE[c.seg] ? ` · ${SEG_HE[c.seg]}` : ''}</span>
            {x?.prov && x.v != null ? <span className="hub-v"><Sourced src={() => fprov(x.prov!)}>{sigHeadline(f.sig, x)}</Sourced><small>{[UNIT_OF[f.sig] === '%' ? '' : UNIT_OF[f.sig], x.asof].filter(Boolean).join(' · ')}</small></span> : <span />}
            <span className="dim hub-more-n">{r.flags.length > 1 && <>ועוד <span className="num">{r.flags.length - 1}</span></>}</span>
          </li>;
        })}</ul>}
      </>}
    </Cell>
  );
}

function BookCell() {
  const { data: F, error } = usePositions();
  const h = F?.hit;
  const rule = F?.rules.hit ?? 'אושרו ÷ (אושרו + הופרכו)';
  return (
    <Cell cls="hub-book" icon="positions" title="ספר העמדות" to="/positions" more="לספר">
      {error ? <p className="muted">הקובץ לא נטען</p> : !F || !h ? <p className="muted hub-wait" aria-busy="true">טוען עמדות…</p> : <>
        <dl className="hub-kv">
          <div><dt>פתוחות</dt><dd><Sourced src={() => calc('ספר העמדות · פתוחות', nf(h.open, 0), 'עמדות שפורסמו ועדיין לא נסגרו', F.positions.filter((p) => p.outcome.st === 'open').map((p) => ({ label: p.claim, v: p.horizon })), `נכון ל-${F.asof.kpi}`)}>{nf(h.open, 0)}</Sourced></dd></div>
          <div><dt>סגורות</dt><dd><Sourced src={() => calc('ספר העמדות · סגורות', nf(h.n, 0), 'אושרו + הופרכו + פג תוקף + נמשכו', [{ label: 'אושרו', v: nf(h.confirmed, 0) }, { label: 'הופרכו', v: nf(h.falsified, 0) }, { label: 'פג תוקף', v: nf(h.expired, 0) }, { label: 'נמשכו', v: nf(h.withdrawn, 0) }])}>{nf(h.n, 0)}</Sourced></dd></div>
          <div><dt>שיעור פגיעה</dt><dd>{h.hit == null ? <span className="muted" title={`${rule} · אין עדיין עמדה שאושרה או הופרכה`}>–</span> : <Sourced src={() => calc('ספר העמדות · שיעור פגיעה', `${nf(h.hit!, 0)}%`, rule, [{ label: 'אושרו', v: nf(h.confirmed, 0) }, { label: 'הופרכו', v: nf(h.falsified, 0) }])}>{`${nf(h.hit, 0)}%`}</Sourced>}</dd></div>
        </dl>
        <p className="hub-sub">n = <span className="num">{h.confirmed + h.falsified}</span> · {h.open + h.n === 0 ? 'טרם פורסמו עמדות' : 'הסגירה היא רישום של הכותב, לא אוטומטית'}</p>
      </>}
    </Cell>
  );
}

function WarCell() {
  return (
    <Cell cls="hub-war" icon="warroom" title="חדר מלחמה" to="/warroom" more="לחדר המלחמה">
      <ul className="hub-go">
        <li><Link to="/warroom">מהלך דמי ניהול</Link></li>
        <li><Link to="/warroom/regulation">צנרת רגולציה</Link></li>
        <li><Link to="/capital">הון ואפשרויות הקצאה</Link></li>
        <li><Link to="/consolidation">מסך האיחודים</Link></li>
      </ul>
    </Cell>
  );
}

function Cell({ cls, icon, title, to, more, children }: { cls: string; icon: string; title: ReactNode; to: string; more: string; children: ReactNode }) {
  return (
    <section className={`hub-cell ${cls}`}>
      <div className="hub-hd"><h2><Link className="hub-t" to={to}><span className="icotile sm"><Icon name={icon} /></span>{title}</Link></h2><Link className="hub-more" to={to}>{more}</Link></div>
      {children}
    </section>
  );
}

const EVIDENCE: [string, string][] = [['/savings', 'חיסכון ארוך טווח'], ['/industry', 'השוואה ענפית'], ['/valuation', 'שווי'], ['/capital', 'הון'], ['/consolidation', 'מסך האיחודים'], ['/drivers', 'מנגנונים'], ['/feed', 'מה השתנה']];

export function AdvisoryHub() {
  return (
    <div className="hub" role="region" aria-label="מרכז ההחלטות">
      <div className="hub-grid">
        <ScenarioCell />
        <FragilityCell />
        <BookCell />
        <WarCell />
      </div>
      <nav className="hub-ev" aria-label="ראיות"><span className="l">ראיות</span>{EVIDENCE.map(([to, l]) => <Link key={to} to={to}>{l}</Link>)}</nav>
    </div>
  );
}
