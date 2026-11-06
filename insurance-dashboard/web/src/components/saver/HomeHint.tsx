import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStored } from '../../lib/local';

/* Red team 06.11.26 (bring-back) · one dismissible line on iPhone / iPad Safari: add fox to the home screen. Safari may erase a site's
   storage after 7 days without a visit; a home-screen app is not subject to that, but keeps its own storage (separate from Safari's),
   so the line points to the encrypted backup to carry the data over. The data stays on the device either way. Nowhere
   else (not in an installed app, not in Chrome or Firefox on iOS, not on desktop). */
const isIOSSafari = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
};
const standalone = () => typeof window !== 'undefined' && ((navigator as Navigator & { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches);

export function HomeHint() {
  const [off, setOff] = useStored<boolean>('my:a2hs-off', false);
  const [show] = useState(() => isIOSSafari() && !standalone());
  if (!show || off) return null;
  return (
    <p className="sv-note sv-a2hs" role="note">
      <span>טיפ לאייפון: הוסיפו את fox למסך הבית (שיתוף ← "הוספה למסך הבית"), ושם הנתונים לא נמחקים. הם נשארים רק במכשיר; מעבירים אותם ב<Link className="sv-u" to="/my/checkup#sv-safe">גיבוי מוצפן</Link>.</span>{' '}
      <button type="button" className="linkbtn" onClick={() => setOff(true)} aria-label="סגירת ההודעה">סגירה</button>
    </p>
  );
}
