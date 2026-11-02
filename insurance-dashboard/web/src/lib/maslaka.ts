import type { DepositRow, GuaranteedCoef, HeldExtra } from './clientTypes';  // W7: deposits, code, salary, guaranteed coefficient
/* W3 · "ייבוא מהמסלקה" (בטא): the pension clearing house's personal file, read in this browser only.
   W7 (wave 2, the client engine): the zip itself is opened in the browser (lib/zipRead), several provider files merge into one
   (mergeMFiles), the unified code matches a track before any name (by: 'code'), and deposits, salary, the insurance track, the covers'
   cost and a guaranteed coefficient are read. Sources checked for W7 (02.11.26):
   · The regulator's field schema of the holdings interface, version 008, downloaded from gov.il:
     https://www.gov.il/BlobFolder/dynamiccollectorresultitem/holdings-ver008/he/MivneAchid_Holdings_Excel_008.xlsx
     (sheet "סכימת השדות - אחזקות", 410 element names; every name in MAP below is in it). Its XSD neighbours
     (…/holdings-ver008/he/MivneAchid_Holdings_{HevrotBituah,KupotGemel,KarnotPensiaHadashot,KarnotPensiaVatikot}_XSD_Schema_008.xsd)
     are behind gov.il's bot wall (HTTP 403 to every scripted fetch), as is the "צובר הממשקים" page that the 17.3.25 draft of the
     circular (https://www.gov.il/BlobFolder/dynamiccollectorresultitem/notice-2025-06/he/uniform_protocol_draft_17.3.25%20[PDF].pdf)
     names as the home of "כלל קבצי הדיווח לגופים מוסדיים לגרסה 9". So version 009 could not be diffed against a primary source.
   · What 009 files look like: the 6-file sample set of github.com/meir-pletinsky/israeli-retirement-planning
     (app/public/sample/sample-clearing-house-report.zip), built by its author from 8 real 009 reports. Every element in it is in the
     008 schema except two: MIN (gender; never read here) and SHEUR-KISUY-ALMAN-O-ALMANA, a spelling of the 008 name
     SHIUR-KISUY-ALMAN-O-ALMANA; that one is an alias below, marked inferred. SUG-HAMAFKID 6 (a transfer from another fund) is also
     from that analysis and not in the 008 code table (1–5): inferred.
   · The unified code: חוזר גופים מוסדיים 2015-231 "קידוד אחיד", section 3 (quoted at code30 below).

   Pure: no React, no fetch, no storage. The page hands it the file's bytes; nothing leaves the device, and the parser never reads the
   holder's name, ID number, account number, employer or beneficiaries (it does not even look at YeshutLakoach / YeshutMaasik /
   MISPAR-POLISA-O-HESHBON: for a new pension fund the "account number" is the holder's ID number).

   The format. The clearing house (המסלקה הפנסיונית, swiftness.co.il) delivers the regulator's uniform holdings interface ("ממשק אחזקות",
   מבנה אחיד להעברת מידע ונתונים בשוק החיסכון הפנסיוני, רשות שוק ההון, ביטוח וחיסכון): one XML per provider (root `Mimshak`), inside a
   password-protected zip (with an Excel and PDFs). Element names below were checked against the regulator's XSD, version 008,
   "MivneAchid_Holdings_KarnotPensiaHadashot_XSD_Schema_008.xsd" (gov.il blocks scripted downloads; read from the public mirror
   https://raw.githubusercontent.com/nzig/pension-checker/master/MivneAchid_Holdings_KarnotPensiaHadashot_XSD_Schema_008.xsd, every
   path in MAP below is in it), and corroborated by an analysis of 8 real files, https://github.com/meir-pletinsky/israeli-retirement-planning
   (docs/clearing-house-import-analysis.md). Real files declare version 009, which was not available to check: hence a tolerant reader
   (by element name inside its container, any namespace, unknown elements ignored, every value optional) and one mapping table (MAP)
   to change if 009 renamed something.
   The 30-digit codes (KOD-MASLUL-HASHKAA, KIDOD-ACHID): "חוזר קידוד אחיד" (גופים מוסדיים 2015-231): 9 digits company registration
   number, 14 the product (for a provident or pension fund: its income-tax approval number), 4 the investment track, 3 the fee track;
   https://www.gov.il/BlobFolder/dynamiccollectorresultitem/regulation-2874/he/regulation_th2015-231.pdf
   Matching to fox's tracks (data.gov.il גמל-נט / פנסיה-נט / ביטוח-נט): the product number is tried as the track's own number (FUND_ID),
   then as its parent fund (pid, the transfer bank's fund), with the 4-digit track as the track's number, then the track's name in the
   file; every match says how it was made, and an unmatched product says why. */

/* ---------- a tiny XML tree ---------- */

export interface XNode { n: string; t: string; c: XNode[]; nil?: boolean; /** attributes, when the element has any (W7: the xlsx reader of lib/harb needs a cell's r / t) */ a?: Record<string, string> }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unent = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const local = (q: string) => q.slice(q.indexOf(':') + 1);

/** A minimal, strict-enough XML reader (elements, text, CDATA, comments, entities; no DTD): the same tree in node (the tests) as in
 *  the browser. Throws on a tag that does not close. */
export function xmlTree(src: string): XNode {
  const root: XNode = { n: '#doc', t: '', c: [] };
  const stack: XNode[] = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { top().t += unent(src.slice(i)); break; }
    if (lt > i) top().t += unent(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); if (e < 0) throw new Error('הערה שלא נסגרה'); i = e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt + 9); if (e < 0) throw new Error('CDATA שלא נסגר'); top().t += src.slice(lt + 9, e); i = e + 3; continue; }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt + 2); if (e < 0) throw new Error('הוראת עיבוד שלא נסגרה'); i = e + 2; continue; }
    if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt + 2); if (e < 0) throw new Error('הגדרה שלא נסגרה'); i = e + 1; continue; }
    // the end of the tag, outside quoted attribute values
    let j = lt + 1, q = '';
    for (; j < src.length; j++) { const ch = src[j]; if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; }
    if (j >= src.length) throw new Error('תגית שלא נסגרה');
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === '/') {
      const name = local(body.slice(1).trim());
      const cur = stack.pop();
      if (!cur || cur === root || cur.n !== name) throw new Error(`תגית סגירה לא צפויה: ${name}`);
      continue;
    }
    const self = body.endsWith('/');
    const m = /^([^\s/>]+)([\s\S]*?)\/?$/.exec(body);
    if (!m) throw new Error('תגית לא תקינה');
    const node: XNode = { n: local(m[1]), t: '', c: [] };
    if (/\bnil\s*=\s*["']true["']/.test(m[2])) node.nil = true;
    if (m[2].includes('=')) { const a: Record<string, string> = {}; for (const am of m[2].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) a[local(am[1])] = unent(am[2] ?? am[3] ?? ''); node.a = a; }
    top().c.push(node);
    if (!self) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`תגית שלא נסגרה: ${top().n}`);
  const el = root.c[0];
  if (!el) throw new Error('הקובץ ריק');
  return el;
}

