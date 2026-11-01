/* The saver's fee-negotiation message (W1 saver door): a short, factual Hebrew note to the agent or the managing company, built only
   from the reader's numbers and the regulator's. It states figures and asks for an updated offer; it recommends nothing. Pure. */
import { pcf, type Verdict } from './verdict';

export interface ScriptIn {
  name: string; id?: number | null; prod: string; track: string;
  /** the data set and month the medians come from ("פנסיה-נט, 09/26") */
  src: string;
  v: Pick<Verdict, 'fee' | 'dep' | 'dflt'>;
}
const DS: Record<string, string> = { gemel: 'גמל-נט', pensia: 'פנסיה-נט', insurance: 'ביטוח-נט' };
export const dsName = (fam: string | undefined) => DS[fam ?? ''] ?? 'גמל-נט, פנסיה-נט, ביטוח-נט';

/** The message, line by line. Without the reader's own fees it quotes the track's average and asks what they actually pay. */
export function scriptOf(s: ScriptIn): string {
  const { fee, dep, dflt } = s.v;
  const out: string[] = ['שלום,'];
  out.push(`אני חוסך/ת ב${s.name}${s.id ? ` (מספר קופה ${s.id})` : ''}.`);
  const myDep = dep?.own && dep.v != null ? ` ו-${pcf(dep.v)} מההפקדות` : '';
  if (fee.own && fee.v != null) out.push(`לפי הדוח שלי אני משלם/ת ${pcf(fee.v)} דמי ניהול מהצבירה${myDep}.`);
  else if (dep?.own && dep.v != null) out.push(`לפי הדוח שלי אני משלם/ת ${pcf(dep.v)} דמי ניהול מההפקדות.`);
  else out.push(`לפי נתוני הרשות, דמי הניהול הממוצעים במסלול הם ${pcf(fee.v)} מהצבירה${dep?.v != null ? ` ו-${pcf(dep.v)} מההפקדה` : ''}. אשמח לדעת כמה אני משלם/ת בפועל.`);
  if (fee.med != null) out.push(`החציון בקטגוריה (${s.prod}, ${s.track}) הוא ${pcf(fee.med)} מהצבירה${dep?.med != null ? ` ו-${pcf(dep.med)} מההפקדה` : ''}, לפי נתוני רשות שוק ההון (${s.src}).`);
  if (dflt && dflt.fee != null && dflt.depfee != null) out.push(`בקרנות ברירת המחדל שבחרה הרשות (${dflt.tender.label ?? dflt.tender.id}) דמי הניהול למצטרפים דרך ברירת המחדל מוגבלים ל-${pcf(dflt.depfee)} מההפקדה ו-${pcf(dflt.fee)} מהצבירה.`);
  out.push('אשמח לקבל הצעה מעודכנת לדמי הניהול שלי.', 'תודה,');
  return out.join('\n');
}
