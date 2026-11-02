/* W3 · agent door, "תיקי לקוחות": a comparison saved under a client's label, in this browser only (localStorage, fox:clients), with a
   JSON file to carry it to another device. Nothing here is sent anywhere, and no client data goes into a URL: a folder opens by its
   random id through the router's state, never through the address.

   Storage format (v2, W4), the same in the browser and in the exported file:
     { kind: "fox-clients", v: 2, exported?: "yyyy-mm-dd", folders: [ Folder, … ] }
     Folder = { id, label, keys: ["p2009", …] (≤ 8 track keys), b: "net"|"gross", tags: { k: "קיים"|"מומלץ"|"נבחן" },
                fields: { "<field id>": "typed text" } (the הנמקה worksheet), note, created, updated (ISO dates),
                snap: Snap | null (the figures the client was shown, frozen at the save: lib/compareDoc),
                held: Held[] (the client's own products from a clearing-house file: balances, their fees, insurance cover) }
   v1 folders (no snap, no held) are read as v2 with snap null: they open on today's data and say so. Nothing in a folder is an ID
   number. Pure helpers below (normalise, merge, upsert); the hook is the only part that touches storage. */
import { useStored } from './local';

export type Tag = 'קיים' | 'מומלץ' | 'נבחן';
export const TAGS: Tag[] = ['קיים', 'מומלץ', 'נבחן'];
/** the folder format this build writes */
export const CLIENTS_V = 2;

/** one track as the client document showed it (lib/compareDoc builds it; every figure as published or computed then) */
export interface SnapRow {
  k: string; name: string; prod: string; track: string; id: number | null; mgr: string; grp: string; pen: boolean; old: boolean;
  y12: number | null; a3: number | null; a5: number | null; a3g: number | null; fee: number | null; depfee: number | null;
  sharpe: number | null; sd: number | null; mdd: number | null; st: number | null; act: number | null; act_p: number | null;
  /** the default-fund tender in force: its period and price; null = not a default fund; undefined = not known */
  dflt?: { t: string; depfee: number | null; fee: number | null } | null;
  svc?: { total: number; rank: number; of: number } | null; clm?: number | null;
  /** the published fee's range over the last 36 months (old-generation tracks, whose fee moves) */
  feeRange?: [number, number] | null;
}
/** the figures and the bottom line the client was shown, frozen when the folder was saved */
export interface Snap { at: string; asof: number; b: 'net' | 'gross'; rows: SnapRow[]; bottom: string[] }
/** an insurance cover read from a clearing-house file (no insured person's details) */
export interface Cover { name: string; kind: string | null; sum: number | null; cost: number | null; rate: number | null }
/** a product of the client's, from a clearing-house file: the provider's, as the file gives it */
export interface Held {
  k: string | null; typeHe: string; provider: string | null; plan: string | null; track: string | null;
  balance: number | null; monthly: number | null; fee: number | null; feeHow: string | null; depfee: number | null; depHow: string | null;
  asof: string | null; covers: Cover[]; note: string | null;
}
export interface Folder { id: string; label: string; keys: string[]; b: 'net' | 'gross'; tags: Record<string, Tag>; fields: Record<string, string>; note: string; created: string; updated: string; snap: Snap | null; held: Held[] }
export interface ClientsFile { kind: 'fox-clients'; v: 2; exported?: string; folders: Folder[] }
export const CLIENTS_KEY = 'clients';
export const EMPTY: ClientsFile = { kind: 'fox-clients', v: 2, folders: [] };
export const KEY_RE = /^[gip]\d+$/;
const MAX_KEYS = 8, MAX_FOLDERS = 500, MAX_FIELD = 4000;

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
const numN = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const strN = (x: unknown, max: number): string | null => (typeof x === 'string' && x.trim() ? x.slice(0, max) : null);

