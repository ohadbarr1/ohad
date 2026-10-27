import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Panel } from './ui';
import { Sourced } from './Source';
import { useLoad } from '../lib/useData';
import { ltsProv } from '../lib/lens';
import { driversPath, fmt, fmtS, type DriverFile, type LtsResolver } from '../lib/drivers';
import { ncRows, presets, type CatFile, type CurveFile, type MacroFile, type NowcastFile, type Preset } from '../lib/scenarios';
import {
  BASIS_HE, CAPITAL_PATH, KIND_HE, OPT_HE, bindingOf, cprov, distAt, isOk, optionsAt, stressOf, worstOf,
  type CapFile, type CapOk, type CFig, type OptRow, type Rows, type Stressed,
} from '../lib/capital';
import '../styles/capital.css';

/* A7 · Capital & Strategic Options on the company home (insurers): the surplus over the board's target, the option set over it (dividend /
   buyback, organic growth, bolt-on = A9, hold against stress = A2) and how much of the surplus survives each A2 preset. Analytical options
   only: no recommendation, no score beyond the figures shown. Every figure opens its source; assumptions carry the estimate chip. */

export const lts: LtsResolver = (j) => ltsProv(j.c, j.metric, j.period, j.title, j.unit, j.note, j.value);
const sign = (v: number | null | undefined, d = 1) => (v == null ? '–' : `⁦${fmtS(v, d)}⁩`);
const signP = (v: number | null | undefined, d = 1) => (v == null ? '–' : `⁦${fmtS(v, d)}%⁩`);
const amt = (v: number | null | undefined) => (v == null ? '–' : `⁦${fmt(v, 0)}⁩`);
const Est = ({ t }: { t?: string }) => <span className="chip est" title={t ?? 'אומדן או הנחה: ראו המקור'}>אומדן</span>;
const Gap = ({ t }: { t: string }) => <span className="chip gap" title={t}>חסר</span>;

/** the files every capital view reads: options.json and the A2 preset inputs */
export function useCapitalBase() {
  const F = useLoad<CapFile>(CAPITAL_PATH);
  const NC = useLoad<NowcastFile>('nowcast.json'), MC = useLoad<MacroFile>('macro/macro.json'), CV = useLoad<CurveFile>('macro/boi_curve.json'), CT = useLoad<CatFile>('funds/cat.json');
  const end = F.data?.meta.base.end ?? '2026-06-30';
  const ready = !!F.data && [NC, MC, CV, CT].every((x) => x.data || x.error);
  const P = useMemo<Preset[]>(() => (ready ? presets(CV.data, CT.data, MC.data, NC.data, end) : []), [ready, CV.data, CT.data, MC.data, NC.data, end]);
  const NCm = useMemo(() => ncRows(NC.data), [NC.data]);
  const now = P.find((p) => p.id === 'now');
  const ncAt = useMemo(() => ({ eq: now?.sc.eq ?? 0, y10: now?.sc.y10 ?? 0 }), [now?.sc.eq, now?.sc.y10]);
  return { file: F.data, error: F.error, ready, P, NCm, ncAt };
}
/** the buffer override in the address (pp of SCR); empty = each company's default */
export function useBufferParam(): [number | null, (v: number | null) => void] {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('buf'), v = raw == null || raw === '' ? null : Number(raw);
  const set = (x: number | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (x == null || !Number.isFinite(x)) n.delete('buf'); else n.set('buf', String(Math.max(0, Math.min(40, Math.round(x * 2) / 2)))); return n; }, { replace: true });
  return [v != null && Number.isFinite(v) ? Math.max(0, Math.min(40, v)) : null, set];
}

export function BufferInput({ c, pp, set, all, bare }: { c?: CapOk; pp: number | null; set: (v: number | null) => void; all?: boolean; bare?: boolean }) {
  const shown = pp ?? c?.buffer.pp ?? '';
  return (
    <label className="cap-buf">
      {!bare && <span>מרווח ניהולי</span>}
      <input type="number" min={0} max={40} step={0.5} inputMode="decimal" value={pp == null && all ? '' : shown} placeholder={all ? 'ברירת מחדל' : undefined}
        onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} aria-label="מרווח ניהולי, נקודות אחוז מה-SCR" />
      <span className="dim">נ״א מה-SCR</span>
      {c && pp == null && <Sourced className="num" src={() => cprov(c, c.buffer.prov, lts)}>ברירת מחדל</Sourced>}
      <Est t="הנחה, ניתנת לשינוי: ברירת המחדל היא התנודה הרגילה של היחס בין שני תאריכי חישוב" />
      {pp != null && <button type="button" className="chip" onClick={() => set(null)}>איפוס</button>}
    </label>
  );
}

