import { useDensity, type Density } from '../lib/density';

/** The density switch: automatic (compact from 1920 px), comfortable, compact. */
export function DensityToggle() {
  const [d, set] = useDensity();
  const opts: [Density, string][] = [['auto', 'אוטו'], ['comfortable', 'מרווח'], ['compact', 'צפוף']];
  return (
    <div className="density wide-only" role="group" aria-label="צפיפות">
      {opts.map(([k, l]) => <button key={k} type="button" aria-pressed={d === k} onClick={() => set(k)} title={k === 'auto' ? 'צפוף ממסך ברוחב 1920 ומעלה' : undefined}>{l}</button>)}
    </div>
  );
}