function normRow(x: unknown, keys: string[]): SnapRow | null {
  const o = x as Record<string, unknown>;
  if (!o || typeof o !== 'object' || typeof o.k !== 'string' || !keys.includes(o.k)) return null;
  const d = o.dflt as Record<string, unknown> | null | undefined;
  const sv = o.svc as Record<string, unknown> | null | undefined;
  const fr = Array.isArray(o.feeRange) && o.feeRange.length === 2 && o.feeRange.every((v) => numN(v) != null) ? [o.feeRange[0], o.feeRange[1]] as [number, number] : null;
  return {
    k: o.k, name: str(o.name, 200) || o.k, prod: str(o.prod, 120), track: str(o.track, 120), id: numN(o.id), mgr: str(o.mgr, 200), grp: str(o.grp, 120), pen: o.pen === true, old: o.old === true,
    y12: numN(o.y12), a3: numN(o.a3), a5: numN(o.a5), a3g: numN(o.a3g), fee: numN(o.fee), depfee: numN(o.depfee), sharpe: numN(o.sharpe), sd: numN(o.sd), mdd: numN(o.mdd), st: numN(o.st), act: numN(o.act), act_p: numN(o.act_p),
    dflt: d === undefined ? undefined : d && typeof d === 'object' && typeof d.t === 'string' ? { t: d.t.slice(0, 20), depfee: numN(d.depfee), fee: numN(d.fee) } : null,
    svc: sv === undefined ? undefined : sv && typeof sv === 'object' && numN(sv.total) != null && numN(sv.rank) != null && numN(sv.of) != null ? { total: sv.total as number, rank: sv.rank as number, of: sv.of as number } : null,
    clm: o.clm === undefined ? undefined : numN(o.clm), feeRange: fr,
  };
}
/** a stored snapshot made safe, or null */
export function normSnap(x: unknown, keys: string[]): Snap | null {
  const o = x as Partial<Snap>;
  if (!o || typeof o !== 'object' || !isoD(o.at) || !Number.isInteger(o.asof) || (o.asof as number) < 199001 || (o.asof as number) > 210012) return null;
  const rows = Array.isArray(o.rows) ? o.rows.map((r) => normRow(r, keys)).filter((r): r is SnapRow => !!r) : [];
  if (!rows.length) return null;
  return { at: isoD(o.at), asof: o.asof as number, b: o.b === 'gross' ? 'gross' : 'net', rows, bottom: Array.isArray(o.bottom) ? o.bottom.filter((t): t is string => typeof t === 'string').slice(0, 40).map((t) => t.slice(0, 600)) : [] };
}
function normCover(x: unknown): Cover | null {
  const o = x as Record<string, unknown>;
  if (!o || typeof o !== 'object') return null;
  const name = strN(o.name, 200);
  if (!name) return null;
  return { name, kind: strN(o.kind, 80), sum: numN(o.sum), cost: numN(o.cost), rate: numN(o.rate) };
}
/** a held product made safe (an ID-shaped string anywhere is dropped) */
export function normHeld(x: unknown): Held | null {
  const o = x as Record<string, unknown>;
  if (!o || typeof o !== 'object') return null;
  const safe = (v: unknown, max: number) => { const t = strN(v, max); return t && /\d{8,}/.test(t) ? null : t; };
  const typeHe = safe(o.typeHe, 80);
  if (!typeHe) return null;
  return {
    k: typeof o.k === 'string' && KEY_RE.test(o.k) ? o.k : null, typeHe, provider: safe(o.provider, 120), plan: safe(o.plan, 160), track: safe(o.track, 160),
    balance: numN(o.balance), monthly: numN(o.monthly), fee: numN(o.fee), feeHow: safe(o.feeHow, 80), depfee: numN(o.depfee), depHow: safe(o.depHow, 80),
    asof: isoD(o.asof) || null, covers: Array.isArray(o.covers) ? o.covers.map(normCover).filter((c): c is Cover => !!c).slice(0, 40) : [], note: safe(o.note, 300),
  };
}
const isoD = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : '');
export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14));

