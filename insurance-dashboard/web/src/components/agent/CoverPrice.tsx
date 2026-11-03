import { useState } from 'react';
import { Sourced } from '../Source';
import { Seg } from '../ui';
import { useOptional } from '../../lib/fundsLoad';
import { DECISION_PATH, claimProv, type ClaimWhat, type DecisionFile } from '../../lib/decision';
import { COVERS_PATH, EFF_METHOD, effProv, effRows, rawProv, sortEff, type CSex, type CoversFile, type EffRow, type EffSort } from '../../lib/coverPrice';
import '../../styles/agent-book.css';

/* W11 · the claims-adjusted cover price (agent door, /clients/book): per comprehensive pension fund, the bylaws price of the disability and
   survivors cover per ₪1,000 of insured salary at a standard age, next to the managing company's annex-B3 approval and 30-day shares,
   and the price divided by both (lib/coverPrice). Sortable by any column; every figure opens its source (the bylaws page, the B3 cell).
   Descriptive: the page never marks a fund better or worse, and no colour ranks a row. */

const n2 = (v: number | null | undefined) => (v == null ? '–' : `₪${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const p1 = (v: number | null | undefined) => (v == null ? '–' : `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);
const COLS: [EffSort, string][] = [['grp', 'קרן (חברה מנהלת)'], ['raw', 'מחיר לפי התקנון'], ['dApp', 'נכות: אושרו'], ['dFast', 'נכות: עד 30 יום'], ['sApp', 'שאירים: אושרו'], ['sFast', 'שאירים: עד 30 יום'], ['eff', 'מחיר אפקטיבי']];

export function CoverPrice() {
  const cov = useOptional<CoversFile>(COVERS_PATH);
  const dec = useOptional<DecisionFile>(DECISION_PATH);
  const [sex, setSex] = useState<CSex>('m');
  const [age, setAge] = useState<'30' | '40' | '50'>('40');
  const [sort, setSort] = useState<[EffSort, 1 | -1]>(['raw', 1]);
  if (cov === undefined) return <p className="muted">טוען את טבלאות התקנונים…</p>;
  if (!cov) return <p className="muted">קובץ מחירי הכיסוי לא נטען.</p>;
  const rows = sortEff(effRows(cov, dec, sex, Number(age)), sort[0], sort[1]);
  const click = (k: EffSort) => setSort(([s, d]) => [k, s === k ? (d === 1 ? -1 : 1) : 1]);
  const aria = (k: EffSort): 'ascending' | 'descending' | 'none' => (sort[0] === k ? (sort[1] === 1 ? 'ascending' : 'descending') : 'none');
  return (
    <div className="cp">
      <div className="cp-bar">
        <Seg label="גיל" value={age} onChange={setAge} options={[['30', 'גיל 30'], ['40', 'גיל 40'], ['50', 'גיל 50']]} />
        <Seg label="מין" value={sex} onChange={setSex} options={[['m', 'גבר'], ['f', 'אישה']]} />
        <span className="cp-unit">₪ לחודש, לכל ₪1,000 שכר מבוטח · מסלול ברירת המחדל · בלי יתרה צבורה</span>
      </div>
      <div className="scroll"><table className="fsimple cp-t">
        <caption className="sr-only">מחיר הכיסוי לנכות ולשאירים לפי התקנון, שיעורי אישור ומהירות מדוח התביעות, ומחיר אפקטיבי</caption>
        <thead><tr>{COLS.map(([k, l]) => <th key={k} scope="col" aria-sort={aria(k)}><button type="button" className="cp-sort" onClick={() => click(k)}>{l}<span aria-hidden="true">{sort[0] === k ? (sort[1] === 1 ? ' ▲' : ' ▼') : ''}</span></button></th>)}</tr></thead>
        <tbody>{rows.map((r) => <Row key={r.id} r={r} cov={cov} dec={dec} />)}</tbody>
      </table></div>
      <details className="cp-how">
        <summary>איך מחושב, ומה לא נאמר כאן</summary>
        <p><b>מחיר לפי התקנון.</b> {cov.method}</p>
        <p><b>המבוטח הסטנדרטי.</b> {cov.standard_note}.</p>
        <p><b>מחיר אפקטיבי.</b> {EFF_METHOD}</p>
        <p><b>הטבלאות שנקראו.</b> {Object.values(cov.funds).map((f) => `${f.grp}: עמ' ${[...new Set(f.tables.flatMap((t) => t.pages))].sort((a, b) => a - b).join(', ')} (${f.src.edition}${f.src.kind === 'mirror' ? ', עותק באתר צד שלישי' : ''})`).join(' · ')}.</p>
        {Object.values(cov.funds).some((f) => f.excluded.length) && <p><b>לא פורסם.</b> {Object.values(cov.funds).flatMap((f) => f.excluded.map((e) => `${f.grp}: ${e.why}`)).join(' · ')}</p>}
      </details>
    </div>
  );
}

function Row({ r, cov, dec }: { r: EffRow; cov: CoversFile; dec: DecisionFile | null | undefined }) {
  const c = r.cell;
  return (
    <tr>
      <th scope="row"><b>{r.grp}</b><span className="cp-sub">{r.fund.src.fund ?? ''}{r.d?.n != null && r.d.n < 30 ? ` · ${r.d.n} תביעות נכות נסגרו` : ''}</span></th>
      <td>{c && r.raw != null ? <Sourced src={() => rawProv(cov, r.fund, c)}>{n2(r.raw)}</Sourced> : <span className="cp-why">{r.why ?? '–'}</span>}
        {c && r.raw != null && <span className="cp-sub">נכות {n2(r.dis)} · שאירים {n2(r.surv)}</span>}</td>
      <td><Share v={r.d?.approved} dec={dec} grp={r.grp} side="disability" what="approved" /></td>
      <td><Share v={r.d?.fast} dec={dec} grp={r.grp} side="disability" what="closed0" /></td>
      <td><Share v={r.s?.approved} dec={dec} grp={r.grp} side="survivors" what="approved" /></td>
      <td><Share v={r.s?.fast} dec={dec} grp={r.grp} side="survivors" what="closed0" /></td>
      <td>{r.eff != null && dec ? <><Sourced src={() => effProv(cov, dec, r)}>{n2(r.eff)}</Sourced><span className="cp-sub">פי {r.mult!.toLocaleString('en-US', { maximumFractionDigits: 1 })} מהמחיר בתקנון</span></> : <span className="cp-why">{r.raw != null ? r.why : '–'}</span>}</td>
    </tr>
  );
}

/** a claims share of annex B3, opening its source (the company's file, sheet and cells) */
function Share({ v, dec, grp, side, what }: { v: number | null | undefined; dec: DecisionFile | null | undefined; grp: string; side: 'disability' | 'survivors'; what: ClaimWhat }) {
  if (v == null || !dec) return <span className="cp-why">{dec && !dec.companies[grp]?.claims ? 'לא פורסם' : '–'}</span>;
  return <Sourced src={() => claimProv(dec, grp, side, what)}>{p1(v)}</Sourced>;
}
