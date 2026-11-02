import type { Held } from './clients';
/* W7 · הר הביטוח (harb.cma.gov.il, רשות שוק ההון): the list of insurance policies in force in the holder's name, which the holder
   downloads after signing in with the government identity service. Read in this browser only; pure (no React, no fetch, no storage).

   What could and could not be verified (02.11.26). The site itself answers HTTP 403 to anything that is not a signed-in browser, and
   neither gov.il nor כל זכות publishes a specification of the download. Secondary descriptions agree on the shape, not the details:
   a table of the policies in force in the previous month, one row per policy, with the insurer, the kind of insurance, the policy
   number, the period (start / end) and the premium; four buttons on the screen (exit, print, export to Excel, send by e-mail)
   (bituch.co.il/bdika/har-habituach, msl.org.il/har-habituach, erenfeld-ins.co.il/הר-הביטוח-gov, collective.co.il/har-habituach).
   They disagree on whether the premium column is monthly or annual, and none shows the column headers. So this reader is a tolerant
   table reader: it takes the Excel export (an .xlsx is a zip of XML: read with lib/zipRead and the XML tree of lib/maslaka), a CSV /
   TSV saved from it, or the table pasted as text; finds the header row by Hebrew header words; and maps columns by synonyms. Every
   column mapping below is `inferred` from those descriptions, not from a file, and every row it produces carries a warning that says
   so, until a real export is checked. Sums insured are not described anywhere as a column of this list, so `sum` is read only when
   a header says so. Nothing personal is read: no ID number, no name, no policy number is kept (the policy number is used only to
   drop duplicate rows and never leaves this function). */
import { xmlTree, type XNode } from './maslaka';
import { unpackZip } from './zipRead';

/** a policy row of the הר הביטוח list, as fox keeps it: a cover-only held product (lib/clients coverOnly) */
export interface HarbRow { insurer: string | null; kind: string | null; product: string | null; premium: number | null; premiumPer: 'month' | 'year' | null; sum: number | null; start: string | null; end: string | null; warn: string[] }

/** header words → column role (inferred from secondary descriptions of the screen; see the file comment) */
const COLS: { role: keyof Omit<HarbRow, 'warn' | 'premiumPer'> | 'policyNo' | 'premiumYear'; words: RegExp }[] = [
  { role: 'insurer', words: /חברה|חברת|מבטח|גוף מנהל/ },                 // inferred
  { role: 'kind', words: /ענף|סוג (ה)?ביטוח|סוג (ה)?מוצר|תחום/ },             // inferred
  { role: 'product', words: /שם (ה)?פוליסה|שם (ה)?מוצר|שם (ה)?תוכנית|תיאור|כיסוי/ },  // inferred
  { role: 'premiumYear', words: /פרמיה שנתית|שנתי/ },                        // inferred
  { role: 'premium', words: /פרמיה|תשלום|עלות/ },                              // inferred
  { role: 'sum', words: /סכום ביטוח|סכום (ה)?כיסוי/ },                         // inferred (not described as a column; read only if present)
  { role: 'start', words: /תחילה|התחלה|מתאריך/ },                               // inferred
  { role: 'end', words: /סיום|תום|עד תאריך/ },                                   // inferred
  { role: 'policyNo', words: /מספר (ה)?פוליסה|מס' פוליסה|מספר חשבון/ },        // used for de-duplication only
];
const HEADER_MIN = 2;
export const HARB_WARN = 'מבנה הקובץ מהר הביטוח לא אומת מול קובץ אמיתי: העמודות זוהו לפי שמות הכותרות';

const numOf = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const t = s.replace(/[₪,\s]/g, '').replace(/^ש"ח/, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return +t;
};
/** dd/mm/yyyy, dd.mm.yyyy, yyyy-mm-dd, yyyymmdd → yyyy-mm-dd */
export const harbDate = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const t = s.trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
};

