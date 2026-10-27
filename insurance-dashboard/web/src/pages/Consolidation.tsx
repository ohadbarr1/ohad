import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Loading, Panel } from '../components/ui';
import { lts } from '../components/CapitalPanel';
import { useLoad } from '../lib/useData';
import { usePhone } from '../lib/useMedia';
import { idCss } from '../lib/identity';
import { fmt, fmtS } from '../lib/drivers';
import type { Prov } from '../lib/prov';
import {
  BAND_HE, MATRIX_PATH, RANGES, anyOver, assumeFrom, bandOf, defaults, isOver, mixPath, p20Of, pairAt, pairPath, provsOf, queryOf, screen, xprov,
  type AKey, type Assume, type MatrixFile, type MixFile, type Pair, type PairFile, type Ranked, type Seg,
} from '../lib/consolidation';
import '../styles/scenarios.css';
import '../styles/capital.css';
import '../styles/consolidation.css';

/* A9 · the Consolidation Screen: /consolidation (every acquirer × target, ranked on one stated metric, and the matrix on a wide screen) and
   /consolidation/<acq>/<tgt> (the tear sheet). Not a navigation item: linked from /capital, /savings and search. Every figure opens its
   source; every assumption carries the estimate chip and lives in the address. Analytical, not a recommendation. */

const amt = (v: number | null | undefined, d = 0) => (v == null ? '–' : `⁦${fmt(v, d)}⁩`);
const sgn = (v: number | null | undefined, d = 0) => (v == null ? '–' : `⁦${fmtS(v, d)}⁩`);
const pc = (v: number | null | undefined, d = 1) => (v == null ? '–' : `⁦${fmt(v, d)}%⁩`);
const pcS = (v: number | null | undefined, d = 1) => (v == null ? '–' : `⁦${fmtS(v, d)}%⁩`);
const Est = ({ t }: { t?: string }) => <span className="chip est" title={t ?? 'אומדן או הנחה: ראו המקור'}>אומדן</span>;
const Nc = ({ t }: { t?: string }) => <span className="chip gap" title={t ?? 'יחס העלות של החברה אינו בר השוואה כמות שהוא'}>לא בר השוואה</span>;
const S = ({ src, children, neg, cls = 'v' }: { src: () => Prov; children: ReactNode; neg?: boolean; cls?: string }) => <Sourced className={`${cls} ${neg ? 'neg' : ''}`} src={src}>{children}</Sourced>;

/** the assumptions, from the address; the setter writes them back */
function useAssume(M: MatrixFile | null): [Assume | null, (k: AKey, v: number | null) => void, () => void] {
  const [sp, setSp] = useSearchParams();
  const A = useMemo(() => (M ? assumeFrom(M, sp) : null), [M, sp]);
  const set = (k: AKey, v: number | null) => setSp((prev) => {
    const n = new URLSearchParams(prev), key = M!.meta.assume[k].url;
    if (v == null || !Number.isFinite(v)) n.delete(key); else n.set(key, String(Math.max(RANGES[k][0], Math.min(RANGES[k][1], v))));
    return n;
  }, { replace: true });
  const reset = () => setSp((prev) => { const n = new URLSearchParams(prev); for (const k of Object.keys(RANGES) as AKey[]) n.delete(M!.meta.assume[k].url); return n; }, { replace: true });
  return [A, set, reset];
}

