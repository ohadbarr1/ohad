import type { ReactNode } from 'react';
import { NumText } from './NumText';
import '../styles/rollout.css';

/* <Takeaway>: one generated sentence (rollout spec §2.3, §2.4). `lead`: the bordered card with the ember bar, when the sentence comes
   first (a page about one thing: the card, /my, the hub, the fees tool with an own track); `quiet`: the sparkle line under a table, as on
   compare. The sentence comes from lib/pageWords as a string whose figures are wrapped in LRI … PDI: give it as `text` and every figure,
   range and bracketed figure renders as one LTR-isolated run (components/NumText). `children` for anything else. */

/** compare's sparkle (pages/compare/CompareMonths), drawn the same */
const Spark = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" /></svg>;

export interface TakeawayProps {
  text?: string | null;
  children?: ReactNode;
  tone?: 'lead' | 'quiet';
  id?: string;              // "month-insight" on the card, "takeaway" elsewhere
  after?: ReactNode;        // a quiet tail in the same block ("מסלול חדש: פורסמו 3 חודשים.")
}

export function Takeaway({ text, children, tone = 'lead', id = 'takeaway', after }: TakeawayProps) {
  const body = text != null ? <NumText t={text} /> : children;
  if (body == null || body === '') return null;
  if (tone === 'quiet') {
    return (
      <div className="ro-quiet">
        <span className="ro-spark"><Spark /></span>
        <span id={id}>{body}{after ? <> <span className="ro-take-after">{after}</span></> : null}</span>
      </div>
    );
  }
  return <div className="ro-take" id={id}>{body}{after ? <> <span className="ro-take-after">{after}</span></> : null}</div>;
}
