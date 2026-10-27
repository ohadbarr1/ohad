import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Sourced } from './Source';
import { Empty, ErrorBox, Loading } from './ui';
import { useLoad } from '../lib/useData';
import { ltsProv } from '../lib/lens';
import { fmt, fmtS, toProv, type LtsResolver, type ProvJ } from '../lib/drivers';
import type { Prov } from '../lib/prov';
import {
  LEVER_NOTE, dateHe, expectationsPath, isOkE, leverText, pctText, pctTone, reqText, targetText,
  type ECompany, type ECompanyOk, type EFig, type ELever, type LeverKey,
} from '../lib/expectations';
import '../styles/expectations.css';

/* A3 · the Expectations Decoder panel: what the current multiple requires, one input at a time, against what the company has done.
   Exported for the valuation tab, the /expectations ranking and the company thesis page. The numbers are the pipeline's (solved on the
   22.10.26 manual price and the default assumptions); every figure opens its source; assumptions carry the estimate chip. The price is an
   input, not a headline: the panel leads with the multiple and the required inputs. Analysis of what the price implies, not a recommendation. */

const lts: LtsResolver = (j) => ltsProv(j.c, j.metric, j.period, j.title, j.unit, j.note, j.value);
export const srcOf = (j: ProvJ) => (): Prov => toProv(j, lts);
const LRM = '⁦', PDI = '⁩';
const iso = (s: string) => `${LRM}${s}${PDI}`;
const Est = ({ t }: { t?: string }) => <span className="chip est" title={t ?? 'אומדן או הנחה: ראו המקור'}>אומדן</span>;
/** a sourced figure, or a dash */
export function F({ f, text, className = '' }: { f: EFig | null | undefined; text: (v: number) => string; className?: string }) {
  if (!f || f.v == null || !Number.isFinite(f.v)) return <span className="num muted">–</span>;
  return <Sourced className={`num ${className}`} src={srcOf(f.prov)}>{text(f.v)}</Sourced>;
}
const mil = (v: number) => iso(fmt(v, 0));
const bn = (v: number) => iso(fmt(v / 1000, 1));
const pc = (d = 1) => (v: number) => iso(`${fmt(v, d)}%`);
const xm = (v: number) => iso(`${fmt(v, 2)}x`);

/* ---------- the range bar: the company's history (min · median · max), what it has now, what the price requires ---------- */
export function RangeBar({ min, med, max, now, req, out, label }: { min: number; med: number; max: number; now?: number | null; req?: number | null; out?: 'hi' | 'lo' | null; label: string }) {
  const span = max - min || Math.abs(max) || 1;
  const lo = min - span * 0.12, hi = max + span * 0.12;
  const at = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const reqAt = out === 'hi' ? 100 : out === 'lo' ? 0 : req != null ? at(req) : null;
  const pinned = out != null || (req != null && (req > hi || req < lo));
  return (
    <span className="exp-rb" role="img" aria-label={label}>
      <i className="band" style={{ left: `${at(min)}%`, width: `${at(max) - at(min)}%` }} />
      <i className="med" style={{ left: `${at(med)}%` }} />
      {now != null && Number.isFinite(now) && <i className="now" style={{ left: `${at(now)}%` }} />}
      {reqAt != null && <i className={`req${pinned ? ' pin' : ''}${reqAt >= 100 ? ' end' : reqAt <= 0 ? ' start' : ''}`} style={{ left: `${reqAt}%` }} />}
    </span>
  );
}

/** where a lever's requirement sits on its history's scale: the fee lever's history is the annual change, so the requirement is too */
function onScale(L: ELever, c: ECompanyOk): { req: number | null; now: number | null; out: 'hi' | 'lo' | null } {
  const out = L.status === 'beyond' ? (L.hist?.dir === 'down' ? 'lo' : 'hi') : L.status === 'below' ? (L.hist?.dir === 'down' ? 'hi' : 'lo') : null;
  if (L.k === 'fee') return { req: L.req_d ?? null, now: L.ref?.find((r) => r.he.startsWith('מגמת'))?.v ?? null, out };
  if (L.k === 'roe') return { req: L.req?.v ?? null, now: c.base.roe_ltm.v, out };
  return { req: L.req?.v ?? null, now: L.trail.v, out };
}

