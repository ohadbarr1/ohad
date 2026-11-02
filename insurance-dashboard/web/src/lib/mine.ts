import { AGE_DEFAULT, retireAgeOf } from './retire';
import { useStored } from './local';
import type { DepositRow } from './clientTypes';
import type { MCover } from './maslaka';
import { EMPTY_PROFILES, PROFILES_KEY, keyFor, normProfiles, type ProfileId, type Profiles } from './household';
import type { Rates } from './deposits';

/** "מה יש לי" (saver door): the products a reader says they hold. Kept in this browser only, never sent anywhere.
 *  fee / depfee are the reader's OWN fees from their statement (percent), when they enter them; otherwise the track's average applies.
 *  imp: the as-of date of the clearing-house file the numbers came from (W3 import), when they did.
 *  W7 (wave 2): `deposits` (the statement's table ה', typed or imported), `salary` (the insured monthly salary), `covers` and `insTrack`
 *  (the pension fund's insurance covers from the clearing-house file, lib/maslaka MCover), `depRates` (the saver's own deposit rates when
 *  they differ from the statutory minimum, lib/deposits). All optional: older lists in the browser were saved without them. */
export interface MyProduct {
  k: string; balance?: number | null; monthly?: number | null; fee?: number | null; depfee?: number | null; added: string; imp?: string;
  deposits?: DepositRow[]; salary?: number | null; covers?: MCover[]; insTrack?: string | null; depRates?: Rates | null;
}
export const MINE_KEY = 'mine';
/** The reader's age and sex, asked once at the top of /my and used on every card and in the fee tool (this browser only).
 *  null until the reader sets them: the page then shows the example age as an example ("לדוגמה, שנו"), never silently. */
export const AGE_KEY = 'my:age', SEX_KEY = 'my:sex';
/** W5: the retirement age the reader typed, when it differs from the statutory one (lib/retire retireAgeOf); null: the statutory one */
export const RETIRE_KEY = 'my:retire';
/** W6: the reader's gross monthly salary, for the replacement rate (this browser only) */
export const SALARY_KEY = 'my:salary';

/* ---- W7: household profiles. Every per-saver value is read under the active profile's key (lib/household keyFor): "אני" keeps the
   plain keys the page always used, so nothing saved before this wave moves or is lost. ---- */
export function useProfiles(): [Profiles, (p: Profiles) => void] {
  const [raw, set] = useStored<unknown>(PROFILES_KEY, EMPTY_PROFILES);
  return [normProfiles(raw), set];
}
export const useActiveProfile = (): ProfileId => useProfiles()[0].active;
/** a per-profile stored value */
export function useMy<T>(base: string, init: T): [T, (next: T) => void] {
  const pid = useActiveProfile();
  return useStored<T>(keyFor(base, pid), init);
}

export const useMine = () => useMy<MyProduct[]>(MINE_KEY, []);
export const useMyAge = () => useMy<number | null>(AGE_KEY, null);
export const useMySex = () => useMy<'m' | 'f' | null>(SEX_KEY, null);
export const useMyRetire = () => useMy<number | null>(RETIRE_KEY, null);
export const useMySalary = () => useMy<number | null>(SALARY_KEY, null);
/** the retirement age in force on /my, the cards and the fee tool: the reader's own, else the statutory one by sex and age */
export function useRetire(): { v: number; why: string; own: boolean } {
  const [age] = useMyAge(), [sex] = useMySex(), [r] = useMyRetire();
  const d = retireAgeOf(sex, age ?? AGE_DEFAULT);
  return r != null && Number.isFinite(r) ? { v: r, why: 'שלך', own: true } : { ...d, own: false };
}