/** a sourced figure; `num` (left-to-right, tabular) only when the text is a bare number, so a Hebrew unit keeps its right-to-left place */
const S = (c: CapOk, f: CFig | undefined, text: ReactNode, cls = 'v') => (f && f.v != null
  ? <Sourced className={`${cls.replace(/\bnum\b/, '')} ${typeof text === 'string' && !/[\u0590-\u05FF]/.test(text) ? 'num' : ''} ${f.v < 0 ? 'neg' : ''}`} src={() => cprov(c, f.prov, lts)}>{text}</Sourced>
  : <span className="na">–</span>);
const estOf = (f: CFig | undefined) => !!f && f.prov.k === 'calc' && !!(f.prov as { est?: boolean }).est;

/** the four option rows */
export function OptionTable({ c, R, W, sel }: { c: CapOk; R: Rows; W: Stressed | null; sel?: string }) {
  const ke = c.pnl.ke;
  const rk = (id: 'div' | 'org') => { const i = R.rank.indexOf(id); return i < 0 ? <span className="rk" title="אין קיבולת">–</span> : <span className={`rk ${i === 0 ? 'one' : ''}`} title="דירוג לפי ROIC − ke לכל שקל">{i + 1}</span>; };
  const none = (R.div.cap.v ?? 0) <= 0;
  const row = (o: OptRow, acc: ReactNode, roicSub: ReactNode) => (
    <div className="tr" key={o.id}>
      <div className="lbl">{rk(o.id)}{OPT_HE[o.id]}</div>
      <div data-l="קיבולת, מ׳ ש״ח">{S(c, o.cap, amt(o.cap.v))}{none && <span className="s">אין עודף מעל היעד והמרווח</span>}</div>
      <div data-l="ROIC">{S(c, o.roic, `${fmt(o.roic.v, 1)}%`)}<span className="s">{roicSub}</span></div>
      <div data-l="עלות כושר פירעון">{S(c, o.solv, `${sign(o.solv.v)} נ״א`)}<span className="s"><span className="num">{sign(o.per_bn, 1)}</span> נ״א לכל מיליארד</span></div>
      <div data-l="השפעה" className="acc">{acc}</div>
    </div>
  );
  return (
    <div className="cap-t" role="group" aria-label="אפשרויות הקצאת הון">
      <div className="tr th"><div>אפשרות</div><div>קיבולת <span className="dim">מ׳ ש״ח</span></div><div>ROIC</div><div>עלות כושר פירעון <span className="dim">נ״א</span></div><div>השפעה על הרווח</div></div>
      {row(R.div, <>{S(c, R.div.roe, <><bdi>ROE</bdi> {sign(R.div.roe.v)} נ״א</>)}<span className="s">רווח למניה, דיבידנד {S(c, R.div.eps, signP(R.div.eps.v), 'num')}{R.div.eps_bb?.v != null && <> · רכישה עצמית ב-P/B מוצדק {S(c, R.div.eps_bb, signP(R.div.eps_bb.v), 'num')}</>} <Est t="rf כתשואה שההון העודף מניב (הנחה); P/B מוצדק של A1 הוא קלט הערכה, לא מחיר שוק" /></span></>,
        <><bdi>ke</bdi> · {S(c, ke, `${fmt(ke.v, 2)}%`, 'num')}</>)}
      {row(R.org, <>{S(c, R.org.eps, <>רווח למניה {signP(R.org.eps.v)}</>)}<span className="s"><bdi>ROE</bdi> {S(c, R.org.roe, `${sign(R.org.roe.v)} נ״א`, 'num')} · התשואה מעל rf אחרי מס</span></>,
        <>ROE LTM כאומדן לתשואה השולית {estOf(R.org.roic) && <Est t="הדוחות לא מפרסמים את צריכת ההון של עסק חדש; ה-ROE הממוצע משמש כאומדן" />}</>)}
      <div className="tr off"><div className="lbl"><span className="rk">–</span>{OPT_HE.bolt}</div><div className="wide na" data-l="">A9 · מודול האיחודים: טרם חושב</div><div className="na ph">–</div><div className="na ph">–</div><div className="na ph">–</div></div>
      <div className={`tr hold ${sel ? 'sel' : ''}`}>
        <div className="lbl"><span className="rk">–</span>{OPT_HE.hold}</div>
        <div data-l="עודף שנשאר, מ׳ ש״ח">{W && W.v != null ? <Sourced className={`v num ${W.v < 0 ? 'neg' : ''}`} src={W.prov}>{amt(W.v)}</Sourced> : <span className="na">–</span>}<span className="s">{W ? <>אחרי "{W.he}"{sel ? '' : ', החמור שחושב'}</> : 'לא חושב'}</span></div>
        <div data-l="להחזיק">{W && W.v != null ? <><span className="v num">{amt(R.dist - W.v)}</span><span className="s">מ׳ ש״ח שהתרחיש צורך</span></> : <span className="na">–</span>}</div>
        <div className="na ph">–</div><div className="na ph">–</div>
      </div>
    </div>
  );
}

