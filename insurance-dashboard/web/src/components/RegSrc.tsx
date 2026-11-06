import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ckanDataset } from '../lib/sources';

const DS: [string, string][] = [['gemelnet', 'גמל-נט'], ['pensia-net', 'פנסיה-נט'], ['insurance', 'ביטוח-נט']];

/** The human source line of a page built on the regulator's fund files: the three open datasets on data.gov.il (the links /methodology
 *  uses), fox's own processing, and the fox table the figures can be checked in. `ds` limits the datasets (the flows letter: no ביטוח-נט). */
export function RegSrc({ table, ds, children }: { table?: [string, string]; ds?: string[]; children?: ReactNode }) {
  const list = DS.filter(([k]) => !ds || ds.includes(k));
  return (
    <>מקור: רשות שוק ההון, ביטוח וחיסכון, הקבצים הפתוחים ב-data.gov.il:{' '}
      {list.map(([k, he], i) => <span key={k}>{i ? ', ' : ''}<a className="sv-u" href={ckanDataset(k)} target="_blank" rel="noopener noreferrer">{he}</a></span>)}; עיבוד fox
      {table ? <> · הנתונים בטבלה: <Link className="sv-u" to={table[0]}>{table[1]}</Link></> : null} · <Link className="sv-u" to="/methodology#sources">מתודולוגיה</Link>{children}</>
  );
}
