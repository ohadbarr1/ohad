import { useEffect, useState } from 'react';

/** A media query as live state: the layout follows rotation and window resizing, not only the first paint. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query), f = () => setOn(m.matches);
    f(); m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return on;
}
export const usePhone = () => useMedia('(max-width: 760px)');
