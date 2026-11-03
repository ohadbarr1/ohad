import { Sourced } from '../Source';
import { useFunds } from '../../lib/useData';
import type { FundsFile } from '../../lib/funds';
import type { NyudRow } from '../../lib/nyud';
import { useOptional } from '../../lib/fundsLoad';
import { DECISION_PATH, type DecisionFile } from '../../lib/decision';
import { COVERS_PATH, effProv, effRows, rawProv, type CSex, type CoversFile, type EffRow } from '../../lib/coverPrice';
import '../../styles/agent-book.css';

/* W11 · on the ניוד table: when both sides of a pair are comprehensive pension funds whose bylaws tables were read, the bylaws price of
   the disability and survivors cover and the claims-adjusted price (lib/coverPrice) of the two funds side by side, for the standard
   member at 40. A description of the two funds' published tables and claims reports; not a comparison of the client's own cover. */

const PROD = 'פנסיה מקיפה';
const AGE = 40;
const n2 = (v: number | null | undefined) => (v == null ? '–' : `₪${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function NyudCover({ rows }: { rows: NyudRow[] }) {
  const cov = useOptional<CoversFile>(COVERS_PATH);
  const dec = useOptional<DecisionFile>(DECISION_PATH);
  const data = useFunds().data as FundsFile | undefined;
  if (!cov || !data) return null;
  const byK = new Map(data.funds.map((f) => [f.k, f]));
  const has = (g: string) => Object.values(cov.funds).some((f) => f.grp === g);
  const pairs = new Map<string, [string, string]>();
  for (const r of rows) {
    const ex = r.exist.k ? byK.get(r.exist.k) : undefined;
    if (!ex || ex.prod !== PROD || r.cand.prod !== PROD || !has(ex.grp) || !has(r.cand.grp) || ex.grp === r.cand.grp) continue;
    pairs.set(`${ex.grp}|${r.cand.grp}`, [ex.grp, r.cand.grp]);
  }
  if (!pairs.size) return null;
  const at = (sex: CSex) => new Map(effRows(cov, dec, sex, AGE).map((r) => [r.grp, r]));
  const m = at('m'), f = at('f');
  const cell = (r: EffRow | undefined, eff: boolean) => {
    if (!r) return '–';
    if (!eff) return r.raw != null && r.cell ? <Sourced src={() => rawProv(cov, r.fund, r.cell!)}>{n2(r.raw)}</Sourced> : '–';
    return r.eff != null && dec ? <Sourced src={() => effProv(cov, dec, r)}>{n2(r.eff)}</Sourced> : <span className="q">{r.raw != null ? r.why : '–'}</span>;
  };
  return (
    <div className="nyud-cover">
      <h3>מחיר הכיסוי לנכות ולשאירים לפי התקנונים, ולפי דוחות התביעות</h3>
      <p className="adoc-cap">₪ לחודש לכל ₪1,000 שכר מבוטח, למבוטח סטנדרטי בן {AGE} במסלול ברירת המחדל, בלי יתרה צבורה, מטבלאות התקנון של כל קרן. "אפקטיבי": כל חלק מחולק בשיעור התביעות שאושרו (נספח ב3 של החברה, 2025); מהירות הטיפול מוצגת בטבלת מחיר הכיסוי ואינה בחישוב. תיאור של הנתונים שפורסמו, לא של הכיסוי של הלקוח ולא המלצה.</p>
      <table className="adoc-t">
        <thead><tr><th scope="col">קיים ← מוצע</th><th scope="col">לפי התקנון, גבר</th><th scope="col">לפי התקנון, אישה</th><th scope="col">אפקטיבי, גבר</th><th scope="col">אפקטיבי, אישה</th></tr></thead>
        <tbody>{[...pairs.values()].map(([a, b]) => <tr key={`${a}|${b}`}>
          <th scope="row"><b>{a}</b><span>← {b}</span></th>
          <td>{cell(m.get(a), false)} ← {cell(m.get(b), false)}</td>
          <td>{cell(f.get(a), false)} ← {cell(f.get(b), false)}</td>
          <td>{cell(m.get(a), true)} ← {cell(m.get(b), true)}</td>
          <td>{cell(f.get(a), true)} ← {cell(f.get(b), true)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}
