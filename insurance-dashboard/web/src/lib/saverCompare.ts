/* W5 saver: which tracks the saver's "השוואה" tab opens on (lib/saverLinks): the reader's own tracks of one category (comprehensive
   pension first, else the first product), then the cheapest open tracks of that category by the average fee actually paid, then the
   deposit fee. Pure, node-testable. `max`: the compare tray's size (lib/funds TRAY_MAX). */
import { isPension, peersOf, type VFund } from './verdict';

export const CHEAP_N = 3;

/** the keys to compare: the reader's tracks of one category, then the cheapest same-category tracks, at most TRAY_MAX */
export function compareKeys(mine: { k: string }[], funds: VFund[], max = 8): string[] {
  const by = new Map(funds.map((f) => [f.k, f]));
  const own = mine.map((m) => by.get(m.k)).filter((f): f is VFund => !!f);
  if (!own.length) return [];
  const lead = own.find((f) => isPension(f.prod)) ?? own[0];
  const cat = `${lead.prod} | ${lead.track}`;
  const mineCat = own.filter((f) => `${f.prod} | ${f.track}` === cat).map((f) => f.k);
  const cheap = peersOf(lead, funds).filter((x) => !x.closed && x.fee != null && !mineCat.includes(x.k))
    .sort((a, b) => a.fee! - b.fee! || (a.depfee ?? 0) - (b.depfee ?? 0) || (b.assets ?? 0) - (a.assets ?? 0)).slice(0, CHEAP_N).map((x) => x.k);
  return [...mineCat, ...cheap].slice(0, max);
}

