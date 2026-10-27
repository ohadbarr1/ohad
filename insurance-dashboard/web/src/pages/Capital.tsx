import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading, Panel } from '../components/ui';
import { BufferInput, OptionTable, StressTable, lts, useBufferParam, useCapitalBase } from '../components/CapitalPanel';
import { load } from '../lib/useData';
import { idCss } from '../lib/identity';
import { driversPath, fmt, fmtS, type DriverFile } from '../lib/drivers';
import { BASIS_HE, bindingOf, cprov, distAt, isOk, optionsAt, stressOf, worstOf, type CapOk, type Rows, type Stressed } from '../lib/capital';
import '../styles/scenarios.css';
import '../styles/capital.css';

/* A7 · /capital: every insurer's distributable capital, ranked by how much of it (as a share of SCR) survives an A2 preset (default: each
   insurer's own worst computed preset). Not a navigation item: linked from /scenarios, the company panels and search. */

const sign = (v: number | null | undefined, d = 1) => (v == null ? '–' : `⁦${fmtS(v, d)}⁩`);
const signP = (v: number | null | undefined, d = 1) => (v == null ? '–' : `⁦${fmtS(v, d)}%⁩`);
const amt = (v: number | null | undefined) => (v == null ? '–' : `⁦${fmt(v, 0)}⁩`);
const WORST = 'worst';

