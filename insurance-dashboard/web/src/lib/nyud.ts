/* W7 (wave 2, agent door) · the ניוד before/after engine: each product the client holds (lib/clients `Held`, its track tagged "קיים")
   against each candidate track of the folder (tagged "מומלץ" or "נבחן"), in shekels, on one stated basis. Pure: no React, no fetch,
   so tests/nyud.unit.ts runs it in node. Never a recommendation: the rows are arithmetic on published figures and on the client's own
   file, each with its source and its assumptions named.

   What a row carries (the regulator's annex structure, see below):
   - fees: the client's own fee pair (from the clearing-house file; the track's average when the file has none, flagged) against the
     candidate's actual average fee (AVG_ANNUAL_MANAGEMENT_FEE / AVG_DEPOSIT_FEE) or, when the candidate is a default fund, the tender
     price in force (funds/default.json), projected to retirement with lib/retire `project` (the fees-over-a-career arithmetic), in
     today's ₪. Two bases: 'fox' (lib/retire: deposit +2% a year, inflation 2%, 4% gross return) and 'annexB' (נספח ב' §2(ג) salary
     growth 0%, §2(ה) CPI 0%, §2(י)(3) 4% gross on free assets; the 4.86% slice on designated bonds, §2(י)(2)–(יא), is NOT modelled:
     every pension row says so).
   - cover: the monthly cost of disability (נכות / א.כ.ע) and survivors (שאירים / ריסק מוות) covers, when the file gives a cost on both
     sides (the candidate's cover cost is known only when the candidate is itself a product in the file); else null with the reason.
   - coef: when the existing product carries a guaranteed annuity coefficient (`coefGuaranteed`, HeldExtra), the monthly annuity at the
     guaranteed coefficient against the candidate fund's own coefficient from its bylaws (lib/coef `coefFor`, page cited) or the site's
     assumption, said so, on the same projected balance.
   - seniority: השתלמות only: the liquidity clock (6 years from the first deposit, Income Tax Ordinance §3(ה), lib/productRules).
   - notes: the liquidity and tax line of the product family (lib/productRules), the candidate's default-fund terms, and the circular's
     questions of §5א(1)(ט)(6) that the data answers in the affirmative.

   The output structure follows נספח א' of חוזר סוכנים ויועצים 2018-10-11 "מסמך הנמקה – תיקון" (18.07.2018, in force 01.07.2019):
   part א.1 "הרכב החיסכון הפנסיוני המומלץ עבורך" (columns, §5א(2)(א)–(י): המלצה · שם המוצר הפנסיוני ומספרו · השם המסחרי של מסלול
   ההשקעה ומספרו · הבטחת תשואה · תשואה ברוטו · דמי ניהול מהפקדות · דמי ניהול מחיסכון מצטבר · רמת הסיכון של מסלול ההשקעה ·
   סכום צפוי (יתרת חסכון ואומדן קצבה צפויה) · השיקולים העיקריים), a product that changes in two consecutive rows, before and after,
   "לא שונה" where a parameter does not change (§5א(1)(ח)); and the cost illustration of נספח ב' §1(ב): the expected balance at the end
   of the period, its reduction for death cover, for disability cover and for management fees, plus the expected annuity (§1(ג)).
   The 2025-3 draft (30.11.2025, not in force) moves the "חלוקת כספים בין קופות גמל" form in as נספח ה'1 and adds §7א; it does not
   change these columns. */
import type { FeePair } from './fundsCalc';
import { AGE_DEFAULT, BALANCE_EX, GROWTH_DEFAULT, INFL_DEFAULT, RETIRE_AGE, RET_FALLBACK, exampleMonthly, project, type Plan } from './retire';
import { birthYearOf, coefFor, type CoefFile, type CoefPick } from './coef';
import { rulesFor } from './productRules';
import type { Cover, Held, SnapRow } from './clients';