function histLine(L: ELever): ReactNode {
  const h = L.hist;
  if (!h) return <span className="s">אין היסטוריה</span>;
  const bp = h.unit.includes('נ״ב');
  const one = (v: number) => (bp ? <><span className="num">{iso(fmtS(v, 1))}</span> נ״ב</> : <span className="num">{iso(`${fmt(v, 1)}%`)}</span>);
  return (
    <span className="s">
      <Sourced src={srcOf(h.prov)} className="num">{`${h.n} ${L.k === 'csm' ? 'מבטחות' : L.k === 'ci' || L.k === 'roe' ? 'רבעונים' : 'חלונות'}`}</Sourced>
      {' · '}מ-{one(h.min)} עד {one(h.max)}{bp ? ' לשנה' : ''}
      {L.k === 'roe' && h.max_at ? <> · שיא {h.max_at}</> : null}
    </span>
  );
}

const ROW_LABEL: Record<LeverKey, string> = { aum: 'צמיחת נכסים', fee: 'תשואת דמי ניהול', ci: 'יחס עלות להכנסה', csm: 'קצב שחרור CSM', roe: "ROE ב-FY'28" };
const REQ_CAP: Record<LeverKey, string> = { aum: 'CAGR עד FY\'28', fee: 'ב-FY\'28', ci: 'ב-FY\'28', csm: 'לשנה, ב-FY\'28', roe: 'הון ממוצע' };

