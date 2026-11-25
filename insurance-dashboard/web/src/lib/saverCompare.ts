/* W5 saver: which tracks the saver's "השוואה" tab opens on (lib/saverLinks): the reader's own tracks of one category (comprehensive
   pension first, else the first product), then the TWO LARGEST open tracks of that category by assets (C12, owner-approved O3: it
   replaces the three cheapest by fee; the largest are the tracks a saver has heard of). Pure, node-testable. `max`: the compare tray's size (lib/funds TRAY_MAX). */
import { isPension, peersOf, type VFund } from './verdict';

/** how many peers sit beside the reader's own tracks: the largest open tracks of the category */
export const PEERS_N = 2;

/** the keys to compare: the reader's tracks of one category, then the largest open same-category tracks, at most TRAY_MAX */
export function compareKeys(mine: { k: string }[], funds: VFund[], max = 8): string[] {
  const by = new Map(funds.map((f) => [f.k, f]));
  const own = mine.map((m) => by.get(m.k)).filter((f): f is VFund => !!f);
  if (!own.length) return [];
  const lead = own.find((f) => isPension(f.prod)) ?? own[0];
  const cat = `${lead.prod} | ${lead.track}`;
  const mineCat = own.filter((f) => `${f.prod} | ${f.track}` === cat).map((f) => f.k);
  const big = peersOf(lead, funds).filter((x) => !x.closed && (x.assets ?? 0) > 0 && !mineCat.includes(x.k))
    .sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0) || (a.fee ?? 99) - (b.fee ?? 99) || a.k.localeCompare(b.k)).slice(0, PEERS_N).map((x) => x.k);
  return [...mineCat, ...big].slice(0, max);
}

