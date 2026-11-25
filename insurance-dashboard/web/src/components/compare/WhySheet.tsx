/* "איך מחשבים?" (spec §4.9, §6.3, 10A.3 D6; mockup v3 frame "why"): the stamp's and the fee sheet's link. In the saver door it holds the
   net / gross switch in plain words, "אחרי דמי ניהול / לפני דמי ניהול" (the saver has no basis control above the fold); then six plain
   bullets: net is an estimate, "כמעט שווים" (the tie bands of lib/fundsTie), like with like, fees in shekels (the example of lib/retire),
   past is not future, the source and its month. Pro adds the survivorship line (the category average is each month's membership). */
import type { SheetProps } from '../../pages/compare/contract';
import { DeeperSheet } from '../DeeperSheet';
import { useBasis } from '../../lib/funds';
import { TIE_BP, TIE_M1 } from '../../lib/fundsTie';
import { BALANCE_EX, SALARY_EX, exampleMonthly } from '../../lib/retire';
import { monthLabel, nf } from '../../lib/format';
import { useFunds } from '../../lib/useData';
import { Facts } from './sheetKit';

/** the basis switch: plain words for the saver ("אחרי דמי ניהול / לפני דמי ניהול"), "נטו / ברוטו" for agent and Pro */
export function BasisSwitch({ plain = true }: { plain?: boolean }) {
  const [basis, setBasis] = useBasis();
  return (
    <div className="cs-seg" role="group" aria-label={plain ? 'מה מוצג' : 'נטו או ברוטו'} id="basis-switch">
      <button type="button" className={basis === 'net' ? 'on' : ''} aria-pressed={basis === 'net'} onClick={() => setBasis('net')}>{plain ? 'אחרי דמי ניהול' : 'נטו'}</button>
      <button type="button" className={basis === 'gross' ? 'on' : ''} aria-pressed={basis === 'gross'} onClick={() => setBasis('gross')}>{plain ? 'לפני דמי ניהול' : 'ברוטו'}</button>
    </div>
  );
}

const ils = (v: number) => v.toLocaleString('en-US');

export function WhySheet({ door, open, onClose }: SheetProps) {
  const file = useFunds(open).data;
  const pen = exampleMonthly('פנסיה מקיפה').v, hish = exampleMonthly('השתלמות').v;
  return (
    <DeeperSheet open={open} onClose={onClose} id="why-sheet-dlg" title="איך מחשבים?">
      <div id="why-sheet">
        {door === 'saver' ? <div className="cs-fld"><b>מה מוצג</b><BasisSwitch /></div> : null}
        <Facts items={[
          <><b>אחרי דמי ניהול.</b> התשואה שרשות שוק ההון מפרסמת, פחות דמי הניהול הממוצעים במסלול. זה אומדן: דמי הניהול שלך יכולים להיות אחרים.</>,
          <><b>כמעט שווים.</b> הבדל קטן מאוד (פחות מ-<bdi dir="ltr">{nf(TIE_BP / 100, 1)}%</bdi> בשנה, או <bdi dir="ltr">{nf(TIE_M1, 2)}%</bdi> בחודש) לא נחשב הבדל, ואז לא קובעים מי ראשון.</>,
          <><b>משווים דומה לדומה.</b> ״ראשון״ ו״הגבוה״ נאמרים רק בין מסלולים מאותו סוג. כשהסוגים שונים, המספרים מוצגים זה לצד זה בלי דירוג.</>,
          <><b>דמי ניהול בשקלים.</b> דמי הניהול מהחיסכון כפול <bdi dir="ltr">{ils(BALANCE_EX)}</bdi> ש״ח, ועוד דמי הניהול מהפקדה כפול 12 הפקדות חודשיות (פנסיה: שכר <bdi dir="ltr">{ils(SALARY_EX)}</bdi> ש״ח × <bdi dir="ltr">18.5%</bdi> = <bdi dir="ltr">{ils(pen)}</bdi> ש״ח; השתלמות: × <bdi dir="ltr">10%</bdi> = <bdi dir="ltr">{ils(hish)}</bdi> ש״ח; גמל להשקעה: בלי הפקדות). שנה אחת, מעוגל לעשרות.</>,
          <><b>עבר אינו עתיד.</b> חודש אחד לא אומר הרבה; 3 ו-5 שנים אומרות יותר.</>,
          door === 'pro' ? <><b>מסלולים שנסגרו.</b> ממוצע הסוג בכל חודש כולל את המסלולים שהיו בסוג באותו חודש, גם אם נסגרו מאז, כך שהממוצע לא מוטה לטובת מי ששרד.</> : null,
          <><b>מקור.</b> {(file?.source ?? 'רשות שוק ההון').replace(/\s*\([^)]*[A-Za-z][^)]*\)/g, '')}{file?.asof ? <>, עד <bdi dir="ltr">{monthLabel(file.asof)}</bdi></> : null}. הקשה על כל מספר פותחת את המקור שלו.</>,
        ]} />
      </div>
    </DeeperSheet>
  );
}
