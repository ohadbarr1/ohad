import type { Held } from './clients';
import type { RiskCat, RiskMeta } from './harbTypes';
import { xmlTree, type XNode } from './maslaka';
/* W7 → fox 3.0 A6 · הר הביטוח (harb.cma.gov.il, רשות שוק ההון): the insurance policies in force in the holder's name, which the holder
   downloads after signing in with the government identity service. Read in this browser only; pure (no React, no fetch, no storage).

   The format, and how far it is verified (06.11.26; full notes and quotes in docs/harb-format.md):
   • Primary source, what the site holds per policy. The CMA's circular that set up the site, חוזר ביטוח 2016-1-17 "ממשק אינטרנטי
     לאיתור מוצרי ביטוח" (31.10.2016; its draft 2015-277 of 31.8.2016 carries the reporting file's annex), as amended by חוזר ביטוח
     2022-1-15 (21.9.2022, in force 1.2.2023), §3(א): ID number, policy number, product type, insurance domain (כללי / בריאות /
     חיים), personal or group, start date, end date, the premium ("סך דמי הביטוח השנתיים … בביטוחים שבהם דמי הביטוח נגבים באופן
     חודשי, דמי הביטוח … בגין החודש שקדם ליום הדיווח") and the premium's type (annual or monthly), minor or adult, plus nursing-care
     and motor details. The annex: one CSV row per policy with ענף ראשי / ענף משני / סוג תכנית / תחום / סיווג as numeric codes
     (code tables 603 / 617 / 602 / 300 / 619, below), dates as ddmmyyyy.
       https://www.gov.il/BlobFolder/dynamiccollectorresultitem/notice-2022-1-15/he/regulation%20_%202022-1-15_highlighted_pdf.pdf
       https://www.gov.il/BlobFolder/dynamiccollectorresultitem/regulation-2834/he/regulation_th_2015-277.pdf
   • Not found: any public description of the file the HOLDER downloads (its column headers, file type or encoding). The site answers
     HTTP 403 to anything that is not a signed-in browser, and neither gov.il nor כל זכות documents the export; secondary pages only
     say the screen has an "export to Excel" button.
   So the reader is built on the circular's fields and is tolerant of the container: an .xlsx (a zip of XML: lib/zipRead + the XML
   tree of lib/maslaka), an "Excel" that is really an HTML table (what many government sites send as .xls), a CSV / TSV, or the table
   pasted as text. It finds the header row by Hebrew header words, maps columns by synonyms of the circular's field names (never by
   position), turns code values into names with the circular's tables, and reads the premium's period per row when the file has a
   premium-type column. It is NOT verified against a real export: every read says so (HARB_WARN) until one is checked.
   A binary .xls (BIFF, Excel 97–2003) cannot be read without a spreadsheet library, and none is installed: the reader says to save it
   as .xlsx or CSV.
   Privacy: no ID number, no name and no full policy number is kept. The insured column, when there is one, becomes an ordinal
   (insured 1, 2, …) so overlaps are checked per person; the policy number is used to drop duplicate rows and only its last four
   characters are kept, to tell two policies apart with the insurer. */

export const HARB_WARN = 'מבנה קובץ הייצוא מהר הביטוח לא אומת מול קובץ אמיתי: העמודות זוהו לפי שמות הכותרות, על בסיס השדות שבחוזר הממשק (2016-1-17, תיקון 2022-1-15)';
export const HARB_ACCEPT = '.xlsx,.xls,.csv,.tsv,.txt,.htm,.html,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain,text/html';

/** a policy row of the הר הביטוח list, as read (before it becomes a folder's held product) */
export interface HarbRow {
  insurer: string | null;
  /** the secondary branch, else the main branch: what the policy is "for" in one phrase (kept for W7 callers) */
  kind: string | null;
  product: string | null;
  main: string | null; sub: string | null; domain: string | null; ptype: string | null; group: boolean | null;
  cats: RiskCat[];
  premium: number | null; premiumPer: 'month' | 'year' | null;
  sum: number | null; start: string | null; end: string | null;
  /** last four characters of the policy number, '…1234' */
  pol: string | null;
  /** insured ordinal (1, 2, …) when the file has an insured column */
  who: number | null;
  warn: string[];
}

