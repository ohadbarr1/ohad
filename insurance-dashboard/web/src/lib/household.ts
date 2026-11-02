/* W7 saver · household profiles on /my: "אני", "+ בן/בת זוג", "+ הורה". Each profile has its own products, age, sex, retirement age,
   salary and "what changed" snapshot, all in this browser under the site's `fox:` prefix (lib/local). Pure: no React, no storage.

   Storage layout. The profile "אני" IS the keys the page always used (fox:mine, fox:my:age, …), so a browser that saved products
   before this wave loses nothing and needs no migration step: `keyFor('mine', 'me') === 'mine'`. Another profile adds a suffix:
   fox:mine@spouse, fox:my:age@spouse. The list of profiles and the active one live under fox:my:profiles. No names are stored: the
   note to the agent calls any profile other than "אני" simply "החוסך/ת". */

export type ProfileId = 'me' | 'spouse' | 'parent';
export interface Profiles { v: 1; active: ProfileId; list: ProfileId[] }
export const PROFILES_KEY = 'my:profiles';
export const PROFILE_IDS: ProfileId[] = ['me', 'spouse', 'parent'];
/** the chip's words */
export const PROFILE_LABEL: Record<ProfileId, string> = { me: 'אני', spouse: 'בן/בת זוג', parent: 'הורה' };
/** the "add" chips */
export const PROFILE_ADD: Record<Exclude<ProfileId, 'me'>, string> = { spouse: '+בן/בת זוג', parent: '+הורה' };
/** the per-profile keys (without the prefix): what a removed profile drops */
export const PER_PROFILE_KEYS = ['mine', 'my:age', 'my:sex', 'my:retire', 'my:salary', 'my:seen'];
export const EMPTY_PROFILES: Profiles = { v: 1, active: 'me', list: ['me'] };

const isId = (x: unknown): x is ProfileId => typeof x === 'string' && (PROFILE_IDS as string[]).includes(x);

/** a well-formed stored value, or the single profile "אני" (the store is the reader's: anything can be there) */
export function normProfiles(x: unknown): Profiles {
  const o = (x ?? {}) as Partial<Profiles>;
  const list = Array.isArray(o.list) ? o.list.filter(isId) : [];
  const uniq: ProfileId[] = ['me', ...list.filter((p, i, a) => p !== 'me' && a.indexOf(p) === i)];
  const active = isId(o.active) && uniq.includes(o.active) ? o.active : 'me';
  return { v: 1, active, list: uniq };
}

/** the storage key of a per-profile value: the plain key for "אני", a suffix for the others */
export const keyFor = (base: string, pid: ProfileId): string => (pid === 'me' ? base : `${base}@${pid}`);

/** a profile added (once) and made active */
export function addProfile(p: Profiles, id: Exclude<ProfileId, 'me'>): Profiles {
  const n = normProfiles(p);
  return { v: 1, active: id, list: n.list.includes(id) ? n.list : [...n.list, id] };
}
/** a profile removed ("אני" never is), the active one falling back to "אני"; `drop`: the keys whose values go with it */
export function removeProfile(p: Profiles, id: ProfileId): { profiles: Profiles; drop: string[] } {
  const n = normProfiles(p);
  if (id === 'me') return { profiles: n, drop: [] };
  return { profiles: { v: 1, active: n.active === id ? 'me' : n.active, list: n.list.filter((x) => x !== id) }, drop: PER_PROFILE_KEYS.map((k) => keyFor(k, id)) };
}
/** the profile switched (an unknown one falls back to "אני") */
export const setActive = (p: Profiles, id: ProfileId): Profiles => { const n = normProfiles(p); return { ...n, active: n.list.includes(id) ? id : 'me' }; };

/** how the note to the agent names the saver: first person for "אני", "החוסך/ת" for anyone else (no names are stored) */
export const thirdPerson = (pid: ProfileId) => pid !== 'me';