const STEP: Record<AKey, number> = { r: 5, ic: 0.25, h: 1, lev: 1, kd: 0.25 };
const shortOf = (M: MatrixFile, A: Assume, k: AKey) => (A[k] == null ? 'משך הספר' : `${fmt(A[k], k === 'ic' || k === 'kd' ? 2 : k === 'lev' ? 1 : 0)}${M.meta.assume[k].unit === '%' ? '%' : M.meta.assume[k].unit === 'x' ? 'x' : k === 'kd' ? ' נ״א' : ''}`);
function AssumeBar(props: { M: MatrixFile; A: Assume; set: (k: AKey, v: number | null) => void; reset: () => void }) {
  const phone = usePhone();
  const { M, A } = props;
  if (!phone) return <AssumeInputs {...props} />;
  return (
    <details className="cns-ass-d">
      <summary><span className="chip est">אומדן</span> הנחות: {(['r', 'ic', 'h', 'lev', 'kd'] as AKey[]).map((k) => `${M.meta.assume[k].he} ${shortOf(M, A, k)}`).join(' · ')}{anyOver(M, A) ? ' (שלך)' : ''}</summary>
      <AssumeInputs {...props} />
    </details>
  );
}
function AssumeInputs({ M, A, set, reset }: { M: MatrixFile; A: Assume; set: (k: AKey, v: number | null) => void; reset: () => void }) {
  const D = defaults(M);
  return (
    <div className="cns-ass" role="group" aria-label="הנחות">
      {(['r', 'ic', 'h', 'lev', 'kd'] as AKey[]).map((k) => {
        const J = M.meta.assume[k], over = isOver(M, A, k);
        return (
          <label key={k} className={over ? 'over' : ''}>
            <span className="l">{J.he}</span>
            <input type="number" min={RANGES[k][0]} max={RANGES[k][1]} step={STEP[k]} inputMode="decimal" value={A[k] ?? ''} placeholder={k === 'h' ? '—' : undefined}
              onChange={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))} aria-label={`${J.he}, ${J.unit}`} />
            <span className="dim">{k === 'h' ? 'שנים' : J.unit === 'x' ? 'x סינרגיה' : J.unit === '%' ? '%' : 'נ״א'}</span>
            <Sourced className="dim" src={() => xprov(M, J.prov, lts)}>{D[k] == null ? 'ברירת מחדל: משך הספר' : `ברירת מחדל ${fmt(D[k], k === 'lev' ? 1 : k === 'ic' || k === 'kd' ? 2 : 0)}`}</Sourced>
            <Est t={`הנחה, ניתנת לשינוי (${J.url}=)`} />
          </label>
        );
      })}
      {anyOver(M, A) && <button type="button" className="chip" onClick={reset}>איפוס ההנחות</button>}
    </div>
  );
}

const nameOf = (M: MatrixFile, id: string) => M.cos[id]?.name ?? id;
const Dot = ({ id }: { id: string }) => <i className="scn-dot" style={{ background: idCss(id) }} aria-hidden="true" />;

