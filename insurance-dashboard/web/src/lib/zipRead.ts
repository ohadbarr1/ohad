/* W7 · the clearing house's zip, opened in this browser (and in node for the tests). Pure: no React, no fetch, no storage.
   The clearing house (המסלקה הפנסיונית, swiftness.co.il) sends the holdings report as one password-protected zip: one XML per
   provider, an Excel and PDFs. Until W7 the import asked the reader to unzip it on a computer; on an iPhone the Files app does not
   open a zip with a password, so the import did not work on the phone at all (red team 4).

   The password. No public rule was found (checked 02.11.26: swiftness.co.il/savers/qa, swiftness.co.il/savers/guide, כל זכות
   "מידע על החשבונות הפנסיוניים ... באמצעות המסלקה הפנסיונית"): the FAQ only says a "קובץ מאובטח" is e-mailed before the data is
   deleted from the site. An analysis of 8 real reports (github.com/meir-pletinsky/israeli-retirement-planning,
   docs/clearing-house-import-analysis.md) says the e-mail that carries the zip states the password to use. So: the zip is tried
   without a password first, then the reader types the one from the e-mail; the UI says where to find it and does not guess (the
   holder's ID number is a common convention for such files, but nothing found says the clearing house uses it, so it is offered only
   as a thing to try, never assumed).

   Encryption: both traditional ZipCrypto (PKWARE, what `zip -e` writes) and WinZip AES-128/192/256 are read, through @zip.js/zip.js
   (BSD-3-Clause, pinned 2.24.0; the only well-known browser library that decrypts both). Which one the clearing house uses is not
   known from a document, hence both. Deflate goes through the browser's DecompressionStream when it has one (Safari ≥ 16.4), else
   zip.js's own inflater; web workers are off (the site's CSP has worker-src 'self' and zip.js's worker would be a blob: URL). Nothing
   here touches the network: the bytes come from the page's <input type=file> and stay in memory. */
import { ERR_ENCRYPTED, ERR_INVALID_AUTHENTICATION_CODE, ERR_INVALID_CRC32, ERR_INVALID_PASSWORD, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, configure } from '@zip.js/zip.js';
// zip.js's inflater (used when the browser has no DecompressionStream('deflate-raw'), and for its own checks) is a WASM module that it
// would otherwise fetch as a data: URI, which the site's CSP (connect-src 'self') refuses; Vite serves it as a file of the site instead.
// The test runners (esbuild, node) stub this import to '' so zip.js keeps its built-in copy there.
import wasmURI from '@zip.js/zip.js/dist/zip-module.wasm?url';

configure({ useWebWorkers: false, useCompressionStream: typeof DecompressionStream !== 'undefined', ...(wasmURI ? { wasmURI } : {}) });

/** one XML (or anything the caller asked for) taken out of the zip: `path` tells the reader where it sat (outer.zip/inner.zip/x.xml) */
export interface ZipFile { name: string; path: string; data: Uint8Array }
export interface Unpacked {
  /** the XML files, outer order, nested zips flattened */
  xml: ZipFile[];
  /** entries left unread (PDF, Excel, pictures): their names, for the message */
  skipped: string[];
  /** true when at least one entry was encrypted (so the password was needed and worked) */
  encrypted: boolean;
}
export type ZipErrorKind = 'need-password' | 'wrong-password' | 'not-zip' | 'too-big' | 'too-many' | 'nested-too-deep';
/** a zip problem the UI can say in plain words: `kind` chooses the sentence */
export class ZipError extends Error {
  kind: ZipErrorKind;
  constructor(kind: ZipErrorKind, message: string) { super(message); this.kind = kind; this.name = 'ZipError'; }
}

/** what the clearing house's zip holds: 1 Excel, a few PDFs, one XML per provider; a nested zip is rare but costs nothing */
const MAX_ENTRIES = 80, MAX_ENTRY_BYTES = 25_000_000, MAX_DEPTH = 2;
const isXml = (name: string) => /\.xml$/i.test(name);
const isZip = (name: string) => /\.zip$/i.test(name);

