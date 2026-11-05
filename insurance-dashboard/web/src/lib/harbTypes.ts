/* fox 3.0 A6 · the risk-side record a הר הביטוח policy carries inside a client folder (lib/clients Held.risk). Kept apart from lib/harb
   so lib/clients can normalise it without pulling the file reader (and its zip reader) into every bundle. Pure.

   Every field is what the CMA's reporting file defines per policy (חוזר ביטוח 2016-1-17 "ממשק אינטרנטי לאיתור מוצרי ביטוח" as
   amended by חוזר 2022-1-15, §3(א); docs/harb-format.md). Nothing here identifies a person: no ID number, no name, no full policy
   number. `pol` is the policy number's last four characters, for telling two policies apart with the insurer; `who` is an ordinal
   (insured 1, 2, …) made in the browser from the file's insured column when it has one, never the column itself. */

/** the canonical cover a policy is for, from its secondary branch (ענף משני), main branch or product name (lib/harb catOf) */
export type RiskCat =
  | 'surg1' | 'surgShaban' | 'surgAbroad' | 'transplant' | 'drugs' | 'ambul' | 'dental' | 'healthOther'
  | 'ltc' | 'ci' | 'pa' | 'di' | 'life' | 'lifeSave'
  | 'travel' | 'car' | 'carMand' | 'home' | 'foreign' | 'other';

export interface RiskMeta {
  src: 'harb';
  /** the cover(s) the policy is for: one when the file names the secondary branch, more when only a product name such as
   *  "ניתוחים, השתלות ותרופות" says it */
  cats: RiskCat[];
  /** ענף ראשי / ענף משני / תחום as the file says them (a code is turned into its name from the circular's table) */
  main: string | null; sub: string | null; domain: string | null;
  /** סוג מוצר: ביטוח יסודי, נספח/הרחבה, כתב שירות, תנאים כללים */
  ptype: string | null;
  /** סיווג: true = קבוצתי, false = אישי, null = not in the file */
  group: boolean | null;
  /** the premium as the file gives it, and what period it is for ('month' | 'year' | null = the file does not say) */
  premium: number | null; per: 'month' | 'year' | null;
  start: string | null; end: string | null;
  pol: string | null;
  who: number | null;
}

export const RISK_CATS: RiskCat[] = ['surg1', 'surgShaban', 'surgAbroad', 'transplant', 'drugs', 'ambul', 'dental', 'healthOther', 'ltc', 'ci', 'pa', 'di', 'life', 'lifeSave', 'travel', 'car', 'carMand', 'home', 'foreign', 'other'];
const iso = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
const s = (x: unknown, max: number) => (typeof x === 'string' && x.trim() && !/\d{8,}/.test(x) ? x.slice(0, max) : null);
const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** a stored risk record made safe, or null (anything ID-shaped is dropped, as in lib/clients normHeld) */
export function normRisk(x: unknown): RiskMeta | null {
  const o = x as Record<string, unknown>;
  if (!o || typeof o !== 'object' || o.src !== 'harb') return null;
  const cats = Array.isArray(o.cats) ? [...new Set(o.cats.filter((c): c is RiskCat => RISK_CATS.includes(c as RiskCat)))].slice(0, 8) : [];
  const pol = typeof o.pol === 'string' && /^…?[\w/-]{1,4}$/.test(o.pol) ? o.pol : null;
  const who = n(o.who);
  return {
    src: 'harb', cats: cats.length ? cats : ['other'], main: s(o.main, 80), sub: s(o.sub, 80), domain: s(o.domain, 60), ptype: s(o.ptype, 40),
    group: typeof o.group === 'boolean' ? o.group : null, premium: n(o.premium), per: o.per === 'month' || o.per === 'year' ? o.per : null,
    start: iso(o.start), end: iso(o.end), pol, who: who != null && Number.isInteger(who) && who > 0 && who < 50 ? who : null,
  };
}
