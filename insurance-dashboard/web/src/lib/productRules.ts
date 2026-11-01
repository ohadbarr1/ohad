/* W1 · agent door: liquidity and tax, one line each, per product family. A static, sourced table (researched 01.11.26): every line
   is backed by the pages in `src` (gov.il, the Tax Authority, Kol Zchut, the regulator); amounts carry their tax year. General, not
   tax advice: each product has exceptions and ceilings that change every year. Pure (no React), so the unit test reads it in node.
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
}

export const RULES_ASOF = '2026-11-01';
export const RULES_NOTE = 'כללי, לא ייעוץ מס. כלל עיקרי בלבד: לכל מוצר חריגים ותקרות המתעדכנות מדי שנה; יש לבדוק מול הגוף המנהל ורשות המסים';

const KZ = (page: string, title: string): RuleSrc => ({ title: `כל זכות: ${title}`, url: `https://www.kolzchut.org.il/he/${encodeURIComponent(page)}`, kind: 'reference' });
const MOF_2025: RuleSrc = { title: 'משרד האוצר, הצוות לצמצום הפערים במכשירי השקעה בחיסכון לטווח קצר ובינוני: דו"ח ביניים (02.2025), עמ\' 13–15', url: 'https://www.gov.il/BlobFolder/news/press_13022025/he/press_13022025_file.pdf', kind: 'primary' };
const MOF_2026: RuleSrc = { title: 'משרד האוצר, הצוות לצמצום הפערים: דו"ח מסכם (07.2026), המלצות שטרם נחקקו', url: 'https://www.gov.il/BlobFolder/news/press020726/he/%D7%93%D7%95%D7%97%20%D7%9E%D7%A1%D7%9B%D7%9D%20%D7%95%D7%A2%D7%93%D7%AA%20%D7%94%D7%90%D7%A8%D7%91%D7%99%D7%98%D7%A8%D7%90%D7%96%20-%D7%99%D7%95%D7%9C%D7%99%202026%20%D7%97%D7%AA%D7%95%D7%9D.pdf', kind: 'primary' };
const TAX_9A: RuleSrc = { title: 'רשות המסים: הנחיות לעניין הפטור על קצבה מזכה (27.01.2025), סעיף 9א לפקודה, תיקון 275', url: 'https://capitax.co.il/Attachments/27012025.pdf', kind: 'primary' };
const KZ_CREDIT = KZ('זיכוי_ממס_הכנסה_בגין_הפרשות_לביטוח_פנסיוני', 'זיכוי ממס הכנסה בגין הפרשות לביטוח פנסיוני');
const KZ_EMPLOYER = KZ('פטור_ממס_הכנסה_על_הפרשות_המעסיק_לביטוח_פנסיוני_ולביטוח_אובדן_כושר_עבודה', 'פטור ממס על הפרשות המעסיק לביטוח פנסיוני');
const KZ_SEVERANCE = KZ('משיכת_כספי_פיצויי_פיטורים_מקופת_גמל_או_מהביטוח_הפנסיוני', 'משיכת כספי פיצויים מקופת גמל או מהביטוח הפנסיוני');
const PENDING = 'הצוות של משרד האוצר (07.2026) המליץ על תקרת הטבה של 200 אלף ש"ח לחוסך ועל ביטול הפטור בקצבה מגיל 60; המלצה, לא חוק';

export const RULES: ProductRule[] = [
  { key: 'hishtalmut', name: 'קרן השתלמות', year: 2026, conf: 'partly',
    liq: 'משיכה בלי מס אחרי 6 שנים מההפקדה הראשונה; אחרי 3 שנים למטרת השתלמות או בגיל פרישה. משיכה מוקדמת: הפקדות המעסיק והרווחים חייבים במס שולי',
    tax: 'הרווחים פטורים ממס על הפקדות עד התקרה (שכיר: הפקדת מעסיק עד 7.5% משכר של עד 188,544 ש"ח בשנה, 2026); על הפקדות מעל התקרה: מס רווחי הון',
    src: [KZ('קרן_השתלמות', 'קרן השתלמות'), KZ('קרן_השתלמות_לעובד_עצמאי', 'קרן השתלמות לעובד עצמאי')] },
  { key: 'gemelInvest', name: 'קופת גמל להשקעה', year: 2026, conf: 'verified', watch: PENDING,
    liq: 'נזילה בכל עת, במלואה או בחלקה; מעבר בין מסלולים ובין קופות גמל להשקעה אינו אירוע מס',
    tax: 'אין הטבת מס בהפקדה; תקרת הפקדה 83,641 ש"ח לשנה (2026). משיכה הונית: הרווח הריאלי חייב במס (25%); משיכה כקצבה מגיל 60: הרווח פטור ממס',
    src: [MOF_2025, KZ('קופת_גמל_להשקעה', 'קופת גמל להשקעה'), KZ('פטור_ממס_על_רווחים_בקופת_גמל_להשקעה_המשולמת_כקצבה_לאחר_גיל_60', 'פטור ממס על רווחים בקופת גמל להשקעה המשולמת כקצבה לאחר גיל 60'), MOF_2026] },
  { key: 'gemel', name: 'קופת גמל לתגמולים ולפיצויים', year: 2026, conf: 'partly',
    liq: 'כספי תגמולים שהופקדו מ-2008: קצבה בלבד בפרישה (צבירה מעל קצבת המינימום ניתנת להיוון); רכיב הפיצויים ניתן למשיכה בעזיבת עבודה; משיכה מוקדמת של תגמולים: מס 35%',
    tax: 'שכיר: זיכוי 35% על הפקדות העובד עד התקרה (סעיף 45א); הפקדות המעסיק פטורות עד התקרה. בקצבה: 57.5% מהקצבה המזכה פטורים (2026), עד תקרה',
    src: [KZ('קופת_גמל', 'קופת גמל'), KZ_CREDIT, TAX_9A] },
  { key: 'pension', name: 'קרן פנסיה', year: 2026, conf: 'partly',
    liq: 'תגמולים: קצבה חודשית בלבד, מגיל פרישה. פיצויים: ניתנים למשיכה בעזיבת עבודה, פטורים עד תקרה לכל שנת עבודה; המשיכה מקטינה את הקצבה ואת הפטור בפרישה',
    tax: 'זיכוי 35% על הפקדות העובד עד התקרה; הפקדות המעסיק פטורות עד 7.5% מהשכר ועד התקרה. בקצבה: 57.5% מהקצבה המזכה פטורים (2026), עד תקרה',
    src: [KZ_SEVERANCE, KZ_CREDIT, KZ_EMPLOYER, TAX_9A] },
  { key: 'managers', name: 'ביטוח מנהלים', year: 2026, conf: 'partly',
    liq: 'כספים שהופקדו מ-2008: קצבה בלבד; כספים מלפני 2008, בפוליסות שאפשרו זאת, ניתנים למשיכה הונית. פיצויים: ניתנים למשיכה בעזיבת עבודה',
    tax: 'הטבות כמו בקופת גמל לקצבה: זיכוי 35% על הפקדות העובד ופטור להפקדות המעסיק, עד התקרה; בקצבה: 57.5% מהקצבה המזכה פטורים (2026)',
    src: [KZ('ביטוח_מנהלים', 'ביטוח מנהלים'), KZ_CREDIT, TAX_9A] },
  { key: 'policy', name: 'פוליסת חיסכון', year: 2026, conf: 'verified', watch: PENDING,
    liq: 'נזילה בכל עת, במלואה או בחלקה; מעבר בין מסלולים באותה חברה אינו אירוע מס, ומעבר לחברת ביטוח אחרת מחייב פדיון וחייב במס',
    tax: 'אין הטבת מס בהפקדה ואין תקרת הפקדה; בפדיון הרווח חייב במס כהכנסה מריבית (25% על הרווח הריאלי); הקלות לפי סעיפים 125ד ו-125ה לפי גיל והכנסה',
    src: [MOF_2025, { title: 'TheMarker סופרמרקר: מה זו פוליסת חיסכון (04.2026)', url: 'https://www.supermarker.themarker.com/MenahalimInsurance/WhatIsSavingsPolicy.aspx', kind: 'press' }, MOF_2026] },
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
