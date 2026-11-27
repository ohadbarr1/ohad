import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from './Source';
import { DeeperSheet } from './DeeperSheet';
import { useSheetHost } from '../lib/sheetHost';
import type { Prov } from '../lib/prov';
import { nf } from '../lib/format';
import { BASIS_HE, horizonRows, moneyScale, openYears, policyGroups, sameBasisActual, targetBasis, vsTarget, type ActLike } from '../pages/company/lensLogic';
import { Empty, ErrorBox, Loading, Panel, Seg } from './ui';
import { idCss } from '../lib/identity';
import { pubLabel } from '../lib/format';
import { readerHref } from '../lib/search';
import { TOPIC, ST_HE, actProv, actText, docName, horizon, isPctAct, stmtProv, tv, unitHe, useTargets, type Target, type Targets } from '../lib/targets';
import '../styles/targets.css';

const key = (t: Target) => `${t.c}|${t.m}|${t.e}|${t.h ?? ''}|${t.src}`;
/** one row per target: the latest statement; report targets printed for several dates keep the latest date */
export function latestRows(rows: Target[]): Target[] {
  const m = new Map<string, Target>();
  rows.forEach((t) => { const c = m.get(key(t)); if (!c || t.d > c.d) m.set(key(t), t); });
  return rows.filter((t) => m.get(key(t)) === t);
}

function StatusChip({ t }: { t: Target }) {
  return <span className={`tg-st ${t.st}`} title={t.st === 'open' || t.st === 'policy' ? (t.h ? `היעד ל-${t.h} טרם נמדד` : 'מדיניות מתמשכת') : t.st === 'nc' ? t.why ?? 'לא ניתן להשוואה' : `בפועל FY'${String(t.act?.y).slice(2)} מול היעד`}>{ST_HE[t.st]}</span>;
}
function Actual({ t, name }: { t: Target; name: string }) {
  if (!t.act) return <span className="muted">–</span>;
  return <><Sourced className="num" src={() => actProv(t, name)!}>{actText(t)}</Sourced><small className="muted num tg-y">FY'{String(t.act.y).slice(2)}</small>{t.act.ref ? <small className="muted"> · להשוואה</small> : null}</>;
}
function Said({ d, t }: { d: Targets; t: Target }) {
  const a = t.st0, z = t.st1;
  return <span className="tg-said">{a && a[0] !== z?.[0] && <><span className="num">{pubLabel(a[0])}</span> ← </>}{z && <span className="num">{pubLabel(z[0])}</span>}{t.n > 1 && <small className="muted"> · ×{t.n}</small>}{t.hist && <span className="chip est" title="ערך היעד עודכן בין המצגות">עודכן</span>}
    {z?.[1] != null && <Link className="tg-doc" to={readerHref(z[1], z[2])}>{docName(d, z[1])}{z[2] ? <> · <span className="num">{t.src === 'pres' ? 'שקף' : 'עמ׳'} {z[2]}</span></> : null}</Link>}</span>;
}