function useDrivers(ids: string[]) {
  const [m, set] = useState<Map<string, DriverFile> | null>(null);
  const key = ids.join(',');
  useEffect(() => {
    if (!ids.length) return;
    let live = true;
    Promise.all(ids.map((id) => load<DriverFile>(driversPath(id)).then((f) => [id, f] as const))).then((xs) => live && set(new Map(xs)), () => live && set(new Map()));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return m;
}

interface Line { c: CapOk; R: Rows; St: Stressed[]; pick: Stressed | null; incomplete: string[] }

export function Capital() {
  const B = useCapitalBase();
  const cos = useMemo(() => (B.file?.companies ?? []).filter(isOk), [B.file]);
  const D = useDrivers(cos.map((c) => c.id));
  const [pp, setPp] = useBufferParam();
  const [sp, setSp] = useSearchParams();
  const pid = sp.get('s') ?? WORST;
  const setPid = (v: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (v === WORST) n.delete('s'); else n.set('s', v); return n; }, { replace: true });
  const [open, setOpen] = useState<string | null>(null);

  const lines = useMemo<Line[]>(() => {
    if (!D || !B.P.length) return [];
    return cos.filter((c) => D.has(c.id)).map((c) => {
      const R = optionsAt(c, pp), St = stressOf(c, D.get(c.id)!, B.P, B.NCm, B.ncAt, lts, R.pp);
      const solvP = St.filter((s) => s.preset.sc.y10 || s.preset.sc.eq);
      const incomplete = solvP.filter((s) => s.v == null).map((s) => s.he);
      const pick = pid === WORST ? (incomplete.length ? null : worstOf(St)) : St.find((s) => s.id === pid) ?? null;
      return { c, R, St, pick, incomplete };
    });
  }, [cos, D, B.P, B.NCm, B.ncAt, pp, pid]);
  const ranked = useMemo(() => [...lines].sort((a, b) => {
    const x = a.pick?.pctScr ?? null, y = b.pick?.pctScr ?? null;
    return (x == null ? 1 : 0) - (y == null ? 1 : 0) || (y ?? 0) - (x ?? 0) || a.c.name.localeCompare(b.c.name, 'he');
  }), [lines]);

  if (B.error) return <ErrorBox what="קובץ ההון" error={B.error} />;
  if (!B.file || !B.ready || !D) return <Loading what="הון ואפשרויות הקצאה" />;
  if (!cos.length) return <Empty title="אין מבטחות עם נתוני כושר פירעון" />;
  const na = B.file.companies.filter((c) => !isOk(c));
  const P = B.P.filter((p) => p.ok);
  const cur = P.find((p) => p.id === pid);
  const label = cur ? `אחרי "${cur.he}"` : 'אחרי התרחיש החמור שחושב לכל חברה';
  const top = ranked.filter((l) => l.pick?.v != null);
  const head = top.length
    ? `${label}: ${top.slice(0, 3).map((l) => `${l.c.name} ${l.pick!.pctScr! >= 0 ? 'שומרת' : 'חסרה'} ${fmt(Math.abs(l.pick!.pctScr!), 1)}% מה-SCR`).join(', ')}${top.length > 3 ? `; ${top[top.length - 1].c.name} אחרונה (${sign(top[top.length - 1].pick!.pctScr)}%)` : ''}`
    : `${label}: לא חושב`;
  const dates = [...new Set(cos.map((c) => c.period))].join(', ');

  return (
    <div className="cap scn">
      <div className="pagehead"><div>
        <h1><span className="icotile"><Icon name="shield" /></span>הון ואפשרויות הקצאה</h1>
        <div className="sub"><span><span className="num">{cos.length}</span> מבטחות</span><span>·</span><span>כושר פירעון <span className="num">{dates}</span>, רווח LTM <span className="num">{B.file.meta.base.ltm[0]}–{B.file.meta.base.ltm[3]}</span></span><span>·</span><span>מיליוני ש״ח</span><span>·</span><Link to="/scenarios">חדר התרחישים</Link><Link to="/industry/csm?view=capital">כושר חלוקה כפי שדווח</Link></div>
      </div></div>

      <div className="cap-ctl">
        <div className="scn-presets" role="group" aria-label="תרחיש">
          <button type="button" className="chip" aria-pressed={pid === WORST} onClick={() => setPid(WORST)}>החמור לכל חברה</button>
          {P.map((p) => <button key={p.id} type="button" className="chip" aria-pressed={pid === p.id} title={p.he} onClick={() => setPid(p.id)}>{p.he}</button>)}
        </div>
        <BufferInput pp={pp} set={setPp} all />
      </div>

      <section className="scn-head" aria-live="polite"><p>{head}</p>
        <div className="meta"><span className="chip est" title="ההשפעה על היחס מגילויי הרגישות של כל חברה (A1), SCR קבוע; גילויים ישנים ומחוץ לטווח מסומנים">אומדן: רגישויות כפי שגולו</span></div>
      </section>

      <Panel title="דירוג: העודף ששורד כאחוז מה-SCR" aside={<span>הון בר-חלוקה אחרי התרחיש ÷ SCR של הבסיס המחייב</span>}>
        <ol className="cap-rank">
          <li className="hd" aria-hidden="true"><div /><div>מבטחת</div><div>הון בר-חלוקה</div><div>אחרי התרחיש</div><div>% מה-SCR</div><div>נשאר</div><div>אפשרויות: ROIC מול ke</div></li>
          {ranked.map((l, i) => {
            const b = bindingOf(l.c), dist = distAt(l.c, l.R), s = l.pick;
            const ke = l.c.pnl.ke.v!;
            return (
              <li key={l.c.id} className={s?.v == null ? 'incomplete' : ''}>
                <div className="n sp">{s?.v == null ? '–' : i + 1}</div>
                <div className="who"><i className="scn-dot" style={{ background: idCss(l.c.id) }} aria-hidden="true" /><Link to={`/company/${l.c.id}`}>{l.c.name}</Link>
                  <span className="s">{b.he} {fmt(b.t, b.t % 1 ? 1 : 0)}% · {l.c.period}{(b.kind === 'reg' || b.stated == null) && <> <span className="chip est" title={b.kind === 'reg' ? 'לא הודפס יעד דירקטוריון לחברת הביטוח: נמדד מול הדרישה הרגולטורית, 100%' : 'בסיס היעד לא צוין: מוחל על שני הבסיסים, המחמיר קובע'}>אומדן</span></>}</span></div>
                <div data-l="הון בר-חלוקה"><Sourced className={`v num ${dist.v! < 0 ? 'neg' : ''}`} src={() => cprov(l.c, dist.prov, lts)}>{amt(dist.v)}</Sourced><span className="s">מרווח {fmt(l.R.pp, 1)} נ״א</span></div>
                <div data-l="אחרי התרחיש">{s?.v != null ? <Sourced className={`v num ${s.v < 0 ? 'neg' : ''}`} src={s.prov}>{amt(s.v)}</Sourced> : <span className="na">לא חושב</span>}
                  <span className="s">{s ? s.he : l.incomplete.length ? <>אין רגישויות: {l.incomplete.join(', ')} <span className="chip gap" title={l.St.find((x) => x.v == null)?.gap.join('\n')}>חסר</span></> : '–'}{s && s.est.length > 0 && <> <span className="chip est" title={s.est.join('\n')}>אומדן</span></>}</span></div>
                <div data-l="% מה-SCR"><span className={`v num ${s?.pctScr != null && s.pctScr < 0 ? 'neg' : ''}`}>{s?.pctScr == null ? '–' : signP(s.pctScr)}</span><span className="s">{BASIS_HE[b.basis]}</span></div>
                <div data-l="נשאר מהעודף"><span className="v num">{s?.survive == null ? '–' : `⁦${fmt(s.survive, 0)}%⁩`}</span>{s?.survive != null && <span className={`cap-bar ${s.survive <= 0 ? 'gone' : s.survive < 50 ? 'low' : ''}`} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, s.survive))}%` }} /></span>}</div>
                <div className="opts" data-l="אפשרויות"><span className="s">דיבידנד / רכישה: <bdi>ke {fmt(ke, 1)}%</bdi> · צמיחה: <bdi>ROE {fmt(l.R.org.roic.v, 1)}%</bdi> <span className="chip est" title="ROE LTM כאומדן לתשואה השולית">אומדן</span></span>
                  <button type="button" className="chip" aria-expanded={open === l.c.id} onClick={() => setOpen(open === l.c.id ? null : l.c.id)}>{open === l.c.id ? 'סגירה' : 'כל האפשרויות והתרחישים'}</button></div>
                {open === l.c.id && <div style={{ gridColumn: '1 / -1' }}><OptionTable c={l.c} R={l.R} W={s} sel={pid !== WORST ? pid : undefined} /><StressTable c={l.c} S={l.St} base={l.R.dist} sel={s?.id} onSel={setPid} /></div>}
              </li>
            );
          })}
        </ol>
        <div className="src">הון בר-חלוקה = הון עצמי − SCR × יעד − מרווח ניהולי, לכל בסיס שהודפס (עם / ללא הוראות מעבר; יעד הדירקטוריון או סף החלוקה), הנמוך מחייב. אחרי התרחיש: Δ יחס כושר הפירעון מ<Link to="/drivers">מנגנוני A1</Link> × SCR, SCR קבוע. "החמור לכל חברה" רק כשכל תרחישי השוק חושבו; חברה בלי רגישויות בסוף הרשימה. מספרים אנליטיים, לא המלצה.</div>
      </Panel>

      {na.length > 0 && <div className="src">לא חושב: {na.map((c, i) => <span key={c.id}>{i ? ' · ' : ''}<Link to={`/company/${c.id}`}>{c.name}</Link></span>)}. {'why' in na[0] ? [...new Set(na.map((c) => ('why' in c ? c.why : '')))].join(' · ') : ''}</div>}
    </div>
  );
}