/** text (CSV, TSV or a pasted table) → rows of cells */
export function splitTable(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  return lines.map((l) => {
    if (sep === '\t') return l.split('\t').map((c) => c.trim());
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && cur === '') q = true;  // a quote opens a quoted cell only at its start (בע"מ in the middle of a name is text)
      else if (ch === sep) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

/** cells → the policy rows: the first row with ≥ 2 recognised headers is the header; everything under it is a policy */
export function harbRows(cells: string[][]): { rows: HarbRow[]; warn: string[] } {
  const warn: string[] = [HARB_WARN];
  let hi = -1, map: Partial<Record<string, number>> = {};
  for (let i = 0; i < Math.min(cells.length, 30); i++) {
    const m: Partial<Record<string, number>> = {};
    cells[i].forEach((c, j) => { for (const col of COLS) if (col.words.test(c) && m[col.role] == null) { m[col.role] = j; break; } });
    if (Object.keys(m).length >= HEADER_MIN) { hi = i; map = m; break; }
  }
  if (hi < 0) return { rows: [], warn: ['לא נמצאה שורת כותרות של רשימת הפוליסות (חברה, ענף, פרמיה…)'] };
  const at = (r: string[], role: string) => (map[role] != null ? r[map[role]!] ?? null : null);
  const rows: HarbRow[] = [];
  const seen = new Set<string>();
  for (const r of cells.slice(hi + 1)) {
    if (r.every((c) => !c)) continue;
    const insurer = at(r, 'insurer') || null, kind = at(r, 'kind') || null, product = at(r, 'product') || null;
    if (!insurer && !kind && !product) continue;
    const pno = at(r, 'policyNo');
    const key = [insurer, kind, product, pno].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const py = numOf(at(r, 'premiumYear')), pm = numOf(at(r, 'premium'));
    rows.push({ insurer, kind, product, premium: py ?? pm, premiumPer: py != null ? 'year' : null, sum: numOf(at(r, 'sum')), start: harbDate(at(r, 'start')), end: harbDate(at(r, 'end')), warn: [HARB_WARN] });
  }
  if (!rows.length) warn.push('לא נמצאו שורות פוליסה מתחת לכותרות');
  return { rows, warn };
}

/** an .xlsx (zip of XML) → the first sheet's cells, through lib/zipRead and lib/maslaka's XML tree. Shared strings and inline
 *  strings are read; dates typed as Excel serials come out as the serial number (the header words decide what a column is). */
export async function xlsxCells(bytes: Uint8Array): Promise<string[][]> {
  const z = await unpackZipAny(bytes);
  const ss = z.get('xl/sharedStrings.xml'), sheet = z.get('xl/worksheets/sheet1.xml') ?? [...z.entries()].find(([n]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))?.[1];
  if (!sheet) return [];
  const strings: string[] = [];
  if (ss) for (const si of xmlTree(new TextDecoder().decode(ss)).c.filter((n) => n.n === 'si')) strings.push(textOf(si));
  const out: string[][] = [];
  const sheetData = xmlTree(new TextDecoder().decode(sheet)).c.find((n) => n.n === 'sheetData');
  for (const row of sheetData?.c.filter((n) => n.n === 'row') ?? []) {
    const cells: string[] = [];
    for (const c of row.c.filter((n) => n.n === 'c')) {
      const ref = c.a?.r ?? '', col = colIndex(ref);
      const t = c.a?.t;
      const v = c.c.find((n) => n.n === 'v'), is = c.c.find((n) => n.n === 'is');
      let val = '';
      if (t === 's' && v) val = strings[+v.t.trim()] ?? '';
      else if (t === 'inlineStr' && is) val = textOf(is);
      else if (v) val = v.t.trim();
      while (cells.length < col) cells.push('');
      cells[col] = val;
    }
    out.push(cells);
  }
  return out;
}
const textOf = (n: XNode): string => n.t + n.c.map(textOf).join('');
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return Math.max(0, n - 1); };
async function unpackZipAny(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  // lib/zipRead reads only .xml entries, which is exactly what an .xlsx's sheets and shared strings are
  const u = await unpackZip(bytes, null);
  return new Map(u.xml.map((f) => [f.path, f.data]));
}

/** a picked הר הביטוח file (xlsx, csv, tsv or text) → policy rows */
export async function readHarb(bytes: Uint8Array): Promise<{ rows: HarbRow[]; warn: string[] }> {
  const cells = bytes[0] === 0x50 && bytes[1] === 0x4b ? await xlsxCells(bytes) : splitTable(decodeText(bytes));
  return harbRows(cells);
}
/** UTF-8 (with or without BOM), else windows-1255 (Excel's CSV on a Hebrew Windows) */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1255').decode(b); }
}

/** policy rows → cover-only held products for a client folder (lib/clients Held): no track, no balance; the cover's cost is the
 *  premium (monthly when the column said monthly or did not say; an annual premium is divided by 12 and the note says so) */
export function heldFromHarb(rows: HarbRow[], asof: string | null): Held[] {
  return rows.map((r) => {
    const monthly = r.premium == null ? null : r.premiumPer === 'year' ? +(r.premium / 12).toFixed(2) : r.premium;
    const name = r.product ?? r.kind ?? 'פוליסה';
    return {
      k: null, typeHe: r.kind ? `ביטוח: ${r.kind}` : 'ביטוח', provider: r.insurer, plan: r.product, track: null,
      balance: null, monthly: null, fee: null, feeHow: null, depfee: null, depHow: null, asof,
      covers: [{ name, kind: r.kind, sum: r.sum, cost: monthly, rate: null }],
      note: [`מהר הביטוח${r.start ? `, מ-${r.start.split('-').reverse().join('.')}` : ''}`, r.premiumPer === 'year' ? 'הפרמיה בקובץ שנתית: חולקה ב-12' : null, ...r.warn].filter(Boolean).join(' · '),
    };
  });
}