export const ZIP_WORDS: Record<ZipErrorKind, string> = {
  'need-password': 'קובץ ה-zip מהמסלקה מוגן בסיסמה. הסיסמה כתובה במייל שבו הגיע הקובץ מהמסלקה הפנסיונית.',
  'wrong-password': 'הסיסמה לא פתחה את הקובץ. בודקים שוב במייל מהמסלקה (בלי רווחים; אותיות באנגלית לפי גודל).',
  'not-zip': 'הקובץ לא נפתח כקובץ zip תקין.',
  'too-big': 'קובץ בתוך ה-zip גדול מדי לקובץ מסלקה.',
  'too-many': 'יותר מדי קבצים בתוך ה-zip.',
  'nested-too-deep': 'קובץ zip בתוך zip בתוך zip: פותחים ידנית את הקובץ הפנימי ובוחרים אותו.',
};

/** Zip bytes → its XML files (nested zips opened too), decrypted with `password` when the entries are encrypted.
 *  Throws ZipError('need-password') when an entry is encrypted and no password was given, ZipError('wrong-password') when the
 *  password does not open it. PDFs, Excel and anything else are not read at all (not even decrypted). */
export async function unpackZip(bytes: Uint8Array, password: string | null, prefix = '', depth = 0): Promise<Unpacked> {
  if (depth > MAX_DEPTH) throw new ZipError('nested-too-deep', ZIP_WORDS['nested-too-deep']);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new ZipError('not-zip', ZIP_WORDS['not-zip']);
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
  const out: Unpacked = { xml: [], skipped: [], encrypted: false };
  try {
    let entries;
    try { entries = await reader.getEntries(); } catch { throw new ZipError('not-zip', ZIP_WORDS['not-zip']); }
    const files = entries.filter((e) => !e.directory);
    if (files.length > MAX_ENTRIES) throw new ZipError('too-many', ZIP_WORDS['too-many']);
    for (const e of files) {
      const name = e.filename.split('/').pop() ?? e.filename;
      const path = prefix ? `${prefix}/${e.filename}` : e.filename;  // the entry's full path inside the zip(s): an .xlsx's xl/worksheets/sheet1.xml keeps its folder
      if (!isXml(name) && !isZip(name)) { out.skipped.push(path); continue; }
      if (e.uncompressedSize > MAX_ENTRY_BYTES) throw new ZipError('too-big', `${ZIP_WORDS['too-big']} (${name})`);
      if (e.encrypted) { out.encrypted = true; if (!password) throw new ZipError('need-password', ZIP_WORDS['need-password']); }
      let data: Uint8Array;
      try {
        data = await e.getData!(new Uint8ArrayWriter(), { password: e.encrypted ? password ?? undefined : undefined, checkSignature: true, useWebWorkers: false });
      } catch (err) {
        if (err instanceof ZipError) throw err;
        const m = err instanceof Error ? err.message : String(err);
        if (m === ERR_ENCRYPTED) throw new ZipError('need-password', ZIP_WORDS['need-password']);
        // ZipCrypto checks one byte of the password (1 in 256 wrong passwords pass it) and fails on the CRC after; AES fails on its verifier
        if (e.encrypted && (m === ERR_INVALID_PASSWORD || m === ERR_INVALID_CRC32 || m === ERR_INVALID_AUTHENTICATION_CODE)) throw new ZipError('wrong-password', ZIP_WORDS['wrong-password']);
        throw new ZipError('not-zip', `${ZIP_WORDS['not-zip']} (${name})`);
      }
      if (isZip(name)) {
        const inner = await unpackZip(data, password, path, depth + 1);
        out.xml.push(...inner.xml); out.skipped.push(...inner.skipped); out.encrypted = out.encrypted || inner.encrypted;
      } else out.xml.push({ name, path, data });
    }
  } finally { await reader.close().catch(() => undefined); }
  return out;
}

/** what a picked file is, from its first bytes (the same test as lib/maslaka `sniff`, kept here so the zip reader stands alone) */
export const looksZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