/* ---------- the circular's code tables (annex to draft 2015-277, "טבלת קודי דיווח"). The 2022 amendment says reporting codes were
   refined; the reader prefers the text a file gives and uses these only when a cell is a bare number. ---------- */
export const CODE_MAIN: Record<number, string> = { 1: 'חיים מקיף', 5: 'תאונות אישיות', 6: 'מחלות ואשפוז', 8: 'רכב חובה', 9: "רכב רכוש - פרטי וצד ג'", 12: 'ביטוח מקיף דירות ובתי עסק', 28: 'חיים סיכון בלבד' };
export const CODE_SUB: Record<number, string> = {
  1: 'הוצאות רפואיות/אחר', 2: 'נסיעות לחו"ל', 3: 'שיניים', 5: 'סיעודי', 6: 'אבדן כושר עבודה', 7: 'עובדים זרים', 8: 'מחלות קשות', 9: 'הוצאות רפואיות/ניתוחים משלים שב"ן',
  10: 'נכות מתאונה', 11: 'מקיף לבית עסק', 12: 'מקיף לדירות', 13: 'תכשיטים', 36: 'אכ"ע', 37: 'ביטוח אריכות ימים', 38: 'ביטוח חיים חיסכון טהור', 39: 'ביטוח חיים משולב בחיסכון',
  40: 'ביטוח חיים ריסק טהור', 41: 'הוצאות רפואיות/השתלות', 42: 'הוצאות רפואיות/ניתוחים מהשקל הראשון', 43: 'הוצאות רפואיות/רילוקיישן – שוהים ישראלים בחו"ל', 44: 'הוצאות רפואיות/תרופות', 45: 'תאונות אישיות',
};
export const CODE_PTYPE: Record<number, string> = { 1: 'ביטוח יסודי', 2: 'נספח/הרחבה', 4: 'כתב שירות', 8: 'תנאים כללים' };
export const CODE_DOMAIN: Record<number, string> = { 5: 'חיים ואבדן כושר עבודה', 6: 'בריאות ותאונות אישיות', 7: 'כללי' };
export const CODE_CLS: Record<number, boolean> = { 2: true, 4: false };

/* ---------- header words → column role. Ordered: a header cell takes the FIRST role whose words it matches, so the specific
   phrases come before the general ones ("סוג פרמיה" before "פרמיה", "ענף ראשי" before "ענף"). The words are the circular's field
   names and their usual Hebrew variants; none is taken from a real export. ---------- */
type Role = 'id' | 'policyNo' | 'planNo' | 'minor' | 'premType' | 'premYear' | 'premMonth' | 'sum' | 'premium' | 'start' | 'end' | 'period'
  | 'main' | 'sub' | 'domain' | 'cls' | 'ptype' | 'insurer' | 'who' | 'product';
