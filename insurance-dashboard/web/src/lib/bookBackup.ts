/* fox 3.0 phase 2 · the whole book as one encrypted backup file (no server). The client folders, the agent's branding and the
   call-list marks, sealed under a passphrase the agent types (lib/clients `seal`: PBKDF2-SHA-256 310,000 rounds → AES-256-GCM, the
   share file's envelope with its own kind). Made and opened in this browser only; nothing is sent anywhere. A restore merges: a folder
   with the same id is replaced only when the backup's copy is newer (lib/clients mergeClients), the branding fills an empty one, the
   handled marks are added. Pure apart from Web Crypto, so tests/agentDesk.unit.ts runs it in node. */
import { mergeClients, normClients, seal, unseal, isSealed, type ClientsFile } from './clients';
import { normCalls, type CallsState } from './agentDesk';

export const BOOK_KIND = 'fox-book-backup';
export interface BookPayload { kind: 'fox-clients'; v: 2; folders: ClientsFile['folders']; brand?: unknown; calls?: CallsState; exported: string }
export const backupName = (today: string) => `fox-book-${today}.backup.json`;
export const isBookBackup = (x: unknown) => isSealed(x, BOOK_KIND);

export async function encryptBook(file: ClientsFile, brand: unknown, calls: CallsState | null | undefined, pass: string, today: string): Promise<string> {
  const p: BookPayload = { kind: 'fox-clients', v: 2, folders: normClients(file).folders, ...(brand ? { brand } : {}), ...(calls ? { calls } : {}), exported: today };
  return seal(BOOK_KIND, p, pass, today, `${p.folders.length} תיקים`);
}
export interface Opened { file: ClientsFile; brand: unknown | null; calls: CallsState | null; exported: string | null }
export async function decryptBook(text: string, pass: string): Promise<Opened> {
  const x = (await unseal(text, pass, BOOK_KIND, 'קובץ גיבוי מוצפן של fox')) as Partial<BookPayload>;
  const file = normClients(x);
  return { file, brand: x && typeof x.brand === 'object' ? x.brand : null, calls: x?.calls ? normCalls(x.calls) : null, exported: typeof x?.exported === 'string' ? x.exported.slice(0, 10) : null };
}
/** a restore: the backup merged into this browser's book; the handled marks of both kept */
export function restoreInto(file: ClientsFile, calls: CallsState, o: Opened): { file: ClientsFile; calls: CallsState; added: number; updated: number } {
  const r = mergeClients(file, o.file);
  const handled = { ...(o.calls?.handled ?? {}), ...calls.handled };
  return { file: r.file, calls: { ...calls, handled }, added: r.added, updated: r.updated };
}
