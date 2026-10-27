/** A10 · the Fragility Monitor's file and its sources on the page (the pure library is lib/fragility.ts, run in node by its unit test). */
import { ltsProv, warmRep } from './lens';
import type { Prov } from './prov';
import { useLoad } from './useData';
import { toProv, type FragFile, type ProvJ } from './fragility';

export const useFragility = (enabled = true) => useLoad<FragFile>(enabled ? 'fragility.json' : null);
/** a node of the file as a Prov; a managing company's printed components open through the Savings Lens resolver */
export const fprov = (j: ProvJ): Prov => toProv(j, (x) => ltsProv(x.c, x.metric, x.period, x.title, x.unit, x.note, x.value));
/** loads the printed-components files a node cites, so its sheet opens complete */
export function warmProv(j: unknown) {
  if (Array.isArray(j)) j.forEach(warmProv);
  else if (j && typeof j === 'object') { const o = j as Record<string, unknown>; if (o.k === 'lts' && typeof o.c === 'string') warmRep(o.c); else Object.values(o).forEach(warmProv); }
}