/** The same tree from a DOM element (the browser's DOMParser). */
export function fromDom(el: Element): XNode {
  const out: XNode = { n: el.localName, t: '', c: [] };
  const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
  if (el.getAttributeNS(XSI, 'nil') === 'true' || el.getAttribute('xsi:nil') === 'true') out.nil = true;
  if (el.attributes.length) { const a: Record<string, string> = {}; for (const at of Array.from(el.attributes)) a[at.localName] = at.value; out.a = a; }
  el.childNodes.forEach((ch) => {
    if (ch.nodeType === 1) out.c.push(fromDom(ch as Element));
    else if (ch.nodeType === 3 || ch.nodeType === 4) out.t += ch.nodeValue ?? '';
  });
  return out;
}

/** Text → tree: the browser's DOMParser when there is one (the page), else xmlTree (node). */
export function readTree(text: string): XNode {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) throw new Error('הקובץ אינו XML תקין');
    return fromDom(doc.documentElement);
  }
  return xmlTree(text);
}

/** Bytes → text: a BOM, else the XML declaration's encoding (UTF-8 by default; windows-1255 / ISO-8859-8 when declared). */
export function decodeXml(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const head = String.fromCharCode(...b.subarray(0, 200));
  const enc = /encoding\s*=\s*["']([A-Za-z0-9_.:-]+)["']/.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
  try { return new TextDecoder(enc).decode(b); } catch { return new TextDecoder('utf-8').decode(b); }
}

/** What a picked file is, from its first bytes: the clearing house's zip and PDFs are common mistakes. */
export function sniff(b: Uint8Array): 'zip' | 'pdf' | 'xml' | 'other' {
  if (b[0] === 0x50 && b[1] === 0x4b) return 'zip';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  const head = String.fromCharCode(...b.subarray(0, 64)).replace(/^﻿|^[ï»¿ÿþ\s]+/, '');
  return head.startsWith('<') || head.includes('<?xml') ? 'xml' : 'other';
}

/* ---------- the mapping ---------- */

/** Every element the parser reads, by role. Paths are from `Mimshak` (XSD v008); the reader finds each by name inside the container
 *  given, so an extra wrapper in a later version does not break it. Change a name here if version 009 renamed it. */
export const MAP = {
  root: 'Mimshak',
  header: 'KoteretKovetz', version: 'MISPAR-GIRSAT-XML', runDate: 'TAARICH-BITZUA',                  // Mimshak/KoteretKovetz/…
  provider: 'YeshutYatzran', providerId: 'KOD-MEZAHE-YATZRAN', providerName: 'SHEM-YATZRAN',      // Mimshak/YeshutYatzran/…
  product: 'Mutzar', productData: 'NetuneiMutzar', productType: 'SUG-MUTZAR',                      // …/Mutzarim/Mutzar/NetuneiMutzar/SUG-MUTZAR
  account: 'HeshbonOPolisa',                                                                       // …/Mutzar/HeshbonotOPolisot/HeshbonOPolisa
  plan: 'SHEM-TOCHNIT', unified: 'KIDOD-ACHID', asOf: 'TAARICH-NECHONUT', status: 'STATUS-POLISA-O-CHESHBON',
  pensionKind: 'SUG-KEREN-PENSIA', oldNew: 'PENSIA-VATIKA-O-HADASHA',
  balances: 'Yitrot', balanceDate: 'TAARICH-ERECH-TZVIROT', balanceRow: 'PerutYitrot', balance: 'TOTAL-CHISACHON-MTZBR',   // …/PirteiTaktziv/BlockItrot/Yitrot/…
  lastDeposit: 'PerutPirteiHafkadaAchrona', lastDepositDate: 'TAARICH-HAFKADA-ACHARON', lastDepositTotal: 'TOTAL-HAFKADA-ACHRONA', // …/PirteiTaktziv/PirteiHafkadaAchrona/…
  lastDepositRow: 'PerutHafkadaAchrona', depositAmount: 'SCHUM-HAFKADA-SHESHULAM',
  depositRows: 'PerutHafkadotMetchilatShana', depositRowDate: 'TAARICH-ERECH-HAFKADA',
  actualFees: 'HotzaotBafoalLehodeshDivoach', actualDepFee: 'SHEUR-DMEI-NIHUL-HAFKADA', actualAccFeeMonthly: 'SHEUR-DMEI-NIHUL-TZVIRA', // …/PirteiTaktziv/PerutHotzaot/…
  feeTerms: 'PerutMivneDmeiNihul', feeBasis: 'SUG-HOTZAA', feeRate: 'SHEUR-DMEI-NIHUL',          // …/PerutHotzaot/MivneDmeiNihul/PerutMivneDmeiNihul (SUG-HOTZAA 1 = מצבירה, 2 = מהפקדה; annual)
  track: 'PerutMasluleiHashkaa', trackCode: 'KOD-MASLUL-HASHKAA', trackName: 'SHEM-MASLUL-HASHKAA', trackRole: 'KOD-SUG-MASLUL',
  trackAmount: 'SCHUM-TZVIRA-BAMASLUL', trackDepFee: 'SHEUR-DMEI-NIHUL-HAFKADA', trackAccFee: 'SHEUR-DMEI-NIHUL-HISACHON',
  ytd: 'SHEUR-TSUA-NETO',                                                                          // …/HeshbonOPolisa/Tsua/SHEUR-TSUA-NETO (from the start of the year)
  // W4 · insurance cover (…/HeshbonOPolisa/Kisuim/ZihuiKisui/…, XSD v008). Read by name inside its own container only: the cover's
  // PirteiMevutach (the insured person, with an ID number) is never opened.
  covers: 'Kisuim', coverId: 'ZihuiKisui', coverName: 'SHEM-KISUI-YATZRAN',
  coverPart: 'PirteiKisuiBeMutzar', coverKind: 'SUG-KISUY-BITOCHI', coverSum: 'SCHUM-BITUACH',            // …/ZihuiKisui/PirteiKisuiBeMutzar/…
  coverBase: 'SchumeiBituahYesodi', coverSumTrack: 'SCHUM-BITUACH-LEMASLUL', coverSumDeath: 'SCHUM-BITUAH-LEMAVET', // …/ZihuiKisui/SchumeiBituahYesodi/…
  coverPension: 'KisuiBKerenPensia', disPension: 'SACH-PENSIAT-NECHUT', disRate: 'SHEUR-KISUY-NECHUT', disCost: 'ALUT-KISUI-NECHUT', // …/ZihuiKisui/KisuiBKerenPensia/…
  survSpouse: 'KITZBAT-SHEERIM-LEALMAN-O-ALMANA',
  insTrack: 'MaslulBituach', insTrackName: 'SHEM-MASLUL-HABITUAH',                                  // …/HeshbonOPolisa/MaslulBituach/…
  // W7 · deposits (…/PirteiTaktziv/PerutHafkadotMetchilatShana, one row per salary month × deposit type × payer; schema 008 sheet
  // rows "פירוט הפקדות מתחילת השנה"), the policy salary (…/PirteiTaktziv/PirteiHaasaka) and the covers' cost
  depositType: 'SUG-HAFRASHA', depositor: 'SUG-HAMAFKID', depositSalaryMonth: 'CHODESH-SACHAR', depositSalary: 'SACHAR-BERAMAT-HAFKADA',
  salaryBlock: 'PirteiHaasaka', salary: 'SACHAR-POLISA',
  insCostMonth: 'SACH-DMEI-BITUAH-SHENIGBOO',                                                        // …/PerutHotzaot/HotzaotBafoalLehodeshDivoach (the month's insurance cost)
  coverCost: 'ALUT-KISUI',                                                                           // …/ZihuiKisui/PirteiKisuiBeMutzar/ALUT-KISUI (₪ a month)
  survRate: 'SHIUR-KISUY-ALMAN-O-ALMANA',                                                            // …/KisuiBKerenPensia (% of the pension to the widow/er)
  // W7 · the guaranteed annuity coefficient of an insurance policy: schema 008 "מקדם מובטח לפרישה … עבור מוצרי ביטוח בלבד",
  // …/HeshbonOPolisa/YitraLefiGilPrisha/MEKADEM-MOVTACH-LEPRISHA, one block per retirement age (GIL-PRISHA)
  coefBlock: 'YitraLefiGilPrisha', coefAge: 'GIL-PRISHA', coef: 'MEKADEM-MOVTACH-LEPRISHA',
} as const;

/** W7 · other names the same element was seen under. Only names with a source are here: the 008 schema itself lists both
 *  TOTAL-HAFKADA and TOTAL-HAFKADA-ACHRONA for the last deposit's total; SHEUR-KISUY-ALMAN-O-ALMANA is the spelling in the 009 sample
 *  set (inferred: no 009 schema to confirm it). Add a line here if 009 renamed something. */
export const ALIAS: Partial<Record<string, string[]>> = {
  [MAP.lastDepositTotal]: ['TOTAL-HAFKADA'],
  [MAP.survRate]: ['SHEUR-KISUY-ALMAN-O-ALMANA'],  // inferred
};
const NAMES = new Map<string, Set<string>>();
const namesOf = (name: string) => { let s = NAMES.get(name); if (!s) { s = new Set([name, ...(ALIAS[name] ?? [])]); NAMES.set(name, s); } return s; };

/** SUG-HAFRASHA (schema 008 code table): what part of the deposit a row is */
export const DEPOSIT_TYPES: Record<number, string> = {
  1: 'פיצויים', 2: 'תגמולי עובד', 3: 'תגמולי מעביד', 4: 'תגמולים 47', 5: 'אובדן כושר עבודה', 6: 'שונות עובד', 7: 'שונות מעביד',
  8: 'קרן השתלמות עובד', 9: 'קרן השתלמות מעביד', 10: 'תגמולים פרט', 11: 'ריסק מוות', 12: 'חיסכון לכל ילד',
};
const EMPLOYEE_TYPES = new Set([2, 6, 8, 10]), EMPLOYER_TYPES = new Set([3, 7, 9]), SEVERANCE_TYPE = 1;
/** SUG-HAMAFKID 6 = a transfer from another fund (inferred from 009 files; the 008 table ends at 5 = הפקדת הורים): not a deposit */
const TRANSFER_PAYER = 6;

/** SUG-KISUY-BITOCHI (XSD v008 code table) */
export const COVER_KINDS: Record<number, string> = {
  1: 'מוות', 2: 'נכות מקצועית', 3: 'מוות מתאונה', 4: 'נכות מתאונה', 5: 'אובדן כושר עבודה', 6: 'שחרור מתשלום', 7: 'מחלות קשות', 8: 'תוכנית משולבת חיסכון', 9: 'מוות ואובדן כושר עבודה', 10: 'אחר',
};

/** SUG-MUTZAR (XSD v008 code table) */
export const PRODUCT_TYPES: Record<number, string> = {
  1: 'ביטוח מנהלים (ביטוח חיים משולב חיסכון)', 2: 'קרן פנסיה', 3: 'קופת גמל', 4: 'קרן השתלמות', 5: 'פוליסת חיסכון',
  6: 'ביטוח ריסק', 7: 'ביטוח חיים למשכנתא', 8: 'ריסק קבוצתי', 9: 'גמל להשקעה', 10: 'חיסכון לכל ילד',
};

/* ---------- reading ---------- */

const kid = (n: XNode | undefined, name: string) => { const s = namesOf(name); return n?.c.find((x) => s.has(x.n)); };
const kids = (n: XNode | undefined, name: string) => { const s = namesOf(name); return n ? n.c.filter((x) => s.has(x.n)) : []; };
/** every descendant with this name (or an alias of it; depth first, document order) */
function desc(n: XNode | undefined, name: string, out: XNode[] = [], s = namesOf(name)): XNode[] {
  if (!n) return out;
  for (const c of n.c) { if (s.has(c.n)) out.push(c); desc(c, name, out, s); }
  return out;
}
const first = (n: XNode | undefined, name: string) => desc(n, name)[0];
const txt = (n: XNode | undefined): string | null => { if (!n || n.nil) return null; const t = n.t.trim(); return t === '' ? null : t; };
const num = (n: XNode | undefined): number | null => { const t = txt(n); if (t == null) return null; const x = Number(t.replace(/,/g, '')); return Number.isFinite(x) ? x : null; };
const int = (n: XNode | undefined): number | null => { const x = num(n); return x == null ? null : Math.round(x); };
/** yyyyMMdd (or yyyyMM) → yyyy-mm-dd */
export function isoDate(t: string | null): string | null {
  if (!t) return null;
  const m = /^(\d{4})(\d{2})(\d{2})?/.exec(t.replace(/[^0-9]/g, ''));
  if (!m) return null;
  const mo = +m[2], d = m[3] ? +m[3] : 1;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3] ?? '01'}`;
}

/** A 30-digit unified code split into its parts. חוזר גופים מוסדיים 2015-231 (קידוד אחיד), section 3: "קופת הגמל תסומן ב-30 ספרות:
 *  תשע הספרות הראשונות יסמנו את מספר הגוף המוסדי – לפי מספר החברה ברשם החברות; ארבע עשרה ספרות נוספות … יסמנו את מספר המוצר:
 *  בקופות גמל ובקרנות פנסיה – לפי מספר קופת הגמל, כפי שמופיע באישור מס הכנסה; בתוכניות ביטוח – לפי מספר הזיהוי שקבעה חברת הביטוח;
 *  ארבע ספרות נוספות יסמנו את מסלול ההשקעה … [כשאין מסלול] 0000; שלוש ספרות נוספות יסמנו את מסלול דמי הניהול בתוכניות ביטוח או את
 *  מסלול הביטוח בקרן הפנסיה … [כשאין] 000." (The circular's own example: 512205204-00000000000101-1334-000.) In fox's data the
 *  14-digit product is a fund's own number (`id`: a study or provident fund) or its parent fund (`pid` / `tx.fund`: a pension fund's
 *  transfer-bank number); the 4-digit track is the track's `id`. Non-digits are dropped; shorter codes give what they carry. */
export function code30(s: string | null | undefined): { company: number; product: number; track: number | null; fee: number | null } | null {
  const d = (s ?? '').replace(/\D/g, '');
  if (d.length < 23) return null;
  const company = +d.slice(0, 9), product = +d.slice(9, 23);
  if (!product) return null;
  return { company, product, track: d.length >= 27 ? +d.slice(23, 27) : null, fee: d.length >= 30 ? +d.slice(27, 30) : null };
}

/** an insurance cover of an account: its name, kind, sum (₪: a lump sum, or a monthly pension for a pension fund's disability and
 *  survivors cover), its monthly cost and (a pension fund's disability cover) the % of salary insured */
export interface MCover { name: string; kind: string | null; sum: number | null; cost: number | null; rate: number | null }
export interface MTrack { code: string | null; name: string | null; role: 'acc' | 'dep' | null; amount: number | null; fee: number | null; depfee: number | null }
export type FeeHow = 'terms' | 'track' | 'month12' | 'actual';
export interface MAccount extends HeldExtra {
  providerId: string | null; providerName: string | null;
  type: number | null; typeHe: string; pensionKind: number | null; old: boolean;
  plan: string | null; status: number | null; asof: string | null; balDate: string | null; unified: string | null;
  balance: number | null;
  monthly: number | null; lastDep: string | null;
  fee: number | null; feeHow: FeeHow | null; depfee: number | null; depHow: FeeHow | null;
  ytd: number | null;
  tracks: MTrack[];
  covers: MCover[]; insTrack: string | null;
  /** W7: the month's insurance cost as charged (SACH-DMEI-BITUAH-SHENIGBOO), when the file gives it */
  insCost: number | null;
  warn: string[];
}
export interface MFile {
  version: string | null; runDate: string | null; providerName: string | null; accounts: MAccount[]; warn: string[];
  /** W7: when several provider files were merged (one zip): each file's name, provider and its accounts' index range */
  parts?: { file: string; provider: string | null; from: number; to: number }[];
}

/** W7 · several files (one per provider, as the clearing house's zip holds them) → one file with per-provider parts. Each account
 *  already names its provider; `providerName` is the first one. A version or run date is kept when all parts agree. */
export function mergeMFiles(files: { name: string; file: MFile }[]): MFile {
  if (files.length === 1) return { ...files[0].file, parts: [{ file: files[0].name, provider: files[0].file.providerName, from: 0, to: files[0].file.accounts.length }] };
  const out: MFile = { version: null, runDate: null, providerName: null, accounts: [], warn: [], parts: [] };
  const vs = new Set<string | null>(), ds = new Set<string | null>();
  for (const { name, file } of files) {
    const from = out.accounts.length;
    out.accounts.push(...file.accounts);
    out.parts!.push({ file: name, provider: file.providerName, from, to: out.accounts.length });
    out.providerName = out.providerName ?? file.providerName;
    out.warn.push(...file.warn.map((w) => (file.providerName ? `${file.providerName}: ${w}` : w)));
    vs.add(file.version); ds.add(file.runDate);
  }
  if (vs.size === 1) out.version = [...vs][0];
  if (ds.size === 1) out.runDate = [...ds][0];
  return out;
}

/** fee sanity: annual accumulation fee up to 3%, deposit fee up to 7% (the legal caps are lower; anything above is a misread) */
const FEE_MAX = 3, DEP_MAX = 7;
const okFee = (v: number | null, max: number) => (v != null && v >= 0 && v <= max ? v : null);
const months = (a: string, b: string) => (+a.slice(0, 4) - +b.slice(0, 4)) * 12 + (+a.slice(5, 7) - +b.slice(5, 7));

/** the covers of one account (W4): one entry per cover, a pension fund's disability and survivors cover as two */
export function readCovers(acc: XNode): MCover[] {
  const out: MCover[] = [];
  for (const k of desc(acc, MAP.covers)) for (const z of kids(k, MAP.coverId)) {
    const name = txt(kid(z, MAP.coverName));
    const parts = kids(z, MAP.coverPart);
    const kindN = parts.map((p) => int(kid(p, MAP.coverKind))).find((x) => x != null) ?? null;
    const base = kid(z, MAP.coverBase);
    const sum = parts.map((p) => num(kid(p, MAP.coverSum))).find((x) => x != null) ?? num(kid(base, MAP.coverSumDeath)) ?? num(kid(base, MAP.coverSumTrack));
    const pen = kid(z, MAP.coverPension);
    if (pen) {
      const dis = num(kid(pen, MAP.disPension)), rate = num(kid(pen, MAP.disRate)), cost = num(kid(pen, MAP.disCost)), sp = num(kid(pen, MAP.survSpouse));
      // W7: the widow/er's share of the pension (SHIUR-KISUY-ALMAN-O-ALMANA, %): kept as the survivors row's rate
      const spRate = num(kid(pen, MAP.survRate));
      if (dis != null || rate != null || cost != null) out.push({ name: name ? `${name} · נכות` : 'נכות', kind: 'נכות (קרן פנסיה), קצבה חודשית', sum: dis, cost, rate });
      if (sp != null || spRate != null) out.push({ name: name ? `${name} · שאירים` : 'שאירים', kind: 'קצבת שאירים לבן/בת זוג, חודשית', sum: sp, cost: null, rate: spRate });
      continue;
    }
    if (!name && sum == null) continue;
    // W7: the cover's monthly cost (ALUT-KISUI in the same block as the kind and sum)
    const cost = parts.map((p) => num(kid(p, MAP.coverCost))).find((x) => x != null) ?? null;
    out.push({ name: name ?? (kindN != null ? COVER_KINDS[kindN] ?? 'כיסוי' : 'כיסוי'), kind: kindN != null ? COVER_KINDS[kindN] ?? null : null, sum, cost, rate: null });
  }
  return out;
}

/** W7 · the deposit rows of an account (PerutHafkadotMetchilatShana, then the last-deposit block when the rows do not reach its
 *  month): one DepositRow per salary month, the employee / employer / severance parts added up from the typed rows, the insured
 *  salary when a row states it. A transfer from another fund (SUG-HAMAFKID 6) is not a deposit and is left out with a note. */
export function readDeposits(acc: XNode, warn: string[]): DepositRow[] {
  const by = new Map<string, DepositRow>();
  let transfers = 0;
  const add = (ym: string, paid: string | null, type: number | null, amount: number | null, salary: number | null) => {
    let r = by.get(ym);
    if (!r) { r = { ym, paid, employee: null, employer: null, severance: null, total: null, salary: null }; by.set(ym, r); }
    if (paid && (!r.paid || paid > r.paid)) r.paid = paid;
    if (salary != null && salary > 0) r.salary = salary;
    if (amount == null) return;
    r.total = (r.total ?? 0) + amount;
    if (type === SEVERANCE_TYPE) r.severance = (r.severance ?? 0) + amount;
    else if (type != null && EMPLOYEE_TYPES.has(type)) r.employee = (r.employee ?? 0) + amount;
    else if (type != null && EMPLOYER_TYPES.has(type)) r.employer = (r.employer ?? 0) + amount;
  };
  for (const r of desc(acc, MAP.depositRows)) {
    if (int(kid(r, MAP.depositor)) === TRANSFER_PAYER) { transfers++; continue; }
    const paid = isoDate(txt(kid(r, MAP.depositRowDate)));
    const ym = isoDate(txt(kid(r, MAP.depositSalaryMonth)))?.slice(0, 7) ?? paid?.slice(0, 7);
    if (!ym) continue;
    add(ym, paid, int(kid(r, MAP.depositType)), num(kid(r, MAP.depositAmount)), num(kid(r, MAP.depositSalary)));
  }
  // the last deposit, when its month is not among the rows (the block's rows are by type, no payer)
  for (const b of desc(acc, MAP.lastDeposit)) {
    const raw = txt(kid(b, MAP.lastDepositDate)), d = isoDate(raw);
    if (!d || by.has(d.slice(0, 7))) continue;
    const paid = (raw ?? '').replace(/\D/g, '').length >= 8 ? d : null;  // the schema says YYYYMM; a full date is kept when a file gives one
    const rows = desc(b, MAP.lastDepositRow);
    if (rows.length) for (const r of rows) add(d.slice(0, 7), paid, int(kid(r, MAP.depositType)), num(kid(r, MAP.depositAmount)), null);
    else { const t = num(kid(b, MAP.lastDepositTotal)); if (t != null) add(d.slice(0, 7), null, null, t, null); }
  }
  if (transfers) warn.push(`${transfers === 1 ? 'שורה אחת' : `${transfers} שורות`} של העברה מקופה אחרת לא נספרו כהפקדה`);
  const out = [...by.values()].sort((a, b) => a.ym.localeCompare(b.ym));
  for (const r of out) { for (const k of ['employee', 'employer', 'severance', 'total'] as const) if (r[k] != null) r[k] = +(r[k] as number).toFixed(2); }
  return out;
}

/** W7 · the guaranteed coefficient an insurance policy states (MEKADEM-MOVTACH-LEPRISHA per retirement age): the one for age 67
 *  when given, else the highest age that has one. Null when the file has none (then the agent types it, src 'agent'). */
export function readCoef(acc: XNode): GuaranteedCoef | null {
  const got = desc(acc, MAP.coefBlock).map((b) => ({ v: num(kid(b, MAP.coef)), at: int(kid(b, MAP.coefAge)) })).filter((x): x is { v: number; at: number | null } => x.v != null && x.v > 0);
  if (!got.length) return null;
  const pick = got.find((x) => x.at === 67) ?? got.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
  return { v: pick.v, at: pick.at, src: 'file' };
}

function readAccount(acc: XNode, prod: XNode, prov: XNode): MAccount {
  const warn: string[] = [];
  const nm = kid(prod, MAP.productData);
  const type = int(first(nm, MAP.productType));
  const pid = txt(first(nm, MAP.providerId)) ?? txt(kid(prov, MAP.providerId));
  const kind = int(kid(acc, MAP.pensionKind)), oldNew = int(kid(acc, MAP.oldNew));
  const asof = isoDate(txt(kid(acc, MAP.asOf)));

  /* balance: the rows of Yitrot (by balance kind and deposit type) add up to the account */
  const yit = desc(acc, MAP.balances);
  const balRows = yit.flatMap((y) => kids(y, MAP.balanceRow));
  const bals = balRows.map((r) => num(kid(r, MAP.balance))).filter((x): x is number => x != null);
  let balance: number | null = bals.length ? bals.reduce((s, x) => s + x, 0) : null;
  const balDate = isoDate(txt(first(yit[0], MAP.balanceDate)));

  /* tracks */
  const tracks: MTrack[] = [];
  for (const t of desc(acc, MAP.track)) {
    const code = txt(kid(t, MAP.trackCode)), name = txt(kid(t, MAP.trackName)), r = int(kid(t, MAP.trackRole));
    const row: MTrack = { code, name, role: r === 1 ? 'acc' : r === 2 ? 'dep' : null, amount: num(kid(t, MAP.trackAmount)), fee: okFee(num(kid(t, MAP.trackAccFee)), FEE_MAX), depfee: okFee(num(kid(t, MAP.trackDepFee)), DEP_MAX) };
    // the same track listed for the balance and for the deposits is one track
    const same = tracks.find((x) => (x.code && x.code === row.code) || (!x.code && !row.code && x.name === row.name));
    if (same) { same.amount = same.amount ?? row.amount; same.fee = same.fee ?? row.fee; same.depfee = same.depfee ?? row.depfee; if (row.role === 'dep') same.role = same.role ?? 'dep'; continue; }
    tracks.push(row);
  }
  if (balance == null) { const am = tracks.map((t) => t.amount).filter((x): x is number => x != null); if (am.length) balance = am.reduce((s, x) => s + x, 0); }

  /* the last deposit: the per-type rows (before the insurance cost), else the total, else this year's rows of the latest month */
  let monthly: number | null = null, lastDep: string | null = null;
  const lastBlocks = desc(acc, MAP.lastDeposit);
  for (const b of lastBlocks) {
    const d = isoDate(txt(kid(b, MAP.lastDepositDate)));
    const rows = desc(b, MAP.lastDepositRow).map((r) => num(kid(r, MAP.depositAmount))).filter((x): x is number => x != null);
    const v = rows.length ? rows.reduce((s, x) => s + x, 0) : num(kid(b, MAP.lastDepositTotal));
    if (v == null) continue;
    if (!lastDep || (d && d > lastDep)) { lastDep = d; monthly = v; } else if (d === lastDep) monthly = (monthly ?? 0) + v;
  }
  if (monthly == null) {
    const rows = desc(acc, MAP.depositRows).map((r) => ({ d: isoDate(txt(kid(r, MAP.depositRowDate))), v: num(kid(r, MAP.depositAmount)) })).filter((r): r is { d: string; v: number } => !!r.d && r.v != null);
    if (rows.length) { const m = rows.map((r) => r.d.slice(0, 7)).sort().pop()!; monthly = rows.filter((r) => r.d.startsWith(m)).reduce((s, r) => s + r.v, 0); lastDep = `${m}-01`; }
  }
  if (monthly != null && lastDep && asof && months(asof, lastDep) > 6) { warn.push(`ההפקדה האחרונה ב-${lastDep.slice(5, 7)}/${lastDep.slice(2, 4)}: לא נספרת כהפקדה חודשית`); monthly = null; }
  if (monthly != null && monthly < 0) monthly = null;

  /* fees: the terms (annual, SUG-HOTZAA 1 / 2) first, then the track's own rate, then this month's actual (monthly × 12) */
  let fee: number | null = null, feeHow: FeeHow | null = null, depfee: number | null = null, depHow: FeeHow | null = null;
  for (const r of desc(acc, MAP.feeTerms)) {
    const basis = int(kid(r, MAP.feeBasis)), rate = num(kid(r, MAP.feeRate));
    if (basis === 1 && fee == null) { fee = okFee(rate, FEE_MAX); if (fee != null) feeHow = 'terms'; else if (rate != null) warn.push(`דמי ניהול מצבירה לא סבירים בקובץ (${rate}); לא נקראו`); }
    if (basis === 2 && depfee == null) { depfee = okFee(rate, DEP_MAX); if (depfee != null) depHow = 'terms'; else if (rate != null) warn.push(`דמי ניהול מהפקדה לא סבירים בקובץ (${rate}); לא נקראו`); }
  }
  const one = tracks.length === 1 ? tracks[0] : null;
  if (fee == null && one?.fee != null) { fee = one.fee; feeHow = 'track'; }
  if (depfee == null && one?.depfee != null) { depfee = one.depfee; depHow = 'track'; }
  const act = first(acc, MAP.actualFees);
  if (fee == null) { const m = num(kid(act, MAP.actualAccFeeMonthly)); const a = m == null ? null : okFee(+(m * 12).toFixed(4), FEE_MAX); if (a != null) { fee = a; feeHow = 'month12'; } }
  if (depfee == null) { const d = okFee(num(kid(act, MAP.actualDepFee)), DEP_MAX); if (d != null) { depfee = d; depHow = 'actual'; } }

  /* W7: deposits by salary month, the policy salary (SACHAR-POLISA, else the latest deposit row's salary), the guaranteed coefficient */
  const deposits = readDeposits(acc, warn);
  const salaryTag = num(kid(first(kid(acc, 'PirteiTaktziv') ?? acc, MAP.salaryBlock), MAP.salary));
  const salary = salaryTag != null && salaryTag > 0 ? salaryTag : [...deposits].reverse().find((d) => d.salary != null)?.salary ?? null;
  const unified = txt(kid(acc, MAP.unified));

  return {
    providerId: pid, providerName: txt(kid(prov, MAP.providerName)),
    type, typeHe: type != null ? PRODUCT_TYPES[type] ?? `סוג מוצר ${type}` : 'סוג מוצר לא ידוע',
    pensionKind: kind, old: oldNew === 1,
    plan: txt(kid(acc, MAP.plan)), status: int(kid(acc, MAP.status)), asof, balDate, unified,
    balance: balance == null ? null : Math.round(balance), monthly: monthly == null ? null : Math.round(monthly), lastDep,
    fee, feeHow, depfee, depHow, ytd: num(first(acc, MAP.ytd)), tracks,
    covers: readCovers(acc), insTrack: txt(kid(kid(acc, MAP.insTrack), MAP.insTrackName)), insCost: num(kid(act, MAP.insCostMonth)), warn,
    code: unified, deposits, salary, coefGuaranteed: readCoef(acc),
  };
}

/** A clearing-house file (its tree) → the accounts in it. Throws, in Hebrew, when it is not a holdings-interface file. */
export function parseMaslaka(root: XNode): MFile {
  // W5 (red team 3): plain words, not the XML root's name
  if (root.n !== MAP.root) throw new Error('זה לא נראה כמו קובץ מהמסלקה הפנסיונית. בוחרים את קובצי ה-XML שבחבילה שהגיעה מהמסלקה: קובץ אחד לכל חברה.');
  const head = kid(root, MAP.header);
  const out: MFile = { version: txt(kid(head, MAP.version)), runDate: isoDate(txt(kid(head, MAP.runDate))), providerName: null, accounts: [], warn: [] };
  const provs = desc(root, MAP.provider);
  for (const prov of provs) {
    out.providerName = out.providerName ?? txt(kid(prov, MAP.providerName));
    for (const prod of desc(prov, MAP.product)) for (const acc of desc(prod, MAP.account)) out.accounts.push(readAccount(acc, prod, prov));
  }
  if (!provs.length) out.warn.push('לא נמצא גוף מנהל בקובץ');
  const ver = out.version ? parseInt(out.version.replace(/\D/g, ''), 10) : NaN;
  if (Number.isFinite(ver) && ver !== 8 && ver !== 9) out.warn.push(`גרסת הממשק בקובץ ${out.version}; הקורא נבנה לגרסאות 008–009`);
  return out;
}

/* ---------- matching to fox's tracks ---------- */

/** the fields of a funds.json row the matcher reads */
export interface MFund { k: string; id: number; pid?: number | string | null; mgr_id?: number | string | null; fam?: string; prod: string; track: string; name: string; grp?: string; closed?: boolean; tx?: { fund?: number | string | null } | null }

const FAM: Record<number, { fam: string; prods?: string[] }> = {
  1: { fam: 'insurance' }, 5: { fam: 'insurance' },
  3: { fam: 'gemel', prods: ['גמל', 'מרכזית לפיצויים', 'גמל, מטרה אחרת'] }, 4: { fam: 'gemel', prods: ['השתלמות'] },
  9: { fam: 'gemel', prods: ['גמל להשקעה'] }, 10: { fam: 'gemel', prods: ['חיסכון לילד'] },
  2: { fam: 'pensia' },
};
const RISK = new Set([6, 7, 8]);

const STOP = new Set(['מסלול', 'קרן', 'קופת', 'קופה', 'פנסיה', 'גמל', 'השתלמות', 'לבני', 'בני', 'בע"מ', 'בעמ', 'מ', 'ה', 'ו', 'ל', 'של', 'the', 'fund']);
/** words of a track name, for comparing the file's name to the data's */
export function words(s: string): string[] {
  return s.toLowerCase().replace(/s&p\s*/g, 'sp').replace(/["'׳״`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ')
    .map((w) => w.replace(/^[והלב](?=\p{L}{3,})/u, '')).filter((w) => w && !STOP.has(w));
}
/** Dice similarity of two word lists (0–1) */
export function sim(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const B = [...b]; let hit = 0;
  for (const w of a) { const i = B.indexOf(w); if (i >= 0) { hit++; B.splice(i, 1); } }
  return (2 * hit) / (a.length + b.length);
}

