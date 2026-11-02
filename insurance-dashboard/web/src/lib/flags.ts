import type { FundX } from './funds';
import { nf, sn } from './format';
import type { Prov } from './prov';

/* W6 trust flags, built in pipeline/build_funds.py (funds_lib.migration, funds_lib.exposure_checks) and read here as published:
   mig  intra-group migration: the track's 12-month net accrual points against its management group's total for the same product
   chk  an exposure share the regulator published outside the plausible range (above EXP_HI or below EXP_LO percent of assets) */

export const MIG_HE = 'נדידה בתוך הקבוצה';
export const MIG_WHY = 'הצבירה נטו של המסלול ב-12 החודשים שלילית בעוד סך הצבירה של מסלולי הקבוצה באותו מוצר חיובי (או להפך): הכסף עבר בין מסלולי הקבוצה, לא יצא ממנה';
export const EXP_HI = 120, EXP_LO = -20;
export const CHECK_HE = 'לבדיקה מול המנהל';
export const CHECK_WHY = `חשיפה מעל ${EXP_HI}% או מתחת ל-${EXP_LO}% מהנכסים, כפי שפורסמה ברשות; לא נכללת בפיזור הקטגוריה ובממוצעים`;
export const EXP_LABEL: Record<'st' | 'fo' | 'fx', string> = { st: 'מניות', fo: 'חו"ל', fx: 'מט"ח' };

/** the migration flag of a track row, when the build set one */
export const migOf = (f: Pick<FundX, 'mig'>): { grp: number; n: number } | null => f.mig ?? null;
/** an exposure share that cannot be read at face value (the same bounds as the pipeline) */
export const implausible = (pct: number | null | undefined): boolean => pct != null && (pct > EXP_HI || pct < EXP_LO);
/** the exposure keys of a row that are out of range: the build's `chk`, or the same rule on the row's own shares */
export const checksOf = (f: { chk?: ('st' | 'fo' | 'fx')[] | null; st?: number | null; fo?: number | null; fx?: number | null; stock?: number | null; foreign?: number | null }): ('st' | 'fo' | 'fx')[] =>
  f.chk ?? (['st', 'fo', 'fx'] as const).filter((k) => implausible(k === 'st' ? f.st ?? f.stock : k === 'fo' ? f.fo ?? f.foreign : f.fx));

/** the flag as a sourced figure: the track's flow against the group's total, each with its own source */
export function migProv(f: FundX & { mig: { grp: number; n: number } }, flowSrc?: () => Prov): Prov {
  return { k: 'calc', title: `${MIG_HE} · ${f.name}`, value: `${sn(f.nd12 ?? 0, 0)} מול ${sn(f.mig.grp, 0)}`, unit: 'מיליוני ש"ח',
    formula: 'צבירה נטו LTM של המסלול (NET_MONTHLY_DEPOSITS, 12 חודשים) מול סך הצבירה נטו LTM של מסלולי הקבוצה באותו מוצר. מסומן כשהסימנים הפוכים והמסלול מעל 250 מיליון ש"ח ו-1% מנכסיו',
    inputs: [{ label: `צבירה נטו LTM · ${f.name}`, v: nf(f.nd12 ?? 0, 0), src: flowSrc },
      { label: `סך הצבירה נטו LTM · ${f.grp} · ${f.prod} (${nf(f.mig.n, 0)} מסלולים)`, v: nf(f.mig.grp, 0) }],
    note: MIG_WHY };
}
