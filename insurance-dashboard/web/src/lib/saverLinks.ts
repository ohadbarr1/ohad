import { useMemo } from 'react';
import { useMine } from './mine';
import { useFunds } from './useData';
import { TRAY_MAX, useTray } from './funds';
import type { VFund } from './verdict';
import { compareKeys } from './saverCompare';
import { inMonth, pctAbs, pctSigned } from './pageWords';
import { roundHalf } from './compareMonths';

/* W5 saver (red team 3): the saver's "השוואה" tab opened empty even after products were added on /my. When the compare tray is empty
   and /my holds products, the tab's link carries the keys the compare page already reads (?k=): the reader's own tracks in one
   category (comprehensive pension first, then the first product), and the two largest open tracks of that category by assets (C12). Agent and Pro keep the bare link. The choice itself is pure (lib/saverCompare). */

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

/* Rollout R1 (spec 8, 16, 18): the saver home's two tiles and the "my track" row. Pure; node-tested (scripts/home-links-test.mjs). */

export interface HomeLead { k: string; prod: string; track: string; m1?: number | null; y12?: number | null }
const sh = (v: number, d: number) => Math.sign(roundHalf(v, d));
const moved = (v: number) => (sh(v, 2) > 0 ? `עלה ${pctAbs(v, 2)}` : sh(v, 2) < 0 ? `ירד ${pctAbs(v, 2)}` : 'לא זז');

/** The three links of the saver's first screen. `lead`: the reader's first saved track (comprehensive pension first), or null.
 *  The screener opens on the reader's type and on "חודש" (per=m1, 4e); the hub on the reader's product (?prod=, kept by FundsRoot);
 *  the "my track" row opens the card, the compare entry above keeps its route. */
export function homeLinks(lead: HomeLead | null) {
  return {
    screen: `/funds/screen?${lead ? `prod=${encodeURIComponent(lead.prod)}&track=${encodeURIComponent(lead.track)}&` : ''}per=m1`,
    hub: lead ? `/funds?prod=${encodeURIComponent(lead.prod)}` : '/funds',
    card: lead ? `/funds/${encodeURIComponent(lead.k)}` : null,
  };
}

/** "באוקטובר ירד 1.45% · בשנה האחרונה ⁦+9.0%⁩": month and year of the reader's track, as published (gross) */
export function homeMineLine(asof: number, m1?: number | null, y12?: number | null): string {
  const parts: string[] = [];
  if (asof && typeof m1 === 'number' && Number.isFinite(m1)) parts.push(`${inMonth(asof)} ${moved(m1)}`);
  if (typeof y12 === 'number' && Number.isFinite(y12)) parts.push(`בשנה האחרונה ${pctSigned(y12, 1)}`);
  return parts.join(' · ');
}

/** Build review B2 (H-1): the "my track" row's tail when the reader saved more products than the one it shows: "ועוד 2 מוצרים"
 *  ("ועוד מוצר אחד" for one); '' when there are none. */
export function homeMoreLine(n: number): string {
  if (!Number.isFinite(n) || n < 1) return '';
  return n === 1 ? 'ועוד מוצר אחד' : `ועוד ${Math.floor(n)} מוצרים`;
}
