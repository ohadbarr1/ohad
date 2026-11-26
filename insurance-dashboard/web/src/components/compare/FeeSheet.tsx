/* C4 · the fee sheet (spec §4.5 as amended by 4.0 row 9 and 10A.2 C4, mockup v3 frame "fee sheet"; owner decision O9).
   "דמי ניהול, בשקלים · על חיסכון של 100,000 ש״ח, לשנה אחת"; the switch "עם הפקדה חודשית / בלי הפקדות" only when a product on screen has an
   example deposit (pension, hishtalmut); ONE emphasised row in shekels, the cheapest ringed (strictly less than 20 ₪ above the lowest,
   lib/feeExample); "איך זה מתחלק" in grey (the two published percentages); "על הסכומים שלי ›" (the fee tool) and "איך מחשבים?".
   O9: a track the reader holds with their own fee (lib/mine, typed or from the clearing-house import, lib/maslaka) is costed with it,
   labelled "לפי הדוח שלך", and every track is then costed on the reader's balance and deposit (lib/feeExample feeTable).

   Shared with the table's fee row (lane L2-a): `useFeeCosts(funds)` returns the same costs and ring as this sheet, and the switch is
   kept for this visit only (sessionStorage 'fox:cmp:feedep' = '0' when off; default with deposits), synced across the page by one
   event: the row follows the switch, also after the sheet closes, and reads "בלי הפקדות ›" while it is off. A returning visitor opens on
   the default (review B1 P3); a shared link carries the switch when it is off (dep=0, lane ShareSheet) and the shell applies it for that
   visit with adoptDepParam (review B2 N2). */
import { Link } from 'react-router-dom';
import type { SheetProps } from '../../pages/compare/contract';
import { DeeperSheet } from '../DeeperSheet';
import { CompareGrid } from '../CompareGrid';
import { Sourced } from '../Source';
import { useCallback, useEffect, useState } from 'react';
import { useMine } from '../../lib/mine';
import { feeTable, hasDeposit, FEE_TIE, type FeeCol, type FeeTable } from '../../lib/feeExample';
import { exampleMonthly, BALANCE_EX } from '../../lib/retire';
import { catKey, refOf, type FundX } from '../../lib/funds';
import { fundP } from '../../lib/market';
import { nf } from '../../lib/format';
import type { Prov } from '../../lib/prov';
import { Facts, Plain, useCmpData } from './sheetKit';

/** the switch "עם הפקדה חודשית / בלי הפקדות", shared with the table's fee row. For this visit only (sessionStorage, as in the mockup):
 *  a returning visitor and a shared link open on the default (with deposits), and the row says so when it is off ("בלי הפקדות ›").
 *  Every component on the page follows a change at once (one event). */
export const FEE_DEP_KEY = 'cmp:feedep';
const DEP_EVENT = 'fox:feedep';
const readDep = (): boolean => { try { return sessionStorage.getItem(`fox:${FEE_DEP_KEY}`) !== '0'; } catch { return true; } };
/** A link's `dep` (0 = without deposits, 1 = with): applied for this visit, as if the reader had flipped the switch. Called by the shell
 *  before the page renders; returns whether the address carried one (the shell then drops it from the address). */
export function adoptDepParam(search: string): boolean {
  const v = new URLSearchParams(search).get('dep');
  if (v !== '0' && v !== '1') return false;
  try { if (v === '0') sessionStorage.setItem(`fox:${FEE_DEP_KEY}`, '0'); else sessionStorage.removeItem(`fox:${FEE_DEP_KEY}`); } catch { /* blocked */ }
  dispatchEvent(new Event(DEP_EVENT));
  return true;
}
export function useFeeDeposits(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(readDep);
  useEffect(() => { const on = () => setV(readDep()); addEventListener(DEP_EVENT, on); return () => removeEventListener(DEP_EVENT, on); }, []);
  const set = useCallback((next: boolean) => {
    try { if (next) sessionStorage.removeItem(`fox:${FEE_DEP_KEY}`); else sessionStorage.setItem(`fox:${FEE_DEP_KEY}`, '0'); } catch { /* blocked: this component only */ }
    setV(next); dispatchEvent(new Event(DEP_EVENT));
  }, []);
  return [v, set];
}

/** The fee row's cells, in column order, the same as the sheet's: ₪ a year (rounded to 10), the cells to ring, which are the reader's
 *  own ("לפי הדוח שלך"), and the deposits switch in force. Missing funds get null. */
