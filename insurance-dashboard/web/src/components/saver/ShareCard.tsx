import { useState } from 'react';

/* S2 saver · the share card: "חסכתי כ-X ש"ח בדמי ניהול עם fox" as a square PNG (1080 × 1080, WhatsApp status and Instagram size), drawn
   in this browser. It carries the rounded amount and the horizon only: no name, fund, fee, age or balance. Shared through the phone's
   share sheet when the browser can share files, else downloaded. One of the brand's few expressive moments: the ember-to-magenta
   gradient is allowed here. */

const W = 1080;
const SITE = 'fox-research-il.web.app';

/** draw the card; `amount` is already rounded text ("12,300 ש"ח"), `when` the horizon ("עד הפרישה") */
export function drawCard(amount: string, when: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = W;
  const x = cv.getContext('2d')!;
  // warm ink, an ember glow in one corner
  x.fillStyle = '#16120F'; x.fillRect(0, 0, W, W);
  const glow = x.createRadialGradient(W * 0.85, W * 0.1, 40, W * 0.85, W * 0.1, W * 0.9);
  glow.addColorStop(0, 'rgba(255,110,60,0.42)'); glow.addColorStop(0.5, 'rgba(214,40,110,0.16)'); glow.addColorStop(1, 'rgba(22,18,15,0)');
  x.fillStyle = glow; x.fillRect(0, 0, W, W);
  const band = x.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0, '#D6286E'); band.addColorStop(1, '#FF6A3D');
  x.fillStyle = band; x.fillRect(0, W - 14, W, 14);

  x.direction = 'rtl'; x.textAlign = 'right';
  const R = W - 96;
  x.fillStyle = '#F3EEE8'; x.font = '500 54px Heebo, Arial, sans-serif';
  x.fillText('חסכתי כ-', R, 340);
  // the amount, in the gradient
  x.font = '800 150px Heebo, Arial, sans-serif';
  const g = x.createLinearGradient(96, 0, R, 0);
  g.addColorStop(0, '#FF7A45'); g.addColorStop(1, '#FFB36B');
  x.fillStyle = g;
  x.fillText(amount, R, 520, W - 192);
  x.fillStyle = '#F3EEE8'; x.font = '600 58px Heebo, Arial, sans-serif';
  x.fillText('בדמי ניהול', R, 620);
  x.font = '400 44px Heebo, Arial, sans-serif'; x.fillStyle = '#CFC6BC';
  x.fillText(`${when}, עם fox`, R, 690);
  x.font = '400 34px Heebo, Arial, sans-serif'; x.fillStyle = '#B7ADA2';
  x.fillText('אומדן בשקלי היום, על הנחות שמוצגות באתר.', R, 760);
  x.fillStyle = '#F3EEE8'; x.font = '500 38px Heebo, Arial, sans-serif';
  x.fillText('בדיקה שנתית לחיסכון: חינם, בלי הרשמה, בלי לידים.', R, 900, W - 192);
  // the wordmark and the address, left to right
  x.direction = 'ltr'; x.textAlign = 'left';
  x.font = '800 72px Heebo, Arial, sans-serif'; x.fillStyle = '#F3EEE8';
  x.fillText('fox', 96, 150);
  const fw = x.measureText('fox').width;
  x.fillStyle = '#FF6A3D'; x.fillText('.', 96 + fw, 150);
  x.font = '400 34px Heebo, Arial, sans-serif'; x.fillStyle = '#CFC6BC';
  x.fillText(SITE, 96, 1000);
  return cv;
}

/** a file download (an object URL, revoked after the click) */
export function saveBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const toBlob = (cv: HTMLCanvasElement) => new Promise<Blob | null>((res) => cv.toBlob((b) => res(b), 'image/png'));

export function ShareCard({ amount, when }: { amount: string; when: string }) {
  const [st, setSt] = useState<'idle' | 'busy' | 'saved' | 'shared' | 'fail'>('idle');
  const go = async () => {
    setSt('busy');
    try {
      if ('fonts' in document) await (document as Document & { fonts: FontFaceSet }).fonts.ready;
      const blob = await toBlob(drawCard(amount, when));
      if (!blob) { setSt('fail'); return; }
      const file = new File([blob], 'fox-chisachon.png', { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], text: `חסכתי כ-${amount} בדמי ניהול עם fox · https://${SITE}` }); setSt('shared'); return; }
        catch (e) { if (e instanceof Error && e.name === 'AbortError') { setSt('idle'); return; } }
      }
      saveBlob('fox-chisachon.png', blob); setSt('saved');
    } catch { setSt('fail'); }
  };
  return (
    <div className="ck-share">
      <button type="button" className="btn" onClick={() => void go()} disabled={st === 'busy'}>{st === 'busy' ? 'מכין…' : 'כרטיס לשיתוף (תמונה)'}</button>
      <span className="sv-muted" role="status">{st === 'saved' ? 'התמונה נשמרה בהורדות.' : st === 'shared' ? 'נשלח לשיתוף.' : st === 'fail' ? 'הדפדפן לא הצליח ליצור תמונה.' : 'בתמונה רק הסכום המעוגל: בלי שם, קרן, דמי ניהול או יתרה.'}</span>
    </div>
  );
}
