import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BasisToggle } from '../../components/FundsNav';
import { Tip } from '../../components/Explain';
import { Field, Pick } from '../../components/ui';
import { DeeperSheet, SheetSection } from '../../components/DeeperSheet';
import { FAMS, FAM_LABEL, type FamKey } from '../../lib/funds';
import { COLS, RET, type ColKey } from './screenCalc';

/* Rollout L2-b, T-S2: the screener's filters. `FilterOptions` is today's "דירוג וסינון" without the period (spec 4.2 #2, 4.5: search,
   family chips with counts, manager, the numeric filters, "רק תווית מול מציאות", sectoral funds, closed tracks, the desktop column
   chooser, saved screens). The desktop renders it inline as before; the phone renders it in the "סינון" sheet (`FiltersSheet`) with the
   basis (nominal / real), the default-fund chip (pension) and, for the agent and Pro, "דירוג לפי" over all 22 columns.
   B10: a choice that would leave no track is not offered (a family with 0 is disabled) or is refused with the reason (a manager);
   the previous filter stays. The saver reads words, not abbreviations ("דמי ניהול מהחיסכון עד", not "ד"נ מצבירה עד"). */

export type DoorW = 'saver' | 'agent' | 'pro';
export interface Saved { name: string; qs: string }
export type NumKey = 'fmax' | 'dmax' | 'amin' | 'smin' | 'hist' | 'eqmin' | 'eqmax';
export interface FilterProps {
  door: DoorW;
  phone: boolean;
  q: string;
  fams: FamKey[];
  mk: string;
  F: Record<NumKey, number | null>;
  closed: boolean; gone: boolean; outOnly: boolean;
  nFilters: number;
  groupsAll: string[];
  /** how many tracks a choice would leave (every other filter kept) */
  reachFam: (fams: FamKey[]) => number;
  reachMk: (mk: string) => number;
  refused: boolean;
  setRefused: (v: boolean) => void;
  set: (patch: Record<string, string | null>) => void;
  clear: () => void;
  /* desktop column chooser */
  cols: ColKey[]; colsAll: [ColKey, string][]; baseCols: ColKey[];
  saved: Saved[]; setSaved: (s: Saved[]) => void;
  qs: string;
}

const ALL = 'all';
const NUM: Record<NumKey, [string, string, string, string]> = {
  // key: [agent / Pro label, saver label, unit, step]
  eqmin: ['מניות מ-', 'מניות מ-', '%', '5'], eqmax: ['מניות עד', 'מניות עד', '%', '5'],
  fmax: ['ד"נ מצבירה עד', 'דמי ניהול מהחיסכון עד', '%', '0.05'], dmax: ['ד"נ מהפקדה עד', 'דמי ניהול מההפקדה עד', '%', '0.1'],
  amin: ['נכסים מ-', 'נכסים מ-', 'מ׳ ש"ח', '100'], smin: ['שארפ מ-', 'שארפ מ-', '', '0.1'], hist: ['היסטוריה מ-', 'ותק מ-', 'שנים', '1'],
};
const NUM_ORDER: NumKey[] = ['eqmin', 'eqmax', 'fmax', 'dmax', 'amin', 'smin', 'hist'];

