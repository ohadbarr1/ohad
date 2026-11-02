import { AGE_DEFAULT, retireAgeOf } from './retire';
import { useStored } from './local';

/** "מה יש לי" (saver door): the products a reader says they hold. Kept in this browser only, never sent anywhere.
 *  fee / depfee are the reader's OWN fees from their statement (percent), when they enter them; otherwise the track's average applies. */
/** imp: the as-of date of the clearing-house file the numbers came from (W3 import), when they did */
export interface MyProduct { k: string; balance?: number | null; monthly?: number | null; fee?: number | null; depfee?: number | null; added: string; imp?: string }
export const MINE_KEY = 'mine';
export const useMine = () => useStored<MyProduct[]>(MINE_KEY, []);

/** The reader's age and sex, asked once at the top of /my and used on every card and in the fee tool (this browser only).
 *  null until the reader sets them: the page then shows the example age as an example ("לדוגמה, שנו"), never silently. */
export const AGE_KEY = 'my:age', SEX_KEY = 'my:sex';
export const useMyAge = () => useStored<number | null>(AGE_KEY, null);
export const useMySex = () => useStored<'m' | 'f' | null>(SEX_KEY, null);
/** W5: the retirement age the reader typed, when it differs from the statutory one (lib/retire retireAgeOf); null: the statutory one */
export const RETIRE_KEY = 'my:retire';
export const useMyRetire = () => useStored<number | null>(RETIRE_KEY, null);
/** the retirement age in force on /my, the cards and the fee tool: the reader's own, else the statutory one by sex and age */
export function useRetire(): { v: number; why: string; own: boolean } {
  const [age] = useMyAge(), [sex] = useMySex(), [r] = useMyRetire();
  const d = retireAgeOf(sex, age ?? AGE_DEFAULT);
  return r != null && Number.isFinite(r) ? { v: r, why: 'שלך', own: true } : { ...d, own: false };
}
