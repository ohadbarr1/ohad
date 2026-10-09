import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animates a number towards `target` (ease-out-expo). Starts from the previous value, so edits glide instead of jumping. */
export function useCountUp(target: number | null, ms = 700): number | null {
  const [v, setV] = useState<number | null>(target);
  const from = useRef<number>(0);
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) { setV(target); return; }
    if (reduced()) { from.current = target; setV(target); return; }
    const start = from.current, t0 = performance.now();
    let id = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
      const cur = start + (target - start) * e;
      from.current = cur; setV(cur);
      if (k < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, ms]);
  return v;
}