/** one folder as stored, or null when it is not one */
export function normFolder(x: unknown): Folder | null {
  const o = x as Partial<Folder>;
  if (!o || typeof o !== 'object') return null;
  const label = str(o.label, 80).trim();
  const keys = Array.isArray(o.keys) ? [...new Set(o.keys.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)))].slice(0, MAX_KEYS) : [];
  const held = Array.isArray(o.held) ? o.held.map(normHeld).filter((h): h is Held => !!h).slice(0, 60) : [];
  // a folder is a comparison (track keys) or a client's imported products, or both
  if (!label || (!keys.length && !held.length)) return null;
  const tags: Record<string, Tag> = {};
  if (o.tags && typeof o.tags === 'object') for (const [k, v] of Object.entries(o.tags)) if (keys.includes(k) && TAGS.includes(v as Tag)) tags[k] = v as Tag;
  const fields: Record<string, string> = {};
  if (o.fields && typeof o.fields === 'object') for (const [k, v] of Object.entries(o.fields).slice(0, 200)) if (/^[\w:.-]{1,60}$/.test(k) && typeof v === 'string' && v.trim()) fields[k] = v.slice(0, MAX_FIELD);
  const created = isoD(o.created) || isoD(o.updated) || '1970-01-01';
  return { id: typeof o.id === 'string' && /^[\w-]{4,40}$/.test(o.id) ? o.id : newId(), label, keys, b: o.b === 'gross' ? 'gross' : 'net', tags, fields, note: str(o.note, MAX_FIELD), created, updated: isoD(o.updated) || created,
    snap: normSnap(o.snap, keys), held };
}

/** the stored value (or an imported file) made safe: unknown shapes give an empty list. Any earlier version (v1: no snapshot, no
 *  imported products) is migrated to v2 on read: the folders keep everything they had, with `snap: null` and `held: []`. */
export function normClients(x: unknown): ClientsFile {
  const o = x as Partial<ClientsFile>;
  const fs = o && typeof o === 'object' && Array.isArray(o.folders) ? o.folders.map(normFolder).filter((f): f is Folder => !!f) : [];
  const seen = new Set<string>();
  return { kind: 'fox-clients', v: 2, folders: fs.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true))).slice(0, MAX_FOLDERS) };
}

export type FolderIn = Pick<Folder, 'label' | 'keys'> & Partial<Pick<Folder, 'id' | 'b' | 'tags' | 'fields' | 'note' | 'snap' | 'held'>>;
/** Saves a folder: by id when it has one, else by its label (case and spaces ignored), else a new folder. Fields left out keep their
 *  stored value (saving from the compare page keeps the worksheet typed on the print page). */
export function upsert(file: ClientsFile, f: FolderIn, today: string): { file: ClientsFile; folder: Folder; created: boolean } {
  const lab = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const i = file.folders.findIndex((x) => (f.id ? x.id === f.id : lab(x.label) === lab(f.label)));
  const patch = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
  if (i >= 0) {
    const old = file.folders[i];
    // a snapshot belongs to its tracks: new tracks with no new snapshot drop the old one
    if (f.snap === undefined && old.snap && old.keys.join() !== f.keys.join()) (patch as Partial<Folder>).snap = null;
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
export const exportText = (file: ClientsFile, today: string) => JSON.stringify({ ...normClients(file), exported: today, note: 'תיקי לקוחות של סוכן: מסלולים להשוואה, צילום הנתונים שהוצגו ללקוח, מוצרים מקובץ מסלקה וטיוטת הנמקה. נשמר בדפדפן בלבד; הקובץ פרטי.' }, null, 1);

/** the hook: the folders of this browser, always well-formed */
export function useClients(): [ClientsFile, (f: ClientsFile) => void] {
  const [raw, set] = useStored<unknown>(CLIENTS_KEY, EMPTY);
  return [normClients(raw), set];
}

/** the state a router link carries to open a folder (never the URL) */
export interface FolderNav { folder: string }
export const folderOfState = (s: unknown): string | null => (s && typeof s === 'object' && typeof (s as FolderNav).folder === 'string' ? (s as FolderNav).folder : null);
