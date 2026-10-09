import { Link } from 'react-router-dom';
import { Panel } from '../components/ui';
import { useMarket, useRegistry } from '../lib/useData';
import { useEffect, useState } from 'react';
import type { CompanyData } from '../lib/types';

const DATES = ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'];
const LABEL: Record<string, string> = { '2025-03-31': "Q1'25", '2025-06-30': "Q2/H1'25", '2025-09-30': "Q3'25", '2025-12-31': "FY'25", '2026-03-31': "Q1'26", '2026-06-30': "Q2/H1'26" };

export function Coverage() {
  const reg = useRegistry();
  const { market: m } = useMarket();
  const [facts, setFacts] = useState<Record<string, CompanyData>>({});
  useEffect(() => {
    reg.data?.filter((c) => c.has_financials).forEach((c) => {
      fetch(`${import.meta.env.BASE_URL}data/companies/${c.id}.json`).then((r) => r.json()).then((d: CompanyData) => setFacts((f) => ({ ...f, [c.id]: d })));
    });
  }, [reg.data]);

  const status = (id: string, end: string, primary: string | undefined): 'filing' | 'comparative' | 'pending' => {
    const d = facts[id];
    if (!d) return 'pending';
    if (primary === end) return 'filing';
    return d.periods.some((p) => p.end === end) ? 'comparative' : 'pending';
  };
  return (
    <>
      <div className="pagehead"><div><h1>כיסוי נתונים</h1><div className="sub">מה נקלט, מה מגיע כנתוני השוואה בלבד, ומה עדיין חסר</div></div></div>
      <Panel title="נתוני שוק (הרשות לשוק ההון)">
        {m ? (
          <div className="scroll"><table>
            <thead><tr><th>מאגר</th><th>טווח</th><th>תדירות</th><th>סטטוס</th></tr></thead>
            <tbody>
              {['גמל-נט', 'פנסיה-נט', 'ביטוח-נט'].map((n) => <tr key={n}><td>{n}</td><td>2012 עד {m.plabel(m.LAST)} (המאגר המלא מ-1999)</td><td>חודשית</td><td><span className="chip loaded">מעודכן</span></td></tr>)}
            </tbody>
          </table></div>
        ) : <span className="muted">טוען…</span>}
      </Panel>
      <Panel title="דוחות כספיים של חברות" aside={<span>דוח ראשי = הדוח שנקלט. נתוני השוואה = תקופה שמופיעה כעמודת השוואה בדוח אחר.</span>}>
        <div className="scroll"><table>
          <thead><tr><th>חברה</th>{DATES.map((d) => <th key={d}>{LABEL[d]}</th>)}</tr></thead>
          <tbody>{reg.data?.filter((c) => c.kind === 'insurance_group').map((c) => (
            <tr key={c.id}>
              <td><Link to={`/company/${c.id}`}>{c.name_he}</Link></td>
              {DATES.map((d) => { const s = status(c.id, d, c.filings[0]?.end); return <td key={d}><span className={`chip ${s === 'filing' ? 'loaded' : s === 'comparative' ? 'partial' : 'pending'}`}>{s === 'filing' ? 'נקלט' : s === 'comparative' ? 'השוואה' : 'חסר'}</span></td>; })}
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <Panel title="איך מוסיפים דוח">
        <div className="prose"><ul>
          <li>מניחים את קובץ ה-PDF (או חוברת החילוץ שנוצרה ממנו) בתיקייה <span className="mono">insurance-dashboard/data/sources/</span>.</li>
          <li>מריצים <span className="mono">pipeline/extract_company_workbook.py</span> ואחריו <span className="mono">pipeline/build_company_index.py</span>. כל נתון נכנס עם עמוד המקור.</li>
          <li>בדיקות ההתאמה (סכומי ביניים, מאזן, גשרים) רצות לפני פרסום. חריגות מוצגות בלשונית המתודולוגיה.</li>
          <li>גשר CSM, כושר פירעון ומדדי עסק חדש נמצאים בדוח הדירקטוריון ובמצגת המשקיעים, ויש לקלוט אותם כמסמכים נפרדים.</li>
        </ul></div>
      </Panel>
    </>
  );
}