/** how a row was matched: 'code' the full unified code (company, product and track all agree with the data); 'id' the product
 *  number is the track's own number; 'track' the product is the parent fund and it has one track (or the 4-digit track picked it);
 *  'name' the track's name decided among the fund's tracks; 'manual' the reader chose */
export type MatchBy = 'id' | 'code' | 'track' | 'name' | 'manual';
export const MATCH_BY: Record<MatchBy, string> = {
  code: 'לפי הקוד האחיד (חברה, קופה ומסלול)', id: 'לפי מספר הקופה', track: 'לפי מספר הקופה והמסלול', name: 'לפי שם המסלול, לבדיקה', manual: 'בחירה ידנית',
};
export interface Row {
  key: string; acc: number; providerName: string | null; typeHe: string; plan: string | null; trackName: string | null; code: string | null;
  k: string | null; by: MatchBy | null; why: string; cands: string[];
  balance: number | null; monthly: number | null; fee: number | null; feeHow: FeeHow | null; depfee: number | null; depHow: FeeHow | null;
  asof: string | null; skip: string | null; warn: string[];
  /** the account's insurance cover, on its first row only (W4) */
  covers?: MCover[];
  /** W7: the account's deposit rows and salary, on the row that carries the monthly deposit; the insurance track and the guaranteed
   *  coefficient with the covers (first row) */
  deposits?: DepositRow[]; salary?: number | null; insTrack?: string | null; coefGuaranteed?: GuaranteedCoef | null;
}

