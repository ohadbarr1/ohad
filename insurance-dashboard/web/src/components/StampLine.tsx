import type { ReactNode } from 'react';
import { GROSS_STAMP } from '../lib/funds';
import '../styles/rollout.css';

/* <StampLine>: source, month, basis, the line on the past and "איך מחשבים?" (rollout spec §2.3, §18.1 rule 2):
   "רשות שוק ההון · 10/26 · תשואה ברוטו, כפי שמפורסמת · העבר אינו מבטיח עתיד · איך מחשבים?". `extra` goes after the basis (the fees
   board: " · על הסכומים שלך"). Compare keeps its own Stamp. The month is one LTR-isolated run. "איך מחשבים?" is a 44-px-high target
   inside the running line (no line of its own). */

/** "10/26" */
export const stampMonth = (asof: number) => `${String(asof % 100).padStart(2, '0')}/${String(Math.floor(asof / 100)).slice(2)}`;

export interface StampLineProps {
  asof: number;                 // yyyymm
  basis?: ReactNode;            // default "תשואה ברוטו, כפי שמפורסמת"
  extra?: ReactNode;            // after the basis, its own separator included by the caller or not: rendered as " · {extra}"
  onWhy: () => void;            // opens WhySheet ("איך מחשבים?")
  id?: string;                  // default "stamp"
}

export function StampLine({ asof, basis = GROSS_STAMP, extra, onWhy, id = 'stamp' }: StampLineProps) {
  return (
    <p className="ro-stamp" id={id}>
      רשות שוק ההון · <bdi dir="ltr" className="sgnum">{stampMonth(asof)}</bdi> · {basis}{extra ? <> · {extra}</> : null} · העבר אינו מבטיח עתיד ·{' '}
      <button type="button" onClick={onWhy} aria-haspopup="dialog">איך מחשבים?</button>
    </p>
  );
}
