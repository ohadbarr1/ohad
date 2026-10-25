import { Link } from 'react-router-dom';
import { Sourced } from './Source';
import { Empty, ErrorBox, Loading, Panel, Seg } from './ui';
import { idCss } from '../lib/identity';
import { pubLabel } from '../lib/format';
import { readerHref } from '../lib/search';
import { TOPIC, ST_HE, actProv, actText, docName, horizon, stmtProv, tv, unitHe, useTargets, type Target, type Targets } from '../lib/targets';
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
      <div className="hd"><h2>יעדי הנהלה · מעקב</h2><div className="aside"><span><span className="num">{base.length}</span> יעדים · <span className="num">{n.pres}</span> ממצגות · בפועל ל-<span className="num">{n.act}</span></span></div></div>
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
    <Panel title="יעדי הנהלה" aside={<Link to={`/presentations?co=${id}#targets`}>כל היעדים ({rows.length})</Link>}>
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
