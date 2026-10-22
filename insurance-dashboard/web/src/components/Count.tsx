import { nf } from '../lib/format';

/** A figure printed at its value from the first frame: copyable, screenshot-safe, the same in every render. */
export function Count({ value, dec = 0, suffix = '', signed = false }: { value: number | null | undefined; dec?: number; suffix?: string; signed?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <>–</>;
  return <>{signed && value > 0 ? '+' : ''}{nf(value, dec)}{suffix}</>;
}