const COLS: [Role, RegExp][] = [
  ['id', /ת\.?\s?ז|תעודת זהות|מספר זהות|מס['׳]?\s?זהות/],
  ['policyNo', /מספר (ה)?פוליס|מס['׳]?\s?(ה)?פוליס|פוליסה מס/],
  ['planNo', /מספר (ה)?(תכנית|תוכנית)|מס['׳]?\s?(תכנית|תוכנית)|קוד (תכנית|תוכנית)|אותות/],
  ['minor', /קטין|בגיר/],
  ['premType', /סוג (ה)?פרמי|סוג דמי (ה)?ביטוח|תדירות|אופן (ה)?תשלום|(חודשי|שנתי)\S*\s*\/\s*(חודשי|שנתי)/],
  ['premYear', /(פרמי\S*|דמי (ה)?ביטוח)\s*(ה)?שנתי/],
  ['premMonth', /(פרמי\S*|דמי (ה)?ביטוח)\s*(ה)?חודשי/],
  ['sum', /סכום (ה)?ביטוח|סכום (ה)?כיסוי|סכום מבוטח/],
  ['premium', /פרמי|דמי (ה)?ביטוח|תשלום|עלות/],
  ['start', /תחיל|התחל|מתאריך/],
  ['end', /סיום|תום|עד תאריך|תפוג/],
  ['period', /תקופ/],
  ['main', /ענף ראשי/],
  ['sub', /ענף משני|ענף \(משני\)|סוג (ה)?כיסוי|כיסוי/],
  ['domain', /תחום/],
  ['cls', /סיווג|אישי\s*\/\s*קבוצתי/],
  ['ptype', /סוג (ה)?(מוצר|תכנית|תוכנית)/],
  ['main', /ענף|סוג (ה)?ביטוח/],
  ['insurer', /חברה|חברת|מבטח|גוף|יצרן/],
  ['who', /מבוטח/],
  ['product', /שם (ה)?(פוליסה|מוצר|תכנית|תוכנית)|תיאור|פרטים|מוצר|תכנית|תוכנית|פוליסה/],
];
const HEADER_MIN = 2;

const numOf = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  const t = s.replace(/ש["״]?ח|₪|[,\s‎‏]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return +t;
};
const okYMD = (y: number, m: number, d: number) => y >= 1950 && y <= 2120 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => (okYMD(y, m, d) ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);
/** a date as a policy list may write it → yyyy-mm-dd: dd/mm/yyyy, dd.mm.yyyy, dd/mm/yy, yyyy-mm-dd, ddmmyyyy (the circular's N8),
 *  yyyymmdd, or an Excel serial day number (an .xlsx date cell) */
export const harbDate = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const t = s.trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] - (+m[3] > 69 ? 100 : 0) : +m[3]; return ymd(y, +m[2], +m[1]); }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  const y8 = /^(\d{4})(\d{2})(\d{2})$/.exec(t);  // yyyymmdd when it reads as one, else ddmmyyyy (the circular's N8)
  if (y8 && okYMD(+y8[1], +y8[2], +y8[3])) return ymd(+y8[1], +y8[2], +y8[3]);
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(t)) {  // Excel serial (1900 system), counted from 30.12.1899 (Excel's phantom 29.2.1900 included)
    const n = Math.floor(+t);
    if (n < 18264 || n > 80000) return null;  // 1950 … 2119
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
};
const codeOr = (v: string | null, table: Record<number, string>) => {
  if (!v) return null;
  const t = v.trim();
  if (/^\d{1,3}$/.test(t)) return table[+t] ?? `קוד ${t}`;
  return t || null;
};

/* ---------- the cover a policy is for ---------- */
const SPECIFIC: [RiskCat, RegExp][] = [
  ['foreign', /עובדים זרים/],
  ['surgShaban', /שב["״]?ן/],
  ['surg1', /שקל ה?ראשון/],
  ['surgAbroad', /ניתוח\S*[^,]*בחו["״]?ל/],
  ['transplant', /השתל/],
  ['drugs', /תרופ/],
  ['ambul', /ייעוץ|יעוץ|בדיקות|אמבולטורי/],
  ['dental', /שיניים/],
  ['ltc', /סיעוד/],
  ['ci', /מחלות קשות|מחלה קשה|גילוי מוקדם/],
  ['di', /אכ["״]?ע|א?בדן כושר|אובדן כושר/],
  ['pa', /נכות מתאונה|תאונות אישיות|תאונה/],
  ['lifeSave', /חיסכון|משולב|אריכות ימים|חיים מקיף|מעורב/],
  ['life', /ריסק|סיכון בלבד|למקרה מוות/],
  ['carMand', /חובה/],
  ['car', /רכב|צד ג/],
  ['home', /דיר|מבנה|תכולה|בית עסק|בתי עסק|תכשיט/],
  ['travel', /נסיעות|נסיעה לחו/],
];
const GENERIC: [RiskCat, RegExp][] = [
  ['surg1', /ניתוח/],
  ['life', /חיים/],
  ['healthOther', /בריאות|רפואי|אשפוז|מחלות/],
];
function textCats(t: string): RiskCat[] {
  const out = SPECIFIC.filter(([, re]) => re.test(t)).map(([c]) => c);
  if (out.includes('carMand')) return out.filter((c) => c !== 'car');
  if (out.length) return out;
  const g = GENERIC.filter(([, re]) => re.test(t)).map(([c]) => c);
  return g.length ? [g[0]] : [];
}
/** the cover(s) of a policy: from the secondary branch when it says something specific; else from the product name and the main
 *  branch; 'other' when nothing is recognised */
export function catsOf(main: string | null, sub: string | null, product: string | null): RiskCat[] {
  const bySub = sub ? textCats(sub) : [];
  if (bySub.length && !bySub.every((c) => c === 'healthOther')) return bySub;
  const byRest = textCats([product, main].filter(Boolean).join(' · '));
  if (byRest.length && !(bySub.length && byRest.every((c) => c === 'healthOther'))) return byRest;
  return bySub.length ? bySub : ['other'];
}

/** text (CSV, TSV or a pasted table) → rows of cells */
export function splitTable(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const probe = lines.slice(0, 8).join('\n');
  const sep = probe.includes('\t') ? '\t' : (probe.match(/;/g)?.length ?? 0) > (probe.match(/,/g)?.length ?? 0) ? ';' : ',';
  return lines.map((l) => {
    if (sep === '\t') return l.split('\t').map((c) => c.trim());
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && cur.trim() === '') { q = true; cur = ''; }  // a quote opens a quoted cell only at its start (בע"מ in the middle of a name is text)
      else if (ch === sep) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

/** an "Excel" file that is an HTML table (a common government export) → rows of cells. Tags are stripped as text; nothing is
 *  rendered or executed. */
export function htmlCells(html: string): string[][] {
  const ent = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
  const out: string[][] = [];
  for (const tr of html.replace(/<!--[\s\S]*?-->/g, '').split(/<tr(?=[\s>])/i).slice(1)) {
    const body = tr.split(/<\/tr>/i)[0];
    const cells = [...body.matchAll(/<t[dh](?:\s[^>]*)?>([\s\S]*?)(?=<t[dh][\s>]|<\/t[dh]>|$)/gi)].map((m) => ent(m[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
    out.push(cells);
  }
  return out;
}

/** cells → the policy rows: the first row (of the first 30) with ≥ 2 recognised headers is the header; everything under it is a
 *  policy. `asof`: a date in the lines above the header ("נכון ל…", "תאריך הפקה"), when there is one. */
export function harbRows(cells: string[][]): { rows: HarbRow[]; warn: string[]; asof: string | null; cols: string[] } {
  const warn: string[] = [HARB_WARN];
  let hi = -1, map: Partial<Record<Role, number>> = {};
  for (let i = 0; i < Math.min(cells.length, 30); i++) {
    const m: Partial<Record<Role, number>> = {};
    cells[i].forEach((c, j) => { const r = COLS.find(([, re]) => re.test(c))?.[0]; if (r && m[r] == null) m[r] = j; });
    const useful = Object.keys(m).filter((r) => r !== 'id' && r !== 'who' && r !== 'minor' && r !== 'planNo');
    if (useful.length >= HEADER_MIN) { hi = i; map = m; break; }
  }
  if (hi < 0) return { rows: [], warn: ['לא נמצאה שורת כותרות של רשימת הפוליסות (חברה, ענף, פרמיה…)'], asof: null, cols: [] };
  let asof: string | null = null;
  for (const r of cells.slice(0, hi)) {
    const t = r.join(' ');
    const d = /(\d{1,2}[./]\d{1,2}[./]\d{4})/.exec(t)?.[1], my = /(?:^|\D)(\d{1,2})[./](\d{4})(?!\d)/.exec(t);
    if (d) { asof = harbDate(d); break; }
    if (my && /נכון|עדכני|הפקה|לחודש/.test(t)) { const y = +my[2], mo = +my[1]; asof = ymd(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate()); break; }
  }
  const at = (r: string[], role: Role) => (map[role] != null ? (r[map[role]!] ?? '').trim() || null : null);
  if (map.insurer == null) warn.push('בקובץ לא זוהתה עמודת חברת הביטוח');
  if (map.premium == null && map.premYear == null && map.premMonth == null) warn.push('בקובץ לא זוהתה עמודת פרמיה');
  const perOfHeader: 'month' | 'year' | null = map.premYear != null ? 'year' : map.premMonth != null ? 'month' : null;
  if (!perOfHeader && map.premType == null && map.premium != null) warn.push('הקובץ לא אומר אם הפרמיה חודשית או שנתית: היא מוצגת כפי שהיא ולא נכנסת לסכום החודשי');
  const rows: HarbRow[] = [];
  const seen = new Set<string>();
  const whoOf = new Map<string, number>();
  for (const r of cells.slice(hi + 1)) {
    if (r.every((c) => !c || !c.trim())) continue;
    const insurer = at(r, 'insurer');
    const main = codeOr(at(r, 'main'), CODE_MAIN), sub = codeOr(at(r, 'sub'), CODE_SUB), product = at(r, 'product');
    if (!insurer && !main && !sub && !product) continue;
    if (/^סה["״]?כ/.test((insurer ?? main ?? product ?? '').trim())) continue;  // a totals line
    const pno = at(r, 'policyNo');
    const idv = at(r, 'id') ?? at(r, 'who');
    let who: number | null = null;
    if (idv) { if (!whoOf.has(idv)) whoOf.set(idv, whoOf.size + 1); who = whoOf.get(idv)!; }
    const key = [insurer, main, sub, product, pno, who].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    // the premium and its period: a per-year / per-month header, else the row's premium-type cell
    const py = numOf(at(r, 'premYear')), pm = numOf(at(r, 'premMonth')), p = numOf(at(r, 'premium'));
    const pt = at(r, 'premType');
    let premium: number | null, per: 'month' | 'year' | null;
    if (pm != null) { premium = pm; per = 'month'; }
    else if (py != null) { premium = py; per = 'year'; }
    else { premium = p; per = pt ? (/חודש/.test(pt) ? 'month' : /שנת/.test(pt) ? 'year' : null) : perOfHeader; }
    const cl = at(r, 'cls');
    const group = cl == null ? null : /^\d+$/.test(cl) ? CODE_CLS[+cl] ?? null : /קבוצ/.test(cl) ? true : /אישי|פרט/.test(cl) ? false : null;
    let start = harbDate(at(r, 'start')), end = harbDate(at(r, 'end'));
    const period = at(r, 'period');
    if (period && (!start || !end)) {
      const ds = period.match(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}/g) ?? [];
      start = start ?? harbDate(ds[0]); end = end ?? harbDate(ds[1]);
    }
    const pn = pno?.replace(/\s/g, '') ?? '';
    rows.push({
      insurer, kind: sub ?? main, product, main, sub, domain: codeOr(at(r, 'domain'), CODE_DOMAIN), ptype: codeOr(at(r, 'ptype'), CODE_PTYPE), group,
      cats: catsOf(main, sub, product), premium, premiumPer: per, sum: numOf(at(r, 'sum')), start, end, pol: pn.length >= 5 ? `…${pn.slice(-4)}` : null, who, warn: [HARB_WARN],
    });
  }
  if (!rows.length) warn.push('לא נמצאו שורות פוליסה מתחת לכותרות');
  if (whoOf.size > 1) warn.push(`בקובץ ${whoOf.size} מבוטחים: הכפילויות נבדקות לכל מבוטח בנפרד (מספרי הזהות והשמות לא נשמרים)`);
  const cols = (Object.keys(map) as Role[]).filter((r) => r !== 'id' && r !== 'who');
  return { rows, warn, asof, cols };
}

/** an .xlsx (zip of XML) → the first sheet's cells, through lib/zipRead (loaded only now) and lib/maslaka's XML tree. Shared strings
 *  and inline strings are read; a date cell comes out as its Excel serial number and harbDate reads it. */
export async function xlsxCells(bytes: Uint8Array): Promise<string[][]> {
  const { unpackZip } = await import('./zipRead');
  const u = await unpackZip(bytes, null);  // lib/zipRead keeps only .xml entries: exactly an .xlsx's sheets and shared strings
  const z = new Map(u.xml.map((f) => [f.path, f.data]));
  const ss = z.get('xl/sharedStrings.xml');
  const sheet = z.get('xl/worksheets/sheet1.xml') ?? [...z.entries()].find(([n]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))?.[1];
  if (!sheet) return [];
  const strings: string[] = [];
  if (ss) for (const si of xmlTree(new TextDecoder().decode(ss)).c.filter((n) => n.n === 'si')) strings.push(textOf(si));
  const out: string[][] = [];
  const sheetData = xmlTree(new TextDecoder().decode(sheet)).c.find((n) => n.n === 'sheetData');
  for (const row of sheetData?.c.filter((n) => n.n === 'row') ?? []) {
    const cells: string[] = [];
    for (const c of row.c.filter((n) => n.n === 'c')) {
      const col = colIndex(c.a?.r ?? '');
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
const textOf = (n: XNode): string => (n.n === 'rPh' ? '' : n.t + n.c.map(textOf).join(''));  // phonetic runs are not text
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return Math.max(0, n - 1); };

export type HarbKind = 'xlsx' | 'xls-bin' | 'html' | 'text';
/** what a picked file is, from its first bytes */
export function harbKind(b: Uint8Array): HarbKind {
  if (b[0] === 0x50 && b[1] === 0x4b) return 'xlsx';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'xls-bin';
  const head = decodeText(b.subarray(0, 2048)).replace(/^﻿/, '').trimStart().slice(0, 600).toLowerCase();
  if (/^<(!doctype html|html|table|meta)|<table[\s>]/.test(head)) return 'html';
  return 'text';
}
/** a file from the client: a הר הביטוח list rather than a clearing-house file? (the extension, else the contents) */
export function looksHarb(name: string, b: Uint8Array): boolean {
  if (/\.(xlsx|xls|csv|tsv|txt|html?)$/i.test(name)) return true;
  if (/\.(zip|xml)$/i.test(name)) return false;
  const k = harbKind(b);
  return k === 'xls-bin' || k === 'html' || (k === 'text' && !/^\s*<\?xml|^\s*<Mimshak/i.test(decodeText(b.subarray(0, 400)).replace(/^﻿/, '')));
}

export const XLS_BIN = 'זה קובץ Excel בפורמט הישן (‎.xls‎ בינארי), שאי אפשר לקרוא בדפדפן בלי ספריית גיליונות. פותחים אותו ב-Excel, שומרים בשם כ-‎.xlsx‎ או כ-CSV, ובוחרים שוב.';
/** a picked הר הביטוח file (xlsx, html-as-xls, csv, tsv or text) → policy rows. Throws on a binary .xls (XLS_BIN). */
export async function readHarb(bytes: Uint8Array): Promise<{ rows: HarbRow[]; warn: string[]; asof: string | null; cols: string[] }> {
  const k = harbKind(bytes);
  if (k === 'xls-bin') throw new Error(XLS_BIN);
  const cells = k === 'xlsx' ? await xlsxCells(bytes) : k === 'html' ? htmlCells(decodeText(bytes)) : splitTable(decodeText(bytes));
  return harbRows(cells);
}
/** UTF-8 (with or without BOM), UTF-16 LE, else windows-1255 (Excel's CSV on a Hebrew Windows) */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1255').decode(b); }
}

/** Red team 06.11.26 · the highest monthly premium that is plausible for a cover billed monthly (₪). Covers usually billed once a year
 *  (compulsory and comprehensive car, home, travel) have low ceilings: a "₪1,230 a month" compulsory-car premium is almost surely the
 *  year's premium. These are a reading heuristic of fox (round numbers, set well above usual prices), not a market price: a premium
 *  above them is flagged and kept out of the monthly total until the agent confirms the period. */
export const MONTHLY_MAX: Partial<Record<RiskCat, number>> = { carMand: 400, car: 800, home: 400, travel: 300, foreign: 800 };
export const MONTHLY_MAX_ANY = 3000;
export const PER_DOUBT = 'ייתכן שזו פרמיה שנתית';
/** the doubt about a premium the file calls monthly, or null */
export function perDoubt(cats: RiskCat[], premium: number | null, per: 'month' | 'year' | null): string | null {
  if (per !== 'month' || premium == null || premium <= 0) return null;
  const caps = cats.map((c) => MONTHLY_MAX[c]).filter((v): v is number => v != null);
  const cap = caps.length ? Math.max(...caps) : MONTHLY_MAX_ANY;
  return premium > cap ? `${PER_DOUBT}: ₪${Math.round(premium).toLocaleString('en-US')} "לחודש" גבוה מהרגיל לכיסוי הזה (מעל ₪${cap.toLocaleString('en-US')}); לא נכנס לסכום החודשי עד שמאשרים` : null;
}

/** the premium a month, ₪: a monthly premium as is, an annual one ÷ 12; null when the file gives no premium or does not say which */
export const monthlyOf = (premium: number | null, per: 'month' | 'year' | null): number | null =>
  premium == null || per == null ? null : per === 'year' ? +(premium / 12).toFixed(2) : premium;

const dmy = (iso: string) => iso.split('-').reverse().join('.');
/** policy rows → cover-only held products for a client folder (lib/clients Held), each with its risk record (lib/harbTypes). No
 *  track, no balance; the cover's cost is the premium a month (an annual premium ÷ 12, and the note says so). */
export function heldFromHarb(rows: HarbRow[], asof: string | null): Held[] {
  return rows.map((r) => {
    const name = r.product ?? r.sub ?? r.main ?? 'פוליסה';
    const doubt = perDoubt(r.cats, r.premium, r.premiumPer);
    const risk: RiskMeta = { src: 'harb', cats: r.cats, main: r.main, sub: r.sub, domain: r.domain, ptype: r.ptype, group: r.group, premium: r.premium, per: r.premiumPer, start: r.start, end: r.end, pol: r.pol, who: r.who, ...(doubt ? { perDoubt: doubt } : {}) };
    return {
      k: null, typeHe: `ביטוח: ${(r.sub ?? r.main ?? r.kind ?? 'פוליסה').slice(0, 70)}`, provider: r.insurer, plan: r.product, track: null,
      balance: null, monthly: null, fee: null, feeHow: null, depfee: null, depHow: null, asof,
      covers: [{ name, kind: r.sub ?? r.main, sum: r.sum, cost: doubt ? null : monthlyOf(r.premium, r.premiumPer), rate: null }],
      note: ['מהר הביטוח', r.start ? `מ-${dmy(r.start)}` : null, r.end ? `עד ${dmy(r.end)}` : null, doubt ? PER_DOUBT : r.premiumPer === 'year' ? 'הפרמיה בקובץ שנתית: חולקה ב-12' : r.premiumPer == null && r.premium != null ? 'לא צוין אם הפרמיה חודשית או שנתית' : null].filter(Boolean).join(' · '),
      risk,
    };
  });
}