function pickByName<T extends MFund>(name: string | null, pool: T[], min: number, margin: number): { f: T | null; ranked: T[] } {
  // the words most of the candidates share (the company, the fund's legal name) say nothing about which track: dropped on both sides
  const ws = pool.map((f) => words(f.name));
  const df = new Map<string, number>();
  ws.forEach((x) => new Set(x).forEach((w) => df.set(w, (df.get(w) ?? 0) + 1)));
  const common = new Set(pool.length >= 3 ? [...df].filter(([, n]) => n >= 0.6 * pool.length).map(([w]) => w) : []);
  const strip = (x: string[]) => x.filter((w) => !common.has(w));
  const w = strip(words(name ?? ''));
  const sc = pool.map((f, i) => ({ f, s: Math.max(sim(w, strip(ws[i])), sim(w, words(f.track))) })).sort((a, b) => b.s - a.s || (a.f.closed ? 1 : 0) - (b.f.closed ? 1 : 0));
  const ok = sc.length > 0 && sc[0].s >= min && (sc.length === 1 || sc[0].s - sc[1].s >= margin);
  return { f: ok ? sc[0].f : null, ranked: sc.map((x) => x.f) };
}

/** One track of one account → a fox track, or why not. */
export function matchTrack(a: MAccount, t: MTrack | null, funds: MFund[]): Pick<Row, 'k' | 'by' | 'why' | 'cands'> {
  const none = (why: string, cands: MFund[] = []) => ({ k: null, by: null, why, cands: cands.slice(0, 30).map((f) => f.k) });
  const spec = a.type != null ? FAM[a.type] : undefined;
  if (!spec) return none(a.type == null ? 'סוג המוצר חסר בקובץ' : `${a.typeHe}: אין לסוג המוצר הזה מסלולים בנתוני הרשות שבאתר`);
  let pool = funds.filter((f) => f.fam === spec.fam && (!spec.prods || spec.prods.includes(f.prod)));
  if (a.type === 2 && a.pensionKind === 2) pool = pool.filter((f) => f.prod === 'פנסיה מקיפה');
  if (a.type === 2 && a.pensionKind === 3) pool = pool.filter((f) => f.prod === 'פנסיה כללית');
  const c = code30(t?.code ?? a.unified);
  const company = c?.company || (a.providerId ? +a.providerId.replace(/\D/g, '') : 0);
  const byMgr = company ? pool.filter((f) => f.mgr_id != null && +f.mgr_id === company) : [];
  if (company && !byMgr.length) return none(`החברה בקובץ (מספר ${company}) לא נמצאה בנתוני ${a.typeHe} שבאתר`);
  const scope = byMgr.length ? byMgr : pool;
  const tname = t?.name ?? a.plan;
  if (c) {
    // W7: the whole unified code first: company (ח"פ = mgr_id), product (= parent fund) and the 4-digit track (= the track's number)
    if (c.track && byMgr.length) {
      const full = byMgr.filter((f) => f.id === c.track && ((f.pid != null && +f.pid === c.product) || (f.tx?.fund != null && +f.tx.fund === c.product)));
      if (full.length === 1) return { k: full[0].k, by: 'code', why: `הקוד האחיד: חברה ${company}, קופה ${c.product}, מסלול ${c.track}`, cands: [] };
    }
    const exact = scope.filter((f) => f.id === c.product);
    if (exact.length === 1) return { k: exact[0].k, by: 'id', why: `מספר הקופה ${c.product}`, cands: [] };
    if (exact.length > 1) { const p = pickByName(tname, exact, 0, 0.01); if (p.f) return { k: p.f.k, by: 'id', why: `מספר הקופה ${c.product} ושם המסלול`, cands: [] }; }
    const group = scope.filter((f) => (f.pid != null && +f.pid === c.product) || (f.tx?.fund != null && +f.tx.fund === c.product));
    if (group.length) {
      const byT = c.track ? group.filter((f) => f.id === c.track) : [];
      if (byT.length === 1) return { k: byT[0].k, by: 'track', why: `קופה ${c.product}, מסלול ${c.track}`, cands: [] };
      if (group.length === 1) return { k: group[0].k, by: 'track', why: `קופה ${c.product} (מסלול יחיד)`, cands: [] };
      const p = pickByName(tname, group, 0.5, 0.15);
      if (p.f) return { k: p.f.k, by: 'name', why: `קופה ${c.product}; המסלול לפי השם "${tname}"`, cands: p.ranked.slice(0, 30).map((f) => f.k) };
      return none(`בקופה ${c.product} יש ${group.length} מסלולים, ושם המסלול בקובץ${tname ? ` ("${tname}")` : ''} לא מכריע ביניהם`, p.ranked);
    }
  }
  if (!byMgr.length) return none(c ? `מספר הקופה ${c.product} לא נמצא בנתונים` : 'אין בקובץ קוד מסלול, ואין דרך לזהות את החברה');
  const p = pickByName(tname, byMgr, 0.6, 0.2);
  if (p.f) return { k: p.f.k, by: 'name', why: `לפי שם המסלול "${tname}" בחברה הזו (מספר הקופה ${c?.product ?? '–'} לא נמצא בנתונים)`, cands: p.ranked.slice(0, 30).map((f) => f.k) };
  return none(c ? `מספר הקופה ${c.product} לא נמצא בנתוני הרשות שבאתר (מסלול שנסגר, ותיק או שאינו מדווח), והשם לא מכריע` : 'אין בקובץ קוד מסלול, והשם לא מכריע', p.ranked);
}