/** The targets tracker: every management target, actual vs target where the site carries the actual, status only once the year is reported. */
export function TargetsTracker({ inCo, name, all, setAll, status, setStatus }: { inCo: (id: string) => boolean; name: (id: string) => string; all: boolean; setAll: (v: boolean) => void; status: string; setStatus: (v: string) => void }) {
  const tg = useTargets();
  if (tg.error) return <ErrorBox what="היעדים" error={tg.error} />;
  if (!tg.data) return <Loading what="היעדים" />;
  const d = tg.data;
  const mine = d.rows.filter((t) => inCo(t.c));
  const base = all ? mine : latestRows(mine);
  const shown = base.filter((t) => !status || (status === 'act' ? !!t.act : t.st === status || (status === 'open' && t.st === 'policy')));
  const n = { pres: base.filter((t) => t.src === 'pres').length, act: base.filter((t) => t.act).length, met: base.filter((t) => t.st === 'met').length, missed: base.filter((t) => t.st === 'missed').length };
  return (
    <section className="panel tg">
      <div className="hd"><h2>יעדי הנהלה · מעקב</h2><div className="aside"><Link to="/credibility">אמינות יעדים</Link> · <span><span className="num">{base.length}</span> יעדים · <span className="num">{n.pres}</span> ממצגות · בפועל ל-<span className="num">{n.act}</span></span></div></div>
      <div className="tg-bar">
        <Seg<string> label="סטטוס" value={status} onChange={setStatus} options={[['', 'הכול'], ['act', 'עם בפועל'], ['met', `הושג ${n.met}`], ['missed', `לא הושג ${n.missed}`], ['open', 'פתוח']]} />
        <Seg<string> label="הצהרות" value={all ? '1' : ''} onChange={(v) => setAll(!!v)} options={[['', 'האחרון לכל יעד'], ['1', 'כל התאריכים']]} />
      </div>
      {shown.length === 0 ? <Empty title="אין יעדים בסינון זה" /> : (
        <div className="scroll"><table className="tight tg-t">
          <thead><tr><th>חברה</th><th>יעד</th><th>ישות</th><th>אופק</th><th>יעד</th><th>בפועל</th><th>סטטוס</th><th>הוצהר</th></tr></thead>
          <tbody>{TOPIC.flatMap(([topic, label]) => {
            const ts = shown.filter((t) => t.t === topic);
            if (!ts.length) return [];
            return [<tr key={topic} className="pz-topic"><td colSpan={8}>{label} <span className="num">{ts.length}</span></td></tr>,
              ...ts.map((t, i) => (
                <tr key={`${topic}${i}`}>
                  <td><i className="pdot" style={{ background: idCss(t.c) }} />{name(t.c)}</td>
                  <td className="lbl">{t.l}{t.q && <q>{t.q}</q>}</td>
                  <td>{t.e}</td>
                  <td><span className="num">{horizon(t)}</span></td>
                  <td><Sourced className="num" src={() => stmtProv(d, t, name(t.c))}>{tv(t)}</Sourced>{unitHe(t) && t.u !== 'pct' && <small className="muted"> {unitHe(t)}</small>}</td>
                  <td><Actual t={t} name={name(t.c)} /></td>
                  <td><StatusChip t={t} /></td>
                  <td><Said d={d} t={t} />{t.src === 'pres' && <span className="chip">מצגת</span>}</td>
                </tr>))];
          })}</tbody>
        </table></div>
      )}
      <p className="src">יעד כפי שהודפס, עם הנוסח והשקף · בפועל: מחושב באתר מהדוחות הכספיים (קבוצה) ומיחס כושר הפירעון של חברת הביטוח העיקרית; לפני שנת היעד מוצגת השנה האחרונה שדווחה · הושג/פוספס רק לאחר שנת היעד · מקור: {d.source} · עדכון {pubLabel(d.built)}</p>
    </section>
  );
}