/** the A2 overlay: the distributable capital after each preset */
export function StressTable({ c, S: xs, base, sel, onSel }: { c: CapOk; S: Stressed[]; base: number; sel?: string; onSel?: (id: string) => void }) {
  const bind = bindingOf(c);
  return (
    <div className="cap-t st" role="group" aria-label="העודף אחרי כל תרחיש">
      <div className="tr th"><div>תרחיש (A2)</div><div>Δ יחס <span className="dim">{BASIS_HE[bind.basis]}, נ״א</span></div><div>הון בר-חלוקה <span className="dim">מ׳ ש״ח</span></div><div>נשאר מהעודף</div><div>% מה-SCR</div><div>סימונים</div></div>
      {xs.map((s) => {
        const d = bind.basis === 'w' ? s.dW : s.dWo, w = s.survive == null ? 0 : Math.max(0, Math.min(100, s.survive));
        return (
          <div key={s.id} className={`tr ${sel === s.id ? 'sel' : ''}`}>
            <div className="lbl">{onSel ? <button type="button" className="lnk" aria-pressed={sel === s.id} onClick={() => onSel(s.id)}>{s.he}</button> : s.he}<Sourced className="dim" src={() => s.preset.prov}>הגדרה</Sourced></div>
            <div data-l="Δ יחס, נ״א">{!(s.preset.sc.y10 || s.preset.sc.eq) ? <span className="na" title="דמי ניהול, ניוד, מדד ואשראי אינם מגולגלים ליחס (אין גילוי)">אין ערוץ ליחס</span> : <span className={`v num ${d != null && d < 0 ? 'neg' : ''}`}>{d == null ? '–' : sign(d)}</span>}</div>
            <div data-l="הון בר-חלוקה">{s.v == null ? <span className="na">לא חושב</span> : <Sourced className={`v num ${s.v < 0 ? 'neg' : ''}`} src={s.prov}>{amt(s.v)}</Sourced>}</div>
            <div data-l="נשאר מהעודף">{s.survive == null ? <span className="na">{base <= 0 ? 'אין עודף בבסיס' : '–'}</span> : <><span className="v num">{`⁦${fmt(s.survive, 0)}%⁩`}</span><span className={`cap-bar ${s.survive <= 0 ? 'gone' : s.survive < 50 ? 'low' : ''}`} aria-hidden="true"><i style={{ width: `${w}%` }} /></span></>}</div>
            <div data-l="% מה-SCR"><span className={`v num ${s.pctScr != null && s.pctScr < 0 ? 'neg' : ''}`}>{s.pctScr == null ? '–' : signP(s.pctScr)}</span></div>
            <div data-l="סימונים" className="cap-mk">{s.gap.length > 0 && <Gap t={s.gap.join('\n')} />}{s.est.length > 0 && <Est t={s.est.join('\n')} />}{!s.gap.length && !s.est.length && <span className="na">–</span>}</div>
          </div>
        );
      })}
    </div>
  );
}

/** one insurer, everything the panel and /capital show */
export function useCapitalOne(c: CapOk | null, f: DriverFile | null, P: Preset[], NCm: ReturnType<typeof ncRows>, ncAt: { eq: number; y10: number }, pp: number | null) {
  return useMemo(() => {
    if (!c || !f) return null;
    const R = optionsAt(c, pp), St = P.length ? stressOf(c, f, P, NCm, ncAt, lts, R.pp) : [];
    return { R, St, W: worstOf(St), dist: distAt(c, R) };
  }, [c, f, P, NCm, ncAt, pp]);
}

