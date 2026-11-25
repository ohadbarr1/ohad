/* Track-compare redesign: the integration contract between build lanes (spec §10A.1).
   The page shell (pages/FundsCompare.tsx) owns the URL-backed state; every lens and sheet receives these props.
   `sheet` in the URL: month:<yyyymm> | year:<yyyy> | fee | track:<k> | risknote | picker | share | display | why */
import type { Basis } from '../../lib/funds';
import type { Door } from '../../lib/door';

export type SheetId =
  | { t: 'month'; p: string } | { t: 'year'; y: string } | { t: 'fee' } | { t: 'track'; k: string }
  | { t: 'risknote' } | { t: 'picker' } | { t: 'share' } | { t: 'display' } | { t: 'why' };

/** what every lens and sheet gets from the shell */
export interface CmpCtx {
  keys: string[];            // the tracks on screen, in column order (k = 'p2102', 'g7936', …)
  basis: Basis;              // 'net' (after fees, the default) | 'gross'
  door: Door;                // 'saver' | 'agent' | 'pro' — sets depth, never facts
  setKeys: (keys: string[]) => void;   // replace the tracks (URL ?k=, replace)
  openSheet: (s: SheetId) => void;     // push the URL-backed sheet state
}

/** a sheet's props: the context, its own argument, and onClose (Back/Escape/scrim call it; clear the sheet state with replace) */
export interface SheetProps extends CmpCtx { open: boolean; onClose: () => void }
