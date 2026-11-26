import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Takeaway } from '../../components/Takeaway';
import { StampLine } from '../../components/StampLine';
import { PensionPack } from '../../components/agent/PensionPack';
import { BmNote } from '../../components/agent/Decision';
import { ClientSave } from '../../components/agent/ClientSave';
import { isPension } from '../../lib/pensionPack';
import { ym, type FundX } from '../../lib/funds';
import { Kpi } from '../../components/ui';
import { Sourced } from '../../components/Source';
import { useOptional } from '../../lib/fundsLoad';
import { sn } from '../../lib/format';
import { actProv } from '../../lib/agentProv';
import { DECISION_PATH, SELF_REPORT, claimProv, companyOf, pc1, rankHe, svcOf, svcProv, type DecisionFile } from '../../lib/decision';
import type { CardCtx } from './CardMonths';
import '../../styles/compare-decision.css';
import '../../styles/fund-card.css';

/* Rollout T-C4, "להחלטה" (agent; spec §3.2 lenses, §3.6 #7; mockup v4 frame card_agent_dec): the decision tiles (fee and deposit fee,
   assets, exposures; the shell builds them from today's KPIs, every figure sourced), today's PensionPack unchanged on a pension track
   (actuarial balance with its quarters, default-fund status, service index, claims, coverage rules), BmNote on managers' insurance, the
   pinned client actions "מסמך ללקוח" (the client document, /funds/compare/print) and "שמירה לתיק לקוח" (ClientSave), and the way to every
   professional figure ("מקצועי"). Pro sees the same content as the first sections of "מקצועי". */

export const DEC_TAKE = 'נתוני החלטה ללקוח: דמי ניהול, יציבות אקטוארית, שירות ותביעות. כל מספר נפתח למקור.';
/** a track with no pension pack (build review B1, P2-3): the sentence promises only what the lens shows */
export const DEC_TAKE_PLAIN = 'נתוני החלטה ללקוח: דמי ניהול, נכסים וחשיפה למניות. כל מספר נפתח למקור.';
/** the pension pack's section (mockup v4: "נתוני החלטה · פנסיה מקיפה") */
export const DEC_PACK = 'נתוני החלטה · פנסיה מקיפה: איזון אקטוארי, ברירת מחדל, שירות ותביעות';
/** the collapsed pension pack under the tiles (coordinator 26.11.26: the lens budget becomes 2.0 screens) */
export const DEC_PACK_MORE = 'כל נתוני ההחלטה ›';
export const DEC_MORE = 'כל הנתונים המקצועיים: סיכון, משברים, חשיפות, תזרים ›';

export function CardDecision({ c, tiles }: { c: CardCtx; tiles: ReactNode }) {
  const { f, h } = c;
  return (
    <div className="fc-lens" id="lens-dec">
      <Takeaway id="takeaway" text={isPension(f) ? DEC_TAKE : DEC_TAKE_PLAIN} />
      <div className="fc-dec-tiles">{tiles}{isPension(f) ? <PensionTiles f={f} /> : null}</div>
      {isPension(f) ? (
        // build review B1 (P2-3) + coordinator 26.11.26: the three facts both reviewers asked for are tiles above (actuarial balance,
        // service index, claims); the whole pack stays one tap away, closed, so the lens holds ≤ 2.0 screens to the stamp
        <details className="fc-pack" id="dec-pack">
          <summary><span>{DEC_PACK_MORE}</span></summary>
          <div className="fc-sec-in"><PensionPack f={f} h={h} asof={c.asof} funds={c.funds as FundX[]} /></div>
        </details>
      ) : null}
      <BmNote f={f} />
      <ClientBar k={f.k} />
      <button type="button" className="ro-rowlink" id="to-pro" onClick={() => c.setView('pro')}><span>{DEC_MORE}</span></button>
      <StampLine asof={c.asof} onWhy={() => c.host.openSheet({ t: 'why' })} />
    </div>
  );
}

/** The pension decision facts as three compact tiles (rollout B1, coordinator 26.11.26): the latest actuarial balance and its quarter
 *  (funds.json `act`, the regulator's ACTUARIAL_ADJUSTMENT), the regulator's service index of the managing company (score of 100 and
 *  its place), and the company's own claims report (disability claims approved, closed within 30 days). Every figure opens its
 *  source (the same provenance as PensionPack); what is not published says so. */
function PensionTiles({ f }: { f: FundX }) {
  const d = useOptional<DecisionFile>(DECISION_PATH);
  const r = d ? svcOf(d, f.grp, 'pension') : null, c = d ? companyOf(d, f.grp)?.claims ?? null : null;
  const wait = d === undefined ? 'טוען…' : '–';
  return (
    <section className="kpis fc-dec-pen" id="dec-tiles" aria-label={DEC_PACK}>
      <Kpi label="איזון אקטוארי" tone={f.act == null ? undefined : f.act < 0 ? 'neg' : f.act > 0 ? 'pos' : undefined}
        value={f.act == null ? '–' : <Sourced src={() => actProv(f)}>{`${sn(f.act, 2)}%`}</Sourced>}
        sub={f.act == null ? 'לא דווח לרבעון האחרון' : <>רבעון <span className="num">{ym(f.act_p ?? 0)}</span></>} />
      <Kpi label="מדד השירות של הרשות"
        value={r && d ? <Sourced src={() => svcProv(d, f.grp, 'pension', 'total')}>{String(r.total)}</Sourced> : wait}
        sub={r && d ? <>מתוך 100 · <Sourced src={() => svcProv(d, f.grp, 'pension', 'rank')}>{`מקום ${rankHe(r)}`}</Sourced></> : d === undefined ? ' ' : 'לא במדד של הרשות'} />
      <Kpi label="תביעות נכות שאושרו"
        value={c && d && c.disability.approved != null ? <Sourced src={() => claimProv(d, f.grp, 'disability', 'approved')}>{pc1(c.disability.approved)}</Sourced> : wait}
        sub={c && d ? <>{SELF_REPORT}, <span className="num">{c.year}</span>{c.disability.closed[0] != null ? <> · תוך 30 יום <Sourced src={() => claimProv(d, f.grp, 'disability', 'closed0')}>{pc1(c.disability.closed[0])}</Sourced></> : null}</> : d === undefined ? ' ' : 'לא פורסם'} />
    </section>
  );
}

/** the pinned bar: the client document and the client folder (as compare's "להחלטה" lens), for this one track */
export function ClientBar({ k }: { k: string }) {
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bar.current, rail = document.querySelector<HTMLElement>('.rail');
    if (!el) return;
    const set = () => { const fixed = !!rail && getComputedStyle(rail).position === 'fixed', rb = fixed ? Math.round(rail!.getBoundingClientRect().height) : 0;
      el.style.setProperty('--abar-b', `${rb}px`); };
    set();
    const ro = new ResizeObserver(set); if (rail) ro.observe(rail); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="cmp-abar fc-abar" ref={bar} id="dec-actions">
      <Link className="cmp-abtn pri" id="dec-doc" to={`/funds/compare/print?k=${k}`}>מסמך ללקוח</Link>
      <ClientSave keys={[k]} b="gross" label="שמירה לתיק לקוח" />
    </div>
  );
}
