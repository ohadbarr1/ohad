/* W7 (wave 2, agent door) · the agent's branding on the client document: name, licence number, phone, e-mail, company, logo. Kept in
   this browser only (localStorage, fox:agent:brand), never sent anywhere; carried in the clients backup file (lib/clients exportText /
   mergeClients) so a second device gets it with the folders. The logo is a data URL, resized in the browser to ≤ LOGO_MAX_PX on its long
   side and re-encoded until it is ≤ LOGO_MAX_BYTES (the circular allows "הוספת סימנים מסחריים (כגון: לוגו)" and nothing else to change in
   the document's text or order: חוזר סוכנים ויועצים 2018-10-11, נספח, §3(ג)). The older keys agent:name / agent:lic (W1) are read once
   as a migration. Pure parts (normBranding, logo size checks) are node-testable; the resize needs a browser canvas. */
import { readStored, useStored, writeStored } from './local';

export const BRAND_KEY = 'agent:brand';
export const LOGO_MAX_BYTES = 200_000;
export const LOGO_MAX_PX = 480;
export interface Branding { v: 1; name: string; lic: string; phone: string; email: string; co: string; coId: string; addr: string; logo: string | null }
export const EMPTY_BRAND: Branding = { v: 1, name: '', lic: '', phone: '', email: '', co: '', coId: '', addr: '', logo: null };

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
/** a stored or imported value made safe (an oversized or non-image logo is dropped) */
export function normBranding(x: unknown): Branding {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const logo = typeof o.logo === 'string' && /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(o.logo) && logoBytes(o.logo) <= LOGO_MAX_BYTES ? o.logo : null;
  return { v: 1, name: str(o.name, 80), lic: str(o.lic, 20).replace(/[^\d]/g, ''), phone: str(o.phone, 30), email: str(o.email, 120), co: str(o.co, 120), coId: str(o.coId, 20), addr: str(o.addr, 160), logo };
}
/** the byte size of a base64 data URL's payload */
export function logoBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1), pad = (b64.match(/=+$/) ?? [''])[0].length;
  return Math.floor((b64.length * 3) / 4) - pad;
}
export const hasBrand = (b: Branding) => !!(b.name || b.lic || b.phone || b.email || b.co || b.logo);
/** "שם, רישיון 12345 · 050-… · a@b" for the header and the signature block */
export function brandLine(b: Branding): string {
  const who = [b.name, b.lic ? `רישיון ${b.lic}` : ''].filter(Boolean).join(', ');
  return [who, b.co ? `${b.co}${b.coId ? ` (ח.פ. ${b.coId})` : ''}` : '', b.phone, b.email].filter(Boolean).join(' · ');
}

/** the branding of this browser, migrated from the W1 keys the first time */
export function readBranding(): Branding {
  const raw = readStored<unknown>(BRAND_KEY, null);
  if (raw) return normBranding(raw);
  const name = readStored<string>('agent:name', ''), lic = readStored<string>('agent:lic', '');
  return normBranding({ name, lic });
}
export function writeBranding(b: Branding): void { writeStored(BRAND_KEY, normBranding(b)); }
export function useBranding(): [Branding, (b: Branding) => void] {
  const [raw, set] = useStored<unknown>(BRAND_KEY, null);
  const b = raw ? normBranding(raw) : readBranding();
  return [b, (n) => set(normBranding(n))];
}

/** the file as a data URL, resized on a canvas to ≤ LOGO_MAX_PX and re-encoded (PNG first, then JPEG at falling quality) until it is
 *  ≤ LOGO_MAX_BYTES; rejects with a Hebrew message when it cannot be read or cannot be made small enough */
export async function resizeLogo(file: Blob): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('הקובץ אינו תמונה');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('לא ניתן לקרוא את התמונה')); i.src = url; });
    const s = Math.min(1, LOGO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('הדפדפן אינו תומך בהקטנת תמונה');
    ctx.drawImage(img, 0, 0, w, h);
    const tries: [string, number | undefined][] = [['image/png', undefined], ['image/jpeg', 0.9], ['image/jpeg', 0.75], ['image/jpeg', 0.6], ['image/jpeg', 0.45]];
    for (const [type, q] of tries) { const d = cv.toDataURL(type, q); if (logoBytes(d) <= LOGO_MAX_BYTES) return d; }
    throw new Error(`הלוגו גדול מ-${Math.round(LOGO_MAX_BYTES / 1000)} KB גם אחרי הקטנה: בחרו תמונה פשוטה יותר`);
  } finally { URL.revokeObjectURL(url); }
}
