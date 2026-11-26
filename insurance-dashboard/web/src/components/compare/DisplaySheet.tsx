/* D6 · the display sheet (spec §4.9): the "נטו" pill of the agent and Pro doors opens it. Basis (net / gross: lib/funds useBasis, kept
   per browser as funds:basis and in the address when the address carries it) and, for agent and Pro, real or nominal (useReal,
   periods of a year and more). The saver has no basis control above the fold: their switch lives in "איך מחשבים?" (WhySheet), and if
   this sheet is opened in the saver door it speaks plain words ("אחרי דמי ניהול / לפני דמי ניהול") and offers no real/nominal. */
import type { SheetProps } from '../../pages/compare/contract';
import { DeeperSheet } from '../DeeperSheet';
import { useBasis, useReal } from '../../lib/funds';
import { BasisSwitch } from './WhySheet';

export function DisplaySheet({ door, open, onClose }: SheetProps) {
  const [basis] = useBasis();
  const [real, setReal] = useReal();
  const saver = door === 'saver';
  return (
    <DeeperSheet open={open} onClose={onClose} id="display-sheet-dlg" title="תצוגה" sub="חל על כל ההשוואה ונשמר לפעם הבאה">
      <div id="display-sheet">
        <div className="cs-fld">
          <b>תשואה</b>
          <BasisSwitch plain={saver} />
          <p>{basis === 'net'
            ? (saver ? 'אחרי דמי ניהול: התשואה שרשות שוק ההון מפרסמת, פחות דמי הניהול הממוצעים במסלול. זה אומדן: דמי הניהול שלך יכולים להיות אחרים.' : 'נטו: אחרי דמי הניהול מהצבירה. אומדן של האתר לפי דמי הניהול הממוצעים במסלול; דמי הניהול של חוסך מסוים יכולים להיות שונים.')
            : (saver ? 'לפני דמי ניהול: כפי שרשות שוק ההון מפרסמת.' : 'ברוטו: לפני דמי ניהול, כפי שרשות שוק ההון מפרסמת.')}</p>
        </div>
        {saver ? null : (
          <div className="cs-fld">
            <b>מדד המחירים</b>
            <div className="cs-seg" role="group" aria-label="נומינלי או ריאלי">
              <button type="button" className={real ? '' : 'on'} aria-pressed={!real} onClick={() => setReal(false)}>נומינלי</button>
              <button type="button" className={real ? 'on' : ''} aria-pressed={real} onClick={() => setReal(true)}>ריאלי</button>
            </div>
            <p>ריאלי: אחרי ניכוי עליית מדד המחירים לצרכן (הלמ״ס). חל על תקופות של שנה ומעלה; תשואה חודשית מוצגת נומינלית.</p>
          </div>
        )}
      </div>
    </DeeperSheet>
  );
}