/** the circular the structure follows, cited on the document and in the tests */
export const HNM = {
  title: 'חוזר סוכנים ויועצים 2018-10-11 "מסמך הנמקה – תיקון" (18.07.2018; בתוקף מ-01.07.2019)',
  url: 'https://www.chamber.org.il/media/159038/h_2018-10-11-changes.pdf',
  draft: { title: 'טיוטת חוזר סוכנים ויועצים 2025-3 "מסמך הנמקה – תיקון – טיוטה" (30.11.2025; טרם בתוקף)', url: 'https://www.gov.il/BlobFolder/dynamiccollectorresultitem/notice_2025_65/he/Draft%20explanatory%20Document%20-%20PDF.pdf' },
  /** the sections this module follows */
  sections: { a1: '§5א(2)(א)–(י), נספח א\' חלק א.1', beforeAfter: '§5א(1)(ח)', questions: '§5א(1)(ט)(6)', costs: 'נספח ב\' §1(ב)–(ג), §2, §4', fullCost: '§5א(2)(י)' },
} as const;

export type Basis = 'fox' | 'annexB';
export interface NyudIn {
  /** the client's age today and retirement age (lib/retire RETIRE_AGE when not given); sex for the fund's coefficient table */
  age?: number | null; retire?: number | null; sex?: 'm' | 'f' | null;
  /** gross return assumption, % (RET_FALLBACK when not given) */
  ret?: number | null;
  basis?: Basis;
}
/** a candidate: a track row as the client document shows it (lib/compareDoc docRow / a folder's snapshot) */
export type Candidate = Pick<SnapRow, 'k' | 'name' | 'prod' | 'track' | 'id' | 'mgr' | 'grp' | 'pen' | 'old' | 'fee' | 'depfee' | 'a3g' | 'st' | 'dflt'>;

export interface FeeLeg {
  /** the pair used and where it comes from */
  pair: FeePair; basis: 'file' | 'avg' | 'tender' | 'none';
  /** the text of the basis for the document */
  how: string;
}
export interface FeeDiff {
  balance: number; monthly: number; exBalance: boolean; exMonthly: boolean; years: number;
  own: FeeLeg; cand: FeeLeg;
  /** today's ₪ at retirement: positive = the candidate's fees leave more money */
  balRealDiff: number; feesRealDiff: number;
  /** the projected balances, today's ₪ */
  balOwn: number; balCand: number;
  /** this year's fee cost, ₪, on today's balance and deposits */
  annualOwn: number; annualCand: number;
}
export interface CoverDiff { exist: number | null; cand: number | null; diff: number | null; n: number; why: string | null }
export interface CoefDiff { guaranteed: number; src: 'file' | 'agent'; at: number | null; cand: CoefPick; balAt: number; annG: number; annC: number; diff: number; text: string }
export interface Seniority { prod: 'השתלמות'; text: string; src: string }
export interface Question { id: 'א' | 'ב' | 'ג' | 'ד' | 'ה'; text: string; detail: string }

export interface NyudRow {
  exist: Held; existName: string; cand: Candidate;
  fee: FeeDiff | null; feeWhy: string | null;
  cover: CoverDiff;
  coef: CoefDiff | null; coefWhy: string | null;
  seniority: Seniority | null;
  notes: string[];
  questions: Question[];
  /** the two consecutive rows of part א.1 (before, after) in the circular's column order */
  annex: AnnexPair;
  basis: Basis;
}
export const A1_COLS = ['המלצה', 'שם המוצר הפנסיוני ומספרו', 'השם המסחרי של מסלול ההשקעה ומספרו', 'הבטחת תשואה', 'תשואה ברוטו', 'דמי ניהול מהפקדות', 'דמי ניהול מחיסכון מצטבר', 'רמת הסיכון של מסלול ההשקעה', 'סכום צפוי (יתרת חסכון ואומדן קצבה צפויה)', 'השיקולים העיקריים'] as const;
export type A1Row = Record<(typeof A1_COLS)[number], string>;
export interface AnnexPair { before: A1Row; after: A1Row }
export const UNCHANGED = 'לא שונה';

const ils = (v: number) => `₪${Math.round(v).toLocaleString('en-US')}`;
const pc = (v: number) => `${(Math.round(v * 100) / 100).toFixed(2)}%`;
const COVER_RE = /נכות|אובדן כושר|אבדן כושר|א\.כ\.ע|אכ"ע|שאירים|שארים|מוות|ריסק/;
export const isRiskCover = (c: Cover) => COVER_RE.test(`${c.name} ${c.kind ?? ''}`);