/** The review rows of a file: one per track of every account (the balance split as the file splits it). */
export function rowsOf(file: MFile, funds: MFund[], fileTag = 'f'): Row[] {
  const out: Row[] = [];
  file.accounts.forEach((a, ai) => {
    const base = { acc: ai, providerName: a.providerName ?? file.providerName, typeHe: a.typeHe, plan: a.plan, fee: a.fee, feeHow: a.feeHow, depfee: a.depfee, depHow: a.depHow, asof: a.asof ?? a.balDate, warn: [...a.warn] };
    const skip = a.type != null && RISK.has(a.type) ? 'ביטוח בלי רכיב חיסכון: אין יתרה או מסלול להשוות' : a.old ? 'קרן פנסיה ותיקה: אין לה מסלולים בנתוני הרשות שבאתר' : a.status === 3 ? 'החשבון מבוטל' : null;
    const extra = { insTrack: a.insTrack, coefGuaranteed: a.coefGuaranteed ?? null };
    if (skip) { out.push({ ...base, key: `${fileTag}:${ai}:x`, trackName: null, code: a.unified, k: null, by: null, why: skip, cands: [], balance: a.balance, monthly: a.monthly, skip, covers: a.covers ?? [], deposits: a.deposits ?? [], salary: a.salary ?? null, ...extra }); return; }
    const ts = a.tracks.length ? a.tracks : [null];
    const amounts = ts.map((t) => t?.amount ?? null);
    const split = ts.length > 1 && amounts.every((x) => x != null) && (amounts as number[]).some((x) => x > 0);
    // the deposit goes to the track that takes deposits; else the only track; else the largest
    const depRole = ts.findIndex((t) => t?.role === 'dep');
    const depIdx = ts.length === 1 ? 0 : depRole >= 0 ? depRole : split ? amounts.indexOf(Math.max(...(amounts as number[]))) : 0;
    ts.forEach((t, ti) => {
      const m = matchTrack(a, t, funds);
      const row: Row = { ...base, warn: [...base.warn], key: `${fileTag}:${ai}:${ti}`, trackName: t?.name ?? null, code: t?.code ?? a.unified, ...m,
        balance: ts.length === 1 ? a.balance : split ? Math.round(amounts[ti] as number) : null,
        monthly: ti === depIdx ? a.monthly : null,
        // the account's terms win; else this track's own rate; else what the account was charged
        ...(a.feeHow === 'terms' || t?.fee == null ? { fee: a.fee, feeHow: a.feeHow } : { fee: t.fee, feeHow: 'track' as const }),
        ...(a.depHow === 'terms' || t?.depfee == null ? { depfee: a.depfee, depHow: a.depHow } : { depfee: t.depfee, depHow: 'track' as const }),
        skip: null, covers: ti === 0 ? a.covers ?? [] : [], ...(ti === 0 ? extra : {}),
        // W7: the deposit rows and the salary travel with the monthly deposit
        deposits: ti === depIdx ? a.deposits ?? [] : [], salary: ti === depIdx ? a.salary ?? null : null };
      if (ts.length > 1 && !split) row.warn.push('הקובץ לא מפרט כמה מהיתרה בכל מסלול');
      if (split && Math.round(amounts[ti] as number) === 0) { row.skip = 'אין כסף במסלול הזה (רק הפקדות עתידיות)'; }
      out.push(row);
    });
  });
  return out;
}

