import { useState, type ReactNode } from 'react';
import { useMedia } from '../../lib/useMedia';
import { StampLine } from '../../components/StampLine';
import type { CardCtx } from './CardMonths';
import '../../styles/fund-card.css';

/* Rollout T-C5, "מקצועי" (spec §3.2 lenses, §3.6, §17.3, §18.1; mockup v4 frame card_pro_pro): every panel of today's card, in today's
   order, each a closed section with its title except the first ("מדדים", open). The panels themselves are today's components and JSX,
   built by the shell (pages/Funds.tsx FundCard) exactly as before and only wrapped here: every figure still opens its source, every
   export stays. A closed section is not mounted (its charts would measure a hidden box). "נומינלי · ריאלי" at the top opens the display
   sheet (returns are the published gross; real is the only choice left). Desktop (900 px and wider): every section open. */

export interface ProSection { id: string; title: string; node: () => ReactNode }

export const PRO_HEAD = 'כל מה שהיה בכרטיס, באותו סדר';
export const PRO_DISPLAY = 'נומינלי · ריאלי';

export function CardPro({ c, sections }: { c: CardCtx; sections: ProSection[] }) {
  const wide = useMedia('(min-width: 900px)');
  return (
    <div className="fc-lens fc-pro" id="lens-pro">
      <div className="fc-prohead">
        <span>{PRO_HEAD}</span>
        <button type="button" className="fc-pill" id="display-btn" onClick={() => c.host.openSheet({ t: 'display' })} aria-haspopup="dialog">{PRO_DISPLAY}</button>
      </div>
      {sections.map((s, i) => <Section key={s.id} s={s} first={i === 0} wide={wide} />)}
      <StampLine asof={c.asof} onWhy={() => c.host.openSheet({ t: 'why' })} />
    </div>
  );
}

function Section({ s, first, wide }: { s: ProSection; first: boolean; wide: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const on = open ?? (first || wide);
  return (
    <details className="fc-sec" id={s.id} open={on} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== on) setOpen(o); }}>
      <summary><span>{s.title}</span></summary>
      {on ? <div className="fc-sec-in">{s.node()}</div> : null}
    </details>
  );
}
