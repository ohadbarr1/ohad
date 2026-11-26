import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Takeaway } from '../../components/Takeaway';
import { StampLine } from '../../components/StampLine';
import { PensionPack } from '../../components/agent/PensionPack';
import { BmNote } from '../../components/agent/Decision';
import { ClientSave } from '../../components/agent/ClientSave';
import { isPension } from '../../lib/pensionPack';
import type { FundX } from '../../lib/funds';
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
export const DEC_MORE = 'כל הנתונים המקצועיים: סיכון, משברים, חשיפות, תזרים ›';

export function CardDecision({ c, tiles }: { c: CardCtx; tiles: ReactNode }) {
  const { f, h } = c;
  return (
    <div className="fc-lens" id="lens-dec">
      <Takeaway id="takeaway" text={isPension(f) ? DEC_TAKE : DEC_TAKE_PLAIN} />
      <div className="fc-dec-tiles">{tiles}</div>
      {isPension(f) ? (
        // build review B1 (P2-3): open by default in this lens, the decision data in view without a tap (closed inside "מקצועי")
        <details className="fc-pack" id="dec-pack" open>
          <summary><span>{DEC_PACK}</span></summary>
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
