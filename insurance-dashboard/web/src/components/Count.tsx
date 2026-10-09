import { nf } from '../lib/format';
import { useCountUp } from '../lib/motion';

/** A number that counts up to its value. */
export function Count({ value, dec = 0, suffix = '', signed = false }: { value: number | null | undefined; dec?: number; suffix?: string; signed?: boolean }) {
  const v = useCountUp(value ?? null);
  if (v == null || !Number.isFinite(v)) return <>–</>;
  return <>{signed && v > 0 ? '+' : ''}{nf(v, dec)}{suffix}</>;
}
