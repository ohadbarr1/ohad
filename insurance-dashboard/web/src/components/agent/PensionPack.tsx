import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Sourced } from '../Source';
import { Tip } from '../Explain';
import { Icon } from '../Icon';
import { fundP } from '../../lib/market';
import { refOf, ym, type FundX } from '../../lib/funds';
import { useOptional } from '../../lib/fundsLoad';
import type { DefaultFile } from '../../lib/fundsTools';
import { nf, sn } from '../../lib/format';
import { ACT_F, actHistory, defaultHits, isPension, periodText, type ActPoint } from '../../lib/pensionPack';
import { BAND_HE, bandOf, feeDist } from '../../lib/feeDist';
import { actProv, actQProv, actSumProv, pc2, pctProv, tenderProv } from '../../lib/agentProv';
import { ClaimsCell, CoverDefault, SvcCell } from './Decision';  // W2
import { DECISION_PATH, type DecisionFile } from '../../lib/decision';
import './glossary';
import '../../styles/agent.css';

/* W1 · agent door: the pension decision pack on a pension track's card (and, compact, inside the compare and the client document).
   Three facts an agent needs before the הנמקה and Yossi found missing: the actuarial balance with its quarter and its recent history,
   whether the fund is a default fund now (the tender, its period and the price it set), and both fees, average actual, against the
   product's median manager. What the regulator's open files do not carry is named, not guessed. Renders nothing for other products. */

/* W2: the service index (the regulator's) and the claims report (the company's own) are here now, at the managing company's level */
export const PENSION_MISSING = 'לא במאגרים הפתוחים ולכן לא מוצגים: מקדמי ההמרה לקצבה של הקרן ועלות הכיסוי הביטוחי (נכות ושאירים) בפועל. מדד השירות (רשות שוק ההון, 2025) ודוח התביעות (דיווח החברה, 2025) הם ברמת החברה המנהלת, לא ברמת הקרן או המסלול';

/** the actuarial history as a strip of bars, quarter by quarter (a picture; the figures are the buttons under it) */
function ActBars({ xs }: { xs: ActPoint[] }) {
  if (xs.length < 2) return null;
  const max = Math.max(0.05, ...xs.map((x) => Math.abs(x.v))), W = 18, G = 6, H = 40;
  return (
    <svg className="ppk-bars" viewBox={`0 0 ${xs.length * (W + G) - G} ${H}`} aria-hidden="true" preserveAspectRatio="none">
      <line x1="0" x2={xs.length * (W + G)} y1={H / 2} y2={H / 2} className="ax" />
      {xs.map((x, i) => { const h = (Math.abs(x.v) / max) * (H / 2 - 2); return <rect key={x.p} x={i * (W + G)} y={x.v >= 0 ? H / 2 - h : H / 2} width={W} height={Math.max(1, h)} rx="2" className={x.v >= 0 ? 'up' : 'dn'} />; })}
    </svg>
  );
}

