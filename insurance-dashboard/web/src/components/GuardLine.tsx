import type { ReactNode } from 'react';
import '../styles/compare.css';

/* <GuardLine>: one yellow line instead of a refusal or a disclaimer wall (spec §5.3, §6.3, v3 §4.0b row 7, §10A.2 C5).
   kind 'risk' (different risk levels), 'product' (different products: tax and liquidity), 'oldgen' (an old-generation policy).
   With onOpen it is one line, 44 px high, the text cut with an ellipsis and "עוד ›" at the end, and the whole line opens the sheet;
   without onOpen it is a quiet note that may wrap. */

export type GuardKind = 'risk' | 'product' | 'oldgen';
export interface GuardLineProps {
  kind: GuardKind;
  text: ReactNode;
  onOpen?: () => void;
  more?: string;             // default "עוד ›"
  id?: string;               // e.g. "cross-line"
  textId?: string;           // id on the text span (e.g. "month-insight" when the line replaces the sentence)
  wrap?: boolean;            // allow several lines even with onOpen
}

const Warn = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3zM12 10v4M12 17v.5" /></svg>
);

export function GuardLine({ kind, text, onOpen, more = 'עוד ›', id, textId, wrap = false }: GuardLineProps) {
  const cls = `guard ${kind}${onOpen && !wrap ? ' one' : ''}`;
  if (!onOpen) return <div className={cls} id={id} role="note"><Warn /><span id={textId}>{text}</span></div>;
  return (
    <button type="button" className={cls} id={id} onClick={onOpen} aria-haspopup="dialog">
      <Warn /><span id={textId}>{text}</span><u>{more}</u>
    </button>
  );
}
