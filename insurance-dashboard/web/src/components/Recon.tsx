import type { Track } from '../lib/prov';

/** Reconciliation of a regulator aggregate with the figure the company prints in its report. Filled by recon.json. */
export function Recon(_: { group: string; period: number; tracks: Track[] }) {
  return null;
}