/** the plan of a basis: fox's (lib/retire defaults) or the circular's נספח ב' (growth 0, CPI 0, 4%) */
export function planOf(inp: NyudIn, balance: number, monthly: number): Plan {
  const basis = inp.basis ?? 'fox';
  const age = Math.min(Math.max(inp.age ?? AGE_DEFAULT, 16), 80);
  const retire = Math.max(inp.retire ?? RETIRE_AGE, age + 1);
  const ret = basis === 'annexB' ? 4 : (inp.ret ?? RET_FALLBACK);
  return { age, retire, balance, monthly, growth: basis === 'annexB' ? 0 : GROWTH_DEFAULT, infl: basis === 'annexB' ? 0 : INFL_DEFAULT, ret, coef: 200 };
}
export const BASIS_TEXT: Record<Basis, string> = {
  fox: `הנחות האתר (lib/retire): הפקדה שעולה ${GROWTH_DEFAULT}% בשנה, אינפלציה ${INFL_DEFAULT}%, תשואה ${RET_FALLBACK}% ברוטו; סכומים בשקלים של היום`,
  annexB: 'הנחות נספח ב\' לחוזר: גידול שכר 0% (§2(ג)), מדד 0% (§2(ה)), תשואה ברוטו 4% על נכסים חופשיים (§2(י)(3)); חלק האג"ח המיועדות (4.86%, §2(י)(2) ו-§2(יא)) אינו מחושב כאן',
};

/** the client's own fee pair of a held product: the file's; the matched track's average where the file has none (flagged) */
export function ownLeg(h: Held, track: Candidate | null): FeeLeg {
  if (h.fee != null) return { pair: { fee: h.fee, depfee: h.depfee ?? 0 }, basis: 'file', how: `דמי הניהול של הלקוח מקובץ המסלקה${h.feeHow ? ` (${h.feeHow})` : ''}${h.depfee == null ? '; מהפקדה: אין נתון, חושב 0%' : ''}` };
  if (track && track.fee != null) return { pair: { fee: track.fee, depfee: track.depfee ?? h.depfee ?? 0 }, basis: 'avg', how: 'אין דמי ניהול של הלקוח בקובץ: חושב לפי הממוצע בפועל של המסלול (הרשות), לא דמי הניהול שלו' };
  return { pair: { fee: 0, depfee: 0 }, basis: 'none', how: 'אין דמי ניהול בקובץ ואין מסלול תואם: לא חושב' };
}
/** the candidate's fee pair: the tender price when it is a default fund in force, else the track's actual average */
export function candLeg(c: Candidate): FeeLeg {
  if (c.dflt && c.dflt.fee != null && c.dflt.depfee != null) return { pair: { fee: c.dflt.fee, depfee: c.dflt.depfee }, basis: 'tender', how: `מחיר המכרז לקרן ברירת מחדל (הליך ${c.dflt.t}), למצטרף דרכו: ${pc(c.dflt.depfee)} מהפקדה / ${pc(c.dflt.fee)} מצבירה` };
  if (c.fee != null) return { pair: { fee: c.fee, depfee: c.depfee ?? 0 }, basis: 'avg', how: `הממוצע בפועל של המסלול (הרשות): ${pc(c.depfee ?? 0)} מהפקדה / ${pc(c.fee)} מצבירה; דמי הניהול שיוצעו ללקוח יכולים להיות שונים` };
  return { pair: { fee: 0, depfee: 0 }, basis: 'none', how: 'אין דמי ניהול מפורסמים למסלול' };
}

/** ₪ to retirement, the client's fees against the candidate's, one projection for both */
export function feeDiff(h: Held, track: Candidate | null, c: Candidate, inp: NyudIn): { d: FeeDiff | null; why: string | null } {
  const own = ownLeg(h, track), cand = candLeg(c);
  if (own.basis === 'none' || cand.basis === 'none') return { d: null, why: own.basis === 'none' ? own.how : cand.how };
  const exBalance = h.balance == null, exMonthly = h.monthly == null;
  const balance = h.balance ?? BALANCE_EX, monthly = h.monthly ?? exampleMonthly(c.prod).v;
  const plan = planOf(inp, balance, monthly);
  const a = project(plan, own.pair), b = project(plan, cand.pair);
  const annual = (p: FeePair) => (balance * p.fee + monthly * 12 * p.depfee) / 100;
  return { d: { balance, monthly, exBalance, exMonthly, years: a.months / 12, own, cand, balRealDiff: b.balReal - a.balReal, feesRealDiff: a.feesReal - b.feesReal, balOwn: a.balReal, balCand: b.balReal, annualOwn: annual(own.pair), annualCand: annual(cand.pair) }, why: null };
}

