import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CompareGrid, type CompareGridRow } from '../../components/CompareGrid';
import { Sourced } from '../../components/Source';
import { ClientSave } from '../../components/agent/ClientSave';
import { ErrorBox, Loading } from '../../components/ui';
import { catKey, refOf, ym, type FundX } from '../../lib/funds';
import { fundP } from '../../lib/market';
import { isOldGen, svcCell } from '../../lib/decision';
import { isPension } from '../../lib/pensionPack';
import { RETIRE_AGE } from '../../lib/retire';
import { tieBand } from '../../lib/fundsTie';
import { actProv } from '../../lib/agentProv';
import { bottomLines, docRow, dmyIso, snapOf } from '../../lib/compareDoc';
import { folderOfState, useClients } from '../../lib/clients';
import { today as todayIso } from '../../lib/visits';
import { useCompareData, useKpiRows, exportPack, type CompareData, type KCell, type KpiRows } from './panels';
import { trackColor, trackLabels } from './tracks';
import { Stamp } from './CompareMonths';
import { billions, groupLead, lastAct, signed, type Better } from './decisionLead';
import type { CmpCtx } from './contract';
import '../../styles/compare-decision.css';

/* Track compare, the "להחלטה" lens (lane L3-a, ticket D2; spec v3 §4.0b rows 1–2, §8 agent door, §10A.2 D2/D3; mockup v3 frame 26).
   - Agent door: the fifth tab "להחלטה". Pro door: the fifth tab "מקצועי" opens here, with the switch "להחלטה | סיכון" at the lens head
     (the risk side is ./CompareRisk, lane L3-b; the shell maps v=dec / v=risk). The saver door never reaches this lens (the shell's viewOf).
   - Lens head: the pill "תצוגה פשוטה: חוסך ›" switches the door to saver and keeps the tracks (the shell's setDoor also drops v=, so the
     month table comes back).
   - One <CompareGrid> of the decision rows: both fees, 5Y, LTM, equity share, Sharpe, assets, service index, then for pension funds the
     actuarial balance, disability claims approved, default fund, and the pension estimate for a man and a woman (approved O10: agent and
     Pro only). Every figure is the one the page computed before the redesign (./panels useKpiRows: lib/decision, lib/pensionPack,
     lib/coef, lib/agentProv) and opens its source (Sourced). A row's lead is marked only inside one category (./decisionLead).
   - Pinned under the grid: "מסמך ללקוח" (→ /funds/compare/print, FundsComparePrint unchanged) and "שמירה לתיק לקוח" (the client folder,
     with the same snapshot the old ClientActions froze); the Excel pack and the open folder sit in a quiet line under them. */

/** the lens head shared with "סיכון": Pro's two-way switch and the way back to the simple view */
export function LensHead({ door, view, setView, setDoor }: CmpCtx) {
  const pro = door === 'pro', on = view === 'risk' ? 'risk' : 'dec';
  return (
    <div className="cmp-lhead">
      {pro ? (
        <div className="cmp-lsw" id="lens-switch" role="tablist" aria-label="מקצועי">
          {([['dec', 'להחלטה'], ['risk', 'סיכון']] as const).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={on === v} className={on === v ? 'on' : undefined} onClick={() => setView?.(v)}>{l}</button>
          ))}
        </div>
      ) : <span />}
      <button type="button" className="cmp-hintp" id="simple-hint" onClick={() => setDoor?.('saver')}>תצוגה פשוטה: חוסך ›</button>
    </div>
  );
}

export function CompareDecision(props: CmpCtx) {
  const d = useCompareData(props.keys, props.basis);
  return (
    <div className="cmp-body cmp-dec" id="lens-dec">
      <LensHead {...props} />
      {!d ? <Loading what="נתוני ההחלטה" /> : 'error' in d ? <ErrorBox what="נתוני הקופות" error={d.error} /> : <DecisionBody ctx={props} d={d} />}
    </div>
  );
}

