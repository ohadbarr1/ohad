/* fox 3.0 phase 2 · the agent's clearing-house reader: the files an agent drops (the zip as the clearing house sent it, password
   protected or not, or the XML files inside it) → review rows (lib/maslaka). The same steps as the saver's reader on /my, kept in the
   agent's own file so each door can change its flow alone. zip.js loads only when a zip is picked. Nothing leaves the browser: the
   bytes come from the page's file input and stay in memory; the password is used for this one read. */
import { decodeXml, mergeMFiles, parseMaslaka, readTree, rowsOf, sniff, type MFile, type MFund, type Row } from './maslaka';

export const ACCEPT = '.zip,.xml,application/zip,application/x-zip-compressed,text/xml,application/xml';
const MAX_BYTES = 40_000_000;
export interface Read { name: string; rows: Row[]; error?: string; warn: string[]; parts?: number; /** the holder's birth date when the file gives it (lib/maslaka; turned into an age at save) */ birth?: string | null }
/** a lib/zipRead ZipError asking for (or refusing) the password */
export class NeedPassword extends Error { wrong: boolean; constructor(wrong: boolean) { super(wrong ? WRONG_PW : NEED_PW); this.wrong = wrong; this.name = 'NeedPassword'; } }
export const NEED_PW = 'קובץ ה-zip מהמסלקה מוגן בסיסמה. הסיסמה כתובה במייל שבו הגיע הקובץ מהמסלקה הפנסיונית.';
export const WRONG_PW = 'הסיסמה לא פתחה את הקובץ. בודקים שוב במייל מהמסלקה (בלי רווחים; אותיות באנגלית לפי גודל).';
export const PW_HINT = 'הסיסמה כתובה במייל שבו הגיע הקובץ מהמסלקה. היא משמשת לפתיחת הקובץ כאן, בדפדפן, ולא נשמרת ולא נשלחת.';

/** Files → review rows. A zip is opened (nested zips too) and its provider XMLs merged into one review; PDFs and Excel are never
 *  read. Throws NeedPassword when a zip needs the password (or the one given does not open it). */
export async function readClientFiles(files: File[] | { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }[], funds: MFund[], password: string | null): Promise<Read[]> {
  const out: Read[] = [];
  let n = 0;
  for (const file of files) {
    n++;
    try {
      if (file.size > MAX_BYTES) throw new Error('הקובץ גדול מדי לקובץ מסלקה');
      const buf = new Uint8Array(await file.arrayBuffer());
      const kind = sniff(buf);
      if (kind === 'pdf') throw new Error('זה קובץ PDF. הייבוא קורא את קובץ ה-zip מהמסלקה או את קובצי ה-XML שבתוכו');
      if (kind === 'zip' && /\.xlsx?$/i.test(file.name)) throw new Error('זה קובץ Excel. הייבוא קורא את קובץ ה-zip מהמסלקה או את קובצי ה-XML שבתוכו');
      if (kind === 'zip') {
        const { unpackZip, ZipError } = await import('./zipRead');
        let u;
        try { u = await unpackZip(buf, password); } catch (e) {
          if (e instanceof ZipError && (e.kind === 'need-password' || e.kind === 'wrong-password')) throw new NeedPassword(e.kind === 'wrong-password' || !!password);
          throw e;
        }
        if (!u.xml.length) throw new Error('בקובץ ה-zip אין קובצי XML. זה לא נראה כמו החבילה מהמסלקה.');
        const parts: { name: string; file: MFile }[] = [], warn: string[] = [];
        for (const x of u.xml) {
          try { parts.push({ name: x.name, file: parseMaslaka(readTree(decodeXml(x.data))) }); } catch (e) { warn.push(`${x.path}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        if (!parts.length) throw new Error(warn.join(' · ') || 'לא נקרא אף קובץ מתוך ה-zip');
        const merged = mergeMFiles(parts);
        out.push({ name: file.name, rows: rowsOf(merged, funds, `f${n}`), warn: [...merged.warn, ...warn], parts: parts.length, birth: merged.birth ?? null });
        continue;
      }
      if (kind !== 'xml') throw new Error('זה לא נראה כמו קובץ מהמסלקה הפנסיונית. בוחרים את קובץ ה-zip שהגיע מהמסלקה או את קובצי ה-XML שבתוכו.');
      const parsed = parseMaslaka(readTree(decodeXml(buf)));
      out.push({ name: file.name, rows: rowsOf(parsed, funds, `f${n}`), warn: parsed.warn, birth: parsed.birth ?? null });
    } catch (e) {
      if (e instanceof NeedPassword) throw e;
      out.push({ name: file.name, rows: [], warn: [], error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** the review in numbers: products, matched to a published track, matched by the 30-digit code, not matched, kept without a match */
export interface ReadSum { rows: number; matched: number; byCode: number; byName: number; unmatched: number; skipped: number }
export function readSum(rows: Row[], manual: Record<string, string> = {}): ReadSum {
  const s: ReadSum = { rows: rows.length, matched: 0, byCode: 0, byName: 0, unmatched: 0, skipped: 0 };
  for (const r of rows) {
    if (manual[r.key] || r.k) { s.matched++; if (!manual[r.key] && (r.by === 'code' || r.by === 'id' || r.by === 'track')) s.byCode++; if (!manual[r.key] && r.by === 'name') s.byName++; }
    else if (r.skip) s.skipped++;
    else s.unmatched++;
  }
  return s;
}