/** the monthly cost of the risk covers (disability, survivors / death) of a set of products, or null when none carries a cost */
export function riskCost(hs: Held[]): { v: number | null; n: number; noCost: number } {
  let v: number | null = null, n = 0, noCost = 0;
  for (const h of hs) for (const c of h.covers) { if (!isRiskCover(c)) continue; n++; if (c.cost == null) noCost++; else v = (v ?? 0) + c.cost; }
  return { v, n, noCost };
}
/** the cover-cost difference, a month: only when both sides carry a cost in the file */
export function coverDiff(exist: Held, candHeld: Held[]): CoverDiff {
  const a = riskCost([exist]), b = riskCost(candHeld);
  if (a.v == null) return { exist: null, cand: b.v, diff: null, n: a.n, why: a.n ? 'לכיסויים במוצר הקיים אין עלות בקובץ' : 'אין כיסוי נכות או שאירים במוצר הקיים לפי הקובץ' };
  if (b.v == null) return { exist: a.v, cand: null, diff: null, n: a.n, why: candHeld.length ? 'למוצר המוצע אין עלות כיסוי בקובץ' : 'עלות הכיסוי במוצר המוצע אינה במאגרי הרשות: להשלים מהגוף המנהל (תלויה בגיל, במסלול הביטוח ובחיתום)' };
  return { exist: a.v, cand: b.v, diff: a.v - b.v, n: a.n, why: null };
}

/** the guaranteed coefficient written in the existing policy against the candidate fund's bylaws coefficient, on the same balance */
export function coefDiff(h: Held, c: Candidate, fee: FeeDiff | null, coefF: CoefFile | null | undefined, inp: NyudIn): { d: CoefDiff | null; why: string | null } {
  const g = h.coefGuaranteed;
  if (!g || !(g.v > 0)) return { d: null, why: null };
  if (!c.pen) return { d: null, why: `במוצר הקיים מקדם מובטח ${g.v}; המוצר המוצע (${c.prod}) אינו קרן פנסיה: המקדם בו ייקבע בעת הפרישה לפי תנאי המוצר והגוף המשלם, ואינו מובטח. לפרט לפי §5א(1)(ט)(6)(א)` };
  const age = inp.age ?? AGE_DEFAULT, retire = Math.max(inp.retire ?? RETIRE_AGE, age + 1);
  const pick = coefFor(coefF, c.grp, inp.sex, retire, birthYearOf(age));
  const balAt = fee ? fee.balCand : project(planOf(inp, h.balance ?? BALANCE_EX, h.monthly ?? exampleMonthly(c.prod).v), candLeg(c).pair).balReal;
  const annG = balAt / g.v, annC = balAt / pick.v;
  const text = `מקדם מובטח ${g.v} במוצר הקיים (${g.src === 'file' ? 'מקובץ המסלקה' : 'לפי הסוכן'}${g.at ? `, לגיל ${g.at}` : ''}) מול ${pick.real ? `מקדם ${pick.v} מתקנון ${c.grp} (${pick.label})` : `הנחת האתר ${pick.v} (${pick.why})`}: על אותו חיסכון צפוי (${ils(balAt)}) קצבה של ${ils(annG)} מול ${ils(annC)} לחודש`;
  return { d: { guaranteed: g.v, src: g.src, at: g.at, cand: pick, balAt, annG, annC, diff: annG - annC, text }, why: null };
}

/** the sources behind the seniority line: the Income Tax Ordinance (lib/productRules) and the transfer regulations */
export const SENIORITY_SRC = 'סעיף 3(ה) לפקודת מס הכנסה (lib/productRules, נבדק 01.11.26); שמירת הוותק בניוד: תקנות הפיקוח על שירותים פיננסיים (קופות גמל) (העברת כספים בין קופות גמל), התשס"ח-2008, כפי שמתארים אותן הגופים המנהלים; נוסח התקנות לא נבדק כאן';
/** השתלמות: what happens to the liquidity clock. A transfer of the balance to another fund keeps the fund's seniority under the transfer
 *  regulations; new deposits to a new fund without moving the balance start their own six years (the Ordinance counts from the first
 *  deposit to that fund). The agent chooses which the recommendation is: the line states both. */
