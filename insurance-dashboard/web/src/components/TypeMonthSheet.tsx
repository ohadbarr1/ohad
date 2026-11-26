import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeeperSheet } from './DeeperSheet';
import { backThen } from './Sheet';
import { Scoreboard, type ScoreRowData } from './Scoreboard';
import { monthFull } from './MonthGrid';
import { NumText } from './NumText';
import { useFundCats, useFunds, useLoad } from '../lib/useData';
import { useHists } from '../lib/fundsLoad';
import { catKey, selfDirected, type CatX, type FundX, type FundsFile } from '../lib/funds';
import { slugOf, type StatsIndex } from '../lib/fundsTime';
import { ONE_MONTH_NOTE } from '../lib/compareWords';
import { anyShared, scoreRows, selfManaged, typeMembers, typeMonthFromFile, typeMonthFromHists, type TypeMonth, type TypeMonthsFile } from '../lib/pageMonths';
import { BEFORE_FEES, tieNote, typeMonthSub } from '../lib/pageWords';
import { prodShort, trackColor } from '../pages/compare/tracks';
import { labelMap } from '../lib/trackNames';
import type { Door } from '../lib/door';
import '../styles/rollout.css';

/* <TypeMonthSheet>: "אוקטובר 2026 · פנסיה כללי": every track of a type in one month, ranked (rollout spec §16.1 1a, §16.2 T-C7,
   §17.4 A/B, §18.5). Opened from the card's average head and cells and "מי היה ראשון…", the month sheet's link, the hub and /my.
   - Data: the type's months file, funds/months/<slug>.json (pipeline P1; slug from funds/stats/index.json, as funds/rank and
     funds/stats), loaded when the sheet opens. A month older than the file's 24, or no file, falls back to the members' own histories
     (funds/<k>.json, loaded on open, cached and shared with the page).
   - The average is the site's asset-weighted type average (the file's `avg` = funds/cat.json `y`; cat.json in the fallback), never a
     mean of the rows.
   - Rows and places: lib/pageMonths scoreRows (placeGroups, anchored groups, standard competition places 1, 1, 1, 4, 4; the "כמעט
     שווים" chip only when some rows do not share), the same function as the screener and the hub. Self-managed tracks, old-generation
     policies and tracks with no figure are not ranked and close the list. The reader's track is tinted ("שלי" in the saver door only).
   - Board: no bars unless every figure is zero or more; the average closes it; the tie note when any place is shared.
   - "לכל המסלולים מהסוג הזה ›": the screener on this type, opened on the month (a page move: it pushes). */

export interface TypeMonthSheetProps {
  open: boolean;
  onClose: () => void;
  typeKey: string;                 // catKey: "פנסיה מקיפה | כללי"
  p: number;                       // yyyymm
  mineKeys?: string[];             // the reader's tracks (tinted)
  door?: Door;                     // "שלי" in the saver door only (default saver)
  typeName?: string;               // the type in words ("פנסיה כללי"; lib/pageWords); default the product's short name + the track
  onTrack?: (k: string) => void;   // a row tapped (the card of that track, or its track sheet); absent: rows are not buttons
  onAll?: () => void;              // replaces the default screener link
  id?: string;
}

const typeWords = (key: string) => { const [prod, track] = key.split(' | '); return `${prodShort(prod ?? '')} ${track ?? ''}`.trim(); };
/** the screener on a type, opened on the month (lane L2-b reads prod, track, per) */
export const screenHref = (key: string) => { const [prod, track] = key.split(' | '); return `/funds/screen?${new URLSearchParams({ prod: prod ?? '', track: track ?? '', per: 'm1' }).toString()}`; };

