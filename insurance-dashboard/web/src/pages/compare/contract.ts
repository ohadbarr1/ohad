/* Track-compare redesign: the integration contract between build lanes (spec §10A.1).
   The page shell (pages/FundsCompare.tsx) owns the URL-backed state; every lens and sheet receives these props.
   `sheet` in the URL: month:<yyyymm> | year:<yyyy> | fee | track:<k> | risknote | picker | share | display | why | rules
   Evolved by lane L2-a (backward compatible: every addition is optional or a new union member):
   - `view`, `setView`: the view strip ("6 חודשים | 12 חודשים | שנים | לאורך זמן | להחלטה/מקצועי"); Pro's "מקצועי" lens switches
     between 'dec' and 'risk' with setView.
   - `setDoor`: the pill "תצוגה פשוטה: חוסך ›" (switches the door, keeps the tracks, returns to the month table).
   - `asof`, `cap`: the data month (yyyymm) and the door's track cap (4 / 6 / 8).
   - SheetId 'rules': tax and liquidity of different products, the old-generation policy note (the shell mounts it itself).
   - A year sheet is MonthSheet mounted with p = 'yyyy' (4 digits); a month sheet with p = 'yyyymm'. Opening a sheet while another is
     open (the month sheet's previous / next) only rewrites the URL (replace); the open sheet's history entry is kept.
   - Column labels and colours: ./tracks.ts (trackLabels, trackColor, trackRgb). */
import type { Basis } from '../../lib/funds';
import type { Door } from '../../lib/door';

export type SheetId =
  | { t: 'month'; p: string } | { t: 'year'; y: string } | { t: 'fee' } | { t: 'track'; k: string }
  | { t: 'risknote' } | { t: 'picker' } | { t: 'share' } | { t: 'display' } | { t: 'why' } | { t: 'rules' };

/** the views of the strip: three ranges of the month table, the long view, and the agent / Pro lenses */
export type View = 'm6' | 'm12' | 'y' | 'long' | 'dec' | 'risk';

/** what every lens and sheet gets from the shell */
export interface CmpCtx {
  keys: string[];            // the tracks on screen, in column order (k = 'p2102', 'g7936', …)
  basis: Basis;              // always 'gross': the published return, before fees (owner 26.11.26)
  door: Door;                // 'saver' | 'agent' | 'pro' — sets depth, never facts
  setKeys: (keys: string[]) => void;   // replace the tracks (URL ?k=, replace)
  openSheet: (s: SheetId) => void;     // the URL-backed sheet state (written with replace; the sheet itself adds the history entry)
  /* ---- L2-a additions (optional: a lane built on the first contract keeps compiling) ---- */
  view?: View;
  setView?: (v: View) => void;
  setDoor?: (d: Door) => void;         // "תצוגה פשוטה: חוסך ›": door saver, same keys, back to the month table
  asof?: number;                       // the data month, yyyymm (funds.json asof)
  cap?: number;                        // the door's track cap: 4 saver / 6 agent / 8 Pro
}

/** a sheet's props: the context, its own argument, and onClose (Back/Escape/scrim call it; clear the sheet state with replace) */
export interface SheetProps extends CmpCtx { open: boolean; onClose: () => void }

/** the door's track cap (approved O2) */
export const DOOR_CAP: Record<Door, number> = { saver: 4, agent: 6, pro: 8 };
