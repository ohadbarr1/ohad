/* Red team 06.11.26 (bring-back) · the saver's own encrypted backup: everything /my and /my/checkup keep in this browser (the products,
   age, sex, retirement age, salary, the check-up's negotiations and status, for every household profile) as one file sealed under a
   passphrase the saver types. The crypto is the agent's (lib/clients `seal` / `unseal`: PBKDF2-SHA-256 → AES-256-GCM), with its own
   kind, so nothing is duplicated and an agent's book backup is never read as a saver's. Safari may erase a site's storage after 7 days
   without a visit: the file is the copy that survives. Made and opened in this browser only; nothing is sent. Pure apart from Web
   Crypto, so tests/checkup.unit.ts runs it in node. */
import { seal, unseal, isSealed } from './clients';
import { PER_PROFILE_KEYS, PROFILES_KEY } from './household';

export const SAVER_KIND = 'fox-saver-backup';
export const saverBackupName = (today: string) => `fox-chisachon-${today}.backup.json`;
export const isSaverBackup = (x: unknown) => isSealed(x, SAVER_KIND);

/** the stored keys (without the prefix) a saver backup carries: the per-profile keys of every profile, and the profile list */
export function saverKeys(all: string[]): string[] {
  return all.filter((k) => k === PROFILES_KEY || PER_PROFILE_KEYS.includes(k.split('@')[0])).sort();
}
export interface SaverPayload { kind: 'fox-saver'; v: 1; values: Record<string, unknown>; exported: string }

/** the values (key → stored value) sealed under the passphrase (8 characters or more), as the file's text */
export async function encryptSaver(values: Record<string, unknown>, pass: string, today: string): Promise<string> {
  const keep = Object.fromEntries(saverKeys(Object.keys(values)).map((k) => [k, values[k]]));
  const n = Array.isArray(keep.mine) ? keep.mine.length : 0;
  const p: SaverPayload = { kind: 'fox-saver', v: 1, values: keep, exported: today };
  return seal(SAVER_KIND, p, pass, today, n ? `${n} מוצרים` : undefined);
}
/** the values inside a saver backup; throws (in Hebrew) on a wrong passphrase, a damaged file or another kind of file. Only the saver's
 *  own keys come back out, whatever the file holds. */
export async function decryptSaver(text: string, pass: string): Promise<{ values: Record<string, unknown>; exported: string | null }> {
  const x = (await unseal(text, pass, SAVER_KIND, 'קובץ גיבוי של החיסכון שלי')) as Partial<SaverPayload> | null;
  const v = x && x.kind === 'fox-saver' && x.values && typeof x.values === 'object' ? x.values : {};
  const values = Object.fromEntries(saverKeys(Object.keys(v)).map((k) => [k, (v as Record<string, unknown>)[k]]));
  return { values, exported: typeof x?.exported === 'string' ? x.exported.slice(0, 10) : null };
}