/** Company page: the open targets and the latest statement of each, compact; the tracker has the rest. */
export function TargetsCompact({ id, name }: { id: string; name: string }) {
  const tg = useTargets();
  if (!tg.data) return null;
  const d = tg.data;
  const rows = latestRows(d.rows.filter((t) => t.c === id));
  if (!rows.length) return null;
  const pick = [...rows].sort((a, b) => (a.src === b.src ? 0 : a.src === 'pres' ? -1 : 1) || (b.h ?? 0) - (a.h ?? 0) || (b.st1?.[0] ?? '').localeCompare(a.st1?.[0] ?? '')).slice(0, 8);
  const said = d.status[id]?.at(-1);
  return (
    <Panel title="יעדי הנהלה" aside={<Link to={`/credibility?co=${id}`}>כל היעדים ({rows.length})</Link>}>
      <div className="scroll"><table className="tight tg-t tg-c">
        <thead><tr><th>יעד</th><th>יעד</th><th>בפועל</th><th>סטטוס</th></tr></thead>
        <tbody>{pick.map((t, i) => (
          <tr key={i}><td className="lbl">{t.l}{t.e && t.e !== 'הקבוצה' && <small className="muted"> · {t.e}</small>} <small className="chip">{t.h ? <span className="num">{t.h}</span> : 'מדיניות'}</small></td>
            <td><Sourced className="num" src={() => stmtProv(d, t, name)}>{tv(t)}</Sourced>{t.u === 'm' && <small className="muted"> מ׳ ש"ח</small>}</td>
            <td><Actual t={t} name={name} /></td><td><StatusChip t={t} /></td></tr>))}</tbody>
      </table></div>
      {said && <div className="src">לפי החברה ({pubLabel(said[0])}): {said[1]}</div>}
      <div className="src">כפי שהודפס בדוחות ובמצגות · בפועל: מחושב באתר, כל רכיב מקושר לעמוד</div>
    </Panel>
  );
}

/* ====================================================================================================== */
/* P6-2e, lens יעדים (spec p6 §14.1 G2, §14.4 T-C8; tester round 3 "same basis"): the table first, then the latest statement of each
   standing policy with its history in a sheet. Every figure through Sourced; a solvency threshold meets the ratio on its own basis only. */

const MM = 'מיליוני ש"ח';
/** a target's figure for the table: money in millions, or in billions when the target is that large (AUM 520,000 → 520) */
function shown(t: Target): { text: string; unit: string; div: number } {
  if (t.u !== 'm') return { text: tv(t), unit: unitHe(t) === '%' ? '' : unitHe(t), div: 1 };
  const sc = moneyScale([t.v, t.lo, t.hi]);
  const f = (x: number | null) => (x == null ? null : x / sc.div);
  return { text: tv({ u: 'm', v: f(t.v), lo: f(t.lo), hi: f(t.hi) }), unit: sc.unit, div: sc.div };
}
const stmtSrc = (d: Targets, t: Target, name: string): Prov => { const x = shown(t), p = stmtProv(d, t, name); return x.div === 1 || p.k !== 'report' ? p : { ...p, value: x.text, unit: x.unit }; };
const docOf = (d: Targets, t: Target): string | null => { const x = t.st1?.[1] != null ? d.docs[String(t.st1[1])] : undefined; return x ? d.files + x[4] : null; };
const pdfAt = (url: string | null, pg: number | null | undefined) => (url ? `${url}${pg ? `#page=${pg}` : ''}` : null);
/** "מצגת, עמ׳ 30" / "דוח Q1'26, עמ׳ 12" for a statement, linked to the page in the reader */
function StmtLink({ d, t }: { d: Targets; t: Target }) {
  const z = t.st1;
  if (z?.[1] == null) return null;
  const nm = t.src === 'pres' ? 'מצגת' : docName(d, z[1]);
  return <Link className="p6-tg-doc" to={readerHref(z[1], z[2])}>{nm}{z[2] ? <>, <span className="num">{t.src === 'pres' ? 'שקף' : 'עמ׳'} {z[2]}</span></> : null}</Link>;
}

/** The actual beside one target, on the target's own basis: the figure (linked to its page), its year and where it sits. */
function SameActual({ t, name }: { t: Target; name: string }) {
  const a = t.act;
  const sb = sameBasisActual(t, a as ActLike | undefined);
  if (!a || !sb) return <span className="muted" title="האתר אינו נושא נתון בפועל להשוואה">–</span>;
  const fy = <span className="num">FY'{String(a.y).slice(2)}</span>;
  if (sb.kind === 'missing') return <span className="p6-tg-miss" data-basis={sb.basis}><span className="muted">–</span><small className="muted">{sb.why}</small></span>;
  if (sb.kind === 'asis') {
    const pct = isPctAct(a), sc = !pct && t.u === 'm' ? moneyScale([t.v, t.lo, t.hi]) : { div: 1, unit: MM };
    const txt = pct ? actText(t) : nf(a.v / sc.div, sc.div === 1 ? 0 : 1);
    const src = (): Prov => { const p = actProv(t, name)!; return p.k === 'calc' ? { ...p, value: txt, unit: pct ? '%' : sc.unit } : p; };
    const first = a.in[0];
    return <><Sourced className="num" href={pdfAt(first?.[2] ?? null, first?.[3])} src={src}>{txt}</Sourced><small className="muted p6-tg-vs">{fy} · {vsTarget(pct ? a.v : a.v / sc.div, { ...t, v: t.v != null ? t.v / sc.div : null, lo: t.lo != null ? t.lo / sc.div : null, hi: t.hi != null ? t.hi / sc.div : null })}{a.ref ? ' · להשוואה' : ''}</small></>;
  }
  const inp = sb.input, v = sb.v, txt = `${nf(v, Number.isInteger(v) ? 0 : 1)}%`;
  const basis = sb.kind === 'same' ? BASIS_HE[sb.basis] : 'הבסיס לא צוין ביעד; מוצג הנמוך';
  const src = (): Prov => ({ k: 'report', title: `בפועל מול ${t.l} · ${name} · FY'${String(a.y).slice(2)}`, value: txt, unit: '%', url: inp?.[2] ?? null, pg: inp?.[3] ?? null, period: inp?.[4] ?? `FY'${String(a.y).slice(2)}`,
    doc: 'דוח כושר פירעון כלכלי, חברת הביטוח', srcType: 'דוח כושר פירעון כלכלי (MAYA)',
    note: [`יחס כושר פירעון ${basis}`, sb.kind === 'same' ? 'מושווה לסף על אותו בסיס בלבד' : '', a.prog ? `השנה האחרונה שדווחה; היעד ל-${t.h ?? 'מדיניות'} טרם נמדד` : ''].filter(Boolean).join(' · ') });
  return <><Sourced className="num" href={pdfAt(inp?.[2] ?? null, inp?.[3])} src={src}>{txt}</Sourced><small className="muted p6-tg-vs">{fy} · {vsTarget(v, t)}</small><small className="muted p6-tg-b">{sb.kind === 'same' ? BASIS_HE[sb.basis] : 'בסיס לא צוין · מוצג הנמוך'}</small></>;
}
function StChip({ t }: { t: Target }) {
  return <span className={`tg-st ${t.st} p6-tg-st`}>{ST_HE[t.st]}{t.st === 'open' && t.h ? <> · עד <span className="num">{t.h}</span></> : null}</span>;
}

/** The lens's first block: the targets with a horizon, target / actual / status, one horizon at a time (the nearest open one first). */
export function TargetsTable({ id, name, year: y0 }: { id: string; name: string; year?: number }) {
  const tg = useTargets();
  const now = y0 ?? new Date().getFullYear();
  const [pick, setPick] = useState<number | null>(null);
  if (tg.error) return <ErrorBox what="היעדים" error={tg.error} />;
  if (!tg.data) return <Loading what="היעדים" />;
  const d = tg.data, mine = d.rows.filter((t) => t.c === id);
  const years = openYears(mine, now);
  const yr = pick != null && years.includes(pick) ? pick : years[0];
  const rows = yr != null ? horizonRows(mine, yr) : [];
  return (
    <section className="panel p6-tg" id="targets" aria-labelledby="targets-h">
      <div className="hd"><h2 id="targets-h">יעדי הנהלה{yr != null && <> <span className="num">{yr}</span></>}<span className="muted p6-sub"> · יעד · בפועל · סטטוס · כפי שהודפסו</span></h2>
        {years.length > 1 && <div className="aside"><Seg<string> label="אופק" value={String(yr)} onChange={(v) => setPick(Number(v))} options={years.map((x) => [String(x), String(x)] as [string, string])} /></div>}</div>
      {!rows.length ? <p className="muted">לא נמצאו יעדים פתוחים עם אופק.</p> : (
        <div className="scroll"><table className="tight p6-tg-t" id="targets-table">
          <thead><tr><th scope="col">יעד</th><th scope="col">יעד <span className="num">{yr}</span></th><th scope="col">בפועל<small>שנה מלאה אחרונה</small></th><th scope="col">סטטוס</th></tr></thead>
          <tbody>{rows.map((t) => { const x = shown(t), b = t.t === 'capital' ? targetBasis(t) : null; return (
            <tr key={`${t.m}|${t.e}`} data-m={t.m}>
              <th scope="row" className="lbl">{t.l.replace(/^יעד /, '')}<small className="muted">{t.e}{b && b !== '?' && !/הוראות מעבר/.test(t.l) ? ` · ${BASIS_HE[b]}` : ''} · <StmtLink d={d} t={t} />{t.hist && t.hist.length > 1 ? <> · עודכן <span className="num">{t.hist.length - 1}</span>×</> : null}</small></th>
              <td className="v"><Sourced className="num" href={pdfAt(docOf(d, t), t.st1?.[2])} src={() => stmtSrc(d, t, name)}>{x.text}</Sourced>{x.unit && <small className="muted">{x.unit}</small>}</td>
              <td><SameActual t={t} name={name} /></td>
              <td><StChip t={t} /></td>
            </tr>); })}</tbody>
        </table></div>
      )}
      <p className="src">יעד כפי שהודפס, עם המסמך והעמוד · בפועל: מחושב באתר מנתונים מודפסים, כל רכיב מקושר לעמוד שלו; יחס כושר פירעון מושווה לסף על אותו בסיס בלבד (עם / ללא הוראות מעבר) · היעד פתוח עד סוף שנת האופק; "בפועל" הוא השנה המלאה האחרונה, לא תחזית</p>
    </section>
  );
}

/** "מדיניות וספים": the latest statement of each standing policy (per kind and entity), "היסטוריה N ›" opens the earlier ones in a sheet. */
export function PolicyLatest({ id, name, cap }: { id: string; name: string; /** rows shown before "עוד N ›" (phone) */ cap?: number }) {
  const tg = useTargets();
  const host = useSheetHost();
  const [more, setMore] = useState(false);
  if (!tg.data) return null;
  const d = tg.data, groups = policyGroups(d.rows.filter((t) => t.c === id));
  if (!groups.length) return null;
  const open = host.own?.[0] === 'tgh' ? groups[Number(host.own[1])] : undefined;
  return (
    <section className="panel p6-tg" id="policy" aria-labelledby="policy-h">
      <div className="hd"><h2 id="policy-h">מדיניות וספים<span className="muted p6-sub"> · האחרון מכל סוג</span></h2></div>
      <div className="p6-kvs">{groups.map((g, i) => { const t = g[0], x = shown(t); if (cap && !more && i >= cap) return null; return (
        <div className="p6-kv" key={`${t.m}|${t.e}`} data-pol={t.m}>
          <span className="p6-kv-l">{t.l}<small className="muted">{t.e} · <span className="num">{pubLabel(t.st1?.[0] ?? t.d)}</span> · <StmtLink d={d} t={t} /></small></span>
          <span className="p6-kv-v"><Sourced className="num" href={pdfAt(docOf(d, t), t.st1?.[2])} src={() => stmtSrc(d, t, name)}>{x.text}</Sourced>{x.unit && <small className="muted"> {x.unit}</small>}
            {g.length > 1 && <button type="button" className="chip p6-hist" onClick={() => host.openSheet(`tgh:${i}`)} aria-haspopup="dialog">היסטוריה <span className="num">{g.length}</span> ›</button>}</span>
        </div>); })}</div>
      {cap && !more && groups.length > cap && <button type="button" className="chip p6-more" onClick={() => setMore(true)}>עוד <span className="num">{groups.length - cap}</span> ›</button>}
      <DeeperSheet open={!!open} onClose={host.closeSheet} id="sheet-tg-hist" title={open ? open[0].l : ''} sub={open ? `${open[0].e} · ${name} · כל ההצהרות, מהחדשה לישנה` : undefined}>
        {open && <div className="p6-kvs">{open.map((t, j) => { const x = shown(t); return (
          <div className="p6-kv" key={j}>
            <span className="p6-kv-l"><span className="num">{pubLabel(t.st1?.[0] ?? t.d)}</span>{j === 0 && <span className="chip">האחרון</span>}<small className="muted">{t.src === 'pres' ? 'מצגת' : 'דוח'} · <StmtLink d={d} t={t} />{t.n > 1 ? <> · הוצג <span className="num">{t.n}</span> פעמים</> : null}</small></span>
            <span className="p6-kv-v"><Sourced className="num" href={pdfAt(docOf(d, t), t.st1?.[2])} src={() => stmtSrc(d, t, name)}>{x.text}</Sourced>{x.unit && <small className="muted"> {x.unit}</small>}</span>
          </div>); })}</div>}
      </DeeperSheet>
    </section>
  );
}
