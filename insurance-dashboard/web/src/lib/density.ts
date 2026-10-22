import { useEffect, useState } from 'react';
import { useStored } from './local';
import '../styles/density.css';

/* Density: comfortable (34 px rows) or compact (26 px rows), a per-device preference set on <html data-density>.
   "auto" is compact on a screen of 1920 px and wider, comfortable below. Stored as fox:density. */
export type Density = 'auto' | 'comfortable' | 'compact';
const KEY = 'density';
const wide = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1920px)').matches;
const resolve = (d: Density) => (d === 'auto' ? (wide() ? 'compact' : 'comfortable') : d);
export function applyDensity(d: Density) { document.documentElement.dataset.density = resolve(d); }

// set once at load, before the first paint of a page that imports this module
try { applyDensity((JSON.parse(localStorage.getItem(`fox:${KEY}`) ?? '"auto"') as Density) || 'auto'); } catch { applyDensity('auto'); }

/** The density preference, kept on <html> and following the window width while on "auto". */
export function useDensity(): [Density, (d: Density) => void, 'comfortable' | 'compact'] {
  const [d, set] = useStored<Density>(KEY, 'auto');
  const [eff, setEff] = useState(resolve(d));
  useEffect(() => {
    const on = () => { applyDensity(d); setEff(resolve(d)); };
    on();
    const mq = window.matchMedia('(min-width: 1920px)');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [d]);
  return [d, set, eff];
}
