/* W1 · agent door: the pension decision data of a track, pure (no React).
   - Default fund (קרן ברירת מחדל / "קרן נבחרת"): is the track's fund a winner of the tender in force at the data month, with the
     price the tender set (fee from deposit, fee from accumulation, for how many years) and the period. funds/default.json (F2 DATA)
     maps each winner to its pensia-net fund by name (`map: inferred`): the page says so.
   - Actuarial balance (איזון אקטוארי): pensia-net ACTUARIAL_ADJUSTMENT, a percent, published once a quarter; the latest from
     funds.json (`act`, `act_p`), the history from the track's file (`act`). */
import { isoYm, priceOf, tendersOf, type DefaultFile, type Tender, type Winner } from './fundsTools';

export interface DefaultHit { t: Tender; w: Winner; fee: number | null; depfee: number | null; current: boolean }
/** every tender the track's fund won, newest first; `current` = in force in month `asof` (yyyymm) */
export function defaultHits(k: string, d: DefaultFile | null | undefined, asof: number): DefaultHit[] {
  return tendersOf(d).flatMap((t) => t.winners.filter((w) => (w.k ?? (w as Winner & { ks?: string[] }).ks ?? []).includes(k)).map((w) => ({ t, w, ...priceOf(t, w), current: isoYm(t.from) <= asof && asof <= isoYm(t.to) })));
}
/** the tender in force for the track, or null */
export const defaultNow = (k: string, d: DefaultFile | null | undefined, asof: number) => defaultHits(k, d, asof).find((h) => h.current) ?? null;
/** the keys of every track whose fund is a default fund in month `asof` */
export function defaultKeys(d: DefaultFile | null | undefined, asof: number): Set<string> {
  const out = new Set<string>();
  tendersOf(d).filter((t) => isoYm(t.from) <= asof && asof <= isoYm(t.to)).forEach((t) => t.winners.forEach((w) => (w.k ?? (w as Winner & { ks?: string[] }).ks ?? []).forEach((x) => out.add(x))));
  return out;
}
/** "11/24–10/28" */
export const periodText = (t: Pick<Tender, 'from' | 'to'>) => `${t.from.slice(5, 7)}/${t.from.slice(2, 4)}–${t.to.slice(5, 7)}/${t.to.slice(2, 4)}`;

export interface ActPoint { p: number; v: number }
/** the published quarters of the actuarial balance, oldest first, the last `n` */
export function actHistory(h: { p: number[]; act?: (number | null)[] } | null | undefined, n = 8): ActPoint[] {
  if (!h?.act) return [];
  return h.p.map((p, i) => ({ p, v: h.act![i] })).filter((x): x is ActPoint => x.v != null && Number.isFinite(x.v)).slice(-n);
}
/** compounded over the quarters shown: (1 + a₁) × … × (1 + aₙ) − 1, % */
export const actCompound = (xs: ActPoint[]) => (xs.length ? (xs.reduce((t, x) => t * (1 + x.v / 100), 1) - 1) * 100 : null);
/** a pension product (pensia-net) */
export const isPension = (f: { fam?: string; prod?: string; k?: string }) => f.fam === 'pensia' || /^פנסיה/.test(f.prod ?? '') || /^p\d/.test(f.k ?? '');
export const ACT_F = 'איזון אקטוארי (ACTUARIAL_ADJUSTMENT), באחוזים מהעתודות, כפי שהקרן דיווחה לפנסיה-נט; מדווח פעם ברבעון. חיובי: הקרן מגדילה את הזכויות; שלילי: מקטינה. משקף סטיות בתוחלת חיים, נכות, שאירים וריבית, לא את תשואת ההשקעות';
