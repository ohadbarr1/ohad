import { useMemo } from 'react';
import { useMine } from './mine';
import { useFunds } from './useData';
import { TRAY_MAX, useTray } from './funds';
import type { VFund } from './verdict';
import { compareKeys } from './saverCompare';

/* W5 saver (red team 3): the saver's "השוואה" tab opened empty even after products were added on /my. When the compare tray is empty
   and /my holds products, the tab's link carries the keys the compare page already reads (?k=): the reader's own tracks in one
   category (comprehensive pension first, then the first product), and the cheapest open tracks of that category by the average fee
   actually paid (then the deposit fee). Agent and Pro keep the bare link. The choice itself is pure (lib/saverCompare). */

/** the saver's compare link: `/funds/compare?k=…` when the tray is empty and /my holds products, else null (the bare link stays) */
export function useSaverCompareHref(on: boolean): string | null {
  const [mine] = useMine();
  const tray = useTray();
  const list = Array.isArray(mine) ? mine.filter((m) => m && typeof m.k === 'string') : [];
  const need = on && list.length > 0 && tray.keys.length === 0;
  const { data } = useFunds(need);
  return useMemo(() => {
    if (!need) return null;
    // before funds.json arrives: the reader's own tracks alone (the page reads them the same way)
    const ks = data ? compareKeys(list, data.funds as unknown as VFund[], TRAY_MAX) : list.map((m) => m.k).slice(0, TRAY_MAX);
    return ks.length ? `/funds/compare?k=${ks.join(',')}` : null;
  }, [need, data, list.map((m) => m.k).join()]);  // eslint-disable-line react-hooks/exhaustive-deps
}