export function CapitalPanel({ id }: { id: string }) {
  const B = useCapitalBase();
  const D = useLoad<DriverFile>(B.file ? driversPath(id) : null);
  const [pp, setPp] = useBufferParam();
  const co = B.file?.companies.find((x) => x.id === id) ?? null;
  const c = co && isOk(co) ? co : null;
  const one = useCapitalOne(c, D.data, B.P, B.NCm, B.ncAt, pp);
  if (B.error || !B.file || !co) return null;
  if (!c) return <Panel title="הון ואפשרויות הקצאה" aside={<Link to="/capital">כל המבטחות</Link>}><p className="muted">{'why' in co ? co.why : ''}</p></Panel>;
  if (!one) return null;
  const { R, St, W, dist } = one;
  const bind = bindingOf(c), Bb = c.bases[bind.basis]!;
  const po = c.dividend.printed_over;
  return (
    <Panel className="cap-panel" title="הון ואפשרויות הקצאה" aside={<span>מיליוני ש"ח · חברת הביטוח · כושר פירעון {c.period} · <Link to={`/capital${pp != null ? `?buf=${pp}` : ''}`}>כל המבטחות</Link></span>}>
      <div className="cap-strip">
        <div><span className="l">הון עצמי לעניין SCR · {BASIS_HE[bind.basis]}</span>{S(c, Bb.of, amt(Bb.of.v))}<span className="s">SCR {S(c, Bb.scr, amt(Bb.scr.v), 'num')} · יחס {S(c, Bb.ratio, `${fmt(Bb.ratio.v, 1)}%`, 'num')}</span></div>
        <div><span className="l">האילוץ המחייב</span><Sourced className="v num" src={() => cprov(c, bind.t_prov, lts)}>{fmt(bind.t, bind.t % 1 ? 1 : 0)}%</Sourced><span className="s">{bind.he} · {bind.period}{bind.kind === 'reg' && <> <Est t="לא הודפס יעד דירקטוריון לחברת הביטוח: נמדד מול 100%" /></>}{bind.stated == null && <> <Est t="בסיס היעד לא צוין: מוחל על שני הבסיסים, המחמיר קובע" /></>}</span></div>
        <div><span className="l">עודף מעל היעד</span>{S(c, bind.headroom, amt(bind.headroom.v))}<span className="s">{fmt(bind.pp, 1)} נ״א מעל היעד{po && <> · הודפס: <Sourced className="num" src={() => cprov(c, po.prov, lts)}>{amt(po.v)}</Sourced> ליום {po.d.slice(8, 10)}.{po.d.slice(5, 7)}.{po.d.slice(2, 4)}{po.after ? ', אחרי פעולות הון' : ''}</>}</span></div>
        <div><span className="l">מרווח ניהולי</span><span className="v num">{amt(R.buffer)}</span><span className="s"><BufferInput c={c} pp={pp} set={setPp} bare /></span></div>
        <div className="hero"><span className="l">הון בר-חלוקה</span>{S(c, dist, amt(dist.v))}<span className="s">הון עצמי − SCR × יעד − מרווח{c.dividend.ltm && <> · דיבידנד LTM {S(c, c.dividend.ltm, amt(c.dividend.ltm.v), 'num')}</>}</span></div>
        {c.dividend.policy.length > 0 && <div><span className="l">מדיניות חלוקה</span><span className="s">{c.dividend.policy.map((p, i) => <span key={i}>{i ? ' · ' : ''}{p.he} <Sourced className="num" src={() => cprov(c, p.prov, lts)}>{p.unit === '%' ? `${fmt(p.v, 0)}%` : amt(p.v)}</Sourced></span>)}</span></div>}
      </div>
      <div className="cap-cons">{c.constraints.map((k) => <span key={k.id} className={k.id === bind.id ? 'bind' : ''}>{KIND_HE[k.kind]}, {BASIS_HE[k.basis]} <b className="num">{fmt(k.t, k.t % 1 ? 1 : 0)}%</b>: עודף <Sourced className={`num ${k.headroom.v! < 0 ? 'neg' : ''}`} src={() => cprov(c, k.headroom.prov, lts)}>{amt(k.headroom.v)}</Sourced>{k.id === bind.id ? ' · מחייב' : ''}</span>)}</div>
      <OptionTable c={c} R={R} W={W} />
      {St.length > 0 && <StressTable c={c} S={St} base={R.dist} />}
      <div className="src">הון בר-חלוקה = הון עצמי − SCR × יעד − מרווח ניהולי, לכל בסיס שהודפס; הנמוך מחייב. דירוג: ROIC − ke לכל שקל (דיבידנד = 0 בהגדרה); לצד כל אפשרות עלותה ביחס כושר הפירעון. תרחישים: <Link to="/scenarios">חדר התרחישים</Link> דרך מנגנוני A1, SCR קבוע; "חסר" = אין ערוץ ליחס. מספרים אנליטיים, לא המלצה.</div>
    </Panel>
  );
}
