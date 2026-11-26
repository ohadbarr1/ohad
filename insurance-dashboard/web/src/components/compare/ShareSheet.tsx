/* C10 · sharing (spec §4.10, 10A.2 C10; mockup v3 frame "share"): the page ends with "שליחה בווטסאפ" (primary) and "קישור", which opens
   this sheet: the exact address, "ווטסאפ", "העתקת קישור", and the phone's own share menu (navigator.share) when there is one.
   The link carries the tracks, the view, the range or period, the basis (b=gross when it is not the default) and the fee row's deposits
   switch when it is off (dep=0, only with a product that has an example deposit on screen; the shell applies it for the receiver's visit,
   review B2 N2) and nothing personal: the sheet state (sheet=…), an open source (src=…) and a focus hint are dropped.
   For the shell (lane L2-a): `useShareLink(keys, basis)` → { url, text, wa } gives the page-end WhatsApp button the same link and text:
   "השוואת מסלולים ב-fox: מגדל, הראל, מנורה · פנסיה מקיפה כללי · עד 10/26" + the link, wa = https://wa.me/?text=… */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { SheetProps, View } from '../../pages/compare/contract';
import { DeeperSheet } from '../DeeperSheet';
import type { Basis } from '../../lib/funds';
import { monthLabel } from '../../lib/format';
import { useCmpData } from './sheetKit';
import { count } from '../../lib/count';
import { hasDeposit } from '../../lib/feeExample';
import { useFeeDeposits } from './FeeSheet';

/** query keys that are state of the moment, not of the view */
const DROP = ['sheet', 'src', 'focus'];

/** the shareable address of the current view. The view is written out (v=months&r=6 too): without it the receiver's own remembered
 *  lens would open instead, so the page-end WhatsApp button and this sheet give one and the same link (review B1 #11) */
export function shareUrl(pathname: string, search: string, keys: string[], basis: Basis, view?: View, deposits = true): string {
  const q = new URLSearchParams(search);
  DROP.forEach((k) => q.delete(k));
  // the fee row's switch "בלי הפקדות": the receiver sees the same shekel figures as the sender
  if (deposits) q.delete('dep'); else q.set('dep', '0');
  if (keys.length) q.set('k', keys.join(','));
  if (view) {
    const months = view === 'm6' || view === 'm12' || view === 'y';
    q.set('v', months ? 'months' : view);
    if (months) q.set('r', view === 'm12' ? '12' : view === 'y' ? 'y' : '6'); else q.delete('r');
  }
  if (basis === 'gross' && !q.has('b')) q.set('b', 'gross');
  const s = q.toString().replace(/%2C/gi, ',');
  return `${location.origin}${pathname}${s ? `?${s}` : ''}`;
}
/** "השוואת מסלולים ב-fox: מגדל, הראל, מנורה · פנסיה מקיפה כללי · עד 10/26" */
export function shareText(labels: string[], cat: { prod: string; track: string } | null, asof: number | null): string {
  return ['השוואת מסלולים ב-fox: ' + labels.filter(Boolean).join(', '), cat ? `${cat.prod} ${cat.track}` : null, asof ? `עד ${monthLabel(asof)}` : null].filter(Boolean).join(' · ');
}
export const waHref = (text: string, url: string) => `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;

/** the link, its text and the WhatsApp address, for the sheet and the page-end button */
export function useShareLink(keys: string[], basis: Basis, enabled = true, view?: View): { url: string; text: string; wa: string } {
  const loc = useLocation();
  const d = useCmpData(keys, enabled);
  const [dep] = useFeeDeposits();
  const switchable = d.cols.some((c) => hasDeposit(c.f.prod));
  const url = shareUrl(loc.pathname, loc.search, keys, basis, view, switchable ? dep : true);
  const text = shareText(d.cols.map((c) => c.label), d.ck && d.cols[0] ? d.cols[0].f : null, d.asof);
  return { url, text, wa: waHref(text, url) };
}

export function ShareSheet({ keys, basis, view, open, onClose }: SheetProps) {
  const { url, text, wa } = useShareLink(keys, basis, open, view);
  const [done, setDone] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async () => {
    count('cmp_share', { channel: 'copy' });
    try { await navigator.clipboard.writeText(url); setDone('הקישור הועתק'); }
    catch {
      // no clipboard permission: select the address so the reader can copy it by hand
      const el = document.getElementById('share-url');
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }
      setDone('הקישור מסומן: להעתקה ידנית');
    }
  };
  const share = async () => { count('cmp_share', { channel: 'native' }); try { await navigator.share({ title: 'השוואת מסלולים', text, url }); } catch { /* the reader closed the menu */ } };
  return (
    <DeeperSheet open={open} onClose={onClose} id="share-sheet-dlg" title="שיתוף" sub="מי שיפתח יראה בדיוק את המסך הזה">
      <div id="share-sheet">
        <div className="cs-url" id="share-url" dir="ltr">{url}</div>
        <div className="cs-nav in">
          <a className="cs-btn pri" id="share-wa" href={wa} target="_blank" rel="noreferrer" onClick={() => count('cmp_share', { channel: 'wa' })}>ווטסאפ</a>
          <button type="button" className="cs-btn" id="share-copy" onClick={copy}>העתקת קישור</button>
          {canShare ? <button type="button" className="cs-btn" id="share-native" onClick={share}>שיתוף…</button> : null}
        </div>
        <p className="cs-note" role="status" aria-live="polite">{done ?? 'הקישור שומר את המסלולים, התצוגה, התקופה ואם התשואה אחרי דמי ניהול או לפניהם. אין בו שום פרט אישי.'}</p>
      </div>
    </DeeperSheet>
  );
}