/* ---------------- /consolidation ---------------- */
export function Consolidation() {
  const F = useLoad<MatrixFile>(MATRIX_PATH);
  const M = F.data;
  const [A, set, reset] = useAssume(M);
  const [all, setAll] = useState(false);
  const R = useMemo<Ranked[]>(() => (M && A ? screen(M, A) : []), [M, A]);
  if (F.error) return <ErrorBox what="מסך האיחודים" error={F.error} />;
  if (!M || !A) return <Loading what="מסך האיחודים" />;
  if (!R.length) return <Empty title="אין זוגות לחישוב" />;
  const q = queryOf(M, A);
  const ids = Object.keys(M.cos).sort((p, r) => (M.cos[p].kind !== 'insurance_group' ? 1 : 0) - (M.cos[r].kind !== 'insurance_group' ? 1 : 0) || (p < r ? -1 : 1));
  const ranked = R.filter((r) => r.rank != null), flagged = R.filter((r) => r.rank == null);
  const shown = all ? R : ranked.slice(0, 10);
  const top = ranked.slice(0, 3);
  const head = top.map((r) => `${r.x.ca.name} ← ${r.x.ct.name} ${fmt(r.x.metric, 0)}%`).join(' · ');
  const ex = M.meta.example;
  const by = new Map(R.map((r) => [`${r.x.a}__${r.x.t}`, r]));
  return (
    <div className="cap cns">
      <div className="pagehead"><div>
        <h1><span className="icotile"><Icon name="compare" /></span>מסך האיחודים</h1>
        <div className="sub"><span><span className="num">{ids.length}</span> מנהלים · <span className="num">{R.length}</span> זוגות</span><span>·</span>
          <span>עלויות LTM <span className="num">{M.meta.base.ltm[0]}–{M.meta.base.ltm[3]}</span>, נכסים <span className="num">{M.meta.asof.aum}</span></span><span>·</span><span>מיליוני ש״ח</span><span>·</span>
          <Link to={`/capital`}>הון ואפשרויות הקצאה</Link><Link to="/savings">חיסכון ארוך טווח</Link><Link to="/debt">חוב ופירעונות</Link></div>
      </div></div>

      <AssumeBar M={M} A={A} set={set} reset={reset} />

      <section className="scn-head" aria-live="polite"><p>ערך נוכחי של הסינרגיה ÷ מחיר בפרמיה {fmt(M.meta.primary, 0)}%: {head}</p>
        <div className="meta"><span className="chip est" title="שיעור מימוש, עלות אינטגרציה, אופק, מינוף מרבי ומרווח חוב הם הנחות; השווי המוצדק הוא קלט הערכה, לא מחיר שוק">אומדן: הנחות גלויות</span>
          {anyOver(M, A) && <span className="chip">הנחות שלך</span>}</div>
      </section>

      <Panel title="הדוגמה, נבדקה בנתונים" aside={<span>מור · פנסיה · {ex.q}</span>} className="cns-ex">
        <div className="cap-strip">
          <div><span className="l">יחס עלות להכנסה, פנסיה</span><S src={() => xprov(M, ex.ci.prov, lts)} neg>{pc(ex.ci.v, 1)}</S><span className="s">{ex.first.q}: <span className="num">{pc(ex.first.ci, 0)}</span></span></div>
          <div><span className="l">רווח תפעולי לכל מיליארד נכסים</span><S src={() => xprov(M, ex.ppb.prov, lts)} neg={(ex.ppb.v ?? 0) < 0}>{sgn(ex.ppb.v, 2)}</S><span className="s">מיליוני ש״ח, קצב שנתי</span></div>
          <div><span className="l">נכסים ממוצעים, פנסיה</span><span className="v num">{amt(ex.aum / 1000, 1)}</span><span className="s">מיליארד ש״ח · {ex.first.q}: <span className="num">{amt(ex.first.aum / 1000, 1)}</span></span></div>
          <div><span className="l">פנסיה וגמל יחד</span><span className="v num">{pc(ex.pg_ci, 1)}</span><span className="s">יחס עלות · רווח לכל מיליארד <span className="num">{sgn(ex.pg_ppb, 2)}</span></span></div>
          <div><span className="l">מור, החברה כולה</span><span className="v num">{pc(ex.roe, 1)}</span><span className="s"><bdi>ROE</bdi> LTM</span></div>
        </div>
        <div className="src">{ex.ok ? <span className="chip">אומת</span> : <span className="chip gap">לא אומת</span>} {ex.note}.</div>
      </Panel>

      <Panel title={`דירוג: ערך נוכחי של הסינרגיה ÷ מחיר בפרמיה ${fmt(M.meta.primary, 0)}%`} aside={<span>{ranked.length} מדורגים · {flagged.length} מסומנים</span>}>
        <ol className="cns-rank">
          <li className="hd" aria-hidden="true"><div /><div>רוכשת ← יעד</div><div>ערך נוכחי</div><div>מחיר</div><div>ערך ÷ מחיר</div><div>קיבולת</div><div>רווח למניה</div></li>
          {shown.map((r) => {
            const x = r.x, P = provsOf(M, x, lts), p20 = p20Of(M, x), band = bandOf(p20.price, x.capacity);
            return (
              <li key={`${x.a}__${x.t}`} className={r.rank == null ? 'flag' : ''}>
                <div className="n">{r.rank ?? '–'}</div>
                <div className="who"><Dot id={x.a} /><Link to={`/consolidation/${x.a}/${x.t}${q}`}>{x.ca.name} ← {x.ct.name}</Link>{x.nc && <Nc t={[x.ca.nc_why, x.ct.nc_why].filter(Boolean).join('\n')} />}</div>
                <div data-l="ערך נוכחי"><S src={P.npv} neg={x.npv < 0}>{sgn(x.npv)}</S><span className="s">גולמי <span className="num">{sgn(x.gross, 0)}</span> לשנה</span></div>
                <div data-l="מחיר בפרמיה 20%"><S src={() => P.price(p20.p)}>{amt(p20.price)}</S><span className="s">{x.ct.val.basis === 'pb' ? 'P/B מוצדק' : 'P/E מוצדק, הזרוע'}</span></div>
                <div data-l="ערך ÷ מחיר"><S src={P.metric} neg={(x.metric ?? 0) < 0}>{pc(x.metric, 1)}</S></div>
                <div data-l="קיבולת"><S src={P.capacity}>{amt(x.capacity)}</S><span className={`cns-band ${band}`}>{BAND_HE[band]}</span></div>
                <div data-l="רווח למניה"><S src={() => P.eps(p20.p)} neg={(p20.eps ?? 0) < 0}>{pcS(p20.eps, 1)}</S><span className="s"><bdi>ROE</bdi> <span className="num">{sgn(p20.roe, 2)}</span> נ״א</span></div>
              </li>
            );
          })}
        </ol>
        <div className="cns-more">{!all ? <button type="button" className="chip" onClick={() => setAll(true)}>כל {R.length} הזוגות</button> : <button type="button" className="chip" onClick={() => setAll(false)}>עשרת הראשונים</button>}</div>
        <div className="src">סינרגיה = נכסי היעד × תשואת דמי ניהול × (יחס עלות היעד − יחס עלות הרוכשת): חיובית כשהרוכשת זולה יותר, לפי מוצר (פנסיה; גמל והשתלמות). ערך נוכחי = הסינרגיה × שיעור מימוש × (1 − מס) לאורך משך הספר (M3), פחות עלות אינטגרציה. מחיר = שווי מוצדק עצמאי × 1.2: P/B מוצדק לבית השקעות נסחר, P/E מוצדק לזרוע חיסכון של מבטחת. קיבולת = הון בר-חלוקה (<Link to="/capital">A7</Link>) או הון עצמי, ועוד מרווח חוב מול מינוף מרבי (<Link to="/debt">ת126</Link>). מסומן "לא בר השוואה": עלויות שאינן מוצגות במלואן; לא מדורג. מספרים אנליטיים, לא המלצה.</div>
      </Panel>

      <Panel title="מטריצה: ערך נוכחי של הסינרגיה" aside={<span>שורה = רוכשת · עמודה = יעד · צבע = קיבולת מול מחיר בפרמיה 20%</span>} className="cns-mx-panel">
        <div className="cns-mx" role="table" aria-label="ערך נוכחי של הסינרגיה, רוכשת מול יעד">
          <div className="r hd" role="row"><div role="columnheader" className="c0">רוכשת ↓ / יעד ←</div>{ids.map((t) => <div key={t} role="columnheader"><Dot id={t} />{nameOf(M, t)}</div>)}</div>
          {ids.map((a) => (
            <div className="r" role="row" key={a}>
              <div role="rowheader" className="c0"><Dot id={a} />{nameOf(M, a)}</div>
              {ids.map((t) => {
                if (a === t) return <div key={t} role="cell" className="self" aria-label="אותה חברה">·</div>;
                const r = by.get(`${a}__${t}`)!, x = r.x, p20 = p20Of(M, x), band = bandOf(p20.price, x.capacity), P = provsOf(M, x, lts);
                return (
                  <div key={t} role="cell" className={`cell ${x.npv < 0 ? 'negv' : band} ${x.nc ? 'nc' : ''}`} title={x.npv < 0 ? 'ערך נוכחי שלילי: הרוכשת יקרה מהיעד' : BAND_HE[band]}>
                    <S src={P.npv} cls="v">{sgn(x.npv)}</S>
                    <Link to={`/consolidation/${a}/${t}${q}`} aria-label={`דף העסקה: ${x.ca.name} ← ${x.ct.name}`}>{r.rank != null ? `#${r.rank}` : 'דף'}</Link>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cns-legend">{(['easy', 'ok', 'no', 'none'] as const).map((b) => <span key={b}><i className={`cns-sw ${b}`} aria-hidden="true" />{BAND_HE[b]}</span>)}<span><i className="cns-sw nc" aria-hidden="true" />לא בר השוואה (לא מדורג)</span><span><i className="cns-sw negv" aria-hidden="true" />ערך שלילי: הרוכשת יקרה מהיעד</span></div>
      </Panel>

      {M.meta.excluded.length > 0 && <div className="src">לא במסך: {M.meta.excluded.map((c, i) => <span key={c.id}>{i ? ' · ' : ''}<Link to={`/company/${c.id}`}>{c.name}</Link> ({c.why})</span>)}.</div>}
    </div>
  );
}

/* ---------------- /consolidation/<acq>/<tgt> ---------------- */
const SEG_HE: Record<Seg, string> = { pen: 'פנסיה', gem: 'גמל והשתלמות' };
export function ConsolidationPair() {
  const { a = '', t = '' } = useParams();
  const F = useLoad<MatrixFile>(MATRIX_PATH);
  const M = F.data;
  const ok = !!M && !!M.cos[a] && !!M.cos[t] && a !== t;
  const PF = useLoad<PairFile>(ok ? pairPath(a, t) : null);
  const MA = useLoad<MixFile>(ok ? mixPath(a) : null), MT = useLoad<MixFile>(ok ? mixPath(t) : null);
  const [A, set, reset] = useAssume(M);
  const x = useMemo<Pair | null>(() => (M && A && ok ? pairAt(M, a, t, A) : null), [M, A, ok, a, t]);
  const rank = useMemo(() => (M && A && ok ? screen(M, A).find((r) => r.x.a === a && r.x.t === t)?.rank ?? null : null), [M, A, ok, a, t]);
  if (F.error) return <ErrorBox what="מסך האיחודים" error={F.error} />;
  if (!M || !A) return <Loading what="דף העסקה" />;
  if (!ok || !x) return <Empty title="אין זוג כזה במסך האיחודים"><Link to="/consolidation">מסך האיחודים</Link></Empty>;
  const P = provsOf(M, x, lts), q = queryOf(M, A), p20 = p20Of(M, x), band = bandOf(p20.price, x.capacity);
  const mixes = MA.data && MT.data ? { [a]: MA.data, [t]: MT.data } : undefined;
  const fit = PF.data?.fit;
  const ins = !!x.ca.cap.scr;
  return (
    <div className="cap cns">
      <div className="pagehead"><div>
        <h1><span className="icotile"><Icon name="compare" /></span><Dot id={a} />{x.ca.name} ← <Dot id={t} />{x.ct.name}</h1>
        <div className="sub"><Link to={`/consolidation${q}`}>מסך האיחודים</Link><span>·</span><span>{rank != null ? <>דירוג <span className="num">{rank}</span></> : 'לא מדורג'}</span>{x.nc && <Nc t={[x.ca.nc_why, x.ct.nc_why].filter(Boolean).join('\n')} />}<span>·</span>
          <span>מיליוני ש״ח · LTM <span className="num">{M.meta.base.ltm[0]}–{M.meta.base.ltm[3]}</span></span><span>·</span><Link to={`/company/${a}`}>{x.ca.name}</Link><Link to={`/company/${t}`}>{x.ct.name}</Link><Link to={`/consolidation/${t}/${a}${q}`}>הכיוון ההפוך</Link></div>
      </div></div>

      <AssumeBar M={M} A={A} set={set} reset={reset} />

      <div className="cap-strip cns-strip">
        <div><span className="l">סינרגיה גולמית, לשנה</span><S src={P.grossT} neg={x.gross < 0}>{sgn(x.gross, 1)}</S><span className="s">לפני מס, לפני מימוש</span></div>
        <div><span className="l">סינרגיה נטו, לשנה</span><S src={P.netT} neg={x.net < 0}>{sgn(x.net, 1)}</S><span className="s">מימוש <span className="num">{fmt(A.r, 0)}%</span> <Est /></span></div>
        <div><span className="l">ערך נוכחי, גולמי</span><S src={P.npvG} neg={x.npv_g < 0}>{sgn(x.npv_g)}</S><span className="s">אחרי מס, בלי מימוש ואינטגרציה</span></div>
        <div className="hero"><span className="l">ערך נוכחי, נטו</span><S src={P.npv} neg={x.npv < 0}>{sgn(x.npv)}</S><span className="s">אינטגרציה <S src={P.ic} cls="num">{amt(x.ic)}</S> <Est /></span></div>
        <div><span className="l">מחיר בפרמיה {fmt(M.meta.primary, 0)}%</span><S src={() => P.price(p20.p)}>{amt(p20.price)}</S><span className="s">{x.ct.val.basis === 'pb' ? 'P/B מוצדק × הון (החברה כולה)' : 'P/E מוצדק × רווח הזרוע'} <Est t="קלט הערכה, לא מחיר שוק" /></span></div>
        <div><span className="l">ערך ÷ מחיר</span><S src={P.metric} neg={(x.metric ?? 0) < 0}>{pc(x.metric, 1)}</S><span className="s">המדד המדרג</span></div>
        <div><span className="l">קיבולת תשלום</span><S src={P.capacity}>{amt(x.capacity)}</S><span className={`cns-band ${band}`}>{BAND_HE[band]}</span></div>
      </div>

      <Panel title="סינרגיה לפי מוצר" aside={<span>נכסים {M.meta.asof.aum} · עלויות LTM</span>}>
        <div className="cns-t c9" role="group" aria-label="סינרגיה לפי מוצר">
          <div className="tr th"><div>מוצר</div><div>נכסי היעד</div><div>תשואת דמי ניהול</div><div>יחס עלות · יעד</div><div>יחס עלות · רוכשת</div><div>גולמית לשנה</div><div>נטו לשנה</div><div>אופק</div><div>ערך נוכחי</div></div>
          {x.rows.map((r) => (
            <div className="tr" key={r.s}>
              <div className="lbl">{SEG_HE[r.s]}</div>
              <div data-l="נכסי היעד"><S src={() => P.co(t, `products.${r.s}.aum`)}>{amt(r.aum)}</S></div>
              <div data-l="תשואת דמי ניהול"><S src={() => P.co(t, `products.${r.s}.fy`)}>{pc(r.fy, 3)}</S></div>
              <div data-l="יחס עלות · יעד"><S src={() => P.co(t, `products.${r.s}.ci`)}>{pc(r.cit, 1)}</S></div>
              <div data-l="יחס עלות · רוכשת"><S src={() => P.cia(r.s)}>{pc(r.cia, 1)}</S>{!r.own && <span className="s">הרוכשת אינה במוצר: היחס המשוקלל <Est /></span>}</div>
              <div data-l="גולמית לשנה"><S src={() => P.gross(r.s)} neg={r.gross < 0}>{sgn(r.gross, 1)}</S></div>
              <div data-l="נטו לשנה"><S src={() => P.net(r.s)} neg={r.net < 0}>{sgn(r.net, 1)}</S></div>
              <div data-l="אופק"><S src={() => P.h(r.s)}>{`${fmt(r.h, 1)}`}</S><span className="s">שנים{A.h == null ? ', משך הספר' : ''}</span></div>
              <div data-l="ערך נוכחי"><S src={() => P.npvS(r.s)} neg={r.npv < 0}>{sgn(r.npv)}</S></div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="cns-two">
        <Panel title="קיבולת תשלום" aside={<span>{x.ca.name}</span>}>
          <div className="cns-kv">
            <div><span className="l">קיבולת מזומן {x.ca.cap.kind === 'a7' ? <>· הון בר-חלוקה <Link to="/capital">A7</Link> {x.ca.cap.period}</> : '· הון עצמי'}</span><S src={P.cash}>{amt(x.cashCap)}</S>{x.ca.cap.kind !== 'a7' && <Est t="לחברה מנהלת אין הון בר-חלוקה (A7): ההון העצמי לבעלי המניות כתקרה" />}</div>
            <div><span className="l">קרן חוב (ת126)</span><S src={() => P.co(a, 'pnl.debt_total')}>{amt(x.ca.pnl.debt_total?.v)}</S></div>
            <div><span className="l">הון עצמי לבעלי המניות</span><S src={() => P.co(a, 'pnl.equity_end')}>{amt(x.ca.pnl.equity_end?.v)}</S></div>
            <div><span className="l">מינוף: חוב ÷ (חוב + הון)</span><S src={P.lev}>{pc(x.ca.lev.v, 1)}</S><span className="s">מרבי <S src={P.levMax} cls="num">{pc(A.lev, 1)}</S> <Est /></span></div>
            <div><span className="l">מרווח חוב</span><S src={P.room}>{amt(x.room)}</S></div>
            <div className="hero"><span className="l">קיבולת תשלום</span><S src={P.capacity}>{amt(x.capacity)}</S></div>
          </div>
        </Panel>
        <Panel title="התאמה: רכיבים, בלי ציון משוקלל" aside={<span>פנסיה וגמל</span>}>
          {!fit ? (PF.error ? <p className="muted">קובץ הזוג לא נטען</p> : <Loading what="רכיבי ההתאמה" />) : (
            <div className="cns-fit">
              <div className="row"><span className="l">חפיפת מוצרים · {fit.prod.period}</span><S src={() => xprov(M, fit.prod.v.prov, lts, mixes)}>{pc(fit.prod.v.v, 0)}</S>
                <span className="s">Σ min(משקל רוכשת, משקל יעד) על מוצרי הרשות</span>
                <ul className="bars">{[...fit.prod.rows].sort((p, r) => r.wa + r.wt - p.wa - p.wt).filter((r) => r.wa + r.wt >= 1).map((r) => <li key={r.key}><span className="k">{r.he}</span><span className="b" aria-hidden="true"><i className="a" style={{ width: `${r.wa}%` }} /><i className="t" style={{ width: `${r.wt}%` }} /></span><span className="num">{fmt(r.wa, 0)}% / {fmt(r.wt, 0)}%</span></li>)}</ul></div>
              <div className="row"><span className="l">צפיפות מסלולים · {fit.track.period}</span><S src={() => xprov(M, fit.track.v.prov, lts, mixes)}>{pc(fit.track.v.v, 0)}</S>
                <span className="s">אותו מדד על קטגוריות המסלול; <span className="num">{fit.track.n[0]}</span> ו-<span className="num">{fit.track.n[1]}</span> מסלולים</span>
                <ul className="bars">{fit.track.rows.slice(0, 6).map((r) => <li key={r.cat}><span className="k">{r.cat}</span><span className="b" aria-hidden="true"><i className="a" style={{ width: `${r.wa}%` }} /><i className="t" style={{ width: `${r.wt}%` }} /></span><span className="num">{fmt(r.wa, 0)}% / {fmt(r.wt, 0)}%</span></li>)}</ul></div>
              <div className="row"><span className="l">חפיפת ערוצי הפצה</span><span className="chip gap" title={fit.channel.why}>אין נתונים</span><span className="s">{fit.channel.why}</span></div>
              <div className="cns-legend"><span><i className="cns-sw a" aria-hidden="true" />{x.ca.name}</span><span><i className="cns-sw t" aria-hidden="true" />{x.ct.name}</span></div>
            </div>)}
        </Panel>
      </div>

      <Panel title="מחיר, מימון והשפעה" aside={<span>מזומן קודם, השאר חוב · LTM, סינרגיה בקצב מלא</span>}>
        <div className={`cns-t ${ins ? 'c9' : 'c8'}`} role="group" aria-label="מחיר, מימון והשפעה לפי פרמיה">
          <div className="tr th"><div>פרמיה</div><div>מחיר</div><div>מזומן</div><div>חוב</div><div>תוספת לרווח</div><div>רווח למניה</div><div><bdi>ROE</bdi></div><div><bdi>ROIC</bdi></div>{ins && <div>כושר פירעון</div>}</div>
          {x.prem.map((r) => (
            <div className={`tr ${r.p === M.meta.primary ? 'sel' : ''} ${r.ok ? '' : 'no'}`} key={r.p}>
              <div className="lbl">{fmt(r.p, 0)}%{!r.ok && <span className="chip gap" title="החוב הנדרש עולה על מרווח החוב">מעבר לקיבולת</span>}</div>
              <div data-l="מחיר"><S src={() => P.price(r.p)}>{amt(r.price)}</S></div>
              <div data-l="מזומן"><S src={() => P.cashP(r.p)}>{amt(r.cash)}</S></div>
              <div data-l="חוב"><S src={() => P.debtP(r.p)}>{amt(r.debt)}</S></div>
              <div data-l="תוספת לרווח"><S src={() => P.dnp(r.p)} neg={r.dnp < 0}>{sgn(r.dnp, 1)}</S></div>
              <div data-l="רווח למניה"><S src={() => P.eps(r.p)} neg={(r.eps ?? 0) < 0}>{pcS(r.eps, 1)}</S></div>
              <div data-l="ROE"><S src={() => P.roe(r.p)} neg={(r.roe ?? 0) < 0}>{sgn(r.roe, 2)}</S><span className="s">נ״א</span></div>
              <div data-l="ROIC"><S src={() => P.roic(r.p)}>{pc(r.roic, 1)}</S><span className="s"><bdi>ke</bdi> <span className="num">{fmt(x.ca.pnl.ke?.v, 1)}%</span></span></div>
              {ins && <div data-l="כושר פירעון"><S src={() => P.solv(r.p)} neg={(r.solv ?? 0) < 0}>{sgn(r.solv, 1)}</S><span className="s">נ״א · ברישום בחברת הביטוח <S src={() => P.solvGw(r.p)} cls="num">{sgn(r.solv_gw, 1)}</S></span></div>}
            </div>
          ))}
        </div>
        <div className="src">רווח היעד: {x.ct.val.basis === 'pb' ? 'רווח נקי לבעלי המניות LTM של החברה כולה' : 'רווח תפעולי אחרי מס של פנסיה וגמל'}. מזומן נושא rf אחרי מס, חוב rf + <span className="num">{fmt(A.kd, 2)}</span> נ״א <Est />. אין הנפקת מניות ואין הפחתת מוניטין. {ins ? 'כושר פירעון: המזומן מהעודף ÷ SCR (מנגנון A7); לחלופין, יעד שמוחזק בחברת הביטוח מוריד את ההון העצמי במוניטין (הנחה).' : 'הרוכשת אינה מבטחת: אין עלות כושר פירעון.'} מספרים אנליטיים, לא המלצה.</div>
      </Panel>
    </div>
  );
}