/** a cell of the grid: the figure (opens its source) and, under it, a small line */
function Fig({ c, text, sub, tone }: { c: KCell | null; text?: string; sub?: ReactNode; tone?: boolean }) {
  if (!c) return <span className="muted">…</span>;
  const t = text ?? c.t;
  const cls = ['num', tone && c.v != null ? (c.v > 0 ? 'pos' : c.v < 0 ? 'neg' : '') : ''].filter(Boolean).join(' ');
  // the source button is the cell's 44×32 tap box (compare-decision.css); the lead's soft pill sits on the figure inside it (.fig)
  const fig = c.src && (c.v != null || c.txt) ? <Sourced src={c.src} className={cls}><span className="fig">{t}</span></Sourced> : <span className={t === '–' || t === '…' ? 'muted' : cls}>{t}</span>;
  return <>{fig}{sub ? <small>{sub}</small> : null}</>;
}
/** "a · b" → [a, b] (the old KPI cells pack a figure and its period in one string) */
const split2 = (t: string): [string, string | undefined] => { const i = t.indexOf(' · '); return i < 0 ? [t, undefined] : [t.slice(0, i), t.slice(i + 3)]; };
const wait = <span className="muted">…</span>;

function DecisionBody({ ctx, d }: { ctx: CmpCtx; d: CompareData }) {
  const { keys, openSheet } = ctx;
  const kp = useKpiRows(d, ctx.door === 'pro' ? 'pro' : 'agent');
  const funds: (FundX | null)[] = keys.map((k) => d.fundOf(k) ?? null);
  const items = keys.map((k) => d.items.find((it) => it.f.k === k) ?? null);
  const at = (k: string) => keys.indexOf(k);
  const labels = trackLabels(funds);
  const cols = keys.map((k, i) => ({ k, label: labels[i] || k, color: trackColor(i) }));
  // a row's lead only inside one category; old-generation policies and missing tracks are never marked
  const groups = funds.map((f) => (f && !isOldGen(f) ? catKey(f) : null));
  const cross = new Set(groups.filter(Boolean)).size > 1;
  const kc = (row: string, k: string): KCell | null => { const it = items[at(k)]; const r = kp.row(row); return it && r ? r.cells(it) : null; };
  const led = (row: string, better: Better, band = 0) => groupLead(keys.map((k) => kc(row, k)?.v ?? null), groups, better, band);
  const mk = (key: string, label: ReactNode, cell: (k: string) => ReactNode, lead?: boolean[], sub?: ReactNode): CompareGridRow =>
    ({ key, label, sub, cell, ...(lead ? { value: (k: string) => (lead[at(k)] ? 1 : 0), better: 'hi' as const, band: 0.5 } : {}) });

  const asof = d.asof;
  const svc = keys.map((k) => { const f = d.fundOf(k); return f ? svcCell(kp.dec, f) : null; });
  const anySvc = svc.some((c) => c && c.v != null);
  const pension = kp.anyPension, allPension = funds.every((f) => !f || isPension(f));
  const assetsSrc = (f: FundX) => () => fundP(refOf(f), f.end ?? asof, 'TOTAL_ASSETS', 'נכסים', billions(f.assets), 'מיליארדי ש"ח');
  const coefSub = (c: KCell | null) => (c?.sub ? split2(c.sub)[0] : undefined);
  const pair = (row: string) => (k: string) => { const c = kc(row, k); if (!c) return wait; const [a, b] = split2(c.t); return <Fig c={c} text={a} sub={b} />; };
  // the actuarial balance: funds.json when it carries one, else the last quarter in the track's own history (funds/<k>.json `act`),
  // at most two quarters old; sourced as before (lib/agentProv actProv, the reported quarter)
  const loaded = items.every(Boolean);
  const act = keys.map((k): KCell | null => {
    const it = items[at(k)];
    if (!it) return null;
    if (!isPension(it.f)) return { v: null, t: '–' };
    const x = it.f.act != null && it.f.act_p != null ? { v: it.f.act, p: it.f.act_p } : lastAct(it.h.p, it.h.act, asof);
    return x ? { v: x.v, t: signed(x.v, 2), sub: ym(x.p), src: () => actProv({ ...it.f, act: x.v, act_p: x.p }), txt: true } : { v: null, t: 'לא דווח' };
  });
  // a row with no value for any track on screen is not drawn as a row of "לא דווח"/"לא פורסם": one quiet line under the grid instead
  const none = (cs: (KCell | null)[]) => loaded && cs.every((c) => !c || c.v == null);
  const actNone = none(act), clmNone = none(keys.map((k) => kc('clm', k)));

  const rows: CompareGridRow[] = [
    mk('fee', 'דמי ניהול מצבירה', (k) => <Fig c={kc('fee', k)} />, led('fee', 'lo')),
    mk('depfee', 'דמי ניהול מהפקדה', (k) => <Fig c={kc('depfee', k)} />, led('depfee', 'lo')),
    mk('a5', 'תשואה 5Y, שנתי', (k) => { const c = kc('a5', k); return <Fig c={c} text={signed(c?.v, 1)} tone />; }, led('a5', 'hi', tieBand('a5', asof))),
    mk('y12', 'תשואה LTM', (k) => { const c = kc('y12', k); return <Fig c={c} text={signed(c?.v, 1)} tone />; }, led('y12', 'hi', tieBand('y12', asof))),
    mk('st', 'חשיפה למניות', (k) => <Fig c={kc('st', k)} />),
    mk('sharpe', 'שארפ (כפי שפורסם)', (k) => <Fig c={kc('sharpe', k)} />, led('sharpe', 'hi')),
    mk('assets', 'נכסים, מיליארדי ש״ח', (k) => { const f = d.fundOf(k); return f ? <Fig c={{ v: f.assets, t: billions(f.assets), src: assetsSrc(f) }} /> : wait; }),
    ...(anySvc ? [mk('svc', 'מדד השירות 2025', (k) => { const c = svc[at(k)]; if (!c) return wait; const [a, b] = split2(c.t); return <Fig c={c} text={a} sub={b} />; })] : []),
    ...(pension ? [
      ...(actNone ? [] : [mk('act', 'איזון אקטוארי, רבעון אחרון', (k) => { const c = act[at(k)]; return c ? <Fig c={c} sub={c.sub} /> : wait; })]),
      ...(clmNone ? [] : [mk('clm', 'תביעות נכות שאושרו, 2025', (k) => { const c = kc('clm', k); if (!c) return wait; const m = /^(.*?) \((.*)\)$/.exec(c.t); return <Fig c={c} text={m ? m[1] : c.t} sub={m ? m[2] : undefined} />; })]),
      mk('dflt', 'קרן ברירת מחדל', pair('dflt')),
      mk('annM', `קצבה בגיל ${RETIRE_AGE}, גבר`, (k) => { const c = kc('annM', k); return <Fig c={c} sub={coefSub(c)} />; }, undefined, 'אומדן, לחודש'),
      mk('annF', `קצבה בגיל ${RETIRE_AGE}, אישה`, (k) => { const c = kc('annF', k); return <Fig c={c} sub={coefSub(c)} />; }, undefined, 'אומדן, לחודש'),
    ] : []),
  ];

  const wide = keys.length > 4;
  return (
    <>
      <div className="cmp-dec-card">
        <div className={`cmp-dec-scroll${wide ? ' wide' : ''}`} style={{ '--n': keys.length } as CSSProperties}>
          <CompareGrid id="dec-grid" cols={cols} rows={rows} onCol={(k) => openSheet({ t: 'track', k })} className="cmp-dec-grid" />
        </div>
        {pension && (actNone || clmNone) && (
          <p className="cmp-dec-gap" id="dec-gap">
            {actNone && <span>איזון אקטוארי: לא פורסם לחודש הזה</span>}
            {clmNone && <span>תביעות נכות שאושרו: לא פורסם</span>}
          </p>
        )}
        <p className="cmp-dec-note">
          מסומן: הנמוך (דמי ניהול) או הגבוה (תשואה, שארפ) בשורה, רק בין מסלולים מאותה קטגוריה{cross ? '; כאן יש מסלולים מקטגוריות שונות, והסימון הוא בתוך כל קטגוריה בלבד' : ''}.
          {' '}תשואות: {d.lbl}, עד {ym(asof)}. דמי ניהול: ממוצע בפועל של המסלול, לא של חוסך מסוים.
          {pension ? ` קצבה: אומדן בגיל ${RETIRE_AGE} על הנחות אחידות לכל המסלולים, עם דמי הניהול של המסלול, ÷ מקדם ההמרה של הקרן; בשקלי היום, לא תחזית.` : ''}
          {pension && !allPension ? ' איזון אקטוארי, נכות, ברירת מחדל וקצבה: לקרנות פנסיה בלבד.' : ''}
          {' '}כל מספר נפתח למקור שלו.
        </p>
      </div>
      <DecisionActions d={d} kp={kp} />
      <Stamp asof={asof} onWhy={() => openSheet({ t: 'why' })} />
    </>
  );
}

