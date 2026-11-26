import type { FundX } from './funds';
import { shortGrp, trackLabels } from '../pages/compare/tracks';
import { typeLabel } from './pageWords';

/** Build review B1 (P3-7): one short label per track of a type. Labels among the RANKED tracks first (a self-managed account of the
 *  same company does not turn "מיטב" into "מיטב 880"), the others among all members; a label that still falls back to a fund number
 *  reads "<company> <track>" when that is free ("אלטשולר כללי" beside "אלטשולר ב'"). Also used by the type-month sheet. */
export function labelMap(members: FundX[], ranked: FundX[]): Map<string, string> {
  const a = trackLabels(ranked), b = trackLabels(members);
  const m = new Map<string, string>(members.map((f, i) => [f.k, b[i]]));
  ranked.forEach((f, i) => m.set(f.k, a[i]));
  const used = new Set(m.values());
  for (const f of members) {
    const l = m.get(f.k) ?? '', alt = `${shortGrp(f.grp)} ${typeLabel(f.track)}`;
    if (/ \d+$/.test(l) && !used.has(alt)) { m.set(f.k, alt); used.add(alt); }
  }
  return m;
}
