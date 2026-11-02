import { useRef, useState } from 'react';
import { copyText } from '../ui';

/** A ready-to-copy text (the note to the agent, W7: the letter to the employer), with a copy button and a fallback for browsers that
 *  block the clipboard (select the text, execCommand, else ask to copy by hand). `label`: the accessible name of the text box. */
export function Script({ text, label = 'הודעה לסוכן או לחברה המנהלת', note = 'עובדות ומספרים בלבד, בלי המלצה. כדאי לבדוק מול הדוח לפני השליחה.' }: { text: string; label?: string; note?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<'idle' | 'ok' | 'manual'>('idle');
  const fallback = () => {
    const el = ref.current, sel = window.getSelection();
    if (!el || !sel) return setSt('manual');
    const r = document.createRange(); r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r);
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    setSt(ok ? 'ok' : 'manual');
  };
  return (
    <div className="sv-script">
      <div ref={ref} className="sv-script-t" role="textbox" aria-readonly="true" aria-multiline="true" aria-label={label} tabIndex={0}>{text}</div>
      <div className="sv-script-a">
        <button type="button" className="btn" onClick={() => copyText(text, (ok) => (ok ? setSt('ok') : fallback()))}>{st === 'ok' ? 'הועתק ✓' : 'העתקה'}</button>
        <span className="sv-muted" role="status">{st === 'manual' ? 'הדפדפן חסם העתקה: הטקסט מסומן, אפשר להעתיק ידנית.' : note}</span>
      </div>
    </div>
  );
}