export function PensionPack({ f, h, asof, funds, compact = false }: { f: FundX; h?: { p: number[]; act?: (number | null)[] } | null; asof: number; funds?: FundX[]; compact?: boolean }) {
  const dfile = useOptional<DefaultFile>('funds/default.json');
  const pension = isPension(f);
  const hits = useMemo(() => (pension ? defaultHits(f.k, dfile, asof) : []), [pension, f.k, dfile, asof]);
  const bench = useMemo(() => (pension && funds?.length ? feeDist(funds, f.prod, null, 'mgr') : null), [pension, funds, f.prod]);
  const dec = useOptional<DecisionFile>(DECISION_PATH);  // W2
  if (!pension) return null;
  const now = hits.find((x) => x.current) ?? null, past = hits.filter((x) => !x.current);
  // W2: the last eight published quarters from funds.json (act_h) when the build has them, else from the track's own history
  const hx: ActPoint[] = f.act_h?.length ? f.act_h.slice(-8).map(([p, v]) => ({ p, v })) : actHistory(h, 8);
  const tone = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const feeSrc = (c: 'fee' | 'depfee') => () => fundP(refOf(f), f.end ?? asof, c === 'fee' ? 'AVG_ANNUAL_MANAGEMENT_FEE' : 'AVG_DEPOSIT_FEE', c === 'fee' ? 'דמי ניהול מצבירה, ממוצע בפועל' : 'דמי ניהול מהפקדה, ממוצע בפועל', pc2(f[c]));
  const Bench = ({ c }: { c: 'fee' | 'depfee' }) => {
    const p = bench?.[c].pcts, v = f[c];
    if (!p || !bench) return null;
    return <span className="ppk-bench"><Sourced src={() => pctProv(bench, c, 'p50', asof, funds!)}>חציון <span className="num">{pc2(p.p50)}</span></Sourced>{v != null && <span className="chip">{BAND_HE[bandOf(v, p)]}</span>}</span>;
  };
  return (
    <section className={`panel ppk${compact ? ' compact' : ''}`} aria-labelledby={`ppk-${f.k}`}>
      <div className="hd"><h2 id={`ppk-${f.k}`}>נתוני החלטה · {f.prod}</h2><div className="aside"><span className="chip">פנסיה-נט</span><span className="num">{ym(asof)}</span></div></div>
      <div className="ppk-grid">
        <div className="ppk-cell">
          <div className="ppk-l">איזון אקטוארי <Tip k="actuarial" /></div>
          {f.act == null ? <div className="ppk-none">הקרן לא דיווחה איזון אקטוארי לרבעון האחרון</div> : <>
            <div className="ppk-v"><Sourced className={`num ${tone(f.act)}`} src={() => actProv(f)}>{sn(f.act, 2)}%</Sourced><span className="ppk-q">רבעון {ym(f.act_p ?? asof)}</span></div>
            <ActBars xs={hx} />
            {hx.length > 1 && <div className="ppk-hist" role="list" aria-label="איזון אקטוארי לפי רבעון">{hx.map((x) => <span role="listitem" key={x.p}><span className="dim num">{ym(x.p)}</span><Sourced className={`num ${tone(x.v)}`} src={() => actQProv(f, x)}>{sn(x.v, 2)}</Sourced></span>)}</div>}
            {hx.length > 1 && <div className="ppk-s">מצטבר ב-{hx.length} רבעונים: <Sourced src={() => actSumProv(f, hx)}><span className="num">{pc2((hx.reduce((t, x) => t * (1 + x.v / 100), 1) - 1) * 100)}</span></Sourced></div>}
          </>}
        </div>
        <div className="ppk-cell">
          <div className="ppk-l">קרן ברירת מחדל <Tip k="default" /></div>
          {dfile === undefined ? <div className="ppk-none">טוען…</div> : dfile === null ? <div className="ppk-none">קובץ קרנות ברירת המחדל לא פורסם</div> : now ? <>
            <div className="ppk-v"><span className="ppk-flag"><Icon name="shield" />קרן נבחרת</span><span className="ppk-q">{now.t.label ?? 'הליך'} · <span className="num">{periodText(now.t)}</span></span></div>
            <div className="ppk-s">מחיר ההליך לעמית שהצטרף דרכו: <Sourced src={() => tenderProv(now.t, 'המחיר בהליך', `${pc2(now.depfee)} / ${pc2(now.fee)}`)}><span className="num">{pc2(now.depfee)}</span> מהפקדה + <span className="num">{pc2(now.fee)}</span> מצבירה</Sourced>{now.t.fee_years ? `, ל-${now.t.fee_years} שנים מההצטרפות` : ''}</div>
            {now.t.alloc && <div className="ppk-s dim">{now.t.alloc}</div>}
          </> : <>
            <div className="ppk-v"><span className="ppk-flag off">לא קרן ברירת מחדל</span></div>
            <div className="ppk-s">בהליך שבתוקף ב-{ym(asof)}{(() => { const t = dfile.tenders?.find((x) => x.winners?.length && Number(x.from.slice(0, 4)) * 100 + Number(x.from.slice(5, 7)) <= asof && asof <= Number(x.to.slice(0, 4)) * 100 + Number(x.to.slice(5, 7))); return t ? <> ({periodText(t)}): <Sourced src={() => tenderProv(t, 'הזוכות', t.winners.map((w) => w.grp).join(', '))}>{t.winners.map((w) => w.grp).join(' · ')}</Sourced></> : null; })()}</div>
          </>}
          {past.length > 0 && <div className="ppk-s dim">נבחרה גם {past.map((x) => `ב${(x.t.label ?? `הליך ${x.t.id}`).replace(/^ה/, '')} (\u2066${periodText(x.t)}\u2069)`).join(', ')}</div>}
          {!compact && <Link className="ppk-more" to="/funds/default">כל ההליכים</Link>}
        </div>
        <div className="ppk-cell">
          <div className="ppk-l">דמי ניהול <span className="dim">ממוצע בפועל</span> <Tip k="depfee" /></div>
          <div className="ppk-fees">
            <div><span className="dim">מהפקדה</span>{f.depfee == null ? <span className="muted">–</span> : <Sourced src={feeSrc('depfee')}><span className="num ppk-big">{pc2(f.depfee)}</span></Sourced>}<Bench c="depfee" /></div>
            <div><span className="dim">מצבירה</span>{f.fee == null ? <span className="muted">–</span> : <Sourced src={feeSrc('fee')}><span className="num ppk-big">{pc2(f.fee)}</span></Sourced>}<Bench c="fee" /></div>
          </div>
          {bench?.fee.pcts && <div className="ppk-s dim">חציון של {nf(bench.fee.pcts.n, 0)} קבוצות מנהלות ב{f.prod}, כל אחת משוקללת בנכסיה</div>}
          {!compact && <Link className="ppk-more" to={`/managers?fd=${encodeURIComponent(f.prod)}`}>התפלגות דמי הניהול</Link>}
        </div>
      </div>
      {/* W2: the company's service and claims, then the default coverage of a comprehensive fund */}
      <div className="ppk-grid ppk-row2">
        <SvcCell d={dec} grp={f.grp} />
        <ClaimsCell d={dec} grp={f.grp} />
      </div>
      {!compact && dec && f.prod === 'פנסיה מקיפה' && <CoverDefault d={dec} />}
      {!compact && <div className="fnote">{ACT_F}. {PENSION_MISSING}.{dec && <> <Link to="/managers?v=svc">מדד השירות ודוחות התביעות של כל החברות</Link>.</>}</div>}
    </section>
  );
}