/** the reader's saved product, as /my keeps it (lib/mine). W7 adds, optionally: the unified code, the deposit rows and the salary
 *  from the file (lib/mine keeps them when it knows them; older lists simply have none). */
export interface Saved extends Pick<HeldExtra, 'code' | 'deposits' | 'salary' | 'insTrack'> { k: string; balance?: number | null; monthly?: number | null; fee?: number | null; depfee?: number | null; added: string; imp?: string; covers?: MCover[] }
type SavedExtra = Pick<Saved, 'code' | 'deposits' | 'salary' | 'insTrack' | 'covers'>;

/** Chosen rows → the saved list: one product per track (two accounts in one track add up), an existing product updated in place. */
export function applyRows(list: Saved[], rows: Row[], today: string): { list: Saved[]; added: number; updated: number } {
  const by = new Map<string, Saved>();
  // W7: the saver's product keeps what the deposit watchdog and the coverage line need (lib/mine MyProduct has these as optional fields)
  const extraOf = (r: SavedExtra): SavedExtra => ({
    ...(r.code ? { code: r.code } : {}), ...(r.deposits?.length ? { deposits: r.deposits } : {}), ...(r.salary != null ? { salary: r.salary } : {}),
    ...(r.insTrack ? { insTrack: r.insTrack } : {}), ...(r.covers?.length ? { covers: r.covers } : {}),
  });
  for (const r of rows) {
    if (!r.k || r.skip) continue;
    const p = by.get(r.k);
    if (!p) { by.set(r.k, { k: r.k, balance: r.balance, monthly: r.monthly, fee: r.fee, depfee: r.depfee, added: today, imp: r.asof ?? today, ...extraOf(r) }); continue; }
    p.balance = r.balance == null ? p.balance : (p.balance ?? 0) + r.balance;
    p.monthly = r.monthly == null ? p.monthly : (p.monthly ?? 0) + r.monthly;
    p.fee = p.fee ?? r.fee; p.depfee = p.depfee ?? r.depfee;
    if (r.deposits?.length) p.deposits = [...(p.deposits ?? []), ...r.deposits].sort((a, b) => a.ym.localeCompare(b.ym));
    if (r.covers?.length) p.covers = [...(p.covers ?? []), ...r.covers];
    if (p.salary == null && r.salary != null) p.salary = r.salary;
    if (!p.code && r.code) p.code = r.code;
    if (!p.insTrack && r.insTrack) p.insTrack = r.insTrack;
  }
  let added = 0, updated = 0;
  const out = list.map((m) => {
    const n = by.get(m.k);
    if (!n) return m;
    by.delete(m.k); updated++;
    return { ...m, balance: n.balance ?? m.balance, monthly: n.monthly ?? m.monthly, fee: n.fee ?? m.fee, depfee: n.depfee ?? m.depfee, imp: n.imp, ...extraOf(n) };
  });
  for (const n of by.values()) { out.push(n); added++; }
  return { list: out, added, updated };
}

