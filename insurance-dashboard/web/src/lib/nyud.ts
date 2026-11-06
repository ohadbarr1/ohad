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
import { GROWTH_DEFAULT, INFL_DEFAULT, RETIRE_AGE, RET_FALLBACK, project, type Plan } from './retire';
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
  /** red team 06.11.26: the monthly deposit a projection uses when the file has none for the product. 0 (the default): no future
   *  deposits. Never an example amount: a figure the file does not hold is not projected (the saver lane may pass its own value). */
  depositWhenMissing?: number;
}
/** red team 06.11.26: no projection without the client's age (from the clearing-house file, or typed); never a silent default */
export const AGE_MISSING = 'גיל הלקוח חסר: אין תחזית עד שהגיל נקרא מקובץ המסלקה או מוזן';
/** the age a projection may use: 16–80 whole years, else null (no projection) */
export const ageOk = (a: number | null | undefined): number | null => (a != null && Number.isFinite(a) && a >= 16 && a <= 80 ? Math.round(a) : null);
/** a candidate: a track row as the client document shows it (lib/compareDoc docRow / a folder's snapshot) */
export type Candidate = Pick<SnapRow, 'k' | 'name' | 'prod' | 'track' | 'id' | 'mgr' | 'grp' | 'pen' | 'old' | 'fee' | 'depfee' | 'a3g' | 'st' | 'dflt'>;

export interface FeeLeg {
  /** the pair used and where it comes from */
  pair: FeePair; basis: 'file' | 'avg' | 'tender' | 'agreed' | 'none';
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
export interface CoverDiff { exist: number | null; cand: number | null; diff: number | null; n: number; why: string | null; /** the candidate's cost was typed by the agent */ agent?: boolean }
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
  /** the held product's index in the folder (the pairing key) */
  i: number;
  /** red team 06.11.26: the pair is not comparable yet (the proposed product's insurance cost is unknown while the existing one's is
   *  in the file): the headline gain is withheld and this says what to fill */
  incomplete: string | null;
}
export const A1_COLS = ['המלצה', 'שם המוצר הפנסיוני ומספרו', 'השם המסחרי של מסלול ההשקעה ומספרו', 'הבטחת תשואה', 'תשואה ברוטו', 'דמי ניהול מהפקדות', 'דמי ניהול מחיסכון מצטבר', 'רמת הסיכון של מסלול ההשקעה', 'סכום צפוי (יתרת חסכון ואומדן קצבה צפויה)', 'השיקולים העיקריים'] as const;
export type A1Row = Record<(typeof A1_COLS)[number], string>;
/** `assume`: the cells whose figure is projected or assumed (the document stamps them "הנחה"), with what the assumption is */
export interface AnnexPair { before: A1Row; after: A1Row; assume: { before: Partial<A1Row>; after: Partial<A1Row> } }
export const UNCHANGED = 'לא שונה';

const ils = (v: number) => `₪${Math.round(v).toLocaleString('en-US')}`;
const pc = (v: number) => `${(Math.round(v * 100) / 100).toFixed(2)}%`;
const COVER_RE = /נכות|אובדן כושר|אבדן כושר|א\.כ\.ע|אכ"ע|שאירים|שארים|מוות|ריסק/;
export const isRiskCover = (c: Cover) => COVER_RE.test(`${c.name} ${c.kind ?? ''}`);

