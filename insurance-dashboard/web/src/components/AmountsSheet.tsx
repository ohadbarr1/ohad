import { useEffect, useRef, useState } from 'react';
import { DeeperSheet } from './DeeperSheet';
import { backThen } from './Sheet';
import { NumField } from './NumField';
import { useMyAmounts, type AmountsTarget, type SaveResult } from '../lib/myAmounts';
import { useMyAge } from '../lib/mine';
import { toast } from '../lib/sheetHost';
import '../styles/rollout.css';

/* <AmountsSheet>: "הסכומים שלי" for ONE product (rollout spec §16.1 2a, §17.1 1a/1d/1e/1g/1h, §17.2, §18.2 #3; T-F4). Pages only mount
   it (the fees tool's "הסכומים שלי", /my's "להזין את שלי ›", the product sheet); the amounts are read and written through
   lib/myAmounts useMyAmounts only.
   - Sub-title names the product: "מגדל · פנסיה כללי · נשמר בדפדפן הזה, לכל מוצר בנפרד".
   - Fields (NumField: numeric keypad, separators while typing): "כמה יש לי היום במוצר הזה" and, where the product's type charges a
     deposit fee (`deposits`), "כמה מפקידים בחודש (אני והמעסיק)". A type with no deposit fee: the balance only (18.2 #3). `withAge`
     (the fees tool's "עד הפרישה" lens) adds "הגיל שלי" (no separators) and the deposit field in every product (deposits grow the
     balance the fee is charged on).
   - Save: an empty balance clears the product's amounts (back to the example); a zero asks first, inside the sheet (#zero-ask: "כן, 0"
     saves it, "לתקן" empties the field and focuses it; the typed deposit is kept); then the sheet closes, the page scrolls to the top
     and the notice says "נשמר בדפדפן הזה" (or, storage blocked, "לא נשמר: …", the figures still change for this tab).
   - "חזרה לדוגמה" (when the product has amounts) clears them. */

export const SAVED = 'נשמר בדפדפן הזה';
export const BLOCKED = 'לא נשמר: הדפדפן חוסם שמירה. המספרים יישארו עד סגירת הלשונית.';
export const BACK_TO_EXAMPLE = 'חזרה לדוגמה';

export interface AmountsSheetProps {
  open: boolean;
  onClose: () => void;
  target: AmountsTarget;     // which product's amounts (lib/myAmounts resolveAmounts)
  name: string;              // "מגדל · פנסיה כללי" (or the product: "פנסיה")
  deposits: boolean;         // the deposit field (false: a type where no track charges a deposit fee)
  withAge?: boolean;         // the "עד הפרישה" lens: the age, and the deposit field whatever `deposits` says
  onSaved?: (r: SaveResult) => void;
  id?: string;
}

const AGE_MIN = 18, AGE_MAX = 66;

export function AmountsSheet({ open, onClose, target, name, deposits, withAge = false, onSaved, id = 'sheet-amounts' }: AmountsSheetProps) {
  const a = useMyAmounts(target);
  const [age, setAge] = useMyAge();
  const [bal, setBal] = useState<number | null>(a.balance);
  const [dep, setDep] = useState<number | null>(a.monthly);
  const [ag, setAg] = useState<number | null>(age);
  const [zero, setZero] = useState(false);
  const balRef = useRef<HTMLInputElement>(null);
  const showDep = deposits || withAge;
  // the stored amounts arrive (or change in another tab) before the reader types: show them
  const touched = useRef(false);
  useEffect(() => { if (!touched.current) { setBal(a.balance); setDep(a.monthly); } }, [a.balance, a.monthly]);

  const finish = (r: SaveResult, text: string) => {
    onSaved?.(r);
    // after the sheet has unmounted and handed the focus back (that restore can move the page on WebKit): then to the top
    backThen(() => { toast(text); setTimeout(() => requestAnimationFrame(() => window.scrollTo({ top: 0 })), 0); });
  };
  const save = (confirmZero = false) => {
    if (bal === 0 && !confirmZero) { setZero(true); return; }
    if (withAge && ag != null && ag >= AGE_MIN && ag <= AGE_MAX && ag !== age) setAge(ag);
    const r = a.set({ balance: bal, monthly: showDep ? dep : null });
    finish(r, r === 'blocked' ? BLOCKED : SAVED);
  };
  const clear = () => { const r = a.clear(); finish(r, r === 'blocked' ? BLOCKED : BACK_TO_EXAMPLE); };
  const fix = () => { setZero(false); setBal(null); requestAnimationFrame(() => balRef.current?.focus()); };

  const footer = zero ? undefined : (
    <>
      <button type="button" className="cs-btn pri" id="save-amounts" onClick={() => save()}>שמירה</button>
      {a.own ? <button type="button" className="cs-btn ro-flexnone" id="clear-amounts" onClick={clear}>{BACK_TO_EXAMPLE}</button> : null}
    </>
  );
  return (
    <DeeperSheet open={open} onClose={onClose} id={id} title="הסכומים שלי" sub={`${name} · נשמר בדפדפן הזה, לכל מוצר בנפרד`} footer={footer}>
      <form className="ro-amt" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <NumField ref={balRef} id="in-bal" label="כמה יש לי היום במוצר הזה" value={bal} placeholder="למשל 250,000"
          onChange={(v) => { touched.current = true; setBal(v); if (zero && v !== 0) setZero(false); }} />
        {showDep ? (
          <NumField id="in-dep" label="כמה מפקידים בחודש (אני והמעסיק)" value={dep} placeholder="למשל 3,000"
            onChange={(v) => { touched.current = true; setDep(v); }} />
        ) : null}
        {withAge ? (
          <NumField id="in-age" label="הגיל שלי" value={ag} placeholder="למשל 52" unit="שנים" sep={false} maxDigits={2} onChange={setAg} />
        ) : null}
        {zero ? (
          <div className="ro-zero" id="zero-ask" role="alert">
            <p><b>יתרה 0?</b> אם עדיין אין חיסכון במוצר הזה, החישוב יהיה על ההפקדות בלבד.</p>
            <div className="ro-zero-btns">
              <button type="button" className="cs-btn pri" onClick={() => save(true)}>כן, 0</button>
              <button type="button" className="cs-btn" onClick={fix}>לתקן</button>
            </div>
          </div>
        ) : null}
        <p className="cs-note">{showDep ? 'שני המספרים כתובים בדוח השנתי מהחברה.' : 'הסכום כתוב בדוח השנתי מהחברה.'} שדה ריק נשאר על הדוגמה.</p>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </DeeperSheet>
  );
}