/** "מסמך ללקוח" and "שמירה לתיק לקוח", pinned above the phone's bottom bar while the grid scrolls; the Excel pack and the folder under them */
function DecisionActions({ d, kp }: { d: CompareData; kp: KpiRows }) {
  const loc = useLocation();
  const [clients] = useClients();
  const [folderId, setFolderId] = useState<string | null>(() => folderOfState(loc.state));
  const folder = folderId ? clients.folders.find((f) => f.id === folderId) ?? null : null;
  const { items, keys, asof, basis, real } = d;
  const printHref = `/funds/compare/print?k=${keys.join(',')}${real ? '&real=1' : ''}`;
  // the figures a client folder freezes: the client document's rows, from the histories on this page (as the old ClientActions did)
  const snapNow = () => { const rows = items.map((it) => docRow(it.f, { asof, hist: it.h, dfile: kp.dfile, dec: kp.dec })); return snapOf(rows, bottomLines(rows), todayIso(), asof); };
  // pinned: the bar sticks above the site's phone rail (fixed at the bottom on phones; a side rail on desktop)
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bar.current, rail = document.querySelector<HTMLElement>('.rail');
    if (!el) return;
    // the page reserves what the bar and the rail cover at the bottom (scroll-padding: a row scrolled into view lands above the bar)
    const set = () => { const fixed = !!rail && getComputedStyle(rail).position === 'fixed', rb = fixed ? Math.round(rail!.getBoundingClientRect().height) : 0;
      el.style.setProperty('--abar-b', `${rb}px`); document.documentElement.style.setProperty('--abar-h', `${rb + Math.round(el.getBoundingClientRect().height)}px`); };
    set();
    const ro = new ResizeObserver(set); if (rail) ro.observe(rail); ro.observe(el);
    window.addEventListener('resize', set);
    return () => { ro.disconnect(); window.removeEventListener('resize', set); document.documentElement.style.removeProperty('--abar-h'); };
  }, []);
  return (
    <>
      <div className="cmp-abar" ref={bar} id="dec-actions">
        <Link className="cmp-abtn pri" id="dec-doc" to={printHref} state={folder ? { folder: folder.id } : undefined}>{folder?.snap ? 'מסמך ללקוח (הצילום)' : 'מסמך ללקוח'}</Link>
        <ClientSave keys={keys} b={basis} folder={folder} onSaved={(f) => setFolderId(f.id)} busy={items.length < keys.length - d.unknown.length} collect={() => ({ snap: snapNow() })} label="שמירה לתיק לקוח" />
      </div>
      <div className="cmp-dec-more">
        {folder && <span>תיק: <b>{folder.label}</b>{folder.snap && <span className="muted"> · צילום מ-{dmyIso(folder.snap.at)}, נתונים עד {ym(folder.snap.asof)}. כאן: נתוני היום</span>}</span>}
        <button type="button" className="cmp-linkbtn" onClick={() => void exportPack(d)}>Excel: חבילת השוואה ›</button>
        <span className="muted">מסמך A4 עם נספח הנמקה; שם הלקוח והסוכן נשארים בדפדפן הזה.</span>
      </div>
    </>
  );
}
