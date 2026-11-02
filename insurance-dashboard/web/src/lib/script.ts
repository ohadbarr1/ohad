/* The saver's fee-negotiation message (W1 saver door): a short, factual Hebrew note to the agent or the managing company, built only
   from the reader's numbers and the regulator's. It states figures and asks for an updated offer; it recommends nothing. Pure. */
import { pcf, type Verdict } from './verdict';

export interface ScriptIn {
  name: string; id?: number | null; prod: string; track: string;
  /** the data set and month the medians come from ("פנסיה-נט, 09/26") */
  src: string;
  v: Pick<Verdict, 'fee' | 'dep' | 'dflt'>;
  /** W5: the reader's sex when chosen on /my: the note is gendered; "חוסך/ת" only when it is not known */
  sex?: 'm' | 'f' | null;
  /** W7 (household profiles): the note is about another saver in the household ("החוסך/ת"), not the person writing; no name is stored */
  third?: boolean;
}
const DS: Record<string, string> = { gemel: 'גמל-נט', pensia: 'פנסיה-נט', insurance: 'ביטוח-נט' };
export const dsName = (fam: string | undefined) => DS[fam ?? ''] ?? 'גמל-נט, פנסיה-נט, ביטוח-נט';

/** The message, line by line. Without the reader's own fees it quotes the track's average and asks what they actually pay. */
export function scriptOf(s: ScriptIn): string {
  const { fee, dep, dflt } = s.v;
  const g = (fm: string, m: string, n: string) => (s.sex === 'f' ? fm : s.sex === 'm' ? m : n);
  const pay = s.third ? 'משלם/ת' : g('משלמת', 'משלם', 'משלם/ת');
  // W7: a note about another saver in the household names them only as "החוסך/ת"
  const me = s.third ? 'החוסך/ת' : 'אני', mine = s.third ? 'של החוסך/ת' : 'שלי';
  const out: string[] = ['שלום,'];
  out.push(s.third ? `פנייה בעניין החוסך/ת ב${s.name}${s.id ? ` (מספר קופה ${s.id})` : ''}.` : `אני ${g('חוסכת', 'חוסך', 'חוסך/ת')} ב${s.name}${s.id ? ` (מספר קופה ${s.id})` : ''}.`);
  const myDep = dep?.own && dep.v != null ? ` ו-${pcf(dep.v)} מההפקדות` : '';
  if (fee.own && fee.v != null) out.push(`לפי הדוח ${mine} ${me} ${pay} ${pcf(fee.v)} דמי ניהול מהצבירה${myDep}.`);
  else if (dep?.own && dep.v != null) out.push(`לפי הדוח ${mine} ${me} ${pay} ${pcf(dep.v)} דמי ניהול מההפקדות.`);
  else out.push(`לפי נתוני הרשות, דמי הניהול הממוצעים במסלול הם ${pcf(fee.v)} מהצבירה${dep?.v != null ? ` ו-${pcf(dep.v)} מההפקדה` : ''}. אשמח לדעת כמה ${me} ${pay} בפועל.`);
  if (fee.med != null) out.push(`חציון דמי הניהול הממוצעים בפועל בקטגוריה (${s.prod}, ${s.track}) הוא ${pcf(fee.med)} מהצבירה${dep?.med != null ? ` ו-${pcf(dep.med)} מההפקדה` : ''}, לפי נתוני רשות שוק ההון (${s.src}).`);
  if (dflt && dflt.fee != null && dflt.depfee != null) out.push(`בקרנות ברירת המחדל שבחרה הרשות (${dflt.tender.label ?? dflt.tender.id}) דמי הניהול למצטרפים דרך ברירת המחדל מוגבלים ל-${pcf(dflt.depfee)} מההפקדה ו-${pcf(dflt.fee)} מהצבירה.`);
  // W5: the part of my own fees that is above those terms, named once
  if (dflt && dflt.fee != null && dflt.depfee != null) {
    const up = [dep?.own && dep.v != null && dep.v > dflt.depfee + 0.005 ? `מההפקדה (${pcf(dep.v)} לעומת ${pcf(dflt.depfee)})` : null, fee.own && fee.v != null && fee.v > dflt.fee + 0.005 ? `מהצבירה (${pcf(fee.v)} לעומת ${pcf(dflt.fee)})` : null].filter(Boolean);
    if (up.length) out.push(`דמי הניהול ${mine} גבוהים מהתנאים האלה ${up.join(' ו')}.`);
  }
  out.push(`אשמח לקבל הצעה מעודכנת לדמי הניהול ${mine}.`, 'תודה,');
  return out.join('\n');
}
