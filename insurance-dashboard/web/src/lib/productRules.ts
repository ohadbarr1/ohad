/* W1 · agent door: liquidity and tax, one line each, per product family. A static, sourced table (researched 01.11.26, fact-checked
   02.11.26 against the Income Tax Ordinance text on gov.il, the Tax Authority's 2026 tables and the Finance Ministry reports): every
   line is backed by the pages in `src`, primary sources first; amounts carry their tax year. General, not tax advice: each product has
   exceptions and ceilings that change every year. Pure (no React), so the unit test reads it in node.
   Not shipped: anything the research could not confirm (e.g. the insurer's withholding on a savings policy, age-60 timing of an
   old provident fund). */

export type RuleKey = 'hishtalmut' | 'gemelInvest' | 'gemel' | 'pension' | 'managers' | 'policy';
export interface RuleSrc { title: string; url: string; kind: 'primary' | 'reference' | 'press' }
export interface ProductRule {
  key: RuleKey;
  /** the product's name as the table shows it */
  name: string;
  /** when the money can be drawn, one line */
  liq: string;
  /** how deposits, gains and withdrawals are taxed, one line */
  tax: string;
  src: RuleSrc[];
  /** the tax year of the amounts in the lines */
  year: number;
  /** 'verified': the main statement has a primary source; 'partly': amounts or a detail rest on a reference source (Kol Zchut) */
  conf: 'verified' | 'partly';
  /** what to watch: a pending change, an exception that matters */
  watch?: string;
  /** fact-check note: what rests on a reference source only, or how a line was narrowed */
  note?: string;
}

export const RULES_ASOF = '2026-11-01';
export const RULES_NOTE = 'כללי, לא ייעוץ מס. כלל עיקרי בלבד: לכל מוצר חריגים ותקרות המתעדכנות מדי שנה; יש לבדוק מול הגוף המנהל ורשות המסים';

const KZ = (page: string, title: string): RuleSrc => ({ title: `כל זכות: ${title}`, url: `https://www.kolzchut.org.il/he/${encodeURIComponent(page)}`, kind: 'reference' });
const MOF_2025: RuleSrc = { title: 'משרד האוצר, הצוות לצמצום הפערים במכשירי השקעה בחיסכון לטווח קצר ובינוני: דו"ח ביניים (02.2025), עמ\' 11–15', url: 'https://www.gov.il/BlobFolder/news/press_13022025/he/press_13022025_file.pdf', kind: 'primary' };
const MOF_2026: RuleSrc = { title: 'משרד האוצר, הצוות לצמצום הפערים: דו"ח מסכם (07.2026), סעיפים 4–6, המלצות שטרם נחקקו', url: 'https://www.gov.il/BlobFolder/news/press020726/he/%D7%93%D7%95%D7%97%20%D7%9E%D7%A1%D7%9B%D7%9D%20%D7%95%D7%A2%D7%93%D7%AA%20%D7%94%D7%90%D7%A8%D7%91%D7%99%D7%98%D7%A8%D7%90%D7%96%20-%D7%99%D7%95%D7%9C%D7%99%202026%20%D7%97%D7%AA%D7%95%D7%9D.pdf', kind: 'primary' };
/** the Tax Authority's 2026 withholding booklet: ch. ג (amounts for tax year 2026: 9,430 / 5,422 / 188,544 / 20,566 / 13,750 / 34,423),
 *  the 9א(ז) schedule under amendment 275 (57% 2025, 57.5% 2026, 62.5% 2027, 67% 2028), ch. ז (47% on hishtalmut, 35% on improper payments) */