export function FilterOptions(p: FilterProps) {
  const [naming, setNaming] = useState<string | null>(null);
  const saver = p.door === 'saver';
  const famChip = (k: FamKey) => {
    const on = p.fams.includes(k), n = on ? 1 : p.reachFam([...p.fams, k]), none = n === 0;
    return <button key={k} type="button" className="chip" aria-pressed={on} disabled={none} title={none ? 'אין מסלולים כאלה בבחירה הנוכחית' : undefined} style={none ? { opacity: 0.45, cursor: 'default' } : undefined}
      onClick={() => p.set({ fam: (on ? p.fams.filter((x) => x !== k) : [...p.fams, k]).join(',') || null })}>{FAM_LABEL[k]}{none && <> · <span className="num">0</span></>}</button>;
  };
  const numIn = (k: NumKey) => {
    const [l, ls, unit, step] = NUM[k], label = saver ? ls : l;
    return <label className="fnum" key={k}>{label} <input type="number" inputMode="decimal" step={step} value={p.F[k] ?? ''} onChange={(e) => p.set({ [k]: e.target.value === '' ? null : e.target.value })} aria-label={`${label} ${unit}`} />{unit}</label>;
  };
  return (
    <div className="fopts">
      {p.refused ? <div className="fnote" role="status">אין מסלולים כאלה; הסינון הקודם נשמר</div> : null}
      <Field label="חיפוש"><input type="search" value={p.q} onChange={(e) => p.set({ q: e.target.value || null })} placeholder="שם מסלול או גוף" /></Field>
      <div className="field"><span>משפחת מסלול <Tip k="family" /></span><div className="fchips">{FAMS.map(([k]) => famChip(k))}</div></div>
      <div className="field"><span>גוף מנהל</span><Pick label="גוף מנהל" value={p.mk || ALL} onChange={(v) => { if (v !== ALL && p.reachMk(v) === 0) { p.setRefused(true); return; } p.set({ mk: v === ALL ? null : v }); }} options={[[ALL, 'כל הגופים'], ...p.groupsAll.map((g) => [g, g] as [string, string])]} /></div>
      <div className="field"><span>סינון{p.nFilters > 0 && <button type="button" className="linkbtn" onClick={p.clear}>ניקוי</button>}</span>
        <div className="fnums">{NUM_ORDER.map(numIn)}</div></div>
      <div className="fchips">
        <button type="button" className="chip" aria-pressed={p.outOnly} onClick={() => p.set({ out: p.outOnly ? null : '1' })}>רק תווית מול מציאות</button><Tip k="outlier" />
        <button type="button" className="chip" aria-pressed={p.closed} onClick={() => p.set({ closed: p.closed ? null : '1' })}>כולל קופות ענפיות</button><Tip k="closed" />
        <button type="button" className="chip" aria-pressed={p.gone} onClick={() => p.set({ gone: p.gone ? null : '1' })}>כולל מסלולים שנסגרו</button>
      </div>
      {!p.phone && <div className="field"><span>עמודות</span><div className="fchips">{p.colsAll.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={p.cols.includes(k)} onClick={() => { const next = p.cols.includes(k) ? p.cols.filter((x) => x !== k) : COLS.map(([x]) => x).filter((x) => p.cols.includes(x) || x === k); p.set({ cols: next.join(',') === p.baseCols.join(',') ? null : next.join(','), sort: null }); }}>{l}</button>)}</div></div>}
      <div className="field"><span>סינונים שמורים <span className="muted">· בדפדפן הזה בלבד</span></span>
        <div className="fchips">
          {p.saved.map((s) => <span key={s.name} className="fsaved"><Link className="chip" to={`/funds/screen?${s.qs}`}>{s.name}</Link><button type="button" className="fsaved-x" aria-label={`מחיקת הסינון ${s.name}`} onClick={() => p.setSaved(p.saved.filter((x) => x.name !== s.name))}>×</button></span>)}
          {naming == null ? <button type="button" className="chip" onClick={() => setNaming('')}>+ שמירת הסינון הזה</button> : (
            <form className="fsave" onSubmit={(e) => { e.preventDefault(); const n = naming.trim(); if (!n) return; const qs = new URLSearchParams(p.qs); qs.delete('sheet'); p.setSaved([...p.saved.filter((x) => x.name !== n), { name: n, qs: qs.toString() }]); setNaming(null); }}>
              <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="שם לסינון" aria-label="שם לסינון" maxLength={40} /><button type="submit" className="chip">שמירה</button><button type="button" className="chip" onClick={() => setNaming(null)}>ביטול</button>
            </form>
          )}
        </div></div>
    </div>
  );
}

/** "דירוג לפי" (agent and Pro, phone): every column; a return column sets the period, any other ranks the board by that measure. */
export function RankBy({ sortKey, per, cols, onPick }: { sortKey: ColKey | ''; per: string; cols: [ColKey, string][]; onPick: (k: ColKey | null) => void }) {
  return (
    <div className="fchips scr-rankby" id="rank-by" role="group" aria-label="דירוג לפי">
      {cols.map(([k, l]) => {
        const on = sortKey ? sortKey === k : RET.has(k) && k === per;
        return <button key={k} type="button" className="chip" aria-pressed={on} onClick={() => onPick(on && !RET.has(k) ? null : k)}>{l}</button>;
      })}
    </div>
  );
}

export interface FiltersSheetProps {
  open: boolean;
  onClose: () => void;
  door: DoorW;
  shown: number;
  rankBy: ReactNode | null;
  /** the default-fund chip (pension) */
  extra?: ReactNode;
  children: ReactNode;
}
/** The phone's "סינון" sheet (`#sheet-filters`). Its controls write the address while it is open; "הצגת N מסלולים" closes it. */
export function FiltersSheet({ open, onClose, door, shown, rankBy, extra, children }: FiltersSheetProps) {
  return (
    <DeeperSheet open={open} onClose={onClose} id="sheet-filters" title="סינון" sub={door === 'saver' ? 'מה להראות ברשימה' : 'דירוג, סינון וסינונים שמורים'}
      footer={<button type="button" className="cs-btn pri scr-show" onClick={() => history.back()}>הצגת <span className="num">{shown}</span> מסלולים</button>}>
      {rankBy ? <SheetSection title="דירוג לפי" open id="sec-rank-by">{rankBy}</SheetSection> : null}
      <SheetSection title="תשואה" open>
        <BasisToggle />
        {extra ? <div className="fchips" style={{ marginTop: 8 }}>{extra}</div> : null}
      </SheetSection>
      <SheetSection title="סינון" open>{children}</SheetSection>
    </DeeperSheet>
  );
}
