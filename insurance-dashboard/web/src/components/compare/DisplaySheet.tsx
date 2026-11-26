/* D6 · the display sheet (spec §4.9): the display pill of the agent and Pro doors opens it. Returns are always the published gross
   return (owner, 26.11.26: no net-of-fee basis; the fee a saver pays is negotiated and varies), so the sheet states the basis and, for
   agent and Pro, offers real or nominal (useReal, periods of a year and more). Opened in the saver door it states the basis only. */
import type { SheetProps } from '../../pages/compare/contract';
import { DeeperSheet } from '../DeeperSheet';
import { GROSS_STAMP, useReal } from '../../lib/funds';

export function DisplaySheet({ door, open, onClose }: SheetProps) {
  const [real, setReal] = useReal();
  const saver = door === 'saver';
  return (
    <DeeperSheet open={open} onClose={onClose} id="display-sheet-dlg" title="תצוגה" sub="חל על כל ההשוואה ונשמר לפעם הבאה">
      <div id="display-sheet">
        <div className="cs-fld">
          <b>תשואה</b>
          <p id="basis-note">{GROSS_STAMP}, לפני דמי ניהול. דמי הניהול שונים מחוסך לחוסך ונקבעים מול הגוף המנהל, ולכן אינם מנוכים מהתשואה; הם מוצגים בנפרד, בשקלים.</p>
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