const TAX_2026: RuleSrc = { title: 'רשות המסים: לוח עזר לחישוב מס הכנסה ממשכורת לינואר 2026 ואילך, סכומים מתואמים לשנת המס 2026 ותיקון 275 (סעיף 9א(ז))', url: 'https://www.gov.il/BlobFolder/generalpage/income-tax-monthly-deductions-booklet/he/generalInformation_income-tax-monthly-deductions-booklet_monthly-deductions-booklet-2026.pdf', kind: 'primary' };
const TAX_161D: RuleSrc = { title: 'רשות המסים: מדריך לגמלאי למילוי טופס 161ד (2026), קצבה מזכה, סל הפטור והקטנתו במענקים פטורים', url: 'https://www.gov.il/BlobFolder/guide/2026-filling-out-form-161d/he/Guides_IncomeTax_filling-out-form-161d-2026.pdf', kind: 'primary' };
const PKUDA: RuleSrc = { title: 'פקודת מס הכנסה [נוסח חדש]: סעיפים 3(ה), 3(ה3), 3(ה5), 9(16א), 9א, 45א, 125ג–125ה', url: 'https://www.gov.il/BlobFolder/legalinfo/law_pkudat_mas_hachnasa/he/LegalInformation_kesher_%D7%A4%D7%A7%D7%95%D7%93%D7%AA%20%D7%9E%D7%A1%20%D7%94%D7%9B%D7%A0%D7%A1%D7%94%20%5B%D7%A0%D7%95%D7%A1%D7%97%20%D7%97%D7%93%D7%A9%5D%20-%20%D7%9C%D7%90%20%D7%9E%D7%A8%D7%95%D7%91%D7%93.pdf', kind: 'primary' };
const KZ_CREDIT = KZ('זיכוי_ממס_הכנסה_בגין_הפרשות_לביטוח_פנסיוני', 'זיכוי ממס הכנסה בגין הפרשות לביטוח פנסיוני');
const KZ_EMPLOYER = KZ('פטור_ממס_הכנסה_על_הפרשות_המעסיק_לביטוח_פנסיוני_ולביטוח_אובדן_כושר_עבודה', 'פטור ממס על הפרשות המעסיק לביטוח פנסיוני');
const KZ_SEVERANCE = KZ('משיכת_כספי_פיצויי_פיטורים_מקופת_גמל_או_מהביטוח_הפנסיוני', 'משיכת כספי פיצויים מקופת גמל או מהביטוח הפנסיוני');
const PENDING = 'הצוות של משרד האוצר (07.2026) המליץ להגביל את הטבות המס (דחיית המס, מעבר בלי אירוע מס והפטור בקצבה מגיל 60) להפקדות של עד 200 אלף ש"ח לחוסך, במצטבר ובלי תקרה שנתית; מעל התקרה ההטבות יבוטלו. המלצה, לא חוק';
const ANNUITY = 'בקצבה: פטור עד 5,422 ש"ח לחודש, 57.5% מתקרת הקצבה המזכה של 9,430 ש"ח (2026; עולה ל-62.5% ב-2027 ול-67% מ-2028)';