export function useFeeCosts(funds: (FundX | null | undefined)[]): { costs: (number | null)[]; ring: number[]; own: boolean[]; deposits: boolean; switchable: boolean } {
  const [dep] = useFeeDeposits();
  const [mine] = useMine();
  const switchable = funds.some((f) => f && hasDeposit(f.prod));
  const deposits = switchable ? dep : true;  // as in the sheet: no example deposit, no switch
  const t = feeTable(funds, deposits, mine);
  const by = new Map(t.cols.map((c) => [c.k, c]));
  const cols = funds.map((f) => (f ? by.get(f.k) ?? null : null));
  // ring indexes are over the present columns; map them back to the column order
  const present = funds.flatMap((f, i) => (f ? [i] : []));
  return { costs: cols.map((c) => c?.cost ?? null), ring: t.ring.map((i) => present[i]), own: cols.map((c) => !!c?.own), deposits, switchable };
}

const ils = (v: number) => v.toLocaleString('en-US');
const pct = (v: number | null | undefined) => (v == null ? '–' : `${nf(v, 2)}%`);

/** a shekel figure, as the sum of its two parts */
function costProv(f: FundX, c: FeeCol, t: FeeTable, asof: number): Prov {
  const p = c.parts, r = refOf(f);
  const feeSrc = (): Prov => (c.own ? { k: 'none', title: `דמי ניהול מהחיסכון · ${f.name}`, why: 'לפי הדוח שלך: דמי הניהול שהזנת או שייבאת מהדוח מהמסלקה הפנסיונית (נשמר בדפדפן הזה בלבד)' }
    : fundP(r, asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', pct(c.fee)));
  const depSrc = (): Prov => (c.own ? { k: 'none', title: `דמי ניהול מכל הפקדה · ${f.name}`, why: 'לפי הדוח שלך' }
    : fundP(r, asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', pct(c.depfee)));
  return { k: 'calc', est: true, title: `דמי ניהול בשקלים, שנה אחת · ${f.name}${c.own ? ' · לפי הדוח שלך' : ''}`, value: c.cost == null ? '–' : `${ils(c.cost)} ש"ח`,
    formula: `דמי ניהול מהחיסכון × ${t.base ? 'החיסכון שלך' : 'חיסכון לדוגמה'} + דמי ניהול מהפקדה × הפקדה חודשית × 12, מעוגל לעשרות. המחשה לשנה אחת, לא תחזית`,
    note: c.own ? undefined : 'דמי הניהול הם הממוצע בפועל של המסלול (רשות שוק ההון); דמי הניהול של חוסך מסוים יכולים להיות שונים',
    inputs: [
      { label: 'דמי ניהול מהחיסכון, בשנה', v: pct(c.fee), src: feeSrc },
      { label: t.base ? 'החיסכון שלך' : 'חיסכון לדוגמה', v: `${ils(p.balance)} ש"ח` },
      { label: 'מהחיסכון, בשקלים', v: `${nf(p.acc, 1)} ש"ח` },
      { label: 'דמי ניהול מכל הפקדה', v: pct(c.depfee), src: depSrc },
      { label: `הפקדה חודשית (${p.why})`, v: `${ils(p.monthly)} ש"ח` },
      { label: 'מההפקדות, בשקלים (× 12)', v: `${nf(p.dep, 1)} ש"ח` },
    ] };
}

export function FeeSheet({ keys, open, onClose, openSheet }: SheetProps) {
  const d = useCmpData(keys, open);
  const [dep, setDep] = useFeeDeposits();
  const [mine] = useMine();
  const anyDep = d.cols.some((c) => hasDeposit(c.f.prod));
  const deposits = anyDep ? dep : true;  // without an example deposit the switch is not shown and changes nothing
  const t = feeTable(d.cols.map((c) => c.f), deposits, mine);
  const by = new Map(t.cols.map((c) => [c.k, c]));
  const asof = d.asof ?? 0;
  const lo = Math.min(...t.cols.flatMap((c) => (c.cost == null ? [] : [c.cost])));
  const ringK = new Set(t.ring.map((i) => t.cols[i].k));
  const owned = d.cols.filter((c) => by.get(c.k)?.own);
  const cols = d.cols.map((c) => ({ k: c.k, label: c.label, color: c.color }));
  const fOf = (k: string) => d.cols.find((c) => c.k === k)!.f;
  // the monthly deposit the sheet speaks of (the first product with an example deposit, or the reader's own)
  const exM = t.base?.monthly ?? exampleMonthly(d.cols.find((c) => hasDeposit(c.f.prod))?.f.prod ?? '').v;
  const sub = t.base ? `על החיסכון שלך, ${ils(t.base.balance)} ש״ח, לשנה אחת` : `על חיסכון של ${ils(BALANCE_EX)} ש״ח, לשנה אחת`;
  const f0 = d.cols[0]?.f, tool = f0 ? `/funds/tools/fees?cat=${encodeURIComponent(catKey(f0))}&k=${encodeURIComponent(f0.k)}` : '/funds/tools/fees';

  return (
    <DeeperSheet open={open} onClose={onClose} id="fee-sheet-dlg" title="דמי ניהול, בשקלים" sub={sub}>
      <div id="fee-sheet">
        {anyDep ? (
          <div className="cs-seg" role="group" aria-label="הפקדות">
            <button type="button" className={deposits ? 'on' : ''} aria-pressed={deposits} onClick={() => setDep(true)}>עם הפקדה חודשית</button>
            <button type="button" className={deposits ? '' : 'on'} aria-pressed={!deposits} onClick={() => setDep(false)}>בלי הפקדות</button>
          </div>
        ) : null}
        {!d.file ? <div className="cs-skel" /> : (
          <CompareGrid id="fee-table" className="fee-main" cols={cols}
            rows={[{ key: 'ils', label: 'בשנה, בשקלים',
              cell: (k) => { const c = by.get(k); if (!c || c.cost == null) return '–';
                return <><Sourced src={() => costProv(fOf(k), c, t, asof)} className="n big">{ils(c.cost)}</Sourced>{c.own ? <small className="own">לפי הדוח שלך</small> : null}</>; },
              value: (k) => { const c = by.get(k); return c?.cost == null ? null : ringK.has(k) ? lo : c.cost; },
              better: t.ring.length ? 'lo' : null }]} />
        )}
        <p className="cs-note">הפרש של פחות מ-{FEE_TIE} ש״ח בשנה נחשב כמעט שווה.</p>
        <h3 className="cs-subh">איך זה מתחלק</h3>
        <CompareGrid id="fee-parts" quiet cols={cols}
          rows={[
            { key: 'acc', label: 'מהחיסכון, כל שנה', cell: (k) => { const c = by.get(k); return <Plain v={c?.fee} src={c?.own ? undefined : () => fundP(refOf(fOf(k)), asof, 'AVG_ANNUAL_MANAGEMENT_FEE', 'דמי ניהול מצבירה, ממוצע בפועל', pct(c?.fee))} />; } },
            ...(anyDep && deposits ? [{ key: 'dep', label: 'מכל הפקדה חדשה', cell: (k: string) => { const c = by.get(k); return <Plain v={c?.depfee} src={c?.own ? undefined : () => fundP(refOf(fOf(k)), asof, 'AVG_DEPOSIT_FEE', 'דמי ניהול מהפקדה, ממוצע בפועל', pct(c?.depfee))} />; } }] : []),
          ]} />
        <Facts items={[
          owned.length
            ? <><b>לפי הדוח שלך</b> ב{owned.map((c) => c.label).join(', ')}: דמי הניהול שלך מהדוח. בשאר המסלולים אלה הממוצעים של כל החוסכים במסלול.</>
            : <><b>אצלך זה יכול להיות אחרת.</b> אלה הממוצעים של כל החוסכים במסלול. דמי הניהול שלך כתובים בדוח השנתי.</>,
          anyDep && deposits ? <>{t.base?.monthly != null ? 'ההפקדה שלך' : 'ההפקדה בדוגמה'}: <bdi dir="ltr" className="n">{ils(exM)}</bdi> ש״ח בחודש. כבר לא מפקידים? ״בלי הפקדות״ למעלה.</> : null,
        ]} />
        <div className="cs-nav in">
          <Link className="cs-btn" to={tool}>על הסכומים שלי ›</Link>
          <button type="button" className="cs-btn" onClick={() => openSheet({ t: 'why' })}>איך מחשבים?</button>
        </div>
      </div>
    </DeeperSheet>
  );
}
