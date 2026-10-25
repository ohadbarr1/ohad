import { Link } from 'react-router-dom';
import { useLoad } from '../lib/useData';

/** cards/index.json (pipeline/build_cards.py): which report cards exist, per company, newest first; `u` lists the T+0 (unverified) ones */
export interface CardsIndex { v: number; built: string; co: Record<string, { p: string[]; u?: string[] }> }
export const useCards = () => useLoad<CardsIndex>('cards/index.json');
export const cardPath = (id: string, p: string) => `/card/${id}/${p}`;

/** "כרטיס דוח" beside a filing, when the card of that company and period exists. */
export function CardLink({ id, p, className = 'chip' }: { id: string; p: string; className?: string }) {
  const { data } = useCards();
  if (!data?.co[id]?.p.includes(p)) return null;
  return <Link className={`${className} card-link`} to={cardPath(id, p)} title="כרטיס דוח: עיקרי הדוח במסך אחד, כל מספר עם עמוד המקור">כרטיס דוח</Link>;
}