export const RULES: ProductRule[] = [
  { key: 'hishtalmut', name: 'קרן השתלמות', year: 2026, conf: 'partly',
    liq: 'משיכה בלי מס אחרי 6 שנים מההפקדה הראשונה; אחרי 3 שנים למטרת השתלמות או למי שהגיע לגיל פרישה. משיכה מוקדמת: הפקדות המעסיק והרווחים חייבים במס שולי (ניכוי במקור 47%)',
    tax: 'הרווחים פטורים ממס על ההפקדה המוטבת (שכיר: הפקדת מעסיק עד 7.5% משכר של עד 188,544 ש"ח בשנה, והפקדת העובד עד 2.5% או שליש מהפקדת המעסיק; עצמאי: עד 20,566 ש"ח בשנה; 2026); על הפקדות מעל התקרה: מס רווחי הון',
    src: [PKUDA, TAX_2026, KZ('קרן_השתלמות', 'קרן השתלמות'), KZ('קרן_השתלמות_לעובד_עצמאי', 'קרן השתלמות לעובד עצמאי')],
    note: 'מועדי המשיכה, ההפקדה המוטבת והתקרות: סעיפים 3(ה) ו-9(16א) ולוח רשות המסים 2026. מיסוי הרווח על הפקדות מעל התקרה: לפי כל זכות' },
  { key: 'gemelInvest', name: 'קופת גמל להשקעה', year: 2026, conf: 'partly', watch: PENDING,
    liq: 'נזילה בכל עת, במלואה או בחלקה; מעבר בין מסלולים ובין קופות גמל להשקעה אינו אירוע מס',
    tax: 'אין הטבת מס בהפקדה; תקרת הפקדה 83,641 ש"ח לשנה (2026). משיכה הונית: הרווח חייב במס כהכנסה מריבית (עד 25% על הרווח הריאלי); משיכה כקצבה מגיל 60: הרווח פטור ממס',
    src: [MOF_2025, PKUDA, KZ('קופת_גמל_להשקעה', 'קופת גמל להשקעה'), KZ('פטור_ממס_על_רווחים_בקופת_גמל_להשקעה_המשולמת_כקצבה_לאחר_גיל_60', 'פטור ממס על רווחים בקופת גמל להשקעה המשולמת כקצבה לאחר גיל 60'), MOF_2026],
    note: 'תקרת 83,641 ש"ח ל-2026: לפי כל זכות והגופים המנהלים; לא נמצא פרסום רשמי של רשות שוק ההון (דו"ח האוצר מציין כ-81,700 ש"ח ל-2025, והתקרה צמודה למדד)' },
  { key: 'gemel', name: 'קופת גמל לתגמולים ולפיצויים', year: 2026, conf: 'partly',
    liq: 'כספי תגמולים שהופקדו מ-2008: קצבה בלבד בפרישה (צבירה מעל קצבת המינימום ניתנת להיוון); רכיב הפיצויים ניתן למשיכה בעזיבת עבודה; משיכה מוקדמת של תגמולים: מס של 35% לפחות',
    tax: 'שכיר: זיכוי 35% על הפקדות העובד עד התקרה (סעיף 45א); הפקדות המעסיק פטורות עד 7.5% מהשכר ועד התקרה (סעיף 3(ה3)). ' + ANNUITY,
    src: [MOF_2025, TAX_2026, PKUDA, KZ('קופת_גמל', 'קופת גמל'), KZ_CREDIT],
    note: 'משיכה שלא כדין לפי לוח הניכויים של רשות המסים: 35% מקופה לתגמולים, ומקופה לקצבה הגבוה מבין 35% למס השולי. היוון הצבירה העודפת: לפי כל זכות' },
  { key: 'pension', name: 'קרן פנסיה', year: 2026, conf: 'partly',
    liq: 'תגמולים: קצבה חודשית בלבד, בפרישה. פיצויים: ניתנים למשיכה בעזיבת עבודה, פטורים עד 13,750 ש"ח לכל שנת עבודה (2026); המשיכה מקטינה את הקצבה ואת הפטור בפרישה',
    tax: 'זיכוי 35% על הפקדות העובד עד התקרה (סעיף 45א); הפקדות המעסיק פטורות עד 7.5% מהשכר ועד התקרה (סעיף 3(ה3)). ' + ANNUITY,
    src: [TAX_2026, TAX_161D, PKUDA, KZ_SEVERANCE, KZ_CREDIT, KZ_EMPLOYER],
    note: 'תוקן: הפטור הוא 57.5% מתקרת הקצבה המזכה, לא 57.5% מהקצבה. "מגיל פרישה" הוסר: גיל תחילת הקצבה לא אומת מול מקור ראשי' },
  { key: 'managers', name: 'ביטוח מנהלים', year: 2026, conf: 'partly',
    liq: 'כספים שהופקדו מ-2008: קצבה בלבד; כספים מלפני 2008, בפוליסות שאפשרו זאת, ניתנים למשיכה הונית. פיצויים: ניתנים למשיכה בעזיבת עבודה',
    tax: 'הטבות כמו בקופת גמל לקצבה: זיכוי 35% על הפקדות העובד ופטור להפקדות המעסיק, עד התקרה. ' + ANNUITY,
    src: [MOF_2025, TAX_2026, PKUDA, KZ('ביטוח_מנהלים', 'ביטוח מנהלים'), KZ_CREDIT] },
  { key: 'policy', name: 'פוליסת חיסכון', year: 2026, conf: 'verified', watch: PENDING,
    liq: 'נזילה בכל עת, במלואה או בחלקה; מעבר בין מסלולים באותה חברה אינו אירוע מס, ומעבר לחברת ביטוח אחרת מחייב פדיון וחייב במס',
    tax: 'אין הטבת מס בהפקדה ואין תקרת הפקדה; בפדיון הרווח חייב במס כהכנסה מריבית (עד 25% על הרווח הריאלי, סעיפים 3(ה5) ו-125ג); הקלות לפי סעיפים 125ד ו-125ה לפי גיל והכנסה',
    src: [MOF_2025, PKUDA, { title: 'TheMarker סופרמרקר: מה זו פוליסת חיסכון (04.2026)', url: 'https://www.supermarker.themarker.com/MenahalimInsurance/WhatIsSavingsPolicy.aspx', kind: 'press' }, MOF_2026] },
];
export const RULE: Record<RuleKey, ProductRule> = Object.fromEntries(RULES.map((r) => [r.key, r])) as Record<RuleKey, ProductRule>;

/** The rule families behind a product of the data (funds.json `prod`). The bituach-net pool of policies and managers' insurance from
 *  2004 shares one track for both products, so it gets both rows. Products with no verified line (חיסכון לילד, מרכזית לפיצויים,
 *  גמל למטרה אחרת) get none: the table says so instead of guessing. */
export function rulesFor(prod: string): ProductRule[] {
  if (prod === 'השתלמות') return [RULE.hishtalmut];
  if (prod === 'גמל להשקעה') return [RULE.gemelInvest];
  if (prod === 'גמל') return [RULE.gemel];
  if (prod === 'פנסיה מקיפה' || prod === 'פנסיה כללית') return [RULE.pension];
  if (prod === 'פוליסות חיסכון וביטוחי מנהלים (מ-2004)') return [RULE.managers, RULE.policy];
  if (/^ביטוחי מנהלים/.test(prod)) return [RULE.managers];
  return [];
}
/** the distinct rule families of a set of products, in table order */
export function rulesOf(prods: string[]): ProductRule[] {
  const ks = new Set(prods.flatMap((p) => rulesFor(p).map((r) => r.key)));
  return RULES.filter((r) => ks.has(r.key));
}