/** The month of a type: the months file, else the members' histories (loaded only when the file cannot answer). */
export function useTypeMonth(typeKey: string, p: number, members: FundX[], cat: CatX | null, enabled = true): { month: TypeMonth | null; from: 'file' | 'hists' | null; loading: boolean } {
  const idx = useLoad<StatsIndex>(enabled ? 'funds/stats/index.json' : null);
  const row = slugOf(idx.data, typeKey);
  const file = useLoad<TypeMonthsFile>(enabled && row ? `funds/months/${row.slug}.json` : null);
  const fromFile = typeMonthFromFile(file.data, p, cat);
  // the file cannot answer: no index row, the file is missing, or the month is not in it
  const settled = !!idx.error || (!!idx.data && (!row || !!file.data || !!file.error));
  const fallback = enabled && settled && !fromFile;
  const keys = useMemo(() => (fallback ? members.map((f) => f.k) : []), [fallback, members]);
  const { hist, pending } = useHists(keys);
  if (fromFile) return { month: fromFile, from: 'file', loading: false };
  if (!fallback) return { month: null, from: null, loading: enabled };
  return { month: pending ? null : typeMonthFromHists(hist, keys, p, cat), from: 'hists', loading: pending > 0 };
}

export function TypeMonthSheet({ open, onClose, typeKey, p, mineKeys = [], door = 'saver', typeName, onTrack, onAll, id = 'sheet-type-month' }: TypeMonthSheetProps) {
  const nav = useNavigate();
  const file = (useFunds(open).data as FundsFile | null) ?? null;
  const cats = (useFundCats(open).data as Record<string, CatX> | null) ?? null;
  const asof = file?.asof ?? p;
  const members = useMemo(() => {
    if (!file) return [] as FundX[];
    const base = typeMembers(file.funds, typeKey);
    // the reader's own track stays on its type's list even when it is a sectoral fund
    const extra = file.funds.filter((f) => mineKeys.includes(f.k) && catKey(f) === typeKey && !base.includes(f));
    return [...base, ...extra];
  }, [file, typeKey, mineKeys.join()]);  // eslint-disable-line react-hooks/exhaustive-deps
  const cat = cats?.[typeKey] ?? null;
  const { month, loading } = useTypeMonth(typeKey, p, members, cat, open && !!file);
  const scored = useMemo(() => (month ? scoreRows(members, 'm1', { asof, p, month }) : []), [members, month, asof, p]);
  const ranked = scored.filter((r) => r.ranked);
  // labels among the ranked tracks (a self-managed account of the same company does not turn "מיטב" into "מיטב 880"); the unranked
  // ones among all members
  const labels = useMemo(() => labelMap(members, scored.filter((r) => r.ranked).map((r) => r.f)), [scored, members]);
  const labelOf = (k: string) => labels.get(k) ?? k;
  const rows: ScoreRowData[] = scored.map((r) => ({
    k: r.k, label: labelOf(r.k), color: trackColor(0), value: r.v, place: r.pl.place,
    tie: r.pl.chip, tag: !r.ranked && selfDirected(r.f) ? 'בניהול אישי' : undefined, mine: mineKeys.includes(r.k),
  }));
  const name = typeName ?? typeWords(typeKey);
  const shared = anyShared(scored.map((r) => r.pl));
  const all = () => (onAll ? onAll() : backThen(() => nav(screenHref(typeKey))));
  return (
    <DeeperSheet open={open} onClose={onClose} id={id} title={`${monthFull(p)} · ${name}`}
      sub={ranked.length ? <NumText t={typeMonthSub(ranked.length, selfManaged(members).length)} /> : BEFORE_FEES}
      footer={<button type="button" className="cs-btn pri" id="to-screen" onClick={all}>לכל המסלולים מהסוג הזה ›</button>}>
      {loading && !month ? <div className="ro-skel" aria-busy="true" /> : rows.length ? (
        <Scoreboard id="type-board" rows={rows} decimals={2} bars="auto" mineWord={door === 'saver' ? 'שלי' : null}
          benchmark={{ label: 'הממוצע', value: month?.avg ?? null }} onOpen={onTrack}
          note={shared ? <NumText t={tieNote('m1')} /> : undefined} />
      ) : (
        <p className="cs-note">אין עדיין תשואות למסלולים מהסוג הזה בחודש הזה.</p>
      )}
      <ul className="ro-facts"><li>{ONE_MONTH_NOTE}</li></ul>
    </DeeperSheet>
  );
}