export function seniority(h: Held, c: Candidate): Seniority | null {
  const prod = c.prod === 'השתלמות' || /השתלמות/.test(h.typeHe) ? 'השתלמות' : null;
  if (!prod || c.prod !== 'השתלמות') return null;
  const same = h.k != null && h.k === c.k;
  if (same) return { prod, text: 'אותה קרן: מועד הנזילות אינו משתנה', src: SENIORITY_SRC };
  return { prod, text: `קרן אחרת: בניוד הצבירה הוותק נשמר ומועד הנזילות (6 שנים מההפקדה הראשונה) אינו מתאפס, לפי תקנות העברת הכספים; הפקדות חדשות לקרן חדשה בלי העברת הצבירה מתחילות ספירה נפרדת של 6 שנים. יש לציין במסמך איזו פעולה הומלצה`, src: SENIORITY_SRC };
}

/** the exit and entry notes the rules already carry: liquidity and tax of the family, the candidate's default-fund terms */
export function notesOf(h: Held, c: Candidate): string[] {
  const out: string[] = [];
  for (const r of rulesFor(c.prod)) out.push(`${r.name}, נזילות: ${r.liq}`, `${r.name}, מיסוי: ${r.tax}`);
  if (c.dflt && c.dflt.fee != null) out.push(`המסלול המוצע הוא בקרן ברירת מחדל (הליך ${c.dflt.t}): מחיר המכרז מובטח למצטרף דרך ההליך ל-10 שנים לפחות (חוזר גופים מוסדיים 2024-9-6, §5(ב)); הצטרפות דרך סוכן אינה בהכרח "הצטרפות לקרן נבחרת" (הבהרת הרשות שה.2025-1264, 10.06.2025)`);
  if (c.old) out.push('המוצר המוצע הוא פוליסה מדור ישן: דמי הניהול משתנים (השתתפות ברווחים) ואינם מחיר להשוואה');
  if (/ביטוח מנהלים|ביטוחי מנהלים/.test(h.typeHe) && !h.coefGuaranteed) out.push('המוצר הקיים הוא ביטוח מנהלים: לבדוק בפוליסה אם יש מקדם קצבה מובטח או הבטחת תשואה לפני ניוד (§5א(1)(ט)(6)(א)–(ב)); אין נתון בקובץ');
  return out;
}
/** the circular's questions (§5א(1)(ט)(6)) the data answers "yes" to; the document lists only those */
export function questionsOf(h: Held, c: Candidate, coef: CoefDiff | null): Question[] {
  const q: Question[] = [];
  if (h.coefGuaranteed && h.coefGuaranteed.v > 0) q.push({ id: 'א', text: 'האם ההמלצה כוללת העברת כספים ממוצר עם מקדם המרה הכולל הבטחת תוחלת חיים, או הפסקת תשלומים למוצר כאמור?', detail: `כן: ${h.typeHe}${h.provider ? ` · ${h.provider}` : ''}, מקדם ${h.coefGuaranteed.v}${coef ? `; ${coef.text}` : ''}. התנאים להבטחת המקדם לכל תוחלת החיים: להשלים מהפוליסה` });
  if (c.pen && h.k !== c.k && /ותיקה|שבהסדר/.test(`${h.typeHe} ${h.plan ?? ''}`)) q.push({ id: 'ה', text: 'האם ההמלצה כוללת אחת מהפעולות הבאות בקרן פנסיה ותיקה שבהסדר?', detail: 'המוצר הקיים נראה כקרן ותיקה: לפרט את ההשלכות על הזכויות שנצברו' });
  return q;
}

