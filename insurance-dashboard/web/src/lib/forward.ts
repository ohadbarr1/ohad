/* W10 · the latest economic-solvency report per insurer, as /capital reads it: capital/forward.json (pipeline/build_capital.py `forward`).
   The file carries the printed lines (with their pages), the regulator's capital-surplus walk, the disclosed sensitivities, the distribution
   constraints and the capacity left after distributions declared since the report's publication. Nothing is recomputed here except the
   sensitivity rows' worst case, which the test reproduces. */
import { toProv, type ProvJ } from './drivers';
import type { Prov } from './prov';

export const FORWARD_PATH = 'capital/forward.json';

export interface Fig { v: number; prov: ProvJ }
export type Basis = 'w' | 'wo';
export interface WalkRow { step: string; he: string; l: string; of?: Fig; scr?: Fig; su?: Fig }
export interface RatioStep { step: string; pp: number; prov: ProvJ }
export interface Sens { l: string; risk: string; b: 'w' | 'wo' | 'na'; v: number; prov: ProvJ }
export interface Cons { id: string; basis: Basis; kind: 'reg' | 'board' | 'board_min'; t: number; t_prov: ProvJ; he: string; of_after_actions: boolean; head: Fig; rem: Fig; pp: Fig }
export interface After { v: number; items: { kind: 'div' | 'pending'; v: number; d: string; prov: ProvJ }[]; prov: ProvJ }
export interface SensCap { l: string; risk: string; dv: number; after: Record<string, number>; bind: string; prov: ProvJ }
export interface FwdOk {
  id: string; name: string; status: 'ok'; date: string; period: string; pub: string; rid: number; doc: string; url: string | null;
  lines: Record<string, Fig>; walk: WalkRow[]; ratio_walk?: { open: number; close: number; steps: RatioStep[]; check: number };
  sens: Sens[]; constraints: Cons[]; binding: string; after: After; deducted_in_report: { v: number; dd: string; l: string; prov: ProvJ }[]; sens_capacity: SensCap[];
}
export type FwdCo = FwdOk | { id: string; name: string; status: 'na' | 'partial'; why: string; date?: string; period?: string };
export interface FwdFile { meta: { v: 1; built: string; formula: string; inputs: string[] }; companies: FwdCo[] }

export const fwdOk = (c: FwdCo): c is FwdOk => c.status === 'ok';
export const fp = (p: ProvJ): Prov => toProv(p);
export const bindOf = (c: FwdOk) => c.constraints.find((k) => k.id === c.binding)!;

/** the walk's movement steps, in the order the regulator prints them */
export const WALK_STEPS = ['operating', 'economic', 'new_business', 'capital_actions', 'tax_tiers'] as const;
export const STEP_SHORT: Record<string, string> = { operating: 'תפעולית', economic: 'כלכלית (שוק)', new_business: 'עסקים חדשים', capital_actions: 'פעולות הוניות ודיבידנד', tax_tiers: 'מס נדחה ורבדים' };

/** the shock columns of the cross-insurer table: each disclosure is matched by its risk and direction (every report words them a little differently) */
export const SHOCKS: { id: string; he: string; risk: string; test: (l: string) => boolean }[] = [
  { id: 'rate', he: 'ריבית −50 נ״ב', risk: 'rate', test: (l) => /ירידה/.test(l) },
  { id: 'equity', he: 'מניות −25%', risk: 'equity', test: () => true },
  { id: 'morbidity', he: 'תחלואה +5%', risk: 'morbidity', test: () => true },
  { id: 'mortality', he: 'תמותה ±5%', risk: 'mortality', test: () => true },
  { id: 'lapse', he: 'ביטולים +10%', risk: 'lapse', test: () => true },
  { id: 'other', he: 'אחר', risk: 'other', test: () => true },
];
export const sensFor = (c: FwdOk, id: string) => { const s = SHOCKS.find((x) => x.id === id)!; return c.sens.find((x) => x.risk === s.risk && s.test(x.l)) ?? null; };

/** the worst disclosed shock for the binding capacity: the lowest remaining capacity over the shocks, with its row */
export function worstShock(c: FwdOk): SensCap | null {
  let w: SensCap | null = null;
  for (const s of c.sens_capacity) if (!w || s.after[s.bind] < w.after[w.bind]) w = s;
  return w;
}

/** mortality is a decrease in most reports and an increase in Ayalon's: the label says which */
export const mortalitySign = (l: string) => (/עלי/.test(l) ? '⁦+5%⁩' : '⁦−5%⁩');