/** the plan of a basis: fox's (lib/retire defaults) or the circular's נספח ב' (growth 0, CPI 0, 4%) */
export function planOf(inp: NyudIn, balance: number, monthly: number): Plan {
  const basis = inp.basis ?? 'fox';
  const age = ageOk(inp.age) ?? 40;  // callers check ageOk first (feeDiff, coefDiff); 40 only keeps the type total
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
/** the fee the agent typed for a pair ("דמי ניהול שסוכמו"), or the tender price taken as a labelled preset */
export interface FeeOverride { depfee: number; fee: number; src: 'agreed' | 'tender' }
/** the tender price of a default-fund candidate, as a preset the agent may pick; null when it is not a default fund in force */
export const tenderPreset = (c: Pick<Candidate, 'dflt'>): FeeOverride | null => (c.dflt && c.dflt.fee != null && c.dflt.depfee != null ? { depfee: c.dflt.depfee, fee: c.dflt.fee, src: 'tender' } : null);
/** the candidate's fee pair: what the agent agreed with the client when typed; the tender price when the agent picked it as a preset;
 *  else the track's actual published average, labelled as an assumption (red team 06.11.26: the tender price is no longer the silent
 *  default: an agent's client does not necessarily join "through the tender") */
export function candLeg(c: Candidate, ov?: FeeOverride | null): FeeLeg {
  if (ov && ov.src === 'agreed') return { pair: { fee: ov.fee, depfee: ov.depfee }, basis: 'agreed', how: `דמי הניהול שסוכמו עם הלקוח, כפי שבעל הרישיון הזין: ${pc(ov.depfee)} מהפקדה / ${pc(ov.fee)} מצבירה` };
  if (ov && ov.src === 'tender' && c.dflt) return { pair: { fee: ov.fee, depfee: ov.depfee }, basis: 'tender', how: `מחיר המכרז לקרן ברירת מחדל (הליך ${c.dflt.t}), שבעל הרישיון בחר: ${pc(ov.depfee)} מהפקדה / ${pc(ov.fee)} מצבירה; מובטח למצטרף דרך ההליך, לא בהכרח ללקוח שמצטרף דרך סוכן` };
  if (c.fee != null) return { pair: { fee: c.fee, depfee: c.depfee ?? 0 }, basis: 'avg', how: `הנחה: הממוצע בפועל של המסלול (הרשות), ${pc(c.depfee ?? 0)} מהפקדה / ${pc(c.fee)} מצבירה; לא הוזנו דמי ניהול שסוכמו עם הלקוח` };
  return { pair: { fee: 0, depfee: 0 }, basis: 'none', how: 'אין דמי ניהול מפורסמים למסלול ולא הוזנו דמי ניהול שסוכמו' };
}
/** the label of a candidate's fee basis in a cell */
export const CAND_BASIS_HE: Record<FeeLeg['basis'], string> = { agreed: 'שסוכמו', tender: 'מחיר המכרז, הנחה', avg: 'ממוצע בפועל, הנחה', file: 'מהקובץ', none: '' };
/** the same label inside part א.1, where the cell's "הנחה" stamp (AnnexPair `assume`) says the rest */
const A1_BASIS_HE: Record<FeeLeg['basis'], string> = { agreed: 'שסוכמו', tender: 'מחיר המכרז', avg: 'ממוצע בפועל', file: 'מהקובץ', none: '' };

/** ₪ to retirement, the client's fees against the candidate's, one projection for both */
export function feeDiff(h: Held, track: Candidate | null, c: Candidate, inp: NyudIn, ov?: FeeOverride | null): { d: FeeDiff | null; why: string | null } {
  const own = ownLeg(h, track), cand = candLeg(c, ov);
  if (own.basis === 'none' || cand.basis === 'none') return { d: null, why: own.basis === 'none' ? own.how : cand.how };
  if (ageOk(inp.age) == null) return { d: null, why: AGE_MISSING };
  // red team 06.11.26: what the file does not hold is not invented: no balance = 0, no deposit = no future deposits (or the caller's
  // explicit `depositWhenMissing`), each flagged
  const exBalance = h.balance == null, exMonthly = h.monthly == null;
  const balance = h.balance ?? 0, monthly = h.monthly ?? Math.max(0, inp.depositWhenMissing ?? 0);
  if (balance <= 0 && monthly <= 0) return { d: null, why: 'אין בקובץ יתרה ואין הפקדה: אין מה להשוות' };
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
export function coverDiff(exist: Held, candHeld: Held[], candCost?: number | null): CoverDiff {
  const a = riskCost([exist]), b0 = riskCost(candHeld);
  // the agent may type the proposed product's cover cost (from the managing company's quote)
  const typed = candCost != null && Number.isFinite(candCost) && candCost >= 0;
  const b = typed ? { v: candCost as number, n: 1, noCost: 0 } : b0;
  if (a.v == null) return { exist: null, cand: b.v, diff: null, n: a.n, why: a.n ? 'לכיסויים במוצר הקיים אין עלות בקובץ' : 'אין כיסוי נכות או שאירים במוצר הקיים לפי הקובץ' };
  if (b.v == null) return { exist: a.v, cand: null, diff: null, n: a.n, why: candHeld.length ? 'למוצר המוצע אין עלות כיסוי בקובץ' : 'עלות הכיסוי במוצר המוצע אינה במאגרי הרשות: להשלים מהגוף המנהל (תלויה בגיל, במסלול הביטוח ובחיתום)' };
  return { exist: a.v, cand: b.v, diff: a.v - b.v, n: a.n, why: null, ...(typed ? { agent: true } : {}) };
}

/** the guaranteed coefficient written in the existing policy against the candidate fund's bylaws coefficient, on the same balance */
export function coefDiff(h: Held, c: Candidate, fee: FeeDiff | null, coefF: CoefFile | null | undefined, inp: NyudIn): { d: CoefDiff | null; why: string | null } {
  const g = h.coefGuaranteed;
  if (!g || !(g.v > 0)) return { d: null, why: null };
  if (!c.pen) return { d: null, why: `במוצר הקיים מקדם מובטח ${g.v}; המוצר המוצע (${c.prod}) אינו קרן פנסיה: המקדם בו ייקבע בעת הפרישה לפי תנאי המוצר והגוף המשלם, ואינו מובטח. לפרט לפי §5א(1)(ט)(6)(א)` };
  const age = ageOk(inp.age);
  if (age == null) return { d: null, why: `במוצר הקיים מקדם מובטח ${g.v}; ${AGE_MISSING}` };
  const retire = Math.max(inp.retire ?? RETIRE_AGE, age + 1);
  const pick = coefFor(coefF, c.grp, inp.sex, retire, birthYearOf(age));
  const bal0 = h.balance ?? 0, mon0 = h.monthly ?? Math.max(0, inp.depositWhenMissing ?? 0);
  if (!fee && bal0 <= 0 && mon0 <= 0) return { d: null, why: `במוצר הקיים מקדם מובטח ${g.v}; אין בקובץ יתרה או הפקדה לחישוב קצבה` };
  const balAt = fee ? fee.balCand : project(planOf(inp, bal0, mon0), candLeg(c).pair).balReal;
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
export function annexPair(h: Held, track: Candidate | null, c: Candidate, fee: FeeDiff | null, coef: CoefDiff | null, asofText: string, inp: NyudIn = {}): AnnexPair {
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
    'דמי ניהול מהפקדות': fee ? `${pc(fee.cand.pair.depfee)} (${A1_BASIS_HE[fee.cand.basis]})` : '', 'דמי ניהול מחיסכון מצטבר': fee ? `${pc(fee.cand.pair.fee)} (${A1_BASIS_HE[fee.cand.basis]})` : '',
    'רמת הסיכון של מסלול ההשקעה': c.st != null ? `חשיפה למניות ${Math.round(c.st)}%` : '', 'סכום צפוי (יתרת חסכון ואומדן קצבה צפויה)': fee ? `${ils(fee.balCand)} בגיל הפרישה${coef ? `; קצבה ${ils(coef.annC)} במקדם ${coef.cand.real ? 'התקנון' : 'ההנחה'}` : ''}` : '',
    'השיקולים העיקריים': '',
  };
  for (const k of A1_COLS) if (k !== 'המלצה' && k !== 'השיקולים העיקריים' && before[k] && before[k] === after[k]) after[k] = UNCHANGED;
  // red team 06.11.26: every projected or assumed figure carries its assumption (the document stamps it "הנחה")
  const EXP = 'סכום צפוי (יתרת חסכון ואומדן קצבה צפויה)' as const;
  const assume: AnnexPair['assume'] = { before: {}, after: {} };
  if (fee) {
    const basis = inp.basis ?? 'fox';
    const proj = `תחזית, לא נתון: ${basis === 'annexB' ? 'הנחות נספח ב\' (תשואה 4%, שכר ומדד 0%)' : `תשואה ${inp.ret ?? RET_FALLBACK}% ברוטו, הפקדה עולה ${GROWTH_DEFAULT}% בשנה, אינפלציה ${INFL_DEFAULT}%`}; גיל ${ageOk(inp.age) ?? '–'} עד ${inp.retire ?? RETIRE_AGE}; ${fee.exMonthly ? 'בלי הפקדות עתידיות (אין הפקדה בקובץ)' : 'ההפקדה מהקובץ'}${fee.exBalance ? '; אין יתרה בקובץ' : ''}`;
    assume.before[EXP] = proj; assume.after[EXP] = proj;
    if (fee.cand.basis === 'tender' || fee.cand.basis === 'avg') { assume.after['דמי ניהול מהפקדות'] = fee.cand.how; assume.after['דמי ניהול מחיסכון מצטבר'] = fee.cand.how; }
    if (fee.own.basis === 'avg') { assume.before['דמי ניהול מהפקדות'] = fee.own.how; assume.before['דמי ניהול מחיסכון מצטבר'] = fee.own.how; }
  }
  if (coef && !coef.cand.real) assume.after[EXP] = `${assume.after[EXP] ?? ''}${assume.after[EXP] ? '; ' : ''}מקדם הקצבה ${coef.cand.v}: ${coef.cand.why}`;
  return { before, after, assume };
}

/** one row: an existing product against one candidate (`i`: the product's index in the folder; `pair`: the agent's inputs for it) */
export function nyudRow(h: Held, track: Candidate | null, c: Candidate, candHeld: Held[], coefF: CoefFile | null | undefined, inp: NyudIn, asofText: string, i = 0, pair: { fee?: FeeOverride | null; cover?: number | null } = {}): NyudRow {
  const basis = inp.basis ?? 'fox';
  const f = feeDiff(h, track, c, { ...inp, basis }, pair.fee);
  const cf = coefDiff(h, c, f.d, coefF, { ...inp, basis });
  const cover = coverDiff(h, candHeld, pair.cover);
  const annex = annexPair(h, track, c, f.d, cf.d, asofText, { ...inp, basis });
  // red team 06.11.26: a managers' policy (or any product of another kind) whose insurance cost is in the file, against a proposed product
  // whose cost is unknown, is not comparable on fees alone (riders against a pension fund's built-in cover): the headline waits until
  // the agent fills the proposed product's cost. Pension against pension keeps its fee line (both covers priced by the bylaws).
  const hk = kindOf(h.typeHe), ck = kindOf(c.prod);
  const incomplete = f.d && cover.exist != null && cover.cand == null && (hk === 'managers' || hk !== ck)
    ? `לא בר השוואה עדיין: עלות הביטוח במוצר הקיים ${ils(cover.exist)} לחודש, ובמוצר המוצע לא ידועה (להשלים מהגוף המנהל). הפרש מדמי ניהול בלבד אינו מוצג`
    : null;
  if (incomplete) annex.after['סכום צפוי (יתרת חסכון ואומדן קצבה צפויה)'] = '';
  return { exist: h, existName: [h.typeHe, h.provider, h.track ?? h.plan].filter(Boolean).join(' · '), cand: c, fee: f.d, feeWhy: f.why, cover, coef: cf.d, coefWhy: cf.why,
    seniority: seniority(h, c), notes: notesOf(h, c), questions: questionsOf(h, c, cf.d), annex, basis, i, incomplete };
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
/** red team 06.11.26 · the product kind a pair stays within: pension ↔ pension, gemel ↔ gemel, השתלמות ↔ השתלמות, גמל להשקעה ↔ גמל
 *  להשקעה. A managers' policy is its own kind: never paired automatically; the agent may pair it by hand with an annuity product. */
export type Kind = 'pension' | 'gemel' | 'hish' | 'invest' | 'managers' | 'other';
export function kindOf(s: string): Kind {
  if (/השתלמות/.test(s)) return 'hish';
  if (/להשקעה|לילד/.test(s)) return 'invest';
  if (/ביטוח מנהלים|ביטוחי מנהלים|פוליס|ביטוח חיים/.test(s)) return 'managers';
  if (/פנסיה/.test(s)) return 'pension';
  if (/גמל/.test(s)) return 'gemel';
  return 'other';
}
export const KIND_HE: Record<Kind, string> = { pension: 'קרן פנסיה', gemel: 'קופת גמל', hish: 'קרן השתלמות', invest: 'גמל להשקעה', managers: 'ביטוח מנהלים', other: 'אחר' };
/** the candidate kinds an existing product may be paired with by hand: its own kind; a managers' policy also an annuity product */
export const pairKinds = (k: Kind): Kind[] => (k === 'other' ? [] : k === 'managers' ? ['managers', 'pension', 'gemel'] : [k]);
const CLOSED_RE = /נסגר|סגור/;

/** the agent's pairing inputs, keyed by the held product's index in the folder: the candidate picked ('-' = none), the confirmation
 *  that a guaranteed coefficient will be lost, the fee agreed with the client, the proposed product's cover cost a month */
export interface NyudPairs { pick?: Record<string, string>; ok?: Record<string, boolean>; fee?: Record<string, FeeOverride>; cover?: Record<string, number> }
/** one existing product's pairing state, for the wizard's per-product picker */
export interface PairSlot {
  i: number; h: Held; name: string; kind: Kind;
  /** the candidates it may be paired with */
  options: Candidate[];
  pick: string | null; auto: boolean;
  /** why it is not paired automatically (a managers' policy, a closed or unmatched track, a guaranteed coefficient) */
  block: string | null;
  /** a guaranteed coefficient: the pair is in the table only after the agent confirms */
  needOk: boolean; ok: boolean; included: boolean;
}
export const COEF_LOSS = (v: number) => `מקדם מובטח ${v} יאבד`;
export interface NyudTableOut { rows: NyudRow[]; exist: Held[]; cands: Candidate[]; basis: Basis; basisText: string; skipped: string[]; slots: PairSlot[] }
/** Each existing product (tagged "קיים": matched to such a track, or any held product with a balance when no track is tagged) is paired
 *  with at most ONE candidate ("מומלץ" first, then "נבחן"), product by product (red team 06.11.26: one pick used to pair every product):
 *  - the agent's pick for that product, when it is a candidate of an allowed kind (`pairKinds`); '-' = no transfer;
 *  - else, automatically, the first candidate of the SAME kind, except a managers' policy, a closed track or a product with no track in
 *    the data, and a product with a guaranteed coefficient (those wait for the agent's pick);
 *  - a product with a guaranteed coefficient enters the table only after the agent confirms "מקדם מובטח יאבד".
 *  `rows` holds the row data, `skipped` says what was left out and why, `slots` the per-product state. */
export function nyudTable(held: Held[], rows: Candidate[], tags: Record<string, string>, coefF: CoefFile | null | undefined, inp: NyudIn, asofText: string, pairs: NyudPairs = {}): NyudTableOut {
  const basis = inp.basis ?? 'fox';
  const existKeys = rows.filter((r) => tags[r.k] === 'קיים').map((r) => r.k);
  const cands = [...rows.filter((r) => tags[r.k] === 'מומלץ'), ...rows.filter((r) => tags[r.k] === 'נבחן')];
  const skipped: string[] = [];
  const exist = held.filter((h) => (h.k ? existKeys.includes(h.k) || !rows.some((r) => r.k === h.k) : true) && (h.balance != null || h.monthly != null));
  held.filter((h) => !exist.includes(h)).forEach((h) => skipped.push(`${h.typeHe}${h.provider ? ` · ${h.provider}` : ''}: ${h.k && !existKeys.includes(h.k) ? 'המסלול שלו מסומן במסמך כמוצע או נבחן, לא כקיים' : 'בלי יתרה ובלי הפקדה בקובץ'}`));
  const out: NyudRow[] = [], slots: PairSlot[] = [];
  held.forEach((h, i) => {
    if (!exist.includes(h)) return;
    const track = h.k ? rows.find((r) => r.k === h.k) ?? null : null;
    const name = [h.typeHe, h.provider].filter(Boolean).join(' · ');
    let kind = kindOf(h.typeHe);
    if (kind === 'other' && track) kind = kindOf(track.prod);
    const allowed = pairKinds(kind);
    const options = cands.filter((c) => c.k !== h.k && allowed.includes(kindOf(c.prod)));
    const coef = h.coefGuaranteed && h.coefGuaranteed.v > 0 ? h.coefGuaranteed.v : null;
    const want = pairs.pick?.[String(i)];
    let pick: string | null = null, auto = false, block: string | null = null;
    if (want === '-') pick = null;
    else if (want && options.some((c) => c.k === want)) pick = want;
    else {
      block = kind === 'other' ? 'אינו מוצר חיסכון שאפשר לנייד'
        : kind === 'managers' ? 'ביטוח מנהלים: לא מוצמד אוטומטית; בוחרים מוצר מוצע ידנית'
        : !h.k || CLOSED_RE.test(`${h.track ?? ''} ${h.plan ?? ''}`) ? 'מסלול סגור או בלי מסלול באתר: לא מוצמד אוטומטית'
        : coef ? `${COEF_LOSS(coef)}: בחירה ידנית ואישור`
        : null;
      const c = block ? null : options.find((x) => kindOf(x.prod) === kind) ?? null;
      if (c) { pick = c.k; auto = true; }
      else if (!block) block = cands.length ? `אין מסלול מוצע מאותו סוג (${KIND_HE[kind]})` : null;
    }
    const needOk = !!pick && coef != null;
    const ok = !!pairs.ok?.[String(i)];
    const included = !!pick && (!needOk || ok);
    slots.push({ i, h, name, kind, options, pick, auto, block, needOk, ok, included });
    if (included) {
      const c = cands.find((x) => x.k === pick)!;
      out.push(nyudRow(h, track, c, held.filter((x) => x.k === c.k), coefF, { ...inp, basis }, asofText, i, { fee: pairs.fee?.[String(i)] ?? null, cover: pairs.cover?.[String(i)] ?? null }));
    } else if (pick && needOk) skipped.push(`${name}: ${COEF_LOSS(coef!)}; נכלל בטבלה רק אחרי אישור בעל הרישיון`);
    else if (want === '-') skipped.push(`${name}: בעל הרישיון סימן "בלי ניוד"`);
    else if (cands.length && block) skipped.push(`${name}: ${block}`);
  });
  return { rows: out, exist, cands, basis, basisText: BASIS_TEXT[basis], skipped, slots };
}

/* ---------- the pairing inputs in a folder's fields (lib/clients `fields`, this browser only) ---------- */
export const PAIR_F = { pick: 'nyud:pair:', ok: 'nyud:coefok:', fee: 'nyud:fee:', cover: 'nyud:cov:' } as const;
const numIn = (s: string | undefined, max: number) => { const v = s != null && s.trim() !== '' ? Number(s) : NaN; return Number.isFinite(v) && v >= 0 && v <= max ? v : null; };
/** a folder's fields → the pairing inputs */
export function pairsOf(fields: Record<string, string> | null | undefined): NyudPairs {
  const out: Required<NyudPairs> = { pick: {}, ok: {}, fee: {}, cover: {} };
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (k.startsWith(PAIR_F.pick) && /^(-|[gip]\d+)$/.test(v)) out.pick[k.slice(PAIR_F.pick.length)] = v;
    else if (k.startsWith(PAIR_F.ok) && v === '1') out.ok[k.slice(PAIR_F.ok.length)] = true;
    else if (k.startsWith(PAIR_F.fee)) { const [d, a, src] = v.split('/'); const dep = numIn(d, 10), acc = numIn(a, 5); if (dep != null && acc != null) out.fee[k.slice(PAIR_F.fee.length)] = { depfee: dep, fee: acc, src: src === 'tender' ? 'tender' : 'agreed' }; }
    else if (k.startsWith(PAIR_F.cover)) { const c = numIn(v, 100000); if (c != null) out.cover[k.slice(PAIR_F.cover.length)] = c; }
  }
  return out;
}
/** the pairing inputs → fields (the old pairing fields of `base` are dropped first) */
export function pairsToFields(base: Record<string, string>, p: NyudPairs): Record<string, string> {
  const out: Record<string, string> = Object.fromEntries(Object.entries(base).filter(([k]) => !Object.values(PAIR_F).some((pre) => k.startsWith(pre))));
  for (const [i, v] of Object.entries(p.pick ?? {})) if (v) out[PAIR_F.pick + i] = v;
  for (const [i, v] of Object.entries(p.ok ?? {})) if (v) out[PAIR_F.ok + i] = '1';
  for (const [i, v] of Object.entries(p.fee ?? {})) out[PAIR_F.fee + i] = `${v.depfee}/${v.fee}/${v.src}`;
  for (const [i, v] of Object.entries(p.cover ?? {})) out[PAIR_F.cover + i] = String(v);
  return out;
}
/** the fee agreed for a candidate in any of its pairs (the document's part א.1 block of the recommended product shows it) */
export const agreedFor = (p: NyudPairs, k: string): FeeOverride | null => {
  for (const [i, c] of Object.entries(p.pick ?? {})) if (c === k && p.fee?.[i]) return p.fee[i];
  return null;
};

/** the full-cost line of §5א(2)(י): management fees a year, existing against recommended, ₪ (pairs not yet comparable left out) */
export function fullCost(rows: NyudRow[]): { own: number; cand: number; n: number; left: number } | null {
  const have = rows.filter((r) => r.fee && !r.incomplete);
  if (!have.length) return null;
  return { own: have.reduce((t, r) => t + r.fee!.annualOwn, 0), cand: have.reduce((t, r) => t + r.fee!.annualCand, 0), n: have.length, left: rows.filter((r) => r.fee && r.incomplete).length };
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