function LeverRow({ L, c }: { L: ELever; c: ECompanyOk }) {
  const sc = onScale(L, c), h = L.hist;
  const now = L.k === 'roe' ? c.base.roe_ltm : L.trail;
  const nowCap = { aum: '5 שנים בפועל', fee: 'LTM', ci: 'LTM', csm: "FY'25", roe: `LTM ${c.base.q}` }[L.k];
  const pct = h?.pct ?? null;
  return (
    <div className={`tr ${L.k === 'roe' ? 'roe' : ''}`}>
      <div className="lbl"><b>{ROW_LABEL[L.k]}</b><span className="s">{L.k === 'roe' ? 'כל המנופים יחד' : c.base.savings && L.k !== 'csm' ? c.base.savings.he : 'קבוצה, נטו'}</span></div>
      <div data-l="נדרש">
        {L.req ? <Sourced className="v num req" src={srcOf(L.req.prov)}>{reqText(L)}</Sourced> : <span className="v num req">{reqText(L)}</span>}
        <span className="s">{REQ_CAP[L.k]}{L.k === 'fee' && L.req_d != null ? <> · <span className="num">{iso(fmtS(L.req_d, 1))}</span> נ״ב לשנה</> : null} <Est t="נפתר מהמודל: הערך שבו שווי המודל שווה לשווי השוק, שאר המנופים בערכם הנוכחי" /></span>
      </div>
      <div data-l="עכשיו"><F f={now} text={L.k === 'fee' ? pc(2) : pc(1)} className="v" /><span className="s">{nowCap}</span></div>
      <div data-l="מול ההיסטוריה" className="hist">
        {h ? <RangeBar min={h.min} med={h.med} max={h.max} now={sc.now} req={sc.req} out={sc.out} label={`${ROW_LABEL[L.k]}: ${pctText(pct)}`} /> : null}
        <span className={`pct ${pctTone(pct)}`}>{pctText(pct)}</span>
        {histLine(L)}
      </div>
      <div data-l="השוואה" className="refs">
        {(L.ref ?? []).map((r) => (
          <span key={r.he} className="s"><span>{r.he}:</span> <Sourced className="num" src={srcOf(r.prov)}>{r.lo != null && r.hi != null && r.lo !== r.hi ? iso(`${fmt(r.lo, 1)}%–${fmt(r.hi, 1)}%`) : r.unit?.includes('נ״ב') ? iso(fmtS(r.v, 1)) : iso(`${fmt(r.v, 1)}%`)}</Sourced>{r.unit?.includes('נ״ב') ? ' נ״ב לשנה' : ''}</span>
        ))}
        {L.k === 'roe' && <span className="s"><span>בערכים הנוכחיים:</span> <F f={L.trail} text={pc(1)} /></span>}
        {L.k === 'roe' && c.targets.roe && <span className="s"><span>יעד ההנהלה ל-FY'28:</span> <Sourced className="num" src={srcOf(c.targets.roe.prov)}>{targetText(c.targets.roe)}</Sourced></span>}
        {L.k === 'roe' && c.targets.profit && L.path && <span className="s"><span>רווח FY'28 נדרש:</span> <span className="num">{mil(L.path[L.path.length - 1].np)}</span> מול יעד <Sourced className="num" src={srcOf(c.targets.profit.prov)}>{targetText(c.targets.profit)}</Sourced></span>}
        {L.k === 'roe' && L.path && <span className="s">מסלול: {L.path.map((p, i) => <bdi key={p.p}>{i ? ' → ' : ''}{p.p} <span className="num">{iso(`${fmt(p.roe, 1)}%`)}</span></bdi>)}</span>}
        {!L.ref?.length && L.k !== 'roe' && <span className="s muted">–</span>}
      </div>
      <div data-l="יחד" className="joint">
        {L.joint && L.joint.n ? (
          <span className="s" title={L.joint.when.length ? `חלונות: ${L.joint.when.join(', ')}` : undefined}>
            <span className={`jk ${L.joint.k ? '' : 'never'}`}><span className="num">{L.joint.k}</span> מתוך <span className="num">{L.joint.n}</span></span> {L.joint.he}
          </span>
        ) : <span className="s muted">–</span>}
      </div>
    </div>
  );
}

/** the decoder for one company: verdict, the required inputs and their history, the model's base */
export function ExpectationsView({ c, head = true, note }: { c: ECompanyOk; head?: boolean; note?: ReactNode }) {
  const b = c.base;
  const rows = [...c.levers, c.roe];
  return (
    <div className="exp-body">
      {head && (
        <div className="exp-mult">
          <span className="m"><span className="l">P/B</span><F f={b.pb} text={xm} className="big" /></span>
          <span className="l2">{c.name} · הון {b.q}</span>
          <span className="pxd">
            <Sourced src={srcOf(c.price.mcap.prov)} className="chip pxchip" title="שווי השוק ומחיר המניה הם קלט ידני ליום זה; אין היסטוריית מחירים">{c.price.label}</Sourced>
          </span>
        </div>
      )}
      <p className="exp-verdict" aria-live="polite">{c.verdict}</p>
      {note}
      <div className="exp-t">
        <div className="tr th" aria-hidden="true"><div>מנוף</div><div>נדרש</div><div>עכשיו</div><div>מול ההיסטוריה של החברה</div><div>השוואה</div><div>יחד בחלון אחד</div></div>
        {rows.map((L) => <LeverRow key={L.k} L={L} c={c} />)}
      </div>
      <div className="exp-legend" aria-hidden="true"><span><i className="band" />טווח ההיסטוריה</span><span><i className="med" />חציון</span><span><i className="now" />עכשיו</span><span><i className="req" />נדרש</span></div>
      <details className="exp-model">
        <summary>מה נכנס לשווי · <span className="num">{xm(b.pb.v!)}</span> מול <span className="num">{xm(b.value.v! / b.equity.v!)}</span> בערכים הנוכחיים</summary>
        <div className="exp-strip">
          <div><span className="l">הון {b.q}</span><F f={b.equity} text={bn} className="v" /><span className="s">מיליארד ש"ח{b.div_after.v ? <> · פחות דיבידנד <F f={b.div_after} text={mil} /></> : null}</span></div>
          <div><span className="l">רווח נקי LTM</span><F f={b.np_ltm} text={mil} className="v" /><span className="s">מיליוני ש"ח · ROE <F f={b.roe_ltm} text={pc(1)} /></span></div>
          {b.adj && <div><span className="l">נרמול השקעות <Est t="השפעת המניות על הרווח כפי שגולתה, בזעזוע = תשואה נורמלית פחות תשואת המניות LTM" /></span><F f={b.adj} text={(v) => iso(fmtS(v, 0))} className="v" /><span className="s">מניות LTM <F f={b.eq_ltm} text={pc(1)} /> מול נורמלי <span className="num">{pc(2)(b.ke.v!)}</span></span></div>}
          <div><span className="l">רווח מנורמל</span><F f={b.np_norm} text={mil} className="v" /><span className="s">מיליוני ש"ח, בסיס המודל</span></div>
          <div><span className="l">שיעור חלוקה <Est /></span><F f={b.payout} text={pc(0)} className="v" /><span className="s">דיבידנד LTM ÷ רווח</span></div>
          <div><span className="l">ke · g <Est /></span><span className="v"><F f={b.ke} text={pc(2)} /> · <F f={b.g} text={pc(1)} /></span><span className="s">מס <F f={b.tax} text={pc(1)} /></span></div>
          <div><span className="l">שווי המודל, ערכים נוכחיים <Est /></span><F f={b.value} text={bn} className="v" /><span className="s">מיליארד ש"ח · שוק מעליו ב-<F f={b.gap} text={(v) => iso(`${fmtS(v, 0)}%`)} /></span></div>
        </div>
        {b.savings && <p className="s">חיסכון ({b.savings.he}): נכסים ממוצעים <F f={b.savings.aum} text={bn} /> מיליארד, תשואת דמי ניהול <F f={b.savings.fy} text={pc(3)} />, עלות להכנסה <F f={b.savings.ci} text={pc(1)} />, רווח תפעולי <F f={b.savings.op} text={mil} /> מיליוני ש"ח LTM.{b.csm && <> CSM <F f={b.csm.csm} text={mil} /> מיליוני ש"ח, שחרור <F f={b.csm.rr} text={pc(1)} /> לשנה.</>}</p>}
        {c.gaps.length > 0 && <p className="s">{c.gaps.join(' · ')}</p>}
      </details>
      <div className="src">
        שווי = Σ ערך נוכחי של החלוקות ב-{c.meta.periods.join(', ')} + P/B מוצדק (ROE − g) ÷ (ke − g) על ההון של {c.meta.horizon}. כל מנוף נפתר לבדו (חיפוש בינארי), השאר בערכם הנוכחי; נכסים צומחים בקצב 5 השנים. אחוזון = חלק ההיסטוריה של החברה שדורש פחות. {c.meta.price_label}. ניתוח של מה שהמכפיל מגלם, לא המלצה.{' '}
        <Link to="/expectations">כל החברות</Link>
      </div>
    </div>
  );
}

/** the panel the valuation tab, /expectations and the company thesis page host */
export function ExpectationsPanel({ id, note, head = true, title = true }: { id: string; note?: ReactNode; head?: boolean; title?: boolean }) {
  const { data, error } = useLoad<ECompany>(expectationsPath(id));
  let body: ReactNode;
  if (error) body = /404|not found|Unexpected token/i.test(error) ? <Empty title="ציפיות השוק מחושבות לחברות הנסחרות בלבד" /> : <ErrorBox what="ציפיות השוק" error={error} />;
  else if (!data) body = <Loading what="ציפיות השוק" />;
  else if (!isOkE(data)) body = <Empty title="ציפיות השוק לא חושבו לחברה זו">{data.why}</Empty>;
  else body = <ExpectationsView c={data} head={head} note={note} />;
  return (
    <section className="panel exp-panel" aria-labelledby={title ? `exp-h-${id}` : undefined}>
      {title && <div className="hd"><h2 id={`exp-h-${id}`}>ציפיות השוק: מה המכפיל דורש עד FY'28</h2>{isOkE(data) && <div className="aside">{dateHe(data.price.date)} · ke <span className="num">{pc(2)(data.base.ke.v!)}</span> · g <span className="num">{pc(1)(data.base.g.v!)}</span></div>}</div>}
      {body}
    </section>
  );
}

export { LEVER_NOTE, leverText };
