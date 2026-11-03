import { Link } from 'react-router-dom';
import { IndustryTools } from './Industry';
import { Sourced } from '../components/Source';
import { Empty, ErrorBox, Field, Loading, Panel } from '../components/ui';
import { fmt } from '../lib/drivers';
import { idCss } from '../lib/identity';
import { useLoad } from '../lib/useData';
import { PNC_PATH, R_HE, pct, ratioProv, rrProv, type PncFile, type RatioKey } from '../lib/pnc';
import { useParam } from './csm/params';
import '../styles/pnc.css';

/* W10 · /industry/pnc: P&C loss, expense and combined ratios by line of business, gross and net of reinsurance, every insurer, from the
   IFRS 17 general-insurance note (one quarterly report per insurer). Each ratio opens its formula and the printed lines behind it. */

const RK: RatioKey[] = ['lr', 'er', 'cr', 'crn', 'ces'];
const PERIODS = ['ltm', 'q226', 'q126', 'q225', 'q125', 'h126', 'h125', 'fy25'] as const;
type Pk = (typeof PERIODS)[number];
const LINE_KEYS = ['pc', 'pc:רכב חובה', 'pc:רכב רכוש', 'pc:אחר'] as const;
type Lk = (typeof LINE_KEYS)[number];
const SORTS = ['cr', 'crn', 'lr', 'er', 'ces', 'rev'] as const;
type Sk = (typeof SORTS)[number];
const amt = (v: number | null | undefined) => (v == null ? '–' : `⁦${fmt(v, 0)}⁩`);

export function IndustryPnc() {
  const { data: F, error } = useLoad<PncFile>(PNC_PATH);
  const [pk, setPk] = useParam<Pk>('p', 'ltm', PERIODS);
  const [ln, setLn] = useParam<Lk>('line', 'pc', LINE_KEYS);
  const [sk, setSk] = useParam<Sk>('sort', 'cr', SORTS);
  if (error) return <ErrorBox what="יחסי ביטוח כללי" error={error} />;
  if (!F) return <Loading what="יחסי ביטוח כללי" />;
  const lineHe = F.meta.lines.find((l) => l[0] === ln)![1];
  const ph = F.meta.periods.find((p) => p[0] === pk)![1];
  const rows = Object.entries(F.cos).map(([id, c]) => ({ id, c, P: c.lines[ln]?.per[pk] })).filter((r) => r.P);
  const key = (r: (typeof rows)[number]) => (sk === 'rev' ? -(r.P!.x.rev ?? 0) : r.P!.r[sk] ?? Infinity);
  rows.sort((a, b) => key(a) - key(b) || a.c.name.localeCompare(b.c.name, 'he'));
  if (!rows.length) return <Empty title="אין נתונים לענף ולתקופה שנבחרו" />;
  const tot = rows.reduce((t, r) => ({ rev: t.rev + (r.P!.x.rev ?? 0), ise: t.ise + (r.P!.x.ise ?? 0) }), { rev: 0, ise: 0 });
  const vint = [...new Set(Object.values(F.reports).map((r) => r.period))];

  return (
    <div className="pnc">
      <IndustryTools>
        <div className="pnc-ctl">
          <Field label="ענף"><select aria-label="ענף" value={ln} onChange={(e) => setLn(e.target.value as Lk)}>{F.meta.lines.map(([k, he]) => <option key={k} value={k}>{he}</option>)}</select></Field>
          <Field label="תקופה"><select aria-label="תקופה" value={pk} onChange={(e) => setPk(e.target.value as Pk)}>{PERIODS.map((p) => <option key={p} value={p}>{F.meta.periods.find((x) => x[0] === p)![1]}</option>)}</select></Field>
        </div>
      </IndustryTools>
      <Panel title={<>ביטוח כללי: יחסי נזק, הוצאות ומשולב · {lineHe} · <span className="num">{ph}</span></>}
        aside={<span>{rows.length} מבטחות · דוח <span className="num">{vint.map((v) => v.replace(/^20(\d\d)(Q\d)$/, "$2'$1")).join(', ')}</span> · משוקלל ענפי: משולב ברוטו <span className="num">{pct(tot.rev ? tot.ise / tot.rev : null)}</span></span>}>
        <div className="scroll"><table className="pnc-t">
          <thead><tr>
            <th scope="col">מבטחת</th>
            <th scope="col" aria-sort={sk === 'rev' ? 'descending' : 'none'}><button type="button" className="thsel" onClick={() => setSk('rev')}>הכנסות משירותי ביטוח</button></th>
            {RK.map((k) => <th key={k} scope="col" aria-sort={sk === k ? 'ascending' : 'none'}><button type="button" className="thsel" title={F.meta.defs[k]} onClick={() => setSk(k)}>{R_HE[k]}</button></th>)}
            <th scope="col">תוצאת ביטוח משנה</th>
            <th scope="col">רווח משירותי ביטוח</th>
          </tr></thead>
          <tbody>{rows.map(({ id, c, P }) => (
            <tr key={id}>
              <th scope="row" className="who"><i className="pnc-dot" style={{ background: idCss(id) }} aria-hidden="true" /><Link to={`/company/${id}`}>{c.name}</Link></th>
              <td><span className="v num">{amt(P!.x.rev)}</span></td>
              {RK.map((k) => <td key={k} className={k === 'cr' ? 'lead' : ''}>{P!.r[k] == null ? <span className="na">לא מדווח בפילוח</span>
                : <Sourced className={`v num ${(k === 'cr' || k === 'crn') && P!.r[k]! > 1 ? 'neg' : ''}`} src={() => ratioProv(F, id, ln, pk, k, lineHe)}>{pct(P!.r[k])}</Sourced>}</td>)}
              <td><Sourced className={`v num ${(P!.x.ri ?? 0) - (P!.x.rx ?? 0) < 0 ? 'neg' : ''}`} src={() => rrProv(F, id, ln, pk, lineHe)}>{amt((P!.x.ri ?? 0) - (P!.x.rx ?? 0))}</Sourced></td>
              <td><span className={`v num ${(P!.x.isr ?? 0) < 0 ? 'neg' : ''}`}>{amt(P!.x.isr)}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="src">מיליוני ש״ח · יחס נזק = {F.meta.defs.lr}. יחס הוצאות = {F.meta.defs.er} (הפחתת הוצאות רכישה, הפסדי חוזים מכבידים ושאר ההוצאות המיוחסות). משולב נטו = {F.meta.defs.crn}. Q1 = מחצית פחות Q2; LTM = FY'25 + H1'26 − H1'25. היחסים מחושבים באתר משורות הביאור; הגדרת החברה ליחס המשולב בדוח הדירקטוריון עשויה להיות שונה. ממוין לפי העמודה שנבחרה.</div>
      </Panel>
      <Panel title="לא מדווח בפילוח">
        <ul className="pnc-gaps">{F.meta.gaps.map(([k, he, why]) => <li key={k}><b>{he}</b>: {why}</li>)}</ul>
        <div className="src">מקור: {F.meta.source}. <Link to="/capital">כושר פירעון וקיבולת חלוקה</Link></div>
      </Panel>
    </div>
  );
}