/** part א.1, the existing product before and the candidate after, in the circular's column order, "לא שונה" where equal (§5א(1)(ח)) */
export function annexPair(h: Held, track: Candidate | null, c: Candidate, fee: FeeDiff | null, coef: CoefDiff | null, asofText: string): AnnexPair {
  const name = [h.typeHe, h.provider].filter(Boolean).join(' · ');
  const before: A1Row = {
    'המלצה': '', 'שם המוצר הפנסיוני ומספרו': `${name}${h.plan ? ` · ${h.plan}` : ''}`, 'השם המסחרי של מסלול ההשקעה ומספרו': track ? `${track.name}${track.id != null ? ` · מס' ${track.id}` : ''}` : h.track ?? '',
    'הבטחת תשואה': h.coefGuaranteed ? 'מקדם קצבה מובטח: ראו השיקולים' : '', 'תשואה ברוטו': track?.a3g != null ? `${pc(track.a3g)} (36 חודשים, ${asofText})` : '',
    'דמי ניהול מהפקדות': h.depfee != null ? `${pc(h.depfee)} (של הלקוח)` : fee?.own.basis === 'avg' ? `${pc(fee.own.pair.depfee)} (ממוצע המסלול)` : '', 'דמי ניהול מחיסכון מצטבר': h.fee != null ? `${pc(h.fee)} (של הלקוח)` : fee?.own.basis === 'avg' ? `${pc(fee.own.pair.fee)} (ממוצע המסלול)` : '',
    'רמת הסיכון של מסלול ההשקעה': track?.st != null ? `חשיפה למניות ${Math.round(track.st)}%` : '', 'סכום צפוי (יתרת חסכון ואומדן קצבה צפויה)': fee ? `${ils(fee.balOwn)} בגיל הפרישה${coef ? `; קצבה ${ils(coef.annG)} במקדם המובטח` : ''}` : h.balance != null ? `יתרה ${ils(h.balance)}` : '',
    'השיקולים העיקריים': '',
  };
  const after: A1Row = {
    'המלצה': '', 'שם המוצר הפנסיוני ומספרו': `${c.prod} · ${c.mgr}${c.id != null ? ` · מס' ${c.id}` : ''}`, 'השם המסחרי של מסלול ההשקעה ומספרו': `${c.name}${c.id != null ? ` · מס' ${c.id}` : ''}`,
    'הבטחת תשואה': 'אין', 'תשואה ברוטו': c.a3g != null ? `${pc(c.a3g)} (36 חודשים, ${asofText})` : 'אין נתון',
    'דמי ניהול מהפקדות': fee ? `${pc(fee.cand.pair.depfee)} (${fee.cand.basis === 'tender' ? 'מחיר המכרז' : 'ממוצע בפועל'})` : '', 'דמי ניהול מחיסכון מצטבר': fee ? `${pc(fee.cand.pair.fee)} (${fee.cand.basis === 'tender' ? 'מחיר המכרז' : 'ממוצע בפועל'})` : '',
    'רמת הסיכון של מסלול ההשקעה': c.st != null ? `חשיפה למניות ${Math.round(c.st)}%` : '', 'סכום צפוי (יתרת חסכון ואומדן קצבה צפויה)': fee ? `${ils(fee.balCand)} בגיל הפרישה${coef ? `; קצבה ${ils(coef.annC)} במקדם ${coef.cand.real ? 'התקנון' : 'ההנחה'}` : ''}` : '',
    'השיקולים העיקריים': '',
  };
  for (const k of A1_COLS) if (k !== 'המלצה' && k !== 'השיקולים העיקריים' && before[k] && before[k] === after[k]) after[k] = UNCHANGED;
  return { before, after };
}

/** one row: an existing product against one candidate */
export function nyudRow(h: Held, track: Candidate | null, c: Candidate, candHeld: Held[], coefF: CoefFile | null | undefined, inp: NyudIn, asofText: string): NyudRow {
  const basis = inp.basis ?? 'fox';
  const f = feeDiff(h, track, c, { ...inp, basis });
  const cf = coefDiff(h, c, f.d, coefF, { ...inp, basis });
  return { exist: h, existName: [h.typeHe, h.provider, h.track ?? h.plan].filter(Boolean).join(' · '), cand: c, fee: f.d, feeWhy: f.why, cover: coverDiff(h, candHeld), coef: cf.d, coefWhy: cf.why,
    seniority: seniority(h, c), notes: notesOf(h, c), questions: questionsOf(h, c, cf.d), annex: annexPair(h, track, c, f.d, cf.d, asofText), basis };
}

/** The family a transfer can stay within (תקנות העברת כספים בין קופות גמל, התשס"ח-2008: between funds of the same purpose): the
 *  annuity products (pension, gemel for tagmulim, managers' insurance) among themselves; השתלמות only to השתלמות; גמל להשקעה only to
 *  גמל להשקעה. A pair across families is not a ניוד and is skipped with the reason. */
