import { useStored } from './local';

/** "מה יש לי" (saver door): the products a reader says they hold. Kept in this browser only, never sent anywhere.
 *  fee / depfee are the reader's OWN fees from their statement (percent), when they enter them; otherwise the track's average applies. */
export interface MyProduct { k: string; balance?: number | null; monthly?: number | null; fee?: number | null; depfee?: number | null; added: string }
export const MINE_KEY = 'mine';
export const useMine = () => useStored<MyProduct[]>(MINE_KEY, []);
