import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import '../styles/rollout.css';

/* <NumField>: a whole number typed on a phone (rollout spec §17.2 Input, T-F4). A text field with the numeric keypad
   (type="text", inputmode="numeric": iOS shows digits and keeps the field free of the browser's own number parsing), thousands
   separators inserted as the reader types ("420000" → "420,000"; off for an age), the value parsed by stripping everything that is not
   a digit, at most nine digits. Empty → null. The caret stays after the digit the reader just typed. */

export const NUM_MAX_DIGITS = 9;
/** the digits of what was typed, at most `max` (Arabic-Indic and Persian digits read as 0–9) */
export function digitsOf(s: string, max = NUM_MAX_DIGITS): string {
  const d = s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0)).replace(/\D/g, '');
  return d.replace(/^0+(?=\d)/, '').slice(0, max);
}
/** "420000" → "420,000" (sep) */
export const groupDigits = (d: string, sep = true): string => (sep ? d.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : d);
/** the value of a field's text: null when empty */
export const parseNum = (s: string, max = NUM_MAX_DIGITS): number | null => { const d = digitsOf(s, max); return d === '' ? null : Number(d); };
/** the text shown for a value */
export const showNum = (v: number | null | undefined, sep = true): string => (v == null || !Number.isFinite(v) ? '' : groupDigits(String(Math.max(0, Math.round(v))), sep));
/** where the caret goes after re-formatting: after the same count of digits as before it */
export function caretAfter(text: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) { if (/\d/.test(text[i])) seen++; if (seen === digitsBefore) return i + 1; }
  return text.length;
}

export interface NumFieldProps {
  id: string;
  label: ReactNode;
  value: number | null;
  onChange: (v: number | null) => void;
  unit?: ReactNode;            // "ש״ח" (default) / "שנים"
  placeholder?: string;        // "למשל 250,000"
  sep?: boolean;               // thousands separators (default true; the age field: false)
  maxDigits?: number;          // default 9
  hint?: ReactNode;            // a line under the field
  autoFocus?: boolean;
}

export const NumField = forwardRef<HTMLInputElement, NumFieldProps>(function NumField(
  { id, label, value, onChange, unit = 'ש״ח', placeholder, sep = true, maxDigits = NUM_MAX_DIGITS, hint, autoFocus }, outer,
) {
  const inner = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(() => showNum(value, sep));
  const caret = useRef<number | null>(null);
  // a value set from outside (cleared, loaded): show it, unless it is what the field already holds
  useEffect(() => { if (parseNum(text, maxDigits) !== value) setText(showNum(value, sep)); }, [value]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = inner.current, c = caret.current;
    if (el && c != null && document.activeElement === el) { try { el.setSelectionRange(c, c); } catch { /* not a text field on this engine */ } }
    caret.current = null;
  }, [text]);
  return (
    <label className="ro-fld" htmlFor={id}>
      <b>{label}</b>
      <span className="ro-num">
        <input
          ref={(el) => { inner.current = el; if (typeof outer === 'function') outer(el); else if (outer) outer.current = el; }}
          id={id} type="text" inputMode="numeric" autoComplete="off" enterKeyHint="done" dir="ltr" spellCheck={false}
          value={text} placeholder={placeholder} autoFocus={autoFocus}
          onChange={(e) => {
            const raw = e.target.value, at = e.target.selectionStart ?? raw.length;
            const before = digitsOf(raw.slice(0, at), 99).length;
            const d = digitsOf(raw, maxDigits), next = groupDigits(d, sep);
            caret.current = caretAfter(next, Math.min(before, d.length));
            setText(next);
            onChange(d === '' ? null : Number(d));
          }}
        />
        {unit ? <em>{unit}</em> : null}
      </span>
      {hint ? <small className="ro-fld-hint">{hint}</small> : null}
    </label>
  );
});