export type Family = 'kitzba' | 'hish' | 'invest' | 'other';
export function familyOf(s: string): Family {
  if (/השתלמות/.test(s)) return 'hish';
  if (/להשקעה|לילד/.test(s)) return 'invest';
  if (/פנסיה|גמל|ביטוח מנהלים|ביטוחי מנהלים|פוליס|קצבה/.test(s)) return 'kitzba';
  return 'other';
}
export interface NyudTableOut { rows: NyudRow[]; exist: Held[]; cands: Candidate[]; basis: Basis; basisText: string; skipped: string[] }
/** every existing product (tagged "קיים": matched to such a track, or any held product with a balance when no track is tagged)
 *  against every candidate ("מומלץ" first, then "נבחן"); `rows` holds the row data, `skipped` says what was left out and why */
export function nyudTable(held: Held[], rows: Candidate[], tags: Record<string, string>, coefF: CoefFile | null | undefined, inp: NyudIn, asofText: string): NyudTableOut {
  const basis = inp.basis ?? 'fox';
  const existKeys = rows.filter((r) => tags[r.k] === 'קיים').map((r) => r.k);
  const cands = [...rows.filter((r) => tags[r.k] === 'מומלץ'), ...rows.filter((r) => tags[r.k] === 'נבחן')];
  const skipped: string[] = [];
  const exist = held.filter((h) => (h.k ? existKeys.includes(h.k) || !rows.some((r) => r.k === h.k) : true) && (h.balance != null || h.monthly != null));
  held.filter((h) => !exist.includes(h)).forEach((h) => skipped.push(`${h.typeHe}${h.provider ? ` · ${h.provider}` : ''}: ${h.k && !existKeys.includes(h.k) ? 'המסלול שלו מסומן במסמך כמוצע או נבחן, לא כקיים' : 'בלי יתרה ובלי הפקדה בקובץ'}`));
  const out: NyudRow[] = [];
  for (const h of exist) for (const c of cands) {
    if (h.k === c.k) { skipped.push(`${h.typeHe}: ${c.name} הוא המסלול שהלקוח כבר בו`); continue; }
    if (familyOf(h.typeHe) !== familyOf(c.prod) || familyOf(c.prod) === 'other') { skipped.push(`${h.typeHe} ← ${c.name}: לא ניוד באותה משפחת מוצרים (${c.prod})`); continue; }
    out.push(nyudRow(h, h.k ? rows.find((r) => r.k === h.k) ?? null : null, c, held.filter((x) => x.k === c.k), coefF, { ...inp, basis }, asofText));
  }
  return { rows: out, exist, cands, basis, basisText: BASIS_TEXT[basis], skipped };
}

/** the full-cost line of §5א(2)(י): management fees a year, existing against recommended, ₪ */
export function fullCost(rows: NyudRow[]): { own: number; cand: number; n: number } | null {
  const have = rows.filter((r) => r.fee);
  if (!have.length) return null;
  return { own: have.reduce((t, r) => t + r.fee!.annualOwn, 0), cand: have.reduce((t, r) => t + r.fee!.annualCand, 0), n: have.length };
}
/* ---------- the default-fund allocation mechanism (employer onboarding, pages/FundsDefault) ---------- */
/** The mechanism the tender in force states (funds/default.json `alloc`, the regulator's results notice): "7,8,9 אינפיניטי · 4,5,6 מור ·
 *  2,3 אלטשולר שחם · 0,1 מיטב", parsed into check digit → group. Empty when the tender states none. */
export function allocOf(alloc: string | null | undefined): Map<number, string> {
  const out = new Map<number, string>();
  if (!alloc) return out;
  const body = alloc.split(':').slice(1).join(':').split(';')[0];
  for (const m of body.matchAll(/(\d(?:\s*,\s*\d)*)\s+([^·;]+)/g)) { const grp = m[2].trim(); m[1].split(',').forEach((d) => out.set(Number(d.trim()), grp)); }
  return out;
}
/** the check digit of an Israeli ID number: its last digit */
export const checkDigit = (id: string) => { const d = id.replace(/\D/g, ''); return d ? Number(d[d.length - 1]) : null; };

export const ilsSigned = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}₪${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
