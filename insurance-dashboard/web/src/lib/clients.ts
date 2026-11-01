/* W3 · agent door, "תיקי לקוחות": a comparison saved under a client's label, in this browser only (localStorage, fox:clients), with a
   JSON file to carry it to another device. Nothing here is sent anywhere, and no client data goes into a URL: a folder opens by its
   random id through the router's state, never through the address.

   Storage format (v1), the same in the browser and in the exported file:
     { kind: "fox-clients", v: 1, exported?: "yyyy-mm-dd", folders: [ Folder, … ] }
     Folder = { id, label, keys: ["p2009", …] (≤ 8 track keys), b: "net"|"gross", tags: { k: "קיים"|"מומלץ"|"נבחן" },
                fields: { "<field id>": "typed text" } (the הנמקה worksheet), note, created, updated (ISO dates) }
   Pure helpers below (normalise, merge, upsert); the hook is the only part that touches storage. */
import { useStored } from './local';

export type Tag = 'קיים' | 'מומלץ' | 'נבחן';
export const TAGS: Tag[] = ['קיים', 'מומלץ', 'נבחן'];
export interface Folder { id: string; label: string; keys: string[]; b: 'net' | 'gross'; tags: Record<string, Tag>; fields: Record<string, string>; note: string; created: string; updated: string }
export interface ClientsFile { kind: 'fox-clients'; v: 1; exported?: string; folders: Folder[] }
export const CLIENTS_KEY = 'clients';
export const EMPTY: ClientsFile = { kind: 'fox-clients', v: 1, folders: [] };
export const KEY_RE = /^[gip]\d+$/;
const MAX_KEYS = 8, MAX_FOLDERS = 500, MAX_FIELD = 4000;

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const isoD = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : '');
export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14));

/** one folder as stored, or null when it is not one */
export function normFolder(x: unknown): Folder | null {
  const o = x as Partial<Folder>;
  if (!o || typeof o !== 'object') return null;
  const label = str(o.label, 80).trim();
  const keys = Array.isArray(o.keys) ? [...new Set(o.keys.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)))].slice(0, MAX_KEYS) : [];
  if (!label || !keys.length) return null;
  const tags: Record<string, Tag> = {};
  if (o.tags && typeof o.tags === 'object') for (const [k, v] of Object.entries(o.tags)) if (keys.includes(k) && TAGS.includes(v as Tag)) tags[k] = v as Tag;
  const fields: Record<string, string> = {};
  if (o.fields && typeof o.fields === 'object') for (const [k, v] of Object.entries(o.fields).slice(0, 200)) if (/^[\w:.-]{1,60}$/.test(k) && typeof v === 'string' && v.trim()) fields[k] = v.slice(0, MAX_FIELD);
  const created = isoD(o.created) || isoD(o.updated) || '1970-01-01';
  return { id: typeof o.id === 'string' && /^[\w-]{4,40}$/.test(o.id) ? o.id : newId(), label, keys, b: o.b === 'gross' ? 'gross' : 'net', tags, fields, note: str(o.note, MAX_FIELD), created, updated: isoD(o.updated) || created };
}

/** the stored value (or an imported file) made safe: unknown shapes give an empty list */
export function normClients(x: unknown): ClientsFile {
  const o = x as Partial<ClientsFile>;
  const fs = o && typeof o === 'object' && Array.isArray(o.folders) ? o.folders.map(normFolder).filter((f): f is Folder => !!f) : [];
  const seen = new Set<string>();
  return { kind: 'fox-clients', v: 1, folders: fs.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true))).slice(0, MAX_FOLDERS) };
}

export type FolderIn = Pick<Folder, 'label' | 'keys'> & Partial<Pick<Folder, 'id' | 'b' | 'tags' | 'fields' | 'note'>>;
/** Saves a folder: by id when it has one, else by its label (case and spaces ignored), else a new folder. Fields left out keep their
 *  stored value (saving from the compare page keeps the worksheet typed on the print page). */
export function upsert(file: ClientsFile, f: FolderIn, today: string): { file: ClientsFile; folder: Folder; created: boolean } {
  const lab = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const i = file.folders.findIndex((x) => (f.id ? x.id === f.id : lab(x.label) === lab(f.label)));
  const patch = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
  if (i >= 0) {
    const old = file.folders[i];
    const folder = normFolder({ ...old, ...patch, id: old.id, created: old.created, updated: today })!;
    return { file: { ...file, folders: file.folders.map((x, j) => (j === i ? folder : x)) }, folder, created: false };
  }
  const folder = normFolder({ ...patch, id: newId(), created: today, updated: today })!;
  return { file: { ...file, folders: [folder, ...file.folders] }, folder, created: true };
}

/** An imported file merged in: a folder with the same id is replaced only when the import is newer. */
export function mergeClients(file: ClientsFile, incoming: unknown): { file: ClientsFile; added: number; updated: number } {
  const inc = normClients(incoming);
  let added = 0, updated = 0;
  const folders = [...file.folders];
  for (const f of inc.folders) {
    const i = folders.findIndex((x) => x.id === f.id);
    if (i < 0) { folders.push(f); added++; } else if (f.updated > folders[i].updated) { folders[i] = f; updated++; }
  }
  return { file: { ...file, folders: folders.slice(0, MAX_FOLDERS) }, added, updated };
}

export const removeFolder = (file: ClientsFile, id: string): ClientsFile => ({ ...file, folders: file.folders.filter((f) => f.id !== id) });

/** the folders, newest first */
export const sorted = (file: ClientsFile) => [...file.folders].sort((a, b) => b.updated.localeCompare(a.updated) || a.label.localeCompare(b.label, 'he'));

/** the export file's text */
export const exportText = (file: ClientsFile, today: string) => JSON.stringify({ ...normClients(file), exported: today, note: 'תיקי לקוחות של סוכן: מסלולים להשוואה וטיוטת הנמקה. נשמר בדפדפן בלבד; הקובץ פרטי.' }, null, 1);

/** the hook: the folders of this browser, always well-formed */
export function useClients(): [ClientsFile, (f: ClientsFile) => void] {
  const [raw, set] = useStored<unknown>(CLIENTS_KEY, EMPTY);
  return [normClients(raw), set];
}

/** the state a router link carries to open a folder (never the URL) */
export interface FolderNav { folder: string }
export const folderOfState = (s: unknown): string | null => (s && typeof s === 'object' && typeof (s as FolderNav).folder === 'string' ? (s as FolderNav).folder : null);
