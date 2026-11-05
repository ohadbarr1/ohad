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
import type { DepositRow, GuaranteedCoef, HeldExtra } from './clientTypes';  // W7: deposits, code, salary, guaranteed coefficient
import { useStored } from './local';
import { normRisk } from './harbTypes';  // fox 3.0 A6

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
export interface Held extends HeldExtra {
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
/** W7 · one deposit row made safe (lib/clientTypes DepositRow): a salary month and numbers, nothing else */
function normDeposit(x: unknown): DepositRow | null {
  const o = x as Record<string, unknown>;
  if (!o || typeof o !== 'object' || typeof o.ym !== 'string' || !/^\d{4}-\d{2}$/.test(o.ym)) return null;
  const r: DepositRow = { ym: o.ym, paid: isoD(o.paid) || null, employee: numN(o.employee), employer: numN(o.employer), severance: numN(o.severance), total: numN(o.total), salary: numN(o.salary) };
  return r;
}
/** a held product made safe (an ID-shaped string anywhere is dropped; the unified code is digits by design and is kept when it is
 *  one: 23–34 digits, which no ID number or account number is) */
export function normHeld(x: unknown): Held | null {
  const o = x as Record<string, unknown>;
  if (!o || typeof o !== 'object') return null;
  const safe = (v: unknown, max: number) => { const t = strN(v, max); return t && /\d{8,}/.test(t) ? null : t; };
  const typeHe = safe(o.typeHe, 80);
  if (!typeHe) return null;
  const code = typeof o.code === 'string' && /^\d{23,34}$/.test(o.code.replace(/\D/g, '')) ? o.code.replace(/\D/g, '') : null;
  const cg = o.coefGuaranteed as Record<string, unknown> | null | undefined;
  const coef: GuaranteedCoef | null = cg && typeof cg === 'object' && numN(cg.v) != null && (cg.v as number) > 0 ? { v: cg.v as number, at: numN(cg.at), src: cg.src === 'agent' ? 'agent' : 'file' } : null;
  return {
    k: typeof o.k === 'string' && KEY_RE.test(o.k) ? o.k : null, typeHe, provider: safe(o.provider, 120), plan: safe(o.plan, 160), track: safe(o.track, 160),
    balance: numN(o.balance), monthly: numN(o.monthly), fee: numN(o.fee), feeHow: safe(o.feeHow, 80), depfee: numN(o.depfee), depHow: safe(o.depHow, 80),
    asof: isoD(o.asof) || null, covers: Array.isArray(o.covers) ? o.covers.map(normCover).filter((c): c is Cover => !!c).slice(0, 40) : [], note: safe(o.note, 300),
    // W7: the client engine's fields, every one optional (folders saved before W7 have none)
    ...(code ? { code } : {}),
    ...(Array.isArray(o.deposits) ? { deposits: o.deposits.map(normDeposit).filter((d): d is DepositRow => !!d).slice(0, 60) } : {}),
    ...(numN(o.salary) != null ? { salary: numN(o.salary) } : {}),
    ...(safe(o.insTrack, 120) ? { insTrack: safe(o.insTrack, 120) } : {}),
    ...(coef ? { coefGuaranteed: coef } : {}),
    ...(normRisk(o.risk) ? { risk: normRisk(o.risk) } : {}),  // fox 3.0 A6: a הר הביטוח policy
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

/** the export file's text; W7: the agent's branding (lib/branding) rides along under `brand` so a second device gets it with the folders */
export const exportText = (file: ClientsFile, today: string, brand?: unknown) => JSON.stringify({ ...normClients(file), exported: today, ...(brand ? { brand } : {}), note: 'תיקי לקוחות של סוכן: מסלולים להשוואה, צילום הנתונים שהוצגו ללקוח, מוצרים מקובץ מסלקה וטיוטת הנמקה. נשמר בדפדפן בלבד; הקובץ פרטי.' }, null, 1);
/** W7: the branding carried in a backup file, raw (lib/branding normalises it), or null */
export const brandOfFile = (x: unknown): unknown => (x && typeof x === 'object' && (x as { brand?: unknown }).brand && typeof (x as { brand?: unknown }).brand === 'object' ? (x as { brand: unknown }).brand : null);

/** the hook: the folders of this browser, always well-formed */
export function useClients(): [ClientsFile, (f: ClientsFile) => void] {
  const [raw, set] = useStored<unknown>(CLIENTS_KEY, EMPTY);
  return [normClients(raw), set];
}

/** the state a router link carries to open a folder (never the URL) */
export interface FolderNav { folder: string }
export const folderOfState = (s: unknown): string | null => (s && typeof s === 'object' && typeof (s as FolderNav).folder === 'string' ? (s as FolderNav).folder : null);

/** the folder a clearing-house import makes: the matched tracks (≤ 8, largest balance first) tagged "קיים", and every product as
 *  held, matched or not (moved here from components/agent/ClientImport in W5) */
export function folderFromImport(label: string, held: Held[]): Pick<Folder, 'label' | 'keys' | 'tags' | 'held'> {
  const by = new Map<string, number>();
  held.forEach((h) => { if (h.k) by.set(h.k, (by.get(h.k) ?? 0) + (h.balance ?? 0)); });
  const keys = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 8);
  return { label, keys, tags: Object.fromEntries(keys.map((k) => [k, 'קיים' as const])), held };
}

/* ---------- W5 · the client's current state, in shekels, from the clearing-house file ---------- */

/** the annual fee cost of one held product, ₪, from the file's own figures: the balance × its fee from savings; and, when the monthly
 *  deposit is known, 12 × that deposit × its fee from deposits (an estimate: this month's deposit taken for a whole year). Null where
 *  the file gives neither pair. */
export interface HeldCost { acc: number | null; dep: number | null; total: number | null }
export function heldCost(h: Pick<Held, 'balance' | 'monthly' | 'fee' | 'depfee'>): HeldCost {
  const acc = h.balance != null && h.fee != null ? (h.balance * h.fee) / 100 : null;
  const dep = h.monthly != null && h.depfee != null ? (h.monthly * 12 * h.depfee) / 100 : null;
  return { acc, dep, total: acc == null && dep == null ? null : (acc ?? 0) + (dep ?? 0) };
}
/** a product held only for its insurance cover (risk, no savings): it belongs in the cover table, not in the savings composition */
/** fox 3.0 phase 2 (round-3 gap): a savings product (managers' insurance, pension, provident, study fund, savings policy) is never
 *  "cover only", even when the file gives no balance: it stays in part א.1 as an existing product, with its covers in א.2 */
export const SAVINGS_RE = /ביטוח מנהלים|ביטוחי מנהלים|פנסיה|גמל|השתלמות|פוליסת חיסכון|פוליסות חיסכון|חיסכון לכל ילד/;
export const coverOnly = (h: Held) => h.balance == null && !h.k && h.covers.length > 0 && !SAVINGS_RE.test(h.typeHe);

/** the totals of a client's held products: balances, deposits, the annual fee cost (from savings and from deposits) and the
 *  insurance cost a year (Σ monthly cost × 12, where the file gives a cost). `noFee`: products with a balance but no fee from
 *  savings in the file (left out of the fee total); `noCost`: covers with no cost in the file. */
export interface HeldSum { n: number; balance: number; monthly: number; acc: number; dep: number; total: number; noFee: number; ins: number | null; noCost: number }
export function heldSum(held: Held[]): HeldSum {
  const s: HeldSum = { n: held.length, balance: 0, monthly: 0, acc: 0, dep: 0, total: 0, noFee: 0, ins: null, noCost: 0 };
  for (const h of held) {
    const c = heldCost(h);
    s.balance += h.balance ?? 0; s.monthly += h.monthly ?? 0;
    s.acc += c.acc ?? 0; s.dep += c.dep ?? 0; s.total += c.total ?? 0;
    if (h.balance != null && h.balance > 0 && h.fee == null) s.noFee++;
    for (const cv of h.covers) { if (cv.cost == null) s.noCost++; else s.ins = (s.ins ?? 0) + cv.cost * 12; }
  }
  return s;
}

/** How the client document lists the held products. A product matched to a track the document shows as "קיים" is folded into that
 *  track's block (`onRow`, by key, balances summed); every other product is listed on its own as "קיים", from the file (`loose`):
 *  unmatched, or matched to a track the document leaves out or tags otherwise. Nothing imported is dropped. */
export interface Loose { h: Held; i: number; why: string }
export function heldForDoc(held: Held[], rowKeys: string[], existKeys: string[]): { onRow: Map<string, Held[]>; loose: Loose[] } {
  const onRow = new Map<string, Held[]>(), loose: Loose[] = [];
  held.forEach((h, i) => {
    if (h.k && existKeys.includes(h.k)) { onRow.set(h.k, [...(onRow.get(h.k) ?? []), h]); return; }
    loose.push({ h, i, why: !h.k ? 'לא נמצא מסלול תואם ב-fox' : rowKeys.includes(h.k) ? 'המסלול מופיע במסמך בסיווג אחר' : 'המסלול לא נכלל במסמך' });
  });
  return { onRow, loose };
}
/** the held products of one track, as one: balances and deposits summed, the first fee given */
export function heldOne(hs: Held[]): Pick<Held, 'balance' | 'monthly' | 'fee' | 'depfee' | 'asof'> {
  const sum = (f: (h: Held) => number | null) => (hs.some((h) => f(h) != null) ? hs.reduce((t, h) => t + (f(h) ?? 0), 0) : null);
  return { balance: sum((h) => h.balance), monthly: sum((h) => h.monthly), fee: hs.find((h) => h.fee != null)?.fee ?? null, depfee: hs.find((h) => h.depfee != null)?.depfee ?? null, asof: hs.find((h) => h.asof)?.asof ?? null };
}

/* ---------- W5 · the backup reminder (/clients): the folders live in this browser only, so the page says when they were last exported ---------- */
export const BACKUP_KEY = 'clients:backup';
/** days between two ISO dates (b − a) */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
/** the last export against the folders: how long ago, how many folders changed since, and whether to nudge (never exported, a
 *  folder changed since and the export is a week old or more, or a month without one) */
export function backupState(file: ClientsFile, last: string | null | undefined, today: string): { days: number | null; changed: number; nudge: boolean } {
  const at = typeof last === 'string' && /^\d{4}-\d{2}-\d{2}/.test(last) ? last.slice(0, 10) : null;
  const n = file.folders.length;
  if (!at) return { days: null, changed: n, nudge: n > 0 };
  const days = Math.max(0, daysBetween(at, today)), changed = file.folders.filter((f) => f.updated > at).length;
  return { days, changed, nudge: n > 0 && ((changed > 0 && days >= 7) || days >= 30) };
}

/* ---------- W7 · "שיתוף תיק": one folder as an encrypted file (Web Crypto AES-GCM, a passphrase the agent types; nothing leaves the browser) ---------- */
/** the file: { kind, v, kdf: PBKDF2-SHA-256 with `iter` rounds over `salt`, alg: AES-256-GCM with `iv`, ct: ciphertext+tag }, all base64 */
export interface ShareFile { kind: 'fox-client-share'; v: 1; kdf: 'PBKDF2-SHA-256'; iter: number; salt: string; alg: 'AES-GCM'; iv: string; ct: string; label?: string; exported: string }
export const SHARE_ITER = 310_000;
export const LAST_FOLDER_KEY = 'clients:last';
const subtle = () => (globalThis.crypto?.subtle ?? null);
const b64 = (u: Uint8Array) => { let s = ''; u.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function shareKey(pass: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const sc = subtle();
  if (!sc) throw new Error('הדפדפן אינו תומך בהצפנה (Web Crypto)');
  const base = await sc.importKey('raw', new TextEncoder().encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return sc.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** fox 3.0 phase 2: any JSON value sealed under a passphrase (8 characters or more), as a file's text: the same envelope as the share
 *  file (PBKDF2-SHA-256 → AES-256-GCM, random salt and IV), with its own `kind` (the share file, the whole book's backup) */
export interface Sealed { kind: string; v: 1; kdf: 'PBKDF2-SHA-256'; iter: number; salt: string; alg: 'AES-GCM'; iv: string; ct: string; label?: string; exported: string }
export async function seal(kind: string, value: unknown, pass: string, today: string, label?: string): Promise<string> {
  if (pass.length < 8) throw new Error('סיסמה של 8 תווים לפחות');
  const sc = subtle();
  if (!sc) throw new Error('הדפדפן אינו תומך בהצפנה (Web Crypto)');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await shareKey(pass, salt, SHARE_ITER);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await sc.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource));
  const out: Sealed = { kind, v: 1, kdf: 'PBKDF2-SHA-256', iter: SHARE_ITER, salt: b64(salt), alg: 'AES-GCM', iv: b64(iv), ct: b64(ct), ...(label ? { label: label.slice(0, 80) } : {}), exported: today };
  return JSON.stringify(out);
}
export const isSealed = (x: unknown, kind: string): x is Sealed => !!x && typeof x === 'object' && (x as Sealed).kind === kind && (x as Sealed).v === 1 && typeof (x as Sealed).ct === 'string' && typeof (x as Sealed).salt === 'string' && typeof (x as Sealed).iv === 'string';
/** the value inside a sealed file of this kind; throws (in Hebrew) on a wrong passphrase, a damaged file or another kind of file */
export async function unseal(text: string, pass: string, kind: string, what = 'קובץ שיתוף תיק'): Promise<unknown> {
  let x: unknown;
  try { x = JSON.parse(text); } catch { throw new Error(`הקובץ אינו ${what}`); }
  if (!isSealed(x, kind)) throw new Error(`הקובץ אינו ${what}`);
  const sc = subtle();
  if (!sc) throw new Error('הדפדפן אינו תומך בהצפנה (Web Crypto)');
  const iter = Number.isInteger(x.iter) && x.iter >= 100_000 && x.iter <= 2_000_000 ? x.iter : SHARE_ITER;
  const key = await shareKey(pass, unb64(x.salt), iter);
  let plain: ArrayBuffer;
  try { plain = await sc.decrypt({ name: 'AES-GCM', iv: unb64(x.iv) as BufferSource }, key, unb64(x.ct) as BufferSource); } catch { throw new Error('הסיסמה שגויה או שהקובץ ניזוק'); }
  return JSON.parse(new TextDecoder().decode(plain));
}
/** one folder, encrypted under a passphrase (8 characters or more), as the file's text */
export async function encryptFolder(folder: Folder, pass: string, today: string): Promise<string> {
  return seal('fox-client-share', { kind: 'fox-clients', v: CLIENTS_V, folders: [normFolder(folder)] }, pass, today, folder.label);
}
export const isShareFile = (x: unknown): x is ShareFile => !!x && typeof x === 'object' && (x as ShareFile).kind === 'fox-client-share' && (x as ShareFile).v === 1 && typeof (x as ShareFile).ct === 'string' && typeof (x as ShareFile).salt === 'string' && typeof (x as ShareFile).iv === 'string';
/** the folder inside a share file; throws (in Hebrew) on a wrong passphrase or a damaged file */
export async function decryptShare(text: string, pass: string): Promise<Folder> {
  const f = normClients(await unseal(text, pass, 'fox-client-share')).folders[0];
  if (!f) throw new Error('בקובץ אין תיק תקין');
  return f;
}