/** how a fee was read, in words */
export const FEE_HOW: Record<FeeHow, string> = {
  terms: 'מתנאי החשבון בקובץ (שנתי)', track: 'משיעור המסלול בקובץ', month12: 'אומדן: החודש האחרון בקובץ × 12', actual: 'כפי שנגבה בחודש האחרון בקובץ',
};

/* ---------- W4 · the agent's import: a client folder ---------- */

/** the held products of a client folder (lib/clients `Held`), from the review rows: every row, matched or not, with the balance,
 *  the fees and the cover the file gives; a row the saver flow skips (risk insurance, an old fund) is kept with its reason, since its
 *  cover belongs in the הנמקה. `manual` maps a row key to a track the agent picked. No name, ID or account number is in a row. */
export function heldOf(rows: Row[], manual: Record<string, string> = {}): ({ k: string | null; typeHe: string; provider: string | null; plan: string | null; track: string | null;
  balance: number | null; monthly: number | null; fee: number | null; feeHow: string | null; depfee: number | null; depHow: string | null; asof: string | null; covers: MCover[]; note: string | null } & HeldExtra)[] {
  return rows.map((r) => ({
    k: manual[r.key] || r.k, typeHe: r.typeHe, provider: r.providerName, plan: r.plan, track: r.trackName,
    balance: r.balance, monthly: r.monthly, fee: r.fee, feeHow: r.feeHow ? FEE_HOW[r.feeHow] : null, depfee: r.depfee, depHow: r.depHow ? FEE_HOW[r.depHow] : null,
    asof: r.asof, covers: r.covers ?? [], note: r.skip ?? (r.k || manual[r.key] ? null : `לא הותאם למסלול: ${r.why}`),
    // W7: the client engine's fields (deposits for the ניוד table and the deposit watchdog; salary; the insurance track; a guaranteed coefficient)
    code: r.code, deposits: r.deposits ?? [], salary: r.salary ?? null, insTrack: r.insTrack ?? null, coefGuaranteed: r.coefGuaranteed ?? null,
  }));
}
